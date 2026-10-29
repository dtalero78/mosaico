/**
 * Integración de SOLO LECTURA con la base del CRM (lgs-crm-db).
 *
 * MOSAICO no tiene la escalera de asesores; vive en el CRM como un árbol
 * auto-referenciado: `User.supervisorId` → `User.id`, con `User.position` = rango
 * (ASESOR_TRAINING, FULL_EXECUTIVE, GERENTE, JEFE_GRUPO, SALES_MANAGER, CEO…).
 *
 * `resolverLiderComercial(correo|nombre)` sube la escalera desde el asesor y
 * devuelve el **primer mando** (escalón primero): GERENTE / JEFE_GRUPO /
 * SALES_MANAGER — ej. Denisse Mercado, Nidia Uribe, Sebastian Yañez, o Maria del
 * Cielo Maldonado. Se saltan FULL_EXECUTIVE y ASESOR_TRAINING (intermedios).
 *
 * Conexión: usuario Postgres de SOLO LECTURA `mosaico_ro` (solo SELECT sobre
 * "User") vía `CRM_DATABASE_URL`. Si la env var no está o el CRM no responde, el
 * resolver devuelve null y el llamador continúa sin bloquear (best-effort).
 *
 * SERVER-ONLY.
 */
import 'server-only';
import { Pool } from 'pg';

// Rangos que cuentan como "líder" — donde se detiene la subida por la escalera.
const LIDER_RANKS = ['SALES_MANAGER', 'GERENTE', 'JEFE_GRUPO'];

// Scoping de vistas comerciales: quién ve TODO vs quién ve solo su equipo.
const VE_TODO_RANKS = new Set(['SALES_MANAGER', 'GERENTE_DIVISIONAL', 'DIRECTOR_INTERNACIONAL', 'CEO']);
const LIDER_EQUIPO_RANKS = new Set(['GERENTE', 'JEFE_GRUPO']);

export interface LiderComercial {
  nombre: string;
  correo: string | null;
  position: string;
}

const globalForCrm = globalThis as unknown as { _crmPool?: Pool | null };

/** Pool perezoso al CRM (read-only). null si `CRM_DATABASE_URL` no está definida. */
function getCrmPool(): Pool | null {
  if (globalForCrm._crmPool !== undefined) return globalForCrm._crmPool;
  const url = process.env.CRM_DATABASE_URL;
  if (!url) {
    globalForCrm._crmPool = null;
    return null;
  }
  const connectionString = url.replace(/[?&]sslmode=[^&]*/g, '');
  const pool = new Pool({
    connectionString,
    max: 4,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 8000,
    ssl: { rejectUnauthorized: false },
  });
  pool.on('error', (err: any) => console.error('❌ CRM pool error:', err?.message || err));
  globalForCrm._crmPool = pool;
  return pool;
}

/** ¿Está configurada la integración con el CRM? */
export function isCrmConfigured(): boolean {
  return !!process.env.CRM_DATABASE_URL;
}

/**
 * Resuelve el líder-tope (escalón primero) de un asesor consultando la escalera
 * del CRM. Busca por correo (preferido); si no hay correo o no matchea, cae a
 * coincidencia por nombre. Devuelve null si no se encuentra o el CRM no responde.
 */
export async function resolverLiderComercial(
  correo?: string | null,
  nombre?: string | null,
): Promise<LiderComercial | null> {
  const pool = getCrmPool();
  if (!pool) return null;

  const email = String(correo || '').trim().toLowerCase();
  const name = String(nombre || '').trim();
  if (!email && !name) return null;

  // CTE recursivo: parte del asesor y sube por supervisorId hasta 20 niveles;
  // devuelve el primer nodo (incluyéndose a sí mismo) con rango de líder.
  const sql = `
    WITH RECURSIVE seed AS (
      SELECT id, "firstName", "lastName", email, "position", "supervisorId"
        FROM "User"
       WHERE ${email ? `lower(email) = $1` : `lower("firstName" || ' ' || "lastName") = lower($1)`}
       ORDER BY ("isActive" IS TRUE) DESC
       LIMIT 1
    ),
    up AS (
      SELECT s.*, 0 AS depth FROM seed s
      UNION ALL
      SELECT u.id, u."firstName", u."lastName", u.email, u."position", u."supervisorId", up.depth + 1
        FROM "User" u
        JOIN up ON u.id = up."supervisorId"
       WHERE up.depth < 20
    )
    SELECT "firstName", "lastName", email, "position"::text AS position
      FROM up
     WHERE "position"::text = ANY($2::text[])
     ORDER BY depth ASC
     LIMIT 1;
  `;

  try {
    const arg = email || name;
    const r = await pool.query(sql, [arg, LIDER_RANKS]);
    if (!r.rows.length) return null;
    const row: any = r.rows[0];
    const full = `${row.firstName || ''} ${row.lastName || ''}`.trim();
    return { nombre: full, correo: row.email || null, position: row.position };
  } catch (err: any) {
    console.warn('[crm] resolverLiderComercial falló:', err?.message || err);
    return null;
  }
}

