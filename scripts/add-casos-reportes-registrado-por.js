/**
 * Agrega `registradoPor` / `registradoPorEmail` a CASOS_REPORTES.
 *
 * Hasta ahora el reporte SIEMPRE lo escribía el guía desde el panel de su
 * sesión, así que `guiaNombre` era a la vez el autor y quien lo capturó — el
 * mismo dato servía para las dos cosas.
 *
 * Desde que Servicio puede adicionar un caso desde su informe y **elegir a qué
 * guía se atribuye** (porque el guía lo reportó por teléfono o WhatsApp), esos
 * dos papeles se separan: `guiaNombre` es de quién es la observación y
 * `registradoPor` es quién la tecleó. Sin esta columna la atribución quedaría
 * sin rastro, que es justo lo que no puede pasar cuando un texto se firma a
 * nombre de un tercero.
 *
 * Queda NULL en los reportes que hace el propio guía: ahí no hay nada que
 * distinguir, el autor y quien captura son la misma persona.
 *
 * Idempotente. Uso: node scripts/add-casos-reportes-registrado-por.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

const DDL = [
  `ALTER TABLE "CASOS_REPORTES" ADD COLUMN IF NOT EXISTS "registradoPor" VARCHAR(255)`,
  `ALTER TABLE "CASOS_REPORTES" ADD COLUMN IF NOT EXISTS "registradoPorEmail" VARCHAR(255)`,
];

(async () => {
  const { rows } = await pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'CASOS_REPORTES' AND column_name IN ('registradoPor','registradoPorEmail')`
  );
  if (rows.length === 2) {
    console.log('✓ Las columnas ya existen — nada que hacer.');
    await pool.end();
    return;
  }

  if (!APPLY) {
    console.log('(dry-run) Se ejecutaría:\n');
    DDL.forEach((s) => console.log('  ' + s));
    console.log('\nReejecuta con --apply.');
    await pool.end();
    return;
  }

  for (const s of DDL) await pool.query(s);
  const { rows: after } = await pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'CASOS_REPORTES' AND column_name LIKE 'registradoPor%'`
  );
  console.log(`✓ Columnas agregadas: ${after.map((r) => r.column_name).join(', ')}`);
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
