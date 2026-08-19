/**
 * Copia los permisos del rol COMERCIAL al rol COMERCIAL_LIDER.
 *
 * COMERCIAL_LIDER ya existe en ROL_PERMISOS pero quedó con la lista vacía, así que
 * quien lo tenga no ve nada. Esto le pone EXACTAMENTE los mismos permisos que
 * COMERCIAL; de ahí en adelante se ajusta en /admin/permissions.
 *
 * Idempotente: si ya los tiene idénticos, no escribe. Si el rol no existiera, lo
 * crea. No toca el enum `Role` del código — el RBAC carga los permisos de esta
 * tabla, así que un usuario con rol='COMERCIAL_LIDER' los obtiene sin deploy.
 *
 * Uso: node scripts/copiar-permisos-comercial-lider.js [--apply]
 */
const { randomUUID } = require('crypto');
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const ORIGEN = 'COMERCIAL';
const DESTINO = 'COMERCIAL_LIDER';
const APPLY = process.argv.includes('--apply');

const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

const lista = (v) => (Array.isArray(v) ? v : []).slice().sort();
const iguales = (a, b) => JSON.stringify(lista(a)) === JSON.stringify(lista(b));

(async () => {
  console.log(APPLY ? '\n=== APLICANDO ===\n' : '\n=== DRY-RUN (usa --apply) ===\n');

  const src = (await pool.query(
    `SELECT "permisos" FROM "ROL_PERMISOS" WHERE "rol"=$1 LIMIT 1`, [ORIGEN])).rows[0];
  if (!src) { console.error(`  No existe el rol ${ORIGEN}.`); process.exit(1); }

  const dst = (await pool.query(
    `SELECT "permisos","descripcion","activo" FROM "ROL_PERMISOS" WHERE "rol"=$1 LIMIT 1`, [DESTINO])).rows[0];

  console.log(`  ${ORIGEN}: ${lista(src.permisos).length} permisos`);
  console.log(`  ${DESTINO}: ${dst ? `${lista(dst.permisos).length} permisos (existe)` : 'no existe — se crearía'}`);

  if (dst && iguales(src.permisos, dst.permisos)) {
    console.log('\n  Ya son idénticos: nada que hacer.\n');
    await pool.end(); return;
  }

  // Qué gana / qué pierde, para que el cambio sea visible antes de aplicarlo.
  const a = new Set(lista(src.permisos));
  const b = new Set(lista(dst?.permisos));
  const gana = [...a].filter(x => !b.has(x));
  const pierde = [...b].filter(x => !a.has(x));
  if (gana.length) { console.log(`\n  Gana ${gana.length}:`); gana.forEach(x => console.log('    +', x)); }
  if (pierde.length) { console.log(`\n  ⚠ Pierde ${pierde.length}:`); pierde.forEach(x => console.log('    -', x)); }

  if (!APPLY) { console.log('\n  (dry-run: no se escribió nada)\n'); await pool.end(); return; }

  if (dst) {
    await pool.query(
      `UPDATE "ROL_PERMISOS"
          SET "permisos" = (SELECT "permisos" FROM "ROL_PERMISOS" WHERE "rol"=$1),
              "fechaActualizacion" = NOW(), "_updatedDate" = NOW()
        WHERE "rol"=$2`, [ORIGEN, DESTINO]);
  } else {
    await pool.query(
      `INSERT INTO "ROL_PERMISOS" ("_id","rol","descripcion","permisos","activo",
                                   "fechaCreacion","fechaActualizacion","_createdDate","_updatedDate","origen")
       SELECT $1,$2,'Líder Comercial (copiado de COMERCIAL)',"permisos",true,NOW(),NOW(),NOW(),NOW(),'ADMIN'
         FROM "ROL_PERMISOS" WHERE "rol"=$3`,
      [randomUUID(), DESTINO, ORIGEN]);
  }

  const fin = (await pool.query(
    `SELECT "rol","activo", jsonb_array_length("permisos") n FROM "ROL_PERMISOS"
      WHERE "rol" IN ($1,$2) ORDER BY "rol"`, [ORIGEN, DESTINO])).rows;
  console.table(fin);
  console.log('\n  ⚠ El caché de permisos dura 5 min: quien tenga sesión abierta debe volver a entrar.\n');
  await pool.end();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