export interface EscaleraComercial {
  ejecutivo: string;
  fullExecutive: string;
  jefeGrupo: string;
  gerente: string;
  gerenteDivision: string;
  salesManager: string;
  /** Filial del asesor en el CRM (`User.filial`); si él no la tiene, la del supervisor más cercano que sí. */
  filial: string;
}

/**
 * Orden de los rangos de la escalera comercial (de abajo hacia arriba). El CRM no tiene el
 * rango "gerente división" (nivel 4): ese escalón lo ocupa quien esté por encima.
 * Regla (verificada contra el Libro de Producción): cada columna toma el nodo MÁS CERCANO al
 * asesor cuyo rango sea IGUAL O SUPERIOR al del escalón; si en la cadena falta un nivel, lo
 * cubre el siguiente hacia arriba (p. ej. sin gerente, el sales manager figura como gerente).
 */
const ORDEN_RANGO: Record<string, number> = {
  ASESOR_TRAINING: 0,
  FULL_EXECUTIVE: 1,
  JEFE_GRUPO: 2,
  GERENTE: 3,
  SALES_MANAGER: 5,
};
const NIVEL_COLUMNA: [keyof EscaleraComercial, number][] = [
  ['fullExecutive', 1], ['jefeGrupo', 2], ['gerente', 3], ['gerenteDivision', 4], ['salesManager', 5],
];

const escaleraCache = new Map<string, { v: EscaleraComercial | null; exp: number }>();

const sinAcentos = (t: string) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/s+/g, ' ').trim();

let usuariosCrmCache: { rows: any[]; exp: number } | null = null;
async function usuariosCrm(pool: Pool): Promise<any[]> {
  if (usuariosCrmCache && usuariosCrmCache.exp > Date.now()) return usuariosCrmCache.rows;
  const r = await pool.query(`SELECT id, email, "firstName", "lastName", "position"::text AS position, "supervisorId", "filial", "isActive" FROM "User"`);
  usuariosCrmCache = { rows: r.rows, exp: Date.now() + 30 * 60 * 1000 };
  return r.rows;
}

/**
 * Respaldo cuando el correo/nombre exacto no aparece: en los contratos el asesor viene con
 * otro correo (personal) o con el nombre completo ("Alejandra Jasmin Oñate Toledo") y en el
 * CRM figura de otra forma ("Alejandra Oñate"). Se busca por nombre sin acentos: todas las
 * palabras del nombre del CRM (mín. 2) están en el nombre del contrato. Sólo se acepta si
 * hay UN solo usuario que cumpla (prefiriendo activos), para no asignar a un homónimo.
 * Devuelve la cadena hacia arriba con la misma forma que la consulta principal.
 */
async function cadenaPorNombreAproximado(pool: Pool, nombre: string): Promise<any[]> {
  const tokens = new Set(sinAcentos(nombre).split(' ').filter(Boolean));
  if (tokens.size < 2) return [];
  const users = await usuariosCrm(pool);
  const cand = users.filter((u) => {
    const t = sinAcentos(`${u.firstName || ''} ${u.lastName || ''}`).split(' ').filter(Boolean);
    return t.length >= 2 && t.every((x) => tokens.has(x));
  });
  const activos = cand.filter((u) => u.isActive === true);
  const unicos = activos.length ? activos : cand;
  if (unicos.length !== 1) return [];
  const porId = new Map(users.map((u) => [u.id, u]));
  const cadena: any[] = [];
  let cur: any = unicos[0];
  for (let d = 0; cur && d < 20; d++) { cadena.push({ ...cur, depth: d }); cur = cur.supervisorId ? porId.get(cur.supervisorId) : null; }
  return cadena;
}

/**
 * Escalera completa del asesor (ejecutivo → full executive → jefe de grupo → gerente →
 * gerente división → sales manager), subiendo por `supervisorId`. Para cada rango toma el
 * nodo MÁS CERCANO al asesor (él mismo cuenta). Alimenta el Libro de Producción.
 * Cacheado 30 min por asesor; best-effort (null si el CRM no responde o no lo encuentra).
 */
