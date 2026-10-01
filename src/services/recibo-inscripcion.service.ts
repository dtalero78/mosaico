/**
 * Recibo de inscripción del contrato — guardar, leer con IA y revisar.
 *
 * Modelo (mismo que LGS, con tres correcciones):
 *   - El recibo vigente vive en PEOPLE."reciboInscripcion" del TITULAR, aparte de
 *     la documentación. Lo leído se copia a FINANCIEROS.recibo* del contrato.
 *   - Además se adjunta a la CUOTA #0 (PAGOS_TITULARES.documentosAdjuntos), para
 *     que Recaudos lo vea en "Del pago" justo donde verifica la inscripción.
 *   - Si el monto leído coincide con la inscripción, la cuota #0 queda precargada
 *     (fecha, referencia y medio si está en el catálogo) — NUNCA se valida sola.
 *
 * Correcciones respecto de LGS:
 *   1. PRIMERO se guarda y DESPUÉS se lee. En LGS se leía antes de guardar: si la
 *      IA fallaba, el recibo no quedaba registrado y el archivo quedaba huérfano.
 *      Aquí una lectura fallida deja el recibo con `lectura: 'FALLIDA'` y se puede
 *      volver a leer.
 *   2. Reemplazar NO pierde el anterior: pasa a "reciboInscripcionHistory".
 *   3. Sólo se leen archivos de NUESTRO bucket. En LGS la lectura descargaba
 *      cualquier URL que le mandaran.
 */

import 'server-only';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { query, queryOne, withTransaction } from '@/lib/postgres';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { spacesClient, SPACES_BUCKET, SPACES_CDN } from '@/lib/spaces';
import {
  ReciboExtraido, ReciboInscripcion, MAX_MB_RECIBO, reciboPermitido,
  normalizarExtraido, montoCoincide, medioDelCatalogo, aNumero,
} from '@/lib/recibo-inscripcion';

const OPENAI_MODEL = 'gpt-4o-mini';

const PROMPT = `Eres un extractor de datos de COMPROBANTES DE PAGO de Latinoamérica (Chile, Colombia, Ecuador, Perú): Webpay/Transbank, Nequi, Daviplata, PSE, transferencias bancarias (Banco Estado, Santander, Bancolombia, Banco Pichincha, Banco Guayaquil, etc.), Paypal, depósitos.

Analiza el comprobante adjunto y devuelve EXCLUSIVAMENTE un objeto JSON válido (sin texto adicional, sin markdown) con EXACTAMENTE estas claves:
{
  "medioPago": string|null,   // normalizado: "Webpay", "Transferencia", "Paypal", "Nequi", "Daviplata", "PSE", "Efectivo", "Tarjeta". Transferencia o depósito bancario → "Transferencia".
  "fecha": string|null,       // fecha del pago en formato YYYY-MM-DD. Interpreta "14 De Septiembre De 2026", "12/9/2026", "14-09-2026", "11/09/2026 13:27" (día/mes/año).
  "monto": number|null,       // valor pagado, SOLO el número sin símbolos ni separadores de miles: 115000, 99, 4000.
  "referencia": string|null,  // referencia, orden de compra, número de autorización, de operación o de comprobante.
  "banco": string|null,       // banco emisor o de destino, si aparece.
  "confianza": number         // 0 a 1: qué tan seguro estás de la extracción.
}

Reglas ESTRICTAS:
- En Chile, Colombia y Perú el PUNTO separa los MILES y la coma los decimales: "$125.000" son 125000 (ciento veinticinco mil), "$1.150.000" son 1150000. Los pesos no llevan decimales: nunca devuelvas 125 por "$125.000".
- Si un campo no aparece en el comprobante, usa null. NUNCA inventes datos.
- Si el archivo NO es un comprobante de pago, pon "confianza": 0 y todo lo demás null.
- Responde ÚNICAMENTE el objeto JSON.`;

// ── Lectura ─────────────────────────────────────────────────────────────────

/** Clave del objeto en el bucket, SÓLO si la URL es de nuestro bucket. */
export function keyDeNuestroBucket(url: string): string | null {
  if (!url || !url.startsWith(`${SPACES_CDN}/`)) return null;
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
  } catch {
    return null;
  }
}

