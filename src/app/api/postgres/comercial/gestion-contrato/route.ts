import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { ComercialPermission } from '@/types/permissions';
import { ValidationError } from '@/lib/errors';
import { query } from '@/lib/postgres';
import { getUserComercialScope } from '@/lib/crm';
import { marcarListoConCupo } from '@/services/gestion-cupo.service';
import { esAprobadoSql, esAprobado } from '@/lib/estados';

/**
 * GET /api/postgres/comercial/gestion-contrato
 *   Titulares con contrato FIRMADO (consentimiento) y SIN APROBAR, pendientes de
 *   gestión (no marcados "listo"). Columnas: nombre, contrato, fecha, estado.
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
 * La bandeja de trabajo — lo que se ve por defecto: titulares FIRMADOS, SIN
 * APROBAR y que nadie marcó "listo" todavía. Es un subconjunto de `TODOS`.
 */
const PENDIENTES = `${TODOS}
  AND p."hashConsentimiento" IS NOT NULL AND p."hashConsentimiento" <> ''
  AND (p."aprobacion" IS NULL OR NOT ${esAprobadoSql('p."aprobacion"')})
  AND COALESCE(p."gestionContratoListo", false) = false
  AND (p."estado" IS NULL OR p."estado" <> 'FINALIZADA')`;

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
  const universo = estado ? TODOS : PENDIENTES;

  const where: string[] = [universo];
  const params: any[] = [];
  if (!scope.seeAll) { params.push(scope.liderCorreo); where.push(`LOWER(p."liderComercialCorreo") = LOWER($${params.length})`); }
  if (asesor) { params.push(asesor); where.push(`p."asesor" = $${params.length}`); }
  if (contrato) { params.push(`%${contrato}%`); where.push(`p."contrato" ILIKE $${params.length}`); }
  if (numeroId) { params.push(`%${numeroId}%`); where.push(`p."numeroId" ILIKE $${params.length}`); }
  if (estado && estado !== ESTADO_TODOS) {
    if (estado === ESTADO_SIN) { where.push(`(p."aprobacion" IS NULL OR TRIM(p."aprobacion") = '')`); }
    else { params.push(estado); where.push(`TRIM(p."aprobacion") = $${params.length}`); }
  }
  if (lider) {
    if (lider === '(Sin líder)') { where.push(`p."liderComercial" IS NULL`); }
    else { params.push(lider); where.push(`p."liderComercial" = $${params.length}`); }
  }
  if (startDate) { params.push(startDate); where.push(`COALESCE(p."fechaContrato", p."inicioContrato")::date >= $${params.length}::date`); }
  if (endDate) { params.push(endDate); where.push(`COALESCE(p."fechaContrato", p."inicioContrato")::date <= $${params.length}::date`); }

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
      WHERE ${where.join(' AND ')}
      ORDER BY COALESCE(p."fechaContrato", p."inicioContrato") DESC NULLS LAST
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

  // Cuántos hay en la bandeja, para mostrarlo aunque se esté mirando otro estado.
  const pend = (await query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM "PEOPLE" p WHERE ${PENDIENTES}${scopeFrag}`, scopeArgs
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
  const id = String(b?.id || '').trim();
  if (!id) throw new ValidationError('Falta el titular.');

  const role = (session as any)?.user?.role;
  const email = (session as any)?.user?.email || 'desconocido';
  const scope = (role === 'SUPER_ADMIN' || role === 'ADMIN')
    ? { seeAll: true, liderCorreo: null as string | null }
    : await getUserComercialScope(email);

  // El scope de líder se verifica ANTES de tocar cupos: un comercial no puede
  // cerrar el contrato de otro equipo ni siquiera para reservarle un asiento.
  const params: any[] = [id];
  let scopeSql = '';
  if (!scope.seeAll) { params.push(scope.liderCorreo); scopeSql = ` AND LOWER("liderComercialCorreo") = LOWER($${params.length})`; }
  const dueño = await query<{ _id: string; hashConsentimiento: string | null; aprobacion: string | null }>(
    `SELECT "_id","hashConsentimiento","aprobacion" FROM "PEOPLE"
      WHERE "_id"=$1 AND "tipoUsuario"='TITULAR'${scopeSql}`, params
  );
  if (!dueño.rowCount) throw new ValidationError('No se encontró el titular (o está fuera de tu equipo).');

  // Las mismas dos condiciones con las que el listado decide qué mostrar, pero
  // validadas en el SERVIDOR: que no salga en pantalla no impide un POST directo.
  const t = dueño.rows[0];
  if (!String(t.hashConsentimiento || '').trim()) {
    throw new ValidationError('El contrato aún no está firmado: no se puede marcar como listo.');
  }
  if (esAprobado(t.aprobacion)) {
    throw new ValidationError('El contrato ya está aprobado: marcarlo listo no aplica.');
  }

  const sobrecupo = b?.sobrecupo === true;
  // Autorizar un sobrecupo es ampliar el salón de hecho, así que va por su
  // propio permiso: el comercial ve el modal pero sólo puede cambiar el horario.
  if (sobrecupo) await requirePermission(session, ComercialPermission.GESTION_CONTRATO_SOBRECUPO);

  const cambios = Array.isArray(b?.cambios)
    ? b.cambios
        .filter((c: any) => c?.personId && c?.campaign && c?.tipoCurso && c?.horarioCurso)
        .map((c: any) => ({
          personId: String(c.personId),
          campaign: String(c.campaign),
          tipoCurso: String(c.tipoCurso),
          horarioCurso: String(c.horarioCurso),
        }))
    : [];

  const r = await marcarListoConCupo({ titularId: id, actor: email, cambios, sobrecupo });

  const partes = [`${r.confirmados} beneficiario(s) con el cupo tomado`];
  if (r.movidos.length) partes.push(`${r.movidos.length} cambiado(s) de horario`);
  if (r.sobrecupos) partes.push(`${r.sobrecupos} con sobrecupo autorizado`);

  return successResponse({ ok: true, ...r, message: `Contrato listo — ${partes.join(' · ')}.` });
});
