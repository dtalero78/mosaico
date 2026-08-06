/**
 * MOSAICO — backfill de módulo/lección en los eventos IMPULSA.
 *
 * Los eventos IMPULSA se materializaron con `nivel='IMPULSA'` pero SIN
 * `sesionModulo`/`sesionLeccion` (ni step), así que la pestaña "Material" de
 * /sesion/[id] no encuentra el material (que está por Modulo/Leccion) y el
 * display muestra "Módulo: IMPULSA · Lección: —".
 *
 * Mapea por TIPO en secuencia (por curso/campaña):
 *   SESSION       (por fecha) → lecciones "Modulo NN"      (por orden)
 *   ENTRENAMIENTO (por fecha) → lecciones "Entrenamiento"  (por orden)
 *   EVALUACION    (por fecha) → lecciones "Evaluación/Evaluac" (por orden)
 * WELCOME se deja intacto. Setea sesionModulo=code, sesionLeccion=step.
 * Idempotente (re-ejecutar reasigna igual). Uso: node scripts/backfill-impulsa-sesion-leccion.js [--apply]
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const APPLY = process.argv.includes('--apply');

// Categoría de un code de NIVELES / tipo de evento.
const catLeccion = (code) => {
  const c = String(code || '').toLowerCase();
  if (/entren/.test(c)) return 'ENTREN';
  if (/evaluac/.test(c)) return 'EVALUAC';
  return 'MODULO';
};
const catEvento = (tipo) => {
  const t = String(tipo || '').toUpperCase();
  if (t === 'ENTRENAMIENTO') return 'ENTREN';
  if (t === 'EVALUACION') return 'EVALUAC';
  if (t === 'SESSION' || t === 'SESION') return 'MODULO';
  return null; // WELCOME u otros → no se tocan
};

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/g, ''), ssl: { rejectUnauthorized: false } });

  // Lecciones IMPULSA por orden, agrupadas por categoría.
  const nv = (await pool.query(
    `SELECT "code","step","orden" FROM "NIVELES" WHERE UPPER("curso")='IMPULSA' ORDER BY "orden" ASC`
  )).rows;
  const lecciones = { MODULO: [], ENTREN: [], EVALUAC: [] };
  for (const l of nv) lecciones[catLeccion(l.code)].push(l);
  console.log(`Lecciones NIVELES IMPULSA: MODULO=${lecciones.MODULO.length} ENTREN=${lecciones.ENTREN.length} EVALUAC=${lecciones.EVALUAC.length}`);

  // Eventos IMPULSA por fecha (excluye WELCOME).
  const ev = (await pool.query(
    `SELECT "_id","tipo","dia","sesionModulo","sesionLeccion" FROM "CALENDARIO"
      WHERE UPPER("nivel")='IMPULSA' ORDER BY "dia" ASC, "_id" ASC`
  )).rows;

  const cursor = { MODULO: 0, ENTREN: 0, EVALUAC: 0 };
  let cambios = 0, sinLeccion = 0;
  for (const e of ev) {
    const cat = catEvento(e.tipo);
    if (!cat) continue; // WELCOME
    const lista = lecciones[cat];
    const idx = cursor[cat]++;
    const lec = lista[idx];
    if (!lec) { sinLeccion++; continue; } // más eventos que lecciones de ese tipo
    if (e.sesionModulo === lec.code && e.sesionLeccion === lec.step) continue; // ya OK
    cambios++;
    console.log(`  ${APPLY ? '✓' : '·'} ${String(e.tipo).padEnd(13)} ${e.dia && e.dia.toISOString().slice(0,10)} → ${lec.code} / ${lec.step}`);
    if (APPLY) {
      await pool.query(
        `UPDATE "CALENDARIO" SET "sesionModulo"=$2,"sesionLeccion"=$3,"_updatedDate"=NOW() WHERE "_id"=$1`,
        [e._id, lec.code, lec.step]
      );
    }
  }
  console.log(`\n${APPLY ? '✅ Aplicado' : '(dry-run)'}: ${cambios} evento(s) mapeado(s)${sinLeccion ? `, ${sinLeccion} sin lección disponible (más eventos que lecciones de su tipo)` : ''}.`);
  if (!APPLY) console.log('   --apply para escribir.');
  await pool.end();
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