export async function resolverEscalera(correo?: string | null, nombre?: string | null): Promise<EscaleraComercial | null> {
  const pool = getCrmPool();
  if (!pool) return null;
  const email = String(correo || '').trim().toLowerCase();
  const name = String(nombre || '').trim();
  if (!email && !name) return null;
  const key = email || name.toLowerCase();
  const hit = escaleraCache.get(key);
  if (hit && hit.exp > Date.now()) return hit.v;

  const sql = `
    WITH RECURSIVE seed AS (
      SELECT id, "firstName", "lastName", email, "position", "supervisorId", "filial"
        FROM "User"
       WHERE ${email ? `lower(email) = $1` : `lower("firstName" || ' ' || "lastName") = lower($1)`}
       ORDER BY ("isActive" IS TRUE) DESC
       LIMIT 1
    ),
    up AS (
      SELECT s.*, 0 AS depth FROM seed s
      UNION ALL
      SELECT u.id, u."firstName", u."lastName", u.email, u."position", u."supervisorId", u."filial", up.depth + 1
        FROM "User" u
        JOIN up ON u.id = up."supervisorId"
       WHERE up.depth < 20
    )
    SELECT "firstName", "lastName", "position"::text AS position, "filial", depth FROM up ORDER BY depth ASC`;
  try {
    const r = await pool.query(sql, [email || name]);
    let rows: any[] = r.rows;
    if (!rows.length && name) rows = await cadenaPorNombreAproximado(pool, name);
    let v: EscaleraComercial | null = null;
    if (rows.length) {
      v = { ejecutivo: '', fullExecutive: '', jefeGrupo: '', gerente: '', gerenteDivision: '', salesManager: '', filial: '' };
      v.filial = String(rows.find((row: any) => String(row.filial || '').trim())?.filial || '').trim();
      const nom = (row: any) => `${row.firstName || ''} ${row.lastName || ''}`.replace(/\s+/g, ' ').trim();
      v.ejecutivo = nom(rows[0]);
      for (const [col, nivel] of NIVEL_COLUMNA) {
        const hit = rows.find((row: any) => (ORDEN_RANGO[row.position] ?? -1) >= nivel);
        if (hit) v[col] = nom(hit);
      }
    }
    escaleraCache.set(key, { v, exp: Date.now() + 30 * 60 * 1000 });
    return v;
  } catch (err: any) {
    console.warn('[crm] resolverEscalera falló:', err?.message || err);
    return null;
  }
}

/** Diagnóstico de solo lectura: usuarios activos por rango y cadena hacia arriba de cada correo. */
export async function crmDiagnostico(emails: string[]) {
  const pool = getCrmPool();
  if (!pool) return { configurado: false, rangos: [], cadenas: {} as Record<string, any[]> };
  const rangos = (await pool.query(
    `SELECT "position"::text AS position, COUNT(*)::int AS n FROM "User" WHERE "isActive" IS TRUE GROUP BY 1 ORDER BY 2 DESC`)).rows;
  const cadenas: Record<string, any[]> = {};
  for (const e of emails) {
    const email = String(e || '').trim().toLowerCase();
    if (!email) continue;
    const r = await pool.query(
      `WITH RECURSIVE up AS (
         SELECT id,"firstName","lastName","position","supervisorId",0 AS depth FROM "User" WHERE lower(email)=$1
         UNION ALL
         SELECT u.id,u."firstName",u."lastName",u."position",u."supervisorId",up.depth+1
           FROM "User" u JOIN up ON u.id=up."supervisorId" WHERE up.depth<20)
       SELECT depth, "firstName" || ' ' || "lastName" AS nombre, "position"::text AS position FROM up ORDER BY depth`, [email]);
    cadenas[email] = r.rows;
  }
  return { configurado: true, rangos, cadenas };
}

export interface ComercialScope {
  /** true = ve todos los contratos (Sales Manager+, o usuario fuera del CRM). */
  seeAll: boolean;
  /** correo del líder por el que se filtra (Gerente/Jefe de Grupo). null si seeAll. */
  liderCorreo: string | null;
  /**
   * Correos y nombres (en minúscula) del usuario y de TODA su escalera hacia abajo en el CRM.
   * Un contrato es del equipo si su líder, su asesor (correo) o su asesor (nombre) está aquí.
   */
  equipo: string[];
  position: string | null;
}

const scopeCache = new Map<string, { v: ComercialScope; exp: number }>();

/**
 * Alcance de vista de un usuario comercial según su rango en la escalera del CRM:
 *  - GERENTE / JEFE_GRUPO → ve SOLO los contratos cuyo líder sea él (liderCorreo = su correo).
 *  - SALES_MANAGER y arriba (CEO, Director, Gerente Divisional) → ve TODO.
 *  - No está en el CRM (admin/coordinador con permiso) → ve TODO (sin restricción).
 * Cacheado 5 min por correo. Best-effort: si el CRM no responde → seeAll (no bloquea la vista).
 */
