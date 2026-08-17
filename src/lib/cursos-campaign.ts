/**
 * Catálogo compartido de cursos/horarios de MOSAICO (cliente + servidor).
 * Sin 'server-only' — lo usan el wizard de contratos y el admin Crea Campaña.
 */

/**
 * Mensaje único cuando un salón ya no tiene cupo. Vive aquí (cliente+servidor)
 * para que el wizard y el backend digan exactamente lo mismo: sin sobrecupo, el
 * curso se amplía desde Académico antes de meter más alumnos.
 */
export const MENSAJE_SIN_CUPO = 'Salón sin cupo, consulte al área académica.';

// Tipos de curso en ORDEN de visualización (menores → adultos).
export const TIPOS_CURSO = ['YOJI', 'OKINA', 'KODOMO', 'DANSHI', 'SENPAI', 'IMPULSA'] as const;
export type TipoCurso = typeof TIPOS_CURSO[number];

// Cursos para menores de edad (no seleccionables cuando el titular es el beneficiario).
export const CURSOS_MENORES: TipoCurso[] = ['YOJI', 'OKINA', 'KODOMO'];

// Posición canónica para ordenar (1-based); desconocidos al final.
export function ordenTipoCurso(tipo: string): number {
  const i = (TIPOS_CURSO as readonly string[]).indexOf(tipo);
  return i < 0 ? 999 : i + 1;
}

export function esMenores(tipo: string): boolean {
  return CURSOS_MENORES.includes(tipo as TipoCurso);
}
export function esImpulsa(tipo: string): boolean {
  return tipo === 'IMPULSA';
}

// Horarios disponibles por tipo de curso (catálogo fijo).
// Menores (YOJI/OKINA/KODOMO): 17:00-18:00, 18:15-19:15, 19:30-20:30. Sábados 09-11 / 11-13.
const HORARIOS_MENORES = [
  'LUN-MIÉ 17:00-18:00',
  'LUN-MIÉ 18:15-19:15',
  'LUN-MIÉ 19:30-20:30',
  'MAR-JUE 17:00-18:00',
  'MAR-JUE 18:15-19:15',
  'MAR-JUE 19:30-20:30',
  'SÁB 09:00-11:00',
  'SÁB 10:00-12:00', // histórico — campaña ENERO172026 y anteriores
  'SÁB 11:00-13:00',
];
const HORARIOS_DANSHI = [
  'LUN-MIÉ 19:00-19:50',
  'MAR-JUE 19:00-19:50',
  'SÁB 09:00-11:00',
  'SÁB 10:00-12:00', // histórico — campaña ENERO172026 y anteriores
  'SÁB 11:00-13:00',
];
const HORARIOS_SENPAI = [
  'LUN-MIÉ 20:00-20:50',
  'MAR-JUE 19:00-19:50', // histórico — ENERO172026 (un titular quedó en este bloque)
  'MAR-JUE 20:00-20:50',
  'SÁB 09:00-11:00',
  'SÁB 10:00-12:00',     // histórico — campaña ENERO172026 y anteriores
  'SÁB 11:00-13:00',
];
const HORARIOS_IMPULSA = ['LUN-MIÉ-VIE 20:00-21:00'];

export function horariosFor(tipo: string): string[] {
  if (!tipo) return [];
  if (tipo === 'IMPULSA') return HORARIOS_IMPULSA;
  if (tipo === 'DANSHI') return HORARIOS_DANSHI;
  if (tipo === 'SENPAI') return HORARIOS_SENPAI;
  return HORARIOS_MENORES; // YOJI / OKINA / KODOMO
}

// Días de la semana de los horarios → índice JS (0=Dom..6=Sáb). Tolera con/sin acento.
const DIA_SEMANA: Record<string, number> = {
  DOM: 0, LUN: 1, MAR: 2, MIE: 3, 'MIÉ': 3, JUE: 4, VIE: 5, SAB: 6, 'SÁB': 6,
};

/**
 * Parsea un horario del catálogo (ej. "LUN-MIÉ 17:00-18:00", "SÁB 09:00-11:00",
 * "LUN-MIÉ-VIE 20:00-21:00") en sus días de la semana y la hora de inicio.
 * Devuelve null si no se puede interpretar.
 */
