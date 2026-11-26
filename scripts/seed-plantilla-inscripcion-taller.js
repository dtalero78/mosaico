/**
 * Crea la plantilla `inscripcion-taller`: el WhatsApp que sale SOLO cuando el
 * alumno se inscribe a un taller desde su panel. Idempotente (no pisa una
 * plantilla ya editada). Se edita o desactiva en Mantenimiento › Mensajes ›
 * Plantillas; inactiva = no se envía nada.
 *
 * Uso: node scripts/seed-plantilla-inscripcion-taller.js [--apply]
 */
const { Pool } = require('pg');
const { randomUUID } = require('crypto');
require('dotenv').config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

const CONTENIDO = `🌟 ¡Hola, {{nombreApoderado}}!

Confirmamos la inscripción de {{nombreAlumno}} en el TALLER DE ENTRENAMIENTO MOSAICO de {{curso}}:

📅 {{fechaTaller}}
🕕 Hora: {{horaTaller}} hrs (hora de Chile)

💻 El día del taller ingrese puntualmente a través de la plataforma web https://mosaicosorobanplataforma.com/, donde encontrará habilitado el enlace para acceder a la sesión.

📲 Si tiene alguna duda, puede contactarnos a través del Área de Nivelaciones y Talleres al +56 9 9619 4536.

¡Les esperamos! 😊

Equipo MOSAICO 💙`;

const PLACEHOLDERS = ['nombreApoderado', 'nombreAlumno', 'curso', 'fechaTaller', 'horaTaller'];

(async () => {
  const { rows } = await pool.query(`SELECT "_id" FROM "MESSAGE_TEMPLATES" WHERE "slug" = 'inscripcion-taller'`);
  if (rows.length) { console.log('✓ La plantilla inscripcion-taller ya existe (no se toca).'); await pool.end(); return; }
  console.log('--- Plantilla a crear ---\n' + CONTENIDO);
  if (!APPLY) { console.log('\n(dry-run) Reejecuta con --apply.'); await pool.end(); return; }
  await pool.query(
    `INSERT INTO "MESSAGE_TEMPLATES"("_id","slug","nombre","descripcion","contenido","placeholders","activo","_owner")
     VALUES ($1,'inscripcion-taller','Confirmación inscripción taller',
             'Se envía automáticamente cuando el alumno se inscribe a un taller desde su panel',
             $2,$3::jsonb,true,'system')
     ON CONFLICT ("slug") DO NOTHING`,
    [randomUUID(), CONTENIDO, JSON.stringify(PLACEHOLDERS)]
  );
  console.log('\n✅ Plantilla creada.');
  await pool.end();
})().catch(async (e) => { console.error('❌', e.message); await pool.end(); process.exit(1); });
