/**
 * Borra UNA ACADEMICA duplicada con sus agendamientos, descontando el contador
 * de inscritos de cada evento y dejando snapshot en PURGE_LOG.
 *
 * Uso:
 *   node scripts/purgar-academica-duplicada.js <academicaId>                      # ensayo
 *   node scripts/purgar-academica-duplicada.js <academicaId> --apply [--motivo="..."]
 *
 * Cuándo hace falta: la aprobación (`approveOnePerson`) crea la ACADEMICA del
 * beneficiario si no la encuentra por `numeroId`. Si en ese momento el numeroId
 * no coincidía (un dato mal capturado que después se corrige), queda una segunda
 * ACADEMICA en WELCOME con todos los agendamientos del curso duplicados — 24-sep-
 * 2026, DANTE HENRIQUEZ: 105 agendamientos, 43 en fechas pasadas, inflando los
 * contadores de 105 eventos y las ausencias en informes.
 *
 * Guardas (cualquiera aborta SIN escribir):
 *  - debe existir otra ACADEMICA con el mismo numeroId (si no, NO es un duplicado);
 *  - ningún agendamiento suyo puede tener asistencia, participación, nota,
 *    cancelación ni anotación (eso es historia y no se borra desde aquí);
 *  - nada puede referenciarla en las tablas que cuelgan de academicaId.
 *
 * PEOPLE nunca se toca: la ACADEMICA duplicada apunta al MISMO PEOPLE que la real.
 */
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});
const ID = process.argv[2];
const APPLY = process.argv.includes('--apply');
const motivoArg = process.argv.find(a => a.startsWith('--motivo='));
const MOTIVO = motivoArg ? motivoArg.slice(9) : 'ACADEMICA duplicada creada por error';
const REALIZADO_POR = process.env.PURGE_REALIZADO_POR || 'script';
if (!ID || ID.startsWith('--')) {
  console.error('Uso: node scripts/purgar-academica-duplicada.js <academicaId> [--apply] [--motivo="..."]');
  process.exit(1);
}

const CON_REGISTRO = b =>
  b.asistio === true || b.asistencia === true || b.participacion === true || b.noAprobo === true ||
  b.cancelo === true || b.escusa === true || b.calificacion != null ||
  ['anotaciones', 'advisorAnotaciones', 'comentarios'].some(k => b[k] && String(b[k]).trim());

const REFERENCIAS = [
  ['CASOS_ATENCION', 'academicaId'], ['STEP_OVERRIDES', 'studentId'], ['COMPLEMENTARIA_ATTEMPTS', 'studentId'],
  ['ZOOM_ACCESOS', 'academicaId'], ['REPORTE_ACADEMICO_NOTAS', 'academicaId'], ['EVALUACION_RESPUESTAS', 'academicaId'],
  ['INASISTENCIA_GESTION', 'academicaId'], ['ACADEMICA_BOOKING_EVALUATIONS', 'studentId'],
];

