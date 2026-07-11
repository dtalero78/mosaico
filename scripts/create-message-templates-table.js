// Migración idempotente: crea MESSAGE_TEMPLATES y siembra 5 plantillas iniciales.
//
// Tabla:
//   - _id          (PK varchar)
//   - slug         (UNIQUE varchar) — identificador legible (bienvenida, recordatorio, etc.)
//   - nombre       (varchar) — etiqueta mostrada en UI
//   - descripcion  (text, nullable) — explicación opcional
//   - contenido    (text NOT NULL) — el mensaje con placeholders {{nombre}} etc.
//   - placeholders (jsonb) — array de placeholders usados (informativo)
//   - activo       (boolean DEFAULT true)
//   - _owner       (varchar nullable) — email del creador
//   - _createdDate / _updatedDate
//
// Seed: 5 plantillas en ON CONFLICT DO NOTHING (idempotente — si ya existen
// no se sobreescriben). El admin puede editar / desactivar / agregar nuevas
// desde /admin/plantillas/gestion.
//
//   node scripts/create-message-templates-table.js
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const SEED = [
  {
    slug: 'bienvenida',
    nombre: 'Bienvenida',
    descripcion: 'Mensaje de bienvenida al estudiante recién registrado.',
    contenido: 'Hola {{nombre}}, te damos la bienvenida a MOSAICO. Tu nivel actual es {{nivel}} - {{step}}. Cualquier duda escríbenos.',
    placeholders: ['nombre', 'nivel', 'step'],
  },
  {
    slug: 'recordatorio-clase',
    nombre: 'Recordatorio de Clase',
    descripcion: 'Recuerda al estudiante que ingrese a su panel para revisar su próxima clase.',
    contenido: 'Hola {{nombre}}, te recordamos tu próxima clase. Ingresa a tu panel para ver detalles: https://mosaicosorobanplataforma.com/login',
    placeholders: ['nombre'],
  },
  {
    slug: 'progreso',
    nombre: 'Información de Progreso',
    descripcion: 'Comparte el avance académico del estudiante.',
    contenido: 'Hola {{nombre}}, queremos compartirte tu avance en {{nivel}} - {{step}}. Sigue así.',
    placeholders: ['nombre', 'nivel', 'step'],
  },
  {
    slug: 'material-estudio',
    nombre: 'Material de Estudio',
    descripcion: 'Notifica que hay material disponible para el nivel y step actuales.',
    contenido: 'Hola {{nombre}}, te recordamos que tienes material de estudio para {{nivel}} - {{step}} disponible en tu panel.',
    placeholders: ['nombre', 'nivel', 'step'],
  },
  {
    slug: 'felicitaciones',
    nombre: 'Felicitaciones',
    descripcion: 'Felicita al estudiante por su progreso.',
    contenido: 'Hola {{nombre}}, queremos felicitarte por tu progreso en {{nivel}} - {{step}}. ¡Excelente trabajo!',
    placeholders: ['nombre', 'nivel', 'step'],
  },
];

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    // 1) Crear tabla
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "MESSAGE_TEMPLATES" (
        "_id"          VARCHAR(255) PRIMARY KEY,
        "slug"         VARCHAR(60)  NOT NULL UNIQUE,
        "nombre"       VARCHAR(120) NOT NULL,
        "descripcion"  TEXT,
        "contenido"    TEXT         NOT NULL,
        "placeholders" JSONB        DEFAULT '[]'::jsonb,
        "activo"       BOOLEAN      DEFAULT true,
        "_owner"       VARCHAR(255),
        "_createdDate" TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        "_updatedDate" TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_msg_tpl_activo ON "MESSAGE_TEMPLATES"("activo")`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_msg_tpl_slug   ON "MESSAGE_TEMPLATES"("slug")`);
    console.log('✅ Tabla MESSAGE_TEMPLATES lista (o ya existía).');

    // 2) Seed
    let nuevas = 0;
    for (const t of SEED) {
      const _id = `tpl_${t.slug}_${Date.now().toString(36).slice(-4)}_${Math.random().toString(36).slice(2, 6)}`;
      const r = await pool.query(
        `INSERT INTO "MESSAGE_TEMPLATES"("_id","slug","nombre","descripcion","contenido","placeholders","activo","_owner")
         VALUES ($1,$2,$3,$4,$5,$6,true,'system')
         ON CONFLICT ("slug") DO NOTHING
         RETURNING "slug"`,
        [_id, t.slug, t.nombre, t.descripcion, t.contenido, JSON.stringify(t.placeholders)]
      );
      if (r.rowCount) {
        nuevas++;
        console.log(`   + Seed insertado: ${t.slug}`);
      } else {
        console.log(`   · Seed ya existía:   ${t.slug} (se respeta el existente)`);
      }
    }
    console.log(`\n✅ ${nuevas} plantilla(s) sembrada(s) (de ${SEED.length} candidatas).`);

    const total = await pool.query(`SELECT COUNT(*)::int n FROM "MESSAGE_TEMPLATES"`);
    console.log(`   Total filas en MESSAGE_TEMPLATES: ${total.rows[0].n}`);
  } finally {
    await pool.end();
  }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
