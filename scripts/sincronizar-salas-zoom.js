/**
 * Alinea el enlace de las clases FUTURAS con la sala de su guía.
 *
 * La sala vive en la ficha del guía (`GUIAS.zoom`); cada evento y cada
 * agendamiento guardan una copia. Cuando la ficha se corrige, las copias quedan
 * atrás y el alumno sigue abriendo el enlace viejo — que es exactamente cómo
 * 132 alumnos acabaron con un enlace de chat en vez de su clase.
 *
 * El código ya resuelve el enlace desde la ficha del guía al leer, así que esto
 * es para dejar las copias al día (informes, exportaciones, datos históricos) y
 * para reparar de golpe lo que quedó desalineado.
 *
 * Sólo toca clases FUTURAS: las pasadas son historia y ya nadie entra.
 * No toca eventos sin guía ni guías sin sala — ahí no hay nada que copiar.
 *
 * Idempotente. Uso: node scripts/sincronizar-salas-zoom.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

const DESALINEADOS = `
  SELECT c."_id", c."advisor", TRIM(g."zoom") AS sala, g."nombreCompleto" AS guia
    FROM "CALENDARIO" c
    JOIN "GUIAS" g ON g."_id" = c."advisor"
   WHERE c."dia" >= NOW()
     AND COALESCE(NULLIF(TRIM(g."zoom"),''),'') <> ''
     AND COALESCE(TRIM(c."linkZoom"),'') <> TRIM(g."zoom")`;

(async () => {
  console.log(APPLY ? '\n=== APLICANDO ===\n' : '\n=== DRY-RUN (usa --apply) ===\n');

  const { rows } = await pool.query(DESALINEADOS);
  if (!rows.length) { console.log('  ✅ Todas las clases futuras usan la sala de su guía.\n'); await pool.end(); return; }

  const porGuia = new Map();
  for (const r of rows) {
    const v = porGuia.get(r.advisor) || { guia: r.guia, sala: r.sala, ids: [] };
    v.ids.push(r._id); porGuia.set(r.advisor, v);
  }
  console.table([...porGuia.values()].map(v => ({
    guia: v.guia, 'sala de su ficha': v.sala, 'clases futuras a alinear': v.ids.length,
  })));

  if (!APPLY) { console.log('\n  (dry-run: no se escribió nada)\n'); await pool.end(); return; }

  for (const v of porGuia.values()) {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(`UPDATE "CALENDARIO" SET "linkZoom"=$2, "_updatedDate"=NOW() WHERE "_id" = ANY($1::text[])`,
        [v.ids, v.sala]);
      const bk = await c.query(
        `UPDATE "ACADEMICA_BOOKINGS" SET "linkZoom"=$2, "_updatedDate"=NOW()
          WHERE "eventoId" = ANY($1::text[]) OR "idEvento" = ANY($1::text[])`, [v.ids, v.sala]);
      await c.query('COMMIT');
      console.log(`  ${v.guia}: ${v.ids.length} evento(s) y ${bk.rowCount} agendamiento(s) → ${v.sala}`);
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      console.error(`  ERROR con ${v.guia}: ${e.message}`);
    } finally { c.release(); }
  }
  console.log(`\n  pendientes tras aplicar: ${(await pool.query(DESALINEADOS)).rows.length}\n`);
  await pool.end();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
