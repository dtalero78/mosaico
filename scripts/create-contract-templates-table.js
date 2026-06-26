/**
 * MOSAICO — crea la tabla "ContractTemplates" (plantillas de contrato por plataforma).
 *
 * Cada fila = una plataforma (Chile / Colombia / Ecuador / Perú …) con su plantilla
 * de contrato/consentimiento en HTML/texto con {{placeholders}} (primerNombre,
 * beneficiarios, totalPlan, valorCuota, saldo, firma/consentimiento, etc.).
 *
 * La usan: GET /api/postgres/contracts/template, la página pública /contrato/[id]
 * (firma OTP), el preview admin, PersonContractViewer y la generación de PDF
 * (send-pdf / auto-approve / regenerate-drive). El código sólo lee "plataforma" y
 * "template"; el resto de columnas siguen la convención del resto de tablas.
 *
 * La tabla se crea VACÍA — la(s) plantilla(s) de MOSAICO se siembran después.
 *
 * Uso: node scripts/create-contract-templates-table.js
 * Idempotente: CREATE TABLE IF NOT EXISTS.
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

(async () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/g, ''),
    ssl: { rejectUnauthorized: false },
  });
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "ContractTemplates" (
        "_id"          VARCHAR(255) PRIMARY KEY,
        "plataforma"   VARCHAR(100),
        "template"     TEXT,
        "nombre"       VARCHAR(255),
        "descripcion"  TEXT,
        "activo"       BOOLEAN DEFAULT true,
        "_createdDate" TIMESTAMPTZ DEFAULT NOW(),
        "_updatedDate" TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log('  ✓ Tabla "ContractTemplates" lista');
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_contract_templates_plataforma ON "ContractTemplates" (LOWER("plataforma"))`);
    console.log('  ✓ Índice idx_contract_templates_plataforma (LOWER(plataforma))');
    const c = await pool.query(`SELECT COUNT(*)::int n FROM "ContractTemplates"`);
    console.log(`✅ ContractTemplates creada. Filas: ${c.rows[0].n} (vacía — sembrar plantillas luego).`);
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