export async function getUserComercialScope(email?: string | null): Promise<ComercialScope> {
  const e = String(email || '').trim().toLowerCase();
  const openAll: ComercialScope = { seeAll: true, liderCorreo: null, equipo: [], position: null };
  if (!e) return openAll;
  const pool = getCrmPool();
  if (!pool) return openAll;
  const now = Date.now();
  const cached = scopeCache.get(e);
  if (cached && cached.exp > now) return cached.v;
  let scope = openAll;
  try {
    const r = await pool.query(
      `SELECT lower(email) AS email, "position"::text AS pos FROM "User"
        WHERE lower(email) = $1 ORDER BY ("isActive" IS TRUE) DESC LIMIT 1`,
      [e],
    );
    if (r.rows.length) {
      const pos = r.rows[0].pos as string;
      if (LIDER_EQUIPO_RANKS.has(pos)) {
        // Escalera hacia abajo: todos los que reportan (directa o indirectamente) a este líder.
        const d = await pool.query(
          `WITH RECURSIVE down AS (
             SELECT id, lower(email) AS email, lower(trim(coalesce("firstName",'') || ' ' || coalesce("lastName",''))) AS nombre, 0 AS depth
               FROM "User" WHERE lower(email) = $1
             UNION ALL
             SELECT u.id, lower(u.email), lower(trim(coalesce(u."firstName",'') || ' ' || coalesce(u."lastName",''))), down.depth + 1
               FROM "User" u JOIN down ON u."supervisorId" = down.id WHERE down.depth < 20)
           SELECT email, nombre FROM down`, [e]);
        const equipo = Array.from(new Set(d.rows.flatMap((x: any) => [x.email, x.nombre]).filter(Boolean))) as string[];
        scope = { seeAll: false, liderCorreo: r.rows[0].email, equipo: equipo.length ? equipo : [r.rows[0].email], position: pos };
      } else scope = { seeAll: true, liderCorreo: null, equipo: [], position: pos }; // Sales Manager+ / Full Exec / Asesor → todo
    }
  } catch (err: any) {
    console.warn('[crm] getUserComercialScope falló:', err?.message || err);
  }
  scopeCache.set(e, { v: scope, exp: now + 5 * 60 * 1000 });
  return scope;
}

/**
 * Alcance del usuario LOGUEADO: SUPER_ADMIN y ADMIN ven todo sin consultar el
 * CRM; el resto se resuelve por su rango en la escalera.
 *
 * Existe para que la regla del bypass no se siga copiando endpoint por endpoint
 * (ya está escrita a mano en cuatro rutas de Gestión Contrato).
 */
export async function getSessionComercialScope(session: any): Promise<ComercialScope> {
  const role = session?.user?.role;
  if (role === 'SUPER_ADMIN' || role === 'ADMIN') {
    return { seeAll: true, liderCorreo: null, equipo: [], position: null };
  }
  return getUserComercialScope(session?.user?.email || '');
}

/** Diagnóstico de solo lectura: columnas de "User", tablas parecidas a filial/equipo y valores distintos de las columnas candidatas. */
export async function crmEsquema() {
  const pool = getCrmPool();
  if (!pool) return { configurado: false };
  const cols = await pool.query(
    `SELECT table_name, column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND (table_name = 'User'
         OR table_name ILIKE '%filial%' OR table_name ILIKE '%branch%' OR table_name ILIKE '%team%' OR table_name ILIKE '%sucursal%'
         OR column_name ILIKE '%filial%' OR column_name ILIKE '%branch%' OR column_name ILIKE '%team%' OR column_name ILIKE '%sucursal%' OR column_name ILIKE '%company%' OR column_name ILIKE '%empresa%' OR column_name ILIKE '%group%')
      ORDER BY table_name, ordinal_position`);
  const valores: Record<string, any[]> = {};
  for (const c of cols.rows) {
    if (c.table_name !== 'User' || !/filial|branch|team|sucursal|company|empresa|group/i.test(c.column_name)) continue;
    try {
      const r = await pool.query(`SELECT "${c.column_name}"::text AS v, COUNT(*)::int AS n FROM "User" WHERE "isActive" IS TRUE GROUP BY 1 ORDER BY n DESC LIMIT 30`);
      valores[c.column_name] = r.rows;
    } catch { /* ignora */ }
  }
  return { configurado: true, columnas: cols.rows, valores };
}
