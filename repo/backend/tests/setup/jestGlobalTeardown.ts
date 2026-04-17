/**
 * Closes the MySQL pool so Jest can exit cleanly after suites that import `dbPool`.
 */
export default async function globalTeardown(): Promise<void> {
  try {
    const { dbPool } = await import("../../src/db/pool");
    await dbPool.end();
  } catch {
    // Ignore if pool never initialized or already closed.
  }
}
