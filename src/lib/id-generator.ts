/**
 * Consistent ID Generation
 *
 * Replaces the manual `prefix_${Date.now()}_${Math.random()...}` pattern
 * found across ~8 route handlers with a single utility.
 */

import 'server-only';

/**
 * Generate a unique ID with a prefix.
 * Format: prefix_timestamp_random9chars
 *
 * Example: evt_1708012345678_k3m8x9p2q
 */
export function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Pre-configured ID generators for each entity type.
 *
 * Usage: const bookingId = ids.booking();
 */
export const ids = {
  event: () => generateId('evt'),
  booking: () => generateId('bkg'),
  financial: () => generateId('fin'),
  override: () => generateId('ovr'),
  comment: () => generateId('cmt'),
  person: () => generateId('prs'),
  academic: () => generateId('acd'),
  complementaria: () => generateId('cmp'),
  advisor: () => generateId('adv'),
  audit: () => generateId('aud'),
};
