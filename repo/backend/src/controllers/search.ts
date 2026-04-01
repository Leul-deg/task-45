import { Router } from "express";
import type { RequestHandler } from "express";
import { pinyin } from "pinyin-pro";
import type { RowDataPacket } from "mysql2";

import { dbPool } from "../db/pool";
import { authenticateJwt } from "../middleware/security";

const PRIVILEGED_SEARCH_ROLES = new Set(["Dispatcher", "Safety Manager", "Auditor", "Administrator"]);

type SortKey = "popularity" | "recent_activity" | "rating" | "cost";

interface SearchIncidentRow extends RowDataPacket {
  id: number;
  reporter_id: number;
  type: string;
  description: string;
  site: string;
  time: Date;
  status: string;
  rating: number | null;
  cost: number | null;
  risk_tags: string | null;
  created_at: Date;
  popularity: number;
  recent_activity: Date | null;
}

interface SearchResult extends SearchIncidentRow {
  parsed_risk_tags: Record<string, unknown>;
  relevance_score: number;
}

const synonymMap: Record<string, string[]> = {
  fire: ["blaze", "flame", "combustion"],
  injury: ["harm", "wound", "trauma"],
  spill: ["leak", "discharge", "overflow"],
  outage: ["downtime", "blackout", "failure"],
  collision: ["crash", "impact"],
};

function normalizeText(input: string): string {
  return input.toLowerCase().replace(/\s+/g, " ").trim();
}

function toPinyinNormalized(input: string): string {
  if (!input) {
    return "";
  }

  return pinyin(input, { toneType: "none", type: "array" }).join(" ").toLowerCase();
}

function parseRiskTags(raw: string | null): Record<string, unknown> {
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function extractStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry) => String(entry).toLowerCase());
}

function expandKeywordTerms(keyword: string): string[] {
  const terms = normalizeText(keyword)
    .split(" ")
    .map((term) => term.trim())
    .filter(Boolean);

  const expanded = new Set<string>(terms);

  for (const term of terms) {
    const synonyms = synonymMap[term] ?? [];
    for (const synonym of synonyms) {
      expanded.add(synonym);
    }
  }

  return Array.from(expanded);
}

function applySort(results: SearchResult[], sort: SortKey): SearchResult[] {
  const sorted = [...results];

  if (sort === "popularity") {
    sorted.sort((a, b) => b.popularity - a.popularity);
    return sorted;
  }

  if (sort === "recent_activity") {
    sorted.sort((a, b) => {
      const aTime = a.recent_activity ? new Date(a.recent_activity).getTime() : 0;
      const bTime = b.recent_activity ? new Date(b.recent_activity).getTime() : 0;
      return bTime - aTime;
    });
    return sorted;
  }

  if (sort === "rating") {
    sorted.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));
    return sorted;
  }

  sorted.sort((a, b) => (b.cost ?? -1) - (a.cost ?? -1));
  return sorted;
}

