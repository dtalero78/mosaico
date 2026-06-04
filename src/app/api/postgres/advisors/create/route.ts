import 'server-only';
import { handler, successResponse } from '@/lib/api-helpers';
import { ValidationError, ConflictError } from '@/lib/errors';
import { AdvisorRepository } from '@/repositories/advisor.repository';
import { ids } from '@/lib/id-generator';
import { queryOne } from '@/lib/postgres';

/**
 * POST /api/postgres/advisors/create
 * Creates a new advisor in the ADVISORS table and optionally in USUARIOS_ROLES.
 */
export const POST = handler(async (request: Request) => {
  const body = await request.json();

  const { primerNombre, primerApellido, email } = body;
  if (!primerNombre?.trim()) throw new ValidationError('primerNombre es requerido');
  if (!primerApellido?.trim()) throw new ValidationError('primerApellido es requerido');
  if (!email?.trim()) throw new ValidationError('email es requerido');
  // Foto obligatoria — body.fotoKey es la key del archivo en DO Spaces
  // (la sube el frontend via /api/postgres/advisors/photo-presign-public).
  if (!body.fotoKey?.trim()) throw new ValidationError('La foto de perfil es obligatoria');

  const emailLower = email.trim().toLowerCase();
  const numeroIdNorm = body.numeroId?.trim().toUpperCase() || null;
  const zoomNorm = body.zoom?.trim() || null;

  // --- Validación de duplicados (3 dimensiones) ---
  // Mensaje específico para que el usuario sepa qué campo limpiar.

  // 1) Email — en ADVISORS o USUARIOS_ROLES (cualquiera de las dos lo bloquea)
  const advByEmail = await AdvisorRepository.findByEmail(emailLower);
  if (advByEmail) throw new ConflictError('Ya existe un advisor registrado con ese correo');

  const userByEmail = await queryOne<{ _id: string; nombre: string | null; rol: string }>(
    `SELECT "_id","nombre","rol" FROM "USUARIOS_ROLES"
      WHERE LOWER(TRIM("email")) = LOWER(TRIM($1)) LIMIT 1`,
    [emailLower]
  );
  if (userByEmail) {
    throw new ConflictError(
      `Ese correo ya está en uso por otro usuario (rol ${userByEmail.rol}${userByEmail.nombre ? ' — ' + userByEmail.nombre : ''})`
    );
  }

  // 2) Número de identificación — verificar en USUARIOS_ROLES.numberid
  if (numeroIdNorm) {
    const userByNumeroId = await queryOne<{ _id: string; nombre: string | null; email: string; rol: string }>(
      `SELECT "_id","nombre","email","rol" FROM "USUARIOS_ROLES"
        WHERE UPPER(TRIM("numberid")) = UPPER(TRIM($1)) LIMIT 1`,
      [numeroIdNorm]
    );
    if (userByNumeroId) {
      throw new ConflictError(
        `Ya existe un usuario con ese número de identificación (rol ${userByNumeroId.rol}${userByNumeroId.nombre ? ' — ' + userByNumeroId.nombre : ''})`
      );
    }
  }

  // 3) Link de Zoom — debe ser único en ADVISORS (no se valida en USUARIOS_ROLES;
  // el campo linkZoom de ahí no se usa como fuente de verdad).
  if (zoomNorm) {
    const advByZoom = await queryOne<{ _id: string; nombreCompleto: string | null }>(
      `SELECT "_id","nombreCompleto" FROM "ADVISORS"
        WHERE TRIM("zoom") = TRIM($1) LIMIT 1`,
      [zoomNorm]
    );
    if (advByZoom) {
      throw new ConflictError(
        `Ese link de Zoom ya está asignado a otro advisor${advByZoom.nombreCompleto ? ' (' + advByZoom.nombreCompleto + ')' : ''}`
      );
    }
  }

  const nombreCompleto = [primerNombre, primerApellido].map(s => s.trim()).join(' ');

  const advisorId = ids.advisor();
  const advisor = await AdvisorRepository.create({
    _id: advisorId,
    primerNombre: primerNombre.trim(),
    primerApellido: primerApellido.trim(),
    nombreCompleto,
    email: email.trim().toLowerCase(),
    zoom: body.zoom?.trim() || undefined,
    telefono: body.telefono?.trim() || undefined,
    pais: body.pais?.trim() || undefined,
    domicilio: body.domicilio?.trim() || undefined,
    fotoAdvisor: body.fotoKey?.trim() || undefined,
    fechaNacimiento: body.fechaNacimiento?.trim() || undefined,
  });

  // Also create USUARIOS_ROLES entry so the advisor can log in
  const password = body.clave?.trim() || 'LGS2026';
  const inserted = await queryOne<{ _id: string }>(
    `INSERT INTO "USUARIOS_ROLES" ("_id", "email", "password", "nombre", "rol", "activo", "numberid", "_createdDate", "_updatedDate")
     VALUES ($1, $2, $3, $4, 'ADVISOR', true, $5, NOW(), NOW())
     ON CONFLICT ("email") DO NOTHING
     RETURNING "_id"`,
    [ids.advisor(), emailLower, password, nombreCompleto, numeroIdNorm]
  );

  // Relación formal ADVISORS -> USUARIOS_ROLES (análoga a ACADEMICA.usuarioId).
  // Si hubo conflicto (la cuenta ya existía), resolvemos su _id por email.
  let usuarioRolId = inserted?._id ?? null;
  if (!usuarioRolId) {
    const existing = await queryOne<{ _id: string }>(
      `SELECT "_id" FROM "USUARIOS_ROLES" WHERE LOWER("email") = LOWER($1) LIMIT 1`,
      [emailLower]
    );
    usuarioRolId = existing?._id ?? null;
  }
  if (usuarioRolId) {
    await queryOne(
      `UPDATE "ADVISORS" SET "usuarioRolId" = $1, "_updatedDate" = NOW() WHERE "_id" = $2`,
      [usuarioRolId, advisorId]
    );
  }

  return successResponse({ advisor: { ...(advisor as any), usuarioRolId }, message: 'Advisor creado exitosamente' });
});
