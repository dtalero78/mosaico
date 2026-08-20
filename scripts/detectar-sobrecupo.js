/**
 * Salones con más alumnos que asientos.
 *
 * Sólo lectura. No escribe nada.
 *
 * Cuenta con la MISMA regla que usa la aplicación (`cupoOcupadoSql`): ocupa
 * asiento quien tiene el cupo confirmado o una reserva viva, no está en OnHold,
 * no soltó el cupo a mano y su contrato no está retractado/rechazado/devuelto/nulo.
 *
 * Un salón con `numeroUsuarios = 0` no tiene límite declarado y no se evalúa.
 *
 * Uso: node scripts/detectar-sobrecupo.js
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

const OCUPA = (a) => `((${a}."cupoConfirmado" IS TRUE OR ${a}."cupoReservadoHasta" > NOW())
  AND ${a}."fechaOnHold" IS NULL
  AND ${a}."cupoLiberado" IS NOT TRUE
  AND NOT (${a}."estadoInactivo" IS TRUE AND COALESCE(${a}."suspenddata"->>'accion','') = 'INACTIVACION')
  AND NOT EXISTS (SELECT 1 FROM "PEOPLE" t WHERE t."contrato" = ${a}."contrato"
    AND t."tipoUsuario" = 'TITULAR'
    AND LOWER(TRIM(COALESCE(t."aprobacion",''))) IN ('devuelto','rechazado','retractado','contrato nulo')))`;

(async () => {
  const { rows } = await pool.query(`
    SELECT cc."campaign", cc."tipoCurso", cc."horarioCurso", cc."salon",
           COALESCE(cc."numeroUsuarios",0)::int cupos,
           (SELECT COUNT(*)::int FROM "PEOPLE" pe
             WHERE pe."tipoUsuario" IN ('BENEFICIARIO','BENEFICIARIA')
               AND pe."campaign" = cc."campaign" AND pe."tipoCurso" = cc."tipoCurso"
               AND pe."horarioCurso" = cc."horarioCurso" AND ${OCUPA('pe')}) ocupados,
           (SELECT COUNT(*)::int FROM "PEOPLE" pe
             WHERE pe."tipoUsuario" IN ('BENEFICIARIO','BENEFICIARIA')
               AND pe."campaign" = cc."campaign" AND pe."tipoCurso" = cc."tipoCurso"
               AND pe."horarioCurso" = cc."horarioCurso"
               AND pe."sobrecupoAutorizado" IS TRUE) autorizados,
           (SELECT COUNT(*)::int FROM "PEOPLE" pe
             WHERE pe."tipoUsuario" IN ('BENEFICIARIO','BENEFICIARIA')
               AND pe."campaign" = cc."campaign" AND pe."tipoCurso" = cc."tipoCurso"
               AND pe."horarioCurso" = cc."horarioCurso"
               AND pe."cupoReservadoHasta" > NOW()) reservas
      FROM "CURSOS_CAMPAIGN" cc
     WHERE cc."activa" = true AND COALESCE(cc."numeroUsuarios",0) > 0`);

  const exceso = rows.filter(r => r.ocupados > r.cupos)
    .sort((a, b) => (b.ocupados - b.cupos) - (a.ocupados - a.cupos));

  console.log(`\n  Salones activos con cupo declarado: ${rows.length}`);
  console.log(`  Exactamente llenos: ${rows.filter(r => r.ocupados === r.cupos).length}`);
  console.log(`  Con reserva viva (contrato en gestión): ${rows.reduce((n, r) => n + r.reservas, 0)}\n`);

  if (!exceso.length) {
    console.log('  ✅ Ningún salón está por encima de su cupo.\n');
  } else {
    console.log(`  ⚠ ${exceso.length} salón(es) por encima del cupo:\n`);
    console.table(exceso.map(r => ({
      salon: `${r.campaign} · ${r.tipoCurso} · ${r.horarioCurso} (${r.salon})`,
      ocupacion: `${r.ocupados}/${r.cupos}`,
      exceso: r.ocupados - r.cupos,
      'sobrecupo autorizado': r.autorizados,
    })));
    console.log('  Se regularizan ampliando el salón en Académico › Campañas, o moviendo');
    console.log('  alumnos con "Cambio Académico". Los que traen "sobrecupo autorizado" son');
    console.log('  excepciones aprobadas desde Gestión Contrato, no un fallo.\n');
  }
  await pool.end();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
