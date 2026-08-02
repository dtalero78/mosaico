/**
 * Agrega columnas de líder comercial (escalera del CRM):
 *   EQUIPO_COMERCIAL.lider / liderCorreo   — líder-tope de cada asesor (catálogo)
 *   PEOPLE.liderComercial / liderComercialCorreo — snapshot del líder al crear el contrato
 * Idempotente (ADD COLUMN IF NOT EXISTS). Uso: node scripts/add-lider-comercial-columns.js
 */
const {Pool}=require("pg");require("dotenv").config({path:".env.local"});
const url=(process.env.DATABASE_URL||"").replace(/[?&]sslmode=[^&]*/g,"");
const p=new Pool({connectionString:url,ssl:{rejectUnauthorized:false}});
(async()=>{
  await p.query(`ALTER TABLE "EQUIPO_COMERCIAL" ADD COLUMN IF NOT EXISTS "lider" TEXT`);
  await p.query(`ALTER TABLE "EQUIPO_COMERCIAL" ADD COLUMN IF NOT EXISTS "liderCorreo" TEXT`);
  await p.query(`ALTER TABLE "PEOPLE" ADD COLUMN IF NOT EXISTS "liderComercial" TEXT`);
  await p.query(`ALTER TABLE "PEOPLE" ADD COLUMN IF NOT EXISTS "liderComercialCorreo" TEXT`);
  console.log("OK columnas líder comercial creadas/verificadas.");
  await p.end();
})().catch(e=>{console.error("ERR",e.message);process.exit(1)});