async function descargar(url: string): Promise<{ buf: Buffer; tipo: string }> {
  const key = keyDeNuestroBucket(url);
  if (!key) throw new ValidationError('El recibo no está en el almacenamiento de MOSAICO.');
  const r = await spacesClient.send(new GetObjectCommand({ Bucket: SPACES_BUCKET, Key: key }));
  const bytes = await (r.Body as any)?.transformToByteArray?.();
  if (!bytes) throw new ValidationError('No se pudo descargar el recibo.');
  const buf = Buffer.from(bytes);
  if (buf.length === 0) {
    throw new ValidationError('El archivo está vacío (0 bytes): se subió mal y hay que volver a subirlo.');
  }
  if (buf.length > MAX_MB_RECIBO * 1024 * 1024) {
    throw new ValidationError(`El recibo supera ${MAX_MB_RECIBO} MB.`);
  }
  let tipo = String(r.ContentType || '').split(';')[0].trim().toLowerCase();
  if (!tipo || tipo === 'application/octet-stream') {
    if (/\.pdf$/i.test(key)) tipo = 'application/pdf';
    else if (/\.png$/i.test(key)) tipo = 'image/png';
    else if (/\.webp$/i.test(key)) tipo = 'image/webp';
    else tipo = 'image/jpeg';
  }
  if (tipo === 'image/jpg') tipo = 'image/jpeg';
  return { buf, tipo };
}

/** Descarga el recibo de nuestro bucket y lo lee con OpenAI (visión). */
export async function leerRecibo(url: string): Promise<ReciboExtraido> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new ValidationError('La lectura de recibos no está configurada (falta OPENAI_API_KEY).');

  const { buf, tipo } = await descargar(url);
  if (tipo !== 'application/pdf' && !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(tipo)) {
    throw new ValidationError(`Este tipo de archivo no se puede leer (${tipo}). Suba la foto en JPG/PNG o el PDF.`);
  }
  const b64 = buf.toString('base64');
  const archivo = tipo === 'application/pdf'
    ? { type: 'file', file: { filename: 'recibo.pdf', file_data: `data:application/pdf;base64,${b64}` } }
    : { type: 'image_url', image_url: { url: `data:${tipo};base64,${b64}` } };

  const OpenAI = (await import('openai')).default;
  const client = new OpenAI({ apiKey });
  // Un PDF consume muchos tokens: si varias lecturas coinciden en el mismo minuto,
  // OpenAI responde 429 (límite por minuto). Se reintenta con espera creciente en
  // vez de dejar el recibo "sin leer" por algo que se resuelve en segundos.
  let respuesta: any;
  for (let intento = 1; ; intento++) {
    try {
      respuesta = await client.chat.completions.create({
        model: OPENAI_MODEL,
        max_tokens: 600,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: [{ type: 'text', text: PROMPT }, archivo] as any }],
      });
      break;
    } catch (e: any) {
      if (e?.status === 429 && intento < 4) {
        await new Promise(r => setTimeout(r, intento * 4000));
        continue;
      }
      throw new ValidationError(`La lectura del recibo falló: ${e?.message || e}`);
    }
  }
  const texto = String(respuesta?.choices?.[0]?.message?.content ?? '')
    .trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '').trim();
  let json: any;
  try { json = JSON.parse(texto); } catch { throw new ValidationError('La lectura no devolvió un resultado válido.'); }
  return normalizarExtraido(json);
}

// ── Contexto del contrato ───────────────────────────────────────────────────

interface Titular {
  _id: string;
  contrato: string | null;
  plataforma: string | null;
  tipoUsuario: string | null;
  reciboInscripcion: ReciboInscripcion | null;
}

/**
 * El recibo es del CONTRATO y vive en el titular. Si llega el id de un
 * beneficiario (la ficha /person también muestra beneficiarios), se resuelve el
 * titular de su contrato — si no, cada ficha tendría su propio "recibo".
 */
