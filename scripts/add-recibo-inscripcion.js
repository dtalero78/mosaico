/**
 * Recibo de inscripción del contrato — columnas + permiso de borrar documentación.
 *
 *   PEOPLE."reciboInscripcion"         JSONB  — el recibo vigente del titular:
 *       { url, nombre, tipo, subidoPor, subidoEn,
 *         lectura: 'OK' | 'FALLIDA' | 'PENDIENTE', lecturaError,
 *         extraido: { medioPago, fecha, monto, referencia, banco, confianza },
 *         revisadoPor, revisadoEn }          // cuando Recaudos corrige la lectura
 *   PEOPLE."reciboInscripcionHistory"  JSONB DEFAULT '[]' — los recibos reemplazados.
 *       Reemplazar NO borra el anterior: se conserva aquí (y su archivo en Spaces).
 *
 *   FINANCIEROS."recibo*"  — lo leído, en columnas tipadas (mismo modelo que LGS):
 *       reciboUrl, reciboMedioPago, reciboFecha, reciboMonto, reciboReferencia,
 *       reciboBanco, reciboExtraido (JSONB completo).
 *
 * Permiso `PERSON.INFO.ELIMINAR_DOCUMENTACION` (nuevo): se siembra a los roles que
 * hoy YA pueden borrar documentos — los que tienen `COMERCIAL.CONTRATO.MODIFICAR`,
 * que es lo que gateaba el botón de borrar en el detalle del contrato —. Así
 * nadie pierde lo que hoy puede hacer. Los otros dos permisos nuevos (subir recibo
 * y leer recibo) NO se siembran: se asignan en /admin/permissions.
 *
 * ⚠ `lock_timeout`: un ALTER TABLE pide lock exclusivo y, si espera detrás de una
 * consulta larga, TODAS las consultas de producción se encolan detrás de él (así
 * se cayó producción el 30-sep). Con el timeout, si no consigue el lock en 5 s,
 * falla y no bloquea a nadie: basta con reintentarlo.
 *
 * Uso: node scripts/add-recibo-inscripcion.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local', quiet: true });

const APPLY = process.argv.includes('--apply');
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

const COLS = [
  ['PEOPLE', 'reciboInscripcion', 'JSONB'],
  ['PEOPLE', 'reciboInscripcionHistory', `JSONB DEFAULT '[]'::jsonb`],
  ['FINANCIEROS', 'reciboUrl', 'TEXT'],
  ['FINANCIEROS', 'reciboMedioPago', 'VARCHAR(60)'],
  ['FINANCIEROS', 'reciboFecha', 'DATE'],
  ['FINANCIEROS', 'reciboMonto', 'NUMERIC(14,2)'],
  ['FINANCIEROS', 'reciboReferencia', 'VARCHAR(120)'],
  ['FINANCIEROS', 'reciboBanco', 'VARCHAR(80)'],
  ['FINANCIEROS', 'reciboExtraido', 'JSONB'],
];

const PERMISO = 'PERSON.INFO.ELIMINAR_DOCUMENTACION';
const PERMISO_BASE = 'COMERCIAL.CONTRATO.MODIFICAR';

(async () => {
  const { rows: existentes } = await pool.query(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE table_name IN ('PEOPLE','FINANCIEROS')`
  );
  const ya = new Set(existentes.map(r => `${r.table_name}.${r.column_name}`));
  const faltan = COLS.filter(([t, c]) => !ya.has(`${t}.${c}`));

  const { rows: roles } = await pool.query(
    `SELECT "rol", "permisos" FROM "ROL_PERMISOS"
      WHERE "permisos" ? $1 AND NOT ("permisos" ? $2)`,
    [PERMISO_BASE, PERMISO]
  );

  console.log(`Columnas faltantes: ${faltan.length ? faltan.map(([t, c]) => `${t}.${c}`).join(', ') : 'ninguna'}`);
  console.log(`Roles que reciben ${PERMISO}: ${roles.length ? roles.map(r => r.rol).join(', ') : 'ninguno'}`);

  if (!APPLY) {
    console.log('\n(dry-run) Reejecuta con --apply.');
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL lock_timeout = '5s'`);
    for (const [t, c, tipo] of faltan) {
      await client.query(`ALTER TABLE "${t}" ADD COLUMN IF NOT EXISTS "${c}" ${tipo}`);
    }
    for (const r of roles) {
      await client.query(
        `UPDATE "ROL_PERMISOS" SET "permisos" = "permisos" || $1::jsonb, "_updatedDate" = NOW() WHERE "rol" = $2`,
        [JSON.stringify([PERMISO]), r.rol]
      );
    }
    await client.query('COMMIT');
    console.log(`\n✅ ${faltan.length} columna(s) creada(s), permiso agregado a ${roles.length} rol(es).`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
