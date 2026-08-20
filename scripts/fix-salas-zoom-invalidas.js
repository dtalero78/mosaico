/**
 * Guías cuya "sala de Zoom" no es una sala — el alumno hace clic y no entra.
 *
 * Detectado en producción: una guía tenía guardado el enlace de **chat directo**
 * (`…/launch/chat?…&email=…`), que abre "Enviar solicitud de contacto" en vez de
 * la clase; otra, la portada `zoom.com`; y otro, el enlace `/s/` con el que el
 * ANFITRIÓN inicia la reunión, que no sirve como invitación.
 *
 * Qué repara y qué no:
 *   · `/s/<id>` → `/j/<id>` es la MISMA reunión vista desde el lado del invitado,
 *     así que se corrige sola.
 *   · Un enlace de chat o la portada NO llevan ningún identificador de sala: no
 *     hay de dónde sacar la correcta y **se reportan para corregirlas a mano**.
 *     Inventar una sala sería peor que dejar el fallo a la vista.
 *
 * Lo corregido se lleva a los eventos y agendamientos **futuros** del guía: cada
 * evento guarda su copia del enlace, así que arreglar sólo la ficha no cambiaría
 * lo que abre el alumno. Los pasados se dejan: son historia.
 *
 * Idempotente. Uso: node scripts/fix-salas-zoom-invalidas.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

const HOST = /^https?:\/\/([a-z0-9-]+\.)*zoom\.us\//i;
const normalizar = (raw) => {
  const u = String(raw ?? '').trim();
  if (!u) return '';
  return u.replace(/#success$/i, '').replace(/(\/\/[^/]*zoom\.us)\/s\/(\d+)/i, '$1/j/$2');
};
const esSala = (raw) => {
  const u = normalizar(raw);
  if (!u || !HOST.test(u)) return false;
  const ruta = u.replace(HOST, '/');
  return /^\/j\/\d+/i.test(ruta) || /^\/my\/[^/?#]+/i.test(ruta);
};

(async () => {
  console.log(APPLY ? '\n=== APLICANDO ===\n' : '\n=== DRY-RUN (usa --apply) ===\n');

  const { rows: guias } = await pool.query(`
    SELECT g."_id", g."nombreCompleto", g."email", g."zoom",
           (SELECT COUNT(*)::int FROM "CALENDARIO" c
             WHERE c."advisor" = g."_id" AND c."dia" >= NOW()) "eventos futuros"
      FROM "GUIAS" g
     WHERE COALESCE(g."zoom",'') <> '' AND g."activo" IS NOT FALSE`);

  // "Mala" no es sólo la que no sirve: también la guardada en una forma que hay
  // que enderezar (el `/s/` del anfitrión, la coletilla `#success`). Filtrar por
  // la versión ya normalizada las dejaba pasar y nunca se corregían.
  const reparables = guias.filter(g => esSala(normalizar(g.zoom)) && normalizar(g.zoom) !== String(g.zoom).trim());
  const manuales   = guias.filter(g => !esSala(normalizar(g.zoom)));
  const malas = [...manuales, ...reparables];
  if (!malas.length) { console.log('  ✅ Todas las salas son válidas.\n'); await pool.end(); return; }

  console.log(`  ${malas.length} guía(s) con una sala que no sirve:\n`);
  console.table(malas.map(g => ({
    guia: g.nombreCompleto,
    zoom: String(g.zoom).slice(0, 62),
    'eventos futuros': g['eventos futuros'],
    accion: esSala(normalizar(g.zoom)) ? `→ ${normalizar(g.zoom)}` : 'CORREGIR A MANO (no hay sala deducible)',
  })));

  if (manuales.length) {
    console.log(`\n  ⚠ ${manuales.length} requieren que Académico ponga la sala correcta en la ficha del guía:`);
    for (const g of manuales) console.log(`     · ${g.nombreCompleto} <${g.email}> — ${g['eventos futuros']} clases futuras`);
    console.log('     (al guardarla, la app la lleva sola a sus clases futuras)');
  }

  if (!APPLY || !reparables.length) {
    if (!reparables.length) console.log('\n  Nada que reparar automáticamente.\n');
    else console.log('\n  (dry-run: no se escribió nada)\n');
    await pool.end();
    return;
  }

  for (const g of reparables) {
    const nuevo = normalizar(g.zoom);
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(`UPDATE "GUIAS" SET "zoom"=$2, "_updatedDate"=NOW() WHERE "_id"=$1`, [g._id, nuevo]);
      const ev = await c.query(
        `UPDATE "CALENDARIO" SET "linkZoom"=$2, "_updatedDate"=NOW()
          WHERE "advisor"=$1 AND "dia" >= NOW() RETURNING "_id"`, [g._id, nuevo]);
      const ids = ev.rows.map(r => r._id);
      let bk = { rowCount: 0 };
      if (ids.length) {
        bk = await c.query(
          `UPDATE "ACADEMICA_BOOKINGS" SET "linkZoom"=$2, "_updatedDate"=NOW()
            WHERE "eventoId" = ANY($1::text[]) OR "idEvento" = ANY($1::text[])`, [ids, nuevo]);
      }
      await c.query('COMMIT');
      console.log(`\n  ${g.nombreCompleto}: ${ev.rowCount} evento(s) y ${bk.rowCount} agendamiento(s) futuros → ${nuevo}`);
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      console.error(`  ERROR con ${g.nombreCompleto}: ${e.message}`);
    } finally { c.release(); }
  }
  console.log('');
  await pool.end();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