export async function cargarTitular(peopleId: string): Promise<Titular> {
  const cols = `"_id", "contrato", "plataforma", "tipoUsuario", "reciboInscripcion"`;
  const p = await queryOne<Titular>(`SELECT ${cols} FROM "PEOPLE" WHERE "_id" = $1`, [peopleId]);
  if (!p) throw new NotFoundError('Titular', peopleId);
  if (p.tipoUsuario === 'TITULAR' || !p.contrato) return p;
  const t = await queryOne<Titular>(
    `SELECT ${cols} FROM "PEOPLE" WHERE "contrato" = $1 AND "tipoUsuario" = 'TITULAR'
      ORDER BY "_createdDate" ASC LIMIT 1`,
    [p.contrato]
  );
  return t || p;
}

/** Cuota #0 (inscripción) del titular: la más reciente si hubiera más de una. */
async function cuotaInscripcion(peopleId: string) {
  return queryOne<{ _id: string; valorPagado: any; inscripcion: any; validado: boolean }>(
    `SELECT "_id", "valorPagado", "inscripcion", "validado"
       FROM "PAGOS_TITULARES"
      WHERE "idPeople" = $1 AND COALESCE("numCuota", 0) = 0
      ORDER BY "_createdDate" DESC LIMIT 1`,
    [peopleId]
  );
}

/** Valor de la inscripción: la cuota #0 y, si no hay, FINANCIEROS.pagoInscripcion. */
async function valorInscripcion(peopleId: string, contrato: string | null): Promise<number | null> {
  const c = await cuotaInscripcion(peopleId);
  const desdeCuota = aNumero(c?.inscripcion) ?? aNumero(c?.valorPagado);
  if (desdeCuota) return desdeCuota;
  if (!contrato) return null;
  const f = await queryOne<{ pagoInscripcion: any }>(
    `SELECT "pagoInscripcion" FROM "FINANCIEROS" WHERE "contrato" = $1 ORDER BY "_createdDate" DESC LIMIT 1`,
    [contrato]
  );
  return aNumero(f?.pagoInscripcion);
}

// ── Guardado ────────────────────────────────────────────────────────────────

/** Etiqueta con que el recibo aparece entre los adjuntos de la cuota #0. */
const PREFIJO_ADJUNTO = 'Recibo de inscripción — ';

export interface ResultadoRecibo {
  recibo: ReciboInscripcion;
  inscripcion: number | null;
  coincide: boolean;
  cuotaPrecargada: boolean;
}

/**
 * Registra un recibo NUEVO (o reemplaza el vigente). No lo lee: queda en
 * `lectura: 'PENDIENTE'` y se lee con `procesarLectura` — así un fallo de la IA
 * nunca hace perder el archivo.
 */
export async function registrarRecibo(opts: {
  peopleId: string;
  url: string;
  nombre: string | null;
  tipo: string | null;
  actor: string;
  origen?: ReciboInscripcion['origen'];
  /** Fecha real de subida (la migración conserva la del documento original). */
  subidoEn?: string;
}): Promise<ReciboInscripcion> {
  const t = await cargarTitular(opts.peopleId);
  if (!keyDeNuestroBucket(opts.url)) throw new ValidationError('El recibo no está en el almacenamiento de MOSAICO.');
  if (!reciboPermitido(opts.tipo, opts.nombre)) {
    throw new ValidationError('El recibo debe ser una imagen JPG, PNG o WEBP, o un PDF.');
  }

  const recibo: ReciboInscripcion = {
    url: opts.url,
    nombre: opts.nombre,
    tipo: opts.tipo,
    subidoPor: opts.actor,
    subidoEn: opts.subidoEn || new Date().toISOString(),
    lectura: 'PENDIENTE',
    lecturaError: null,
    extraido: null,
    origen: opts.origen || 'MODAL',
  };
  const anterior = t.reciboInscripcion;
  const cuota = await cuotaInscripcion(t._id);

  await withTransaction(async (client) => {
    // El vigente pasa al historial (append en SQL, no leer-modificar-escribir).
    await client.query(
      `UPDATE "PEOPLE"
          SET "reciboInscripcionHistory" = CASE WHEN "reciboInscripcion" IS NULL
                THEN COALESCE("reciboInscripcionHistory", '[]'::jsonb)
                ELSE COALESCE("reciboInscripcionHistory", '[]'::jsonb)
                     || jsonb_build_array("reciboInscripcion" || jsonb_build_object('reemplazadoEn', NOW()))
              END,
              "reciboInscripcion" = $1::jsonb,
              "_updatedDate" = NOW()
        WHERE "_id" = $2`,
      [JSON.stringify(recibo), t._id]
    );

    if (cuota) {
      // En la cuota #0: sale el recibo anterior, entra el nuevo.
      await client.query(
        `UPDATE "PAGOS_TITULARES"
            SET "documentosAdjuntos" = COALESCE((
                  SELECT jsonb_agg(d) FROM jsonb_array_elements(COALESCE("documentosAdjuntos", '[]'::jsonb)) d
                   WHERE d->>'url' IS DISTINCT FROM $2
                ), '[]'::jsonb) || $3::jsonb,
                "_updatedDate" = NOW()
          WHERE "_id" = $1`,
        [
          cuota._id,
          anterior?.url ?? null,
          JSON.stringify([{
            url: recibo.url,
            nombre: `${PREFIJO_ADJUNTO}${recibo.nombre || 'recibo'}`,
            tipo: recibo.tipo,
            fechaSubida: recibo.subidoEn,
            esReciboInscripcion: true,
          }]),
        ]
      );
    }
  });

  return recibo;
}

