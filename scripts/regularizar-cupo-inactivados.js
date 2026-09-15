/**
 * Regulariza a los beneficiarios que un admin YA había inactivado antes de que
 * la inactivación soltara el asiento de verdad.
 *
 * Qué arregla: esos alumnos ya no ocupaban cupo por la regla de `lib/cupo`, pero
 * conservaban su campaña/curso/horario/salón y sus CLASES FUTURAS seguían vivas
 * inflando el contador de inscritos del guía, y no había registro de dónde
 * salieron.
 *
 * Hace exactamente lo mismo que `liberarCupoBeneficiario` (misma definición, un
 * solo comportamiento): borra las clases FUTURAS y descuenta `CALENDARIO.inscritos`,
 * suelta el asiento, pone el curso en NULL en PEOPLE y ACADEMICA, y escribe la
 * entrada en `cupoHistory`. Las clases PASADAS se conservan: son su historia.
 *
 * Dos decisiones deliberadas:
 *  - NO se inventa el tipo de salida. Estos alumnos se inactivaron antes de que
 *    existiera esa pregunta, así que `tipoSalida` queda en null y la ficha les
 *    sigue ofreciendo «Activar» — quitárselo los dejaría sin camino de vuelta.
 *  - La `fecha` de la entrada es la de SU inactivación (de `suspenddata`), no la
 *    de hoy: decir que salieron hoy sería falso. Cuándo se corrigió el dato queda
 *    aparte, en `regularizadoEn`.
 *
 * Idempotente: salta a quien ya tenga una entrada LIBERADO en su `cupoHistory`.
 * Transaccional por persona: un fallo deja a ESE alumno intacto y sigue con el resto.
 *
 * Uso: node scripts/regularizar-cupo-inactivados.js [--apply]
 */
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const APPLY = process.argv.includes('--apply');
const ACTOR = 'regularizacion@mosaico';
const MOTIVO = 'Regularizacion retroactiva: inactivado por un admin antes de que la inactivacion soltara el curso y las clases futuras.';

const cs = (process.env.DATABASE_URL || '').replace(/([?&])sslmode=[^&]*/i, '$1sslmode=no-verify');
const pool = new Pool({ connectionString: cs, ssl: { rejectUnauthorized: false } });

