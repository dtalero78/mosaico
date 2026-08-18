/**
 * Corrige dos desfases entre «contrato aprobado», «gestión lista» y «cupo confirmado».
 *
 * Uso:
 *   node scripts/fix-listo-y-cupo-desfasados.js            # dry-run
 *   node scripts/fix-listo-y-cupo-desfasados.js --apply
 *
 * (a) TITULARES APROBADOS SIN «gestión lista».
 *     Aprobar exige tener el contrato listo (`assertContratoListo`), pero unos pocos
 *     se aprobaron ANTES de que existiera esa regla y el backfill de entonces no los
 *     alcanzó. Sus cupos ya están confirmados: lo único desfasado es la marca.
 *     → `gestionContratoListo = true`.
 *
 * (b) ALUMNOS ACTIVOS SIN CUPO CONFIRMADO, con el contrato aprobado Y listo.
 *     El asiento se reserva al marcar «Dejar listo»; si el alumno está activo, en un
 *     curso, y su contrato está aprobado y listo, entonces OCUPA el asiento de hecho
 *     — pero al no tener la marca, el salón lo ve libre y se puede sobrevender.
 *     → `cupoConfirmado = true`.
 *     Se EXCLUYE a quien tenga el cupo liberado a mano o esté en OnHold: ahí el
 *     salón hace bien en no contarlo y reconfirmarlo desharía una decisión.
 *
 * NO toca:
 *   · contratos sin aprobar (su sitio es quedar pendientes),
 *   · alumnos inactivos (no ocupan asiento),
 *   · alumnos cuyo titular esté Retractado/Rechazado/Devuelto/Contrato nulo — ahí la
 *     decisión va en la otra dirección y es de negocio, no de dato.
 *
 * Idempotente: al re-correrlo no encuentra nada que hacer.
 */

const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

// Reglas importadas de src, no copiadas.
const { esAprobadoSql } = require('../src/lib/estados.ts');

const APPLY = process.argv.includes('--apply');
const ACTOR = 'script:fix-listo-y-cupo-desfasados';

const SQL_A = `
  SELECT t."_id", t."contrato",
         TRIM(COALESCE(t."primerNombre",'')||' '||COALESCE(t."primerApellido",'')) AS titular,
         (SELECT COUNT(*)::int FROM "PEOPLE" x
           WHERE x."contrato"=t."contrato" AND x."tipoUsuario"='BENEFICIARIO') AS benes,
         (SELECT COUNT(*)::int FROM "PEOPLE" x
           WHERE x."contrato"=t."contrato" AND x."tipoUsuario"='BENEFICIARIO'
             AND COALESCE(x."cupoConfirmado",false)) AS con_cupo
  FROM "PEOPLE" t
  WHERE t."tipoUsuario"='TITULAR'
    AND ${esAprobadoSql('t."aprobacion"')}
    AND COALESCE(t."gestionContratoListo", false) = false
  ORDER BY t."contrato"`;

const SQL_B = `
  SELECT b."_id", b."contrato", b."campaign", b."tipoCurso", b."salon", b."horarioCurso",
         TRIM(COALESCE(b."primerNombre",'')||' '||COALESCE(b."primerApellido",'')) AS benef
  FROM "PEOPLE" b
  JOIN "PEOPLE" t ON t."contrato"=b."contrato" AND t."tipoUsuario"='TITULAR'
  WHERE b."tipoUsuario"='BENEFICIARIO'
    AND b."estadoInactivo" IS NOT TRUE
    AND COALESCE(b."cupoConfirmado", false) = false
    -- Un cupo LIBERADO a mano no es un desfase: alguien lo soltó a propósito y el
    -- salón hace bien en no contarlo. Volver a confirmarlo sería deshacer una
    -- decisión, y qué hacer con ese alumno es cosa de negocio, no de dato.
    AND b."cupoLiberado" IS NOT TRUE
    AND b."fechaOnHold" IS NULL
    AND COALESCE(b."tipoCurso",'') <> '' AND COALESCE(b."horarioCurso",'') <> ''
    AND ${esAprobadoSql('t."aprobacion"')}
    AND COALESCE(t."gestionContratoListo", false) = true
  ORDER BY b."campaign", b."contrato"`;

async function main() {
  const url = (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, '');
  if (!url) throw new Error('Falta DATABASE_URL en .env.local');
  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

  console.log(APPLY ? '── APLICANDO ──\n' : '── DRY RUN (usa --apply para escribir) ──\n');

  const a = (await pool.query(SQL_A)).rows;
  console.log(`(a) Titulares APROBADOS sin «gestión lista»: ${a.length}`);
  a.forEach(r => console.log(
    `    ${r.contrato.padEnd(16)} ${r.titular.slice(0, 28).padEnd(29)} cupo confirmado ${r.con_cupo}/${r.benes}`));

  const b = (await pool.query(SQL_B)).rows;
  console.log(`\n(b) Alumnos ACTIVOS sin cupo, con contrato aprobado Y listo: ${b.length}`);
  b.forEach(r => console.log(
    `    ${r.contrato.padEnd(16)} ${r.benef.slice(0, 24).padEnd(25)} ${r.campaign} · ${r.tipoCurso} · ${r.salon || '—'} · ${r.horarioCurso}`));

  if (!a.length && !b.length) {
    console.log('\n  Nada que corregir.');
    await pool.end();
    return;
  }
  if (!APPLY) {
    console.log('\n  (dry-run) No se escribió nada.');
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (a.length) {
      const r = await client.query(
        `UPDATE "PEOPLE"
            SET "gestionContratoListo" = true,
                "gestionContratoListoBy" = COALESCE("gestionContratoListoBy", $2),
                "gestionContratoListoDate" = COALESCE("gestionContratoListoDate", NOW()),
                "_updatedDate" = NOW()
          WHERE "_id" = ANY($1::text[])`,
        [a.map(x => x._id), ACTOR]);
      console.log(`\n  (a) titulares marcados listos: ${r.rowCount}`);
    }

    if (b.length) {
      const r = await client.query(
        `UPDATE "PEOPLE"
            SET "cupoConfirmado" = true,
                "cupoConfirmadoPor" = COALESCE("cupoConfirmadoPor", $2),
                "cupoConfirmadoEn" = COALESCE("cupoConfirmadoEn", NOW()),
                "_updatedDate" = NOW()
          WHERE "_id" = ANY($1::text[])`,
        [b.map(x => x._id), ACTOR]);
      console.log(`  (b) alumnos con cupo confirmado: ${r.rowCount}`);
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  const quedanA = (await pool.query(SQL_A)).rows.length;
  const quedanB = (await pool.query(SQL_B)).rows.length;
  console.log(`\n  Verificación — pendientes tras aplicar: (a) ${quedanA} · (b) ${quedanB}`);

  await pool.end();
}

main().catch(e => { console.error('\nERROR:', e.message); process.exit(1); });