/**
 * Lee el recibo vigente con la IA y deja el resultado. Si la IA falla, el recibo
 * queda con `lectura: 'FALLIDA'` y el motivo — nunca se pierde.
 * Si el monto coincide con la inscripción, precarga la cuota #0.
 */
export async function procesarLectura(peopleId: string, actor: string): Promise<ResultadoRecibo> {
  const t = await cargarTitular(peopleId);
  const recibo = t.reciboInscripcion;
  if (!recibo?.url) throw new ValidationError('El contrato no tiene recibo de inscripción.');

  let extraido: ReciboExtraido | null = null;
  let error: string | null = null;
  try {
    extraido = await leerRecibo(recibo.url);
  } catch (e: any) {
    error = e?.message || 'La lectura falló.';
  }

  const actualizado: ReciboInscripcion = {
    ...recibo,
    lectura: extraido ? 'OK' : 'FALLIDA',
    lecturaError: error,
    extraido: extraido ?? recibo.extraido ?? null,
  };
  // Sólo si sigue siendo el mismo recibo (otro pudo reemplazarlo mientras se leía).
  await query(
    `UPDATE "PEOPLE" SET "reciboInscripcion" = $1::jsonb, "_updatedDate" = NOW()
      WHERE "_id" = $2 AND "reciboInscripcion"->>'url' = $3`,
    [JSON.stringify(actualizado), t._id, recibo.url]
  );

  const inscripcion = await valorInscripcion(t._id, t.contrato);
  const coincide = !!extraido && montoCoincide(extraido.monto, inscripcion);
  let cuotaPrecargada = false;
  if (extraido) {
    await copiarAFinanciero(t.contrato, recibo.url, extraido, actor);
    if (coincide) cuotaPrecargada = await precargarCuota(t._id, t.plataforma, extraido);
  }
  return { recibo: actualizado, inscripcion, coincide, cuotaPrecargada };
}

/**
 * Recaudos confirma o corrige lo leído. Queda registrado quién lo revisó, se
 * copia a FINANCIEROS y se precarga la cuota #0 aunque el monto no coincida —
 * aquí ya lo revisó una persona. La cuota sigue SIN validar.
 */
