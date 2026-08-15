/**
 * Migra los Casos de Atención del modelo ANTERIOR al módulo nuevo.
 *
 * Antes, un booking con `casoAtencion=true` ERA el caso, y el texto vivía en
 * `advisorAnotaciones`. Ahora hay un caso con estados y N reportes.
 *
 * Reglas de la conversión:
 *  - **Un caso por ALUMNO**, no por booking: en el modelo nuevo el caso agrupa
 *    los reportes de una misma situación. Los bookings marcados del alumno se
 *    convierten en los reportes de ese caso, ordenados por fecha.
 *  - `tema = OTRO`: el modelo viejo no tenía tema, y adivinarlo del texto sería
 *    inventar. Queda para que el gestor lo ajuste.
 *  - Los reportes quedan **sin leer**, que es lo que corresponde: nadie los ha
 *    abierto todavía en el módulo nuevo.
 *  - **COPIA, no mueve**: los bookings conservan `casoAtencion=true`, así que el
 *    informe Servicio › Casos de Atención sigue mostrándolos igual que hoy.
 *    ⚠ Durante la convivencia, resolver en Servicio NO cierra el caso nuevo.
 *
 * Idempotente: salta a los alumnos que ya tengan un caso migrado (se reconocen
 * porque su reporte guarda el `bookingId` de origen).
 *
 * Uso: node scripts/migrar-casos-atencion.js [--apply]
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const crypto = require('crypto');

const APPLY = process.argv.includes('--apply');
const nid = (pfx) => `${pfx}_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`;
const limpio = (c) => String(c || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();

(async () => {
  const pool = new Pool({
    connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
    ssl: { rejectUnauthorized: false },
  });

  const { rows } = await pool.query(
    `SELECT b."_id" AS "bookingId",
            a."_id" AS "academicaId", a."numeroId",
            p."contrato",
            TRIM(CONCAT_WS(' ', p."primerNombre", p."primerApellido")) AS alumno,
            COALESCE(b."eventoId", b."idEvento") AS "eventoId",
            COALESCE(c."dia", b."fechaEvento") AS fecha,
            b."advisorAnotaciones" AS texto,
            g."nombreCompleto" AS guia, cc."guia" AS "guiaId"
       FROM "ACADEMICA_BOOKINGS" b
       JOIN "ACADEMICA" a ON a."_id" = COALESCE(b."idEstudiante", b."studentId")
       JOIN "PEOPLE" p ON p."_id" = a."peopleId"
       LEFT JOIN "CALENDARIO" c ON c."_id" = COALESCE(b."eventoId", b."idEvento")
       LEFT JOIN "CURSOS_CAMPAIGN" cc
         ON cc."campaign" = p."campaign" AND cc."tipoCurso" = p."tipoCurso"
        AND cc."horarioCurso" = p."horarioCurso"
       LEFT JOIN "GUIAS" g ON g."_id" = cc."guia"
      WHERE b."casoAtencion" = true
        AND COALESCE(p."contrato", '') NOT LIKE 'PRB-%'
        AND COALESCE(TRIM(b."advisorAnotaciones"), '') <> ''
      ORDER BY a."_id", COALESCE(c."dia", b."fechaEvento")`
  );

  // Ya migrados: el reporte conserva el bookingId de origen.
  const { rows: yaHay } = await pool.query(
    `SELECT DISTINCT "bookingId" FROM "CASOS_REPORTES" WHERE "bookingId" IS NOT NULL`
  );
  const migrados = new Set(yaHay.map(r => r.bookingId));

  const porAlumno = new Map();
  for (const r of rows) {
    if (migrados.has(r.bookingId)) continue;
    if (!porAlumno.has(r.academicaId)) porAlumno.set(r.academicaId, []);
    porAlumno.get(r.academicaId).push(r);
  }

  console.log(`Bookings con caso abierto: ${rows.length} · ya migrados: ${rows.length - [...porAlumno.values()].flat().length}`);
  console.log(`Casos a crear: ${porAlumno.size}\n`);
  for (const [, items] of porAlumno) {
    console.log(`  ${items[0].alumno.padEnd(30)} ${items[0].contrato || 'sin contrato'} · ${items.length} reporte(s)`);
  }

  if (!porAlumno.size) { console.log('\n✅ Nada que migrar.'); await pool.end(); return; }
  if (!APPLY) { console.log('\n(dry-run — no se escribió nada. Reejecuta con --apply.)'); await pool.end(); return; }

  let casos = 0, reportes = 0;
  for (const [academicaId, items] of porAlumno) {
    const base = items[0];
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Mismo código que genera el servicio: CA-<contrato limpio>-<consecutivo>.
      const cl = limpio(base.contrato);
      let codigo;
      if (cl) {
        await client.query(`SELECT pg_advisory_xact_lock($1, hashtext($2))`, [8471, cl]);
        const { rows: [n] } = await client.query(
          `SELECT COALESCE(MAX(NULLIF(SPLIT_PART("codigo", '-', 3), '')::int), 0) + 1 AS n
             FROM "CASOS_ATENCION" WHERE "codigo" LIKE $1`, [`CA-${cl}-%`]
        );
        codigo = `CA-${cl}-${String(n.n).padStart(2, '0')}`;
      } else {
        const { rows: [n] } = await client.query(
          `SELECT COUNT(*)::int + 1 AS n FROM "CASOS_ATENCION" WHERE "contrato" IS NULL`
        );
        codigo = `CA-SINCONTRATO-${String(n.n).padStart(2, '0')}`;
      }

      const { rows: [aca] } = await client.query(
        `SELECT COALESCE("casosCount", 0) AS n FROM "ACADEMICA" WHERE "_id" = $1`, [academicaId]
      );
      const casoId = nid('cas');

      await client.query(
        `INSERT INTO "CASOS_ATENCION"
           ("_id","codigo","academicaId","numeroId","contrato","numeroCaso","tema","estado","eventoOrigenId","abiertoPor","abiertoEn")
         VALUES ($1,$2,$3,$4,$5,$6,'OTRO','EN_GESTION',$7,$8,$9)`,
        [casoId, codigo, academicaId, base.numeroId, base.contrato,
          Number(aca.n) + 1, base.eventoId, base.guia || null, base.fecha || new Date()]
      );
      await client.query(
        `UPDATE "ACADEMICA" SET "casosCount" = COALESCE("casosCount",0) + 1 WHERE "_id" = $1`,
        [academicaId]
      );
      await client.query(
        `INSERT INTO "CASOS_ESTADO_HISTORIAL"("_id","casoId","estadoAnterior","estadoNuevo","autorNombre","motivo")
         VALUES ($1,$2,NULL,'EN_GESTION',$3,'Migrado del modelo anterior de Casos de Atención')`,
        [nid('cmt'), casoId, base.guia || null]
      );

      for (const [i, r] of items.entries()) {
        await client.query(
          `INSERT INTO "CASOS_REPORTES"
             ("_id","casoId","academicaId","texto","tema","eventoId","bookingId","guiaId","guiaNombre","abrioCaso","leido","_createdDate")
           VALUES ($1,$2,$3,$4,'OTRO',$5,$6,$7,$8,$9,false,$10)`,
          [nid('rep'), casoId, academicaId, String(r.texto).trim(), r.eventoId, r.bookingId,
            r.guiaId || null, r.guia || null, i === 0, r.fecha || new Date()]
        );
        reportes++;
      }

      await client.query('COMMIT');
      casos++;
      console.log(`  ✓ ${codigo} — ${base.alumno} (${items.length} reporte(s))`);
    } catch (e) {
      await client.query('ROLLBACK');
      console.error(`  ✗ ${base.alumno}: ${e.message}`);
    } finally { client.release(); }
  }

  console.log(`\n✅ Migrados ${casos} caso(s) con ${reportes} reporte(s).`);
  console.log('   Los bookings conservan casoAtencion=true: Servicio los sigue mostrando igual.');
  await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
