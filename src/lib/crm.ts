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
