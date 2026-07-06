import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { ValidationError } from '@/lib/errors';
import { AcademicaRepository } from '@/repositories/academica.repository';
import { UsuariosRolesRepository } from '@/repositories/roles.repository';
import { hashPassword } from '@/lib/password';

/**
 * PUT /api/postgres/students/[id]/change-password
 *
 * Update student login password in both ACADEMICA.clave and USUARIOS_ROLES.password
 */
export const PUT = handlerWithAuth(async (request, { params }) => {
  const { password } = await request.json();
  if (!password || typeof password !== 'string' || password.length < 4) {
    throw new ValidationError('La clave debe tener al menos 4 caracteres');
  }

  const studentId = params.id;

  // SEC-PLAINTEXT-PW-09: cifrar antes de guardar (login valida bcrypt+plano).
  const hashed = await hashPassword(password);

  // Update ACADEMICA.clave
  const updated = await AcademicaRepository.updateClave(studentId, hashed);
  if (!updated) throw new ValidationError('Estudiante no encontrado en ACADEMICA');

  // Find email in ACADEMICA to update USUARIOS_ROLES
  const profile = await AcademicaRepository.findById(studentId);
  if (profile?.email) {
    await UsuariosRolesRepository.updatePassword(profile.email, hashed);
  }

  return successResponse({ message: 'Clave actualizada correctamente' });
});
