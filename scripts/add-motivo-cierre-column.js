// Migración idempotente: agrega CALENDARIO."motivoCierre" para auditoría
// de cómo quedó cerrada una sesión.
//
// Valores documentados (no es ENUM, sólo convención):
//   NORMAL                — Cerrado por el advisor con al menos un asistente
//   SIN_ASISTENTES        — Cerrado con N=0 asistentes (rama B del flujo nuevo)
//   GESTION_COORDINADOR   — Cerrado fuera de ventana (>+120min) por
//                            COORDINADOR_ACADEMICO / SUPER_ADMIN / ADMIN
//
// Filas existentes quedan con NULL (sesiones previas al flujo nuevo —
// no se hace backfill, sólo aplica desde aquí en adelante).
//
//   node scripts/add-motivo-cierre-column.js
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    await pool.query(`ALTER TABLE "CALENDARIO" ADD COLUMN IF NOT EXISTS "motivoCierre" VARCHAR(30)`);
    console.log('✅ Columna CALENDARIO."motivoCierre" lista (o ya existía).');

    const sample = await pool.query(
      `SELECT column_name, data_type, character_maximum_length
       FROM information_schema.columns
       WHERE table_name='CALENDARIO' AND column_name='motivoCierre'`
    );
    console.log('   Verificación schema:', sample.rows[0]);

    const count = await pool.query(
      `SELECT COUNT(*)::int total,
              COUNT("motivoCierre")::int con_motivo
       FROM "CALENDARIO"`
    );
    console.log(`   Filas en CALENDARIO: ${count.rows[0].total.toLocaleString()}`);
    console.log(`   Con motivoCierre poblado: ${count.rows[0].con_motivo.toLocaleString()} (resto NULL — esperado)`);
  } finally {
    await pool.end();
  }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
