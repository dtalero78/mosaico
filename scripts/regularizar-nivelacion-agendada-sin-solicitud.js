/**
 * Regulariza alumnos que fueron AGENDADOS directamente en un evento de nivelación
 * (desde el calendario o desde la ficha) SIN pasar por la solicitud del módulo:
 * tienen el agendamiento pero en ACADEMICA no hay `detalleNivelacion`, así que
 * no salen en Servicio › Nivelaciones › Pendientes, el alumno no puede confirmar
 * asistencia en su panel y el cierre no tiene solicitud que cerrar.
 *
 * Para cada (alumno, evento) escribe la solicitud como si la hubiera aprobado
 * Servicio: aprobadoNivelacion=true, NivelacionCount+1 y detalleNivelacion con
 * módulo/lección/hora del EVENTO, `fecha` = 1 minuto ANTES de la creación del
 * agendamiento (la regla "ya tiene evento" exige agendamiento posterior a la
 * solicitud), marcadoPor = guía del evento y registradoPor = quien agendó.
 *
 * Uso:
 *   node scripts/regularizar-nivelacion-agendada-sin-solicitud.js --evento=<CALENDARIO._id> [--academica=id1,id2] [--motivo="..."] [--apply]
 * Sin --apply es ENSAYO (no escribe). Idempotente: salta a quien ya tenga una
 * solicitud viva (nivelacion=true o aprobadoNivelacion=true) con fecha anterior
 * al agendamiento.
 */
const { Pool } = require('pg');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));
const APPLY = args.apply === true;
const EVENTO = String(args.evento || '').trim();
const SOLO = args.academica ? String(args.academica).split(',').map(s => s.trim()).filter(Boolean) : null;
const MOTIVO = String(args.motivo || 'Agendado directamente en la nivelación por Servicio (regularización)').trim();
if (!EVENTO) { console.error('Falta --evento=<CALENDARIO._id>'); process.exit(1); }

const pool = new Pool({ connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''), ssl: { rejectUnauthorized: false } });

(async () => {
  const q = (s, p) => pool.query(s, p).then(r => r.rows);
  const ev = (await q(`
    SELECT c."_id", c."dia", TO_CHAR(c."dia" AT TIME ZONE 'America/Santiago', 'HH24:MI') AS hora_chile,
           c."nivel", c."step", c."duracionMin", g."email" AS guia_email, g."nombreCompleto" AS guia
      FROM "CALENDARIO" c LEFT JOIN "GUIAS" g ON g."_id" = c."advisor"
     WHERE c."_id" = $1 AND UPPER(COALESCE(c."tipo",'')) = 'NIVELACION'`, [EVENTO]))[0];
  if (!ev) { console.error('El evento no existe o no es una nivelación:', EVENTO); process.exit(1); }
  console.log(`Evento ${ev._id} · ${new Date(ev.dia).toISOString()} (${ev.hora_chile} Chile) · ${ev.nivel} / ${ev.step} · guía ${ev.guia || '—'}`);

  const filas = await q(`
    SELECT b."_id" AS booking, b."_createdDate" AS creado, b."agendadoPor", b."agendadoPorEmail",
           a."_id" AS academica, TRIM(CONCAT_WS(' ', a."primerNombre", a."primerApellido")) AS nombre, p."numeroId",
           a."nivelacion", a."aprobadoNivelacion", COALESCE(a."NivelacionCount",0)::int AS conteo, a."detalleNivelacion"
      FROM "ACADEMICA_BOOKINGS" b
      JOIN "ACADEMICA" a ON a."_id" = COALESCE(b."idEstudiante", b."studentId")
      LEFT JOIN "PEOPLE" p ON p."_id" = a."peopleId"
     WHERE (b."eventoId" = $1 OR b."idEvento" = $1) AND b."cancelo" IS NOT TRUE
     ORDER BY b."_createdDate"`, [EVENTO]);

  const plan = [];
  for (const f of filas) {
    if (SOLO && !SOLO.includes(f.academica)) continue;
    const det = f.detalleNivelacion && !Array.isArray(f.detalleNivelacion) ? f.detalleNivelacion : null;
    const viva = f.nivelacion === true || f.aprobadoNivelacion === true;
    const fechaSol = det?.fecha ? new Date(det.fecha).getTime() : null;
    const creado = new Date(f.creado).getTime();
    if (viva && fechaSol && fechaSol <= creado) { console.log(`  = ${f.nombre} (${f.numeroId}): ya tiene su solicitud (${det.fecha}) — se salta`); continue; }
    const fecha = new Date(creado - 60_000).toISOString();
    const detalle = {
      leccion: ev.step || null, modulo: ev.nivel || null,
      hora: ev.hora_chile, duracionMin: Number(ev.duracionMin) || 30, motivo: MOTIVO,
      fecha, marcadoPor: ev.guia_email || null,
      registradoPor: f.agendadoPor || null, registradoPorEmail: f.agendadoPorEmail || null,
      regularizadoEn: new Date().toISOString(), regularizadoDesdeBooking: f.booking,
    };
    plan.push({ f, detalle, nuevoConteo: f.conteo + 1 });
    console.log(`  + ${f.nombre} (${f.numeroId}) acad=${f.academica}: conteo ${f.conteo}→${f.conteo + 1}, solicitud fecha=${fecha}, ${detalle.modulo}/${detalle.leccion} ${detalle.hora} · antes: nivelacion=${f.nivelacion} aprobado=${f.aprobadoNivelacion}`);
  }
  console.log(`\n${plan.length} alumno(s) a regularizar. ${APPLY ? 'APLICANDO…' : 'ENSAYO: nada escrito (usa --apply).'}`);
  if (APPLY) {
    for (const { f, detalle, nuevoConteo } of plan) {
      await q(`UPDATE "ACADEMICA"
                  SET "nivelacion" = false, "aprobadoNivelacion" = true,
                      "detalleNivelacion" = $2::jsonb, "NivelacionCount" = $3, "_updatedDate" = NOW()
                WHERE "_id" = $1`, [f.academica, JSON.stringify(detalle), nuevoConteo]);
      console.log(`  ✓ ${f.nombre}`);
    }
  }
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
