/**
 * MOSAICO — repara el login de un alumno que no tenía cuenta propia y cuya clave
 * quedó guardada en la cuenta de su HERMANO (mismo correo del apoderado).
 *
 * Origen: "Clave Login" de la ficha guardaba la clave en USUARIOS_ROLES buscando
 * por CORREO (corregido el 13-oct-2026). Sin cuenta propia, la única con ese correo
 * era la del hermano, y la clave terminaba sólo ahí.
 *
 *   --alumno=<documento>    crea su cuenta (userLogin y clave de SU ficha académica,
 *                           correo real del apoderado, activa si su contrato lo está)
 *   --hermano=<documento>   (opcional) devuelve a la cuenta del hermano la clave de SU ficha
 *
 * Sin --hermano sirve para cualquier alumno aprobado que se quedó sin cuenta. Si PEOPLE
 * guarda un userLogin distinto del de ACADEMICA, se alinea al de ACADEMICA.
 *
 * Copia previa en PURGE_LOG (CORRECCION_LOGIN_HERMANO). No imprime claves.
 * Ensayo por defecto; --apply para escribir. Idempotente.
 *   node scripts/reparar-login-hermano.js --alumno=249016012 --hermano=27170125K [--apply]
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config({ path: '.env.local', quiet: true });
const { Pool } = require('pg');
const { randomUUID } = require('crypto');

const APPLY = process.argv.includes('--apply');
const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=').slice(1).join('=').trim();
const ALUMNO = arg('alumno');
const HERMANO = arg('hermano');
if (!ALUMNO) { console.error('Falta --alumno=<documento>'); process.exit(1); }

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/g, ''), ssl: { rejectUnauthorized: false }, max: 1 });
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SET LOCAL lock_timeout = '5s'`);
    const ficha = async (doc) => (await c.query(
      `SELECT a."_id", a."numeroId", a."userLogin", a."clave", a."email", a."primerNombre", a."primerApellido", a."contrato", a."plataforma", a."celular",
              p."estadoInactivo", p."aprobacion", p."_id" AS "peopleId", p."userLogin" AS "peopleUserLogin"
         FROM "ACADEMICA" a
         LEFT JOIN "PEOPLE" p ON p."numeroId" = a."numeroId" AND p."tipoUsuario" IN ('BENEFICIARIO','BENEFICIARIA')
        WHERE UPPER(a."numeroId") = UPPER($1) LIMIT 1`, [doc])).rows[0];

    const al = await ficha(ALUMNO);
    if (!al) throw new Error(`No hay ficha académica para ${ALUMNO}`);
    if (!al.userLogin) throw new Error(`${ALUMNO} no tiene usuario de ingreso en su ficha`);
    if (!al.clave) throw new Error(`${ALUMNO} no tiene clave en su ficha`);
    const yaTiene = (await c.query(`SELECT "_id" FROM "USUARIOS_ROLES" WHERE "userLogin" = $1 OR UPPER(TRIM("numberid")) = UPPER($2)`,
      [al.userLogin, al.numeroId])).rows[0];
    const activo = al.estadoInactivo !== true;
    console.log(`Alumno: ${al.primerNombre} ${al.primerApellido} (${al.numeroId}) · usuario ${al.userLogin}`);
    console.log(yaTiene ? '  ya tiene cuenta propia: no se crea' : `  se CREA su cuenta · correo ${al.email} · activa ${activo} · clave = la de su ficha`);
    // El usuario de ingreso es el de la ficha ACADÉMICA (con él resuelve el panel); si
    // PEOPLE guarda otro, se alinea para no dejar dos usuarios para la misma alumna.
    const alinearPeople = !!(al.peopleId && al.peopleUserLogin && al.peopleUserLogin !== al.userLogin);
    if (alinearPeople) console.log(`  PEOPLE tiene otro usuario (${al.peopleUserLogin}) → se alinea a ${al.userLogin}`);

    let her = null, cuentaHer = null;
    if (HERMANO) {
      her = await ficha(HERMANO);
      if (!her || !her.userLogin) throw new Error(`No hay ficha con usuario para el hermano ${HERMANO}`);
      cuentaHer = (await c.query(`SELECT "_id","password" FROM "USUARIOS_ROLES" WHERE "userLogin" = $1`, [her.userLogin])).rows[0];
      if (!cuentaHer) throw new Error(`El hermano ${HERMANO} no tiene cuenta`);
      const igualAlAlumno = cuentaHer.password === al.clave;
      const yaEsSuya = cuentaHer.password === her.clave;
      console.log(`Hermano: ${her.primerNombre} ${her.primerApellido} · usuario ${her.userLogin}`);
      console.log(`  su cuenta tiene hoy ${igualAlAlumno ? 'la clave del ALUMNO' : yaEsSuya ? 'su propia clave' : 'otra clave'}` +
        (yaEsSuya ? ' → no se toca' : ' → se le pone la clave de SU ficha'));
      if (yaEsSuya) cuentaHer = null;
    }

    if (!APPLY) { await c.query('ROLLBACK'); console.log('\nEnsayo. Usa --apply para escribir.'); return; }

    await c.query(
      `INSERT INTO "PURGE_LOG" ("_id","tipoPurga","contrato","snapshot","motivo","realizadoPor","filasBorradas","_createdDate")
       VALUES ($1,'CORRECCION_LOGIN_HERMANO',$2,$3::jsonb,$4,'script:reparar-login-hermano',$5::jsonb,NOW())`,
      ['plg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 11), al.contrato,
       JSON.stringify({ alumno: { numeroId: al.numeroId, userLogin: al.userLogin, teniaCuenta: !!yaTiene,
                                  peopleUserLoginAnterior: alinearPeople ? al.peopleUserLogin : undefined },
                        hermano: cuentaHer ? { numeroId: her.numeroId, userLogin: her.userLogin, cuentaId: cuentaHer._id, passwordAnterior: cuentaHer.password } : null }),
       'La clave del alumno quedó en la cuenta del hermano (Clave Login guardaba por correo)',
       JSON.stringify({ cuentaCreada: !yaTiene, claveHermanoRestaurada: !!cuentaHer })]);

    if (!yaTiene) {
      await c.query(
        `INSERT INTO "USUARIOS_ROLES" ("_id","email","password","nombre","rol","activo","numberid","contrato","plataforma","celular","userLogin","origen","_createdDate","_updatedDate")
         VALUES ($1,$2,$3,$4,'ESTUDIANTE',$5,$6,$7,$8,$9,$10,'ADMIN',NOW(),NOW())`,
        [randomUUID(), String(al.email || `${al.userLogin}@est.mosaico.cl`).trim().toLowerCase(), al.clave,
         `${al.primerNombre || ''} ${al.primerApellido || ''}`.replace(/\s+/g, ' ').trim(), activo, al.numeroId, al.contrato, al.plataforma, al.celular, al.userLogin]);
    }
    if (alinearPeople) {
      await c.query(`UPDATE "PEOPLE" SET "userLogin" = $2, "_updatedDate" = NOW() WHERE "_id" = $1`, [al.peopleId, al.userLogin]);
    }
    if (cuentaHer) {
      await c.query(`UPDATE "USUARIOS_ROLES" SET "password" = $2, "_updatedDate" = NOW() WHERE "_id" = $1`, [cuentaHer._id, her.clave]);
    }
    await c.query('COMMIT');
    console.log('\n✓ Aplicado.');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { c.release(); await pool.end(); }
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
