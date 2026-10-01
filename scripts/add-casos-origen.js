/**
 * ORIGEN de los Casos de Atención — quién levantó el caso.
 *
 *   CASOS_ATENCION."origen"  VARCHAR(20) DEFAULT 'DOCENTE' — origen del reporte que lo abrió
 *   CASOS_REPORTES."origen"  VARCHAR(20) DEFAULT 'DOCENTE' — origen de cada reporte
 *
 * Valores: DOCENTE (el guía desde su sesión) · SERVICIO · ASIST_ACADEM · NIVELACION ·
 * COORD_ACADEM · FINANZAS (el equipo, con «Adicionar caso» desde su pestaña). La
 * pestaña Casos de Atención se parte con esto en Docentes y Admin.
 *
 * Backfill: hasta hoy el único alta que no era del guía era la de Servicio, y se
 * reconoce porque deja `registradoPor` (quién lo tecleó). Esos reportes —y los
 * casos que abrieron— quedan como SERVICIO; el resto como DOCENTE.
 *
 * ⚠ `lock_timeout`: un ALTER pide lock exclusivo; si espera detrás de una
 * consulta larga encola a producción entera. Con el timeout falla y se reintenta.
 *
 * Uso: node scripts/add-casos-origen.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local', quiet: true });

const APPLY = process.argv.includes('--apply');
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

(async () => {
  const { rows: cols } = await pool.query(
    `SELECT table_name FROM information_schema.columns
      WHERE column_name = 'origen' AND table_name IN ('CASOS_ATENCION','CASOS_REPORTES')`
  );
  const ya = new Set(cols.map(c => c.table_name));
  const { rows: [r] } = await pool.query(
    `SELECT (SELECT COUNT(*) FROM "CASOS_REPORTES" WHERE "registradoPor" IS NOT NULL)::int AS reportes_servicio,
            (SELECT COUNT(DISTINCT "casoId") FROM "CASOS_REPORTES" WHERE "registradoPor" IS NOT NULL AND "abrioCaso")::int AS casos_servicio,
            (SELECT COUNT(*) FROM "CASOS_ATENCION")::int AS casos`
  );
  console.log(`Columnas: CASOS_ATENCION ${ya.has('CASOS_ATENCION') ? 'ya existe' : 'falta'} · CASOS_REPORTES ${ya.has('CASOS_REPORTES') ? 'ya existe' : 'falta'}`);
  console.log(`Casos: ${r.casos} (${r.casos_servicio} abiertos por Servicio) · reportes de Servicio: ${r.reportes_servicio}`);

  if (!APPLY) { console.log('\n(dry-run) Reejecuta con --apply.'); await pool.end(); return; }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL lock_timeout = '5s'`);
    await client.query(`ALTER TABLE "CASOS_ATENCION" ADD COLUMN IF NOT EXISTS "origen" VARCHAR(20) DEFAULT 'DOCENTE'`);
    await client.query(`ALTER TABLE "CASOS_REPORTES" ADD COLUMN IF NOT EXISTS "origen" VARCHAR(20) DEFAULT 'DOCENTE'`);
    const rep = await client.query(
      `UPDATE "CASOS_REPORTES" SET "origen" = 'SERVICIO'
        WHERE "registradoPor" IS NOT NULL AND COALESCE("origen",'DOCENTE') = 'DOCENTE'`
    );
    const cas = await client.query(
      `UPDATE "CASOS_ATENCION" ca SET "origen" = 'SERVICIO'
        WHERE COALESCE(ca."origen",'DOCENTE') = 'DOCENTE'
          AND EXISTS (SELECT 1 FROM "CASOS_REPORTES" r
                       WHERE r."casoId" = ca."_id" AND r."abrioCaso" AND r."registradoPor" IS NOT NULL)`
    );
    await client.query('COMMIT');
    console.log(`\n✅ Columnas listas · ${rep.rowCount} reporte(s) y ${cas.rowCount} caso(s) marcados como SERVICIO.`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