const searchIncidentsHandler: RequestHandler = async (req, res) => {
  try {
    const userId = req.auth?.sub;
    const userRole = req.auth?.role;
    if (!userId || !userRole) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const keyword = String(req.query.q ?? "").trim();
    const site = String(req.query.site ?? "").trim();
    const status = String(req.query.status ?? "").trim();
    const dateFrom = String(req.query.date_from ?? "").trim();
    const dateTo = String(req.query.date_to ?? "").trim();
    const riskTagFilter = String(req.query.risk_tags ?? "").trim();
    const themeFilter = String(req.query.theme ?? "").trim().toLowerCase();
    const originFilter = String(req.query.origin ?? "").trim().toLowerCase();
    const destinationFilter = String(req.query.destination ?? "").trim().toLowerCase();
    const costMin = req.query.cost_min ? Number(req.query.cost_min) : null;
    const costMax = req.query.cost_max ? Number(req.query.cost_max) : null;
    const ratingMin = req.query.rating_min ? Number(req.query.rating_min) : null;
    const ratingMax = req.query.rating_max ? Number(req.query.rating_max) : null;
    const limit = Math.min(Math.max(Number(req.query.limit ?? 50), 1), 100);
    const offset = Math.max(Number(req.query.offset ?? 0), 0);
    const requestedSort = String(req.query.sort ?? "").trim() as SortKey;
    const sort = requestedSort || (keyword ? "recent_activity" : "popularity");

    const where: string[] = [];
    const params: unknown[] = [];

    if (!PRIVILEGED_SEARCH_ROLES.has(userRole)) {
      where.push("i.reporter_id = ?");
      params.push(userId);
    }

    if (site) {
      where.push("i.site = ?");
      params.push(site);
    }
    if (status) {
      where.push("i.status = ?");
      params.push(status);
    }
    if (dateFrom) {
      where.push("i.time >= ?");
      params.push(new Date(dateFrom));
    }
    if (dateTo) {
      where.push("i.time <= ?");
      params.push(new Date(dateTo));
    }
    if (costMin !== null && Number.isFinite(costMin)) {
      where.push("i.cost >= ?");
      params.push(costMin);
    }
    if (costMax !== null && Number.isFinite(costMax)) {
      where.push("i.cost <= ?");
      params.push(costMax);
    }
    if (ratingMin !== null && Number.isFinite(ratingMin)) {
      where.push("i.rating >= ?");
      params.push(ratingMin);
    }
    if (ratingMax !== null && Number.isFinite(ratingMax)) {
      where.push("i.rating <= ?");
      params.push(ratingMax);
    }

    const requestedRiskTags = riskTagFilter
      ? riskTagFilter
          .split(",")
          .map((tag) => tag.trim().toLowerCase())
          .filter(Boolean)
      : [];

    for (const tag of requestedRiskTags) {
      where.push("JSON_CONTAINS(LOWER(JSON_EXTRACT(i.risk_tags, '$.tags')), JSON_QUOTE(?))");
      params.push(tag);
    }

    if (themeFilter) {
      where.push("LOWER(JSON_UNQUOTE(JSON_EXTRACT(i.risk_tags, '$.theme'))) = ?");
      params.push(themeFilter);
    }

    if (originFilter) {
      where.push("LOWER(JSON_UNQUOTE(JSON_EXTRACT(i.risk_tags, '$.origin'))) LIKE ?");
      params.push(`%${originFilter}%`);
    }

    if (destinationFilter) {
      where.push("LOWER(JSON_UNQUOTE(JSON_EXTRACT(i.risk_tags, '$.destination'))) LIKE ?");
      params.push(`%${destinationFilter}%`);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

    const [rows] = await dbPool.query<SearchIncidentRow[]>(
      `SELECT
        i.id,
        i.reporter_id,
        i.type,
        i.description,
        i.site,
        i.time,
        i.status,
        i.rating,
        i.cost,
        i.risk_tags,
        i.created_at,
        COUNT(ia.id) AS popularity,
        MAX(ia.created_at) AS recent_activity
      FROM incidents i
      LEFT JOIN incident_actions ia ON ia.incident_id = i.id
      ${whereClause}
      GROUP BY i.id
      LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );

    const keywordTerms = keyword ? expandKeywordTerms(keyword) : [];
    const keywordPinyin = keyword ? toPinyinNormalized(keyword) : "";

    let results: SearchResult[] = rows.map((row) => ({
      ...row,
      parsed_risk_tags: parseRiskTags(row.risk_tags),
      relevance_score: 0,
    }));

    if (keyword) {
      const normalizedKeyword = normalizeText(keyword);

      results = results
        .map((row) => {
          const risk = row.parsed_risk_tags as {
            theme?: unknown;
            origin?: unknown;
            destination?: unknown;
            tags?: unknown;
          };

          const haystack = normalizeText(
            [
              row.type,
              row.description,
              row.site,
              String(risk.theme ?? ""),
              String(risk.origin ?? ""),
              String(risk.destination ?? ""),
              extractStringArray(risk.tags).join(" "),
            ]
              .join(" ")
              .trim(),
          );

          const haystackPinyin = toPinyinNormalized(haystack);
          let score = 0;

          if (haystack.includes(normalizedKeyword)) {
            score += 5;
          }
          if (keywordPinyin && haystackPinyin.includes(keywordPinyin)) {
            score += 4;
          }

          for (const term of keywordTerms) {
            if (haystack.includes(term)) {
              score += 2;
            }

            const pinyinTerm = toPinyinNormalized(term);
            if (pinyinTerm && haystackPinyin.includes(pinyinTerm)) {
              score += 1;
            }
          }

          return {
            ...row,
            relevance_score: score,
          };
        })
        .filter((row) => row.relevance_score > 0)
        .sort((a, b) => b.relevance_score - a.relevance_score);
    }

    const sortableValues: SortKey[] = ["popularity", "recent_activity", "rating", "cost"];
    if (sortableValues.includes(sort)) {
      results = applySort(results, sort);
    }

    res.status(200).json({
      count: results.length,
      filters: {
        q: keyword || null,
        site: site || null,
        status: status || null,
        date_from: dateFrom || null,
        date_to: dateTo || null,
        cost_min: costMin !== null ? costMin : null,
        cost_max: costMax !== null ? costMax : null,
        risk_tags: requestedRiskTags,
        theme: themeFilter || null,
        origin: originFilter || null,
        destination: destinationFilter || null,
      },
      sort,
      results,
    });
  } catch (error) {
    console.error("search-failure:", error instanceof Error ? error.message : error);
    res.status(500).json({ error: "Unable to search incidents" });
  }
};

const searchRouter = Router();

searchRouter.get("/incidents", searchIncidentsHandler);

export default searchRouter;
