/**
 * El cupo del salón deja de ocuparse al CREAR el contrato y pasa a ocuparse
 * cuando Comercial lo marca "listo" en Gestión Contrato.
 *
 * Agrega a PEOPLE (beneficiario):
 *   "cupoConfirmado"        BOOLEAN DEFAULT false  — true = ocupa cupo de verdad
 *   "cupoConfirmadoPor"     TEXT                   — quién lo confirmó
 *   "cupoConfirmadoEn"      TIMESTAMPTZ            — cuándo
 *   "sobrecupoAutorizado"   BOOLEAN DEFAULT false  — se confirmó con el salón lleno
 *   "sobrecupoAutorizadoPor" TEXT
 *   "sobrecupoAutorizadoEn"  TIMESTAMPTZ
 *
 * ⚠ NO se reutiliza `gestionContratoListo` como señal de cupo: sólo 1 titular lo
 * tiene marcado en toda la base y hay 462 contratos APROBADOS que nunca pasaron
 * por esa bandeja — colgar el cupo de ahí les quitaría el asiento de golpe.
 *
 * BACKFILL (para que el día del deploy no se mueva ni un contador):
 *   1. `cupoConfirmado = true` a TODOS los beneficiarios que HOY ocupan cupo,
 *      con la misma regla de `src/lib/cupo.ts`. Los salones quedan idénticos,
 *      incluidos los 3 que ya están en sobrecupo.
 *   2. `gestionContratoListo = true` a los titulares YA APROBADOS. Como aprobar
 *      pasa a exigir que el contrato esté listo, sin esto los contratos viejos
 *      no podrían recibir un beneficiario nuevo ni re-aprobarse.
 *
 * Uso: node scripts/add-cupo-confirmado-columns.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

const COLUMNAS = [
  'cupoConfirmado', 'cupoConfirmadoPor', 'cupoConfirmadoEn',
  'sobrecupoAutorizado', 'sobrecupoAutorizadoPor', 'sobrecupoAutorizadoEn',
];

const DDL = `
ALTER TABLE "PEOPLE" ADD COLUMN IF NOT EXISTS "cupoConfirmado"         BOOLEAN DEFAULT false;
ALTER TABLE "PEOPLE" ADD COLUMN IF NOT EXISTS "cupoConfirmadoPor"      TEXT;
ALTER TABLE "PEOPLE" ADD COLUMN IF NOT EXISTS "cupoConfirmadoEn"       TIMESTAMPTZ;
ALTER TABLE "PEOPLE" ADD COLUMN IF NOT EXISTS "sobrecupoAutorizado"    BOOLEAN DEFAULT false;
ALTER TABLE "PEOPLE" ADD COLUMN IF NOT EXISTS "sobrecupoAutorizadoPor" TEXT;
ALTER TABLE "PEOPLE" ADD COLUMN IF NOT EXISTS "sobrecupoAutorizadoEn"  TIMESTAMPTZ;
UPDATE "PEOPLE" SET "cupoConfirmado"      = false WHERE "cupoConfirmado" IS NULL;
UPDATE "PEOPLE" SET "sobrecupoAutorizado" = false WHERE "sobrecupoAutorizado" IS NULL;
`;

/**
 * La regla de ocupación ANTERIOR al cambio (sin `cupoConfirmado`), copiada aquí a
 * propósito: el backfill tiene que congelar la foto de HOY, no seguir la regla
 * nueva — que exige justamente la columna que estamos creando.
 */
const OCUPA_HOY = `(pe."fechaOnHold" IS NULL
  AND pe."cupoLiberado" IS NOT TRUE
  AND NOT (pe."estadoInactivo" IS TRUE AND COALESCE(pe."suspenddata"->>'accion', '') = 'INACTIVACION')
  AND NOT EXISTS (
    SELECT 1 FROM "PEOPLE" t WHERE t."contrato" = pe."contrato" AND t."tipoUsuario" = 'TITULAR'
      AND LOWER(TRIM(COALESCE(t."aprobacion", ''))) IN ('devuelto','rechazado','retractado','contrato nulo')))`;

const SQL_BACKFILL_CUPO = `
  UPDATE "PEOPLE" pe
     SET "cupoConfirmado" = true,
         "cupoConfirmadoPor" = 'backfill:migracion-cupo-confirmado',
         "cupoConfirmadoEn" = NOW()
   WHERE pe."tipoUsuario" = 'BENEFICIARIO'
     AND pe."cupoConfirmado" IS NOT TRUE
     AND ${OCUPA_HOY}`;

const SQL_BACKFILL_LISTO = `
  UPDATE "PEOPLE"
     SET "gestionContratoListo" = true,
         "gestionContratoListoBy" = COALESCE("gestionContratoListoBy", 'backfill:migracion-cupo-confirmado'),
         "gestionContratoListoDate" = COALESCE("gestionContratoListoDate", NOW())
   WHERE "tipoUsuario" = 'TITULAR'
     AND COALESCE("gestionContratoListo", false) = false
     AND LOWER(TRIM(COALESCE("aprobacion", ''))) IN ('aprobado','aprobada')`;

(async () => {
  const { rows: pre } = await pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'PEOPLE' AND column_name = ANY($1)`, [COLUMNAS]
  );
  const faltan = COLUMNAS.filter(c => !pre.some(r => r.column_name === c));

  if (faltan.length) console.log(`Columnas por crear: ${faltan.join(', ')}`);
  else console.log('✓ Las 6 columnas ya existen.');

  // Conteos del impacto (funcionan existan o no las columnas: el WHERE las
  // referencia sólo si ya están creadas).
  const cuenta = async (sql, params = []) => {
    try { const { rows } = await pool.query(sql, params); return Number(rows[0]?.n ?? 0); }
    catch { return null; }
  };

  const aConfirmar = faltan.length
    ? await cuenta(`SELECT COUNT(*)::int AS n FROM "PEOPLE" pe WHERE pe."tipoUsuario"='BENEFICIARIO' AND ${OCUPA_HOY}`)
    : await cuenta(`SELECT COUNT(*)::int AS n FROM "PEOPLE" pe WHERE pe."tipoUsuario"='BENEFICIARIO'
                      AND pe."cupoConfirmado" IS NOT TRUE AND ${OCUPA_HOY}`);
  const aListo = await cuenta(
    `SELECT COUNT(*)::int AS n FROM "PEOPLE" WHERE "tipoUsuario"='TITULAR'
       AND COALESCE("gestionContratoListo", false) = false
       AND LOWER(TRIM(COALESCE("aprobacion",''))) IN ('aprobado','aprobada')`);

  console.log(`\nBeneficiarios que hoy ocupan cupo y quedarían confirmados: ${aConfirmar}`);
  console.log(`Titulares ya aprobados que quedarían marcados listos:      ${aListo}`);

  if (!APPLY) {
    console.log('\n(dry-run — nada se escribió. Volvé a correr con --apply)');
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(DDL);
    const r1 = await client.query(SQL_BACKFILL_CUPO);
    const r2 = await client.query(SQL_BACKFILL_LISTO);
    await client.query('COMMIT');
    console.log(`\n✓ Columnas listas.`);
    console.log(`✓ ${r1.rowCount} beneficiario(s) con el cupo confirmado.`);
    console.log(`✓ ${r2.rowCount} titular(es) aprobado(s) marcados como listos.`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('✗ Falló, no se escribió nada:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})().catch(e => { console.error(e.message); process.exit(1); });