async function main() {
  const { rows: candidatos } = await pool.query(`
    SELECT "_id", "numeroId", "contrato",
           TRIM(CONCAT_WS(' ', "primerNombre", "primerApellido")) AS nombre,
           "campaign", "tipoCurso", "horarioCurso", "salon",
           "suspenddata"->>'fecha'  AS "fechaInactivacion",
           "suspenddata"->>'motivo' AS "motivoInactivacion",
           jsonb_array_length(COALESCE("cupoHistory", '[]'::jsonb)) AS "entradasHistorial"
      FROM "PEOPLE"
     WHERE "tipoUsuario" = 'BENEFICIARIO'
       AND "estadoInactivo" IS TRUE
       AND "suspenddata"->>'accion' = 'INACTIVACION'
     ORDER BY nombre`);

  console.log(APPLY ? '== APLICANDO ==' : '== ENSAYO (sin --apply no se escribe nada) ==');
  console.log('Candidatos:', candidatos.length, '\n');

  let procesados = 0, saltados = 0, clasesTotal = 0;

  for (const p of candidatos) {
    if (Number(p.entradasHistorial) > 0) {
      console.log('  SALTA  ', p.nombre, '— ya tiene historial de cupo');
      saltados++;
      continue;
    }

    const academicaIds = (await pool.query(
      `SELECT "_id" FROM "ACADEMICA" WHERE "numeroId" = $1`, [p.numeroId]
    )).rows.map(r => r._id);

    // Cuántas clases futuras se van a soltar (en ensayo sólo se cuentan).
    let futuras = 0;
    if (academicaIds.length) {
      futuras = Number((await pool.query(`
        SELECT COUNT(*) AS n
          FROM "ACADEMICA_BOOKINGS" b
          JOIN "CALENDARIO" c ON (c."_id" = b."eventoId" OR c."_id" = b."idEvento")
         WHERE c."dia" >= NOW()
           AND (b."idEstudiante" = ANY($1::text[]) OR b."studentId" = ANY($1::text[]))`,
        [academicaIds])).rows[0].n);
    }

    const curso = p.tipoCurso
      ? p.tipoCurso + ' ' + (p.horarioCurso || '') + ' / Salon ' + (p.salon || '-') + ' (' + (p.campaign || '-') + ')'
      : 'sin curso';
    console.log('  ' + (APPLY ? 'APLICA ' : 'HARIA  '), p.nombre.padEnd(22), '·', String(futuras).padStart(3), 'clases futuras ·', curso);

    if (!APPLY) { procesados++; clasesTotal += futuras; continue; }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      let soltadas = 0;
      if (academicaIds.length) {
        const del = await client.query(`
          DELETE FROM "ACADEMICA_BOOKINGS" b
           USING "CALENDARIO" c
           WHERE (c."_id" = b."eventoId" OR c."_id" = b."idEvento")
             AND c."dia" >= NOW()
             AND (b."idEstudiante" = ANY($1::text[]) OR b."studentId" = ANY($1::text[]))
           RETURNING c."_id" AS evid`, [academicaIds]);
        soltadas = del.rowCount || 0;
        const evs = Array.from(new Set((del.rows || []).map(r => r.evid).filter(Boolean)));
        if (evs.length) {
          await client.query(`
            UPDATE "CALENDARIO"
               SET "inscritos" = GREATEST(0, COALESCE("inscritos",0) - 1), "_updatedDate" = NOW()
             WHERE "_id" = ANY($1::text[])`, [evs]);
        }
      }

      const entrada = {
        fecha: p.fechaInactivacion || new Date().toISOString(),
        accion: 'LIBERADO',
        origen: 'INACTIVACION',
        tipoSalida: null,
        campaign: p.campaign || null,
        tipoCurso: p.tipoCurso || null,
        horarioCurso: p.horarioCurso || null,
        salon: p.salon || null,
        motivo: MOTIVO + (p.motivoInactivacion ? ' Motivo original: ' + p.motivoInactivacion : ''),
        realizadoPor: ACTOR,
        realizadoPorNombre: 'Regularizacion de datos',
        clasesSoltadas: soltadas,
        regularizadoEn: new Date().toISOString(),
      };

      await client.query(`
        UPDATE "PEOPLE"
           SET "cupoLiberado" = true, "cupoLiberadoPor" = $1, "cupoLiberadoEn" = NOW(),
               "cupoReservadoHasta" = NULL,
               "campaign" = NULL, "tipoCurso" = NULL, "horarioCurso" = NULL, "salon" = NULL,
               "cupoHistory" = COALESCE("cupoHistory", '[]'::jsonb) || $3::jsonb,
               "_updatedDate" = NOW()
         WHERE "_id" = $2`,
        [ACTOR, p._id, JSON.stringify([entrada])]);

      await client.query(`
        UPDATE "ACADEMICA" SET "campaign" = NULL, "salon" = NULL, "_updatedDate" = NOW()
         WHERE "numeroId" = $1`, [p.numeroId]);

      await client.query('COMMIT');
      procesados++;
      clasesTotal += soltadas;
    } catch (e) {
      await client.query('ROLLBACK');
      console.log('    ERROR — sin cambios para', p.nombre, ':', e.message);
    } finally {
      client.release();
    }
  }

  console.log('\nResumen:', procesados, 'procesados ·', saltados, 'saltados ·', clasesTotal, 'clases futuras soltadas');
  if (!APPLY) console.log('Ensayo. Vuelve a correr con --apply para escribir.');
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
