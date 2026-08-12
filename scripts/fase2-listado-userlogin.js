/**
 * MOSAICO — Fase 2: listado de credenciales de alumnos para reenvío de mensajes.
 * Genera un CSV con: contrato · numeroId · nombre · userLogin · email · celular ·
 * plataforma · activo · email_sintetico(sí/no). Solo lectura.
 *
 * Uso: node scripts/fase2-listado-userlogin.js [ruta-salida.csv]
 *      (default: listado-userlogin-mosaico.csv en la raíz del repo — gitignored)
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const fs = require('fs');
const OUT = process.argv[2] || 'listado-userlogin-mosaico.csv';
const csv = (v) => {
  const s = v == null ? '' : String(v);
  return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

(async () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/g, ''),
    ssl: { rejectUnauthorized: false },
  });

  const rows = (await pool.query(
    `SELECT ur."contrato", ur."numberid" AS "numeroId",
            TRIM(CONCAT_WS(' ', ur."nombre", ur."apellido")) AS nombre,
            ur."userLogin", ur."email", ur."celular", ur."plataforma", ur."activo"
       FROM "USUARIOS_ROLES" ur
      WHERE ur."rol" = 'ESTUDIANTE'
      ORDER BY ur."contrato" NULLS LAST, nombre`
  )).rows;

  const header = ['contrato', 'numeroId', 'nombre', 'userLogin', 'email', 'celular', 'plataforma', 'activo', 'email_sintetico'];
  const lines = [header.join(';')];
  let sinteticos = 0;
  for (const r of rows) {
    const sint = /@est\.mosaico\.cl$/i.test(r.email || '');
    if (sint) sinteticos++;
    lines.push([
      r.contrato, r.numeroId, r.nombre, r.userLogin, r.email, r.celular,
      r.plataforma, r.activo ? 'sí' : 'no', sint ? 'sí' : 'no',
    ].map(csv).join(';'));
  }

  // BOM UTF-8 para Excel (acentos/ñ)
  fs.writeFileSync(OUT, '﻿' + lines.join('\r\n'), 'utf8');
  console.log(`✅ ${rows.length} alumnos → ${OUT}`);
  console.log(`   con email sintético (@est.mosaico.cl): ${sinteticos}`);
  console.log(`   con celular: ${rows.filter(r => (r.celular || '').trim()).length}`);
  await pool.end();
})().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
