import 'server-only';
import { Session } from 'next-auth';
import { tienePermiso } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';

/**
 * ¿Este usuario puede agendar por encima del cupo del evento?
 *
 * Vive aparte porque lo preguntan los dos endpoints que agendan de a uno
 * (la ficha del alumno y el reagendamiento de Welcome) y la respuesta tiene que
 * ser la misma en los dos. La casilla del modal viaja en el body, pero el
 * permiso se resuelve SIEMPRE con la sesión: si dependiera del body, marcarla
 * bastaría para saltarse el cupo.
 */
export function autorizaSobrecupo(session: Session | null): Promise<boolean> {
  return tienePermiso(session, AcademicoPermission.SOBRECUPO_AUTORIZAR);
}
