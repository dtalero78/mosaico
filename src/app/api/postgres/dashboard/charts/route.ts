import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { queryMany, queryOne } from '@/lib/postgres';

// ── Server-side cache (30 min TTL, per chart type) ───────────────
const chartCache = new Map<string, { html: string; generatedAt: string }>();
const cacheTimestamps = new Map<string, number>();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

// ── Chart definitions ────────────────────────────────────────────

interface ChartDef {
  key: string;
  label: string;
  description: string;
  gatherData: () => Promise<any>;
  buildPrompt: (data: any) => string;
}

const CHART_DEFS: ChartDef[] = [
  {
    key: 'sessions-vs-attendance',
    label: 'Sesiones vs. Asistencia',
    description: 'Sesiones agendadas por mes vs. atendidas y canceladas',
    gatherData: async () => {
      return queryMany<{ mes: string; agendadas: number; atendidas: number; canceladas: number }>(
        `SELECT
           TO_CHAR(b."fechaEvento"::date, 'YYYY-MM') AS mes,
           COUNT(*) AS agendadas,
           COUNT(*) FILTER (WHERE b."asistio" = true) AS atendidas,
           COUNT(*) FILTER (WHERE b."cancelo" = true) AS canceladas
         FROM "ACADEMICA_BOOKINGS" b
         WHERE b."fechaEvento" >= NOW() - INTERVAL '6 months'
           AND b."fechaEvento" <= NOW()
         GROUP BY TO_CHAR(b."fechaEvento"::date, 'YYYY-MM')
         ORDER BY mes`,
        []
      );
    },
    buildPrompt: (data) => `Genera una gráfica de BARRAS AGRUPADAS para "Sesiones Agendadas vs. Atendidas vs. Canceladas por Mes".
Datos: ${JSON.stringify(data)}
- Eje X: meses en formato "Mes Año" (ej: "Ene 2026"). Agrupa 3 barras por mes.
- Colores: Agendadas=#3B82F6 (azul), Atendidas=#10B981 (verde), Canceladas=#EF4444 (rojo).
- Muestra el valor encima de cada barra.
- Incluye leyenda con los 3 colores.
- Barras con bordes redondeados arriba.
- La gráfica debe ser amplia para acomodar los meses.`,
  },
];

// ── Call Claude API to generate a single chart ───────────────────

async function generateChartWithClaude(chartPrompt: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');

  const systemPrompt = `Eres un experto en visualización de datos. Genera un documento HTML completo con una sola gráfica SVG inline para un dashboard administrativo. El diseño debe ser moderno, limpio y profesional.

REGLAS:
- Genera un documento HTML completo: <!DOCTYPE html>, <html>, <head> con <style>, y <body>.
- El body debe tener font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: transparent; margin: 0; padding: 16px.
- La gráfica debe estar en una tarjeta (card) con fondo blanco, border-radius: 12px, y box-shadow sutil.
- El SVG debe tener width="100%" y un viewBox adecuado para ser responsive.
- Los textos deben ser legibles (font-size mínimo 11px).
- INTERACTIVIDAD con JavaScript:
  - Tooltips al hacer hover sobre barras/segmentos mostrando el valor exacto.
  - Efecto hover en barras (cambio de opacidad o color).
  - Animación suave de entrada (CSS transitions o requestAnimationFrame).
- Los scripts deben ir en un <script> tag al final del body.
- Si el dataset está vacío, muestra un mensaje "Sin datos disponibles".
- NO incluyas explicaciones, solo el HTML.`;

  // OpenAI gpt-4o-mini (mismo proveedor que el comentario IA y las complementarias).
  const OpenAI = (await import('openai')).default;
  const client = new OpenAI({ apiKey });
  const r = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 8000,
    temperature: 0.3,
    messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: chartPrompt }],
  });
  const text = r.choices?.[0]?.message?.content || '';

  const htmlMatch = text.match(/```html?\s*([\s\S]*?)```/);
  return htmlMatch ? htmlMatch[1].trim() : text.trim();
}

// ── Route handlers ───────────────────────────────────────────────

// GET: Return available chart options (no data fetching)
export const GET = handlerWithAuth(async (req) => {
  const url = new URL(req.url);
  const chartKey = url.searchParams.get('chart');

  // If no chart specified, return available options
  if (!chartKey) {
    const options = CHART_DEFS.map(d => ({ key: d.key, label: d.label, description: d.description }));
    return successResponse({ options });
  }

  // Check cache for specific chart
  const cached = chartCache.get(chartKey);
  const ts = cacheTimestamps.get(chartKey) || 0;
  if (cached && Date.now() - ts < CACHE_TTL) {
    return successResponse({ ...cached, cached: true });
  }

  // Generate specific chart
  const def = CHART_DEFS.find(d => d.key === chartKey);
  if (!def) {
    return successResponse({ error: `Chart "${chartKey}" not found` });
  }

  console.log(`[Charts] Generating "${chartKey}"...`);
  const data = await def.gatherData();
  const html = await generateChartWithClaude(def.buildPrompt(data));
  console.log(`[Charts] "${chartKey}" generated, HTML length: ${html.length}`);

  const entry = { html, generatedAt: new Date().toISOString() };
  chartCache.set(chartKey, entry);
  cacheTimestamps.set(chartKey, Date.now());

  return successResponse({ ...entry, cached: false });
});

// POST: Force regenerate a specific chart
export const POST = handlerWithAuth(async (req) => {
  const body = await req.json().catch(() => ({}));
  const chartKey = body.chart;

  if (!chartKey) {
    return successResponse({ error: 'Missing "chart" parameter' });
  }

  const def = CHART_DEFS.find(d => d.key === chartKey);
  if (!def) {
    return successResponse({ error: `Chart "${chartKey}" not found` });
  }

  const data = await def.gatherData();
  const html = await generateChartWithClaude(def.buildPrompt(data));

  const entry = { html, generatedAt: new Date().toISOString() };
  chartCache.set(chartKey, entry);
  cacheTimestamps.set(chartKey, Date.now());

  return successResponse({ ...entry, cached: false });
});
