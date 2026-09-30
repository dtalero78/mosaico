import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { ComercialPermission } from '@/types/permissions';
import { query } from '@/lib/postgres';
import { getUserComercialScope } from '@/lib/crm';
import { dejarContratoListo } from '@/services/dejar-listo.service';
import { esAprobadoSql } from '@/lib/estados';

/**
 * GET /api/postgres/comercial/gestion-contrato
 *   Titulares con contrato FIRMADO (consentimiento) y SIN APROBAR. Primero los
 *   que faltan por gestionar; después los ya marcados "listo", que siguen en la
 *   bandeja hasta que Aprobación los apruebe.
 *
 * POST … { id }  → "Dejar listo": marca el contrato como gestionado (sale de la lista).
 * Gateado por COMERCIAL.GESTION_CONTRATO.VER.
 */
/**
 * Todos los titulares del alcance del usuario (sin los de prueba). Es el universo
 * que se ve al elegir un estado concreto o "Todos" en el filtro.
 */
const TODOS = `p."tipoUsuario"='TITULAR'
  AND COALESCE(p."contrato", '') NOT LIKE 'PRB-%'`;

/**
 * La bandeja de trabajo — lo que se ve por defecto: titulares FIRMADOS y SIN
 * APROBAR. Es un subconjunto de `TODOS`.
 *
 * **Incluye los ya marcados "listo"**: siguen sin aprobarse, así que Comercial
 * tiene que poder verlos y darles seguimiento. Se distinguen en la fila con
 * "✓ Gestionado" y no ofrecen el botón de dejar listo. Sólo salen de aquí cuando
 * Aprobación los aprueba.
 */
const SIN_APROBAR = `${TODOS}
  AND p."hashConsentimiento" IS NOT NULL AND p."hashConsentimiento" <> ''
  AND (p."aprobacion" IS NULL OR NOT ${esAprobadoSql('p."aprobacion"')})
  AND (p."estado" IS NULL OR p."estado" <> 'FINALIZADA')`;

/** De los anteriores, los que aún nadie gestionó — el trabajo que falta. */
const POR_GESTIONAR = `${SIN_APROBAR}
  AND COALESCE(p."gestionContratoListo", false) = false`;

/** Valor del filtro Estado que levanta el corte de la bandeja. */
const ESTADO_TODOS = '__TODOS__';
/** Estado de un contrato que aún no tiene decisión registrada. */
const ESTADO_SIN = '(Sin estado)';

