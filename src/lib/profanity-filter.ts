/**
 * Profanity Filter — blacklist local + normalización agresiva.
 *
 * Diseñado para bloquear groserías obvias en comentarios de Performance
 * Evaluation, sin censurar críticas válidas. Es la primera línea (cliente);
 * el endpoint también llama a OpenAI Moderation como segunda barrera.
 *
 * Filosofía:
 *   - ✅ BLOQUEAR: insultos personales, groserías ("imbécil", "puta clase")
 *   - ❌ NO BLOQUEAR: críticas honestas ("malo", "terrible", "no aprendí",
 *     "no se preparó") — son feedback válido, deben llegar al dashboard.
 *
 * Normalización (evade-resistant): el texto se baja a minúsculas, se quitan
 * acentos, se sustituyen leetspeak comunes (1→i, 3→e, 0→o, etc.), se colapsan
 * repeticiones (putooo → puto) y se eliminan separadores intermedios típicos
 * (puntos/comas/espacios entre letras: "p.u.t.o" → "puto").
 *
 * Si hay match → devuelve { blocked: true, matched: <palabra>, message }.
 * El llamador decide qué hacer (mostrar toast, bloquear submit, etc.).
 *
 * NO se exporta la blacklist completa — se mantiene como detalle interno.
 */

const PROFANITY_PATTERNS: string[] = [
  // === Familia put* (ES) ===
  'puta', 'puto', 'putas', 'putos', 'putada', 'putadita', 'putisimo',
  'puteado', 'puteada', 'puteando', 'putear', 'putamente', 'putamadre',

  // === Mierda + variantes ===
  'mierda', 'mierdas', 'mierdita', 'mierdoso', 'mierdosa', 'mierdolas',

  // === Joder ===
  'joder', 'jodido', 'jodida', 'jodete', 'jodanse', 'jodase', 'jodete',

  // === Carajo / coño / hostia ===
  'carajo', 'coño', 'cono', 'hostia', 'hostias', 'cojones', 'cojudo', 'cojuda',

  // === Insultos personales (ES + regionales) ===
  'imbecil', 'imbeciles', 'estupido', 'estupida', 'estupidos', 'estupidas',
  'idiota', 'idiotas',
  'pendejo', 'pendeja', 'pendejos', 'pendejas',
  'huevon', 'guevon', 'webon', 'weon', 'wn', 'weones',  // CL / CO
  'boludo', 'boluda', 'boludos', 'pelotudo', 'pelotuda',  // AR
  'cabron', 'cabrona', 'cabrones', 'gilipollas',  // MX / ES
  'maricon', 'mariconazo',
  'verga', 'vergazo', 'mamon', 'mamona', 'mamada', 'mamadera',
  'chinga', 'chingada', 'chingado', 'chingar', 'chingue',
  'pinche', 'pinches',
  'culero', 'culera', 'culeros',
  'menso', 'mensa', 'tarado', 'tarada',
  'baboso', 'babosa',

  // === Inglés común ===
  'fuck', 'fucking', 'fucked', 'fucker', 'motherfucker',
  'shit', 'shitty', 'bullshit',
  'asshole', 'ass', 'arse',
  'bitch', 'bitches', 'bitching',
  'damn', 'damnit', 'goddamn',
  'bastard', 'bastards',
  'cunt', 'dick', 'dickhead', 'prick', 'pussy',
  'wanker', 'twat',
  'retard', 'retarded',
  'fag', 'faggot',
  'whore', 'slut',
];

/**
 * Normalizador agresivo:
 *   1. Lowercase
 *   2. Quita diacríticos (NFD + remove marks)
 *   3. Sustituye leetspeak: 0→o, 1→i, 3→e, 4→a, 5→s, 7→t, 8→b, @→a, $→s
 *   4. Quita TODO lo que no sea a-z (puntos, espacios, números restantes, etc.)
 *   5. Colapsa letras repetidas: aaa → a (limita "putooooo" → "puto")
 */
function normalize(text: string): string {
  let t = String(text || '').toLowerCase();

  // Quita diacríticos: "puté" → "pute", "joder" se queda igual
  t = t.normalize('NFD').replace(/[̀-ͯ]/g, '');

  // Leetspeak (orden importa — letras antes de números restantes)
  t = t
    .replace(/[@]/g, 'a')
    .replace(/[$]/g, 's')
    .replace(/0/g, 'o')
    .replace(/1/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/7/g, 't')
    .replace(/8/g, 'b');

  // Sólo letras a-z + ñ (que ya pasó por normalize NFD → ñ se preserva como n con tilde,
  // que NFD descompone → conservamos solo a-z)
  t = t.replace(/[^a-z]/g, '');

  // Colapsa repeticiones: putooo → puto, mieerdaaaa → mierda
  t = t.replace(/(.)\1{2,}/g, '$1');

  return t;
}

let normalizedBlacklist: string[] | null = null;
function getNormalizedBlacklist(): string[] {
  if (!normalizedBlacklist) {
    normalizedBlacklist = PROFANITY_PATTERNS
      .map(normalize)
      .filter(p => p.length >= 3); // < 3 produce demasiados falsos positivos
  }
  return normalizedBlacklist;
}

export interface ProfanityCheckResult {
  blocked: boolean;
  matched?: string;
  message?: string;
}

const BLOCKED_MESSAGE = 'Por favor reformula tu comentario sin lenguaje ofensivo.';

/**
 * Comprueba si un texto contiene groserías. Devuelve `{blocked:false}` si está limpio,
 * o `{blocked:true, matched, message}` si detecta una palabra de la blacklist.
 *
 * Para evitar falsos positivos en críticas legítimas, se requiere que la palabra
 * normalizada aparezca como substring de la versión normalizada del texto. Esto
 * captura evasiones (m1erda, mier.da) pero deja pasar críticas como "malo".
 */
export function checkProfanity(text: string | null | undefined): ProfanityCheckResult {
  if (!text) return { blocked: false };
  const normalized = normalize(text);
  if (!normalized) return { blocked: false };

  const blacklist = getNormalizedBlacklist();
  for (const word of blacklist) {
    if (normalized.includes(word)) {
      return { blocked: true, matched: word, message: BLOCKED_MESSAGE };
    }
  }
  return { blocked: false };
}

/** Mismo mensaje que usa el endpoint — exportado para que client y server coincidan. */
export const PROFANITY_MESSAGE = BLOCKED_MESSAGE;
