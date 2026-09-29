/**
 * Cierra como REALIZADA la nivelación de un alumno que SÍ asistió y participó,
 * pero cuyo cierre no quedó registrado: sigue apareciendo en Solicitudes o en
 * Agrupaciones aunque la sesión ya se dictó.
 *
 * El caso que lo originó (sep-2026): el agendamiento tenía la asistencia y la
 * participación marcadas pero figuraba CANCELADO. La regla "ya tiene evento"
 * sólo cuenta agendamientos vivos, así que la alumna volvió a Agrupaciones y su
 * nivelación quedó abierta.
 *
 * Los datos salen del AGENDAMIENTO, que es lo que de verdad ocurrió: la fecha
 * del evento y el módulo/lección dictados. Lo que se había PEDIDO en la
 * solicitud se conserva aparte (`moduloSolicitado`/`leccionSolicitada`) cuando
 * no coincide.
 *
 * Escribe lo mismo que el cierre del guía en /sesion/[id]: baja `nivelacion` y
 * `aprobadoNivelacion`, agrega la entrada a `NivelacionHistory` y CONSERVA el
 * conteo. Además limpia `detalleNivelacion`, para que no quede apuntando a un
 * grupo armado del que ya salió.
 *
 * Uso:
 *   node scripts/cerrar-nivelacion-realizada.js --numeroId=<documento> [--evento=<CALENDARIO._id>] [--descancelar] [--apply]
 *   (o --academica=<ACADEMICA._id> en vez de --numeroId)
 *
 * Sin --apply es ENSAYO (no escribe). Idempotente: si la nivelación ya está
 * cerrada, o el historial ya tiene la REALIZADA de ese evento, no hace nada.
 * `--descancelar` quita además la marca de cancelado del agendamiento y repone
 * el inscrito en el evento; sin él, el agendamiento no se toca. Sirve también
 * sobre una nivelación YA cerrada, para corregir sólo el agendamiento.
 */
const { Pool } = require('pg');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));
const APPLY = args.apply === true;
const DESCANCELAR = args.descancelar === true;
const NUMERO_ID = String(args.numeroId || '').trim();
const ACADEMICA = String(args.academica || '').trim();
const EVENTO = String(args.evento || '').trim();
if (!NUMERO_ID && !ACADEMICA) { console.error('Falta --numeroId=<documento> o --academica=<id>'); process.exit(1); }

const pool = new Pool({ connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''), ssl: { rejectUnauthorized: false } });

