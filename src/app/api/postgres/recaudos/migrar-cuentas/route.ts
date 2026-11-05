import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { RecaudosPermission } from '@/types/permissions';
import { queryOne, withTransaction } from '@/lib/postgres';
import { ValidationError } from '@/lib/errors';
import {
  computePlataformaScope,
  getSessionPlataforma,
  buildPlataformaWhereSql,
} from '@/lib/recaudos-scope';

/**
 * Migración de cartera entre gestores de recaudo.
 *
 * Caso de uso: un gestor se retira y hay que pasarle TODA su cartera a otro.
 * Hoy eso solo se puede hacer titular por titular.
 *
 * GET  ?origen=<usuarioRolId>   → preview: qué se migraría (no escribe)
 * POST { origen, destino, migrarPagosPendientes }
 *
 * Qué se migra:
 *   - PEOPLE.gestorRecaudo de los TITULARES  → siempre (es la cartera)
 *   - PAGOS_TITULARES.gestorRecaudo          → SOLO los pagos NO validados, y
 *     solo si se pide. Los pagos ya validados NO se tocan nunca: ese campo es
 *     el registro de quién gestionó ese pago concreto, no una asignación viva.
 *
 * Scope: respeta el multi-tenancy por plataforma de Recaudos — un jefe de Chile
 * no puede mover cartera de otra plataforma aunque mande los ids a mano.
 *
 * Gateado por RECAUDOS.ASIGNACION.MIGRAR.
 */

const ROLES_GESTOR = ['RECAUDOS_ASESOR', 'RECAUDOS_JEFE']; // en MOSAICO el asistente es RECAUDOS_ASESOR

type GestorRow = { _id: string; nombre: string | null; rol: string; activo: boolean };

/** Carga y valida un gestor. `exigirActivo` solo aplica al destino: el origen
 *  suele estar INACTIVO — es justamente el que se retiró. */
async function cargarGestor(id: string, etiqueta: string, exigirActivo: boolean): Promise<GestorRow> {
  const g = await queryOne<GestorRow>(
    `SELECT "_id", "nombre", "rol", "activo" FROM "USUARIOS_ROLES" WHERE "_id" = $1`,
    [id],
  );
  if (!g) throw new ValidationError(`Gestor ${etiqueta} no encontrado`);
  if (!ROLES_GESTOR.includes(g.rol)) {
    throw new ValidationError(`El gestor ${etiqueta} no tiene rol de recaudos (${g.rol})`);
  }
  if (exigirActivo && !g.activo) {
    throw new ValidationError(`El gestor ${etiqueta} está inactivo: no se le puede asignar cartera`);
  }
  return g;
}

/**
 * Scope de plataforma del usuario logueado, como SQL reusable.
 * OJO con el shape: en NextAuth el email y el rol viven en session.user, NO
 * en la raíz. Leerlos de la raíz devuelve undefined -> scope nulo -> se vería
 * (y migraría) la cartera de TODAS las plataformas.
 */
async function scopeSql(session: any, paramIndex: number) {
  const email: string | null = session?.user?.email ?? null;
  const role: string = (session?.user?.role ?? '').toString();
  const plataforma = await getSessionPlataforma(email);
  const scope = computePlataformaScope(role, plataforma);
  return buildPlataformaWhereSql(scope, 'p."plataforma"', paramIndex);
}

/**
 * GET — preview. Cuántos titulares y pagos pendientes tiene el gestor origen
 * DENTRO del scope de quien consulta (lo que realmente se migraría).
 */
