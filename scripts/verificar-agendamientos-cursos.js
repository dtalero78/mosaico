/**
 * Salones donde algún alumno aprobado se quedó SIN clases.
 *
 * Regenerar un curso borra sus agendamientos y los vuelve a crear; si el proceso
 * se corta a la mitad, quedan alumnos aprobados sin ninguna clase — activos, con
 * acceso, y sin nada que cursar. Es el estado que hay que poder detectar rápido
 * después de cualquier regeneración masiva.
 *
 * Sólo lee. Uso: node scripts/verificar-agendamientos-cursos.js [--csv]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const CSV = process.argv.includes('--csv');
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

(async () => {
  const { rows } = await pool.query(`
    SELECT cc."campaign", cc."tipoCurso", cc."salon", cc."horarioCurso",
           (SELECT COUNT(*)::int FROM "CALENDARIO" c WHERE c."cursoCampaignId" = cc."_id") AS eventos,
           (SELECT COUNT(*)::int FROM "PEOPLE" p
             WHERE p."tipoUsuario" = 'BENEFICIARIO' AND p."campaign" = cc."campaign"
               AND p."tipoCurso" = cc."tipoCurso" AND p."horarioCurso" = cc."horarioCurso"
               AND LOWER(COALESCE(p."aprobacion",'')) LIKE 'aprobad%'
               AND COALESCE(p."contrato",'') NOT LIKE 'PRB-%') AS aprobados,
           (SELECT COUNT(DISTINCT COALESCE(b."idEstudiante", b."studentId"))::int
              FROM "ACADEMICA_BOOKINGS" b
              JOIN "CALENDARIO" c ON (c."_id" = b."eventoId" OR c."_id" = b."idEvento")
             WHERE c."cursoCampaignId" = cc."_id") AS con_clases
      FROM "CURSOS_CAMPAIGN" cc
     WHERE cc."activa" IS NOT FALSE
     ORDER BY cc."campaign", cc."tipoCurso", cc."salon"`);

  const malos = rows.filter(r => r.aprobados > 0 && r.con_clases < r.aprobados);
  if (CSV) {
    console.log('campaign,curso,salon,horario,eventos,aprobados,conClases,sinClases');
    malos.forEach(r => console.log(
      [r.campaign, r.tipoCurso, r.salon, r.horarioCurso, r.eventos, r.aprobados, r.con_clases,
       r.aprobados - r.con_clases].join(',')));
  } else {
    console.log(`\n  ${rows.length} salones activos revisados.\n`);
    if (!malos.length) {
      console.log('  ✓ Ningún alumno aprobado se quedó sin clases.\n');
    } else {
      console.log('  ⚠ Salones con alumnos aprobados SIN clases:\n');
      console.log('  ' + 'salón'.padEnd(32) + 'clases  aprobados  con clases  SIN clases');
      malos.forEach(r => console.log('  ' +
        `${r.campaign} ${r.tipoCurso}/${r.salon}`.padEnd(32) +
        String(r.eventos).padStart(5) + String(r.aprobados).padStart(10) +
        String(r.con_clases).padStart(12) + String(r.aprobados - r.con_clases).padStart(11)));
      console.log(`\n  Se reparan regenerando el curso (Campañas › editar, o Festivos › Recolocar).\n`);
    }
  }
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