(async () => {
  const q = (s, p) => pool.query(s, p).then(r => r.rows);

  const alumnos = await q(`
    SELECT a."_id", a."numeroId", TRIM(CONCAT_WS(' ', a."primerNombre", a."primerApellido")) AS nombre,
           a."nivelacion", a."aprobadoNivelacion", COALESCE(a."NivelacionCount", 0)::int AS conteo,
           a."detalleNivelacion", COALESCE(a."NivelacionHistory", '[]'::jsonb) AS historial
      FROM "ACADEMICA" a
     WHERE ${ACADEMICA ? 'a."_id" = $1' : 'a."numeroId" = $1'}`, [ACADEMICA || NUMERO_ID]);
  if (alumnos.length !== 1) { console.error(`Se esperaba 1 registro académico y hay ${alumnos.length}.`); process.exit(1); }
  const al = alumnos[0];
  const det = al.detalleNivelacion && !Array.isArray(al.detalleNivelacion) ? al.detalleNivelacion : {};
  console.log(`${al.nombre} (${al.numeroId}) · ${al._id}`);
  console.log(`  nivelacion=${al.nivelacion} aprobadoNivelacion=${al.aprobadoNivelacion} conteo=${al.conteo}`);
  console.log(`  solicitud: ${det.fecha || '—'} · ${det.modulo || '—'} / ${det.leccion || '—'} · pedida por ${det.marcadoPor || '—'}`);

  const viva = al.nivelacion === true || al.aprobadoNivelacion === true;
  if (!viva && !DESCANCELAR) {
    console.log('\nLa nivelación ya está cerrada: no hay nada que hacer.');
    await pool.end(); return;
  }

  const bookings = await q(`
    SELECT b."_id", COALESCE(b."eventoId", b."idEvento") AS evento, c."dia",
           TO_CHAR(c."dia" AT TIME ZONE 'America/Santiago', 'YYYY-MM-DD HH24:MI') AS chile,
           COALESCE(b."nivel", c."nivel") AS modulo, COALESCE(b."step", c."step") AS leccion,
           b."cancelo", b."_createdDate", g."nombreCompleto" AS guia
      FROM "ACADEMICA_BOOKINGS" b
      JOIN "CALENDARIO" c ON (c."_id" = b."eventoId" OR c."_id" = b."idEvento")
      LEFT JOIN "GUIAS" g ON g."_id" = c."advisor"
     WHERE (b."idEstudiante" = $1 OR b."studentId" = $1)
       AND UPPER(COALESCE(c."tipo", '')) = 'NIVELACION'
       AND (b."asistio" IS TRUE OR b."asistencia" IS TRUE)
       AND b."participacion" IS TRUE
       AND c."dia" < NOW()
     ORDER BY c."dia" DESC`, [al._id]);

  const historial = Array.isArray(al.historial) ? al.historial : [];

  // Nivelación YA cerrada y se pidió --descancelar: sólo queda corregir el
  // agendamiento de la sesión que el historial dice que se realizó.
  if (!viva) {
    const hecha = [...historial].reverse().find(h => h.resultado === 'REALIZADA' && (!EVENTO || bookings.some(b => b.evento === EVENTO && new Date(b.dia).toISOString() === h.fechaEvento)));
    const b = hecha && bookings.find(x => x._id === hecha.regularizadoDesdeBooking || new Date(x.dia).toISOString() === hecha.fechaEvento);
    if (!b) { console.log('\nLa nivelación está cerrada y no hay un agendamiento asistido que corregir.'); await pool.end(); return; }
    console.log(`\n  nivelación ya cerrada (REALIZADA del ${b.chile}). Agendamiento ${b._id} · cancelado=${b.cancelo}`);
    if (b.cancelo !== true) { console.log('  El agendamiento no está cancelado: no hay nada que hacer.'); await pool.end(); return; }
    console.log('  agendamiento: se quita la marca de cancelado y se repone el inscrito en el evento');
    if (!APPLY) { console.log('\nENSAYO: nada escrito (usa --apply).'); await pool.end(); return; }
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const u = await c.query(`UPDATE "ACADEMICA_BOOKINGS" SET "cancelo" = false, "_updatedDate" = NOW() WHERE "_id" = $1 AND "cancelo" IS TRUE`, [b._id]);
      if (u.rowCount === 1) await c.query(`UPDATE "CALENDARIO" SET "inscritos" = COALESCE("inscritos", 0) + 1 WHERE "_id" = $1`, [b.evento]);
      await c.query('COMMIT');
      console.log('\n✓ Aplicado.');
    } catch (e) { await c.query('ROLLBACK'); console.error('\n✗ No se aplicó:', e.message); process.exitCode = 1; } finally { c.release(); }
    const [fin] = await q(`
      SELECT b."cancelo", b."asistio", b."participacion", c."inscritos",
             (SELECT COUNT(*)::int FROM "ACADEMICA_BOOKINGS" x WHERE (x."eventoId" = c."_id" OR x."idEvento" = c."_id") AND x."cancelo" IS NOT TRUE) AS vivos
        FROM "ACADEMICA_BOOKINGS" b JOIN "CALENDARIO" c ON c."_id" = COALESCE(b."eventoId", b."idEvento") WHERE b."_id" = $1`, [b._id]);
    console.log('  estado final:', JSON.stringify(fin));
    await pool.end(); return;
  }

  // La sesión de ESTA solicitud: agendada después de pedirla. Con --evento manda el indicado.
  const solicitudMs = det.fecha ? new Date(det.fecha).getTime() : 0;
  const bk = EVENTO
    ? bookings.find(b => b.evento === EVENTO)
    : bookings.find(b => new Date(b._createdDate).getTime() >= solicitudMs);
  if (!bk) {
    console.error('\nNo hay un agendamiento de nivelación con asistencia Y participación posterior a la solicitud. No se cierra nada.');
    for (const b of bookings) console.error(`   (asistida) ${b.chile} · creado ${new Date(b._createdDate).toISOString()} · ${b.evento}`);
    await pool.end(); process.exit(1);
  }
  const fechaEvento = new Date(bk.dia).toISOString();
  console.log(`\n  sesión asistida: ${bk.chile} (Chile) · ${bk.modulo} / ${bk.leccion} · guía ${bk.guia || '—'}`);
  console.log(`  agendamiento ${bk._id} · cancelado=${bk.cancelo}`);

  if (historial.some(h => h.resultado === 'REALIZADA' && h.fechaEvento === fechaEvento)) {
    console.log('\nEl historial ya tiene la REALIZADA de ese evento: no se escribe otra.');
    await pool.end(); return;
  }

  const ahora = new Date().toISOString();
  const entry = {
    fecha: ahora,
    fechaEvento,
    fechaSolicitud: det.fecha || null,
    modulo: bk.modulo || det.modulo || null,
    leccion: bk.leccion || det.leccion || null,
    conteo: al.conteo,
    confirmadoEn: det.confirmadoEn || null,
    confirmadoPor: det.confirmadoPor || null,
    resultado: 'REALIZADA',
    comentario: `Regularización: asistió y participó en la nivelación del ${bk.chile} (hora de Chile)`
      + `${bk.guia ? ` con ${bk.guia}` : ''}. El cierre no había quedado registrado.`,
    marcadoPor: 'Regularización de datos',
    guia: bk.guia || null,
    regularizadoEn: ahora,
    regularizadoDesdeBooking: bk._id,
  };
  // Lo que se había pedido, cuando no es lo que se dictó.
  if (det.leccion && det.leccion !== entry.leccion) entry.leccionSolicitada = det.leccion;
  if (det.modulo && det.modulo !== entry.modulo) entry.moduloSolicitado = det.modulo;

  console.log('\n  entrada del historial:');
  console.log('  ' + JSON.stringify(entry, null, 1).replace(/\n/g, '\n  '));
  console.log(`\n  ACADEMICA: nivelacion → false · aprobadoNivelacion → false · detalleNivelacion → NULL · conteo se conserva (${al.conteo})`);
  if (bk.cancelo === true) {
    console.log(DESCANCELAR
      ? '  agendamiento: se quita la marca de cancelado y se repone el inscrito en el evento'
      : '  ⚠ el agendamiento figura CANCELADO aunque tiene asistencia: no se toca (usa --descancelar para corregirlo)');
  }

  if (!APPLY) { console.log('\nENSAYO: nada escrito (usa --apply).'); await pool.end(); return; }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(`
      UPDATE "ACADEMICA"
         SET "nivelacion" = false, "aprobadoNivelacion" = false, "detalleNivelacion" = NULL,
             "NivelacionHistory" = COALESCE("NivelacionHistory", '[]'::jsonb) || $2::jsonb,
             "_updatedDate" = NOW()
       WHERE "_id" = $1 AND ("nivelacion" IS TRUE OR "aprobadoNivelacion" IS TRUE)`,
      [al._id, JSON.stringify([entry])]);
    if (r.rowCount !== 1) throw new Error('La nivelación cambió mientras se aplicaba: no se escribió nada.');
    if (DESCANCELAR && bk.cancelo === true) {
      await client.query(`UPDATE "ACADEMICA_BOOKINGS" SET "cancelo" = false, "_updatedDate" = NOW() WHERE "_id" = $1`, [bk._id]);
      await client.query(`UPDATE "CALENDARIO" SET "inscritos" = COALESCE("inscritos", 0) + 1 WHERE "_id" = $1`, [bk.evento]);
    }
    await client.query('COMMIT');
    console.log('\n✓ Aplicado.');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('\n✗ No se aplicó:', e.message);
    process.exitCode = 1;
  } finally { client.release(); }

  const [fin] = await q(`SELECT "nivelacion","aprobadoNivelacion","NivelacionCount","detalleNivelacion",
                                jsonb_array_length(COALESCE("NivelacionHistory",'[]'::jsonb)) AS entradas
                           FROM "ACADEMICA" WHERE "_id" = $1`, [al._id]);
  console.log('  estado final:', JSON.stringify(fin));
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
