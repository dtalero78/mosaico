/**
 * PEOPLE."altaMigracion" BOOLEAN DEFAULT false — marca al TITULAR de un contrato
 * dado de alta por una vía de back-office: Migrar Contrato, Importar PDF o Subir
 * Lote › Contratos. Es lo que lista la pestaña «Migración» del Centro de
 * Aprobaciones.
 *
 * Hasta ahora no había forma directa de reconocerlos: `origen` vale 'POSTGRES'
 * para todos. Lo único que los distinguía es que nacen ya LISTOS — la marca
 * `gestionContratoListo` se pone en la misma transacción que crea el titular
 * (`createFullContract` con `confirmarCupo`). El backfill usa justo eso: marca
 * puesta a menos de 2 minutos de crear el titular. Se excluyen las marcas que
 * puso el backfill de cupos de agosto (`backfill:%`), que no son altas migradas.
 *
 * De aquí en adelante la pone `createFullContract` al crear el titular.
 *
 * Uso: node scripts/add-people-alta-migracion.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local', quiet: true });

const APPLY = process.argv.includes('--apply');
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

const CANDIDATOS = `
  FROM "PEOPLE" p
 WHERE p."tipoUsuario" = 'TITULAR'
   AND p."gestionContratoListoDate" IS NOT NULL
   AND ABS(EXTRACT(EPOCH FROM p."gestionContratoListoDate" - p."_createdDate")) < 120
   AND COALESCE(p."gestionContratoListoBy", '') NOT LIKE 'backfill:%'`;

(async () => {
  const { rows: col } = await pool.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = 'PEOPLE' AND column_name = 'altaMigracion'`
  );
  const existe = col.length > 0;
  const { rows: resumen } = await pool.query(
    `SELECT COALESCE(p."aprobacion", '(sin decisión)') AS aprobacion, COUNT(*)::int AS n
     ${CANDIDATOS}
     GROUP BY 1 ORDER BY 2 DESC`
  );
  console.log(`Columna PEOPLE.altaMigracion: ${existe ? 'ya existe' : 'falta'}`);
  console.log('Titulares a marcar como migrados:');
  console.table(resumen);

  if (!APPLY) {
    console.log('\n(dry-run) Reejecuta con --apply.');
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL lock_timeout = '5s'`);
    await client.query(`ALTER TABLE "PEOPLE" ADD COLUMN IF NOT EXISTS "altaMigracion" BOOLEAN DEFAULT false`);
    const r = await client.query(
      `UPDATE "PEOPLE" SET "altaMigracion" = true
        WHERE "_id" IN (SELECT p."_id" ${CANDIDATOS})
          AND "altaMigracion" IS NOT TRUE`
    );
    await client.query('COMMIT');
    console.log(`\n✅ Columna lista, ${r.rowCount} titular(es) marcados.`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
