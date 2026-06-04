// Purga de registros legacy de PEOPLE + cascada completa de dependencias.
//
// Útil para limpiar registros que NO siguen la convención `contrato='PRB-...'`
// (por ej. pruebas creadas antes de que existiera el feature, o cualquier
// otro caso donde se necesite eliminar PEOPLE específicos junto a su contrato
// + beneficiarios + bookings + financieros + pagos + usuarios_roles).
//
// El endpoint /admin/contratos-prueba/purge solo acepta contratos con prefijo
// PRB-. Este script es la herramienta complementaria para casos especiales,
// gateada por SUPER_ADMIN (ejecución directa contra BD).
//
// Por cada PEOPLE._id:
//   - Si tiene `contrato` poblado → agrupa por contrato y purga TODO el
//     contrato (titular + beneficiarios + sus dependencias).
//   - Si no tiene `contrato` → purga solo esa fila + sus dependencias por
//     numeroId/email (ACADEMICA, BOOKINGS, USUARIOS_ROLES, PAGOS, etc).
//
// Snapshot completo de cada fila se preserva en PURGE_LOG con
// `tipoPurga='LEGACY_PEOPLE_LIMPIEZA'` (recovery manual si fuera necesario).
//
// Uso:
//   # Pasar IDs por CLI (separados por coma):
//   node scripts/purge-legacy-test-people.js --ids prs_1,prs_2,prs_3
//
//   # Pasar IDs desde un archivo (uno por línea, comentarios con # permitidos):
//   node scripts/purge-legacy-test-people.js --file ids-a-purgar.txt
//
//   # Aplicar (sin esta flag = dry-run):
//   node scripts/purge-legacy-test-people.js --file ids.txt --apply \
//     --motivo "Razón del borrado (obligatorio en --apply)"
//
// Salida: tabla con el conteo por tabla afectada para cada contrato/PEOPLE.
// El dry-run muestra exactamente lo que se borraría sin tocar nada.
const fs = require('fs');
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const APPLY = process.argv.includes('--apply');
const motivoIdx = process.argv.indexOf('--motivo');
const MOTIVO = motivoIdx >= 0 ? process.argv[motivoIdx + 1] : 'Purga legacy de registros de PEOPLE';
const idsIdx = process.argv.indexOf('--ids');
const fileIdx = process.argv.indexOf('--file');
const ACTOR  = 'admin@lgs-plataforma.com';

