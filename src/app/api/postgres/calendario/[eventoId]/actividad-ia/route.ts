import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-permissions'
import { AcademicoPermission } from '@/types/permissions'
import { queryOne } from '@/lib/postgres'
import { NotFoundError, ValidationError } from '@/lib/errors'
import { destinatariosDelEvento } from '@/services/actividad-ia.service'

/**
 * Actividad IA de la sesión — una sola actividad para TODO el grupo, que el
 * Guía redacta a mano o genera con IA y luego envía por WhatsApp a los
 * apoderados (ver `./enviar`).
 *
 *   GET  → destinatarios del evento: inscritos con el apoderado ya resuelto.
 *   POST → genera la actividad del grupo con OpenAI a partir del contenido de
 *          la lección del evento.
 *
 * Ambas gateadas por ACADEMICO.SESION.ACTIVIDAD_IA.
 */

export const GET = handlerWithAuth(async (_req, ctx: any, session) => {
  await requirePermission(session, AcademicoPermission.SESION_ACTIVIDAD_IA)
  const { evento, destinatarios } = await destinatariosDelEvento(String(ctx?.params?.eventoId || ''))
  return successResponse({
    evento: {
      _id: evento._id,
      curso: evento.nivel || evento.curso || '',
      modulo: evento.sesionModulo || '',
      leccion: evento.sesionLeccion || evento.step || '',
      nombre: evento.nombreEvento || evento.tituloONivel || '',
    },
    destinatarios,
    total: destinatarios.length,
    enviables: destinatarios.filter(d => d.enviable).length,
  })
})

export const POST = handlerWithAuth(async (_req, ctx: any, session) => {
  await requirePermission(session, AcademicoPermission.SESION_ACTIVIDAD_IA)
  const eventoId = String(ctx?.params?.eventoId || '')

  const evento = await queryOne<any>(
    `SELECT "nivel","step","sesionModulo","sesionLeccion","nombreEvento","tituloONivel","curso"
       FROM "CALENDARIO" WHERE "_id" = $1`,
    [eventoId]
  )
  if (!evento) throw new NotFoundError('Evento', eventoId)

  // Curso y lección del evento. En MOSAICO `nivel` = tipoCurso y la lección real
  // vive en sesionModulo/sesionLeccion (en IMPULSA y legacy, en nivel/step).
  const curso = String(evento.nivel || evento.curso || '').trim()
  const modulo = String(evento.sesionModulo || '').trim()
  const leccion = String(evento.sesionLeccion || evento.step || '').trim()

  // Temario de la lección, para que la actividad hable del tema real.
  const norm = (c: string) => `translate(lower(${c}),'áéíóúñ','aeioun')`
  const nivelRow = await queryOne<{ contenido: string | null; description: string | null; descripcionModulo: string | null }>(
    `SELECT "contenido","description","descripcionModulo" FROM "NIVELES"
      WHERE UPPER("curso")=UPPER($1)
        ${modulo ? `AND ${norm('"code"')}=${norm('$3')}` : ''}
        AND ${norm('"step"')}=${norm('$2')}
      LIMIT 1`,
    modulo ? [curso, leccion, modulo] : [curso, leccion]
  )

  if (!process.env.OPENAI_API_KEY) {
    throw new ValidationError('La generación con IA no está configurada (falta OPENAI_API_KEY). Puedes escribir la actividad a mano.')
  }

  const temario = [nivelRow?.descripcionModulo, nivelRow?.description, nivelRow?.contenido]
    .map(s => String(s || '').trim()).filter(Boolean).join('\n').slice(0, 3000)

  const prompt = `Eres el guía de un curso de ábaco Soroban de MOSAICO. Redacta UNA actividad para reforzar en casa lo visto en la sesión de hoy.

Curso: ${curso}
${modulo ? `Módulo: ${modulo}\n` : ''}Lección: ${leccion}
${temario ? `\nTemario de la lección:\n${temario}` : ''}

La actividad:
- Es para TODO el grupo (no personalizada), la hará el estudiante en casa.
- Debe poder explicarse en un mensaje de WhatsApp: máximo 90 palabras, sin encabezados ni viñetas con asteriscos.
- Instrucciones concretas y en segunda persona, dirigidas al estudiante.
- En español de Chile, tono cercano y claro.

Responde SOLO con el texto de la actividad, sin preámbulos ni comillas.`

  const OpenAI = (await import('openai')).default
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const completion = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 400,
    temperature: 0.8,
  })

  const actividad = completion.choices[0]?.message?.content?.trim() || ''
  if (!actividad) throw new ValidationError('La IA no devolvió ninguna actividad. Intenta de nuevo.')

  return successResponse({ actividad, curso, modulo, leccion })
})
