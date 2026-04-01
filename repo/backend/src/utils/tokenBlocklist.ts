import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";

import { dbPool } from "../db/pool";

const revokedTokensBlocklist = new Set<string>();

export function isTokenRevoked(jti: string): boolean {
  return revokedTokensBlocklist.has(jti);
}

export async function revokeToken(jti: string, expUnix: number | undefined): Promise<void> {
  const expMs = (expUnix ?? Math.floor(Date.now() / 1000) + 900) * 1000;
  const expiresAt = new Date(expMs);

  revokedTokensBlocklist.add(jti);

  const delay = Math.max(0, expMs - Date.now());
  setTimeout(() => {
    revokedTokensBlocklist.delete(jti);
  }, delay);

  try {
    await dbPool.execute<ResultSetHeader>(
      "INSERT IGNORE INTO revoked_tokens (token_id, expires_at) VALUES (?, ?)",
      [jti, expiresAt],
    );
  } catch {
    // DB write failed — in-memory blocklist still protects this instance
  }
}

interface RevokedTokenRow extends RowDataPacket {
  token_id: string;
  expires_at: Date;
}

export async function loadRevokedTokensFromDb(): Promise<void> {
  try {
    const [rows] = await dbPool.query<RevokedTokenRow[]>(
      "SELECT token_id, expires_at FROM revoked_tokens WHERE expires_at > NOW()",
    );

    for (const row of rows) {
      revokedTokensBlocklist.add(row.token_id);
    }

    await dbPool.execute("DELETE FROM revoked_tokens WHERE expires_at < NOW()");
  } catch {
    // Non-fatal on startup
  }
}
