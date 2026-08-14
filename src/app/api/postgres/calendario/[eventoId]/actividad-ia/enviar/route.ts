import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-permissions'
import { AcademicoPermission } from '@/types/permissions'
import { ValidationError } from '@/lib/errors'
import { sendWhatsAppMessage } from '@/lib/whatsapp'
import { destinatariosDelEvento } from '@/services/actividad-ia.service'

/**
 * POST /api/postgres/calendario/[eventoId]/actividad-ia/enviar
 * Body: { texto, academicaIds?: string[] }
 *
 * Manda la actividad de la sesión por WhatsApp a los APODERADOS de los
 * inscritos. El cliente envía sólo el texto y, si acotó la lista, a quiénes:
 * **los teléfonos se resuelven en el servidor** a partir del evento (misma
 * regla que el resto de la plataforma, `resolverApoderado`) — nunca llegan
 * desde el navegador.
 *
 * El envío es SECUENCIAL (no en paralelo) para no gatillar el rate-limit de
 * Whapi, y es best-effort por destinatario: si uno falla, los demás siguen y el
 * fallo se reporta. Gateado por ACADEMICO.SESION.ACTIVIDAD_IA.
 */
const MAX_DESTINATARIOS = 60

export const POST = handlerWithAuth(async (req, ctx: any, session) => {
  await requirePermission(session, AcademicoPermission.SESION_ACTIVIDAD_IA)
  const eventoId = String(ctx?.params?.eventoId || '')

  const body = await req.json().catch(() => ({}))
  const texto = String(body?.texto || '').trim()
  if (!texto) throw new ValidationError('Escribe o genera la actividad antes de enviarla.')
  if (texto.length > 1200) throw new ValidationError('La actividad es demasiado larga para un WhatsApp (máx. 1200 caracteres).')

  const soloEstos: string[] | null = Array.isArray(body?.academicaIds) && body.academicaIds.length
    ? body.academicaIds.map((x: any) => String(x))
    : null

  const { evento, destinatarios } = await destinatariosDelEvento(eventoId)
  const elegidos = destinatarios
    .filter(d => d.enviable)
    .filter(d => !soloEstos || soloEstos.includes(d.academicaId))

  if (!elegidos.length) throw new ValidationError('Ningún inscrito tiene teléfono de apoderado registrado.')
  if (elegidos.length > MAX_DESTINATARIOS) {
    throw new ValidationError(`Demasiados destinatarios (${elegidos.length}). El máximo por envío es ${MAX_DESTINATARIOS}.`)
  }

  const curso = String(evento.nivel || evento.curso || '').trim()
  const leccion = String(evento.sesionLeccion || evento.step || '').trim()
  const encabezado = `Actividad de la sesión${curso ? ` de ${curso}` : ''}${leccion ? ` — ${leccion}` : ''}`

  const resultados: Array<{ academicaId: string; alumno: string; telefono: string; ok: boolean; error?: string }> = []
  for (const d of elegidos) {
    // El nombre del alumno va en el mensaje: un apoderado puede tener más de un
    // hijo en la plataforma y recibir varios.
    const mensaje = `${encabezado}\n\nEstudiante: ${d.alumno}\n\n${texto}\n\n— MOSAICO`
    try {
      await sendWhatsAppMessage(d.telefono, mensaje)
      resultados.push({ academicaId: d.academicaId, alumno: d.alumno, telefono: d.telefono, ok: true })
    } catch (e: any) {
      resultados.push({ academicaId: d.academicaId, alumno: d.alumno, telefono: d.telefono, ok: false, error: e?.message || 'Error al enviar' })
    }
  }

  const enviados = resultados.filter(r => r.ok).length
  return successResponse({
    ok: true,
    enviados,
    fallidos: resultados.length - enviados,
    sinTelefono: destinatarios.filter(d => !d.enviable).length,
    resultados,
  })
})
