import 'server-only';
import { query, queryOne, queryMany, transaction } from '@/lib/postgres';
import { ids } from '@/lib/id-generator';
import { ValidationError, NotFoundError } from '@/lib/errors';

/**
 * "Cambio Académico" — mueve un beneficiario de una campaña/curso/salón a otro.
 *
 * Puede cambiar de campaña, a un curso del MISMO tipo o distinto, y a cualquier
 * salón del curso destino. Efectos:
 *   1. Identidad del curso en PEOPLE (campaign/tipoCurso/horarioCurso/salon) y en
 *      ACADEMICA (campaign/salon; curso/nivel/step si ya fue promovido de WELCOME).
 *   2. Cupos: usuInscritos −1 en el curso viejo, +1 en el nuevo.
 *   3. Módulo/lección: el estudiante toma la lección en la que va el curso NUEVO
 *      (la del primer evento futuro del curso destino, por el mapeo sesión→lección).
 *   4. Bookings: los del curso viejo ANTERIORES a hoy se conservan (histórico); los
 *      POSTERIORES a hoy se borran y se generan en el curso nuevo los eventos futuros.
 *   5. Auditoría: entrada en ACADEMICA.cambioAcademicoHistory + comentario en PEOPLE.
 *
 * El movimiento de bookings solo aplica si el estudiante ya estaba inscrito en el
 * curso viejo (tenía bookings); si no (p.ej. sigue en el puente WELCOME sin agenda),
 * solo se cambia la identidad del curso + cupos + lección.
 */

export interface CambioAcademicoInput {
  campaign: string;
  tipoCurso: string;
  horarioCurso: string;
  salon: string;
  motivo: string;
}

interface Actor { email?: string | null; nombre?: string | null }

async function resolverCursoId(campaign: string, tipoCurso: string, horarioCurso: string): Promise<string | null> {
  const r = await queryOne<{ _id: string }>(
    `SELECT "_id" FROM "CURSOS_CAMPAIGN" WHERE "campaign"=$1 AND "tipoCurso"=$2 AND "horarioCurso"=$3 LIMIT 1`,
    [campaign, tipoCurso, horarioCurso]
  );
  return r?._id || null;
}

/** Lección "actual" del curso destino: la del primer evento futuro (o el último si ya terminó). */
async function leccionActualCurso(cursoId: string, tipoCurso: string): Promise<{ modulo: string | null; leccion: string | null }> {
  const fut = await queryOne<{ sesionModulo: string | null; sesionLeccion: string | null }>(
    `SELECT "sesionModulo","sesionLeccion" FROM "CALENDARIO"
     WHERE "cursoCampaignId"=$1 AND "dia" >= NOW() AND "sesionLeccion" IS NOT NULL
     ORDER BY "dia" ASC LIMIT 1`, [cursoId]
  );
  if (fut?.sesionLeccion) return { modulo: fut.sesionModulo, leccion: fut.sesionLeccion };
  const last = await queryOne<{ sesionModulo: string | null; sesionLeccion: string | null }>(
    `SELECT "sesionModulo","sesionLeccion" FROM "CALENDARIO"
     WHERE "cursoCampaignId"=$1 AND "sesionLeccion" IS NOT NULL
     ORDER BY "dia" DESC LIMIT 1`, [cursoId]
  );
  if (last?.sesionLeccion) return { modulo: last.sesionModulo, leccion: last.sesionLeccion };
  // Fallback: primera lección del curso en NIVELES
  const first = await queryOne<{ code: string; step: string }>(
    `SELECT "code","step" FROM "NIVELES" WHERE "curso"=$1 ORDER BY "orden" NULLS LAST, "step" LIMIT 1`, [tipoCurso]
  );
  return { modulo: first?.code || null, leccion: first?.step || null };
}

