/**
 * Lleva al formato canónico `01-M5-NNNN-YY` los números de contrato que
 * quedaron guardados de otra forma.
 *
 * Cubre las DOS formas sucias que hay hoy en la base:
 *   a) con el texto del documento delante — "Contrato Online N.º 5-2558-26".
 *      El prefijo aparece con varias grafías (N.º · N. º · N° · Nº) y todas
 *      significan lo mismo, así que se toleran juntas.
 *   b) el número corto suelto — "5-2709-26", que es como quedaron los migrados
 *      antes de adoptar el canónico.
 *
 * Lo ya canónico (`01-M5-…`, `01-I6-…`) NO matchea y se deja intacto, así que
 * re-correrlo es inofensivo.
 *
 * Complementa a `normalizar-contratos-online.js` (que cubría sólo la forma (a)
 * con la grafía "N.º"): éste suma las otras grafías y los números cortos, y
 * ante un choque SALTA ese contrato en vez de abortarlo todo — un solo caso
 * conflictivo no debe dejar sin normalizar a las decenas que sí están bien.
 *
 * ⚠ El número se cambia en TODAS las tablas que lo guardan: cambiarlo a medias
 * dejaría el login, lo financiero y la auditoría apuntando a un contrato que ya
 * no existe.
 *
 * ⚠ Si el destino ya existe y pertenece a OTRAS personas, no se toca: renombrar
 * mezclaría dos contratos distintos. Si el destino existe con las MISMAS
 * personas, el renombre repara una desincronización y sí se aplica.
 *
 * `--solo` acota la corrida a los contratos DESTINO que se le indiquen. Sirve
 * para reparar una desincronización concreta sin arrastrar de paso a los demás
 * contratos sucios: renombrar uno cambia el nombre de su PDF en Drive, así que
 * conviene poder decidir cuáles se mueven y cuándo. Sin el flag, se normaliza
 * todo lo que se pueda deducir, como siempre.
 *
 * Uso:
 *   node scripts/normalizar-contratos-a-canonico.js           (ensayo)
 *   node scripts/normalizar-contratos-a-canonico.js --apply
 *   node scripts/normalizar-contratos-a-canonico.js --solo=01-M5-2444-26,01-M5-2461-26
 */
require('dotenv').config({ path: '.env.local' });
const fs = require('fs');
const { Pool } = require('pg');

const APPLY = process.argv.includes('--apply');

