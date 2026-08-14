/**
 * Repara los perfiles que quedaron A MEDIAS por el bug del `ON CONFLICT ("email")`
 * en POST /api/nuevo-usuario/[id].
 *
 * Qué pasó: ese endpoint no es transaccional y corría en 3 pasos —
 *   1) UPDATE ACADEMICA (detalles, hobbies, clave elegida, foto)   → SÍ se aplicó
 *   2) UPDATE PEOPLE (email, domicilio, fecha nacimiento)          → SÍ se aplicó
 *   3) upsert USUARIOS_ROLES (clave de LOGIN, perfilActualizado)   → reventaba 42P10
 * desde que Fase 2 eliminó el UNIQUE de USUARIOS_ROLES.email. Resultado: el alumno
 * eligió su clave, la ve guardada en ACADEMICA, pero el login sigue con la clave
 * placeholder (= su numeroId) y NO puede entrar.
 *
 * Este script copia ACADEMICA.clave → USUARIOS_ROLES.password (que es lo que el
 * endpoint debía haber hecho) y marca perfilActualizado. Resuelve la cuenta por
 * IDENTIDAD (userLogin, único; fallback numberid) — nunca por email, que los
 * hermanos comparten.
 *
 * NO toca `activo` (eso lo decide el cron activate-academica) ni la foto.
 * Idempotente: sólo actúa donde las claves difieren.
 *
 * Uso: node scripts/fix-perfil-clave-desincronizada.js [--apply] [--id=NUMEROID,...]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');
const idArg = process.argv.find(a => a.startsWith('--id='));
const SOLO_IDS = idArg ? idArg.slice(5).split(',').map(s => s.trim()).filter(Boolean) : null;
/**
 * --solo-placeholder: limita la reparación a los alumnos cuya clave de login es
 * literalmente su número de documento (la placeholder con la que nacen). Deja
 * fuera a quienes ya tienen otra clave en el login, que podrían estar usándola:
 * cambiársela los dejaría fuera de la plataforma.
 */
const SOLO_PLACEHOLDER = process.argv.includes('--solo-placeholder');
const esPlaceholder = (r) =>
  String(r.clave_login || '').trim().toUpperCase() === String(r.numeroId || '').trim().toUpperCase();

const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

const mask = s => (!s ? '(vacío)' : `${String(s).slice(0, 2)}${'*'.repeat(Math.max(0, String(s).length - 3))}${String(s).slice(-1)}`);

(async () => {
  // Alumnos que YA completaron el registro en ACADEMICA pero cuya cuenta de login
  // conserva otra clave. El JOIN va por userLogin y, si falta, por numberid.
  const { rows } = await pool.query(
    `SELECT a."_id"        AS academica_id,
            a."numeroId",
            TRIM(CONCAT_WS(' ', a."primerNombre", a."primerApellido")) AS nombre,
            a."userLogin",
            a."clave"      AS clave_elegida,
            a."foto",
            u."_id"        AS usuario_rol_id,
            u."password"   AS clave_login,
            u."perfilActualizado",
            u."activo"
       FROM "ACADEMICA" a
       JOIN "USUARIOS_ROLES" u
         ON (a."userLogin" IS NOT NULL AND a."userLogin" <> ''
             AND LOWER(TRIM(u."userLogin")) = LOWER(TRIM(a."userLogin")))
         OR (COALESCE(a."userLogin",'') = ''
             AND u."rol" = 'ESTUDIANTE'
             AND UPPER(TRIM(u."numberid")) = UPPER(TRIM(a."numeroId")))
      WHERE COALESCE(a."clave", '') <> ''
        AND COALESCE(a."detallesPersonales", '') <> ''
        AND u."password" IS DISTINCT FROM a."clave"
      ORDER BY a."_updatedDate" DESC NULLS LAST`
  );

  let afectados = SOLO_IDS ? rows.filter(r => SOLO_IDS.includes(r.numeroId)) : rows;
  const excluidos = [];
  if (SOLO_PLACEHOLDER) {
    for (const r of afectados) if (!esPlaceholder(r)) excluidos.push(r);
    afectados = afectados.filter(esPlaceholder);
  }

  if (!afectados.length) {
    console.log('✅ No hay perfiles con la clave de login desincronizada.');
    await pool.end();
    return;
  }

  console.log(`\n${afectados.length} alumno(s) con la clave de login desincronizada:\n`);
  console.table(afectados.map(r => ({
    numeroId: r.numeroId,
    nombre: r.nombre,
    userLogin: r.userLogin,
    clave_elegida: mask(r.clave_elegida),
    clave_login_actual: mask(r.clave_login),
    login_es_el_documento: String(r.clave_login).toUpperCase() === String(r.numeroId).toUpperCase() ? 'sí (placeholder)' : 'no',
    perfil_marcado: r.perfilActualizado ? 'sí' : 'no',
    activo: r.activo,
    tiene_foto: r.foto ? 'sí' : 'no',
  })));

  if (excluidos.length) {
    console.log(`\n⚠️ Excluidos por --solo-placeholder (su clave de login NO es su documento, podrían estar usándola): ${excluidos.length}`);
    console.table(excluidos.map(r => ({
      numeroId: r.numeroId, nombre: r.nombre, userLogin: r.userLogin,
      clave_login_actual: mask(r.clave_login), clave_elegida: mask(r.clave_elegida),
    })));
  }

  if (!APPLY) {
    console.log('\n(dry-run — no se escribió nada. Reejecuta con --apply para sincronizar.)');
    await pool.end();
    return;
  }

  let ok = 0;
  for (const r of afectados) {
    try {
      await pool.query(
        `UPDATE "USUARIOS_ROLES"
            SET "password"          = $1,
                "perfilActualizado" = COALESCE("perfilActualizado", NOW()),
                "_updatedDate"      = NOW()
          WHERE "_id" = $2`,
        [r.clave_elegida, r.usuario_rol_id]
      );
      ok++;
      console.log(`✅ ${r.nombre} (${r.numeroId}) — login ${r.userLogin}: clave sincronizada`);
    } catch (e) {
      console.error(`❌ ${r.nombre} (${r.numeroId}): ${e.message}`);
    }
  }
  console.log(`\nListo: ${ok}/${afectados.length} sincronizados.`);
  await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
