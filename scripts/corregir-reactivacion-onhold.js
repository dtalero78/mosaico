/**
 * MOSAICO — corrige a un alumno que el cron `reactivate-onhold` reactivó A MEDIAS
 * (hasta oct-2026 el cron dejaba el login bloqueado, el estado en "On Hold" y
 * contaba el OnHold como una extensión manual).
 *
 * Por alumno (documento):
 *   1. Login (USUARIOS_ROLES.activo = true) por IDENTIDAD — userLogin de su
 *      ACADEMICA o numberid —, nunca por correo (los hermanos lo comparten).
 *   2. PEOPLE.estado = 'ACTIVA'.
 *   3. Quita de extensionHistory las entradas que escribió el cron por el OnHold y
 *      baja extensionCount en la misma cantidad (el OnHold no es una extensión).
 *      La vigencia NO se toca: los días pausados sí le correspondían. La traza
 *      pasa a la última entrada de onHoldHistory, que es donde vive el OnHold.
 *   4. Si tiene curso y el contrato está aprobado, confirma su cupo (sin eso no
 *      ocupa silla y no figura en la lista de su guía). Sólo si el salón tiene sitio.
 *
 * Deja copia previa en PURGE_LOG (tipoPurga CORRECCION_REACTIVACION_ONHOLD).
 * Ensayo por defecto; --apply para escribir. Idempotente.
 *   node scripts/corregir-reactivacion-onhold.js --numeroId=27597918K [--apply]
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config({ path: '.env.local', quiet: true });
const { Pool } = require('pg');

const APPLY = process.argv.includes('--apply');
const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=').slice(1).join('=');
const NUMERO_ID = arg('numeroId').trim().toUpperCase();
if (!NUMERO_ID) { console.error('Falta --numeroId=<documento>'); process.exit(1); }

const esEntradaCronOnHold = (e) => /OnHold/i.test(String(e && e.motivo)) && /Cron Job/i.test(String(e && e.motivo));

(async () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/g, ''),
    ssl: { rejectUnauthorized: false }, max: 1,
  });
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SET LOCAL lock_timeout = '5s'`);
    const p = (await c.query(
      `SELECT * FROM "PEOPLE" WHERE UPPER("numeroId") = $1 AND "tipoUsuario" IN ('BENEFICIARIO','BENEFICIARIA') FOR UPDATE`,
      [NUMERO_ID])).rows[0];
    if (!p) throw new Error(`No hay beneficiario con documento ${NUMERO_ID}`);
    if (p.fechaOnHold) throw new Error('El alumno sigue en OnHold: esto es para quien ya fue reactivado.');
    const a = (await c.query(`SELECT "_id","userLogin" FROM "ACADEMICA" WHERE UPPER("numeroId") = $1`, [NUMERO_ID])).rows;
    const logins = a.map((x) => x.userLogin).filter(Boolean);
    const cuentas = (await c.query(
      `SELECT "_id","userLogin","activo" FROM "USUARIOS_ROLES"
        WHERE "userLogin" = ANY($1) OR UPPER(TRIM("numberid")) = $2`, [logins, NUMERO_ID])).rows;

    const ext = Array.isArray(p.extensionHistory) ? p.extensionHistory : [];
    const delCron = ext.filter(esEntradaCronOnHold);
    const extNueva = ext.filter((e) => !esEntradaCronOnHold(e));
    const extCountNuevo = Math.max(0, (Number(p.extensionCount) || 0) - delCron.length);

    // ¿Ocupa cupo? Misma regla que lib/cupo (aquí sólo lo que aplica a este caso).
    const titular = (await c.query(
      `SELECT "aprobacion" FROM "PEOPLE" WHERE "contrato" = $1 AND "tipoUsuario" = 'TITULAR' LIMIT 1`, [p.contrato])).rows[0];
    const aprobado = /^aprobad[oa]$/i.test(String(titular && titular.aprobacion || '').trim());
    let cupo = { confirmar: false, motivo: '' };
    if (p.cupoConfirmado) cupo.motivo = 'ya estaba confirmado';
    else if (!p.campaign || !p.tipoCurso || !p.horarioCurso) cupo.motivo = 'no tiene curso';
    else if (!aprobado) cupo.motivo = 'contrato no aprobado';
    else {
      await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`cupo|${p.campaign}|${p.tipoCurso}|${p.horarioCurso}`]);
      const sal = (await c.query(
        `SELECT "numeroUsuarios" FROM "CURSOS_CAMPAIGN" WHERE "campaign"=$1 AND "tipoCurso"=$2 AND "horarioCurso"=$3 LIMIT 1`,
        [p.campaign, p.tipoCurso, p.horarioCurso])).rows[0];
      const ocupados = (await c.query(
        `SELECT COUNT(*)::int n FROM "PEOPLE" b
          WHERE b."tipoUsuario" IN ('BENEFICIARIO','BENEFICIARIA') AND b."_id" <> $4
            AND b."campaign"=$1 AND b."tipoCurso"=$2 AND b."horarioCurso"=$3
            AND COALESCE(b."contrato",'') NOT LIKE 'PRB-%'
            AND (b."cupoConfirmado" IS TRUE OR b."cupoReservadoHasta" > NOW())
            AND b."fechaOnHold" IS NULL AND b."cupoLiberado" IS NOT TRUE
            AND NOT (b."estadoInactivo" IS TRUE AND COALESCE(b."suspenddata"->>'accion','') = 'INACTIVACION')
            AND NOT EXISTS (SELECT 1 FROM "PEOPLE" t WHERE t."contrato" = b."contrato" AND t."tipoUsuario"='TITULAR'
                  AND LOWER(TRIM(COALESCE(t."aprobacion",''))) IN ('rechazado','retractado','contrato nulo','devuelto'))`,
        [p.campaign, p.tipoCurso, p.horarioCurso, p._id])).rows[0].n;
      const limite = Number(sal && sal.numeroUsuarios) || 0;
      if (limite > 0 && ocupados >= limite) cupo.motivo = `salón lleno (${ocupados}/${limite})`;
      else { cupo.confirmar = true; cupo.motivo = `salón ${ocupados}/${limite || '∞'} → queda ${ocupados + 1}`; }
    }

    console.log(`Alumno: ${p.primerNombre} ${p.primerApellido} · ${p.contrato}`);
    console.log(`  estado: ${p.estado} → ACTIVA`);
    console.log(`  login: ${cuentas.map((u) => `${u.userLogin || u._id}=${u.activo}`).join(', ') || '(sin cuenta)'} → true`);
    console.log(`  extensiones: quitar ${delCron.length} entrada(s) del cron · extensionCount ${p.extensionCount || 0} → ${extCountNuevo}`);
    const fc = p.finalContrato instanceof Date ? p.finalContrato.toISOString().slice(0, 10) : String(p.finalContrato || '').slice(0, 10);
    console.log(`  vigencia: ${fc} (sin cambio)`);
    console.log(`  cupo: ${cupo.confirmar ? 'se confirma' : 'no se toca'} (${cupo.motivo})`);
    if (!cuentas.length) console.log('  ⚠ No tiene cuenta de acceso: el login no se puede reactivar.');

    if (!APPLY) { await c.query('ROLLBACK'); console.log('\nEnsayo. Usa --apply para escribir.'); return; }

    await c.query(
      `INSERT INTO "PURGE_LOG" ("_id","tipoPurga","contrato","titularId","titularNombre","snapshot","motivo","realizadoPor","filasBorradas","_createdDate")
       VALUES ($1,'CORRECCION_REACTIVACION_ONHOLD',$2,$3,$4,$5::jsonb,$6,'script:corregir-reactivacion-onhold',$7::jsonb,NOW())`,
      ['plg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 11), p.contrato, p._id,
       `${p.primerNombre} ${p.primerApellido}`,
       JSON.stringify({ people: { estado: p.estado, extensionCount: p.extensionCount, extensionHistory: p.extensionHistory, onHoldHistory: p.onHoldHistory, cupoConfirmado: p.cupoConfirmado }, cuentas }),
       'Reactivación de OnHold hecha a medias por el cron: login, estado, extensión contada de más y cupo',
       JSON.stringify({ extensionesQuitadas: delCron.length, cupoConfirmado: cupo.confirmar })]);

    // La traza de la reactivación pasa a la última entrada de onHoldHistory.
    const traza = delCron[delCron.length - 1];
    const nota = traza ? {
      reactivadoEn: traza.fechaEjecucion, reactivadoPor: 'cron', modoReactivacion: 'AUTOMATICO',
      diasExtendidos: traza.diasExtendidos, finalContratoAnterior: traza.vigenciaAnterior, finalContratoNuevo: traza.vigenciaNueva,
    } : null;
    await c.query(
      `UPDATE "PEOPLE" SET "estado" = 'ACTIVA',
              "extensionCount" = $2,
              "extensionHistory" = $3::jsonb,
              "onHoldHistory" = CASE WHEN $4::jsonb IS NULL OR jsonb_typeof("onHoldHistory") <> 'array' OR jsonb_array_length("onHoldHistory") = 0
                                     THEN "onHoldHistory"
                                     ELSE jsonb_set("onHoldHistory", ARRAY[(jsonb_array_length("onHoldHistory") - 1)::text],
                                                    ("onHoldHistory" -> -1) || $4::jsonb) END,
              "cupoConfirmado" = CASE WHEN $5 THEN true ELSE "cupoConfirmado" END,
              "cupoConfirmadoPor" = CASE WHEN $5 THEN 'script:corregir-reactivacion-onhold' ELSE "cupoConfirmadoPor" END,
              "cupoConfirmadoEn" = CASE WHEN $5 THEN NOW() ELSE "cupoConfirmadoEn" END,
              "_updatedDate" = NOW()
        WHERE "_id" = $1`,
      [p._id, extCountNuevo, JSON.stringify(extNueva), nota ? JSON.stringify(nota) : null, cupo.confirmar]);
    if (cuentas.length) {
      await c.query(`UPDATE "USUARIOS_ROLES" SET "activo" = true, "_updatedDate" = NOW() WHERE "_id" = ANY($1)`,
        [cuentas.map((u) => u._id)]);
    }
    await c.query(`UPDATE "ACADEMICA" SET "estadoInactivo" = false, "_updatedDate" = NOW() WHERE UPPER("numeroId") = $1`, [NUMERO_ID]);
    await c.query('COMMIT');
    console.log('\n✓ Corregido.');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { c.release(); await pool.end(); }
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
