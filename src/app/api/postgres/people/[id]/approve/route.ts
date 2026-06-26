import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { query, queryOne, queryMany } from '@/lib/postgres';
import { NotFoundError, ConflictError } from '@/lib/errors';
import { ids } from '@/lib/id-generator';
import { sendWhatsAppMessage } from '@/lib/whatsapp';
import { generarBookingsBeneficiario } from '@/services/cursos-campaign-eventos.service';

interface ApproveResult {
  personId: string;
  nombre: string;
  academicId: string | null;
  academicCreated: boolean;
  whatsappSent: boolean;
  whatsappError: string | null;
}

/**
 * Approve a single person: update PEOPLE, create ACADEMICA, send WhatsApp.
 * Reusable for both titular and beneficiario approval.
 * @param inicioContrato - titular's consent date to copy to beneficiarios (null = skip)
 */
async function approveOnePerson(
  personId: string,
  contrato: string | null,
  inicioContrato: string | null = null
): Promise<ApproveResult> {
  const person = await queryOne(
    `SELECT * FROM "PEOPLE" WHERE "_id" = $1`,
    [personId]
  );
  if (!person) throw new NotFoundError('Person', personId);

  // Skip if already approved
  if (person.aprobacion === 'Aprobado') {
    console.log(`ℹ️ [Approve] ${person.primerNombre} ya está aprobado, saltando`);
    const existingAcademic = await queryOne(
      `SELECT "_id" FROM "ACADEMICA" WHERE "numeroId" = $1 LIMIT 1`,
      [person.numeroId]
    );
    return {
      personId,
      nombre: `${person.primerNombre} ${person.primerApellido}`,
      academicId: existingAcademic?._id || null,
      academicCreated: false,
      whatsappSent: false,
      whatsappError: 'Ya estaba aprobado',
    };
  }

  console.log(`🟢 [Approve] Aprobando ${person.tipoUsuario}: ${person.primerNombre} ${person.primerApellido} (${personId})`);

  // Use provided contrato or person's own
  const effectiveContrato = contrato || person.contrato;

  // Update PEOPLE.aprobacion = 'Aprobado' + estado = 'ACTIVA'.
  // El mapeo aprobacion→estado está documentado en /api/postgres/approvals/[id]
  // (APROBACION_TO_ESTADO); aquí lo aplicamos para que ambos endpoints dejen el
  // titular/beneficiario en estado consistente. Antes este route sólo tocaba
  // aprobacion y dejaba `estado` en NULL — el badge "Estado: Null" aparecía
  // en /person/[id] aunque el contrato estuviera aprobado.
  // Para BENEFICIARIO además copia `contrato` (si falta) y `inicioContrato` del titular.
  if (person.tipoUsuario === 'BENEFICIARIO') {
    const extraFields = [];
    const extraValues: any[] = [];

    if (effectiveContrato && !person.contrato) {
      extraFields.push(`"contrato" = $${extraValues.length + 2}`);
      extraValues.push(effectiveContrato);
    }
    if (inicioContrato) {
      extraFields.push(`"inicioContrato" = $${extraValues.length + 2}`);
      extraValues.push(inicioContrato);
    }

    const setClause = extraFields.length > 0 ? `, ${extraFields.join(', ')}` : '';
    await query(
      `UPDATE "PEOPLE" SET "aprobacion" = 'Aprobado', "estado" = 'ACTIVA', "estadoInactivo" = false${setClause}, "_updatedDate" = NOW() WHERE "_id" = $1`,
      [personId, ...extraValues]
    );
  } else {
    await query(
      `UPDATE "PEOPLE" SET "aprobacion" = 'Aprobado', "estado" = 'ACTIVA', "estadoInactivo" = false, "_updatedDate" = NOW() WHERE "_id" = $1`,
      [personId]
    );
  }
  console.log(`✅ [Approve] PEOPLE.aprobacion='Aprobado' + estado='ACTIVA' + estadoInactivo=false`);

  // Check/Create ACADEMICA record — SÓLO para BENEFICIARIO.
  // Los TITULARES no son estudiantes (no toman clases); su rol es contractual.
  // Crear ACADEMICA para un titular que NO es beneficiario produce un registro
  // espurio que aparece como "estudiante" en búsquedas, paneles y reports.
  // Si el titular ES también beneficiario (titularEsBeneficiario), existe una fila
  // PEOPLE separada con tipoUsuario='BENEFICIARIO' que sí dispara ACADEMICA.
  let academicId: string | null = null;
  let academicCreated = false;

  if (person.tipoUsuario === 'BENEFICIARIO') {
    const existingAcademic = await queryOne(
      `SELECT "_id" FROM "ACADEMICA" WHERE "numeroId" = $1 LIMIT 1`,
      [person.numeroId]
    );

    academicId = existingAcademic?._id ?? null;

    if (!existingAcademic) {
      academicId = ids.academic();
      await query(
        `INSERT INTO "ACADEMICA" (
          "_id", "studentId", "numeroId", "primerNombre", "segundoNombre",
          "primerApellido", "segundoApellido", "email", "celular",
          "nivel", "step", "plataforma", "estadoInactivo", "tipoUsuario",
          "contrato", "usuarioId", "peopleId",
          "_createdDate", "_updatedDate"
        ) VALUES (
          $1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, false, 'BENEFICIARIO', $12, $13, $13, NOW(), NOW()
        )`,
        [
          academicId,
          person.numeroId,
          person.primerNombre,
          person.segundoNombre || null,
          person.primerApellido,
          person.segundoApellido || null,
          person.email || null,
          person.celular || null,
          'WELCOME',
          'WELCOME',
          person.plataforma || null,
          effectiveContrato || null,
          personId,
        ]
      );
      academicCreated = true;
      console.log(`✅ [Approve] Registro ACADEMICA creado: ${academicId}`);
    } else {
      console.log(`ℹ️ [Approve] Registro ACADEMICA ya existía: ${academicId}`);
    }
  } else {
    console.log(`ℹ️ [Approve] ${person.tipoUsuario} — se omite creación de ACADEMICA (sólo beneficiarios necesitan registro académico)`);
  }

  // Generar bookings PRECARGADOS en los N eventos del curso del beneficiario.
  // Best-effort + idempotente: si falla NO rompe la aprobación; si un curso aún no
  // tiene eventos generados, simplemente no crea bookings (sin error).
  // ACADEMICA y USUARIOS_ROLES siguen INACTIVOS — el cron los enciende 1 semana
  // antes de inicioCurso. Aquí sólo se dejan listos los agendamientos.
  if (person.tipoUsuario === 'BENEFICIARIO' && academicId) {
    try {
      const creados = await generarBookingsBeneficiario(academicId, {
        campaign: person.campaign,
        tipoCurso: person.tipoCurso,
        horarioCurso: person.horarioCurso,
        numeroId: person.numeroId,
        primerNombre: person.primerNombre,
        primerApellido: person.primerApellido,
        celular: person.celular,
        plataforma: person.plataforma,
      });
      console.log(`✅ [Approve] Bookings precargados para ${person.primerNombre}: ${creados}`);
    } catch (err: any) {
      console.warn(`⚠️ [Approve] No se pudieron generar bookings para ${personId}:`, err?.message || err);
    }
  }

  // Send WhatsApp welcome message — SÓLO a BENEFICIARIOS.
  // El mensaje contiene un link de auto-registro (/nuevo-usuario/{academicId})
  // que sólo aplica a estudiantes. Para TITULARES el academicId es null y el
  // link saldría roto; además los titulares no son usuarios de la plataforma.
  let whatsappSent = false;
  let whatsappError: string | null = null;

  if (person.tipoUsuario !== 'BENEFICIARIO') {
    whatsappError = 'Omitido — los titulares no reciben mensaje de auto-registro';
    console.log(`ℹ️ [Approve] ${person.tipoUsuario} — se omite WhatsApp de bienvenida`);
  } else {
    const celular = person.celular;
    console.log(`📱 [Approve] Celular: "${celular}" (${celular ? celular.length + ' chars' : 'null/undefined'})`);

    if (celular) {
      try {
        const nombre = person.primerNombre || '';
        const message = `Hola ${nombre} 👋:\n\n*¡Eres parte de MOSAICO!* 🎉 \n\nPara terminar tu registro y crear tu usuario sigue este enlace:\n\n${process.env.APP_URL || 'https://lgs-plataforma.com'}/nuevo-usuario/${academicId}\n\nSi tienes alguna pregunta, no dudes en contactarnos.\n\n¡Bienvenido a la familia MOSAICO! 🚀`;
        console.log(`📤 [Approve] Enviando WhatsApp a: ${celular}`);
        const whatsappResult = await sendWhatsAppMessage(celular, message);
        whatsappSent = true;
        console.log(`✅ [Approve] WhatsApp enviado a ${celular}`, whatsappResult);
      } catch (err: any) {
        whatsappError = err.message;
        console.error(`⚠️ [Approve] Error enviando WhatsApp a "${celular}":`, err.message);
      }
    } else {
      whatsappError = 'Sin número de celular registrado';
      console.log(`ℹ️ [Approve] Sin celular, no se envió WhatsApp`);
    }
  }

  return {
    personId,
    nombre: `${person.primerNombre} ${person.primerApellido}`,
    academicId,
    academicCreated,
    whatsappSent,
    whatsappError,
  };
}

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
 *   2. Create ACADEMICA record for titular
 *   3. Send WhatsApp to titular
 *   4. Auto-approve ALL pending beneficiaries (create ACADEMICA + send WhatsApp for each)
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

  // Approve the person themselves
  const mainResult = await approveOnePerson(personId, contrato);

  // ─── TITULAR: also approve all pending beneficiaries ───
  if (person.tipoUsuario === 'TITULAR' && contrato) {
    const pendingBeneficiaries = await queryMany(
      `SELECT "_id" FROM "PEOPLE"
       WHERE "contrato" = $1
         AND "tipoUsuario" = 'BENEFICIARIO'
         AND ("aprobacion" IS NULL OR "aprobacion" != 'Aprobado')`,
      [contrato]
    );

    const titularInicioContrato = person.inicioContrato || null;
    console.log(`👥 [Approve] Titular aprobado. Beneficiarios pendientes encontrados: ${pendingBeneficiaries.length}. inicioContrato a propagar: ${titularInicioContrato}`);
    console.log(`👥 [Approve] IDs de beneficiarios:`, pendingBeneficiaries.map((b: any) => b._id));

    const beneficiaryResults: ApproveResult[] = [];
    for (let i = 0; i < pendingBeneficiaries.length; i++) {
      const ben = pendingBeneficiaries[i];
      console.log(`👤 [Approve] Procesando beneficiario ${i + 1}/${pendingBeneficiaries.length}: ${ben._id}`);
      try {
        const result = await approveOnePerson(ben._id, contrato, titularInicioContrato);
        console.log(`👤 [Approve] Beneficiario ${i + 1} resultado: aprobado=${result.academicCreated}, whatsapp=${result.whatsappSent}, error=${result.whatsappError}`);
        beneficiaryResults.push(result);
      } catch (err: any) {
        console.error(`⚠️ [Approve] Error aprobando beneficiario ${i + 1} (${ben._id}):`, err.message);
        beneficiaryResults.push({
          personId: ben._id,
          nombre: ben._id,
          academicId: null,
          academicCreated: false,
          whatsappSent: false,
          whatsappError: err.message,
        });
      }
    }
    console.log(`👥 [Approve] Resumen: ${beneficiaryResults.filter(r => r.whatsappSent).length}/${beneficiaryResults.length} WhatsApp enviados`);

    return successResponse({
      message: 'Titular y beneficiarios aprobados exitosamente',
      academicId: mainResult.academicId,
      academicCreated: mainResult.academicCreated,
      whatsappSent: mainResult.whatsappSent,
      whatsappError: mainResult.whatsappError,
      titularAutoApproved: false,
      // Beneficiaries approved as part of titular approval
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