export function parseHorario(horario: string): { dias: number[]; hora: string } | null {
  if (!horario) return null;
  const parts = String(horario).trim().split(/\s+/);
  if (parts.length < 2) return null;
  const diasTok = parts[0];
  const rango = parts[1];
  const dias = diasTok.split('-')
    .map(d => DIA_SEMANA[d.toUpperCase()])
    .filter(n => n !== undefined);
  const hora = (rango.split('-')[0] || '').trim(); // "17:00"
  if (dias.length === 0 || !/^\d{1,2}:\d{2}$/.test(hora)) return null;
  return { dias, hora };
}

/**
 * Igual que `parseHorario` pero con el RANGO completo, en minutos desde medianoche.
 * "SÁB 09:00-11:00" → { dias:[6], inicioMin:540, finMin:660 }.
 *
 * Lo usa la detección de colisiones de guía: para saber si dos cursos chocan
 * hace falta el fin, no sólo el inicio (09:00-11:00 y 10:00-12:00 se solapan
 * aunque empiecen a horas distintas).
 */
export function parseHorarioRango(horario: string): { dias: number[]; inicioMin: number; finMin: number } | null {
  if (!horario) return null;
  const parts = String(horario).trim().split(/\s+/);
  if (parts.length < 2) return null;
  const dias = parts[0].split('-')
    .map(d => DIA_SEMANA[d.toUpperCase()])
    .filter(n => n !== undefined);
  const [ini, fin] = (parts[1] || '').split('-').map(s => (s || '').trim());
  const aMin = (h: string) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(h);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const inicioMin = aMin(ini);
  const finMin = aMin(fin);
  if (!dias.length || inicioMin === null || finMin === null || finMin <= inicioMin) return null;
  return { dias, inicioMin, finMin };
}

/** ¿Dos horarios del catálogo se pisan? Comparten día Y se solapan en el tiempo. */
export function horariosSeSolapan(a: string, b: string): boolean {
  const ra = parseHorarioRango(a);
  const rb = parseHorarioRango(b);
  if (!ra || !rb) return false;
  const compartenDia = ra.dias.some(d => rb.dias.includes(d));
  if (!compartenDia) return false;
  // Solape estricto: terminar justo cuando el otro empieza NO es colisión.
  return ra.inicioMin < rb.finMin && rb.inicioMin < ra.finMin;
}

/**
 * Lista todas las fechas (YYYY-MM-DD) entre `inicio` y `fin` (inclusive) cuyo día
 * de la semana esté en `dias`. Usa aritmética UTC para evitar desfases de zona.
 */
export function fechasEntre(inicio: string, fin: string, dias: number[]): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio) || !/^\d{4}-\d{2}-\d{2}$/.test(fin)) return [];
  const set = new Set(dias);
  const out: string[] = [];
  const [iy, im, id] = inicio.split('-').map(Number);
  const [fy, fm, fd] = fin.split('-').map(Number);
  let cur = Date.UTC(iy, im - 1, id);
  const end = Date.UTC(fy, fm - 1, fd);
  let guard = 0;
  while (cur <= end && guard < 4000) {
    const d = new Date(cur);
    if (set.has(d.getUTCDay())) out.push(d.toISOString().slice(0, 10));
    cur += 86400000;
    guard++;
  }
  return out;
}

// Nombre de campaña = <MES><DD><AAAA> (mes en letras, día y año en números).
const MESES_ES: Record<string, number> = {
  ENERO: 1, FEBRERO: 2, MARZO: 3, ABRIL: 4, MAYO: 5, JUNIO: 6,
  JULIO: 7, AGOSTO: 8, SEPTIEMBRE: 9, OCTUBRE: 10, NOVIEMBRE: 11, DICIEMBRE: 12,
};

/**
 * "AGOSTO172026" → "2026-08-17"; "JUNIO082026" → "2026-06-08". null si no parsea.
 * Tolera el sufijo de marca `M` (MOSAICO) o `I` (IMPULSA) tras el año, ej.
 * "AGOSTO172026M" / "AGOSTO102026I".
 */
