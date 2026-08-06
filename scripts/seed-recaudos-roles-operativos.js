/**
 * MOSAICO — otorga el set de permisos OPERATIVOS de Recaudos a los roles que operan
 * el módulo: RECAUDOS_JEFE (control total) y RECAUDOS_ASESOR (operar pagos/asignaciones).
 *
 * Estos roles nacían casi vacíos (ASESOR=0 permisos, JEFE sin permisos de recaudos),
 * así que no veían el módulo. El scope de DATOS lo aplica el servicio por rol
 * (jefe = su equipo; asesor = sólo sus titulares) — los permisos sólo abren la FEATURE.
 *
 * MERGE idempotente: agrega los que falten, no quita nada. El admin refina en
 * /admin/permissions.
 * Uso: node scripts/seed-recaudos-roles-operativos.js [--apply]
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const APPLY = process.argv.includes('--apply');

// Set común a AMBOS roles (operar pagos + ver/asignar)
const COMUN = [
  'RECAUDOS.GESTION.VER',
  'RECAUDOS.ASIGNACION.VER',
  'RECAUDOS.APROBACIONES.VER',
  'RECAUDOS.APROBACIONES.ASIGNAR',
  'PERSON.FINANCIERA.RESUMEN_VER',
  'PERSON.FINANCIERA.INFO_PAGOS_VER',
  'PERSON.FINANCIERA.PAGOS_VER',
  'PERSON.FINANCIERA.PAGOS_REGISTRAR',
  'PERSON.FINANCIERA.PAGOS_VALIDAR',
  'PERSON.FINANCIERA.PAGOS_RECIBO',
  'PERSON.FINANCIERA.ASIGNAR_GESTOR_RECAUDO',
];
// Extra sólo para el JEFE (controles de nivel superior)
const SOLO_JEFE = [
  'RECAUDOS.ASIGNACION.EXPORTAR',
  'RECAUDOS.BANCOS.VER',
  'RECAUDOS.APROBACION_MASIVA',
  'PERSON.FINANCIERA.CAMBIO_ESTADO_CARTERA',
  'PERSON.FINANCIERA.PAGOS_ELIMINAR',
];
const PLAN = {
  RECAUDOS_JEFE:   [...COMUN, ...SOLO_JEFE],
  RECAUDOS_ASESOR: [...COMUN],
};

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/g, ''), ssl: { rejectUnauthorized: false } });
  let n = 0;
  for (const [rol, wanted] of Object.entries(PLAN)) {
    const { rows } = await pool.query(`SELECT permisos FROM "ROL_PERMISOS" WHERE rol = $1`, [rol]);
    if (rows.length === 0) { console.log(`  ⚠ rol ${rol} no existe en ROL_PERMISOS — omitido`); continue; }
    const perms = Array.isArray(rows[0].permisos) ? rows[0].permisos : JSON.parse(rows[0].permisos || '[]');
    const set = new Set(perms);
    const nuevos = wanted.filter(p => !set.has(p));
    if (nuevos.length === 0) { console.log(`  = ${rol}: ya tiene los ${wanted.length} permisos`); continue; }
    nuevos.forEach(p => { set.add(p); console.log(`  ${APPLY ? '✓' : '·'} ${rol} +${p}`); });
    n++;
    if (APPLY) await pool.query(`UPDATE "ROL_PERMISOS" SET permisos=$2::jsonb,"fechaActualizacion"=NOW() WHERE rol=$1`, [rol, JSON.stringify([...set])]);
  }
  console.log(APPLY ? `\n✅ ${n} rol(es) actualizados.` : `\n(dry-run) ${n} rol(es) cambiarían. --apply para escribir.`);
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
