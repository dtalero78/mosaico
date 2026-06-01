/**
 * OpenAI Moderation — wrapper sobre /v1/moderations.
 *
 * Endpoint público de OpenAI dedicado a clasificación de contenido (NO se cobra
 * como gpt-4o-mini — Moderation es gratis para fines de safety). Categorías:
 *   harassment / harassment_threatening / hate / hate_threatening
 *   self_harm / self_harm_intent / self_harm_instructions
 *   sexual / sexual_minors / violence / violence_graphic
 *
 * Uso pensado: segunda barrera al filtro local de groserías. Si OpenAI marca
 * cualquier categoría → bloqueamos. Si falla / timeout → caemos al blacklist
 * local (defensa en profundidad). NO bloqueamos por falta de OpenAI.
 *
 * Latencia: ~200-400ms en condiciones normales. Aplicamos timeout de 1500ms
 * para no degradar la UX del estudiante si la red está lenta.
 */
import 'server-only';

const MODERATION_URL = 'https://api.openai.com/v1/moderations';
const DEFAULT_TIMEOUT_MS = 1500;

export interface ModerationResult {
  flagged: boolean;             // alguna categoría dispara
  categories?: string[];        // las que dispararon (para log)
  errored?: boolean;            // true si la llamada falló o timeout (NO bloquea)
  errorMessage?: string;
}

const SAFE_DEFAULT: ModerationResult = { flagged: false, errored: false };

/**
 * Clasifica `text` contra OpenAI Moderation. Devuelve `{flagged:true}` si
 * cualquier categoría safety dispara. En error/timeout devuelve `errored:true`
 * con `flagged:false` para que el llamador decida (típicamente: permitir y
 * confiar en la blacklist local).
 */
export async function moderateText(
  text: string | null | undefined,
  opts: { timeoutMs?: number } = {}
): Promise<ModerationResult> {
  if (!text || !text.trim()) return SAFE_DEFAULT;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    // Sin key → no podemos llamar; degradamos limpio.
    return { flagged: false, errored: true, errorMessage: 'OPENAI_API_KEY no configurada' };
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(MODERATION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'text-moderation-latest',
        input: String(text).slice(0, 4000),  // hard cap defensivo
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!resp.ok) {
      const errBody = await resp.text().catch(() => '');
      return {
        flagged: false,
        errored: true,
        errorMessage: `Moderation HTTP ${resp.status}: ${errBody.slice(0, 200)}`,
      };
    }

    const data: any = await resp.json();
    const r = data?.results?.[0];
    if (!r) return SAFE_DEFAULT;

    if (r.flagged === true && r.categories) {
      const flaggedCats = Object.entries(r.categories)
        .filter(([, v]) => v === true)
        .map(([k]) => String(k));
      return { flagged: true, categories: flaggedCats, errored: false };
    }
    return SAFE_DEFAULT;
  } catch (err: any) {
    clearTimeout(timer);
    const isAbort = err?.name === 'AbortError';
    return {
      flagged: false,
      errored: true,
      errorMessage: isAbort ? `Timeout ${timeoutMs}ms` : (err?.message || String(err)),
    };
  }
}
