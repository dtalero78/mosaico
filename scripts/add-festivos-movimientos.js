require('dotenv').config({ path: '.env.local', quiet: true });
const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/g, ''), ssl: { rejectUnauthorized: false } });
p.query(`SET lock_timeout='5s'`)
  .then(() => p.query(`ALTER TABLE "FESTIVOS_PERSONALIZADOS" ADD COLUMN IF NOT EXISTS "movimientos" JSONB NOT NULL DEFAULT '[]'::jsonb`))
  .then(() => { console.log('columna movimientos ok'); return p.end(); });
