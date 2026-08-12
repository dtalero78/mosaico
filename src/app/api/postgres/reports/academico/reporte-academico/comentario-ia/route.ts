import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import { ValidationError } from '@/lib/errors';
import { query } from '@/lib/postgres';
import { generateId } from '@/lib/id-generator';
import { METRICA_ASISTIO, METRICAS_MANUALES } from '@/services/reporte-academico.service';

/**
 * POST /api/postgres/reports/academico/reporte-academico/comentario-ia
 *
 * Genera con IA (Anthropic) un comentario breve del desempeño semanal de UN
 * estudiante, a partir de sus métricas de la semana + los "Comentarios para el
 * Usuario" que dejó el Guía, y lo guarda en REPORTE_ACADEMICO_NOTAS.
 * Body: { academicaId, salon, semanaInicio, curso?, campaign?, numeroId?, nombre,
 *         metricas:{key:{cumplidas,sesiones}}, sesSemana, asistenciaCursoPct, progresoPct, comentariosSemana }
 */
export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, AcademicoPermission.REPORTE_ACADEMICO_VER);
  const b = await request.json().catch(() => ({}));
  const academicaId = String(b?.academicaId || '').trim();
  const salon = String(b?.salon || '').trim();
  const semanaInicio = String(b?.semanaInicio || '').trim();
  if (!academicaId || !salon || !semanaInicio) throw new ValidationError('Falta academicaId, salon o semanaInicio.');

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new ValidationError('Falta OPENAI_API_KEY para generar el comentario.');

  const ses = Number(b?.sesSemana) || 0;
  const met = b?.metricas || {};
  // "Asistió" es un conteo real de sesiones; los otros 8 son criterios que el Guía
  // marca a mano, así que se le pasan a la IA como texto y NO como "0/2" (si no,
  // interpretaría que el estudiante no cumplió nada).
  const ESTADO_TEXTO: Record<string, string> = {
    full: 'cumplió en todas las sesiones', half: 'cumplió en algunas sesiones',
    empty: 'no cumplió', none: 'sin evaluar',
  };
  const lineaAsistio = (() => {
    const x = met[METRICA_ASISTIO.key] || {};
    return `- ${METRICA_ASISTIO.label} (${METRICA_ASISTIO.grupo}): ${Number(x.cumplidas) || 0}/${ses} sesiones`;
  })();
  const lineasManuales = METRICAS_MANUALES
    .map((m) => ({ m, estado: (met[m.key] || {}).estado || 'none' }))
    // Lo que el Guía no marcó no se le menciona a la IA: no hay dato que reportar.
    .filter(({ estado }) => estado !== 'none')
    .map(({ m, estado }) => `- ${m.label} (${m.grupo}): ${ESTADO_TEXTO[estado] || 'sin evaluar'}`);
  const lineas = [lineaAsistio, ...lineasManuales].join('\n');
  const comentariosSemana = String(b?.comentariosSemana || '').trim();

  const system = `Eres un asistente pedagógico de MOSAICO, un programa de cálculo mental con ábaco Soroban para niños. Redactas un comentario para el apoderado sobre el desempeño de la semana del estudiante.
Reglas: 2 a 3 frases, cálido, claro y profesional, en español neutro. Básate SOLO en los datos dados (métricas y comentarios del guía); no inventes. Sin viñetas, sin encabezados, sin emojis. Si no asistió a ninguna sesión, dilo con tacto y sugiere retomar.`;

  const user = `Estudiante: ${b?.nombre || 'el estudiante'}
Sesiones de la semana: ${ses}
Asistencia acumulada del curso: ${Number(b?.asistenciaCursoPct) || 0}%
Progreso del curso: ${Number(b?.progresoPct) || 0}%
Métricas de la semana (cumplidas/sesiones):
${lineas}
Comentarios del guía esta semana: ${comentariosSemana || '(sin comentarios)'}

Redacta el comentario para el apoderado.`;

  let texto = '';
  try {
    // OpenAI gpt-4o-mini (mismo proveedor que las actividades complementarias).
    const OpenAI = (await import('openai')).default;
    const client = new OpenAI({ apiKey });
    const r = await client.chat.completions.create({
      model: 'gpt-4o-mini', max_tokens: 400, temperature: 0.5,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    });
    texto = String(r.choices?.[0]?.message?.content || '').trim();
  } catch (e: any) {
    throw new ValidationError('No se pudo generar el comentario IA: ' + (e?.message || 'error'));
  }
  if (!texto) throw new ValidationError('La IA no devolvió texto.');

  await query(
    `INSERT INTO "REPORTE_ACADEMICO_NOTAS" ("_id","academicaId","numeroId","curso","salon","campaign","semanaInicio","comentarioIA","updatedBy")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT ("academicaId","salon","semanaInicio") DO UPDATE SET
       "comentarioIA" = EXCLUDED."comentarioIA", "_updatedDate" = NOW()`,
    [generateId('rep'), academicaId, b?.numeroId || null, b?.curso || null, salon, b?.campaign || null, semanaInicio, texto, (session as any)?.user?.email || null]
  );

  return successResponse({ ok: true, comentarioIA: texto });
});
