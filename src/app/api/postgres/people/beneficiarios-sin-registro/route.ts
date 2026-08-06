import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { queryMany } from '@/lib/postgres';

/**
 * GET /api/postgres/people/beneficiarios-sin-registro
 *
 * Beneficiarios que AÚN NO completaron su perfil vía `/nuevo-usuario` (no han
 * puesto sus respuestas/clave). Señal: su cuenta de login (USUARIOS_ROLES,
 * enlazada por `userLogin`) tiene `perfilActualizado IS NULL`.
 * Excluye contratos de prueba (PRB-).
 */
export const GET = handlerWithAuth(async (request) => {
  const { searchParams } = new URL(request.url);
  const contrato = searchParams.get('contrato');

  const conditions: string[] = [
    `p."tipoUsuario" = 'BENEFICIARIO'`,
    `u."perfilActualizado" IS NULL`,
    `COALESCE(p."contrato",'') NOT LIKE 'PRB-%'`,
  ];
  const values: any[] = [];
  let idx = 1;

  if (contrato) { conditions.push(`p."contrato" = $${idx}`); values.push(contrato); idx++; }

  const beneficiarios = await queryMany(
    `SELECT p.*, u."perfilActualizado", NULL as "hasAcademicRecord"
     FROM "PEOPLE" p
     JOIN "USUARIOS_ROLES" u ON u."userLogin" = p."userLogin"
     WHERE ${conditions.join(' AND ')}
     ORDER BY p."_createdDate" DESC, p."primerApellido", p."primerNombre"`,
    values
  );

  return successResponse({
    beneficiarios,
    count: beneficiarios.length,
    message: beneficiarios.length === 0
      ? 'Todos los beneficiarios completaron su perfil'
      : `${beneficiarios.length} beneficiarios sin completar su perfil`,
  });
});
