/**
 * MOSAICO — reemplaza el catálogo LGS de LIBROS_INTERACTIVOS por UN LIBRO POR CURSO.
 *
 * En LGS los libros eran niveles de inglés (ESS, BEGINNER, …) y los sub-niveles
 * (BN1/BN2/BN3) eran rangos de páginas del mismo libro. En MOSAICO cada CURSO
 * (YOJI, OKINA, KODOMO, DANSHI, SENPAI, IMPULSA) es un libro completo → el
 * catálogo debe tener 1 libro por curso (codigo = curso). Las páginas se suben
 * con scripts/upload-libro-interactivo.js (--codigo=YOJI …); no se usan rangos
 * por sub-nivel (cada curso = libro entero).
 *
 * Idempotente. Borra SOLO los 7 libros LGS conocidos y siembra los 6 cursos.
 * Seguro: aborta el borrado de cualquier libro con páginas o bindings.
 *
 * Uso:  node scripts/seed-libros-interactivos-mosaico.js            (dry-run)
 *       node scripts/seed-libros-interactivos-mosaico.js --apply
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const APPLY = process.argv.includes('--apply');

const LGS_CODES = ['ESS', 'BEGINNER', 'PRACTICAL', 'FUNCTIONAL', 'IELTS', 'B2FIRST', 'TOEFL'];
const MOSAICO_LIBROS = [
  { codigo: 'YOJI',    titulo: 'Curso YOJI' },
  { codigo: 'OKINA',   titulo: 'Curso OKINA' },
  { codigo: 'KODOMO',  titulo: 'Curso KODOMO' },
  { codigo: 'DANSHI',  titulo: 'Curso DANSHI' },
  { codigo: 'SENPAI',  titulo: 'Curso SENPAI' },
  { codigo: 'IMPULSA', titulo: 'Curso IMPULSA' },
];

(async () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/g, ''),
    ssl: { rejectUnauthorized: false },
  });
  try {
    const cur = await pool.query(`SELECT codigo, titulo, "totalPaginas" FROM "LIBROS_INTERACTIVOS" ORDER BY codigo`);
    console.log('Catálogo actual:', cur.rows.map(r => r.codigo).join(', ') || '(vacío)');

    // Borrar libros LGS solo si están vacíos (0 páginas y sin bindings en NIVELES).
    const bind = await pool.query(
      `SELECT "libroInteractivoCode" AS c, COUNT(*)::int n FROM "NIVELES"
       WHERE "libroInteractivoCode" = ANY($1) GROUP BY "libroInteractivoCode"`, [LGS_CODES]
    );
    const bindMap = new Map(bind.rows.map(r => [r.c, r.n]));
    const borrables = cur.rows.filter(r => LGS_CODES.includes(r.codigo) && (r.totalPaginas || 0) === 0 && !bindMap.get(r.codigo));
    const noBorrables = cur.rows.filter(r => LGS_CODES.includes(r.codigo) && !borrables.includes(r));
    console.log('LGS a borrar (vacíos):', borrables.map(r => r.codigo).join(', ') || '(ninguno)');
    if (noBorrables.length) console.log('LGS conservados (tienen páginas/bindings):', noBorrables.map(r => r.codigo).join(', '));
    console.log('MOSAICO a sembrar:', MOSAICO_LIBROS.map(l => l.codigo).join(', '));

    if (!APPLY) { console.log('\n(dry-run) Re-ejecuta con --apply para escribir.'); return; }

    for (const r of borrables) {
      await pool.query(`DELETE FROM "LIBROS_INTERACTIVOS" WHERE codigo = $1`, [r.codigo]);
    }
    for (const l of MOSAICO_LIBROS) {
      await pool.query(
        `INSERT INTO "LIBROS_INTERACTIVOS" ("codigo", "titulo")
         VALUES ($1, $2) ON CONFLICT ("codigo") DO UPDATE SET "titulo" = EXCLUDED."titulo"`,
        [l.codigo, l.titulo]
      );
    }
    const fin = await pool.query(`SELECT codigo FROM "LIBROS_INTERACTIVOS" ORDER BY codigo`);
    console.log('\n✅ Catálogo final:', fin.rows.map(r => r.codigo).join(', '));
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