/** Contratos destino a los que se acota la corrida (vacío = todos). */
const SOLO = new Set(
  (process.argv.find((a) => a.startsWith('--solo=')) || '')
    .replace('--solo=', '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
);

/** Tablas que guardan el número de contrato. */
const TABLAS = ['PEOPLE', 'ACADEMICA', 'USUARIOS_ROLES', 'FINANCIEROS', 'ACTIVE_STUDENTS', 'auditautoaprov', 'CASOS_ATENCION'];

// El rótulo aparece con y sin "Online" ("Contrato N.º 5-2545-26") y a veces
// pegado al número ("Contrato Online N.º01-M5-2345-26").
const RE_PREFIJO = new RegExp('^Contrato\\s*(Online\\s*)?N[.\\s]*[º°o]?\\s*', 'i');
// Tolera el cero delante del país ("05-2373-26"), espacios alrededor de los
// guiones ("5 - 2234 - 26") y el sufijo de desdoble en el año ("5-2477-26A").
const RE_NUMERO = new RegExp('^0?(\\d)\\s*-\\s*(\\d+)\\s*-\\s*(\\d{2}[A-Za-z]?)$');
/** La forma final a la que se quiere llegar: `01-M5-2444-26`. */
const RE_CANONICO = new RegExp('^[0-9]{2}-(M[0-9]|I[0-9])-[0-9]+[A-Z]?-[0-9]{2}$');

/** Número canónico, o null si el texto no se puede interpretar sin adivinar. */
function canonico(valor) {
  // Los espacios internos se colapsan: el MISMO contrato aparece con uno y con
  // dos espacios tras el rótulo, y son la misma suciedad escrita dos veces.
  const sinPrefijo = String(valor || '')
    .trim()
    .replace(RE_PREFIJO, '')
    .replace(/\s+/g, ' ')
    .trim();
  // El rótulo puede venir delante de un número que YA es canónico
  // ("Contrato Online N.º 01-M5-2175-26"): entonces basta con quitarlo. Sin
  // esta rama el valor caía en "no se puede deducir" y quedaba sin normalizar,
  // aunque el número correcto estuviera ahí escrito.
  if (RE_CANONICO.test(sinPrefijo)) return sinPrefijo;
  const n = sinPrefijo.match(RE_NUMERO);
  if (!n) return null;
  const seg = n[1] === '6' ? 'I6' : 'M' + n[1];
  return '01-' + seg + '-' + n[2] + '-' + n[3].toUpperCase();
}

const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

/**
 * numeroId asociados a un contrato, para comprobar que no se mezclan personas.
 *
 * Se miran las TRES tablas que identifican a una persona. Con sólo PEOPLE y
 * ACADEMICA, un contrato que quedó sucio únicamente en `USUARIOS_ROLES` no
 * devuelve a nadie, la comparación no encuentra coincidencia y el renombre se
 * salta como si fuera un choque entre familias distintas — cuando en realidad
 * son las mismas personas y lo que falta es justamente alinearles el login.
 */
async function idsDe(client, contrato) {
  const r = await client.query(
    'SELECT DISTINCT "numeroId" AS id FROM "PEOPLE" WHERE "contrato"=$1 AND "numeroId" IS NOT NULL' +
    ' UNION SELECT DISTINCT "numeroId" FROM "ACADEMICA" WHERE "contrato"=$1 AND "numeroId" IS NOT NULL' +
    ' UNION SELECT DISTINCT "numberid" FROM "USUARIOS_ROLES" WHERE "contrato"=$1 AND "numberid" IS NOT NULL',
    [contrato]
  );
  return new Set(r.rows.map((x) => String(x.id).toUpperCase().replace(/[.\s-]/g, '')));
}

(async () => {
  const client = await pool.connect();
  try {
    // Candidatos: los valores sin canónico de TODAS las tablas, no sólo de
    // PEOPLE. Hay contratos que quedaron en formato viejo únicamente en
    // ACADEMICA o USUARIOS_ROLES —el alumno apuntando a un número y su titular
    // a otro—, y mirando sólo PEOPLE esos no se ven y quedan desincronizados.
    const SUCIO = "\"contrato\" IS NOT NULL AND \"contrato\" NOT LIKE 'PRB-%'" +
      " AND (\"contrato\" ILIKE 'Contrato%' OR \"contrato\" ~ '^0?[0-9] *- *[0-9]+ *- *[0-9][0-9][A-Za-z]?$')";
    const fuentes = [];
    for (const t of TABLAS) {
      try {
        const r = await client.query('SELECT "contrato", COUNT(*)::int n FROM "' + t + '" WHERE ' + SUCIO + ' GROUP BY 1');
        r.rows.forEach((x) => fuentes.push(x));
      } catch (e) {
        if (!/does not exist|column .* does not exist/i.test(e.message)) throw e;
      }
    }
    const acum = new Map();
    for (const x of fuentes) acum.set(x.contrato, (acum.get(x.contrato) || 0) + x.n);
    const cand = [...acum.entries()].map(([contrato, n]) => ({ contrato, n })).sort((a, b) => a.contrato.localeCompare(b.contrato));

    const plan = [], sinTocar = [], conflictos = [];
    for (const c of cand) {
      const nuevo = canonico(c.contrato);
      if (!nuevo) { sinTocar.push({ valor: c.contrato, filas: c.n }); continue; }
      if (nuevo === c.contrato) continue;

      const yaExiste = (await client.query(
        'SELECT 1 FROM "PEOPLE" WHERE "contrato"=$1 LIMIT 1', [nuevo]
      )).rowCount > 0;

      let nota = 'destino libre';
      if (yaExiste) {
        const [a, b] = [await idsDe(client, c.contrato), await idsDe(client, nuevo)];
        const mismos = [...a].some((x) => b.has(x));
        if (!mismos) { conflictos.push({ viejo: c.contrato, nuevo, origen: [...a].join(','), destino: [...b].join(',') }); continue; }
        // Las mismas personas, pero si AMBOS lados tienen fila de TITULAR en
        // PEOPLE el renombre dejaría dos titulares con el mismo contrato y lo
        // rechaza el índice único `idx_people_contrato_titular` — la corrida
        // entera se cae por uno. Es una fila de titular DUPLICADA (la misma
        // persona dada de alta dos veces): fusionarlas es decisión de negocio
        // (a cuál se le cuelgan los beneficiarios y lo financiero), no algo que
        // se pueda deducir aquí.
        const dosTitulares = (await client.query(
          'SELECT COUNT(*) FILTER (WHERE "contrato"=$1)::int a, COUNT(*) FILTER (WHERE "contrato"=$2)::int b' +
          ' FROM "PEOPLE" WHERE "tipoUsuario"=\'TITULAR\' AND "contrato" IN ($1,$2)', [c.contrato, nuevo]
        )).rows[0];
        if (dosTitulares.a > 0 && dosTitulares.b > 0) {
          conflictos.push({ viejo: c.contrato, nuevo, origen: [...a].join(','), destino: 'el titular está DUPLICADO en las dos formas — fusionar a mano' });
          continue;
        }
        nota = 'mismo contrato — el renombre repara la desincronización';
      } else {
        // Destino libre NO basta: si las personas de este contrato ya figuran en
        // PEOPLE con OTRO número, renombrar al canónico teórico las dejaría
        // apuntando a un contrato sin titular — peor que como estaban. Pasa con
        // los IMPULSA guardados como `01-M6-115-26`: el alumno tiene `6-115-26`
        // en ACADEMICA y su titular `01-M6-…`, así que lo que corresponde es
        // alinearlos a mano, no inventarles un tercer número.
        const ids = [...await idsDe(client, c.contrato)];
        if (ids.length) {
          const otro = (await client.query(
            'SELECT DISTINCT "contrato" FROM "PEOPLE"' +
            ' WHERE UPPER(REGEXP_REPLACE("numeroId", \'[.[:space:]-]\', \'\', \'g\')) = ANY($1::text[])' +
            '   AND "contrato" IS NOT NULL AND "contrato" <> $2 LIMIT 3', [ids, c.contrato]
          )).rows.map((z) => z.contrato);
          if (otro.length) {
            conflictos.push({ viejo: c.contrato, nuevo, origen: ids.join(','), destino: 'esas personas ya tienen: ' + otro.join(' / ') });
            continue;
          }
        }
      }
      plan.push({ viejo: c.contrato, nuevo, filas: c.n, nota });
    }

    // ⚠ DOS valores sucios distintos pueden deducir el MISMO destino — pasa
    // cuando el mismo número se escribió con dos rótulos y pertenece a familias
    // distintas ("Contrato N.º 5-2451-26" y "Contrato Online N.º 5-2451-26").
    // El plan se calcula entero ANTES de escribir, así que la guarda de destino
    // ocupado no los ve: los dos encuentran el destino libre y el renombre los
    // fusionaría en un solo contrato. Se saltan los dos — el desdoble con
    // sufijo A/B es una decisión de negocio, no algo que se pueda deducir.
    const porDestino = new Map();
    for (const p of plan) porDestino.set(p.nuevo, (porDestino.get(p.nuevo) || 0) + 1);
    const duplicados = plan.filter((p) => porDestino.get(p.nuevo) > 1);
    if (duplicados.length) {
      for (const d of duplicados) {
        conflictos.push({ viejo: d.viejo, nuevo: d.nuevo, origen: '', destino: 'otro contrato sucio deduce el MISMO número — revisar a mano' });
      }
      const limpio = plan.filter((p) => porDestino.get(p.nuevo) === 1);
      plan.length = 0;
      plan.push(...limpio);
    }

    // El filtro se aplica DESPUÉS de calcular el plan, para que lo excluido
    // siga apareciendo y se vea qué queda pendiente.
    const fuera = SOLO.size ? plan.filter((p) => !SOLO.has(p.nuevo)) : [];
    // COPIA, no la misma referencia: más abajo se vacía `plan` para dejar dentro
    // sólo lo que se va a aplicar, y con la referencia compartida eso borraba
    // también `aplicar` — la corrida completa (sin --solo) terminaba en "Nada
    // que aplicar" aunque el plan tuviera decenas de contratos.
    const aplicar = SOLO.size ? plan.filter((p) => SOLO.has(p.nuevo)) : [...plan];

    console.log('\n=== A NORMALIZAR: ' + aplicar.length + ' contrato(s) ===');
    if (aplicar.length) console.table(aplicar);

    if (fuera.length) {
      console.log('\n· Fuera de esta corrida por --solo (' + fuera.length + ', se pueden normalizar después):');
      console.table(fuera.map((p) => ({ viejo: p.viejo, nuevo: p.nuevo, filas: p.filas })));
    }
    const noPedidos = [...SOLO].filter((s) => !plan.some((p) => p.nuevo === s));
    if (noPedidos.length) {
      console.log('\n⚠ Pedidos en --solo que NO están en el plan: ' + noPedidos.join(', '));
      console.log('  (ya son canónicos, o se saltaron por conflicto — ver arriba)');
    }
    plan.length = 0;
    plan.push(...aplicar);

    if (sinTocar.length) {
      console.log('\n⚠ NO se tocan (el número no se puede deducir sin adivinar):');
      console.table(sinTocar);
    }
    if (conflictos.length) {
      console.log('\n⚠ SE SALTAN (el destino ya existe con OTRAS personas — revisar a mano):');
      console.table(conflictos);
    }

    if (!APPLY) { console.log('\nEnsayo. Correr con --apply para guardarlo.'); return; }
    if (!plan.length) { console.log('\nNada que aplicar.'); return; }

    // Respaldo del mapeo antes de tocar nada.
    const backup = 'normalizacion-contratos-' + Date.now() + '.json';
    fs.writeFileSync(backup, JSON.stringify(plan, null, 2));
    console.log('\nRespaldo del mapeo: ' + backup);

    let total = 0;
    await client.query('BEGIN');
    try {
      for (const it of plan) {
        for (const t of TABLAS) {
          try {
            const r = await client.query('UPDATE "' + t + '" SET "contrato"=$2 WHERE "contrato"=$1', [it.viejo, it.nuevo]);
            total += r.rowCount;
          } catch (e) {
            // Una tabla puede no existir o ser una vista: no aborta el resto.
            if (!/does not exist|cannot update/i.test(e.message)) throw e;
          }
        }
      }
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; }

    const quedan = (await client.query(
      'SELECT COUNT(*)::int n FROM "PEOPLE"' +
      " WHERE \"contrato\" ILIKE 'Contrato%Online%' OR \"contrato\" ~ '^0?[0-9]-[0-9]+-[0-9][0-9]$'"
    )).rows[0].n;
    console.log('\n✓ ' + plan.length + ' contrato(s) normalizados · ' + total + ' fila(s) actualizadas.');
    console.log('  Filas de PEOPLE aún sin canónico: ' + quedan + ' (las que no se pueden deducir).');
  } finally {
    client.release();
    await pool.end();
  }
})().catch((e) => { console.error('✗', e.message); process.exit(1); });