export async function guardarRevision(
  peopleId: string, campos: Partial<ReciboExtraido>, actor: string
): Promise<ResultadoRecibo> {
  const t = await cargarTitular(peopleId);
  const recibo = t.reciboInscripcion;
  if (!recibo?.url) throw new ValidationError('El contrato no tiene recibo de inscripción.');
  const extraido = normalizarExtraido({ ...campos, confianza: recibo.extraido?.confianza ?? null });

  const actualizado: ReciboInscripcion = {
    ...recibo,
    lectura: 'OK',
    lecturaError: null,
    extraido,
    revisadoPor: actor,
    revisadoEn: new Date().toISOString(),
  };
  await query(
    `UPDATE "PEOPLE" SET "reciboInscripcion" = $1::jsonb, "_updatedDate" = NOW() WHERE "_id" = $2`,
    [JSON.stringify(actualizado), t._id]
  );
  await copiarAFinanciero(t.contrato, recibo.url, extraido, actor);
  const cuotaPrecargada = await precargarCuota(t._id, t.plataforma, extraido);
  const inscripcion = await valorInscripcion(t._id, t.contrato);
  return { recibo: actualizado, inscripcion, coincide: montoCoincide(extraido.monto, inscripcion), cuotaPrecargada };
}

/** FINANCIEROS.recibo* del contrato (todas sus filas). Sin fila no es error. */
async function copiarAFinanciero(contrato: string | null, url: string, e: ReciboExtraido, actor: string) {
  if (!contrato) return;
  await query(
    `UPDATE "FINANCIEROS"
        SET "reciboUrl"        = $1,
            "reciboMedioPago"  = $2,
            "reciboFecha"      = $3::date,
            "reciboMonto"      = $4,
            "reciboReferencia" = $5,
            "reciboBanco"      = $6,
            "reciboExtraido"   = $7::jsonb,
            "_updatedDate"     = NOW()
      WHERE "contrato" = $8`,
    [
      url, e.medioPago?.slice(0, 60) ?? null, e.fecha, e.monto,
      e.referencia?.slice(0, 120) ?? null, e.banco?.slice(0, 80) ?? null,
      JSON.stringify({ ...e, url, extraidoPor: actor, extraidoEn: new Date().toISOString() }),
      contrato,
    ]
  );
}

/**
 * Precarga la cuota #0 con lo leído: fecha de pago, referencia y medio (sólo si
 * corresponde a una opción del catálogo de la plataforma). NO toca el valor, el
 * saldo ni `validado`: la inscripción la sigue verificando Recaudos.
 * Una cuota ya validada no se toca.
 */
async function precargarCuota(peopleId: string, plataforma: string | null, e: ReciboExtraido): Promise<boolean> {
  const medio = medioDelCatalogo(e.medioPago, plataforma);
  const r = await query(
    `UPDATE "PAGOS_TITULARES"
        SET "fechaPago"        = COALESCE($2::date, "fechaPago"),
            "numeroReferencia" = COALESCE($3, "numeroReferencia"),
            "medioPago"        = COALESCE($4, "medioPago"),
            "_updatedDate"     = NOW()
      WHERE "_id" = (
              SELECT "_id" FROM "PAGOS_TITULARES"
               WHERE "idPeople" = $1 AND COALESCE("numCuota", 0) = 0
               ORDER BY "_createdDate" DESC LIMIT 1
            )
        AND "validado" IS NOT TRUE`,
    [peopleId, e.fecha, e.referencia?.slice(0, 120) ?? null, medio]
  );
  return (r.rowCount ?? 0) > 0;
}

// ── Migración: comprobantes que estaban en la documentación ──────────────────

/** Nombre de archivo que identifica un comprobante de pago subido como documento. */
export const PATRON_COMPROBANTE = /comprobante/i;

export interface PlanMigracion {
  personaId: string;
  titularId: string;
  contrato: string | null;
  archivos: { url: string; nombre: string; tipo: string | null; fechaSubida: string | null }[];
  yaTieneRecibo: boolean;
}

/**
 * Los comprobantes que hoy están mezclados en PEOPLE.documentacion (identificados
 * por el nombre del archivo) pasan a ser el recibo de inscripción del contrato.
 *
 * Por contrato: se registran en orden de subida, así el MÁS RECIENTE queda como
 * recibo vigente y los anteriores en el historial. Se quitan de la documentación
 * (el archivo NO se borra: es el mismo, sólo cambia de sección) y se leen con IA.
 * Se saltan los contratos que ya tienen recibo: ahí alguien ya lo cargó a mano.
 */
