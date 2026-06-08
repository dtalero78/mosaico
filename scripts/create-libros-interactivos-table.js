// Migración idempotente para "Material Interactivo v2" (libros con rangos).
//
// CONTEXTO
// --------
// Hoy el botón "Material Interactivo" del panel del estudiante lleva a un sitio
// externo (lgsplataforma.com/material-{nivel}, hospedado en Wix). Cada libro
// es un array de imágenes con dos botones (atrás/adelante), sin audio embebido.
//
// Esta migración prepara la BD para servir el mismo libro desde LGS Admin
// Panel, con el modelo:
//
//   - LIBROS_INTERACTIVOS: catálogo de libros completos (ESS, BEGINNER,
//     PRACTICAL, FUNCTIONAL, IELTS, B2FIRST, TOEFL). Cada libro tiene N
//     imágenes en DO Spaces + un array JSONB de audios opcionales por página.
//
//   - NIVELES.libroInteractivoCode (FK a LIBROS_INTERACTIVOS.codigo) +
//     libroPaginaInicio + libroPaginaFin: cada nivel (BN1, BN2, BN3, ...)
//     apunta a un libro y a un RANGO de páginas de ese libro. Así "Beginner"
//     se sube una sola vez y BN1/BN2/BN3 son slices que se actualizan
//     automáticamente cuando se reemplaza el libro padre.
//
//   - APP_CONFIG.material_interactivo_v2_activo: feature flag global
//     ('false' por defecto). Con flag OFF la app muestra solo el botón viejo
//     (Wix). Con flag ON aparece también el botón nuevo "Material Interactivo
//     (LGS)" → /panel-estudiante/material-interactivo/[nivel]. Coexistencia
//     durante validación; se quita Wix cuando todo esté migrado.
//
// Sin --apply → DRY RUN, lista lo que va a hacer.
// Con --apply → ejecuta ALTERs, CREATE TABLE IF NOT EXISTS y seeds.

const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const APPLY = process.argv.includes('--apply');

// Catálogo inicial: 7 libros (los 4 primeros se cargan ya; IELTS/B2F/TOEFL
// quedan en el catálogo pero sin imágenes — se completarán después).
const LIBROS_SEED = [
  { codigo: 'ESS',        titulo: 'Essential — Let´s Go Speak 2024' },
  { codigo: 'BEGINNER',   titulo: 'Beginner — Let´s Go Speak 2024'  },
  { codigo: 'PRACTICAL',  titulo: 'Practical — Let´s Go Speak 2024' },
  { codigo: 'FUNCTIONAL', titulo: 'Functional — Let´s Go Speak 2024'},
  { codigo: 'IELTS',      titulo: 'IELTS Preparation' },
  { codigo: 'B2FIRST',    titulo: 'B2 First Preparation' },
  { codigo: 'TOEFL',      titulo: 'TOEFL Preparation' },
];

// Asociación nivel → libro + rango. Los rangos (libroPaginaInicio/libroPaginaFin)
// son una primera aproximación — el admin podrá ajustarlos desde /admin tras
// subir los PDFs. NULL en libroPaginaFin = hasta el final.
const NIVEL_BINDINGS = [
  { code: 'ESS',     libroCode: 'ESS',        inicio: 1,   fin: null },
  { code: 'BN1',     libroCode: 'BEGINNER',   inicio: 1,   fin: null }, // rango por definir
  { code: 'BN2',     libroCode: 'BEGINNER',   inicio: 1,   fin: null },
  { code: 'BN3',     libroCode: 'BEGINNER',   inicio: 1,   fin: null },
  { code: 'P1',      libroCode: 'PRACTICAL',  inicio: 1,   fin: null },
  { code: 'P2',      libroCode: 'PRACTICAL',  inicio: 1,   fin: null },
  { code: 'P3',      libroCode: 'PRACTICAL',  inicio: 1,   fin: null },
  { code: 'F1',      libroCode: 'FUNCTIONAL', inicio: 1,   fin: null },
  { code: 'F2',      libroCode: 'FUNCTIONAL', inicio: 1,   fin: null },
  { code: 'F3',      libroCode: 'FUNCTIONAL', inicio: 1,   fin: null },
  { code: 'IELTS',   libroCode: 'IELTS',      inicio: 1,   fin: null },
  { code: 'B2FIRST', libroCode: 'B2FIRST',    inicio: 1,   fin: null },
  { code: 'TOEFL',   libroCode: 'TOEFL',      inicio: 1,   fin: null },
];

