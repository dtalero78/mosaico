/**
 * Feriados de Chile — para NO agendar clases en días festivos.
 *
 * Estrategia (unión):
 *   1. CALCULADOS por código: los feriados de FECHA FIJA (irrenunciables y demás),
 *      Semana Santa (Viernes y Sábado Santo, base Pascua) y los de TRASLADO legal
 *      (San Pedro y San Pablo, Encuentro de Dos Mundos — Ley 19.668 —; Iglesias
 *      Evangélicas — Ley 20.299). Exactos para CUALQUIER año, sin mantenimiento.
 *   2. JSON curado (`src/data/festivos.json`, entradas `c:'CL'`): aporta lo que no
 *      sale de una regla (Día de los Pueblos Indígenas = solsticio, feriado
 *      bancario). ⚠ Como el JSON SUMA, una fecha CL equivocada ahí crea un feriado
 *      falso aunque el cálculo esté bien: mantenerlo alineado con las reglas.
 *
 * `esFestivoChile(fecha)` = fijo/Semana-Santa calculado  OR  entrada CL en el JSON.
 * El JSON solo AGREGA (no anula) — así ningún feriado fijo se pierde aunque el
 * JSON de ese año esté incompleto.
 */

import festivosData from '@/data/festivos.json'

const JSON_DATA = festivosData as Record<string, Array<{ c: string; n: string }>>

/** Domingo de Pascua (algoritmo de Meeus/Butcher, calendario gregoriano). */
function domingoPascua(year: number): { m: number; d: number } {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const mes = Math.floor((h + l - 7 * m + 114) / 31) // 3 = marzo, 4 = abril
  const dia = ((h + l - 7 * m + 114) % 31) + 1
  return { m: mes, d: dia }
}

function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function addDaysISO(iso: string, n: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d) + n * 86400000).toISOString().slice(0, 10)
}

/** Día de la semana (0=domingo … 6=sábado) de una fecha civil, sin depender de la zona. */
function diaSemana(y: number, m: number, d: number): number {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/**
 * Ley 19.668 — San Pedro y San Pablo (29-jun) y Encuentro de Dos Mundos (12-oct):
 * si caen martes, miércoles o jueves se corren al LUNES de esa misma semana; si
 * caen viernes, al lunes SIGUIENTE; sábado, domingo o lunes se quedan donde están.
 */
function trasladoLey19668(y: number, m: number, d: number): string {
  const iso = ymd(y, m, d)
  const dow = diaSemana(y, m, d)
  if (dow >= 2 && dow <= 4) return addDaysISO(iso, -(dow - 1)) // mar/mié/jue → lunes anterior
  if (dow === 5) return addDaysISO(iso, 3)                        // viernes → lunes siguiente
  return iso
}

/**
 * Ley 20.299 — Día de las Iglesias Evangélicas y Protestantes (31-oct): si cae
 * martes se corre al viernes ANTERIOR; si cae miércoles, al viernes SIGUIENTE.
 */
function trasladoIglesiasEvangelicas(y: number): string {
  const iso = ymd(y, 10, 31)
  const dow = diaSemana(y, 10, 31)
  if (dow === 2) return addDaysISO(iso, -4) // martes → viernes anterior
  if (dow === 3) return addDaysISO(iso, 2)  // miércoles → viernes siguiente
  return iso
}

/** Feriados de Chile que se CALCULAN por regla (fijos, Semana Santa y los de traslado legal), para un año. */
export function feriadosFijosChile(year: number): Set<string> {
  const s = new Set<string>()
  // Fijos (fecha inamovible)
  const fijos: Array<[number, number]> = [
    [1, 1],    // Año Nuevo
    [5, 1],    // Día del Trabajo
    [5, 21],   // Glorias Navales
    [7, 16],   // Virgen del Carmen
    [8, 15],   // Asunción de la Virgen
    [9, 18],   // Independencia Nacional
    [9, 19],   // Glorias del Ejército
    [11, 1],   // Todos los Santos
    [12, 8],   // Inmaculada Concepción
    [12, 25],  // Navidad
  ]
  for (const [m, d] of fijos) s.add(ymd(year, m, d))
  // Semana Santa
  const p = domingoPascua(year)
  const domingo = ymd(year, p.m, p.d)
  s.add(addDaysISO(domingo, -2)) // Viernes Santo
  s.add(addDaysISO(domingo, -1)) // Sábado Santo
  // Traslados por ley (el Jueves Santo NO es feriado en Chile)
  s.add(trasladoLey19668(year, 6, 29))   // San Pedro y San Pablo
  s.add(trasladoLey19668(year, 10, 12))  // Encuentro de Dos Mundos
  s.add(trasladoIglesiasEvangelicas(year))
  return s
}

const _cache = new Map<number, Set<string>>()

/** ¿La fecha (YYYY-MM-DD o Date) es festivo en Chile? */
export function esFestivoChile(fecha: string | Date): boolean {
  const key = typeof fecha === 'string'
    ? fecha.slice(0, 10)
    : `${fecha.getUTCFullYear()}-${String(fecha.getUTCMonth() + 1).padStart(2, '0')}-${String(fecha.getUTCDate()).padStart(2, '0')}`
  const year = Number(key.slice(0, 4))
  if (!year) return false
  if (!_cache.has(year)) _cache.set(year, feriadosFijosChile(year))
  if (_cache.get(year)!.has(key)) return true
  // JSON: agrega los movibles/curados (solo suma, no anula)
  const e = JSON_DATA[key]
  return !!e && e.some((x) => x.c === 'CL')
}
