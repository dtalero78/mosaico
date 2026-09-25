/**
 * Helpers de mapeo para importar contratos (desde PDF o CSV): normalizan
 * programa→tipoCurso, horario, RUT/numeroId, fechas y el N.º de contrato al
 * formato canónico MOSAICO. Cliente + servidor (sin 'server-only').
 *
 * Réplica de la lógica del migrador CSV (scripts/migrar-contratos-csv.js) para
 * que la importación de PDF produzca exactamente lo mismo que Migrar Contrato.
 */
export const TIPOS_CURSO = ['YOJI', 'OKINA', 'KODOMO', 'DANSHI', 'SENPAI', 'IMPULSA'];

export const stripAccents = (s: any) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
export const clean = (s: any) => String(s || '').trim();
/** RUT/numeroId canónico: sin puntos/guiones/espacios, mayúsculas (RUT chileno con K). */
export const normId = (s: any) => stripAccents(s).toUpperCase().replace(/[.\s\-_]/g, '').trim();

/** "12/01/1985" o "1985-01-12" → "1985-01-12". Devuelve '' si no reconoce. */
export function parseFecha(s: any): string {
  const t = clean(s);
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return '';
}

/** "IMPULSA PAES" → "IMPULSA"; "Yoji" → "YOJI". null si no reconoce. */
export function normPrograma(s: any): string | null {
  const u = stripAccents(s).toUpperCase().replace(/[^A-Z]/g, '');
  return TIPOS_CURSO.find(t => t === u) || TIPOS_CURSO.find(t => u.startsWith(t)) || null;
}

/** "Martes & Jueves de 18:15 a 19:15hrs" → "MAR-JUE 18:15-19:15". null si no reconoce. */
export function normHorario(s: any): string | null {
  const t = stripAccents(s).toLowerCase();
  let days: string | null = null;
  if (/lun/.test(t) && /mie/.test(t) && /vie/.test(t)) days = 'LUN-MIÉ-VIE';
  else if (/lun/.test(t) && /mie/.test(t)) days = 'LUN-MIÉ';
  else if (/mar/.test(t) && /jue/.test(t)) days = 'MAR-JUE';
  else if (/sab/.test(t)) days = 'SÁB';
  const times = [...t.matchAll(/(\d{1,2}):(\d{2})/g)].map(m => `${m[1].padStart(2, '0')}:${m[2]}`);
  if (!days || times.length < 2) return null;
  return `${days} ${times[0]}-${times[1]}`;
}

/**
 * N.º de contrato canónico `01-<M5|I6>-<num>-YY` (país 01=Chile). Acepta el formato
 * corto del PDF `<seg>-<num>-<yy>` (seg 6 o esImpulsa → I6=IMPULSA, resto → M5) o un
 * número ya canónico. Devuelve el crudo si no reconoce (el usuario lo edita).
 *
 * Tolera lo que traen los PDF reales y que en sep-2026 hubo que limpiar a mano en
 * 45 contratos: el rótulo delante ("Contrato Online N.º 5-2330-26" — la IA lo
 * devuelve tal cual aunque se le pida sólo el número), el cero del país pegado al
 * segmento ("05-2271-26"), espacios entre guiones ("5 - 2321 - 26"), el año en
 * cuatro cifras y el sufijo de desdoble en el año ("5-2477-26A" → `…-2477A-26`,
 * que es donde va en la base).
 *
 * El consecutivo se conserva CON LOS DÍGITOS QUE TRAE: la base tiene los migrados
 * con 4 (`01-M5-2338-26`) y los IMPULSA con 3 (`01-I6-124-26`); rellenar a 5 creaba
 * un número distinto del de sus hermanos (`01-I6-00124-26`, agosto de 2026).
 */
export function normalizeContractNumber(raw: any, esImpulsa?: boolean): string {
  const s = clean(raw);
  if (/^0\d-(M5|I6)-\d+[A-Z]?-\d{2}$/i.test(s)) return s.toUpperCase();
  const m = s.match(/(\d{1,2})\s*-\s*(\d{3,5})\s*-\s*(\d{2,4})\s*([A-Z])?\s*$/i);
  if (m) {
    const segRaw = m[1].replace(/^0/, '');
    const seg = (segRaw === '6' || esImpulsa) ? 'I6' : 'M5';
    const num = m[2] + (m[4] ? m[4].toUpperCase() : '');
    const yy = m[3].length >= 4 ? m[3].slice(2) : m[3];
    return `01-${seg}-${num}-${yy}`;
  }
  return s;
}
