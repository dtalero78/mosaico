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
 * N.º de contrato canónico `01-<M5|I6>-NNNNN-YY` (país 01=Chile). Acepta el formato
 * corto del PDF `<seg>-<num>-<yy>` (seg 6 o esImpulsa → I6=IMPULSA, resto → M5) o un
 * número ya canónico. Devuelve el crudo si no reconoce (el usuario lo edita).
 */
export function normalizeContractNumber(raw: any, esImpulsa?: boolean): string {
  const s = clean(raw);
  if (/^0\d-(M5|I6)-\d+-\d{2}$/i.test(s)) return s.toUpperCase();
  const m = s.match(/^(\d)-(\d+)-(\d{1,4})$/);
  if (m) {
    const seg = (m[1] === '6' || esImpulsa) ? 'I6' : 'M5';
    const num = m[2].padStart(5, '0');
    let yy = m[3];
    if (yy.length >= 4) yy = yy.slice(2);
    yy = yy.padStart(2, '2').slice(-2); // "-2"→"26" no es exacto; el preview es editable
    return `01-${seg}-${num}-${yy}`;
  }
  return s;
}
