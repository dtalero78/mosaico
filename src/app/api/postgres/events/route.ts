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
  const nivel = body.nivel || body.tituloONivel || null;
  const step = body.nombreEvento || body.step || null;

  let tituloONivel = body.titulo || body.nombreEvento || '';
  if (nivel) {
    tituloONivel = nivel + (step ? ` - ${step}` : '');
  }

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
    tipo: body.tipo || body.evento || 'SESSION',
    titulo: body.titulo || body.tituloONivel || nivel,
    nombreEvento: body.nombreEvento || step,
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
