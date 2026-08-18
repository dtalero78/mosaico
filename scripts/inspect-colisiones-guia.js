/**
 * Lista los cruces de horario de un mismo GUÍA entre cursos de campaña.
 *
 * Un guía no puede dictar dos cursos a la vez. Desde agosto-2026 la plataforma
 * lo impide al asignar/editar el guía de un curso, pero los cursos que ya
 * estaban cruzados siguen ahí: este script los saca para corregirlos a mano.
 *
 * Colisión = mismo guía, ambos cursos activos, comparten día de la semana, sus
 * horarios se solapan Y sus vigencias (inicioCurso→finalCurso) coinciden.
 *
 * Sólo LEE. Uso: node scripts/inspect-colisiones-guia.js [--csv]
 */
const fs = require('fs');
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const CSV = process.argv.includes('--csv');
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

// Las reglas se IMPORTAN de src/ en vez de copiarse: node >= 22.6 lee TypeScript
// directamente (aquí corre 24). Si esto falla por la versión de node, hay que
// actualizarla — NO volver a pegar una copia, que es de donde venía el problema.
const { horariosSeSolapan: chocan } = require('../src/lib/cursos-campaign.ts');
const etiqueta = (c) => `${c.campaign} · ${c.tipoCurso} · ${c.salon || 's/salón'} · ${c.horarioCurso}`;

(async () => {
  const { rows } = await pool.query(
    `SELECT cc."_id", cc."campaign", cc."tipoCurso", cc."salon", cc."horarioCurso",
            cc."inicioCurso"::text AS ini, cc."finalCurso"::text AS fin,
            cc."guia", g."nombreCompleto" AS "guiaNombre"
       FROM "CURSOS_CAMPAIGN" cc
       LEFT JOIN "GUIAS" g ON g."_id" = cc."guia"
      WHERE cc."activa" = true AND COALESCE(cc."guia",'') NOT IN ('', 'null')
      ORDER BY g."nombreCompleto", cc."campaign"`
  );

  const out = [];
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i], b = rows[j];
      if (a.guia !== b.guia) continue;
      if (!chocan(a.horarioCurso, b.horarioCurso)) continue;
      const sinFechas = !a.ini || !a.fin || !b.ini || !b.fin;
      if (!sinFechas && !(a.ini <= b.fin && b.ini <= a.fin)) continue;
      out.push({
        guia: a.guiaNombre || a.guia,
        cursoA: etiqueta(a), vigenciaA: `${a.ini || '?'} → ${a.fin || '?'}`,
        cursoB: etiqueta(b), vigenciaB: `${b.ini || '?'} → ${b.fin || '?'}`,
        sinFechas: sinFechas ? 'sí' : '',
      });
    }
  }

  console.log(`\nCursos activos con guía: ${rows.length}`);
  console.log(`Cruces de horario detectados: ${out.length}\n`);
  if (out.length) {
    const porGuia = {};
    for (const o of out) porGuia[o.guia] = (porGuia[o.guia] || 0) + 1;
    console.log('Por guía:');
    console.table(Object.entries(porGuia).sort((a, b) => b[1] - a[1]).map(([guia, cruces]) => ({ guia, cruces })));
    console.log('\nDetalle:');
    console.table(out);
  } else {
    console.log('✅ Ningún guía tiene dos cursos a la misma hora.');
  }

  if (CSV && out.length) {
    const cab = ['Guia', 'Curso A', 'Vigencia A', 'Curso B', 'Vigencia B', 'Sin fechas'];
    const linea = o => [o.guia, o.cursoA, o.vigenciaA, o.cursoB, o.vigenciaB, o.sinFechas]
      .map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';');
    fs.writeFileSync('colisiones-guia.csv', '﻿' + [cab.join(';'), ...out.map(linea)].join('\n'), 'utf8');
    console.log('\n📄 CSV escrito: colisiones-guia.csv');
  }
  await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
