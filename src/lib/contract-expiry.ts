/**
 * Contract expiry — date-only comparison with a +1 day grace period.
 *
 * Policy:
 *   A contract with `finalContrato = D` is considered expired when the server's
 *   UTC date is AT LEAST 2 calendar days after D. This guarantees that no user,
 *   regardless of their timezone (Chile, Colombia, Ecuador, Perú, or anywhere
 *   physically — España, Australia, etc.), is blocked while the last day of the
 *   contract is still ongoing in their local clock.
 *
 *   Example: finalContrato = 2026-05-12
 *     2026-05-13 UTC  → NOT expired (grace day; could still be 2026-05-12 in
 *                       the west, or already 2026-05-13 in the east — we wait)
 *     2026-05-14 UTC  → EXPIRED everywhere on earth
 *
 * No timezone arithmetic: both sides compared as plain YYYY-MM-DD strings (UTC).
 * This works because `PEOPLE.finalContrato` is now stored as `DATE` (no time).
 *
 * Use this helper in JS code (panel, login, special-nivel) and
 * CONTRACT_EXPIRED_SQL in SQL (cron, queries).
 */

/** Days of grace AFTER finalContrato before the contract is considered expired. */
const GRACE_DAYS = 1;

/** YYYY-MM-DD of any Date / timestamp / DATE-as-string, computed in UTC. */
function dateUtc(d: Date | string | number): string {
  return new Date(d).toISOString().split('T')[0];
}

/** UTC date today, shifted by `delta` days (negative = past). YYYY-MM-DD. */
function todayUtcPlus(delta: number): string {
  const now = new Date();
  now.setUTCDate(now.getUTCDate() + delta);
  return now.toISOString().split('T')[0];
}

/**
 * True if the contract is expired under the +1 day grace policy.
 *   expired ⇔ finalContrato < (todayUTC - GRACE_DAYS)
 * Returns false for null/empty.
 */
export function isContractExpired(finalContrato: Date | string | null | undefined): boolean {
  if (!finalContrato) return false;
  return dateUtc(finalContrato) < todayUtcPlus(-GRACE_DAYS);
}

/**
 * SQL fragment that mirrors `isContractExpired` for use in WHERE clauses.
 *   expired ⇔ finalContrato < CURRENT_DATE - INTERVAL '1 day'
 *
 * Usage:
 *   `SELECT ... WHERE ${CONTRACT_EXPIRED_SQL('"finalContrato"')}`
 *
 * Note: server is in UTC, so CURRENT_DATE is the UTC calendar date.
 */
export function CONTRACT_EXPIRED_SQL(column: string): string {
  return `${column} IS NOT NULL AND ${column} < (CURRENT_DATE - INTERVAL '${GRACE_DAYS} day')`;
}
