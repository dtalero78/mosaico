import 'server-only';
import { queryOne } from '@/lib/postgres';
import { Role } from '@/types/permissions';
import { resolverAlcancePorGuia, type AlcancePorGuia } from '@/lib/alcance-guia';

/**
 * Quién es el GUÍA de la sesión, y qué alcance le corresponde.
 *
 * Vive aparte porque lo necesitan varios módulos (Casos de Atención, Reporte
 * Académico, Procesos sin gestión) y estaba copiado en dos servicios: con una
 * copia en cada uno, la primera corrección las desalinea.
 */

/** ¿La sesión es del rol GUIA? (`Role.ADVISOR = 'GUIA'`) */
export const esRolGuia = (session: any): boolean =>
  String((session as any)?.user?.role || '') === Role.ADVISOR;

/**
 * `GUIAS._id` del usuario logueado, resuelto por su EMAIL.
 *
 * ⚠ No sirve `session.user.id`: ese es el `USUARIOS_ROLES._id`, que es una fila
 * DISTINTA de la de GUIAS aunque sea la misma persona (para Liévana:
 * `adv_…241_ruxr` en GUIAS vs `adv_…244_2msr` en USUARIOS_ROLES). Tampoco sirve
 * el nombre: `session.user.name` guarda sólo el nombre de pila
 * ("Liévana Angélica"), no el `nombreCompleto` de GUIAS.
 *
 * El email es lo único estable entre las dos tablas, y es lo que ya usa el resto
 * del sistema para resolver al guía (panel-advisor, by-email).
 */
export async function guiaDeSesion(email?: string | null): Promise<{ _id: string; nombreCompleto: string | null } | null> {
  const e = String(email || '').trim();
  if (!e) return null;
  const g = await queryOne<{ _id: string; nombreCompleto: string | null }>(
    `SELECT "_id", "nombreCompleto" FROM "GUIAS"
      WHERE LOWER(TRIM("email")) = LOWER(TRIM($1)) LIMIT 1`,
    [e]
  );
  return g ?? null;
}

/** Sólo el id; azúcar sobre `guiaDeSesion` para filtrar listados. */
export async function guiaIdDeSesion(email?: string | null): Promise<string | null> {
  return (await guiaDeSesion(email))?._id ?? null;
}

/**
 * Alcance de un listado "por guía" para esta sesión: el rol GUIA ve sólo lo
 * suyo, resuelto con su correo; los demás roles ven todo y eligen el guía.
 * La regla está en `lib/alcance-guia`; aquí sólo se busca la ficha del guía.
 */
export async function alcancePorGuia(session: any, guiaPedido?: string | null): Promise<AlcancePorGuia> {
  const esGuia = esRolGuia(session);
  return resolverAlcancePorGuia({
    esGuia,
    guiaDeSesion: esGuia ? await guiaIdDeSesion((session as any)?.user?.email) : null,
    guiaPedido,
  });
}