export async function migrarComprobantes(opts: { apply: boolean; actor: string; limite?: number }) {
  const filas = await query<{ _id: string; contrato: string | null; tipoUsuario: string | null; documentacion: any }>(
    `SELECT "_id", "contrato", "tipoUsuario", "documentacion"
       FROM "PEOPLE"
      WHERE jsonb_typeof("documentacion") = 'array'
        AND EXISTS (SELECT 1 FROM jsonb_array_elements("documentacion") d
                     WHERE jsonb_typeof(d) = 'object' AND d->>'nombre' ~* 'comprobante')
      ORDER BY "_id"`
  );

  const plan: PlanMigracion[] = [];
  for (const f of filas.rows) {
    const archivos = (f.documentacion as any[])
      .filter(d => d && typeof d === 'object' && PATRON_COMPROBANTE.test(String(d.nombre || '')) && keyDeNuestroBucket(d.url))
      .map(d => ({ url: String(d.url), nombre: String(d.nombre), tipo: d.tipo ? String(d.tipo) : null, fechaSubida: d.fechaSubida ? String(d.fechaSubida) : null }))
      .sort((a, b) => String(a.fechaSubida || '').localeCompare(String(b.fechaSubida || '')));
    if (!archivos.length) continue;
    const t = await cargarTitular(f._id);
    plan.push({ personaId: f._id, titularId: t._id, contrato: t.contrato, archivos, yaTieneRecibo: !!t.reciboInscripcion });
  }

  const aMover = plan.filter(p => !p.yaTieneRecibo).slice(0, opts.limite ?? Infinity);
  if (!opts.apply) {
    return { apply: false, contratos: plan.length, aMover: aMover.length, saltados: plan.length - aMover.length, plan };
  }

  const resultados: any[] = [];
  for (const p of aMover) {
    try {
      for (const a of p.archivos) {
        await registrarRecibo({
          peopleId: p.titularId, url: a.url, nombre: a.nombre, tipo: a.tipo,
          actor: opts.actor, origen: 'MIGRACION', subidoEn: a.fechaSubida || undefined,
        });
      }
      // Fuera de la documentación: pasan a ser el recibo (no se borra el archivo).
      const urls = p.archivos.map(a => a.url);
      await query(
        `UPDATE "PEOPLE"
            SET "documentacion" = COALESCE((
                  SELECT jsonb_agg(d) FROM jsonb_array_elements("documentacion") d
                   WHERE NOT (jsonb_typeof(d) = 'object' AND d->>'url' = ANY($2::text[]))
                ), '[]'::jsonb),
                "_updatedDate" = NOW()
          WHERE "_id" = $1`,
        [p.personaId, urls]
      );
      const r = await procesarLectura(p.titularId, opts.actor);
      resultados.push({
        contrato: p.contrato, titularId: p.titularId, archivos: urls.length,
        lectura: r.recibo.lectura, error: r.recibo.lecturaError || null,
        monto: r.recibo.extraido?.monto ?? null, inscripcion: r.inscripcion,
        coincide: r.coincide, cuotaPrecargada: r.cuotaPrecargada,
      });
    } catch (e: any) {
      resultados.push({ contrato: p.contrato, titularId: p.titularId, error: e?.message || String(e) });
    }
  }
  return { apply: true, contratos: plan.length, movidos: resultados.filter(r => r.lectura).length, resultados };
}

/** Lo que el modal necesita: el recibo, su historial y el valor de la inscripción. */
export async function obtenerRecibo(peopleId: string) {
  const t = await cargarTitular(peopleId);
  const row = await queryOne<{ reciboInscripcionHistory: any }>(
    `SELECT "reciboInscripcionHistory" FROM "PEOPLE" WHERE "_id" = $1`, [t._id]
  );
  const recibo: ReciboInscripcion | null = t.reciboInscripcion || null;
  const inscripcion = await valorInscripcion(t._id, t.contrato);
  return {
    titularId: t._id,
    recibo,
    historial: Array.isArray(row?.reciboInscripcionHistory) ? row!.reciboInscripcionHistory : [],
    inscripcion,
    coincide: montoCoincide(recibo?.extraido?.monto ?? null, inscripcion),
  };
}