(async () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  const log = (...args) => console.log(...args);

  try {
    // ── 1) Verificar estado actual ────────────────────────────────────────
    const tableExists = await pool.query(`
      SELECT 1 FROM information_schema.tables
       WHERE table_name = 'LIBROS_INTERACTIVOS' LIMIT 1
    `);
    const colExists = await pool.query(`
      SELECT column_name FROM information_schema.columns
       WHERE table_name = 'NIVELES'
         AND column_name IN ('libroInteractivoCode', 'libroPaginaInicio', 'libroPaginaFin')
    `);
    const flagExists = await pool.query(`
      SELECT "key" FROM "APP_CONFIG" WHERE "key" = 'material_interactivo_v2_activo'
    `);

    log('Estado actual:');
    log(`  Tabla LIBROS_INTERACTIVOS:     ${tableExists.rowCount > 0 ? '✅ existe' : '❌ no existe'}`);
    log(`  Columnas en NIVELES:           ${colExists.rowCount}/3`);
    log(`  Flag APP_CONFIG:               ${flagExists.rowCount > 0 ? '✅ ya seteado' : '❌ falta'}`);

    if (!APPLY) {
      log('\n🟡 DRY-RUN. Se ejecutará:\n');
      log('  CREATE TABLE IF NOT EXISTS "LIBROS_INTERACTIVOS" (...);');
      log('  ALTER TABLE "NIVELES" ADD COLUMN IF NOT EXISTS "libroInteractivoCode" VARCHAR(20);');
      log('  ALTER TABLE "NIVELES" ADD COLUMN IF NOT EXISTS "libroPaginaInicio" INT DEFAULT 1;');
      log('  ALTER TABLE "NIVELES" ADD COLUMN IF NOT EXISTS "libroPaginaFin" INT;');
      log('  + seed de 7 libros en LIBROS_INTERACTIVOS (sin tocar los que ya existan)');
      log('  + seed de bindings nivel→libro en NIVELES (solo donde libroInteractivoCode IS NULL)');
      log('  + seed APP_CONFIG.material_interactivo_v2_activo = "false"');
      log('\n  Re-ejecutar con --apply para aplicar.');
      return;
    }

    log('\n🔴 Aplicando migración...\n');

    // ── 2) CREATE TABLE LIBROS_INTERACTIVOS ───────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "LIBROS_INTERACTIVOS" (
        "codigo"        VARCHAR(20) PRIMARY KEY,
        "titulo"        VARCHAR(200) NOT NULL,
        "totalPaginas"  INT NOT NULL DEFAULT 0,
        "audios"        JSONB NOT NULL DEFAULT '[]'::jsonb,
        "activo"        BOOLEAN NOT NULL DEFAULT true,
        "_createdDate"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "_updatedDate"  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    log('  ✅ Tabla LIBROS_INTERACTIVOS lista');

    // ── 3) ALTER NIVELES ──────────────────────────────────────────────────
    await pool.query(`ALTER TABLE "NIVELES" ADD COLUMN IF NOT EXISTS "libroInteractivoCode" VARCHAR(20)`);
    await pool.query(`ALTER TABLE "NIVELES" ADD COLUMN IF NOT EXISTS "libroPaginaInicio" INT DEFAULT 1`);
    await pool.query(`ALTER TABLE "NIVELES" ADD COLUMN IF NOT EXISTS "libroPaginaFin" INT`);
    log('  ✅ Columnas en NIVELES listas');

    // ── 4) Seed de libros (no sobrescribe existentes) ─────────────────────
    for (const l of LIBROS_SEED) {
      await pool.query(
        `INSERT INTO "LIBROS_INTERACTIVOS" ("codigo", "titulo")
         VALUES ($1, $2)
         ON CONFLICT ("codigo") DO NOTHING`,
        [l.codigo, l.titulo]
      );
    }
    log(`  ✅ Seed de ${LIBROS_SEED.length} libros en catálogo`);

    // ── 5) Bindings nivel → libro (solo donde libroInteractivoCode está NULL) ──
    let bindingsAplicados = 0;
    for (const b of NIVEL_BINDINGS) {
      const r = await pool.query(
        `UPDATE "NIVELES"
            SET "libroInteractivoCode" = $1,
                "libroPaginaInicio"    = $2,
                "libroPaginaFin"       = $3
          WHERE "code" = $4
            AND "libroInteractivoCode" IS NULL`,
        [b.libroCode, b.inicio, b.fin, b.code]
      );
      bindingsAplicados += r.rowCount;
    }
    log(`  ✅ Bindings aplicados a ${bindingsAplicados} filas en NIVELES`);

    // ── 6) Feature flag en APP_CONFIG ─────────────────────────────────────
    await pool.query(`
      INSERT INTO "APP_CONFIG" ("key", "value", "color", "updatedBy", "_updatedDate")
      VALUES ('material_interactivo_v2_activo', 'false', '#ffffff', 'migration', NOW())
      ON CONFLICT ("key") DO NOTHING
    `);
    log('  ✅ APP_CONFIG.material_interactivo_v2_activo seteado (default false)');

    // ── 7) Verificación final ─────────────────────────────────────────────
    log('\n🎉 Migración completa. Verificación:\n');
    const libros = await pool.query(
      `SELECT "codigo", "titulo", "totalPaginas", "activo" FROM "LIBROS_INTERACTIVOS" ORDER BY "codigo"`
    );
    console.table(libros.rows);

    const niveles = await pool.query(
      `SELECT DISTINCT "code", "libroInteractivoCode", "libroPaginaInicio", "libroPaginaFin"
         FROM "NIVELES"
        WHERE "libroInteractivoCode" IS NOT NULL
        ORDER BY "code"`
    );
    console.table(niveles.rows);
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
