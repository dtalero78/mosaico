import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { ValidationError } from '@/lib/errors';
import { AcademicaRepository } from '@/repositories/academica.repository';
import { query, queryOne } from '@/lib/postgres';
import { ids } from '@/lib/id-generator';

/**
 * PUT /api/postgres/students/[id]/change-password   ([id] = ACADEMICA._id)
 *
 * "Clave Login" de la ficha del alumno: guarda la clave en ACADEMICA.clave y en
 * SU cuenta de acceso (USUARIOS_ROLES).
 *
 * ⚠ La cuenta se busca por IDENTIDAD —el userLogin de esta ficha, o el documento—,
 * nunca por correo. Antes se actualizaba por correo, y como los hermanos comparten
 * el del apoderado, ponerle clave a un hermano se la cambiaba también al otro. Si
 * el alumno no tenía cuenta propia, la única con ese correo era la del hermano, y
 * la clave terminaba SÓLO en la cuenta ajena (caso JEAN PIERRE / AARON REYES,
 * 13-oct-2026).
 *
 * Si el alumno no tiene cuenta, se le crea aquí con esta clave: es lo que espera
 * quien le está asignando una clave para que pueda entrar.
 */
export const PUT = handlerWithAuth(async (request, { params }) => {
  const { password } = await request.json();
  if (!password || typeof password !== 'string' || password.length < 4) {
    throw new ValidationError('La clave debe tener al menos 4 caracteres');
  }

  const studentId = params.id;

  const updated = await AcademicaRepository.updateClave(studentId, password);
  if (!updated) throw new ValidationError('Estudiante no encontrado en ACADEMICA');

  const a = await queryOne<any>(
    `SELECT "_id","numeroId","userLogin","email","primerNombre","primerApellido","contrato","plataforma","celular"
       FROM "ACADEMICA" WHERE "_id" = $1`, [studentId]);
  const userLogin = String(a?.userLogin || '').trim();
  const numeroId = String(a?.numeroId || '').trim();

  const r = await query(
    `UPDATE "USUARIOS_ROLES" SET "password" = $1, "_updatedDate" = NOW()
      WHERE ($2 <> '' AND "userLogin" = $2)
         OR ($2 = '' AND $3 <> '' AND UPPER(TRIM("numberid")) = UPPER(TRIM($3)))`,
    [password, userLogin, numeroId]);
  if ((r.rowCount ?? 0) > 0) {
    return successResponse({ message: 'Clave actualizada correctamente', cuentaCreada: false });
  }

  // Sin cuenta propia: se crea. Sin userLogin no se puede (es la identidad del login).
  if (!userLogin) {
    return successResponse({
      message: 'Clave guardada en la ficha, pero el alumno no tiene usuario de ingreso: no se pudo crear su cuenta.',
      cuentaCreada: false,
    });
  }
  const ben = numeroId ? await queryOne<{ estadoInactivo: boolean | null }>(
    `SELECT "estadoInactivo" FROM "PEOPLE" WHERE "numeroId" = $1 AND "tipoUsuario" IN ('BENEFICIARIO','BENEFICIARIA') LIMIT 1`,
    [numeroId]) : null;
  const nombre = [a?.primerNombre, a?.primerApellido].map((s: any) => String(s || '').trim()).filter(Boolean).join(' ');
  await query(
    `INSERT INTO "USUARIOS_ROLES"
       ("_id","email","password","nombre","rol","activo","numberid","contrato","plataforma","celular","userLogin","origen","_createdDate","_updatedDate")
     VALUES ($1,$2,$3,$4,'ESTUDIANTE',$5,$6,$7,$8,$9,$10,'ADMIN',NOW(),NOW())`,
    [ids.person(), (a?.email || `${userLogin}@est.mosaico.cl`).trim().toLowerCase(), password, nombre,
     ben?.estadoInactivo !== true, numeroId || null, a?.contrato || null, a?.plataforma || null, a?.celular || null, userLogin]);

  return successResponse({ message: 'Clave guardada y cuenta de acceso creada', cuentaCreada: true });
});
