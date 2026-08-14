import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { createEvent } from '@/services/calendar.service';
import { ValidationError } from '@/lib/errors';

/**
 * Deriva, de lo que manda el modal, los campos que se guardan en CALENDARIO.
 *
 * Existe como función porque la usan el evento PADRE y cada CURSO HIJO de un
 * grupo compartido: si el hijo no pasara por aquí quedaría con el título y la
 * lección del padre, que son de otro curso.
 *
 * TALLER/OLIMPIADA van a nivel de CURSO (nivel=curso, step=Lección,
 * nombreEvento=Tipo de club); el resto usa nivel=Módulo y step=Lección.
 */
function derivarCamposEvento(v: {
  esTaller: boolean;
  curso?: string | null;
  modulo?: string | null;
  leccion?: string | null;
  club?: string | null;
  titulo?: string | null;
}) {
  const curso = String(v.curso || '').trim();
  if (v.esTaller) {
    const nombreEvento = v.club || undefined;
    const tituloONivel = curso && curso !== 'Todos'
      ? `${curso}${v.club ? ` - ${v.club}` : ''}`
      : (v.club || curso || '');
    return { nivel: curso || undefined, step: v.leccion || undefined, nombreEvento, tituloONivel };
  }
  const nivel = v.modulo || undefined;
  const step = v.leccion || undefined;
  let tituloONivel = v.titulo || v.leccion || '';
  if (nivel) tituloONivel = nivel + (step ? ` - ${step}` : '');
  // Display "Curso - Módulo - Lección" cuando hay un curso real.
  if (curso && curso !== 'Todos') {
    const extras = [nivel, step].filter((x) => x && x !== 'Todos').join(' - ');
    tituloONivel = extras ? `${curso} - ${extras}` : curso;
  }
  return { nivel, step, nombreEvento: step, tituloONivel };
}

/**
 * POST /api/postgres/events
 *
 * Create a new event in the calendar.
 */
export const POST = handlerWithAuth(async (request) => {
  const body = await request.json();

  if (!body.dia) throw new ValidationError('dia is required');
  if (!body.advisor) throw new ValidationError('advisor is required');

  const diaDate = new Date(body.dia);
  const hora = body.hora || `${diaDate.getHours().toString().padStart(2, '0')}:${diaDate.getMinutes().toString().padStart(2, '0')}`;

  // Resolve nivel and step: frontend sends nivel in tituloONivel and step in nombreEvento.
  // For CLUB events, nombreEvento contains the full step name (e.g. "TRAINING - Step 32"),
  // so prefer it over the raw step number to keep step consistent with nombreEvento.
  const eventTipoRaw = body.tipo || body.evento;
  // OLIMPIADA se estructura igual que TALLER (a nivel de CURSO, con "Tipo" del
  // catálogo de clubs y Lección con opción "Todas"); sólo cambia el `tipo`
  // guardado, para poder filtrarlas y pintarlas aparte.
  const esTaller = eventTipoRaw === 'CLUB' || eventTipoRaw === 'OLIMPIADA';

  // Módulo y Lección del padre: el modal los manda en tituloONivel/nombreEvento
  // (nombres heredados) o, para Taller, en curso/club/leccion.
  const base = derivarCamposEvento({
    esTaller,
    curso: body.curso,
    modulo: body.nivel || body.tituloONivel,
    leccion: esTaller ? body.leccion : (body.nombreEvento || body.step),
    club: body.club,
    titulo: body.titulo,
  });
  const nivel = base.nivel;
  const step = base.step;
  const nombreEventoFinal = base.nombreEvento;
  const tituloONivel = base.tituloONivel;

  // WELCOME es un CURSO en el modal (no un tipo) → tipo='WELCOME' (morado).
  const tipoFinal = body.curso === 'WELCOME' ? 'WELCOME' : (eventTipoRaw || 'SESSION');

  // body.compartidoCon (opcional): los CURSOS ADICIONALES del grupo compartido
  // (1-2). Cada uno trae su propio alcance —campaña, curso, salón— y su propia
  // lección; los campos de CALENDARIO se derivan con la MISMA regla que el
  // padre, para que ningún hijo herede el título ni la lección de otro curso.
  const compartidoCon = Array.isArray(body.compartidoCon)
    ? body.compartidoCon
        .filter((c: any) => c && typeof c.curso === 'string' && c.curso.trim())
        .map((c: any) => {
          const d = derivarCamposEvento({
            esTaller,
            curso: c.curso,
            modulo: c.modulo ?? c.nivel,
            leccion: c.leccion ?? c.step,
            club: c.club ?? body.club,
            titulo: c.titulo,
          });
          return {
            campaign: typeof c.campaign === 'string' && c.campaign.trim() ? c.campaign.trim() : null,
            curso: c.curso.trim(),
            salon: typeof c.salon === 'string' && c.salon.trim() ? c.salon.trim() : null,
            nivel: d.nivel,
            step: d.step,
            nombreEvento: d.nombreEvento,
            tituloONivel: d.tituloONivel,
          };
        })
    : undefined;

  const event = await createEvent({
    dia: body.dia,
    hora,
    advisor: body.advisor,
    nivel,
    step,
    tipo: tipoFinal,
    titulo: body.titulo || tituloONivel || body.tituloONivel || nivel,
    nombreEvento: nombreEventoFinal || step,
    tituloONivel: tituloONivel || body.tituloONivel,
    linkZoom: body.linkZoom,
    limiteUsuarios: body.limiteUsuarios || 30,
    club: body.club,
    observaciones: body.observaciones,
    campaign: body.campaign || null,
    curso: body.curso || null,
    salon: body.salon || null,
    compartidoCon,
  });

  return successResponse({
    event,
    message: 'Evento creado exitosamente',
  });
});
