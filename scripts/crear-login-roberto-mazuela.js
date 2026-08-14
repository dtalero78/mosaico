/**
 * Crea la cuenta de login que le falta a ROBERTO MAZUELA (247444947).
 *
 * Caso "hermano sin login" de Fase 1: `createFullContract` deduplicaba
 * USUARIOS_ROLES por EMAIL, así que el segundo hermano que comparte el correo del
 * apoderado (aquí `alomaz60sn`, 261239760) se quedaba sin cuenta. Desde Fase 2 la
 * identidad es el `userLogin` y el email ya no es UNIQUE, así que la cuenta se
 * puede crear con el correo real.
 *
 * La clave es la PLACEHOLDER (= su número de documento, tal como está en
 * ACADEMICA.clave): al entrar, la plataforma le pedirá definir la suya.
 *
 * Idempotente: si ya existe una cuenta con ese userLogin o numberid, no hace nada.
 *
 * Uso: node scripts/crear-login-roberto-mazuela.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const USER_LOGIN = 'robmaz47aq';
const APPLY = process.argv.includes('--apply');
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

(async () => {
  const { rows: [a] } = await pool.query(
    `SELECT a."numeroId", a."userLogin", a."clave", a."email",
            a."primerNombre", a."segundoNombre", a."primerApellido", a."segundoApellido",
            p."celular", p."contrato", p."plataforma", p."aprobacion", p."email" AS people_email
       FROM "ACADEMICA" a
       LEFT JOIN "PEOPLE" p ON p."numeroId" = a."numeroId" AND p."tipoUsuario" = 'BENEFICIARIO'
      WHERE a."userLogin" = $1`, [USER_LOGIN]
  );
  if (!a) { console.error(`❌ No hay ACADEMICA con userLogin ${USER_LOGIN}`); await pool.end(); process.exit(1); }

  const { rows: dup } = await pool.query(
    `SELECT "_id","userLogin","numberid" FROM "USUARIOS_ROLES"
      WHERE "userLogin" = $1 OR UPPER(TRIM("numberid")) = UPPER(TRIM($2))`,
    [USER_LOGIN, a.numeroId]
  );
  if (dup.length) {
    console.log('✓ Ya existe la cuenta — nada que hacer:', JSON.stringify(dup));
    await pool.end();
    return;
  }

  const nombre = [a.primerNombre, a.segundoNombre].filter(Boolean).join(' ').trim();
  const apellido = [a.primerApellido, a.segundoApellido].filter(Boolean).join(' ').trim();
  const email = (a.people_email || a.email || '').trim().toLowerCase();
  // Clave placeholder: su documento. Al entrar deberá definir la suya.
  const password = (a.clave || a.numeroId || '').trim();

  console.log('Se creará la cuenta:');
  console.table([{ userLogin: USER_LOGIN, numberid: a.numeroId, nombre, apellido, email, password, rol: 'ESTUDIANTE', activo: true, contrato: a.contrato }]);

  if (!APPLY) { console.log('\n(dry-run) Reejecuta con --apply.'); await pool.end(); return; }

  const id = require('crypto').randomUUID();
  await pool.query(
    `INSERT INTO "USUARIOS_ROLES"
       ("_id","email","password","nombre","apellido","rol","activo","numberid","contrato","celular","plataforma","userLogin","_createdDate","_updatedDate")
     VALUES ($1,$2,$3,$4,$5,'ESTUDIANTE',true,$6,$7,$8,$9,$10,NOW(),NOW())`,
    [id, email, password, nombre, apellido, a.numeroId, a.contrato || null, a.celular || null, a.plataforma || null, USER_LOGIN]
  );
  const { rows: post } = await pool.query(
    `SELECT "userLogin","numberid","rol","activo","password","email" FROM "USUARIOS_ROLES" WHERE "_id" = $1`, [id]
  );
  console.log('\n✅ Cuenta creada:');
  console.table(post);
  console.log(`\nEntra con:  ${USER_LOGIN}  /  ${password}`);
  await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
