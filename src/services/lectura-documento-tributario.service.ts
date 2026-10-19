import 'server-only';
import { queryOne } from '@/lib/postgres';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { aNumero, montoCoincide } from '@/lib/recibo-inscripcion';
import {
  parsearDocumentoTributario, numeroConPrefijo, normalizarRut,
  type DocTributarioLeido, type TipoDocTributario,
} from '@/lib/documento-tributario';
import { descargarDeNuestroBucket, extraerJsonConVision } from './recibo-inscripcion.service';

/**
 * Lee la boleta o factura adjunta a un pago (Centro de Validación › Facturación)
 * y la compara contra el pago, para PRECARGAR el N.º de factura y avisar.
 *
 *  1. PDF con texto (los electrónicos del SII): se lee el texto, sin IA.
 *  2. Si no hay texto o no se reconoce (foto, escaneo): IA con visión, el mismo
 *     lector del recibo de inscripción.
 *
 * Nada se guarda aquí: el número sólo se propone; lo confirma quien factura.
 * Los avisos no bloquean (un abono a varias cuotas o un pago de un tercero son
 * legítimos), sólo hacen visible lo que no calza.
 */

const PROMPT_DOC = `Eres un extractor de datos de BOLETAS y FACTURAS electrónicas de Chile (SII).
Devuelve EXCLUSIVAMENTE un objeto JSON con estas claves:
{
  "tipo": "BOLETA" | "FACTURA" | null,
  "numero": string|null,        // el número/folio del documento, sólo dígitos: "69351", "246"
  "monto": number|null,         // monto total en pesos, sin separadores: 138000
  "rutReceptor": string|null    // RUT del cliente/receptor (NO el de MOSAICO CHILE SPA 77.744.966-4)
}
El punto separa los miles: "$138.000" es 138000. Si el archivo no es una boleta ni una factura, devuelve todo null. No inventes datos.`;

async function textoDePdf(buf: Buffer): Promise<string> {
  try {
    const mod: any = await import('pdf-parse/lib/pdf-parse.js' as any);
    const pdf = mod.default || mod;
    const r = await pdf(buf);
    return String(r?.text || '');
  } catch {
    return '';
  }
}

export interface LecturaDocumento extends DocTributarioLeido {
  origen: 'TEXTO' | 'IA';
  avisos: string[];
}

export async function leerDocumentoDePago(pagoId: string, url: string): Promise<LecturaDocumento> {
  const pago = await queryOne<{ valorPagado: any; idPeople: string; idTercero: string | null; pagoTercero: string | null }>(
    `SELECT "valorPagado", "idPeople", "idTercero", "pagoTercero" FROM "PAGOS_TITULARES" WHERE "_id" = $1`, [pagoId]
  );
  if (!pago) throw new NotFoundError('PAGOS_TITULARES', pagoId);

  const { buf, tipo } = await descargarDeNuestroBucket(url);

  let leido: DocTributarioLeido | null = null;
  let origen: 'TEXTO' | 'IA' = 'TEXTO';
  if (tipo === 'application/pdf') leido = parsearDocumentoTributario(await textoDePdf(buf));

  if (!leido) {
    origen = 'IA';
    const j = await extraerJsonConVision(buf, tipo, PROMPT_DOC);
    const t = String(j?.tipo || '').toUpperCase();
    const digitos = String(j?.numero || '').replace(/\D/g, '');
    if ((t !== 'BOLETA' && t !== 'FACTURA') || !digitos) {
      throw new ValidationError('No se reconoció una boleta ni una factura en el archivo. Escriba el número a mano.');
    }
    const tipoDoc = t as TipoDocTributario;
    leido = {
      tipo: tipoDoc, numero: digitos, numeroFactura: numeroConPrefijo(tipoDoc, digitos),
      monto: aNumero(j?.monto), rutReceptor: j?.rutReceptor ? normalizarRut(j.rutReceptor) : null,
    };
  }

  const avisos: string[] = [];
  const valor = aNumero(pago.valorPagado);
  if (leido.monto !== null && valor !== null && !montoCoincide(leido.monto, valor)) {
    avisos.push(`El monto del documento ($${leido.monto.toLocaleString('es-CL')}) no coincide con el del pago ($${valor.toLocaleString('es-CL')}).`);
  }

  if (leido.rutReceptor) {
    const titular = await queryOne<{ numeroId: string | null }>(`SELECT "numeroId" FROM "PEOPLE" WHERE "_id" = $1`, [pago.idPeople]);
    // Quien paga puede ser un tercero (empresa, familiar): su RUT también vale.
    const validos = [titular?.numeroId, pago.idTercero].map(normalizarRut).filter(Boolean);
    if (validos.length && !validos.includes(leido.rutReceptor)) {
      avisos.push(`El documento está a nombre de otro RUT (${leido.rutReceptor}), no del titular${pago.idTercero ? ' ni del tercero que paga' : ''}.`);
    }
  }

  // ¿Ya está usado? Con prefijo y también sin él (los números viejos se guardaron sin prefijo).
  const usado = await queryOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM "PAGOS_TITULARES"
      WHERE "_id" <> $1 AND UPPER(TRIM("numeroFactura")) = ANY($2)`,
    [pagoId, [leido.numeroFactura.toUpperCase(), leido.numero]]
  );
  if ((usado?.n || 0) > 0) avisos.push(`El número ${leido.numeroFactura} ya está registrado en otro pago.`);

  return { ...leido, origen, avisos };
}