export function campaignNameToDate(name: string): string | null {
  const m = String(name || '').toUpperCase().replace(/(\d{4})[A-Z]$/, '$1').match(/^([A-Z]+)(\d{1,2})(\d{4})$/);
  if (!m) return null;
  const mes = MESES_ES[m[1]];
  if (!mes) return null;
  const dia = parseInt(m[2], 10), anio = parseInt(m[3], 10);
  if (!dia || dia > 31) return null;
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/**
 * Cursos visibles en Crear Contrato según la casilla EXTEMPORÁNEA.
 * - NO extemporánea → solo cursos de campañas "En matrícula" (`matriculaAbierta`,
 *   que incluye los 7 días de gracia tras el cierre — ver `corteMatricula`).
 * - Extemporánea → cursos "Activo" de la campaña inmediatamente ANTERIOR a la "En matrícula"
 *   (doble comparación: nombre-fecha de campaña + fechas reales; finalCampaign < inicio de la
 *   "En matrícula"), excluyendo cursos cuyo inicio fue hace MÁS de 2 semanas. Vacío si no aplica.
 */
export function cursosVisiblesContrato<T extends { campaign?: string; inicioCurso?: any; finalCurso?: any; finalCampaign?: any }>(
  rows: T[], extemporanea: boolean, now: Date = new Date()
): T[] {
  const hoy = hoyEnChile(now);
  const sl = soloFecha;
  const fcamp = (r: T) => sl(r.finalCampaign);
  const fcurso = (r: T) => sl(r.finalCurso);
  const ini = (r: T) => sl(r.inicioCurso);

  if (!extemporanea) {
    return rows.filter(r => matriculaAbierta(r.finalCampaign, now));
  }

  // Agregado por campaña
  const byCamp = new Map<string, { finalCampaign: string; nameDate: string | null; inicioMin: string }>();
  for (const r of rows) {
    const c = r.campaign; if (!c) continue;
    const i = ini(r);
    const cur = byCamp.get(c);
    if (!cur) byCamp.set(c, { finalCampaign: fcamp(r), nameDate: campaignNameToDate(c), inicioMin: i });
    else if (i && (!cur.inicioMin || i < cur.inicioMin)) cur.inicioMin = i;
  }

  // E = campaña "En matrícula". Si varias, la próxima (menor nameDate).
  const enMat = Array.from(byCamp.entries()).filter(([, v]) => matriculaAbierta(v.finalCampaign, now));
  if (enMat.length === 0) return [];
  enMat.sort((a, b) => ((a[1].nameDate || '9999') < (b[1].nameDate || '9999') ? -1 : 1));
  const [, ev] = enMat[0];
  const eInicio = ev.nameDate || ev.inicioMin; // "inicio de cursos de la campaña en matrícula"

  // Candidatas: nameDate < E.nameDate, finalCampaign < E.inicio, y con cursos Activos
  const candidatas = Array.from(byCamp.entries()).filter(([c, v]) => {
    if (ev.nameDate && v.nameDate && !(v.nameDate < ev.nameDate)) return false;
    if (eInicio && v.finalCampaign && !(v.finalCampaign < eInicio)) return false;
    return rows.some(r => r.campaign === c && estadoCurso(r, now) === 'activo');
  });
  if (candidatas.length === 0) return [];
  // Inmediatamente anterior = mayor nameDate
  candidatas.sort((a, b) => ((a[1].nameDate || '') > (b[1].nameDate || '') ? -1 : 1));
  const target = candidatas[0][0];

  // Límite: el curso no debe haber empezado hace más de 2 semanas (días de
  // calendario sobre HOY en Chile, no sobre el reloj del navegador).
  const [ly, lm, ld] = hoy.split('-').map(Number);
  const limStr = new Date(Date.UTC(ly, lm - 1, ld - 14)).toISOString().slice(0, 10);

  return rows.filter(r => r.campaign === target && fcurso(r) >= hoy && ini(r) && ini(r) >= limStr);
}

/** Suma `meses` a una fecha ISO (YYYY-MM-DD) manejando el overflow de fin de mes. */
export function addMonths(isoDate: string, meses: number): string {
  if (!isoDate || !Number.isFinite(meses)) return '';
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) return '';
  const base = new Date(Date.UTC(y, m - 1, d));
  const targetMonth = base.getUTCMonth() + meses;
  const target = new Date(Date.UTC(base.getUTCFullYear(), targetMonth, 1));
  // Ajuste de día (ej. 31 ene + 1 mes → 28/29 feb)
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

/* ────────────────────────────────────────────────────────────────────────────
 * ESTADO de un curso/campaña — En matrícula · Activo · Cerrado
 *
 * El estado NO se guarda en ninguna columna: se DERIVA de `finalCampaign`
 * (cierre de matrícula) y `finalCurso`. Antes esta regla estaba copiada en 7
 * sitios (Consulta de Cursos, Campañas ×2, ficha del guía, listado por guía,
 * dashboard y el wizard de contratos) y ya divergían entre sí — una evaluaba
 * las condiciones en orden invertido y el dashboard calculaba "hoy" en hora de
 * Bogotá. Con un corte a las 09:00 esa diferencia deja de ser inofensiva, así
 * que la regla vive AQUÍ y sólo aquí.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Zona horaria de operación. El corte de matrícula es a las 09:00 DE CHILE. */
export const TZ_OPERACION = 'America/Santiago';

/**
 * La matrícula sigue abierta 7 días DESPUÉS del cierre (`finalCampaign`), y se
 * cierra a las 09:00 del séptimo día. Es una ventana de gracia para seguir
 * matriculando cuando el curso ya arrancó.
 */
export const GRACIA_MATRICULA_DIAS = 7;
export const HORA_CIERRE_MATRICULA = 9;

export type EstadoCurso = 'matricula' | 'activo' | 'cerrado';

/** Cualquier fecha (Date, timestamptz, 'YYYY-MM-DD…') → 'YYYY-MM-DD' | ''. */
export function soloFecha(v: any): string {
  return v ? String(v).slice(0, 10) : '';
}

/**
 * "Ahora" en hora de Chile como `'YYYY-MM-DDTHH:mm'`, comparable como STRING.
 *
 * Se formatea en vez de operar con `Date` porque el navegador de cada usuario
 * está en su propia zona: si comparáramos contra un `new Date()` local, en
 * Colombia el corte caería a las 08:00 chilenas.
 */
export function ahoraEnChile(now: Date = new Date()): string {
  const p: any = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ_OPERACION,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now).reduce((acc: any, x) => (acc[x.type] = x.value, acc), {});
  // `hour12:false` devuelve '24' a medianoche en algunos runtimes.
  const hh = p.hour === '24' ? '00' : p.hour;
  return `${p.year}-${p.month}-${p.day}T${hh}:${p.minute}`;
}

