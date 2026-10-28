/**
 * Vigencias comerciales (mes comercial del Libro de Producción) — reglas únicas,
 * client-safe (las usan la API y la pantalla).
 *
 * - Una vigencia por año+mes, IGUAL para todos los países. `inicio`/`fin` son
 *   fecha-hora SIN zona ("2026-09-28T09:00"): el corte se interpreta en la hora
 *   LOCAL del país de cada contrato (zonaHorariaPais), calculado en el servidor a
 *   partir de PEOPLE.fechaCreacion — nunca con el reloj del computador del cliente.
 * - El generador anual recibe el primer día de enero y el ÚLTIMO de cada mes; cada
 *   mes empieza donde terminó el anterior (sin huecos ni solapes).
 * - Semanas automáticas: bloques de 7 días desde el inicio; la última absorbe los
 *   días sobrantes (un mes de 30 días = 3 semanas de 7 + una de 9).
 */

export const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio',
  'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'] as const;

export const HORA_CORTE_DEFAULT = '09:00';

/** Zona horaria del país del contrato (PEOPLE.plataforma). */
export function zonaHorariaPais(plataforma?: string | null): string {
  const p = String(plataforma || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (p.startsWith('chile')) return 'America/Santiago';
  if (p.startsWith('ecuador')) return 'America/Guayaquil';
  if (p.startsWith('peru')) return 'America/Lima';
  return 'America/Bogota'; // Colombia y cualquier otro
}

export interface Vigencia {
  _id: string;
  anio: number;
  mes: number;          // 1..12
  inicio: string;       // 'YYYY-MM-DDTHH:mm' (hora local, sin zona)
  fin: string;
}

export interface Semana { numero: number; etiqueta: string; inicio: string; fin: string }

export const etiquetaVigencia = (v: Pick<Vigencia, 'anio' | 'mes'>) => `${MESES[v.mes - 1]} ${v.anio}`;

const ORDINAL = ['1RA', '2DA', '3RA', '4TA', '5TA', '6TA'];
export const etiquetaSemana = (n: number) => ORDINAL[n - 1] || `${n}ª`;

/** 'YYYY-MM-DDTHH:mm' ⇄ minutos desde epoch, tratando la fecha como "reloj de pared" (UTC ficticio). */
function aMin(s: string): number {
  const [d, t = '00:00'] = s.replace(' ', 'T').split('T');
  const [y, m, dd] = d.split('-').map(Number);
  const [hh, mi] = t.split(':').map(Number);
  return Date.UTC(y, (m || 1) - 1, dd || 1, hh || 0, mi || 0) / 60000;
}
function deMin(min: number): string {
  const x = new Date(min * 60000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${x.getUTCFullYear()}-${p(x.getUTCMonth() + 1)}-${p(x.getUTCDate())}T${p(x.getUTCHours())}:${p(x.getUTCMinutes())}`;
}

/** Semanas de la vigencia: bloques de 7 días; la última se extiende hasta el fin. */
export function semanasDeVigencia(v: Pick<Vigencia, 'inicio' | 'fin'>): Semana[] {
  const ini = aMin(v.inicio), fin = aMin(v.fin);
  const SEM = 7 * 24 * 60;
  const total = Math.max(1, Math.floor((fin - ini) / SEM));
  return Array.from({ length: total }, (_, i) => ({
    numero: i + 1,
    etiqueta: etiquetaSemana(i + 1),
    inicio: deMin(ini + i * SEM),
    fin: i === total - 1 ? deMin(fin) : deMin(ini + (i + 1) * SEM),
  }));
}

/** Número de semana (1..n) de una fecha-hora local dentro de la vigencia; null si cae afuera. */
export function semanaDe(v: Pick<Vigencia, 'inicio' | 'fin'>, localISO: string): number | null {
  const t = aMin(localISO), ini = aMin(v.inicio), fin = aMin(v.fin);
  if (t < ini || t >= fin) return null;
  const total = Math.max(1, Math.floor((fin - ini) / (7 * 24 * 60)));
  return Math.min(total, Math.floor((t - ini) / (7 * 24 * 60)) + 1);
}

/**
 * Arma las 12 vigencias de un año a partir del primer día de enero y del último día
 * de cada mes (YYYY-MM-DD). Valida que cada fin sea posterior a su inicio.
 */
export function armarVigenciasAnio(anio: number, inicioEnero: string, finesPorMes: string[], hora = HORA_CORTE_DEFAULT):
  { ok: true; vigencias: Omit<Vigencia, '_id'>[] } | { ok: false; error: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inicioEnero)) return { ok: false, error: 'Falta el primer día de la vigencia de enero.' };
  if (finesPorMes.length !== 12) return { ok: false, error: 'Se requiere el último día de los 12 meses.' };
  if (!/^\d{2}:\d{2}$/.test(hora)) return { ok: false, error: 'Hora de corte inválida (HH:mm).' };
  const out: Omit<Vigencia, '_id'>[] = [];
  let inicio = `${inicioEnero}T${hora}`;
  for (let i = 0; i < 12; i++) {
    const f = finesPorMes[i];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f || '')) return { ok: false, error: `Falta el último día de ${MESES[i]}.` };
    const fin = `${f}T${hora}`;
    if (aMin(fin) <= aMin(inicio)) return { ok: false, error: `${MESES[i]}: el último día debe ser posterior al inicio (${inicio.slice(0, 10)}).` };
    if ((aMin(fin) - aMin(inicio)) / (24 * 60) > 45) return { ok: false, error: `${MESES[i]}: la vigencia supera 45 días; revise la fecha.` };
    out.push({ anio, mes: i + 1, inicio, fin });
    inicio = fin;
  }
  return { ok: true, vigencias: out };
}
