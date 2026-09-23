/**
 * Fusiona un contrato que quedó cargado DOS veces: el alta vieja (sólo el
 * titular) y la nueva (titular + beneficiarios, con el número mal escrito).
 *
 * Qué hace por cada caso:
 *   1. Borra la fila VIEJA de PEOPLE (la que no tiene beneficiarios) con su
 *      FINANCIEROS y sus PAGOS_TITULARES — si se dejaran, quedarían apuntando a
 *      un contrato que ya no existe.
 *   2. Renombra al número canónico el alta que SÍ tiene beneficiarios, en TODAS
 *      las tablas que guardan el número. Hoy están partidas: el renombre a mano
 *      tocó sólo PEOPLE y el resto se quedó con el texto sucio.
 *
 * ⚠ Lo que se pierde al borrar el alta vieja (decisión del usuario, 23-sep-2026):
 *   · su pago de inscripción VALIDADO — el que queda está sin validar y hay que
 *     validarlo de nuevo en Recaudos (mismo monto);
 *   · y, si la vieja era la aprobada, la APROBACIÓN: el contrato queda sin
 *     aprobar y hay que aprobarlo otra vez, que es lo que genera las clases del
 *     beneficiario.
 *
 * Antes de borrar se guarda un snapshot completo en PURGE_LOG (tipoPurga
 * FUSION_TITULAR_DUPLICADO), así que lo borrado se puede reconstruir a mano.
 *
 * Los pares van escritos aquí y no se deducen: cuál alta se conserva depende de
 * cuál tiene los beneficiarios y del número al que debe quedar, y eso lo decide
 * quien mira los datos, no una regla.
 *
 * Uso:
 *   node scripts/fusionar-titular-duplicado.js            (ensayo)
 *   node scripts/fusionar-titular-duplicado.js --apply
 */
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const APPLY = process.argv.includes('--apply');

/** Tablas con columna `contrato` (ACTIVE_STUDENTS es VISTA: refleja las base). */
const TABLAS = ['PEOPLE', 'ACADEMICA', 'USUARIOS_ROLES', 'FINANCIEROS', 'auditautoaprov', 'CASOS_ATENCION'];

const CASOS = [
  {
    nombre: 'MYRIAM BELTRAMI',
    /** Alta vieja, sólo titular: se borra. */
    viejo: '01-M5-2234-26',
    /** Valores con los que quedó el alta buena (PEOPLE por un lado, el resto por otro). */
    nuevos: ['01-M5-2234A-26', 'Contrato N.º 5 - 2234 - 26'],
    canonico: '01-M5-2234-26',
  },
  {
    nombre: 'CAROLINA DUARTE',
    viejo: '01-M5-2447-26',
    nuevos: ['Contrato N.º 5-2447-26'],
    canonico: '01-M5-2447-26',
  },
];

const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

const q = (client, sql, params) => client.query(sql, params).then((r) => r.rows);

