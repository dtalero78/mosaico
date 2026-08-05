/**
 * Borra en CASCADA una lista fija de contratos (titular + beneficiarios + todos sus
 * registros), con respaldo previo en PURGE_LOG. Réplica del endpoint
 * /api/admin/contratos-prueba/purge pero para contratos SIN prefijo PRB- (uso manual
 * puntual, lista hardcodeada). Transaccional por contrato; aborta un contrato si algún
 * numeroId suyo pertenece también a OTRO contrato fuera de la lista (evita colateral).
 *
 * Uso: node scripts/purge-contratos-manual.js [--apply]   (dry-run por defecto)
 */
const { Pool } = require('pg');
const crypto = require('crypto');
require('dotenv').config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');
const MOTIVO = 'Borrado de contratos de prueba (solicitado por admin)';
const CONTRATOS = [
  '02-M5-09000-26',
  '01-M5-09003-26',
  '01-M5-09005-26',
  '01-M5-09006-26',
  '01-M5-09007-26',
  '01-M5-09009-26',
];

const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

(async () => {
  console.log(APPLY ? '== APPLY (borrado real) ==' : '== DRY-RUN (usa --apply para borrar) ==');
  const resumen = [];

  for (const contrato of CONTRATOS) {
    const cli = await pool.connect();
    try {
      await cli.query('BEGIN');

      const people = (await cli.query(`SELECT * FROM "PEOPLE" WHERE "contrato"=$1`, [contrato])).rows;
      if (!people.length) { console.log(`\n### ${contrato} → NO EXISTE (omitido)`); await cli.query('ROLLBACK'); continue; }

      const numeroIds = Array.from(new Set(people.map(p => p.numeroId).filter(Boolean)));
      const peopleIds = people.map(p => p._id);
      const emails = Array.from(new Set(people.map(p => (p.email || '').toLowerCase()).filter(Boolean)));

      // Chequeo de colisión: ¿algún numeroId de este contrato aparece en OTRO contrato NO listado?
      const col = numeroIds.length ? (await cli.query(
        `SELECT DISTINCT "numeroId","contrato" FROM "PEOPLE"
          WHERE "numeroId"=ANY($1::text[]) AND "contrato" IS NOT NULL AND NOT ("contrato"=ANY($2::text[]))`,
        [numeroIds, CONTRATOS])).rows : [];
      if (col.length) {
        console.log(`\n### ${contrato} → ⚠ COLISIÓN, ABORTADO. numeroId compartido con otro contrato:`, JSON.stringify(col));
        await cli.query('ROLLBACK');
        resumen.push({ contrato, status: 'ABORTADO_COLISION' });
        continue;
      }

      const academica = numeroIds.length ? (await cli.query(`SELECT * FROM "ACADEMICA" WHERE "numeroId"=ANY($1::text[])`, [numeroIds])).rows : [];
      const acIds = academica.map(a => a._id);
      const bookings = acIds.length ? (await cli.query(`SELECT * FROM "ACADEMICA_BOOKINGS" WHERE "studentId"=ANY($1::text[]) OR "idEstudiante"=ANY($1::text[])`, [acIds])).rows : [];
      const financieros = (await cli.query(`SELECT * FROM "FINANCIEROS" WHERE "contrato"=$1`, [contrato])).rows;
      const pagos = (peopleIds.length || numeroIds.length) ? (await cli.query(
        `SELECT * FROM "PAGOS_TITULARES" WHERE "idPeople"=ANY($1::text[]) OR "numeroId"=ANY($2::text[])`,
        [peopleIds.length ? peopleIds : ['__none__'], numeroIds.length ? numeroIds : ['__none__']])).rows : [];
      const overrides = acIds.length ? (await cli.query(`SELECT * FROM "STEP_OVERRIDES" WHERE "studentId"=ANY($1::text[])`, [acIds])).rows : [];
      const complem = acIds.length ? await cli.query(`SELECT * FROM "COMPLEMENTARIA_ATTEMPTS" WHERE "studentId"=ANY($1::text[])`, [acIds]).then(r => r.rows).catch(() => []) : [];
      const usuarios = numeroIds.length ? (await cli.query(`SELECT * FROM "USUARIOS_ROLES" WHERE "numberid"=ANY($1::text[])`, [numeroIds])).rows : [];
      const activeStu = (await cli.query(`SELECT * FROM "ACTIVE_STUDENTS" WHERE "contrato"=$1`, [contrato]).then(r => r.rows).catch(() => []));
      const auditAuto = (await cli.query(`SELECT * FROM "auditautoaprov" WHERE "contrato"=$1`, [contrato]).then(r => r.rows).catch(() => []));

      const titular = people.find(p => p.tipoUsuario === 'TITULAR');
      const titularNombre = titular ? `${titular.primerNombre || ''} ${titular.primerApellido || ''}`.trim() : null;
      const filas = {
        people: people.length, academica: academica.length, bookings: bookings.length,
        financieros: financieros.length, pagos: pagos.length, stepOverrides: overrides.length,
        complementarias: complem.length, usuariosRoles: usuarios.length,
        activeStudents: activeStu.length, auditautoaprov: auditAuto.length,
      };
      console.log(`\n### ${contrato}  (${titularNombre})  →`, JSON.stringify(filas));
      console.log('   ' + people.map(p => `${p.tipoUsuario}:${p.primerNombre} ${p.primerApellido}`).join(' | '));

      if (!APPLY) { await cli.query('ROLLBACK'); resumen.push({ contrato, status: 'DRY', filas }); continue; }

      // Respaldo en PURGE_LOG
      const snapshot = { people, academica, bookings, financieros, pagos, stepOverrides: overrides, complementarias: complem, usuariosRoles: usuarios, activeStudents: activeStu, auditautoaprov: auditAuto };
      await cli.query(
        `INSERT INTO "PURGE_LOG" ("_id","tipoPurga","contrato","titularId","titularNombre","snapshot","motivo","realizadoPor","realizadoPorNombre","ip","userAgent","filasBorradas","_createdDate")
         VALUES ($1,'BORRADO_CONTRATO_MANUAL',$2,$3,$4,$5::jsonb,$6,$7,$8,NULL,'purge-script',$9::jsonb,NOW())`,
        ['aud_' + crypto.randomUUID(), contrato, titular?._id ?? null, titularNombre, JSON.stringify(snapshot), MOTIVO, 'script@admin', 'Admin (script)', JSON.stringify(filas)]
      );

      // DELETE en orden seguro
      if (acIds.length) {
        await cli.query(`DELETE FROM "STEP_OVERRIDES" WHERE "studentId"=ANY($1::text[])`, [acIds]);
        await cli.query(`DELETE FROM "COMPLEMENTARIA_ATTEMPTS" WHERE "studentId"=ANY($1::text[])`, [acIds]).catch(() => null);
        await cli.query(`DELETE FROM "ACADEMICA_BOOKINGS" WHERE "studentId"=ANY($1::text[]) OR "idEstudiante"=ANY($1::text[])`, [acIds]);
      }
      if (peopleIds.length || numeroIds.length) {
        await cli.query(`DELETE FROM "PAGOS_TITULARES" WHERE "idPeople"=ANY($1::text[]) OR "numeroId"=ANY($2::text[])`,
          [peopleIds.length ? peopleIds : ['__none__'], numeroIds.length ? numeroIds : ['__none__']]);
      }
      if (numeroIds.length) await cli.query(`DELETE FROM "ACADEMICA" WHERE "numeroId"=ANY($1::text[])`, [numeroIds]);
      await cli.query(`DELETE FROM "FINANCIEROS" WHERE "contrato"=$1`, [contrato]);
      if (numeroIds.length) await cli.query(`DELETE FROM "USUARIOS_ROLES" WHERE "numberid"=ANY($1::text[])`, [numeroIds]);
      await cli.query(`DELETE FROM "ACTIVE_STUDENTS" WHERE "contrato"=$1`, [contrato]).catch(() => null);
      await cli.query(`DELETE FROM "auditautoaprov" WHERE "contrato"=$1`, [contrato]).catch(() => null);
      await cli.query(`DELETE FROM "PEOPLE" WHERE "contrato"=$1`, [contrato]);

      await cli.query('COMMIT');
      console.log('   ✓ BORRADO + respaldo en PURGE_LOG');
      resumen.push({ contrato, status: 'BORRADO', filas });
    } catch (e) {
      await cli.query('ROLLBACK').catch(() => {});
      console.error(`   ✗ ERROR ${contrato}:`, e.message);
      resumen.push({ contrato, status: 'ERROR', error: e.message });
    } finally { cli.release(); }
  }

  console.log('\n== RESUMEN =='); console.table(resumen.map(r => ({ contrato: r.contrato, status: r.status })));
  await pool.end();
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
