import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { createEvent } from '@/services/calendar.service';
import { ValidationError } from '@/lib/errors';

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

  let nivel: string | undefined;
  let step: string | undefined;
  let nombreEventoFinal: string | undefined;
  let tituloONivel: string;

  if (esTaller) {
    // TALLER (CLUB): a nivel de CURSO. body.club = Tipo (club de NIVELES.clubs),
    // body.leccion = Lección ('Todos' = todo el curso accede). nivel=curso,
    // step=Lección, nombreEvento=Tipo, display="Curso - Tipo".
    nivel = body.curso || undefined;
    step = body.leccion || undefined;
    nombreEventoFinal = body.club || undefined;
    tituloONivel = body.curso && body.curso !== 'Todos'
      ? `${body.curso}${body.club ? ` - ${body.club}` : ''}`
      : (body.club || body.curso || '');
  } else {
    nivel = body.nivel || body.tituloONivel || undefined;
    step = body.nombreEvento || body.step || undefined;
    nombreEventoFinal = body.nombreEvento || step;
    tituloONivel = body.titulo || body.nombreEvento || '';
    if (nivel) {
      tituloONivel = nivel + (step ? ` - ${step}` : '');
    }
    // Nombre de display = "Curso - Módulo - Lección" cuando hay un curso real.
    //  - WELCOME: "WELCOME - MOSAICO - Leccion 00"; Sesión/Nivelación YOJI:
    //  "YOJI - Modulo 01 - Leccion 01" (o "YOJI" si módulo/lección = Todos).
    if (body.curso && body.curso !== 'Todos') {
      const extras = [nivel, step].filter((x: string | undefined) => x && x !== 'Todos').join(' - ');
      tituloONivel = extras ? `${body.curso} - ${extras}` : body.curso;
    }
  }

  // WELCOME es un CURSO en el modal (no un tipo) → tipo='WELCOME' (morado).
  const tipoFinal = body.curso === 'WELCOME' ? 'WELCOME' : (eventTipoRaw || 'SESSION');

  // body.compartidoCon (opcional): array de niveles adicionales para crear
  // un grupo compartido (1-2 elementos). Cada elemento puede traer su propio
  // step / nombreEvento / tituloONivel; si no, se reutilizan los del base.
  const compartidoCon = Array.isArray(body.compartidoCon)
    ? body.compartidoCon
        .filter((c: any) => c && typeof c.nivel === 'string' && c.nivel.trim())
        .map((c: any) => ({
          nivel: c.nivel.trim(),
          step: typeof c.step === 'string' ? c.step.trim() : undefined,
          nombreEvento: typeof c.nombreEvento === 'string' ? c.nombreEvento.trim() : undefined,
          tituloONivel: typeof c.tituloONivel === 'string' ? c.tituloONivel.trim() : undefined,
        }))
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
