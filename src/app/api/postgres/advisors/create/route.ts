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

  // Check duplicate email
  const existing = await AdvisorRepository.findByEmail(email.trim().toLowerCase());
  if (existing) throw new ConflictError('Ya existe un advisor con ese email');

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
  });

  // Also create USUARIOS_ROLES entry so the advisor can log in
  const password = body.clave?.trim() || 'LGS2026';
  await queryOne(
    `INSERT INTO "USUARIOS_ROLES" ("_id", "email", "password", "nombre", "rol", "activo", "numberid", "_createdDate", "_updatedDate")
     VALUES ($1, $2, $3, $4, 'ADVISOR', true, $5, NOW(), NOW())
     ON CONFLICT ("email") DO NOTHING`,
    [ids.advisor(), email.trim().toLowerCase(), password, nombreCompleto, body.numeroId?.trim().toUpperCase() || null]
  );

  return successResponse({ advisor, message: 'Advisor creado exitosamente' });
});
