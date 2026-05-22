/**
 * Festivos Chile / Colombia / Ecuador.
 *
 * Lookup O(1) sobre un diccionario estático en `src/data/festivos.json`.
 * Para agregar el año siguiente, edita ese archivo (estructura:
 *   "YYYY-MM-DD": [{ "c": "CL"|"CO"|"EC", "n": "Nombre del festivo" }, ...]
 * ).
 */

import festivosData from '@/data/festivos.json'

export type CountryCode = 'CL' | 'CO' | 'EC'

export interface Holiday {
  country: CountryCode
  /** Nombre del festivo en español */
  name: string
}

const COUNTRY_LABEL: Record<CountryCode, string> = {
  CL: 'Chile',
  CO: 'Colombia',
  EC: 'Ecuador',
}

const COUNTRY_FLAG: Record<CountryCode, string> = {
  CL: '🇨🇱',
  CO: '🇨🇴',
  EC: '🇪🇨',
}

interface RawEntry { c: string; n: string }
const DATA = festivosData as Record<string, RawEntry[]>

function toYmd(date: Date | string): string {
  if (typeof date === 'string') return date.slice(0, 10)
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * Devuelve los festivos que aplican en la fecha dada.
 * Array vacío si no hay ninguno.
 */
export function getHolidays(date: Date | string): Holiday[] {
  const key = toYmd(date)
  const raw = DATA[key]
  if (!raw || raw.length === 0) return []
  return raw
    .filter((r) => r.c === 'CL' || r.c === 'CO' || r.c === 'EC')
    .map((r) => ({ country: r.c as CountryCode, name: r.n }))
}

export function getCountryLabel(c: CountryCode): string {
  return COUNTRY_LABEL[c]
}

export function getCountryFlag(c: CountryCode): string {
  return COUNTRY_FLAG[c]
}

/**
 * - 1 país con festivo → bandera de ese país
 * - 2 o más países → 🌎 (indicador genérico)
 */
export function getCompactFlags(holidays: Holiday[]): string {
  if (holidays.length === 0) return ''
  const set = new Set(holidays.map((h) => h.country))
  if (set.size >= 2) return '🌎'
  return COUNTRY_FLAG[Array.from(set)[0] as CountryCode]
}
