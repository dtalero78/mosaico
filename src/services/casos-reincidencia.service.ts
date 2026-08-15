import 'server-only';
import { query, queryOne } from '@/lib/postgres';

/**
 * Reincidencia de un alumno: evaluación DERIVADA del historial de sus reportes
 * y casos. Nunca se edita a mano.
 *
 * Se dispara al abrir el caso pero **no bloquea el render** (decisión del
 * usuario): el GET del detalle la lanza y devuelve lo último calculado, así que
 * abrir un caso no espera a OpenAI. El valor se persiste con su fecha y los
 * factores que lo explican, para que la UI pueda mostrar el "¿por qué?".
 */

const MODELO = 'gpt-4o-mini';
/** Si el cálculo es más viejo que esto, se rehace al abrir el caso. */
const VIGENCIA_HORAS = 12;

export type NivelReincidencia = 'BAJA' | 'MEDIA' | 'ALTA';

interface Factores {
  reportesTotales: number;
  casosPrevios: number;
  temaPredominante: string | null;
  reportesUltimos30d: number;
  diasEntreReportes: number | null;
  resumen?: string;
}

/**
 * ¿Hace falta recalcular? Sí si nunca se calculó, si el cálculo venció, o si
 * llegaron reportes después de la última corrida — que es lo que de verdad
 * cambia el diagnóstico.
 */
export async function necesitaRecalculo(casoId: string): Promise<boolean> {
  const r = await queryOne<{ vencido: boolean }>(
    `SELECT (
       c."reincidenciaCalculadaEn" IS NULL
       OR c."reincidenciaCalculadaEn" < NOW() - INTERVAL '${VIGENCIA_HORAS} hours'
       OR EXISTS (
         SELECT 1 FROM "CASOS_REPORTES" r
          WHERE r."academicaId" = c."academicaId"
            AND r."_createdDate" > c."reincidenciaCalculadaEn")
     ) AS vencido
     FROM "CASOS_ATENCION" c WHERE c."_id" = $1`,
    [casoId]
  );
  return !!r?.vencido;
}

/** Señales objetivas del historial. Se calculan en SQL, no las inventa el modelo. */
async function reunirFactores(academicaId: string, casoId: string): Promise<Factores> {
  const { rows: [f] } = await query<any>(
    `SELECT
       (SELECT COUNT(*)::int FROM "CASOS_REPORTES" WHERE "academicaId" = $1) AS "reportesTotales",
       (SELECT COUNT(*)::int FROM "CASOS_ATENCION" WHERE "academicaId" = $1 AND "_id" <> $2) AS "casosPrevios",
       (SELECT COUNT(*)::int FROM "CASOS_REPORTES"
         WHERE "academicaId" = $1 AND "_createdDate" > NOW() - INTERVAL '30 days') AS "reportesUltimos30d",
       (SELECT "tema"::text FROM "CASOS_REPORTES" WHERE "academicaId" = $1
         GROUP BY "tema" ORDER BY COUNT(*) DESC LIMIT 1) AS "temaPredominante",
       -- Ritmo: días promedio entre reportes. Null con menos de dos.
       (SELECT CASE WHEN COUNT(*) > 1
                    THEN ROUND(EXTRACT(EPOCH FROM (MAX("_createdDate") - MIN("_createdDate")))
                               / 86400.0 / (COUNT(*) - 1))::int END
          FROM "CASOS_REPORTES" WHERE "academicaId" = $1) AS "diasEntreReportes"`,
    [academicaId, casoId]
  );
  return f as Factores;
}

/** Regla de respaldo cuando no hay OpenAI o la llamada falla. */
function nivelPorReglas(f: Factores): NivelReincidencia {
  if (f.reportesTotales >= 5 || f.casosPrevios >= 2 || f.reportesUltimos30d >= 3) return 'ALTA';
  if (f.reportesTotales >= 3 || f.casosPrevios >= 1 || f.reportesUltimos30d >= 2) return 'MEDIA';
  return 'BAJA';
}

