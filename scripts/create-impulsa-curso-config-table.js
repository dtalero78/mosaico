/**
 * Crea IMPULSA_CURSO_CONFIG — config del calendario fijo de un curso IMPULSA
 * (rango de sesiones, festivos, entrenamientos, evaluaciones, zona de autoría,
 * resumen materializado). Un registro por cursoCampaignId. Idempotente.
 * Uso: node scripts/create-impulsa-curso-config-table.js [--apply]
 */
const {Pool}=require("pg");require("dotenv").config({path:".env.local"});
const APPLY=process.argv.includes("--apply");
const p=new Pool({connectionString:(process.env.DATABASE_URL||"").replace(/[?&]sslmode=[^&]*/g,""),ssl:{rejectUnauthorized:false}});
(async()=>{
  if(!APPLY){ console.log("DRY-RUN (usa --apply) — crearía IMPULSA_CURSO_CONFIG"); await p.end(); return; }
  await p.query(`CREATE TABLE IF NOT EXISTS "IMPULSA_CURSO_CONFIG" (
    "_id" TEXT PRIMARY KEY,
    "cursoCampaignId" TEXT NOT NULL,
    "authorTz" TEXT NOT NULL DEFAULT 'America/Santiago',
    "inicioSesiones" DATE NOT NULL,
    "finSesiones" DATE NOT NULL,
    "festivos" JSONB NOT NULL DEFAULT '[]',
    "entrenamientos" JSONB NOT NULL DEFAULT '[]',
    "evaluaciones" JSONB NOT NULL DEFAULT '[]',
    "resumen" JSONB,
    "materializado" BOOLEAN NOT NULL DEFAULT false,
    "creadoPor" TEXT,
    "_createdDate" TIMESTAMPTZ DEFAULT NOW(),
    "_updatedDate" TIMESTAMPTZ DEFAULT NOW()
  )`);
  await p.query(`CREATE UNIQUE INDEX IF NOT EXISTS "idx_impulsa_config_curso" ON "IMPULSA_CURSO_CONFIG" ("cursoCampaignId")`);
  const n=(await p.query(`SELECT COUNT(*) n FROM "IMPULSA_CURSO_CONFIG"`)).rows[0].n;
  console.log("OK IMPULSA_CURSO_CONFIG creada/verificada. filas:", n);
  await p.end();
})().catch(e=>{console.error("ERR",e.message);process.exit(1)});