function parseIdsArg() {
  if (idsIdx >= 0 && process.argv[idsIdx + 1]) {
    return process.argv[idsIdx + 1].split(',').map(s => s.trim()).filter(Boolean);
  }
  if (fileIdx >= 0 && process.argv[fileIdx + 1]) {
    const raw = fs.readFileSync(process.argv[fileIdx + 1], 'utf8');
    return raw.split(/\r?\n/)
      .map(l => l.replace(/#.*$/, '').trim())  // soporta comentarios con #
      .filter(Boolean);
  }
  return [];
}

const TARGET_PEOPLE_IDS = parseIdsArg();

if (!TARGET_PEOPLE_IDS.length) {
  console.error('\n❌ No se proporcionaron IDs.\n');
  console.error('Uso:');
  console.error('  node scripts/purge-legacy-test-people.js --ids id1,id2,id3');
  console.error('  node scripts/purge-legacy-test-people.js --file ids.txt');
  console.error('  Agregar --apply para ejecutar (sin la flag = dry-run).');
  console.error('  Agregar --motivo "Razón del borrado" (obligatorio con --apply).\n');
  process.exit(1);
}

if (APPLY && (!MOTIVO || MOTIVO === 'Purga legacy de registros de PEOPLE')) {
  console.error('\n❌ --apply requiere --motivo "Razón específica del borrado"\n');
  process.exit(1);
}

function uid(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    console.log(`\n${APPLY ? '🔴 APPLY MODE' : '🟡 DRY-RUN'} · motivo: "${MOTIVO}"\n`);

    // 1) Cargar las filas de PEOPLE target
    const peopleRes = await pool.query(
      `SELECT * FROM "PEOPLE" WHERE "_id" = ANY($1::text[]) ORDER BY "contrato" NULLS LAST, "_id"`,
      [TARGET_PEOPLE_IDS]
    );
    if (!peopleRes.rows.length) {
      console.log('No se encontraron filas con esos _id. Nada que hacer.');
      return;
    }
    const found = new Set(peopleRes.rows.map(r => r._id));
    const missing = TARGET_PEOPLE_IDS.filter(id => !found.has(id));
    if (missing.length) console.log('⚠️  IDs no encontrados:', missing.join(', '), '\n');

    // 2) Agrupar: contratos vs huérfanos sin contrato
    const byContrato = new Map();
    const sinContrato = [];
    for (const p of peopleRes.rows) {
      if (p.contrato && String(p.contrato).trim()) {
        const k = p.contrato.trim();
        if (!byContrato.has(k)) byContrato.set(k, []);
        byContrato.get(k).push(p);
      } else {
        sinContrato.push(p);
      }
    }
    console.log(`Resumen target:`);
    console.log(`  · contratos a purgar: ${byContrato.size}`);
    console.log(`  · PEOPLE sin contrato (huérfanos): ${sinContrato.length}\n`);

    const results = [];

    // 3) Purgar cada contrato completo (titular + beneficiarios + cascada)
    for (const [contrato, _peopleEnTarget] of byContrato) {
      try {
        const r = await purgarContrato(pool, contrato);
        results.push({ tipo: 'CONTRATO', contrato, status: 'ok', ...r });
      } catch (e) {
        results.push({ tipo: 'CONTRATO', contrato, status: 'error', error: e.message });
      }
    }

    // 4) Purgar PEOPLE sueltos sin contrato
    for (const p of sinContrato) {
      try {
        const r = await purgarPeopleSuelto(pool, p);
        results.push({ tipo: 'PEOPLE_SUELTO', peopleId: p._id, status: 'ok', ...r });
      } catch (e) {
        results.push({ tipo: 'PEOPLE_SUELTO', peopleId: p._id, status: 'error', error: e.message });
      }
    }

    console.log('\n─── RESULTADO ───');
    console.table(results.map(r => ({
      tipo: r.tipo,
      ref: r.contrato || r.peopleId,
      status: r.status,
      people: r.borrados?.people,
      academica: r.borrados?.academica,
      bookings: r.borrados?.bookings,
      financieros: r.borrados?.financieros,
      pagos: r.borrados?.pagos,
      stepOverrides: r.borrados?.stepOverrides,
      complementarias: r.borrados?.complementarias,
      usuariosRoles: r.borrados?.usuariosRoles,
      error: r.error || '',
    })));

    if (!APPLY) {
      console.log('\n🟡 DRY-RUN — ningún cambio aplicado. Re-ejecuta con --apply para borrar.\n');
    } else {
      console.log('\n🔴 Purga aplicada. Snapshots en PURGE_LOG (recuperación manual si fuera necesario).\n');
    }
  } catch (err) {
    console.error('❌ Error fatal:', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();

// Purga un CONTRATO completo (titular + beneficiarios + todas las dependencias).
// Replica exactamente el patrón del endpoint /api/admin/contratos-prueba/purge.
async function purgarContrato(pool, contrato) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Snapshot completo
    const peopleSnap = await client.query(`SELECT * FROM "PEOPLE" WHERE "contrato" = $1`, [contrato]);
    const numeroIds = Array.from(new Set(peopleSnap.rows.map(p => p.numeroId).filter(Boolean)));
    const peopleIds = peopleSnap.rows.map(p => p._id);
    const emails    = Array.from(new Set(peopleSnap.rows.map(p => (p.email || '').toLowerCase()).filter(Boolean)));

    const academicaSnap = numeroIds.length
      ? await client.query(`SELECT * FROM "ACADEMICA" WHERE "numeroId" = ANY($1::text[])`, [numeroIds])
      : { rows: [] };
    const academicaIds = academicaSnap.rows.map(a => a._id);

    const bookingsSnap = academicaIds.length
      ? await client.query(`SELECT * FROM "ACADEMICA_BOOKINGS" WHERE "studentId" = ANY($1::text[]) OR "idEstudiante" = ANY($1::text[])`, [academicaIds])
      : { rows: [] };
    const finSnap = await client.query(`SELECT * FROM "FINANCIEROS" WHERE "contrato" = $1`, [contrato]);
    const pagosSnap = (peopleIds.length || numeroIds.length)
      ? await client.query(
          `SELECT * FROM "PAGOS_TITULARES" WHERE ("idPeople" = ANY($1::text[]) OR "numeroId" = ANY($2::text[]))`,
          [peopleIds.length ? peopleIds : ['__none__'], numeroIds.length ? numeroIds : ['__none__']]
        )
      : { rows: [] };
    const overridesSnap = academicaIds.length
      ? await client.query(`SELECT * FROM "STEP_OVERRIDES" WHERE "studentId" = ANY($1::text[])`, [academicaIds])
      : { rows: [] };
    const complemSnap = academicaIds.length
      ? await client.query(`SELECT * FROM "COMPLEMENTARIA_ATTEMPTS" WHERE "studentId" = ANY($1::text[])`, [academicaIds]).catch(() => ({ rows: [] }))
      : { rows: [] };
    const usuariosSnap = emails.length
      ? await client.query(`SELECT * FROM "USUARIOS_ROLES" WHERE LOWER("email") = ANY($1::text[])`, [emails])
      : { rows: [] };

    const titular = peopleSnap.rows.find(p => p.tipoUsuario === 'TITULAR') || peopleSnap.rows[0];
    const titularNombre = titular ? `${titular.primerNombre || ''} ${titular.primerApellido || ''}`.trim() : null;

    const filasBorradas = {
      people: peopleSnap.rows.length,
      academica: academicaSnap.rows.length,
      bookings: bookingsSnap.rows.length,
      financieros: finSnap.rows.length,
      pagos: pagosSnap.rows.length,
      stepOverrides: overridesSnap.rows.length,
      complementarias: complemSnap.rows.length,
      usuariosRoles: usuariosSnap.rows.length,
    };

    console.log(`\n📋 CONTRATO ${contrato}  (titular: ${titularNombre || '—'})`);
    console.log(`   ${JSON.stringify(filasBorradas)}`);

    if (!APPLY) {
      await client.query('ROLLBACK');
      return { borrados: filasBorradas };
    }

    // Auditoría
    const snapshot = {
      people: peopleSnap.rows, academica: academicaSnap.rows, bookings: bookingsSnap.rows,
      financieros: finSnap.rows, pagos: pagosSnap.rows, stepOverrides: overridesSnap.rows,
      complementarias: complemSnap.rows, usuariosRoles: usuariosSnap.rows,
    };
    await client.query(
      `INSERT INTO "PURGE_LOG" ("_id","tipoPurga","contrato","titularId","titularNombre","snapshot","motivo","realizadoPor","realizadoPorNombre","ip","userAgent","filasBorradas")
       VALUES ($1,'LEGACY_PEOPLE_LIMPIEZA',$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11::jsonb)`,
      [uid('aud'), contrato, titular?._id ?? null, titularNombre, JSON.stringify(snapshot), MOTIVO, ACTOR, 'Script: purge-legacy-test-people.js', '', 'node-script', JSON.stringify(filasBorradas)]
    );

    // DELETE en orden seguro
    if (academicaIds.length) {
      await client.query(`DELETE FROM "STEP_OVERRIDES" WHERE "studentId" = ANY($1::text[])`, [academicaIds]);
      await client.query(`DELETE FROM "COMPLEMENTARIA_ATTEMPTS" WHERE "studentId" = ANY($1::text[])`, [academicaIds]).catch(() => null);
      await client.query(`DELETE FROM "ACADEMICA_BOOKINGS" WHERE "studentId" = ANY($1::text[]) OR "idEstudiante" = ANY($1::text[])`, [academicaIds]);
    }
    if (peopleIds.length || numeroIds.length) {
      await client.query(
        `DELETE FROM "PAGOS_TITULARES" WHERE ("idPeople" = ANY($1::text[]) OR "numeroId" = ANY($2::text[]))`,
        [peopleIds.length ? peopleIds : ['__none__'], numeroIds.length ? numeroIds : ['__none__']]
      );
    }
    if (numeroIds.length) {
      await client.query(`DELETE FROM "ACADEMICA" WHERE "numeroId" = ANY($1::text[])`, [numeroIds]);
    }
    await client.query(`DELETE FROM "FINANCIEROS" WHERE "contrato" = $1`, [contrato]);
    if (emails.length) {
      await client.query(`DELETE FROM "USUARIOS_ROLES" WHERE LOWER("email") = ANY($1::text[])`, [emails]);
    }
    await client.query(`DELETE FROM "PEOPLE" WHERE "contrato" = $1`, [contrato]);

    await client.query('COMMIT');
    return { borrados: filasBorradas };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// Purga un PEOPLE suelto (sin `contrato`) y sus dependencias por numeroId/email.
async function purgarPeopleSuelto(pool, p) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const peopleId  = p._id;
    const numeroId  = p.numeroId || null;
    const email     = (p.email || '').toLowerCase() || null;

    const academicaSnap = numeroId
      ? await client.query(`SELECT * FROM "ACADEMICA" WHERE "numeroId" = $1`, [numeroId])
      : { rows: [] };
    const academicaIds = academicaSnap.rows.map(a => a._id);

    const bookingsSnap = academicaIds.length
      ? await client.query(`SELECT * FROM "ACADEMICA_BOOKINGS" WHERE "studentId" = ANY($1::text[]) OR "idEstudiante" = ANY($1::text[])`, [academicaIds])
      : { rows: [] };
    const pagosSnap = (peopleId || numeroId)
      ? await client.query(
          `SELECT * FROM "PAGOS_TITULARES" WHERE ("idPeople" = $1 OR "numeroId" = $2)`,
          [peopleId, numeroId || '__none__']
        )
      : { rows: [] };
    const overridesSnap = academicaIds.length
      ? await client.query(`SELECT * FROM "STEP_OVERRIDES" WHERE "studentId" = ANY($1::text[])`, [academicaIds])
      : { rows: [] };
    const complemSnap = academicaIds.length
      ? await client.query(`SELECT * FROM "COMPLEMENTARIA_ATTEMPTS" WHERE "studentId" = ANY($1::text[])`, [academicaIds]).catch(() => ({ rows: [] }))
      : { rows: [] };
    const usuariosSnap = email
      ? await client.query(`SELECT * FROM "USUARIOS_ROLES" WHERE LOWER("email") = $1`, [email])
      : { rows: [] };

    const filasBorradas = {
      people: 1,
      academica: academicaSnap.rows.length,
      bookings: bookingsSnap.rows.length,
      financieros: 0,
      pagos: pagosSnap.rows.length,
      stepOverrides: overridesSnap.rows.length,
      complementarias: complemSnap.rows.length,
      usuariosRoles: usuariosSnap.rows.length,
    };

    const nombre = `${p.primerNombre || ''} ${p.primerApellido || ''}`.trim();
    console.log(`\n👤 PEOPLE SUELTO ${peopleId}  (${nombre || '—'}, ${email || 'sin email'})`);
    console.log(`   ${JSON.stringify(filasBorradas)}`);

    if (!APPLY) {
      await client.query('ROLLBACK');
      return { borrados: filasBorradas };
    }

    const snapshot = {
      people: [p], academica: academicaSnap.rows, bookings: bookingsSnap.rows,
      financieros: [], pagos: pagosSnap.rows, stepOverrides: overridesSnap.rows,
      complementarias: complemSnap.rows, usuariosRoles: usuariosSnap.rows,
    };
    await client.query(
      `INSERT INTO "PURGE_LOG" ("_id","tipoPurga","contrato","titularId","titularNombre","snapshot","motivo","realizadoPor","realizadoPorNombre","ip","userAgent","filasBorradas")
       VALUES ($1,'LEGACY_PEOPLE_LIMPIEZA',$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11::jsonb)`,
      [uid('aud'), null, peopleId, nombre || null, JSON.stringify(snapshot), MOTIVO, ACTOR, 'Script: purge-legacy-test-people.js', '', 'node-script', JSON.stringify(filasBorradas)]
    );

    if (academicaIds.length) {
      await client.query(`DELETE FROM "STEP_OVERRIDES" WHERE "studentId" = ANY($1::text[])`, [academicaIds]);
      await client.query(`DELETE FROM "COMPLEMENTARIA_ATTEMPTS" WHERE "studentId" = ANY($1::text[])`, [academicaIds]).catch(() => null);
      await client.query(`DELETE FROM "ACADEMICA_BOOKINGS" WHERE "studentId" = ANY($1::text[]) OR "idEstudiante" = ANY($1::text[])`, [academicaIds]);
    }
    if (peopleId || numeroId) {
      await client.query(`DELETE FROM "PAGOS_TITULARES" WHERE ("idPeople" = $1 OR "numeroId" = $2)`, [peopleId, numeroId || '__none__']);
    }
    if (numeroId) {
      await client.query(`DELETE FROM "ACADEMICA" WHERE "numeroId" = $1`, [numeroId]);
    }
    if (email) {
      await client.query(`DELETE FROM "USUARIOS_ROLES" WHERE LOWER("email") = $1`, [email]);
    }
    await client.query(`DELETE FROM "PEOPLE" WHERE "_id" = $1`, [peopleId]);

    await client.query('COMMIT');
    return { borrados: filasBorradas };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