export async function cambiarCursoAcademico(academicaId: string, input: CambioAcademicoInput, actor: Actor) {
  const campaign = (input.campaign || '').trim();
  const tipoCurso = (input.tipoCurso || '').trim();
  const horarioCurso = (input.horarioCurso || '').trim();
  const salon = (input.salon || '').trim();
  const motivo = (input.motivo || '').trim();
  if (!campaign || !tipoCurso || !horarioCurso) throw new ValidationError('Debe seleccionar campaña, curso y salón destino.');
  if (!motivo) throw new ValidationError('El motivo del cambio es obligatorio.');

  // 1) ACADEMICA + PEOPLE actuales
  const aca = await queryOne<any>(
    `SELECT "_id","peopleId","numeroId","curso","campaign","salon","nivel","step",
            "primerNombre","primerApellido","celular","plataforma"
     FROM "ACADEMICA" WHERE "_id"=$1`, [academicaId]);
  if (!aca) throw new NotFoundError('Registro académico', academicaId);

  // PEOPLE beneficiario (por peopleId, o por numeroId + BENEFICIARIO como fallback)
  let per = aca.peopleId
    ? await queryOne<any>(`SELECT "_id","campaign","tipoCurso","horarioCurso","salon","nivel","step" FROM "PEOPLE" WHERE "_id"=$1`, [aca.peopleId])
    : null;
  if (!per && aca.numeroId) {
    per = await queryOne<any>(
      `SELECT "_id","campaign","tipoCurso","horarioCurso","salon","nivel","step"
       FROM "PEOPLE" WHERE "numeroId"=$1 AND "tipoUsuario"='BENEFICIARIO' LIMIT 1`, [aca.numeroId]);
  }
  if (!per) throw new NotFoundError('Beneficiario (PEOPLE)', aca.numeroId || academicaId);

  // Curso viejo (de PEOPLE, la identidad real) y curso nuevo (destino)
  const oldCursoId = (per.campaign && per.tipoCurso && per.horarioCurso)
    ? await resolverCursoId(per.campaign, per.tipoCurso, per.horarioCurso) : null;
  const newCursoId = await resolverCursoId(campaign, tipoCurso, horarioCurso);
  if (!newCursoId) throw new NotFoundError('Curso destino', `${campaign}/${tipoCurso}/${horarioCurso}`);
  if (oldCursoId && oldCursoId === newCursoId) throw new ValidationError('El estudiante ya está en ese curso/salón.');

  // Lección actual del curso destino
  const { modulo: nuevoModulo, leccion: nuevaLeccion } = await leccionActualCurso(newCursoId, tipoCurso);

  // ¿Tenía bookings en el curso viejo? (para decidir si movemos bookings)
  let teniaBookings = false;
  if (oldCursoId) {
    const cnt = await queryOne<{ n: number }>(
      `SELECT COUNT(*)::int n FROM "ACADEMICA_BOOKINGS" b
       JOIN "CALENDARIO" c ON (c."_id"=b."eventoId" OR c."_id"=b."idEvento")
       WHERE c."cursoCampaignId"=$1 AND (b."idEstudiante"=$2 OR b."studentId"=$2)`,
      [oldCursoId, academicaId]);
    teniaBookings = (cnt?.n || 0) > 0;
  }

  const origen = { campaign: per.campaign, tipoCurso: per.tipoCurso, horarioCurso: per.horarioCurso, salon: per.salon, nivel: per.nivel, step: per.step };
  const destino = { campaign, tipoCurso, horarioCurso, salon, nivel: nuevoModulo, step: nuevaLeccion };

  let bookingsBorrados = 0;
  let bookingsCreados = 0;

  await transaction(async (client) => {
    // 2) Cupos: −1 viejo, +1 nuevo
    if (oldCursoId) {
      await client.query(`UPDATE "CURSOS_CAMPAIGN" SET "usuInscritos" = GREATEST(0, COALESCE("usuInscritos",0) - 1), "_updatedDate"=NOW() WHERE "_id"=$1`, [oldCursoId]);
    }
    await client.query(`UPDATE "CURSOS_CAMPAIGN" SET "usuInscritos" = COALESCE("usuInscritos",0) + 1, "_updatedDate"=NOW() WHERE "_id"=$1`, [newCursoId]);

    // 3) Bookings (solo si estaba inscrito en el curso viejo)
    if (teniaBookings && oldCursoId) {
      // Borrar los futuros del curso viejo, devolviendo el evento para decrementar inscritos
      const del = await client.query(
        `DELETE FROM "ACADEMICA_BOOKINGS" b
         USING "CALENDARIO" c
         WHERE (c."_id"=b."eventoId" OR c."_id"=b."idEvento")
           AND c."cursoCampaignId"=$1 AND c."dia" >= NOW()
           AND (b."idEstudiante"=$2 OR b."studentId"=$2)
         RETURNING c."_id" AS evid`,
        [oldCursoId, academicaId]);
      bookingsBorrados = del.rowCount ?? 0;
      const evIds = Array.from(new Set((del.rows || []).map((r: any) => r.evid).filter(Boolean)));
      if (evIds.length) {
        await client.query(
          `UPDATE "CALENDARIO" SET "inscritos" = GREATEST(0, COALESCE("inscritos",0) - 1), "_updatedDate"=NOW() WHERE "_id" = ANY($1::text[])`,
          [evIds]);
      }

      // Generar bookings para los eventos FUTUROS del curso nuevo (dedupe)
      const ev = await client.query(
        `SELECT "_id","advisor","dia","hora","tipo","evento","nivel","step","sesionModulo","sesionLeccion","tituloONivel","nombreEvento","titulo","linkZoom"
         FROM "CALENDARIO" WHERE "cursoCampaignId"=$1 AND "dia" >= NOW() ORDER BY "dia" ASC`, [newCursoId]);
      const existing = await client.query(
        `SELECT "eventoId","idEvento" FROM "ACADEMICA_BOOKINGS" WHERE ("idEstudiante"=$1 OR "studentId"=$1)`, [academicaId]);
      const yaTiene = new Set<string>();
      for (const r of existing.rows) { if (r.eventoId) yaTiene.add(r.eventoId); if (r.idEvento) yaTiene.add(r.idEvento); }

      for (const e of ev.rows as any[]) {
        if (yaTiene.has(e._id)) continue;
        const bookingData: Record<string, any> = {
          _id: ids.booking(),
          eventoId: e._id, idEvento: e._id,
          studentId: academicaId, idEstudiante: academicaId,
          primerNombre: aca.primerNombre || null, primerApellido: aca.primerApellido || null,
          numeroId: aca.numeroId || null, celular: aca.celular || null, plataforma: aca.plataforma || null,
          nivel: e.sesionModulo || e.nivel || e.tituloONivel || null,
          step: e.sesionLeccion || e.step || e.nombreEvento || null,
          advisor: e.advisor || null,
          fecha: e.dia, fechaEvento: e.dia, hora: e.hora || null,
          tipo: e.tipo || e.evento || null, tipoEvento: e.tipo || e.evento || null,
          linkZoom: e.linkZoom || null,
          nombreEvento: e.nombreEvento || e.titulo || null, tituloONivel: e.tituloONivel || null,
          asistio: false, asistencia: false, participacion: false, noAprobo: false, cancelo: false,
          agendadoPor: 'Sistema (cambio académico)', fechaAgendamiento: new Date().toISOString(), origen: 'POSTGRES',
        };
        const columns = Object.keys(bookingData);
        const values = Object.values(bookingData);
        const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
        const columnList = columns.map((c) => `"${c}"`).join(', ');
        await client.query(
          `INSERT INTO "ACADEMICA_BOOKINGS" (${columnList}, "_createdDate","_updatedDate") VALUES (${placeholders}, NOW(), NOW())`, values);
        await client.query(`UPDATE "CALENDARIO" SET "inscritos" = COALESCE("inscritos",0) + 1, "_updatedDate"=NOW() WHERE "_id"=$1`, [e._id]);
        bookingsCreados++;
      }
    }

    // 4) PEOPLE: identidad del curso + módulo/lección actual del destino
    await client.query(
      `UPDATE "PEOPLE" SET "campaign"=$2, "tipoCurso"=$3, "horarioCurso"=$4, "salon"=$5, "nivel"=$6, "step"=$7, "_updatedDate"=NOW() WHERE "_id"=$1`,
      [per._id, campaign, tipoCurso, horarioCurso, salon, nuevoModulo, nuevaLeccion]);

    // 5) ACADEMICA: campaign/salon siempre; curso/nivel/step si ya fue promovido (no está en WELCOME)
    const enWelcome = (aca.curso === 'WELCOME' || aca.curso == null);
    if (enWelcome) {
      await client.query(`UPDATE "ACADEMICA" SET "campaign"=$2, "salon"=$3, "_updatedDate"=NOW() WHERE "_id"=$1`, [academicaId, campaign, salon]);
    } else {
      await client.query(
        `UPDATE "ACADEMICA" SET "campaign"=$2, "salon"=$3, "curso"=$4, "nivel"=$5, "step"=$6, "_updatedDate"=NOW() WHERE "_id"=$1`,
        [academicaId, campaign, salon, tipoCurso, nuevoModulo, nuevaLeccion]);
    }

    // 6) Auditoría en ACADEMICA.cambioAcademicoHistory
    const entry = {
      fecha: new Date().toISOString(),
      motivo,
      origen, destino,
      bookingsBorrados, bookingsCreados,
      realizadoPor: actor.email || null,
      realizadoPorNombre: actor.nombre || null,
    };
    await client.query(
      `UPDATE "ACADEMICA" SET "cambioAcademicoHistory" = COALESCE("cambioAcademicoHistory",'[]'::jsonb) || $2::jsonb, "_updatedDate"=NOW() WHERE "_id"=$1`,
      [academicaId, JSON.stringify([entry])]);

    // 7) Comentario en PEOPLE.comentarios (columna TEXT que guarda un text[])
    const comentario = {
      id: ids.comment(),
      texto: `[Cambio Académico] ${origen.campaign || '—'}/${origen.tipoCurso || '—'}/${origen.salon || '—'} → ${destino.campaign}/${destino.tipoCurso}/${destino.salon} (lección ${nuevaLeccion || '—'}). ${motivo}`,
      areaRemitente: 'Académico', areaDestinatario: 'General',
      usuario: actor.nombre || actor.email || 'Sistema',
      fecha: new Date().toISOString(),
    };
    await client.query(
      `UPDATE "PEOPLE" SET "comentarios" = array_append(COALESCE("comentarios"::text[], ARRAY[]::text[]), $2)::text, "_updatedDate"=NOW() WHERE "_id"=$1`,
      [per._id, JSON.stringify(comentario)]);
  });

  return { origen, destino, bookingsBorrados, bookingsCreados, moviolBookings: teniaBookings };
}
