/**
 * MOSAICO — barrido: crea/alinea la cuenta USUARIOS_ROLES de TODOS los
 * beneficiarios APROBADOS cuyo `userLogin` de ACADEMICA no tiene cuenta
 * (patrón de hermanos que comparten el email del apoderado → en la migración
 * quedó una sola cuenta por email y a los demás se les omitió/cruzó el login).
 *
 * Por cada candidato:
 *   - userLogin = el de su ACADEMICA (verificado libre)
 *   - email     = el real si no lo usa OTRA cuenta; si no, sintético
 *                 `<userLogin>@est.mosaico.cl`
 *   - password  = ACADEMICA.clave || numeroId
 *   - rol=ESTUDIANTE, activo = !PEOPLE.estadoInactivo, numberid/contrato/plataforma
 *   - Si existe cuenta por numberid con el NOMBRE del alumno (verificado) →
 *     ALINEA su userLogin. Si el nombre NO coincide → NO toca, lo reporta.
 *   - Si no existe cuenta por numberid → CREA.
 * Loop hasta que no queden candidatos (al alinear se libera un login prestado
 * cuyo dueño real pasa a necesitar cuenta). Idempotente.
 * Uso: node scripts/create-missing-student-logins.js [--apply]
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const { randomUUID } = require('crypto');
const APPLY = process.argv.includes('--apply');
const NORM = (col) => `REPLACE(REPLACE(REPLACE(${col},'.',''),'-',''),' ','')`;

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/g, ''), ssl: { rejectUnauthorized: false } });

  // Candidatos: ACADEMICA beneficiaria con userLogin, aprobada en PEOPLE, y sin cuenta por ese userLogin.
  async function getCandidates() {
    return (await pool.query(
      `SELECT a."numeroId"
         FROM "ACADEMICA" a
        WHERE COALESCE(a."userLogin",'') <> ''
          AND NOT EXISTS (SELECT 1 FROM "USUARIOS_ROLES" u WHERE u."userLogin" = a."userLogin")
          AND EXISTS (
            SELECT 1 FROM "PEOPLE" p
             WHERE ${NORM('p."numeroId"')} = ${NORM('a."numeroId"')}
               AND p."tipoUsuario" = 'BENEFICIARIO'
               AND LOWER(COALESCE(p."aprobacion",'')) IN ('aprobado','aprobada')
          )`
    )).rows.map(r => r.numeroId);
  }

  let ins = 0, upd = 0, skip = 0, iter = 0;
  const risky = [];
  let ids = await getCandidates();
  console.log(`Candidatos iniciales (aprobados sin cuenta por su userLogin): ${ids.length}`);

  while (ids.length && iter < 8) {
    iter++;
    let actedThisRound = 0;
    for (const rawId of ids) {
      const a = (await pool.query(
        `SELECT "numeroId","primerNombre","segundoNombre","primerApellido","segundoApellido","email","clave","userLogin","celular","contrato","plataforma"
           FROM "ACADEMICA" WHERE ${NORM('"numeroId"')} = ${NORM('$1')} LIMIT 1`, [rawId]
      )).rows[0];
      if (!a || !a.userLogin) continue;
      // ¿ya se creó/alineó en esta corrida? (defensa)
      if ((await pool.query(`SELECT 1 FROM "USUARIOS_ROLES" WHERE "userLogin"=$1`, [a.userLogin])).rows.length) { continue; }

      const p = (await pool.query(
        `SELECT "estadoInactivo","contrato","plataforma" FROM "PEOPLE"
          WHERE ${NORM('"numeroId"')} = ${NORM('$1')} AND "tipoUsuario"='BENEFICIARIO' LIMIT 1`, [rawId]
      )).rows[0] || {};

      const userLogin = a.userLogin;
      const password = (a.clave && String(a.clave).trim()) ? String(a.clave).trim() : a.numeroId;
      const activo = p.estadoInactivo === true ? false : true;
      const contrato = p.contrato || a.contrato || null;
      const plataforma = p.plataforma || a.plataforma || null;
      const nombre = [a.primerNombre, a.segundoNombre].filter(Boolean).join(' ').trim();
      const apellido = [a.primerApellido, a.segundoApellido].filter(Boolean).join(' ').trim() || null;

      const emailReal = (a.email || '').trim();
      const taken = emailReal
        ? (await pool.query(`SELECT COUNT(*)::int n FROM "USUARIOS_ROLES" WHERE LOWER("email")=LOWER($1)`, [emailReal])).rows[0].n
        : 1;
      const email = (emailReal && taken === 0) ? emailReal : `${userLogin}@est.mosaico.cl`;

      // ¿Cuenta por numberid? (posible desajuste: userLogin prestado de un hermano)
      const byNum = (await pool.query(
        `SELECT "_id","userLogin","nombre","apellido" FROM "USUARIOS_ROLES" WHERE ${NORM('"numberid"')} = ${NORM('$1')} LIMIT 1`, [rawId]
      )).rows[0];

      if (byNum) {
        // Verificar que la cuenta es del PROPIO alumno (por nombre) antes de alinear.
        const nombreCuenta = `${byNum.nombre || ''} ${byNum.apellido || ''}`.toLowerCase();
        const ok = nombreCuenta.includes((a.primerNombre || '').toLowerCase()) && nombreCuenta.includes((a.primerApellido || '').toLowerCase());
        if (!ok) {
          risky.push(`${a.numeroId} ${a.primerNombre} ${a.primerApellido}: cuenta-por-numberid es "${byNum.nombre} ${byNum.apellido}" (userLogin ${byNum.userLogin}) → NO tocada`);
          skip++; continue;
        }
        console.log(`  ${APPLY ? '✓' : '·'} ALINEAR ${a.numeroId} ${nombre} ${apellido}: userLogin ${byNum.userLogin} → ${userLogin} | email → ${email} | activo=${activo}`);
        if (APPLY) {
          await pool.query(`UPDATE "USUARIOS_ROLES" SET "userLogin"=$2,"email"=$3,"password"=$4,"activo"=$5,"_updatedDate"=NOW() WHERE "_id"=$1`,
            [byNum._id, userLogin, email, password, activo]);
          await pool.query(`UPDATE "ACADEMICA" SET "email"=$2 WHERE ${NORM('"numeroId"')} = ${NORM('$1')}`, [rawId, email]);
        }
        upd++; actedThisRound++;
      } else {
        console.log(`  ${APPLY ? '✓' : '·'} CREAR ${a.numeroId} ${nombre} ${apellido}: userLogin=${userLogin} | email=${email}${(taken > 0 || !emailReal) ? ' (sintético)' : ''} | activo=${activo}`);
        if (APPLY) {
          await pool.query(`INSERT INTO "USUARIOS_ROLES" ("_id","email","password","nombre","apellido","celular","numberid","contrato","plataforma","userLogin","rol","activo","origen","_createdDate","_updatedDate")
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'ESTUDIANTE',$11,'ADMIN',NOW(),NOW())`,
            [randomUUID(), email, password, nombre, apellido, a.celular || null, a.numeroId, contrato, plataforma, userLogin, activo]);
          await pool.query(`UPDATE "ACADEMICA" SET "email"=$2 WHERE ${NORM('"numeroId"')} = ${NORM('$1')}`, [rawId, email]);
        }
        ins++; actedThisRound++;
      }
    }
    if (!APPLY) break;               // en dry-run no re-consultamos (nada cambió)
    if (actedThisRound === 0) break; // convergió
    ids = await getCandidates();     // cascada: dueños de logins liberados
    if (ids.length) console.log(`  … ronda ${iter} liberó logins; nuevos candidatos: ${ids.length}`);
  }

  console.log(`\n${APPLY ? '✅ Aplicado' : '(dry-run)'}: ${ins} a crear, ${upd} a alinear, ${skip} riesgosos (no tocados).`);
  if (risky.length) { console.log('⚠️ Riesgosos (cuenta-por-numberid con OTRO nombre — revisar a mano):'); risky.forEach(r => console.log('   ' + r)); }
  if (!APPLY) console.log('\n--apply para escribir.');
  await pool.end();
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