(async () => {
  const q = (s, p) => pool.query(s, p).then(r => r.rows);
  const acad = (await q(`SELECT * FROM "ACADEMICA" WHERE "_id" = $1`, [ID]))[0];
  if (!acad) throw new Error(`No existe ACADEMICA ${ID}`);

  const hermanas = await q(
    `SELECT "_id","nivel","step","_createdDate" FROM "ACADEMICA" WHERE "numeroId" = $1 AND "_id" <> $2`,
    [acad.numeroId, ID]);
  if (!hermanas.length) throw new Error('No hay otra ACADEMICA con el mismo numeroId: esto NO es un duplicado, no se borra.');

  const bookings = await q(`SELECT * FROM "ACADEMICA_BOOKINGS" WHERE "idEstudiante" = $1 OR "studentId" = $1`, [ID]);
  const conRegistro = bookings.filter(CON_REGISTRO);
  if (conRegistro.length) {
    throw new Error(`${conRegistro.length} agendamiento(s) tienen registro (asistencia/nota/cancelación): no se borra.`);
  }

  const refs = {};
  for (const [tabla, col] of REFERENCIAS) {
    try {
      refs[tabla] = (await q(`SELECT COUNT(*)::int AS n FROM "${tabla}" WHERE "${col}"::text = $1`, [ID]))[0].n;
    } catch (e) {
      refs[tabla] = `(sin tabla/columna: ${e.message.split('\n')[0]})`;
    }
  }
  const bloquean = Object.entries(refs).filter(([, n]) => typeof n === 'number' && n > 0);
  if (bloquean.length) throw new Error(`Referencias en otras tablas: ${JSON.stringify(bloquean)} — no se borra.`);

  const porEvento = new Map();
  for (const b of bookings) {
    const e = b.eventoId || b.idEvento;
    if (e) porEvento.set(e, (porEvento.get(e) || 0) + 1);
  }

  console.log(`ACADEMICA ${ID} · ${acad.primerNombre} ${acad.primerApellido} · ${acad.numeroId} · ${acad.nivel}/${acad.step} · creada ${new Date(acad._createdDate).toISOString()}`);
  console.log(`  hermana(s) que se CONSERVAN: ${hermanas.map(h => `${h._id} (${h.nivel}/${h.step})`).join(', ')}`);
  console.log(`  agendamientos a borrar: ${bookings.length} en ${porEvento.size} eventos (0 con registro)`);
  console.log('  referencias en otras tablas:', refs);
  if (!APPLY) {
    console.log('\nENSAYO — nada escrito. Repita con --apply para aplicar.');
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const snapshot = { academica: acad, bookings, hermanas, eventos: Array.from(porEvento.entries()) };
    await client.query(
      `INSERT INTO "PURGE_LOG"("_id","tipoPurga","contrato","titularId","titularNombre","snapshot","motivo",
                               "realizadoPor","realizadoPorNombre","ip","userAgent","filasBorradas","_createdDate")
       VALUES ($1,'ACADEMICA_DUPLICADA',$2,$3,$4,$5::jsonb,$6,$7,$8,NULL,'scripts/purgar-academica-duplicada.js',$9::jsonb,NOW())`,
      [
        `prg_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
        acad.contrato || null, acad.peopleId || null,
        `${acad.primerNombre || ''} ${acad.primerApellido || ''}`.trim(),
        JSON.stringify(snapshot), MOTIVO, REALIZADO_POR, 'Script',
        JSON.stringify({ ACADEMICA: 1, ACADEMICA_BOOKINGS: bookings.length }),
      ]
    );
    let descontados = 0;
    for (const [evento, n] of porEvento.entries()) {
      const r = await client.query(
        `UPDATE "CALENDARIO" SET "inscritos" = GREATEST(0, COALESCE("inscritos", 0) - $2) WHERE "_id" = $1`,
        [evento, n]);
      descontados += r.rowCount;
    }
    const db = await client.query(`DELETE FROM "ACADEMICA_BOOKINGS" WHERE "idEstudiante" = $1 OR "studentId" = $1`, [ID]);
    const da = await client.query(`DELETE FROM "ACADEMICA" WHERE "_id" = $1`, [ID]);
    await client.query('COMMIT');
    console.log(`\nAPLICADO: ACADEMICA borradas=${da.rowCount} · bookings borrados=${db.rowCount} · eventos con contador descontado=${descontados} · snapshot en PURGE_LOG`);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  const resto = await q(`SELECT COUNT(*)::int AS n FROM "ACADEMICA_BOOKINGS" WHERE "idEstudiante" = $1 OR "studentId" = $1`, [ID]);
  const quedan = await q(`SELECT "_id","nivel","step" FROM "ACADEMICA" WHERE "numeroId" = $1`, [acad.numeroId]);
  console.log(`verificación: bookings restantes del borrado=${resto[0].n} · ACADEMICA de ${acad.numeroId}:`, quedan);
  await pool.end();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
