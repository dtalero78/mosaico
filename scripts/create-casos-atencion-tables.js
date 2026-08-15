/**
 * MOSAICO — Módulo de Casos de Atención.
 *
 * Reemplaza el modelo plano actual (`ACADEMICA_BOOKINGS.casoAtencion` bool +
 * `advisorAnotaciones` texto, donde un booking marcado ERA el caso) por un
 * modelo con entidades propias:
 *
 *   CASOS_ATENCION          el caso: tema, estado, acuerdo, finanzas, reincidencia
 *   CASOS_REPORTES          los reportes del guía (inmutables, N por caso)
 *   CASOS_CONTACTOS         intentos de contacto con el apoderado (canal × intento)
 *   CASOS_ESTADO_HISTORIAL  auditoría de cada cambio de estado
 *   ACADEMICA."casosCount"  contador de casos del alumno (el "N.º 3" de la ficha)
 *
 * ⚠ Los ENUM son NATIVOS de PostgreSQL (no CHECK constraints) para que
 * `prisma/schema.prisma` los refleje tal como los define el spec. Ampliar uno
 * más adelante se hace con `ALTER TYPE ... ADD VALUE`.
 *
 * NO migra los casos viejos: eso va aparte, cuando se decida qué hacer con el
 * informe de Servicio que hoy los consume.
 *
 * Idempotente. Uso: node scripts/create-casos-atencion-tables.js [--apply]
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const APPLY = process.argv.includes('--apply');

const ENUMS = {
  estado_caso: ['EN_GESTION', 'RESUELTO', 'PROCESO_DE_CIERRE', 'PROPUESTA_DE_CAMBIO',
    'CIERRA_PROGRAMA', 'REMITIDO_A_ACADEMICA', 'PROGRAMA_CONGELADO', 'PRE_JURIDICO', 'SIN_CONTACTO'],
  tema_caso: ['ASISTENCIA', 'CONDUCTA', 'DESEMPENO', 'SALUD', 'PAGO', 'OTRO'],
  canal_contacto: ['LLAMADA', 'WHATSAPP', 'EMAIL'],
  resultado_contacto: ['CONTESTO', 'NO_CONTESTO', 'RESPONDIO', 'SIN_RESPUESTA', 'PENDIENTE'],
  nivel_reincidencia: ['BAJA', 'MEDIA', 'ALTA'],
};

const DDL = [
  // ── El caso ────────────────────────────────────────────────────────────────
  // El contexto (curso, salón, horario, guía, contrato, apoderado, asesor,
  // finanzas) NO se copia: se deriva del evento de origen y del contrato vigente
  // (regla R10). Por eso aquí sólo va `eventoOrigenId`.
  `CREATE TABLE IF NOT EXISTS "CASOS_ATENCION" (
     "_id"                    VARCHAR(50) PRIMARY KEY,
     "codigo"                 VARCHAR(20) NOT NULL UNIQUE,
     "academicaId"            VARCHAR(50) NOT NULL,
     "numeroId"               VARCHAR(50),
     "numeroCaso"             INTEGER NOT NULL DEFAULT 1,
     "tema"                   tema_caso NOT NULL DEFAULT 'OTRO',
     "estado"                 estado_caso NOT NULL DEFAULT 'EN_GESTION',
     "eventoOrigenId"         VARCHAR(50),
     "acuerdo"                TEXT,
     "fechaCompromiso"        DATE,
     "responsable"            VARCHAR(255),
     "seguimientoFinanzas"    TEXT,
     "reincidenciaNivel"      nivel_reincidencia,
     "reincidenciaPatron"     VARCHAR(60),
     "reincidenciaFactores"   JSONB,
     "reincidenciaCalculadaEn" TIMESTAMPTZ,
     "abiertoPor"             VARCHAR(255),
     "abiertoEn"              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     "cerradoPor"             VARCHAR(255),
     "cerradoEn"              TIMESTAMPTZ,
     "_createdDate"           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     "_updatedDate"           TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  // Un alumno puede tener VARIOS casos abiertos a la vez, uno por tema (R3):
  // el índice parcial acelera "los abiertos de este alumno" sin impedirlo.
  `CREATE INDEX IF NOT EXISTS idx_casos_academica ON "CASOS_ATENCION" ("academicaId")`,
  `CREATE INDEX IF NOT EXISTS idx_casos_abiertos ON "CASOS_ATENCION" ("academicaId", "tema")
     WHERE "estado" = 'EN_GESTION'`,
  `CREATE INDEX IF NOT EXISTS idx_casos_estado ON "CASOS_ATENCION" ("estado", "abiertoEn" DESC)`,

  // ── Los reportes del guía (R1, R4: inmutables, sin update ni delete) ───────
  `CREATE TABLE IF NOT EXISTS "CASOS_REPORTES" (
     "_id"           VARCHAR(50) PRIMARY KEY,
     "casoId"        VARCHAR(50) NOT NULL REFERENCES "CASOS_ATENCION"("_id") ON DELETE CASCADE,
     "academicaId"   VARCHAR(50) NOT NULL,
     "texto"         TEXT NOT NULL,
     "tema"          tema_caso NOT NULL DEFAULT 'OTRO',
     "eventoId"      VARCHAR(50),
     "bookingId"     VARCHAR(50),
     "guiaId"        VARCHAR(50),
     "guiaNombre"    VARCHAR(255),
     "abrioCaso"     BOOLEAN NOT NULL DEFAULT false,
     -- R7: un reporte que llega a un caso ya en gestión nace SIN leer.
     "leido"         BOOLEAN NOT NULL DEFAULT false,
     "leidoPor"      VARCHAR(255),
     "leidoEn"       TIMESTAMPTZ,
     "_createdDate"  TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_casos_rep_caso ON "CASOS_REPORTES" ("casoId", "_createdDate" DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_casos_rep_noleido ON "CASOS_REPORTES" ("casoId") WHERE "leido" = false`,

  // ── Intentos de contacto (R8: sin tope, sólo se agregan) ──────────────────
  `CREATE TABLE IF NOT EXISTS "CASOS_CONTACTOS" (
     "_id"           VARCHAR(50) PRIMARY KEY,
     "casoId"        VARCHAR(50) NOT NULL REFERENCES "CASOS_ATENCION"("_id") ON DELETE CASCADE,
     "canal"         canal_contacto NOT NULL,
     "intento"       INTEGER NOT NULL,
     "resultado"     resultado_contacto NOT NULL DEFAULT 'PENDIENTE',
     "observacion"   TEXT,
     "autorEmail"    VARCHAR(255),
     "autorNombre"   VARCHAR(255),
     "_createdDate"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     UNIQUE ("casoId", "canal", "intento")
   )`,
  `CREATE INDEX IF NOT EXISTS idx_casos_cont_caso ON "CASOS_CONTACTOS" ("casoId", "canal", "intento")`,

  // ── Historial de estados (R6) ─────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS "CASOS_ESTADO_HISTORIAL" (
     "_id"            VARCHAR(50) PRIMARY KEY,
     "casoId"         VARCHAR(50) NOT NULL REFERENCES "CASOS_ATENCION"("_id") ON DELETE CASCADE,
     "estadoAnterior" estado_caso,
     "estadoNuevo"    estado_caso NOT NULL,
     "autorEmail"     VARCHAR(255),
     "autorNombre"    VARCHAR(255),
     "motivo"         TEXT,
     "_createdDate"   TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_casos_hist_caso ON "CASOS_ESTADO_HISTORIAL" ("casoId", "_createdDate" DESC)`,

  // El "N.º 3" de la ficha: cuántos casos ha tenido el alumno en total.
  `ALTER TABLE "ACADEMICA" ADD COLUMN IF NOT EXISTS "casosCount" INTEGER NOT NULL DEFAULT 0`,
];

(async () => {
  const pool = new Pool({
    connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
    ssl: { rejectUnauthorized: false },
  });

  // ── Estado actual ──
  const tablas = ['CASOS_ATENCION', 'CASOS_REPORTES', 'CASOS_CONTACTOS', 'CASOS_ESTADO_HISTORIAL'];
  const { rows: hay } = await pool.query(
    `SELECT table_name FROM information_schema.tables WHERE table_name = ANY($1)`, [tablas]
  );
  const existentes = new Set(hay.map(r => r.table_name));
  const { rows: enumsHay } = await pool.query(
    `SELECT typname FROM pg_type WHERE typname = ANY($1)`, [Object.keys(ENUMS)]
  );
  const enumsExistentes = new Set(enumsHay.map(r => r.typname));
  const { rows: [colCount] } = await pool.query(
    `SELECT 1 AS ok FROM information_schema.columns
      WHERE table_name = 'ACADEMICA' AND column_name = 'casosCount'`
  );

  console.log('ENUMS:');
  for (const e of Object.keys(ENUMS)) console.log(`  ${e.padEnd(22)} ${enumsExistentes.has(e) ? 'ya existe' : 'FALTA'}`);
  console.log('TABLAS:');
  for (const t of tablas) console.log(`  ${t.padEnd(24)} ${existentes.has(t) ? 'ya existe' : 'FALTA'}`);
  console.log(`  ACADEMICA."casosCount"   ${colCount ? 'ya existe' : 'FALTA'}`);

  const faltaAlgo = tablas.some(t => !existentes.has(t))
    || Object.keys(ENUMS).some(e => !enumsExistentes.has(e))
    || !colCount;
  if (!faltaAlgo) { console.log('\n✅ Nada que hacer.'); await pool.end(); return; }
  if (!APPLY) { console.log('\n(dry-run — no se escribió nada. Reejecuta con --apply.)'); await pool.end(); return; }

  // ── Aplicar ──
  // Los ENUM no tienen "CREATE TYPE IF NOT EXISTS": se envuelve en DO/EXCEPTION.
  for (const [nombre, valores] of Object.entries(ENUMS)) {
    await pool.query(
      `DO $$ BEGIN
         CREATE TYPE ${nombre} AS ENUM (${valores.map(v => `'${v}'`).join(', ')});
       EXCEPTION WHEN duplicate_object THEN NULL; END $$`
    );
  }
  for (const sql of DDL) await pool.query(sql);

  const { rows: [chk] } = await pool.query(
    `SELECT (SELECT COUNT(*)::int FROM information_schema.tables WHERE table_name = ANY($1)) AS tablas,
            (SELECT COUNT(*)::int FROM pg_type WHERE typname = ANY($2)) AS enums`,
    [tablas, Object.keys(ENUMS)]
  );
  console.log(`\n✅ Aplicado. Tablas: ${chk.tablas}/4 · enums: ${chk.enums}/5 · ACADEMICA."casosCount" listo.`);
  console.log('   (sin filas: el módulo arranca vacío; la migración de los casos viejos va aparte)');
  await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
