import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { query, queryOne } from '@/lib/postgres';
import { NotFoundError, ConflictError } from '@/lib/errors';
import { approveOnePerson, approveContract } from '@/services/approval.service';

/**
 * POST /api/postgres/people/[id]/approve
 *
 * Approve a person (titular or beneficiario). Replicates the full Wix approval flow:
 *
 * For BENEFICIARIO:
 *   1. Update PEOPLE.aprobacion = 'Aprobado' (+ copy contrato from titular)
 *   2. Create ACADEMICA record (nivel: WELCOME, step: WELCOME)
 *   3. Send WhatsApp welcome message
 *   4. Auto-approve titular if not already approved
 *
 * For TITULAR:
 *   1. Update PEOPLE.aprobacion = 'Aprobado'
 *   2. Approve all pending beneficiarios (cascade)
 *   3. Send WhatsApp to beneficiarios
 *
 * La lógica de aprobación vive en `services/approval.service.ts` (compartida con
 * el "Autoaprobar" del centro de aprobación, que la usa con sendWhatsApp=false).
 */
export const POST = handlerWithAuth(async (
  _request: Request,
  { params }: { params: Record<string, string> }
) => {
  const personId = params.id;

  // Get person to determine type (include inicioContrato for propagation to beneficiarios)
  const person = await queryOne(
    `SELECT "_id", "tipoUsuario", "contrato", "aprobacion", "primerNombre", "primerApellido", "inicioContrato" FROM "PEOPLE" WHERE "_id" = $1`,
    [personId]
  );
  if (!person) throw new NotFoundError('Person', personId);

  if (person.aprobacion === 'Aprobado') {
    throw new ConflictError('La persona ya está aprobada');
  }

  const contrato = person.contrato;

  // ─── TITULAR: aprobación en cascada (titular + beneficiarios) ───
  if (person.tipoUsuario === 'TITULAR' && contrato) {
    const { mainResult, beneficiaryResults } = await approveContract(personId);
    return successResponse({
      message: 'Titular y beneficiarios aprobados exitosamente',
      academicId: mainResult.academicId,
      academicCreated: mainResult.academicCreated,
      whatsappSent: mainResult.whatsappSent,
      whatsappError: mainResult.whatsappError,
      titularAutoApproved: false,
      beneficiariesApproved: beneficiaryResults.map(r => ({
        personId: r.personId,
        nombre: r.nombre,
        academicCreated: r.academicCreated,
        whatsappSent: r.whatsappSent,
        whatsappError: r.whatsappError,
      })),
      beneficiariesCount: beneficiaryResults.length,
    });
  }

  // Approve the person themselves (beneficiario suelto)
  const mainResult = await approveOnePerson(personId, contrato);

  // ─── BENEFICIARIO: copy inicioContrato from titular + auto-approve titular if pending ───
  let titularAutoApproved = false;
  if (person.tipoUsuario === 'BENEFICIARIO' && contrato) {
    const titular = await queryOne(
      `SELECT "_id", "aprobacion", "inicioContrato" FROM "PEOPLE"
       WHERE "contrato" = $1 AND "tipoUsuario" = 'TITULAR' LIMIT 1`,
      [contrato]
    );

    if (titular) {
      // Propagate inicioContrato from titular to this beneficiario
      if (titular.inicioContrato && !mainResult.whatsappError?.includes('Ya estaba aprobado')) {
        await query(
          `UPDATE "PEOPLE" SET "inicioContrato" = $1, "_updatedDate" = NOW() WHERE "_id" = $2`,
          [titular.inicioContrato, personId]
        );
        console.log(`✅ [Approve] inicioContrato propagado al beneficiario: ${titular.inicioContrato}`);
      }

      // Auto-approve titular if still pending
      if (titular.aprobacion !== 'Aprobado') {
        await query(
          `UPDATE "PEOPLE" SET "aprobacion" = 'Aprobado', "_updatedDate" = NOW() WHERE "_id" = $1`,
          [titular._id]
        );
        titularAutoApproved = true;
        console.log(`✅ [Approve] Titular auto-aprobado: ${titular._id}`);
      }
    }
  }

  return successResponse({
    message: 'Persona aprobada exitosamente',
    academicId: mainResult.academicId,
    academicCreated: mainResult.academicCreated,
    whatsappSent: mainResult.whatsappSent,
    whatsappError: mainResult.whatsappError,
    titularAutoApproved,
  });
});
