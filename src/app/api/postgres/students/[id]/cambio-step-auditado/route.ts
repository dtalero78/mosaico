import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { ValidationError } from '@/lib/errors'
import { changeStep } from '@/services/student.service'
import { AcademicaRepository } from '@/repositories/academica.repository'
import { PeopleRepository } from '@/repositories/people.repository'

/**
 * POST /api/postgres/students/[id]/cambio-step-auditado
 *
 * Changes the student's step with full audit trail:
 * 1. Calls changeStep() (updates ACADEMICA + PEOPLE)
 * 2. Appends entry to ACADEMICA.cambioStepHistory
 * 3. Adds comment to PEOPLE.comentarios (Académico → General)
 */
export const POST = handlerWithAuth(async (req, { params }, session) => {
  const body = await req.json()
  const { newStep, motivo, autorizadoPor, comentario } = body

  if (!newStep?.trim())        throw new ValidationError('newStep es requerido')
  if (!motivo?.trim())         throw new ValidationError('El motivo es requerido')
  if (!autorizadoPor?.trim())  throw new ValidationError('El autorizante es requerido')

  const academicaId = params.id
  const realizadoPor = (session.user as any).name || session.user?.email || 'Sistema'

  // 1. Obtener estado actual antes del cambio
  const academic = await AcademicaRepository.findByAnyId(academicaId)
  const nivelAnterior = academic?.nivel || '—'
  const stepAnterior  = academic?.step  || '—'

  // 2. Ejecutar el cambio de step (actualiza ACADEMICA + PEOPLE)
  const result = await changeStep(academicaId, newStep.trim())

  const nivelNuevo = result.isParallel
    ? (result.updatedFields as any).nivelParalelo
    : (result.updatedFields as any).nivel
  const stepNuevo = newStep.trim()

  // 3. Guardar auditoría en ACADEMICA.cambioStepHistory
  const ahora = new Date().toISOString()
  const auditEntry = {
    fecha: ahora,
    nivelAnterior,
    stepAnterior,
    nivelNuevo,
    stepNuevo,
    motivo: motivo.trim(),
    autorizadoPor: autorizadoPor.trim(),
    realizadoPor,
    comentario: comentario?.trim() || null,
  }
  await AcademicaRepository.saveCambioStepHistory(academicaId, auditEntry)

  // 4. Agregar comentario a PEOPLE.comentarios (Académico → General)
  if (comentario?.trim()) {
    const numeroId = academic?.numeroId
    if (numeroId) {
      const person = await PeopleRepository.findBeneficiarioByNumeroId(numeroId)
        .catch(() => null)
      if (person) {
        const commentObj = {
          id: `comment_${Date.now()}`,
          texto: `[Cambio Step] ${stepAnterior} → ${stepNuevo}. ${comentario.trim()}`,
          usuario: realizadoPor,
          fecha: ahora,
          areaRemitente: 'Académico',
          areaDestinatario: 'General',
        }
        await PeopleRepository.appendComment(person._id, JSON.stringify(commentObj))
      }
    }
  }

  return successResponse({
    message: `Step actualizado: ${stepAnterior} → ${stepNuevo}`,
    auditEntry,
    nivelNuevo,
    stepNuevo,
  })
})
