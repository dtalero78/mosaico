/**
 * Crea REPORTE_ACADEMICO_CIERRE: el estado del informe semanal de un SALÓN.
 *
 * Flujo:
 *   (sin fila)     = BORRADOR      → el Guía edita y guarda cuantas veces quiera.
 *   CERRADO_GUIA   → el Guía ya NO puede modificar; queda a la espera de revisión.
 *   DEFINITIVO     → cerrado tras la revisión; sólo SUPER_ADMIN puede tocarlo.
 *
 * El cierre es POR SALÓN y semana (decisión del usuario), no por estudiante, así
 * que la llave es (curso, salon, campaign, semanaInicio) — la misma combinación que
 * identifica un curso real: el mismo "Salón 06" existe en varias campañas, cada una
 * con su propio Guía.
 *
 * Vive en tabla aparte y no como columna de REPORTE_ACADEMICO_NOTAS porque el
 * estado es del SALÓN: un salón puede cerrarse aunque algún alumno no tenga fila de
 * notas, y así no hay que mantener el mismo estado replicado en N filas.
 *
 * Uso: node scripts/create-reporte-academico-cierre-table.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

const DDL = `
CREATE TABLE IF NOT EXISTS "REPORTE_ACADEMICO_CIERRE" (
  "_id"              TEXT PRIMARY KEY,
  "curso"            TEXT NOT NULL,
  "salon"            TEXT NOT NULL,
  "campaign"         TEXT NOT NULL,
  "semanaInicio"     DATE NOT NULL,
  "estado"           TEXT NOT NULL CHECK ("estado" IN ('CERRADO_GUIA','DEFINITIVO')),
  "cerradoGuiaPor"   TEXT,
  "cerradoGuiaEn"    TIMESTAMPTZ,
  "cerradoAdminPor"  TEXT,
  "cerradoAdminEn"   TIMESTAMPTZ,
  "_createdDate"     TIMESTAMPTZ DEFAULT NOW(),
  "_updatedDate"     TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT "REPORTE_ACADEMICO_CIERRE_unico" UNIQUE ("curso","salon","campaign","semanaInicio")
);
CREATE INDEX IF NOT EXISTS "idx_rep_acad_cierre_semana" ON "REPORTE_ACADEMICO_CIERRE" ("semanaInicio");
`;

(async () => {
  const { rows: pre } = await pool.query(`SELECT to_regclass('"REPORTE_ACADEMICO_CIERRE"') IS NOT NULL AS existe`);
  if (pre[0].existe) {
    const { rows: [{ n }] } = await pool.query(`SELECT COUNT(*)::int AS n FROM "REPORTE_ACADEMICO_CIERRE"`);
    console.log(`✓ La tabla ya existe (${n} fila(s)) — nada que hacer.`);
    await pool.end();
    return;
  }
  if (!APPLY) {
    console.log('(dry-run) Se ejecutaría:\n');
    console.log(DDL);
    console.log('Reejecuta con --apply para crearla.');
    await pool.end();
    return;
  }
  await pool.query(DDL);
  const { rows } = await pool.query(
    `SELECT column_name, data_type, is_nullable FROM information_schema.columns
      WHERE table_name = 'REPORTE_ACADEMICO_CIERRE' ORDER BY ordinal_position`
  );
  console.log('✅ Tabla REPORTE_ACADEMICO_CIERRE creada:');
  console.table(rows);
  console.log('\nSin filas = todos los informes existentes quedan en BORRADOR (editables).');
  await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
