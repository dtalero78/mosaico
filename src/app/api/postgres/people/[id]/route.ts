import { NextRequest } from 'next/server';
import { query, queryOne, queryMany, parseJsonbFields } from '@/lib/postgres';
import { handler, handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { buildDynamicUpdate } from '@/lib/query-builder';

/**
 * GET /api/postgres/people/[id]
 *
 * Get a person by ID with all their data
 * Returns person data, financial data (if contract exists), and related persons
 */
export const GET = handler(async (
  request: Request,
  { params }: { params: Record<string, string> }
) => {
  const personId = params.id;
  console.log('🔍 [PostgreSQL People] Getting person by ID:', personId);

  // Get person by _id
  const person = await queryOne(
    `SELECT * FROM "PEOPLE" WHERE "_id" = $1`,
    [personId]
  );

  if (!person) throw new NotFoundError('Person', personId);

  // Parse JSONB fields
  const parsedPerson = parseJsonbFields(person, [
    'onHoldHistory',
    'extensionHistory',
    'documentacion',
  ]);

  console.log('✅ [PostgreSQL People] Found person:', {
    id: parsedPerson?._id,
    nombre: `${parsedPerson?.primerNombre} ${parsedPerson?.primerApellido}`,
    tipoUsuario: parsedPerson?.tipoUsuario,
  });

  // Campaña: los beneficiarios la traen en su fila; el TITULAR la toma de un
  // beneficiario de su contrato (para mostrarla en la ficha).
  if (!parsedPerson.campaign && parsedPerson?.contrato) {
    try {
      const camp = await queryOne(
        `SELECT "campaign" FROM "PEOPLE"
         WHERE "contrato" = $1 AND "tipoUsuario" = 'BENEFICIARIO' AND "campaign" IS NOT NULL LIMIT 1`,
        [parsedPerson.contrato]
      );
      if (camp?.campaign) parsedPerson.campaign = camp.campaign;
    } catch (e) { /* non-critical */ }
  }

  // Look up login password from USUARIOS_ROLES by email
  if (parsedPerson?.email) {
    try {
      const userLogin = await queryOne(
        `SELECT "password" FROM "USUARIOS_ROLES" WHERE "email" = $1`,
        [parsedPerson.email]
      );
      if (userLogin?.password) {
        const isBcrypt = userLogin.password.startsWith('$2a$') || userLogin.password.startsWith('$2b$') || userLogin.password.startsWith('$2y$');
        parsedPerson.claveLogin = isBcrypt ? '(Encriptada)' : userLogin.password;
      }
    } catch (e) {
      // Non-critical
    }
  }

  // Get financial data if contract exists
  let financialData = null;
  if (parsedPerson?.contrato) {
    const financial = await queryOne(
      `SELECT * FROM "FINANCIEROS" WHERE "contrato" = $1 ORDER BY "_createdDate" DESC LIMIT 1`,
      [parsedPerson.contrato]
    );
    if (financial) {
      financialData = financial;
      console.log('✅ [PostgreSQL People] Found financial data for contract:', parsedPerson.contrato);
    }
  }

  // Get related persons (beneficiaries or titular)
  let relatedPersons: any[] = [];
  try {
    if (parsedPerson?.tipoUsuario === 'TITULAR') {
      // Get beneficiaries for this titular
      const beneficiaries = await queryMany(
        `SELECT
          "_id",
          "numeroId",
          "primerNombre",
          "segundoNombre",
          "primerApellido",
          "segundoApellido",
          "celular",
          "telefono",
          "email",
          "fechaNacimiento",
          "domicilio",
          "ciudad",
          "apoderado",
          "apoderadoTelefono",
          "apoderadoMail",
          "estadoInactivo",
          "aprobacion",
          "nivel",
          "step",
          "tipoCurso",
          "salon",
          "horarioCurso",
          "campaign",
          "_createdDate"
        FROM "PEOPLE"
        WHERE "contrato" = $1
          AND "tipoUsuario" = 'BENEFICIARIO'
        ORDER BY "primerNombre" ASC`,
        [parsedPerson.contrato]
      );

      // Check if each beneficiary exists in ACADEMICA
      for (const ben of beneficiaries) {
        const academicCheck = await queryOne(
          `SELECT "_id" FROM "ACADEMICA" WHERE "numeroId" = $1 LIMIT 1`,
          [ben.numeroId]
        );

        const nombreCompleto = [
          ben.primerNombre,
          ben.segundoNombre,
          ben.primerApellido,
          ben.segundoApellido,
        ]
          .filter(Boolean)
          .join(' ');

        relatedPersons.push({
          _id: ben._id,
          academicaId: academicCheck?._id || null,
          numeroId: ben.numeroId,
          nombreCompleto,
          primerNombre: ben.primerNombre,
          segundoNombre: ben.segundoNombre,
          primerApellido: ben.primerApellido,
          segundoApellido: ben.segundoApellido,
          celular: ben.celular || ben.telefono || '',
          email: ben.email,
          fechaNacimiento: ben.fechaNacimiento,
          domicilio: ben.domicilio,
          ciudad: ben.ciudad,
          apoderado: ben.apoderado,
          apoderadoTelefono: ben.apoderadoTelefono,
          apoderadoMail: ben.apoderadoMail,
          estadoInactivo: ben.estadoInactivo || false,
          aprobacion: ben.aprobacion,
          nivel: ben.nivel,
          tipoCurso: ben.tipoCurso,
          salon: ben.salon,
          horarioCurso: ben.horarioCurso,
          campaign: ben.campaign,
          existeEnAcademica: !!academicCheck,
          _createdDate: ben._createdDate,
        });
      }
      console.log('✅ [PostgreSQL People] Found', relatedPersons.length, 'beneficiaries');
    } else if (parsedPerson?.tipoUsuario === 'BENEFICIARIO' && parsedPerson?.contrato) {
      // Get titular for this beneficiary
      const titular = await queryOne(
        `SELECT
          "_id",
          "numeroId",
          "primerNombre",
          "segundoNombre",
          "primerApellido",
          "segundoApellido",
          "celular",
          "telefono",
          "estadoInactivo",
          "aprobacion",
          "_createdDate"
        FROM "PEOPLE"
        WHERE "contrato" = $1
          AND "tipoUsuario" = 'TITULAR'
        LIMIT 1`,
        [parsedPerson.contrato]
      );

      if (titular) {
        const nombreCompleto = [
          titular.primerNombre,
          titular.segundoNombre,
          titular.primerApellido,
          titular.segundoApellido,
        ]
          .filter(Boolean)
          .join(' ');

        relatedPersons.push({
          _id: titular._id,
          numeroId: titular.numeroId,
          nombreCompleto,
          celular: titular.celular || titular.telefono || '',
          estadoInactivo: titular.estadoInactivo || false,
          aprobacion: titular.aprobacion,
          _createdDate: titular._createdDate,
          isTitular: true,
        });
        console.log('✅ [PostgreSQL People] Found titular:', nombreCompleto);
      }
    }
  } catch (error) {
    console.error('⚠️ [PostgreSQL People] Error fetching related persons:', error);
    // Don't fail the whole request, just return empty related persons
  }

  return successResponse({
    person: parsedPerson,
    financialData,
    relatedPersons,
  });
});

// Allowed fields for PATCH updates
const PEOPLE_UPDATE_FIELDS = [
  'primerNombre',
  'segundoNombre',
  'primerApellido',
  'segundoApellido',
  'email',
  'celular',
  'telefono',
  'fechaNacimiento',
  'domicilio',
  'ciudad',
  'apoderado',
  'apoderadoTelefono',
  'apoderadoMail',
  'nivel',
  'step',
  'nivelParalelo',
  'stepParalelo',
  'plataforma',
  'estadoInactivo',
  'estado',
  'aprobacion',
  'observaciones',
  'vigencia',
  'finalContrato',
  'inicioCurso',
  'gestorRecaudo',
];

/**
 * PATCH /api/postgres/people/[id]
 *
 * Update a person's data
 */
export const PATCH = handlerWithAuth(async (
  request: Request,
  { params }: { params: Record<string, string> }
) => {
  const personId = params.id;
  const body = await request.json();

  console.log('🔄 [PostgreSQL People] Updating person:', personId);

  // ── Validación de plan (Tipo Plan en PEOPLE.plan) ──
  // Solo se aceptan: 'Contado', 'Credito', 'Colaborador', null o '' (limpiar).
  if (body.plan !== undefined && body.plan !== null && body.plan !== '') {
    const VALID_PLAN = ['Contado', 'Credito', 'Colaborador'];
    if (!VALID_PLAN.includes(String(body.plan).trim())) {
      throw new ValidationError(`plan debe ser uno de: ${VALID_PLAN.join(', ')}`);
    }
  }

  // Fetch current person before update (needed for old email to update USUARIOS_ROLES)
  const currentPerson = await queryOne<{
    email: string | null;
    numeroId: string | null;
    tipoUsuario: string | null;
    aprobacion: string | null;
    estado: string | null;
    contrato: string | null;
  }>(
    `SELECT "email", "numeroId", "tipoUsuario", "aprobacion", "estado", "contrato" FROM "PEOPLE" WHERE "_id" = $1`,
    [personId]
  );
  if (!currentPerson) throw new NotFoundError('Person', personId);

  // ── Validación de cambio de aprobación ──
  // Una vez aprobado un contrato:
  //   - 'Contrato nulo' / 'Devuelto' / 'Rechazado' quedan BLOQUEADOS
  //     (esos estados sólo aplican pre-aprobación).
  //   - 'Pendiente' y 'Retractado' SÍ se permiten (con alerta en frontend).
  // Pre-aprobación cualquier transición es libre.
  if (body.aprobacion && currentPerson.aprobacion === 'Aprobado') {
    const blockedPostApproval = ['Contrato nulo', 'Devuelto', 'Rechazado'];
    if (blockedPostApproval.includes(body.aprobacion)) {
      // Chequeos de contexto: estado operativo + beneficiarios académicos
      const estadoActual = currentPerson.estado ?? '';
      const reasons: string[] = [];
      if (estadoActual === 'On Hold')         reasons.push('está en OnHold');
      if (estadoActual === 'CON EXTENSION')   reasons.push('tiene una extensión activa');

      let benefAcademica = 0;
      if (currentPerson.contrato) {
        const benefRow = await queryOne<{ count: string }>(
          `SELECT COUNT(*)::text AS count
           FROM "ACADEMICA" a
           JOIN "PEOPLE" p ON p."numeroId" = a."numeroId" AND p."tipoUsuario" = 'BENEFICIARIO'
           WHERE p."contrato" = $1`,
          [currentPerson.contrato]
        );
        benefAcademica = parseInt(benefRow?.count ?? '0', 10) || 0;
      }
      if (benefAcademica > 0) {
        reasons.push(`tiene ${benefAcademica} beneficiario(s) con registro académico creado`);
      }

      throw new ValidationError(
        `No se puede cambiar la aprobación a "${body.aprobacion}" después de aprobar el contrato. ` +
        `Estados "Contrato nulo", "Devuelto" y "Rechazado" sólo aplican antes de aprobar. ` +
        `Usa "Retractado" si necesitas anular post-aprobación.` +
        (reasons.length ? ` Además: el contrato ${reasons.join(' y ')}.` : '')
      );
    }
  }

  // Validate gestorRecaudo assignment:
  //   - Only allowed on TITULAR rows
  //   - Value must reference an existing USUARIOS_ROLES._id with rol IN
  //     ('RECAUDO_ASIST', 'RECAUDOS_JEFE') and activo=true.
  //   - null/empty clears the assignment (allowed).
  if (Object.prototype.hasOwnProperty.call(body, 'gestorRecaudo')) {
    if (currentPerson.tipoUsuario !== 'TITULAR') {
      throw new ValidationError('Solo se puede asignar gestor de recaudo a TITULARES');
    }
    const value = body.gestorRecaudo;
    if (value !== null && value !== '') {
      const user = await queryOne<{ rol: string; activo: boolean }>(
        `SELECT "rol", "activo" FROM "USUARIOS_ROLES" WHERE "_id" = $1`,
        [value]
      );
      if (!user) throw new ValidationError(`Usuario no encontrado: ${value}`);
      if (!user.activo) throw new ValidationError('El usuario seleccionado no está activo');
      if (!['RECAUDO_ASIST', 'RECAUDOS_JEFE'].includes(user.rol)) {
        throw new ValidationError(`Rol inválido para gestor de recaudo: ${user.rol}`);
      }
    } else {
      // Normalize empty string to null for clearing
      body.gestorRecaudo = null;
    }
  }

  // Auto-mapear aprobacion → estado operativo si el caller no envió estado
  // explícito. Aprobado=ACTIVA, Pendiente=PENDIENTE, Retractado=RETRACTADO,
  // Contrato nulo/Devuelto/Rechazado=ANULADO.
  if (body.aprobacion && body.estado === undefined) {
    const APROBACION_TO_ESTADO: Record<string, string> = {
      'Aprobado':       'ACTIVA',
      'Pendiente':      'PENDIENTE',
      'Retractado':     'RETRACTADO',
      'Contrato nulo':  'ANULADO',
      'Devuelto':       'ANULADO',
      'Rechazado':      'ANULADO',
    };
    const mapped = APROBACION_TO_ESTADO[body.aprobacion as string];
    if (mapped) body.estado = mapped;
  }

  const built = buildDynamicUpdate('PEOPLE', body, PEOPLE_UPDATE_FIELDS);
  if (!built) throw new ValidationError('No valid fields to update');

  // Add person ID as last parameter
  built.values.push(personId);

  const result = await queryOne(built.query, built.values);
  if (!result) throw new NotFoundError('Person', personId);

  // Parse JSONB fields
  const parsedPerson = parseJsonbFields(result, [
    'onHoldHistory',
    'extensionHistory',
  ]);

  // Sync email and celular to ACADEMICA and USUARIOS_ROLES
  const syncingEmail = body.email && body.email !== currentPerson.email;
  const syncingCelular = body.celular !== undefined;

  if ((syncingEmail || syncingCelular) && currentPerson.numeroId) {
    const academicaFields: string[] = [];
    const academicaValues: any[] = [];
    if (syncingEmail) { academicaFields.push(`"email" = $${academicaFields.length + 1}`); academicaValues.push(body.email); }
    if (syncingCelular) { academicaFields.push(`"celular" = $${academicaFields.length + 1}`); academicaValues.push(body.celular); }
    academicaValues.push(currentPerson.numeroId);
    await query(
      `UPDATE "ACADEMICA" SET ${academicaFields.join(', ')}, "_updatedDate" = NOW() WHERE "numeroId" = $${academicaValues.length}`,
      academicaValues
    );
    console.log('🔄 [PostgreSQL People] Synced to ACADEMICA');
  }

  if (syncingEmail && currentPerson.email) {
    await query(
      `UPDATE "USUARIOS_ROLES" SET "email" = $1 WHERE LOWER("email") = LOWER($2)`,
      [body.email, currentPerson.email]
    );
    console.log('🔄 [PostgreSQL People] Synced email to USUARIOS_ROLES');
  }

  // If estado changed to Contrato nulo / Devuelto / Rechazado → inactivate titular + beneficiaries
  const INACTIVE_STATES = ['Contrato nulo', 'Devuelto', 'Rechazado'];
  let beneficiariesInactivated = 0;

  if (body.aprobacion && INACTIVE_STATES.includes(body.aprobacion) && parsedPerson.contrato) {
    // Mark the titular as inactive
    await query(
      `UPDATE "PEOPLE" SET "estadoInactivo" = true, "_updatedDate" = NOW() WHERE "_id" = $1`,
      [personId]
    );
    parsedPerson.estadoInactivo = true;

    // Mark all beneficiaries of this contract as inactive
    const inactiveResult = await query(
      `UPDATE "PEOPLE"
       SET "estadoInactivo" = true, "_updatedDate" = NOW()
       WHERE "contrato" = $1 AND "tipoUsuario" = 'BENEFICIARIO'`,
      [parsedPerson.contrato]
    );
    beneficiariesInactivated = inactiveResult.rowCount || 0;

    console.log(`🔴 [PostgreSQL People] Estado "${body.aprobacion}": titular + ${beneficiariesInactivated} beneficiarios marcados como inactivos`);
  }

  console.log('✅ [PostgreSQL People] Person updated successfully');

  return successResponse({ person: parsedPerson, beneficiariesInactivated });
});

/**
 * DELETE /api/postgres/people/[id]
 *
 * Delete a BENEFICIARIO from PEOPLE (and their ACADEMICA record if exists).
 * Only BENEFICIARIO type persons can be deleted via this endpoint.
 */
export const DELETE = handlerWithAuth(async (
  _request: Request,
  { params }: { params: Record<string, string> }
) => {
  const personId = params.id;

  const person = await queryOne(
    `SELECT "_id", "numeroId", "tipoUsuario" FROM "PEOPLE" WHERE "_id" = $1`,
    [personId]
  );

  if (!person) throw new NotFoundError('Person', personId);
  if (person.tipoUsuario !== 'BENEFICIARIO') {
    throw new ValidationError('Solo se pueden eliminar registros de tipo BENEFICIARIO');
  }

  // Delete from ACADEMICA if exists
  await query(`DELETE FROM "ACADEMICA" WHERE "numeroId" = $1`, [person.numeroId]);

  // Delete from PEOPLE
  await query(`DELETE FROM "PEOPLE" WHERE "_id" = $1`, [personId]);

  console.log('✅ [PostgreSQL People] Beneficiario deleted:', personId);

  return successResponse({ deleted: true, personId });
});
