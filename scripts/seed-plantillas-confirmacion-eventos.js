/**
 * Crea las plantillas de los WhatsApp automáticos que faltan:
 *   - inscripcion-olimpiada  → al inscribirse a una OLIMPIADA desde el panel
 *   - nivelacion-programada  → al agrupar una nivelación (pasa a Pendientes)
 * (`inscripcion-taller` la crea seed-plantilla-inscripcion-taller.js.)
 * Idempotente: no pisa una plantilla ya editada. Se editan/desactivan en
 * Mantenimiento › Mensajes › Plantillas; inactiva = no se envía.
 *
 * Uso: node scripts/seed-plantillas-confirmacion-eventos.js [--apply]
 */
const { Pool } = require('pg');
const { randomUUID } = require('crypto');
require('dotenv').config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

const PLANTILLAS = [
  {
    slug: 'inscripcion-olimpiada',
    nombre: 'Confirmación inscripción olimpiada',
    descripcion: 'Se envía automáticamente cuando el alumno se inscribe a una olimpiada desde su panel',
    contenido: `🌟 ¡Hola, {{nombreApoderado}}!

Confirmamos la inscripción de {{nombreAlumno}} en la OLIMPIADA MOSAICO de {{curso}}:

📅 {{fechaTaller}}
🕕 Hora: {{horaTaller}} hrs (hora de Chile)

💻 El día de la olimpiada ingrese puntualmente a través de la plataforma web https://mosaicosorobanplataforma.com/, donde encontrará habilitado el enlace para acceder a la sesión.

¡Les esperamos! 😊

Equipo MOSAICO 💙`,
    placeholders: ['nombreApoderado', 'nombreAlumno', 'curso', 'fechaTaller', 'horaTaller'],
  },
  {
    slug: 'nivelacion-programada',
    nombre: 'Nivelación programada',
    descripcion: 'Se envía automáticamente cuando Servicio agrupa la nivelación del alumno (pasa a Pendientes)',
    contenido: `{{nombreApoderado}} te saludamos desde Mosaico para contarte que {{nombreAlumno}} tiene una nivelación programada para el {{fechaNivelacion}} a las {{horaNivelacion}}.
Te pedimos que ingreses a plataforma para que confirmes la hora que te tenemos reservada. Muchas gracias!`,
    placeholders: ['nombreApoderado', 'nombreAlumno', 'fechaNivelacion', 'horaNivelacion'],
  },
];

(async () => {
  for (const t of PLANTILLAS) {
    const { rows } = await pool.query(`SELECT 1 FROM "MESSAGE_TEMPLATES" WHERE "slug" = $1`, [t.slug]);
    if (rows.length) { console.log(`✓ ${t.slug} ya existe (no se toca).`); continue; }
    console.log(`--- ${t.slug} ---\n${t.contenido}\n`);
    if (!APPLY) continue;
    await pool.query(
      `INSERT INTO "MESSAGE_TEMPLATES"("_id","slug","nombre","descripcion","contenido","placeholders","activo","_owner")
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,true,'system') ON CONFLICT ("slug") DO NOTHING`,
      [randomUUID(), t.slug, t.nombre, t.descripcion, t.contenido, JSON.stringify(t.placeholders)]
    );
    console.log(`✅ ${t.slug} creada.`);
  }
  if (!APPLY) console.log('(dry-run) Reejecuta con --apply.');
  await pool.end();
})().catch(async (e) => { console.error('❌', e.message); await pool.end(); process.exit(1); });
