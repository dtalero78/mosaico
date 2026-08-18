/**
 * Consolida en UNA sola cuenta de login a un alumno que quedó con dos.
 *
 * Uso:
 *   node scripts/consolidar-login-duplicado.js --id=230307784
 *   node scripts/consolidar-login-duplicado.js --id=230307784 --apply
 *
 * Qué pasó: antes del arreglo `6463302`, la ruta de «completar perfil»
 * (/nuevo-usuario/[id]) buscaba la cuenta POR CORREO. Si el correo estaba guardado
 * con otra capitalización, no la encontraba y creaba una SEGUNDA cuenta en vez de
 * actualizar la existente — y tampoco escribía el `userLogin` en ACADEMICA.
 *
 * Resultado: el alumno queda con
 *   · la cuenta ORIGINAL, con su `userLogin` correcto pero inactiva y con la clave
 *     de relleno, y
 *   · la cuenta NUEVA, activa y con la clave que él eligió, pero SIN `userLogin`.
 * Puede entrar con el correo, pero NO con su usuario: ése cae en la cuenta muerta y
 * el login responde BLOCKED.
 *
 * Qué hace: deja UNA cuenta — la que el alumno usa (activa, con su clave) — y le
 * pasa el `userLogin` canónico, que es el de PEOPLE. Como `userLogin` es ÚNICO, la
 * cuenta muerta se borra ANTES, dentro de la misma transacción. Su contenido
 * completo se imprime para poder rehacerla si hiciera falta.
 *
 * También escribe `ACADEMICA.userLogin`, que es de donde la ficha lee «Usuario».
 *
 * Sólo actúa si el caso es EXACTAMENTE ése: una cuenta activa sin userLogin y otra
 * inactiva con él. Con cualquier otra combinación se planta y lo reporta.
 */

const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');
const ID = (process.argv.find(a => a.startsWith('--id=')) || '').split('=')[1];

const norm = (s) => String(s ?? '').toUpperCase().replace(/[.\s_-]/g, '');

async function main() {
  if (!ID) throw new Error('Falta --id=<numeroId del alumno>');
  const url = (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, '');
  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

  console.log(APPLY ? '── APLICANDO ──\n' : '── DRY RUN (usa --apply para escribir) ──\n');

  const per = (await pool.query(`
    SELECT "_id","userLogin","email",
           TRIM(COALESCE("primerNombre",'')||' '||COALESCE("primerApellido",'')) n
    FROM "PEOPLE" WHERE "numeroId"=$1 AND "tipoUsuario"='BENEFICIARIO' LIMIT 1`, [ID])).rows[0];
  if (!per) throw new Error(`No hay BENEFICIARIO con numeroId ${ID}`);
  const canonico = String(per.userLogin || '').trim();
  if (!canonico) throw new Error(`${per.n} no tiene userLogin en PEOPLE — no hay valor canónico que usar`);
  console.log(`Alumno: ${per.n}  (${ID})`);
  console.log(`  userLogin canónico (PEOPLE): ${canonico}\n`);

  const cuentas = (await pool.query(`
    SELECT "_id","email","userLogin","numberid","contrato","rol","activo","password","perfilActualizado"
    FROM "USUARIOS_ROLES"
    WHERE "userLogin" = $1
       OR UPPER(REGEXP_REPLACE(COALESCE("numberid",''),'[.[:space:]_-]','','g')) = $2
    ORDER BY "activo" DESC`, [canonico, norm(ID)])).rows;

  console.log(`Cuentas de login encontradas: ${cuentas.length}`);
  cuentas.forEach(c => console.log(
    `  ${c._id}\n     email=${c.email} | userLogin=${JSON.stringify(c.userLogin)} | numberid=${JSON.stringify(c.numberid)}` +
    ` | rol=${c.rol} | activo=${c.activo} | clave=${JSON.stringify(c.password)}`));

  const viva = cuentas.filter(c => c.activo && !String(c.userLogin || '').trim());
  const muerta = cuentas.filter(c => !c.activo && String(c.userLogin || '').trim() === canonico);

  if (cuentas.length !== 2 || viva.length !== 1 || muerta.length !== 1) {
    console.log('\n  NO es el patrón esperado (1 activa sin userLogin + 1 inactiva con él).');
    console.log('  No se toca nada — revísalo a mano.');
    await pool.end();
    process.exit(1);
  }
  const V = viva[0], M = muerta[0];

  console.log(`\n  Se CONSERVA : ${V._id}  (activa, clave del alumno)  -> recibe userLogin="${canonico}"`);
  console.log(`  Se BORRA    : ${M._id}  (inactiva, clave de relleno, numberid=${JSON.stringify(M.numberid)})`);
  console.log(`  ACADEMICA.userLogin pasa a "${canonico}"`);
  console.log(`\n  Copia íntegra de la fila que se borra (por si hay que rehacerla):`);
  console.log('  ' + JSON.stringify(M));

  if (!APPLY) { console.log('\n  (dry-run) No se escribió nada.'); await pool.end(); return; }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // El userLogin es ÚNICO: hay que soltar la cuenta muerta antes de asignarlo.
    await client.query(`DELETE FROM "USUARIOS_ROLES" WHERE "_id" = $1`, [M._id]);
    await client.query(
      `UPDATE "USUARIOS_ROLES" SET "userLogin" = $2, "_updatedDate" = NOW() WHERE "_id" = $1`,
      [V._id, canonico]);
    const ac = await client.query(
      `UPDATE "ACADEMICA" SET "userLogin" = $2, "_updatedDate" = NOW() WHERE "numeroId" = $1`,
      [ID, canonico]);
    await client.query('COMMIT');
    console.log(`\n  ✓ cuenta muerta borrada · userLogin asignado · ACADEMICA actualizada (${ac.rowCount} fila)`);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally { client.release(); }

  const fin = (await pool.query(`
    SELECT "email","userLogin","numberid","activo","password" FROM "USUARIOS_ROLES"
    WHERE "userLogin"=$1 OR UPPER(REGEXP_REPLACE(COALESCE("numberid",''),'[.[:space:]_-]','','g'))=$2`,
    [canonico, norm(ID)])).rows;
  console.log('\n  Estado final:');
  fin.forEach(c => console.log(`    ${c.email} | userLogin=${c.userLogin} | numberid=${c.numberid} | activo=${c.activo} | clave=${JSON.stringify(c.password)}`));

  await pool.end();
}

main().catch(e => { console.error('\nERROR:', e.message); process.exit(1); });
