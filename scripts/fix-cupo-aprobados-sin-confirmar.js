/**
 * Alumnos APROBADOS que ocupan su salón de hecho pero no cuentan como cupo.
 *
 * Un beneficiario aprobado, activo, con curso y con clases generadas ocupa un
 * asiento — pero si su fila no tiene `cupoConfirmado`, los contadores lo ignoran:
 * el salón muestra un lugar libre que no existe y admite a uno más del que cabe.
 *
 * Pasó con los contratos creados en la ventana entre el backfill de cupos y el
 * despliegue de la reserva temporal: nacieron sin confirmar y se aprobaron sin
 * pasar por "Dejar listo" (el backfill ya les había puesto esa marca).
 *
 * A partir de ahora la aprobación confirma el asiento, así que esto no se repite;
 * el script existe para reparar lo que quedó atrás.
 *
 * NO toca a quien soltó el cupo a mano (`cupoLiberado`) ni a quien está en
 * OnHold: ésos no ocupan asiento a propósito.
 *
 * Idempotente. Uso: node scripts/fix-cupo-aprobados-sin-confirmar.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

const AFECTADOS = `
  SELECT b."_id",
         TRIM(CONCAT_WS(' ', b."primerNombre", b."primerApellido")) alumno,
         b."contrato",
         b."campaign" || ' · ' || b."tipoCurso" || ' · ' || b."horarioCurso" salon,
         (SELECT COUNT(*)::int FROM "ACADEMICA" a
           JOIN "ACADEMICA_BOOKINGS" k ON (k."idEstudiante" = a."_id" OR k."studentId" = a."_id")
          WHERE a."peopleId" = b."_id") clases
    FROM "PEOPLE" b
    JOIN "PEOPLE" t ON t."contrato" = b."contrato" AND t."tipoUsuario" = 'TITULAR'
   WHERE b."tipoUsuario" IN ('BENEFICIARIO','BENEFICIARIA')
     AND COALESCE(b."contrato",'') NOT LIKE 'PRB-%'
     AND b."campaign" IS NOT NULL AND b."tipoCurso" IS NOT NULL AND b."horarioCurso" IS NOT NULL
     AND LOWER(TRIM(COALESCE(t."aprobacion",''))) IN ('aprobado','aprobada')
     AND b."estadoInactivo" IS NOT TRUE
     AND b."cupoLiberado" IS NOT TRUE
     AND b."fechaOnHold" IS NULL
     AND b."cupoConfirmado" IS NOT TRUE
     AND (b."cupoReservadoHasta" IS NULL OR b."cupoReservadoHasta" <= NOW())
   ORDER BY 4, 2`;

(async () => {
  console.log(APPLY ? '\n=== APLICANDO ===\n' : '\n=== DRY-RUN (usa --apply) ===\n');

  const { rows } = await pool.query(AFECTADOS);
  if (!rows.length) {
    console.log('  ✅ Ningún alumno aprobado está sin confirmar su asiento.\n');
    await pool.end();
    return;
  }

  console.table(rows.map(r => ({
    alumno: r.alumno, contrato: r.contrato, salon: r.salon, clases: r.clases,
  })));
  console.log(`\n  ${rows.length} alumno(s) ocupan su salón sin contar como cupo.`);

  if (!APPLY) { console.log('\n  (dry-run: no se escribió nada)\n'); await pool.end(); return; }

  const r = await pool.query(
    `UPDATE "PEOPLE"
        SET "cupoConfirmado" = true,
            "cupoConfirmadoPor" = 'reparación: aprobado sin confirmar',
            "cupoConfirmadoEn" = NOW(),
            "cupoReservadoHasta" = NULL,
            "_updatedDate" = NOW()
      WHERE "_id" = ANY($1::text[])`,
    [rows.map(x => x._id)]
  );
  console.log(`\n  confirmados: ${r.rowCount}`);
  console.log(`  pendientes tras aplicar: ${(await pool.query(AFECTADOS)).rows.length}\n`);
  await pool.end();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
