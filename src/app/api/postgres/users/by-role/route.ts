import { NextRequest } from 'next/server';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { queryMany } from '@/lib/postgres';
import { ValidationError } from '@/lib/errors';
import { computePlataformaScope, getSessionPlataforma, buildPlataformaWhereSql } from '@/lib/recaudos-scope';

/**
 * GET /api/postgres/users/by-role?roles=RECAUDOS_ASESOR,RECAUDOS_JEFE&activeOnly=true
 *
 * Lists USUARIOS_ROLES filtered by one or more roles. Used to populate
 * dropdowns where the admin selects a user (e.g. assigning a collection
 * executive to a TITULAR in /person/[id]).
 *
 * Scope multi-tenancy: si el caller logueado tiene rol Recaudos con
 * plataforma asignada, sólo se devuelven candidatos cuya plataforma esté
 * dentro del scope (Chile → solo Chile, Colombia → todo excepto Chile,
 * Internacional/NULL → todo, Ecuador/Perú/etc. → solo su plataforma).
 * SUPER_ADMIN/ADMIN ven todos.
 *
 * Query params:
 *   roles      — comma-separated list of role codes. Required.
 *   activeOnly — when 'true' (default), only returns activo=true rows.
 *
 * Returns: [{ _id, email, nombre, rol, activo }]
 */
export const GET = handlerWithAuth(async (request: NextRequest, _ctx, session) => {
  const { searchParams } = new URL(request.url);
  const rolesParam = (searchParams.get('roles') || '').trim();
  if (!rolesParam) {
    throw new ValidationError('Parámetro "roles" requerido (lista separada por comas)');
  }
  const roles = rolesParam.split(',').map(r => r.trim()).filter(Boolean);
  if (roles.length === 0) {
    throw new ValidationError('Se debe especificar al menos un rol');
  }
  const activeOnly = (searchParams.get('activeOnly') || 'true').toLowerCase() !== 'false';

  const conditions: string[] = [`"rol" = ANY($1)`];
  const params: any[] = [roles];
  let i = 2;
  if (activeOnly) {
    conditions.push(`"activo" = true`);
  }

  // Aplicar scope de plataforma del caller (sólo cuando se piden roles Recaudos).
  const wantsRecaudos = roles.some(r => r === 'RECAUDOS_ASESOR' || r === 'RECAUDOS_JEFE');
  if (wantsRecaudos) {
    const callerRole = ((session.user as any)?.role ?? '').toString();
    const callerEmail = session.user?.email ?? null;
    const callerPlataforma = await getSessionPlataforma(callerEmail);
    const scope = computePlataformaScope(callerRole, callerPlataforma);
    const scopeSql = buildPlataformaWhereSql(scope, '"plataforma"', i);
    if (scopeSql.sql) {
      conditions.push(scopeSql.sql.replace(/^\s*AND\s+/, ''));
      params.push(...scopeSql.params);
      i += scopeSql.params.length;
    }
  }

  const users = await queryMany<{ _id: string; email: string; nombre: string; rol: string; activo: boolean }>(
    `SELECT "_id", "email", "nombre", "rol", "activo"
     FROM "USUARIOS_ROLES"
     WHERE ${conditions.join(' AND ')}
     ORDER BY "nombre" ASC NULLS LAST, "email" ASC`,
    params
  );

  return successResponse({ users, count: users.length });
});