/** Fecha de HOY en Chile ('YYYY-MM-DD'). */
export function hoyEnChile(now: Date = new Date()): string {
  return ahoraEnChile(now).slice(0, 10);
}

/**
 * Instante en que la matrícula deja de estar abierta:
 * `finalCampaign + GRACIA_MATRICULA_DIAS` a las 09:00 de Chile.
 * Devuelve `'YYYY-MM-DDTHH:mm'` (comparable con `ahoraEnChile`) o '' si no hay
 * cierre definido.
 *
 * Los días se suman en UTC a propósito: sólo se está corriendo un número de
 * calendario, así que el cambio de horario de Chile no debe alterarlo.
 */
export function corteMatricula(finalCampaign: any): string {
  const f = soloFecha(finalCampaign);
  if (!f) return '';
  const [y, m, d] = f.split('-').map(Number);
  if (!y || !m || !d) return '';
  const dt = new Date(Date.UTC(y, m - 1, d + GRACIA_MATRICULA_DIAS));
  return `${dt.toISOString().slice(0, 10)}T${String(HORA_CIERRE_MATRICULA).padStart(2, '0')}:00`;
}

/** ¿La matrícula de esa campaña sigue abierta AHORA? */
export function matriculaAbierta(finalCampaign: any, now: Date = new Date()): boolean {
  const corte = corteMatricula(finalCampaign);
  return !!corte && ahoraEnChile(now) < corte;
}

/**
 * Estado derivado de un curso. El orden importa: un curso que ya TERMINÓ está
 * cerrado aunque su cierre de matrícula fuera ayer.
 */
export function estadoCurso(
  row: { finalCampaign?: any; finalCurso?: any },
  now: Date = new Date()
): EstadoCurso {
  const fc = soloFecha(row.finalCurso);
  if (fc && fc < hoyEnChile(now)) return 'cerrado';
  if (matriculaAbierta(row.finalCampaign, now)) return 'matricula';
  return 'activo';
}

/** Etiquetas y colores del badge de estado (idénticos en todas las pantallas). */
export const ESTADO_CURSO_META: Record<EstadoCurso, { label: string; cls: string }> = {
  matricula: { label: 'En matrícula', cls: 'bg-blue-100 text-blue-700' },
  activo: { label: 'Activo', cls: 'bg-green-100 text-green-700' },
  cerrado: { label: 'Cerrado', cls: 'bg-gray-200 text-gray-700' },
};
