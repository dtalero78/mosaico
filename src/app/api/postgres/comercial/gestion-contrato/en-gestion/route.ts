import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { ComercialPermission } from '@/types/permissions';
import { ValidationError } from '@/lib/errors';
import { query } from '@/lib/postgres';
import { getSessionComercialScope } from '@/lib/crm';
import { esAprobadoSql } from '@/lib/estados';
import { HORAS_EN_GESTION } from '@/lib/contrato-en-gestion';

/**
 * Pestaña "En Gestión" de Comercial › Gestión Contrato.
 *
 * GET  …/en-gestion[?quitados=1]
 *   Contratos creados en las últimas `HORAS_EN_GESTION` horas que todavía NO
 *   están marcados listos ni aprobados. Es el camino de vuelta al detalle del
 *   contrato, que no está en ningún menú.
 *
 * POST …/en-gestion { id, accion: 'quitar' | 'restaurar' }
 *   Quita el contrato de la lista, o lo devuelve. NO borra ni cambia el contrato.
 *
 * Gateado por COMERCIAL.GESTION_CONTRATO.VER, el permiso de la pantalla.
 */

/**
 * La regla de la lista. Su espejo en el cliente es `entraEnGestion`
 * (lib/contrato-en-gestion): si cambia una, cambia la otra.
 *
 * El plazo se mide con el reloj de la BASE y sobre `_createdDate`, que es un
 * instante: da lo mismo desde Chile, Colombia o España.
 *
 * A diferencia de la bandeja de firmados, aquí SÍ entran los contratos de prueba
 * (`PRB-`): se crean por el mismo asistente y también hay que poder volver a
 * ellos. Salen marcados en la tabla.
 */
const EN_GESTION = `p."tipoUsuario" = 'TITULAR'
  AND p."_createdDate" >= NOW() - INTERVAL '${HORAS_EN_GESTION} hours'
  AND COALESCE(p."gestionContratoListo", false) = false
  AND (p."aprobacion" IS NULL OR NOT ${esAprobadoSql('p."aprobacion"')})`;

export const GET = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, ComercialPermission.GESTION_CONTRATO);
  const verQuitados = new URL(request.url).searchParams.get('quitados') === '1';

  // Mismo alcance que el resto de la pantalla: un líder ve sólo los de su equipo.
  const scope = await getSessionComercialScope(session);
  const params: any[] = [];
  let scopeSql = '';
  if (!scope.seeAll) {
    params.push(scope.liderCorreo);
    scopeSql = ` AND LOWER(p."liderComercialCorreo") = LOWER($${params.length})`;
  }

  const rows = (await query<any>(
    `SELECT p."_id", p."numeroId", p."contrato", p."asesor", p."liderComercial",
            TRIM(CONCAT_WS(' ', TRIM(p."primerNombre"), TRIM(p."segundoNombre"),
                                TRIM(p."primerApellido"), TRIM(p."segundoApellido"))) AS nombre,
            p."_createdDate" AS creado,
            p."aprobacion",
            COALESCE(p."gestionContratoListo", false) AS "gestionListo",
            (p."hashConsentimiento" IS NOT NULL AND p."hashConsentimiento" <> '') AS firmado,
            (COALESCE(p."contrato", '') ILIKE 'PRB-%') AS "esPrueba",
            p."extemporanea",
            p."enGestionQuitadoEn" AS "quitadoEn",
            p."enGestionQuitadoPor" AS "quitadoPor"
       FROM "PEOPLE" p
      WHERE ${EN_GESTION}${scopeSql}
        ${verQuitados ? '' : 'AND p."enGestionQuitadoEn" IS NULL'}
      ORDER BY p."_createdDate" DESC
      LIMIT 500`,
    params
  )).rows;

  // Cuántos hay quitados dentro del plazo, se pida verlos o no: es lo que dice
  // si la casilla "Ver los quitados" tiene algo que mostrar.
  const quitados = (await query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM "PEOPLE" p
      WHERE ${EN_GESTION}${scopeSql} AND p."enGestionQuitadoEn" IS NOT NULL`,
    params
  )).rows[0]?.n || 0;

  return successResponse({
    rows,
    total: rows.filter(r => !r.quitadoEn).length,
    quitados,
    horas: HORAS_EN_GESTION,
  });
});

export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, ComercialPermission.GESTION_CONTRATO);
  const b = await request.json().catch(() => ({}));
  const id = String(b?.id || '').trim();
  const accion = String(b?.accion || '').trim();
  if (!id) throw new ValidationError('Falta el titular.');
  if (accion !== 'quitar' && accion !== 'restaurar') {
    throw new ValidationError('Acción no válida.');
  }

  // El alcance se valida en el SERVIDOR: que la fila no salga en pantalla no
  // impide un POST directo sobre el contrato de otro equipo.
  const scope = await getSessionComercialScope(session);
  const params: any[] = [id];
  let scopeSql = '';
  if (!scope.seeAll) {
    params.push(scope.liderCorreo);
    scopeSql = ` AND LOWER("liderComercialCorreo") = LOWER($${params.length})`;
  }
  const email = (session as any)?.user?.email || 'desconocido';
  params.push(accion === 'quitar' ? email : null);

  const r = await query<{ contrato: string | null }>(
    `UPDATE "PEOPLE"
        SET "enGestionQuitadoEn"  = ${accion === 'quitar' ? 'NOW()' : 'NULL'},
            "enGestionQuitadoPor" = $${params.length}
      WHERE "_id" = $1 AND "tipoUsuario" = 'TITULAR'${scopeSql}
      RETURNING "contrato"`,
    params
  );
  if (!r.rowCount) throw new ValidationError('No se encontró el titular (o está fuera de tu equipo).');

  const contrato = r.rows[0].contrato || '';
  return successResponse({
    ok: true,
    contrato,
    message: accion === 'quitar'
      ? `Contrato ${contrato} quitado de la lista En Gestión.`
      : `Contrato ${contrato} devuelto a la lista En Gestión.`,
  });
});
