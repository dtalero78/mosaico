/**
 * MOSAICO — repara el login de 7 beneficiarios aprobados en WELCOME (campañas de
 * agosto) que por compartir email de apoderado quedaron SIN cuenta o con userLogin
 * desalineado. Deja cada uno con:
 *   - userLogin = el de su ACADEMICA (el que conoce el alumno; verificado libre)
 *   - email     = el real si no está tomado por OTRA cuenta; si no, sintético
 *                 `<userLogin>@est.mosaico.cl`
 *   - password  = ACADEMICA.clave si existe, si no el numeroId (placeholder)
 *   - rol=ESTUDIANTE, activo = !PEOPLE.estadoInactivo, numberid/contrato/plataforma.
 * Si YA existe una cuenta con ese userLogin → no toca. Si existe por numberid con
 * userLogin distinto (desajuste) → la ALINEA (UPDATE). Si no existe → la crea (INSERT).
 * Idempotente. Uso: node scripts/fix-welcome-logins-agosto.js [--apply]
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const { randomUUID } = require('crypto');
const APPLY = process.argv.includes('--apply');
const NORM = "REPLACE(REPLACE(REPLACE(:c,'.',''),'-',''),' ','')".replace(':c', '');
// numeroIds tal cual están en ACADEMICA (se normaliza en SQL).
// Primer bloque: los 7 detectados. Segundo bloque: 5 hermanos cuyos userLogin
// estaban "prestados" a los 7 y quedaron sin cuenta propia (revelados al reparar).
const IDS = [
  '249957062', '24.680.258-0', '246920664', '241560139', '237362284', '251924740', '260494589',
  '251097542', '145004950', '247048421', '265538231', '271639104',
];

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/g, ''), ssl: { rejectUnauthorized: false } });
  const normSql = (col, val) => `REPLACE(REPLACE(REPLACE(${col},'.',''),'-',''),' ','') = REPLACE(REPLACE(REPLACE(${val},'.',''),'-',''),' ','')`;
  let ins = 0, upd = 0, skip = 0;

  for (const rawId of IDS) {
    const a = (await pool.query(
      `SELECT "numeroId","primerNombre","primerApellido","email","clave","userLogin","celular","contrato","plataforma"
         FROM "ACADEMICA" WHERE ${normSql('"numeroId"', '$1')} LIMIT 1`, [rawId]
    )).rows[0];
    if (!a || !a.userLogin) { console.log(`  ⚠ ${rawId}: sin ACADEMICA o sin userLogin → omitido`); continue; }
    const p = (await pool.query(
      `SELECT "estadoInactivo","contrato","plataforma" FROM "PEOPLE"
        WHERE ${normSql('"numeroId"', '$1')} AND "tipoUsuario"='BENEFICIARIO' LIMIT 1`, [rawId]
    )).rows[0] || {};

    const userLogin = a.userLogin;
    const password = (a.clave && String(a.clave).trim()) ? String(a.clave).trim() : a.numeroId;
    const activo = p.estadoInactivo === true ? false : true;
    const contrato = p.contrato || a.contrato || null;
    const plataforma = p.plataforma || a.plataforma || null;

    // ¿Ya hay cuenta con ESE userLogin? → nada que hacer.
    const byLogin = (await pool.query(`SELECT "_id" FROM "USUARIOS_ROLES" WHERE "userLogin"=$1 LIMIT 1`, [userLogin])).rows[0];
    if (byLogin) { console.log(`  = ${a.numeroId} ${a.primerNombre} ${a.primerApellido}: ya tiene cuenta con userLogin ${userLogin}`); skip++; continue; }

    // email: real si no lo usa OTRA cuenta; si no, sintético.
    const emailReal = (a.email && String(a.email).trim()) ? String(a.email).trim() : '';
    const emailTaken = emailReal
      ? (await pool.query(`SELECT COUNT(*)::int n FROM "USUARIOS_ROLES" WHERE LOWER("email")=LOWER($1)`, [emailReal])).rows[0].n
      : 1;
    const email = (emailReal && emailTaken === 0) ? emailReal : `${userLogin}@est.mosaico.cl`;

    // ¿Existe cuenta por numberid (desajuste)? → ALINEAR userLogin/email/clave.
    const byNum = (await pool.query(
      `SELECT "_id","userLogin","email" FROM "USUARIOS_ROLES" WHERE ${normSql('"numberid"', '$1')} LIMIT 1`, [rawId]
    )).rows[0];

    if (byNum) {
      console.log(`  ${APPLY ? '✓' : '·'} ALINEAR ${a.numeroId} ${a.primerNombre} ${a.primerApellido}: userLogin ${byNum.userLogin} → ${userLogin} | email ${byNum.email} → ${email} | activo=${activo}`);
      if (APPLY) await pool.query(
        `UPDATE "USUARIOS_ROLES" SET "userLogin"=$2,"email"=$3,"password"=$4,"activo"=$5,"_updatedDate"=NOW() WHERE "_id"=$1`,
        [byNum._id, userLogin, email, password, activo]
      );
      upd++;
    } else {
      console.log(`  ${APPLY ? '✓' : '·'} CREAR ${a.numeroId} ${a.primerNombre} ${a.primerApellido}: userLogin=${userLogin} | email=${email} | activo=${activo}`);
      if (APPLY) await pool.query(
        `INSERT INTO "USUARIOS_ROLES" ("_id","email","password","nombre","apellido","celular","numberid","contrato","plataforma","userLogin","rol","activo","origen","_createdDate","_updatedDate")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'ESTUDIANTE',$11,'ADMIN',NOW(),NOW())`,
        [randomUUID(), email, password, a.primerNombre, a.primerApellido || null, a.celular || null, a.numeroId, contrato, plataforma, userLogin, activo]
      );
      ins++;
    }
    // Alinear ACADEMICA.email al del login (para que el panel resuelva por email sintético)
    if (APPLY) await pool.query(`UPDATE "ACADEMICA" SET "email"=$2 WHERE ${normSql('"numeroId"', '$1')}`, [rawId, email]);
  }

  console.log(`\n${APPLY ? '✅ Aplicado' : '(dry-run)'}: ${ins} creada(s), ${upd} alineada(s), ${skip} ya OK. ${APPLY ? '' : '--apply para escribir.'}`);
  await pool.end();
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