export const GET = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, ComercialPermission.GESTION_CONTRATO);
  const sp = new URL(request.url).searchParams;
  const asesor = (sp.get('asesor') || '').trim();
  const contrato = (sp.get('contrato') || '').trim();
  const numeroId = (sp.get('numeroId') || '').trim();
  const estado = (sp.get('estado') || '').trim();
  const lider = (sp.get('lider') || '').trim();
  const startDate = (sp.get('startDate') || '').trim();
  const endDate = (sp.get('endDate') || '').trim();

  // Scope por líder: un Gerente/Jefe de Grupo sólo ve los contratos de SU equipo
  // (liderComercialCorreo = su correo); Sales Manager+ y admins ven todo.
  const role = (session as any)?.user?.role;
  const email = (session as any)?.user?.email || '';
  const scope = (role === 'SUPER_ADMIN' || role === 'ADMIN')
    ? { seeAll: true, liderCorreo: null as string | null }
    : await getUserComercialScope(email);
  // Fragmento de scope para las consultas de dropdowns (usan $1 propio).
  const scopeFrag = scope.seeAll ? '' : ` AND LOWER(p."liderComercialCorreo") = LOWER($1)`;
  const scopeArgs: any[] = scope.seeAll ? [] : [scope.liderCorreo];

  // El filtro Estado decide el UNIVERSO, no sólo acota la bandeja: vacío = la
  // bandeja de trabajo (lo pendiente); cualquier otro valor levanta el corte de
  // "sin aprobar / sin gestionar" y deja ver el resto de los contratos del
  // alcance. Un líder necesita poder mirar todo su equipo, no sólo su pendiente.
  const universo = estado ? TODOS : SIN_APROBAR;

  /**
   * Arma el WHERE sobre el universo que se le pase. Se usa dos veces —para las
   * filas y para el contador de "sin gestionar"— así que el contador respeta los
   * mismos filtros que la lista: si se acota a un líder, cuenta los de ese líder.
   * `conEstado` queda fuera del contador porque el estado define el universo.
   */
  const construir = (base: string, conEstado: boolean) => {
    const where: string[] = [base];
    const params: any[] = [];
    const add = (sql: (n: number) => string, value: any) => { params.push(value); where.push(sql(params.length)); };

    if (!scope.seeAll) add((n) => `LOWER(p."liderComercialCorreo") = LOWER($${n})`, scope.liderCorreo);
    if (asesor) add((n) => `p."asesor" = $${n}`, asesor);
    if (contrato) add((n) => `p."contrato" ILIKE $${n}`, `%${contrato}%`);
    if (numeroId) add((n) => `p."numeroId" ILIKE $${n}`, `%${numeroId}%`);
    if (conEstado && estado && estado !== ESTADO_TODOS) {
      if (estado === ESTADO_SIN) where.push(`(p."aprobacion" IS NULL OR TRIM(p."aprobacion") = '')`);
      else add((n) => `TRIM(p."aprobacion") = $${n}`, estado);
    }
    if (lider) {
      if (lider === '(Sin líder)') where.push(`p."liderComercial" IS NULL`);
      else add((n) => `p."liderComercial" = $${n}`, lider);
    }
    if (startDate) add((n) => `COALESCE(p."fechaContrato", p."inicioContrato")::date >= $${n}::date`, startDate);
    if (endDate) add((n) => `COALESCE(p."fechaContrato", p."inicioContrato")::date <= $${n}::date`, endDate);
    return { sql: where.join(' AND '), params };
  };

  const { sql: whereSql, params } = construir(universo, true);

  // Primero lo que FALTA por gestionar: la bandeja es una lista de trabajo, y con
  // la carga de las campañas anteriores (que nacen ya gestionadas) lo pendiente
  // quedaba repartido entre decenas de filas ya cerradas. La fecha del contrato
  // no tiene hora, así que dentro del mismo día desempata la de creación.
  const rows = (await query<any>(
    `SELECT p."_id", p."numeroId", p."contrato", p."plataforma", p."asesor",
            TRIM(CONCAT_WS(' ', p."primerNombre", p."segundoNombre", p."primerApellido", p."segundoApellido")) AS nombre,
            COALESCE(p."fechaContrato", p."inicioContrato") AS fecha,
            p."aprobacion", p."estado", p."extemporanea", p."liderComercial",
            -- Fuera de la bandeja las filas se ven iguales: sin esto no se
            -- distingue la que ya gestionaron de la que falta por firmar.
            (p."hashConsentimiento" IS NOT NULL AND p."hashConsentimiento" <> '') AS firmado,
            COALESCE(p."gestionContratoListo", false) AS "gestionListo",
            p."gestionContratoListoDate" AS "gestionListoDate"
       FROM "PEOPLE" p
      WHERE ${whereSql}
      ORDER BY COALESCE(p."gestionContratoListo", false) ASC,
               COALESCE(p."fechaContrato", p."inicioContrato") DESC NULLS LAST,
               p."_createdDate" DESC
      LIMIT 1000`,
    params
  )).rows;

  // Opciones de los dropdowns (respetan el mismo scope por líder).
  // Asesores y líderes salen del universo que se está viendo, para no ofrecer
  // una opción que devolvería cero filas. Los ESTADOS, en cambio, salen SIEMPRE
  // de todo el alcance: son la vía para salir de la bandeja, así que tienen que
  // listar también los que no están en ella (Aprobado, FINALIZADA…).
  const asesores = (await query<{ asesor: string }>(
    `SELECT DISTINCT p."asesor" FROM "PEOPLE" p WHERE ${universo}${scopeFrag} AND p."asesor" IS NOT NULL AND p."asesor" <> '' ORDER BY p."asesor"`,
    scopeArgs
  )).rows.map(r => r.asesor);
  const estados = (await query<{ estado: string }>(
    `SELECT DISTINCT COALESCE(NULLIF(TRIM(p."aprobacion"), ''), '${ESTADO_SIN}') AS estado
       FROM "PEOPLE" p WHERE ${TODOS}${scopeFrag} ORDER BY estado`,
    scopeArgs
  )).rows.map(r => r.estado);
  const lideres = (await query<{ lider: string }>(
    `SELECT DISTINCT p."liderComercial" AS lider FROM "PEOPLE" p WHERE ${universo}${scopeFrag} AND p."liderComercial" IS NOT NULL AND p."liderComercial" <> '' ORDER BY p."liderComercial"`,
    scopeArgs
  )).rows.map(r => r.lider);

  // Cuánto falta por gestionar, con los MISMOS filtros que la lista (menos el de
  // estado, que es el que define el universo): así el número acompaña a lo que se
  // está viendo en vez de dar siempre el total del alcance.
  const cuenta = construir(POR_GESTIONAR, false);
  const pend = (await query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM "PEOPLE" p WHERE ${cuenta.sql}`, cuenta.params
  )).rows[0]?.n || 0;

  return successResponse({
    rows, total: rows.length, asesores, estados, lideres,
    pendientes: pend, esBandeja: !estado,
    scope: { seeAll: scope.seeAll },
  });
});

/**
 * "Dejar listo" — además de marcar el contrato, **toma el cupo** de cada
 * beneficiario (hasta aquí su curso era provisional: ver `gestion-cupo.service`).
 *
 * Body:
 *   { id }                          → confirmar tal cual
 *   { id, cambios: [{personId, campaign, tipoCurso, horarioCurso}] } → mover de horario y confirmar
 *   { id, sobrecupo: true }         → autorizar pasarse del cupo (permiso aparte)
 *
 * Si falta lugar responde 409 con `detail.tipo='sin_cupo'` y **sin escribir nada**,
 * para que el modal ofrezca cambiar de horario o autorizar el sobrecupo.
 */
export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, ComercialPermission.GESTION_CONTRATO);
  const b = await request.json().catch(() => ({}));
  // Alcance por líder, contrato firmado, no aprobado y el permiso del sobrecupo
  // se validan en `dejarContratoListo`: es la MISMA regla que aplica el botón
  // «Contrato Para Aprobación» del detalle del contrato (people/[id]/listo-aprobacion).
  const r = await dejarContratoListo(session, {
    titularId: String(b?.id || '').trim(),
    cambios: b?.cambios,
    sobrecupo: b?.sobrecupo,
  });
  return successResponse(r);
});
