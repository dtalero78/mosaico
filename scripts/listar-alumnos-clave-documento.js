/**
 * Lista los alumnos que entran a la plataforma con su NÚMERO DE DOCUMENTO como
 * clave, es decir: nunca completaron el registro (`/nuevo-usuario/[id]`), así que
 * su `USUARIOS_ROLES.password` sigue siendo la clave placeholder.
 *
 * No repara nada: es el barrido para saber a quiénes avisar. Entrar con el
 * documento es correcto — al hacerlo, la plataforma les pide definir su clave.
 *
 * Genera además un CSV para poder contactarlos.
 *
 * Uso: node scripts/listar-alumnos-clave-documento.js [--csv]
 */
const fs = require('fs');
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const CSV = process.argv.includes('--csv');
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

(async () => {
  const { rows } = await pool.query(
    `SELECT TRIM(CONCAT_WS(' ', a."primerNombre", a."primerApellido")) AS nombre,
            a."numeroId", a."userLogin", a."curso", p."salon", p."campaign",
            u."password", u."activo" AS login_activo,
            (u."perfilActualizado" IS NOT NULL) AS perfil_completado,
            a."clave" AS clave_elegida,
            p."celular", p."apoderadoTelefono", p."email", p."contrato"
       FROM "ACADEMICA" a
       JOIN "PEOPLE" p ON p."numeroId" = a."numeroId" AND p."tipoUsuario" = 'BENEFICIARIO'
       JOIN "USUARIOS_ROLES" u
         ON (COALESCE(a."userLogin",'') <> '' AND u."userLogin" = a."userLogin")
         OR (COALESCE(a."userLogin",'') = '' AND UPPER(TRIM(u."numberid")) = UPPER(TRIM(a."numeroId")) AND u."rol" = 'ESTUDIANTE')
      WHERE LOWER(COALESCE(p."aprobacion",'')) IN ('aprobado','aprobada')
        AND COALESCE(p."contrato",'') NOT LIKE 'PRB-%'
        -- La clave de login ES su documento → placeholder, nunca la cambió
        AND UPPER(TRIM(u."password")) = UPPER(TRIM(a."numeroId"))
      ORDER BY p."campaign", a."curso", p."salon", nombre`
  );

  const activos = rows.filter(r => r.login_activo);
  const inactivos = rows.filter(r => !r.login_activo);

  console.log(`\nAlumnos cuya clave de login es su DOCUMENTO (sin completar registro): ${rows.length}`);
  console.log(`  · pueden entrar ya (login activo): ${activos.length}`);
  console.log(`  · aún inactivos (los activa el cron): ${inactivos.length}`);

  const porCampaign = {};
  for (const r of rows) porCampaign[r.campaign || '(sin campaña)'] = (porCampaign[r.campaign || '(sin campaña)'] || 0) + 1;
  console.log('\nPor campaña:');
  console.table(Object.entries(porCampaign).map(([campaign, n]) => ({ campaign, alumnos: n })));

  console.log('\nPrimeros 15:');
  console.table(rows.slice(0, 15).map(r => ({
    nombre: r.nombre, documento: r.numeroId, usuario: r.userLogin,
    curso: r.curso, salon: r.salon, activo: r.login_activo,
    tel: r.celular || r.apoderadoTelefono || '(sin teléfono)',
  })));

  const sinTelefono = rows.filter(r => !r.celular && !r.apoderadoTelefono).length;
  if (sinTelefono) console.log(`\n⚠️ ${sinTelefono} no tienen ningún teléfono para avisarles.`);

  if (CSV) {
    const cab = ['Nombre', 'Documento (=clave)', 'Usuario', 'Curso', 'Salon', 'Campaña', 'Activo', 'Telefono', 'Email', 'Contrato'];
    const linea = r => [r.nombre, r.numeroId, r.userLogin, r.curso, r.salon, r.campaign,
      r.login_activo ? 'Sí' : 'No', r.celular || r.apoderadoTelefono || '', r.email || '', r.contrato || '']
      .map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';');
    fs.writeFileSync('alumnos-clave-documento.csv', '﻿' + [cab.join(';'), ...rows.map(linea)].join('\n'), 'utf8');
    console.log('\n📄 CSV escrito: alumnos-clave-documento.csv');
  }
  await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
