/**
 * Reescribe la plantilla `recordatorio-taller` con los placeholders de taller.
 *
 * La versión anterior tenía la fecha y la hora escritas a mano ("Viernes
 * 16-10-2026", "18:00 hrs") y usaba {{nivel}} —el MÓDULO del alumno— donde iba
 * el curso. Ahora salen del taller ({{fechaTaller}}, {{horaTaller}}, hora de
 * Chile) y del alumno ({{nombreApoderado}}, {{nombreAlumno}}, {{curso}}).
 *
 * Correr DESPUÉS de desplegar el código que conoce esos placeholders: antes, el
 * envío los habría reemplazado por vacío. Guarda el texto anterior en la salida.
 *
 * Uso: node scripts/update-plantilla-recordatorio-taller.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

const CONTENIDO = `🌟 ¡Hola, {{nombreApoderado}}!

Le recordamos que inscribió a su hijo(a) {{nombreAlumno}} en el TALLER DE ENTRENAMIENTO MOSAICO de {{curso}}:

📅 {{fechaTaller}}
🕕 Hora: {{horaTaller}} hrs (hora de Chile)

💻 Recuerde ingresar puntualmente a través de la plataforma web https://mosaicosorobanplataforma.com/, donde encontrará habilitado el enlace para acceder a la sesión.

📲 Si tiene alguna duda, puede contactarnos a través del Área de Nivelaciones y Talleres al +56 9 9619 4536.

¡Les esperamos! 😊

Equipo MOSAICO 💙`;

const PLACEHOLDERS = ['nombreApoderado', 'nombreAlumno', 'curso', 'fechaTaller', 'horaTaller'];

(async () => {
  const { rows } = await pool.query(`SELECT "_id", "contenido" FROM "MESSAGE_TEMPLATES" WHERE "slug" = 'recordatorio-taller'`);
  if (!rows.length) { console.log('❌ No existe la plantilla recordatorio-taller.'); await pool.end(); process.exit(1); }
  console.log('--- Contenido ANTERIOR ---\n' + rows[0].contenido + '\n\n--- Contenido NUEVO ---\n' + CONTENIDO);
  if (rows[0].contenido === CONTENIDO) { console.log('\n✓ Ya está actualizada.'); await pool.end(); return; }
  if (!APPLY) { console.log('\n(dry-run) Reejecuta con --apply.'); await pool.end(); return; }
  await pool.query(
    `UPDATE "MESSAGE_TEMPLATES" SET "contenido" = $2, "placeholders" = $3::jsonb, "_updatedDate" = NOW() WHERE "_id" = $1`,
    [rows[0]._id, CONTENIDO, JSON.stringify(PLACEHOLDERS)]
  );
  console.log('\n✅ Plantilla actualizada.');
  await pool.end();
})().catch(async (e) => { console.error('❌', e.message); await pool.end(); process.exit(1); });