(async () => {
  const client = await pool.connect();
  try {
    for (const caso of CASOS) {
      console.log('\n=== ' + caso.nombre + ' ===');

      const viejos = await q(client,
        'SELECT * FROM "PEOPLE" WHERE "contrato"=$1', [caso.viejo]);
      const titularViejo = viejos.find((p) => p.tipoUsuario === 'TITULAR');
      const benefViejos = viejos.filter((p) => p.tipoUsuario !== 'TITULAR');

      if (!titularViejo) { console.log('  · ya no existe el alta vieja — nada que hacer'); continue; }
      if (benefViejos.length) {
        console.log('  ⚠ SE SALTA: el alta vieja TIENE ' + benefViejos.length + ' beneficiario(s). No es la que se quería borrar.');
        continue;
      }

      // El alta que se conserva: la que tiene beneficiarios.
      const nuevos = await q(client,
        'SELECT "contrato","tipoUsuario","numeroId","primerNombre","primerApellido" FROM "PEOPLE" WHERE "contrato" = ANY($1)', [caso.nuevos]);
      const titularNuevo = nuevos.filter((p) => p.tipoUsuario === 'TITULAR');
      const benefNuevos = nuevos.filter((p) => p.tipoUsuario !== 'TITULAR');
      if (titularNuevo.length !== 1 || !benefNuevos.length) {
        console.log('  ⚠ SE SALTA: el alta que se conserva debe tener 1 titular y al menos 1 beneficiario; hay '
          + titularNuevo.length + ' titular(es) y ' + benefNuevos.length + ' beneficiario(s).');
        continue;
      }
      // El titular tiene que ser la MISMA persona: si no, no es un duplicado.
      if (String(titularNuevo[0].numeroId).replace(/[.\s-]/g, '').toUpperCase()
        !== String(titularViejo.numeroId).replace(/[.\s-]/g, '').toUpperCase()) {
        console.log('  ⚠ SE SALTA: los titulares son personas distintas ('
          + titularViejo.numeroId + ' vs ' + titularNuevo[0].numeroId + ').');
        continue;
      }

      const financierosViejos = await q(client, 'SELECT * FROM "FINANCIEROS" WHERE "contrato"=$1', [caso.viejo]);
      const pagosViejos = await q(client, 'SELECT * FROM "PAGOS_TITULARES" WHERE "idPeople"=$1', [titularViejo._id]);

      console.log('  Se BORRA: titular ' + titularViejo.numeroId + ' (' + caso.viejo + ')'
        + ' · ' + financierosViejos.length + ' fila(s) financieras · ' + pagosViejos.length + ' pago(s)'
        + (pagosViejos.some((p) => p.validado) ? '  ⚠ incluye pago VALIDADO' : '')
        + (titularViejo.aprobacion ? '  ⚠ estaba ' + titularViejo.aprobacion : ''));
      console.log('  Se CONSERVA y pasa a «' + caso.canonico + '»: titular + '
        + benefNuevos.length + ' beneficiario(s) — ' + benefNuevos.map((b) => b.primerNombre + ' ' + b.primerApellido).join(', '));

      // Cuántas filas se renombran en cada tabla.
      for (const t of TABLAS) {
        try {
          const r = await q(client, 'SELECT "contrato" v, COUNT(*)::int n FROM "' + t + '" WHERE "contrato" = ANY($1) GROUP BY 1', [caso.nuevos]);
          if (r.length) console.log('    ' + t + ': ' + r.map((x) => '«' + x.v + '»=' + x.n).join(' · '));
        } catch (e) { if (!/does not exist/i.test(e.message)) throw e; }
      }

      if (!APPLY) continue;

      await client.query('BEGIN');
      try {
        await client.query(
          'INSERT INTO "PURGE_LOG" ("_id","tipoPurga","contrato","titularId","titularNombre","snapshot","motivo","realizadoPor","realizadoPorNombre","filasBorradas","_createdDate")'
          + ' VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())',
          [
            'plg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 11),
            'FUSION_TITULAR_DUPLICADO',
            caso.viejo,
            titularViejo._id,
            (titularViejo.primerNombre || '') + ' ' + (titularViejo.primerApellido || ''),
            JSON.stringify({ people: [titularViejo], financieros: financierosViejos, pagos: pagosViejos }),
            'Contrato cargado dos veces: se conserva el alta con beneficiarios y se renombra a ' + caso.canonico,
            'script',
            'fusionar-titular-duplicado.js',
            JSON.stringify({ PEOPLE: 1, FINANCIEROS: financierosViejos.length, PAGOS_TITULARES: pagosViejos.length }),
          ]
        );

        await client.query('DELETE FROM "PAGOS_TITULARES" WHERE "idPeople"=$1', [titularViejo._id]);
        await client.query('DELETE FROM "FINANCIEROS" WHERE "contrato"=$1', [caso.viejo]);
        await client.query('DELETE FROM "PEOPLE" WHERE "_id"=$1', [titularViejo._id]);

        let renombradas = 0;
        for (const t of TABLAS) {
          try {
            const r = await client.query('UPDATE "' + t + '" SET "contrato"=$1 WHERE "contrato" = ANY($2)', [caso.canonico, caso.nuevos]);
            renombradas += r.rowCount || 0;
          } catch (e) { if (!/does not exist/i.test(e.message)) throw e; }
        }
        await client.query('COMMIT');
        console.log('  ✓ borrado el alta vieja y renombradas ' + renombradas + ' fila(s) a «' + caso.canonico + '»');
      } catch (e) {
        await client.query('ROLLBACK');
        console.log('  ✗ ' + e.message + ' — no se tocó nada de este contrato');
      }
    }

    if (!APPLY) console.log('\nEnsayo. Correr con --apply para guardarlo.');
    else {
      console.log('\n--- Verificación ---');
      for (const caso of CASOS) {
        const r = await q(client,
          'SELECT "tipoUsuario", COUNT(*)::int n FROM "PEOPLE" WHERE "contrato"=$1 GROUP BY 1 ORDER BY 1', [caso.canonico]);
        const otros = [];
        for (const t of TABLAS.filter((x) => x !== 'PEOPLE')) {
          try {
            const c = await q(client, 'SELECT COUNT(*)::int n FROM "' + t + '" WHERE "contrato"=$1', [caso.canonico]);
            if (c[0].n) otros.push(t + '=' + c[0].n);
          } catch (e) { if (!/does not exist/i.test(e.message)) throw e; }
        }
        console.log('  ' + caso.canonico + ' → PEOPLE ' + r.map((x) => x.tipoUsuario + ':' + x.n).join(' ') + ' · ' + otros.join(' · '));
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
})().catch((e) => { console.error('✗', e.message); process.exit(1); });