/**
 * Calcula y persiste la reincidencia. Best-effort: si OpenAI falla, cae a la
 * regla de respaldo — la ficha nunca se queda sin dato por un problema externo.
 */
export async function calcularReincidencia(casoId: string): Promise<{
  nivel: NivelReincidencia; patron: string | null; fuente: 'ia' | 'reglas';
} | null> {
  const caso = await queryOne<{ academicaId: string }>(
    `SELECT "academicaId" FROM "CASOS_ATENCION" WHERE "_id" = $1`, [casoId]
  );
  if (!caso) return null;

  const factores = await reunirFactores(caso.academicaId, casoId);
  let nivel = nivelPorReglas(factores);
  let fuente: 'ia' | 'reglas' = 'reglas';
  let resumen: string | undefined;

  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey && factores.reportesTotales > 0) {
    try {
      // Al modelo se le pasan los textos de los reportes: el matiz que no
      // capturan los contadores (¿es el mismo problema repitiéndose o son
      // situaciones aisladas?) es justamente lo que aporta.
      const { rows: textos } = await query<{ tema: string; texto: string; fecha: string }>(
        `SELECT "tema"::text, "texto", TO_CHAR("_createdDate", 'YYYY-MM-DD') AS fecha
           FROM "CASOS_REPORTES" WHERE "academicaId" = $1
          ORDER BY "_createdDate" DESC LIMIT 12`,
        [caso.academicaId]
      );

      const prompt = `Eres un analista académico. Evalúa la REINCIDENCIA de un alumno a partir de los reportes que sus guías han escrito.

Señales objetivas:
- Reportes totales: ${factores.reportesTotales}
- Casos previos: ${factores.casosPrevios}
- Reportes en los últimos 30 días: ${factores.reportesUltimos30d}
- Tema predominante: ${factores.temaPredominante || 'sin definir'}
- Días promedio entre reportes: ${factores.diasEntreReportes ?? 'n/d'}

Reportes (del más reciente al más antiguo):
${textos.map(t => `- [${t.fecha}] (${t.tema}) ${t.texto}`).join('\n')}

Responde SÓLO un JSON: {"nivel":"BAJA|MEDIA|ALTA","patron":"<3 palabras>","resumen":"<una frase explicando por qué>"}
Criterio: ALTA si el mismo problema se repite y se está agravando; MEDIA si reincide sin agravarse; BAJA si son hechos aislados.`;

      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: MODELO, temperature: 0,
          response_format: { type: 'json_object' },
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const out = JSON.parse(data?.choices?.[0]?.message?.content || '{}');
        if (['BAJA', 'MEDIA', 'ALTA'].includes(out?.nivel)) {
          nivel = out.nivel;
          fuente = 'ia';
          resumen = String(out.resumen || '').slice(0, 400);
          if (out.patron) factores.temaPredominante = String(out.patron).slice(0, 60);
        }
      }
    } catch {
      // Se queda con la regla de respaldo.
    }
  }

  factores.resumen = resumen;
  await query(
    `UPDATE "CASOS_ATENCION"
        SET "reincidenciaNivel" = $1, "reincidenciaPatron" = $2,
            "reincidenciaFactores" = $3, "reincidenciaCalculadaEn" = NOW()
      WHERE "_id" = $4`,
    [nivel, factores.temaPredominante, JSON.stringify({ ...factores, fuente }), casoId]
  );

  return { nivel, patron: factores.temaPredominante, fuente };
}

/**
 * Lanza el cálculo sin esperarlo. El caso se abre de inmediato con el último
 * valor persistido; el nuevo aparece al siguiente refresco.
 */
export function recalcularEnSegundoPlano(casoId: string): void {
  void necesitaRecalculo(casoId)
    .then(hace => (hace ? calcularReincidencia(casoId) : null))
    .catch(err => console.error('[reincidencia] fallo en background:', err?.message || err));
}