export const GET = handlerWithAuth(async (req, _ctx, session) => {
  await requirePermission(session, RecaudosPermission.ASIGNACION_MIGRAR);

  const origen = (new URL(req.url).searchParams.get('origen') || '').trim();
  if (!origen) throw new ValidationError('Falta el gestor de origen');

  const gestor = await cargarGestor(origen, 'de origen', false);
  const scope = await scopeSql(session, 2);

  const row = await queryOne<{ titulares: number; pagos_pendientes: number; pagos_validados: number }>(
    `SELECT
       COUNT(*)::int AS titulares,
       -- Se cuenta SOLO lo que el POST va a mover: pagos cuyo gestorRecaudo
       -- es el origen. Un titular puede arrastrar pagos registrados por
       -- gestores anteriores; esos NO se migran y no deben inflar el preview.
       COALESCE(SUM((SELECT COUNT(*) FROM "PAGOS_TITULARES" pt
                      WHERE pt."idPeople" = p."_id" AND pt."gestorRecaudo" = $1
                        AND pt."validado" IS NOT TRUE)), 0)::int AS pagos_pendientes,
       COALESCE(SUM((SELECT COUNT(*) FROM "PAGOS_TITULARES" pt
                      WHERE pt."idPeople" = p."_id" AND pt."gestorRecaudo" = $1
                        AND pt."validado" IS TRUE)), 0)::int AS pagos_validados
     FROM "PEOPLE" p
     WHERE p."gestorRecaudo" = $1
       AND p."tipoUsuario" = 'TITULAR'${scope.sql}`,
    [origen, ...scope.params],
  );

  return successResponse({
    gestor: { _id: gestor._id, nombre: gestor.nombre, rol: gestor.rol, activo: gestor.activo },
    titulares: row?.titulares ?? 0,
    pagosPendientes: row?.pagos_pendientes ?? 0,
    // Informativo: estos NO se migran (son el histórico de quién validó).
    pagosValidados: row?.pagos_validados ?? 0,
  });
});

/**
 * POST — migra la cartera. Transaccional: si algo falla no queda media cartera
 * movida.
 */
export const POST = handlerWithAuth(async (req, _ctx, session) => {
  await requirePermission(session, RecaudosPermission.ASIGNACION_MIGRAR);

  const body = await req.json();
  const origen: string = (body?.origen || '').trim();
  const destino: string = (body?.destino || '').trim();
  const migrarPagosPendientes: boolean = body?.migrarPagosPendientes === true;

  if (!origen) throw new ValidationError('Debe seleccionar el gestor de origen');
  if (!destino) throw new ValidationError('Debe seleccionar el gestor de destino');
  if (origen === destino) throw new ValidationError('El gestor de origen y el de destino son el mismo');

  // El origen PUEDE estar inactivo (es el que se retiró); el destino no.
  const gOrigen = await cargarGestor(origen, 'de origen', false);
  const gDestino = await cargarGestor(destino, 'de destino', true);

  const scope = await scopeSql(session, 3);

  const out = await withTransaction(async (client) => {
    // 1) La cartera: titulares del origen dentro del scope.
    const titulares = (await client.query(
      `UPDATE "PEOPLE" p
          SET "gestorRecaudo" = $2, "_updatedDate" = NOW()
        WHERE p."gestorRecaudo" = $1
          AND p."tipoUsuario" = 'TITULAR'${scope.sql}
        RETURNING p."_id"`,
      [origen, destino, ...scope.params],
    )).rows.map((r: { _id: string }) => r._id);

    // 2) Pagos PENDIENTES de esos mismos titulares. Los validados quedan con su
    //    gestor original: son el registro de quién los gestionó, no una
    //    asignación viva.
    let pagos = 0;
    if (migrarPagosPendientes && titulares.length) {
      const r = await client.query(
        `UPDATE "PAGOS_TITULARES"
            SET "gestorRecaudo" = $1, "_updatedDate" = NOW()
          WHERE "gestorRecaudo" = $2
            AND "validado" IS NOT TRUE
            AND "idPeople" = ANY($3::text[])`,
        [destino, origen, titulares],
      );
      pagos = r.rowCount || 0;
    }

    return { titulares: titulares.length, pagos };
  });

  console.log(
    `🔄 [Recaudos] Migración de cartera: ${out.titulares} titulares` +
    `${out.pagos ? ` + ${out.pagos} pagos pendientes` : ''}` +
    ` · ${gOrigen.nombre || origen} → ${gDestino.nombre || destino}` +
    ` · por ${session?.user?.email || 'desconocido'}`,
  );

  return successResponse({
    titularesMigrados: out.titulares,
    pagosMigrados: out.pagos,
    origenNombre: gOrigen.nombre || origen,
    destinoNombre: gDestino.nombre || destino,
  });
});
