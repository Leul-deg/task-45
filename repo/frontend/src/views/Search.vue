<script setup lang="ts">
import { reactive, ref } from "vue";

import FilterField from "../components/FilterField.vue";
import { downloadCsv } from "../utils/csv";
import { getSession } from "../utils/auth";
import { http } from "../utils/http";

interface SearchResultItem {
  id: number;
  site: string;
  type: string;
  status: string;
  rating: number | null;
  cost: number | null;
  time: string;
  created_at: string;
  popularity: number;
  recent_activity: string | null;
  relevance_score: number;
}

const filters = reactive({
  q: "",
  site: "",
  status: "",
  risk_tags: "",
  date_from: "",
  date_to: "",
  cost_min: "",
  cost_max: "",
  rating_min: "",
  rating_max: "",
  theme: "",
  origin: "",
  destination: "",
  sort: "recent_activity",
});

const loading = ref(false);
const error = ref("");
const results = ref<SearchResultItem[]>([]);
const hasSearched = ref(false);

async function runSearch() {
  loading.value = true;
  error.value = "";

  try {
    const response = await http.get("/search/incidents", {
      params: {
        ...filters,
        limit: 100,
      },
    });

    results.value = (response.data.results || []) as SearchResultItem[];
    hasSearched.value = true;
  } catch (requestError: unknown) {
    const maybeResponse = requestError as { response?: { data?: { error?: string } } };
    error.value = maybeResponse.response?.data?.error || "Unable to search incidents.";
    hasSearched.value = false;
  } finally {
    loading.value = false;
  }
}

function resetFilters() {
  hasSearched.value = false;
  filters.q = "";
  filters.site = "";
  filters.status = "";
  filters.risk_tags = "";
  filters.date_from = "";
  filters.date_to = "";
  filters.cost_min = "";
  filters.cost_max = "";
  filters.rating_min = "";
  filters.rating_max = "";
  filters.theme = "";
  filters.origin = "";
  filters.destination = "";
  filters.sort = "recent_activity";
}

const privilegedExportRoles = new Set(["Safety Manager", "Auditor", "Administrator"]);

async function exportCurrentResults() {
  if (results.value.length === 0) {
    return;
  }

  const session = getSession();
  if (session && privilegedExportRoles.has(session.user.role)) {
    try {
      const response = await http.get("/export/incidents", {
        params: {
          status: filters.status || undefined,
          date_from: filters.date_from || undefined,
          date_to: filters.date_to || undefined,
        },
        responseType: "blob",
      });
      const url = URL.createObjectURL(response.data as Blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `incident-export-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      return;
    } catch { /* fall through to client-side export */ }
  }

  const rows = results.value.map((item) => [
    item.id,
    item.site,
    item.type,
    item.status,
    item.rating ?? "",
    item.cost ?? "",
    item.popularity,
    item.relevance_score,
    item.time,
    item.recent_activity || "",
  ]);

  downloadCsv(
    `incident-search-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.csv`,
    [
      "Incident ID",
      "Site",
      "Type",
      "Status",
      "Rating",
      "Cost",
      "Popularity",
      "Relevance Score",
      "Incident Time",
      "Recent Activity",
    ],
    rows,
  );
}
</script>

<template>
  <section class="view">
    <header class="view-header">
      <div>
        <p class="eyebrow">Data Exploration</p>
        <h1>Incident Search</h1>
      </div>
      <div class="toolbar-actions">
        <button class="btn ghost" @click="resetFilters">Reset Filters</button>
        <button class="btn" :disabled="loading" @click="runSearch">{{ loading ? "Searching..." : "Search" }}</button>
      </div>
    </header>

    <div class="card grid filter-grid">
      <FilterField label="Keyword">
        <input v-model="filters.q" placeholder="Keyword, synonyms, pinyin" />
      </FilterField>
      <FilterField label="Site">
        <input v-model="filters.site" placeholder="Warehouse 12" />
      </FilterField>
      <FilterField label="Status">
        <select v-model="filters.status">
          <option value="">All</option>
          <option>New</option>
          <option>Acknowledged</option>
          <option>In Progress</option>
          <option>Escalated</option>
          <option>Closed</option>
        </select>
      </FilterField>
      <FilterField label="Risk Tags">
        <input v-model="filters.risk_tags" placeholder="chemical,night-shift" />
      </FilterField>

      <FilterField label="Date From">
        <input v-model="filters.date_from" type="date" />
      </FilterField>
      <FilterField label="Date To">
        <input v-model="filters.date_to" type="date" />
      </FilterField>

      <FilterField label="Cost Min">
        <input v-model="filters.cost_min" type="number" min="0" step="0.01" />
      </FilterField>
      <FilterField label="Cost Max">
        <input v-model="filters.cost_max" type="number" min="0" step="0.01" />
      </FilterField>

      <FilterField label="Rating Min">
        <input v-model="filters.rating_min" type="number" min="0" max="5" />
      </FilterField>
      <FilterField label="Rating Max">
        <input v-model="filters.rating_max" type="number" min="0" max="5" />
      </FilterField>

      <FilterField label="Theme">
        <input v-model="filters.theme" placeholder="logistics" />
      </FilterField>
      <FilterField label="Origin">
        <input v-model="filters.origin" placeholder="dock-a" />
      </FilterField>
      <FilterField label="Destination">
        <input v-model="filters.destination" placeholder="bay-7" />
      </FilterField>
      <FilterField label="Sort">
        <select v-model="filters.sort">
          <option value="popularity">Popularity</option>
          <option value="recent_activity">Recent Activity</option>
          <option value="rating">Rating</option>
          <option value="cost">Cost</option>
        </select>
      </FilterField>
    </div>

    <div class="card table-card">
      <div class="table-head">
        <h2>Results ({{ results.length }})</h2>
        <button class="btn tiny" :disabled="results.length === 0" @click="exportCurrentResults">Export CSV</button>
      </div>
      <p v-if="error" class="error">{{ error }}</p>
      <p v-if="hasSearched && results.length === 0" class="muted">No incidents match your search criteria.</p>

      <table v-if="results.length > 0">
        <thead>
          <tr>
            <th>ID</th>
            <th>Site</th>
            <th>Type</th>
            <th>Status</th>
            <th>Rating</th>
            <th>Cost</th>
            <th>Popularity</th>
            <th>Relevance</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in results" :key="item.id">
            <td>#{{ item.id }}</td>
            <td>{{ item.site }}</td>
            <td>{{ item.type }}</td>
            <td>{{ item.status }}</td>
            <td>{{ item.rating ?? "-" }}</td>
            <td>{{ item.cost ?? "-" }}</td>
            <td>{{ item.popularity }}</td>
            <td>{{ item.relevance_score }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
