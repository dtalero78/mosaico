import 'server-only';
import { randomUUID } from 'crypto';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import { ValidationError } from '@/lib/errors';
import { query } from '@/lib/postgres';
import { computeImpulsaCalendario, type ImpulsaConfig } from '@/lib/impulsa-calendario';
import { materializarCalendarioImpulsa } from '@/services/impulsa-calendario.service';

/**
 * POST /api/postgres/impulsa/crear
 * Crea un curso IMPULSA (tipo distinto, calendario FIJO) y materializa su calendario
 * en una sola pasada. Body: { campaign, salon, guia?, numeroUsuarios?, config }.
 * config = { inicioSesiones, finSesiones, festivos[], entrenamientos[], evaluaciones[] }.
 * Gateado por ACADEMICO.CAMPANA.CREAR.
 */
const HORARIO_IMPULSA = 'LUN-MIÉ-VIE 20:00-21:00';

export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, AcademicoPermission.CAMPANA_CREAR);
  const b = await request.json().catch(() => ({}));
  const campaign = String(b?.campaign || '').trim();
  const salon = String(b?.salon || '').trim();
  const guia = b?.guia ? String(b.guia).trim() : null;
  const cupos = Number(b?.numeroUsuarios) || 0;
  const cfg: ImpulsaConfig = b?.config || {};

  if (!campaign) throw new ValidationError('Falta el nombre de la campaña.');
  if (!salon) throw new ValidationError('Falta el salón.');
  if (!cfg.inicioSesiones || !cfg.finSesiones) throw new ValidationError('Falta el rango de fechas de las sesiones.');
  if (cfg.finSesiones < cfg.inicioSesiones) throw new ValidationError('La fecha de fin es anterior a la de inicio.');

  const calc = computeImpulsaCalendario(cfg);
  if (calc.resumen.total === 0) throw new ValidationError('La configuración no genera ningún evento. Revisa el rango de fechas.');

  // El curso termina en la última fecha de evento (evaluaciones van después de las sesiones).
  const fechas = [...calc.sesiones, ...calc.entrenamientos, ...calc.evaluaciones].map(e => e.fecha).sort();
  const finalCurso = fechas[fechas.length - 1];

  const dup = await query(
    `SELECT 1 FROM "CURSOS_CAMPAIGN" WHERE "campaign"=$1 AND UPPER("tipoCurso")='IMPULSA' AND "salon"=$2 LIMIT 1`,
    [campaign, salon]
  );
  if (dup.rowCount) throw new ValidationError('Ya existe un curso IMPULSA con esa campaña y salón.');

  const cursoId = `ccp_${randomUUID()}`;
  await query(
    `INSERT INTO "CURSOS_CAMPAIGN"
       ("_id","campaign","tipoCurso","horarioCurso","salon","guia","numeroUsuarios","usuInscritos",
        "activa","paraMenores","inicioCampania","inicioCurso","finalCurso","finalCampaign","_createdDate","_updatedDate")
     VALUES ($1,$2,'IMPULSA',$3,$4,$5,$6,0,true,false,$7::date,$7::date,$8::date,$7::date,NOW(),NOW())`,
    [cursoId, campaign, HORARIO_IMPULSA, salon, guia, cupos, cfg.inicioSesiones, finalCurso]
  );

  const actor = (session as any)?.user?.email || null;
  const { count, resumen } = await materializarCalendarioImpulsa(
    { _id: cursoId, campaign, tipoCurso: 'IMPULSA', salon, guia, numeroUsuarios: cupos, horarioCurso: HORARIO_IMPULSA },
    cfg, actor
  );

  return successResponse({ ok: true, cursoId, finalCurso, eventos: count, resumen });
});
