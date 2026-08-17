/**
 * Catálogo EDITABLE de horarios por tipo de curso.
 *
 * Hasta ahora vivía hardcodeado en `src/lib/cursos-campaign.ts` (constantes
 * HORARIOS_MENORES / _DANSHI / _SENPAI / _IMPULSA), así que agregar un horario
 * exigía tocar código y desplegar — y por eso el catálogo fue acumulando
 * entradas marcadas "histórico" a mano.
 *
 * ⚠ El catálogo NO participa en ninguna consulta de negocio: sólo llena el
 * desplegable de "Agregar curso" y valida el alta/edición de un curso. Los
 * salones se siguen resolviendo por el TEXTO de la terna
 * (campaign, tipoCurso, horarioCurso) contra CURSOS_CAMPAIGN y PEOPLE, que no
 * se toca. Por eso mover esto a una tabla no altera ningún endpoint.
 *
 * Quitar un horario lo **desactiva** (`activo=false`): deja de ofrecerse para
 * cursos nuevos, pero los cursos y alumnos que ya lo usan siguen intactos —
 * igual que hoy, que el guard de edición perdona los horarios ya guardados.
 * No se renombra: para corregir uno se agrega el nuevo y se desactiva el viejo.
 *
 * SEED = el catálogo actual del código + CUALQUIER horario ya en uso en
 * CURSOS_CAMPAIGN, para que nada de lo que existe quede fuera de la lista.
 *
 * Uso: node scripts/create-horarios-curso-table.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

const DDL = `
CREATE TABLE IF NOT EXISTS "HORARIOS_CURSO" (
  "_id"          VARCHAR(255) PRIMARY KEY,
  "tipoCurso"    VARCHAR(50)  NOT NULL,
  "horario"      VARCHAR(120) NOT NULL,
  "orden"        INTEGER      NOT NULL DEFAULT 0,
  "activo"       BOOLEAN      NOT NULL DEFAULT true,
  "creadoPor"    TEXT,
  "_createdDate" TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  "_updatedDate" TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE ("tipoCurso", "horario")
);
CREATE INDEX IF NOT EXISTS "idx_horarios_curso_activo" ON "HORARIOS_CURSO" ("tipoCurso", "activo");
`;

// Copia literal del catálogo de src/lib/cursos-campaign.ts al momento de migrar.
const MENORES = [
  'LUN-MIÉ 17:00-18:00', 'LUN-MIÉ 18:15-19:15', 'LUN-MIÉ 19:30-20:30',
  'MAR-JUE 17:00-18:00', 'MAR-JUE 18:15-19:15', 'MAR-JUE 19:30-20:30',
  'SÁB 09:00-11:00', 'SÁB 10:00-12:00', 'SÁB 11:00-13:00',
];
const CATALOGO = {
  YOJI: MENORES, OKINA: MENORES, KODOMO: MENORES,
  DANSHI: ['LUN-MIÉ 19:00-19:50', 'MAR-JUE 19:00-19:50', 'SÁB 09:00-11:00', 'SÁB 10:00-12:00', 'SÁB 11:00-13:00'],
  SENPAI: ['LUN-MIÉ 20:00-20:50', 'MAR-JUE 19:00-19:50', 'MAR-JUE 20:00-20:50', 'SÁB 09:00-11:00', 'SÁB 10:00-12:00', 'SÁB 11:00-13:00'],
  IMPULSA: ['LUN-MIÉ-VIE 20:00-21:00'],
};

const idFor = (i) => `hor_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 8)}`;

(async () => {
  const existe = await pool.query(
    `SELECT to_regclass('public."HORARIOS_CURSO"') IS NOT NULL AS ok`
  );
  const yaExiste = existe.rows[0].ok;
  console.log(yaExiste ? '✓ La tabla HORARIOS_CURSO ya existe.' : 'La tabla HORARIOS_CURSO se creará.');

  // Horarios REALMENTE en uso (por si alguno no está en el catálogo del código).
  const { rows: enUso } = await pool.query(
    `SELECT DISTINCT "tipoCurso", "horarioCurso" AS horario FROM "CURSOS_CAMPAIGN"
      WHERE "tipoCurso" IS NOT NULL AND "horarioCurso" IS NOT NULL`
  );

  // Unión catálogo + uso real, conservando el orden del catálogo.
  const filas = [];
  const visto = new Set();
  for (const [tipo, lista] of Object.entries(CATALOGO)) {
    lista.forEach((horario, i) => {
      const k = `${tipo}|${horario}`;
      if (visto.has(k)) return;
      visto.add(k);
      filas.push({ tipo, horario, orden: (i + 1) * 10, origen: 'catálogo' });
    });
  }
  for (const r of enUso) {
    const k = `${r.tipoCurso}|${r.horario}`;
    if (visto.has(k)) continue;
    visto.add(k);
    filas.push({ tipo: r.tipoCurso, horario: r.horario, orden: 999, origen: 'en uso (no estaba en el catálogo)' });
  }

  const extras = filas.filter(f => f.origen !== 'catálogo');
  console.log(`\nA sembrar: ${filas.length} horarios (${filas.length - extras.length} del catálogo del código).`);
  if (extras.length) {
    console.log('Horarios en uso que NO estaban en el catálogo (se agregan igual):');
    console.table(extras.map(e => ({ curso: e.tipo, horario: e.horario })));
  } else {
    console.log('No hay horarios en uso fuera del catálogo.');
  }

  if (!APPLY) {
    console.log('\n(dry-run — nada se escribió. Volvé a correr con --apply)');
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(DDL);
    let n = 0;
    for (let i = 0; i < filas.length; i++) {
      const f = filas[i];
      // ON CONFLICT DO NOTHING: re-correr no pisa lo que el admin haya cambiado
      // después (por ejemplo un horario que ya desactivó a mano).
      const r = await client.query(
        `INSERT INTO "HORARIOS_CURSO" ("_id","tipoCurso","horario","orden","activo","creadoPor")
         VALUES ($1,$2,$3,$4,true,'seed:catalogo-inicial')
         ON CONFLICT ("tipoCurso","horario") DO NOTHING`,
        [idFor(i), f.tipo, f.horario, f.orden]
      );
      n += r.rowCount;
    }
    await client.query('COMMIT');
    const { rows: [{ total }] } = await pool.query(`SELECT COUNT(*)::int AS total FROM "HORARIOS_CURSO"`);
    console.log(`\n✓ Tabla lista. ${n} horario(s) insertado(s). Total en el catálogo: ${total}.`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('✗ Falló, no se escribió nada:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})().catch(e => { console.error(e.message); process.exit(1); });
