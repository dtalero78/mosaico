/**
 * Libro de Producción › gestionar un contrato con errores de los ejecutivos:
 *
 *   - DEPURAR: descargar los documentos y recibos (ZIP) y BORRAR el contrato con
 *     todos sus registros (`purgarContrato`, que deja el snapshot en PURGE_LOG).
 *   - RATIFICAR: dar por firmado un contrato sin firma, con el correo del "Sí, acepto"
 *     adjunto a los documentos; queda con el texto de aceptación y LISTO.
 *
 * Reglas:
 *   - Un contrato aprobado sólo se depura mientras TODOS sus cursos sigan en
 *     matrícula (el curso aún no empezó); finalizado, nunca.
 *   - Si el titular (o alguno de sus alumnos) está también en OTRO contrato, se
 *     avisa y el admin debe confirmar. La purga conserva a esas personas.
 *   - Ratificar sólo aplica a contratos sin firma y sin decisión.
 */
import 'server-only';
import JSZip from 'jszip';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { query, queryMany, queryOne } from '@/lib/postgres';
import { AppError, NotFoundError, ValidationError } from '@/lib/errors';
import { spacesClient, SPACES_BUCKET } from '@/lib/spaces';
import { keyDeNuestroBucket } from '@/services/recibo-inscripcion.service';
import { matriculaAbierta } from '@/lib/cursos-campaign';
import { isDriveConfigured, downloadPdfFromDrive } from '@/lib/gdrive';
import { buildContractFileBase } from '@/lib/contract-pdf';
import { deshacerListo } from '@/services/gestion-cupo.service';
import { purgarContrato, type PurgaContexto } from '@/services/purga-contrato.service';
import { ratificarConsentimientoPorCorreo, registrarAuditoriaAutoaprobacion } from '@/services/consent.service';
import { dejarContratoListo } from '@/services/dejar-listo.service';

export interface DocumentoContrato { nombre: string; url: string; origen: 'documentacion' | 'recibo' }

export interface AnalisisContrato {
  titularId: string;
  contrato: string;
  titular: string;
  firmado: boolean;
  aprobado: boolean;
  finalizado: boolean;
  listo: boolean;
  /** Estado de decisión de la ficha ('' = sin decisión). */
  aprobacion: string;
  enMatricula: boolean;
  campanias: string[];
  documentos: DocumentoContrato[];
  alumnos: number;
  clases: number;
  /** Otros contratos de las mismas personas (titular o alumnos). */
  otrosContratos: { contrato: string; persona: string; rol: string }[];
  puedeDepurar: { ok: boolean; motivo?: string };
  puedeRatificar: { ok: boolean; motivo?: string };
}

const nom = (r: any) => [r.primerNombre, r.segundoNombre, r.primerApellido, r.segundoApellido]
  .map((s) => String(s || '').trim()).filter(Boolean).join(' ');

export async function analizarContrato(titularId: string): Promise<AnalisisContrato> {
  const t = await queryOne<any>(
    `SELECT * FROM "PEOPLE" WHERE "_id" = $1 AND "tipoUsuario" = 'TITULAR'`, [titularId]);
  if (!t) throw new NotFoundError('Titular', titularId);
  if (!t.contrato) throw new ValidationError('El titular no tiene número de contrato.');

  const benefs = await queryMany<any>(
    `SELECT "_id","numeroId","primerNombre","segundoNombre","primerApellido","segundoApellido","campaign","aprobacion"
       FROM "PEOPLE" WHERE "contrato" = $1 AND "tipoUsuario" <> 'TITULAR'`, [t.contrato]);

  const personas = [t, ...benefs].filter((p) => p.numeroId);
  const nids = Array.from(new Set(personas.map((p) => p.numeroId)));
  const otros = nids.length ? await queryMany<any>(
    `SELECT DISTINCT "contrato","numeroId","tipoUsuario","primerNombre","primerApellido" FROM "PEOPLE"
      WHERE "numeroId" = ANY($1::text[]) AND COALESCE("contrato",'') <> '' AND "contrato" <> $2`, [nids, t.contrato]) : [];

  const campanias = Array.from(new Set([t.campaign, ...benefs.map((b) => b.campaign)].filter(Boolean))) as string[];
  let enMatricula = campanias.length > 0;
  for (const c of campanias) {
    const r = await queryOne<{ inicio: any }>(
      `SELECT MIN("inicioCurso") AS inicio FROM "CURSOS_CAMPAIGN" WHERE "campaign" = $1`, [c]);
    if (!r?.inicio || !matriculaAbierta(r.inicio)) enMatricula = false;
  }

  const nidsBenef = Array.from(new Set(benefs.map((b) => b.numeroId).filter(Boolean)));
  const academicas = nidsBenef.length ? await queryMany<{ _id: string }>(
    `SELECT "_id" FROM "ACADEMICA" WHERE "numeroId" = ANY($1::text[])`, [nidsBenef]) : [];
  const ac = academicas.map((a) => a._id);
  const clases = ac.length ? (await queryOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM "ACADEMICA_BOOKINGS" WHERE "studentId" = ANY($1::text[]) OR "idEstudiante" = ANY($1::text[])`, [ac]))?.n || 0 : 0;

  const docs: DocumentoContrato[] = [];
  const dj = Array.isArray(t.documentacion) ? t.documentacion : [];
  for (const d of dj) if (d?.url) docs.push({ nombre: d.nombre || 'documento', url: d.url, origen: 'documentacion' });
  if (t.reciboInscripcion?.url) docs.push({ nombre: t.reciboInscripcion.nombre || 'recibo', url: t.reciboInscripcion.url, origen: 'recibo' });

  const a = String(t.aprobacion || '').trim().toLowerCase();
  const aprobado = a === 'aprobado' || a === 'aprobada';
  const finalizado = a === 'finalizada' || t.estado === 'FINALIZADA';
  const firmado = String(t.hashConsentimiento || '').trim() !== '';
  const sinDecision = a === '' || a === 'pendiente';

  let puedeDepurar: AnalisisContrato['puedeDepurar'] = { ok: true };
  if (finalizado) puedeDepurar = { ok: false, motivo: 'El contrato está finalizado: no se puede depurar.' };
  else if (aprobado && !enMatricula) {
    puedeDepurar = { ok: false, motivo: 'El contrato está aprobado y su curso ya salió de matrícula (empezó): no se puede depurar.' };
  }
  let puedeRatificar: AnalisisContrato['puedeRatificar'] = { ok: true };
  if (firmado) puedeRatificar = { ok: false, motivo: 'El contrato ya está firmado.' };
  else if (!sinDecision) puedeRatificar = { ok: false, motivo: `El contrato está en estado "${t.aprobacion}": no se ratifica.` };

  return {
    titularId, contrato: t.contrato, titular: nom(t), firmado, aprobado, finalizado,
    listo: t.gestionContratoListo === true, aprobacion: a === 'pendiente' ? '' : String(t.aprobacion || ''),
    enMatricula, campanias, documentos: docs, alumnos: benefs.length, clases,
    otrosContratos: otros.map((o) => ({ contrato: o.contrato, persona: nom(o), rol: o.tipoUsuario })),
    puedeDepurar, puedeRatificar,
  };
}

async function bajarDeSpaces(url: string): Promise<Buffer | null> {
  const key = keyDeNuestroBucket(url);
  if (!key) return null;
  const r = await spacesClient.send(new GetObjectCommand({ Bucket: SPACES_BUCKET, Key: key }));
  const bytes = await (r.Body as any)?.transformToByteArray?.();
  return bytes ? Buffer.from(bytes) : null;
}

const limpio = (s: string) => s.replace(/[^a-zA-Z0-9._-]/g, '_');

/** ZIP `<contrato>_<fecha>.zip` con documentos, recibo y el PDF del contrato (si está en Drive). */
export async function zipDeContrato(titularId: string): Promise<{ buffer: Buffer; nombre: string }> {
  const an = await analizarContrato(titularId);
  const zip = new JSZip();
  const fallos: string[] = [];
  let n = 0;
  for (const d of an.documentos) {
    try {
      const buf = await bajarDeSpaces(d.url);
      if (!buf) { fallos.push(`${d.nombre}: no está en el almacenamiento de MOSAICO (${d.url})`); continue; }
      n += 1;
      zip.file(`${d.origen === 'recibo' ? 'recibo' : 'documentos'}/${String(n).padStart(2, '0')}_${limpio(d.nombre)}`, buf);
    } catch (e: any) { fallos.push(`${d.nombre}: ${e?.message || 'error al descargar'}`); }
  }
  try {
    if (isDriveConfigured()) {
      const base = buildContractFileBase(an.contrato, titularId);
      const f = await downloadPdfFromDrive(`${base}.pdf`);
      if (f) zip.file(`contrato/${base}.pdf`, f.buffer);
      else fallos.push('El PDF del contrato no está en el Drive.');
    }
  } catch (e: any) { fallos.push(`PDF del contrato: ${e?.message || 'error'}`); }
  const fecha = new Date().toISOString().slice(0, 10);
  zip.file('LEEME.txt', [
    `Contrato ${an.contrato} — ${an.titular}`, `Generado: ${new Date().toISOString()}`,
    `Archivos incluidos: ${n}`, fallos.length ? `\nNO se pudieron incluir:\n- ${fallos.join('\n- ')}` : '',
  ].join('\n'));
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  return { buffer, nombre: `${limpio(an.contrato)}_${fecha}.zip` };
}

export async function depurarContrato(
  titularId: string,
  opts: { motivo: string; confirmoDescarga: boolean; confirmarOtros: boolean },
  ctx: Omit<PurgaContexto, 'tipoPurga' | 'motivo'>
) {
  const motivo = String(opts.motivo || '').trim();
  if (!motivo) throw new ValidationError('El motivo es obligatorio.');
  if (!opts.confirmoDescarga) throw new ValidationError('Primero hay que descargar los documentos (ZIP) y confirmarlo.');
  const an = await analizarContrato(titularId);
  if (!an.puedeDepurar.ok) throw new ValidationError(an.puedeDepurar.motivo!);
  if (an.otrosContratos.length && !opts.confirmarOtros) {
    throw new AppError('Hay otros contratos de estas personas: hay que confirmar la depuración.', 409, 'OTROS_CONTRATOS', { otrosContratos: an.otrosContratos });
  }
  // Un «listo» sin aprobar tiene el cupo tomado: se suelta antes de borrar. Si ya está
  // aprobado no hace falta (el cupo se deriva de las filas, que se borran).
  if (an.listo && !an.aprobado) {
    await deshacerListo({ titularId, actor: ctx.actorEmail, motivo: `Revertido para depurar el contrato. ${motivo}` });
  }
  const r = await purgarContrato(an.contrato, { ...ctx, tipoPurga: 'DEPURACION_LIBRO', motivo });
  return { contrato: an.contrato, ...r };
}

export async function ratificarContrato(
  session: any,
  titularId: string,
  opts: { documento: { url: string; nombre: string; tipo?: string }; confirmarOtros: boolean },
  ctx: { ip: string; userAgent: string }
) {
  const an = await analizarContrato(titularId);
  if (!an.puedeRatificar.ok) throw new ValidationError(an.puedeRatificar.motivo!);
  const doc = opts.documento;
  const key = keyDeNuestroBucket(doc?.url || '');
  if (!key || !key.startsWith(`contratos/${titularId}/`)) {
    throw new ValidationError('Adjunte el correo del "Sí, acepto" (archivo subido a este contrato).');
  }
  if (an.otrosContratos.length && !opts.confirmarOtros) {
    throw new AppError('Hay otros contratos de estas personas: hay que confirmar la ratificación.', 409, 'OTROS_CONTRATOS', { otrosContratos: an.otrosContratos });
  }
  const email = session?.user?.email || 'desconocido';
  const nombre = session?.user?.name || email;

  // El correo queda entre los documentos del contrato (si aún no está).
  const nombreDoc = `Si acepto (correo) — ${doc.nombre}`;
  await query(
    `UPDATE "PEOPLE" SET "documentacion" = COALESCE("documentacion",'[]'::jsonb) || $1::jsonb, "_updatedDate" = NOW()
      WHERE "_id" = $2 AND NOT COALESCE("documentacion",'[]'::jsonb) @> $3::jsonb`,
    [JSON.stringify([{ url: doc.url, nombre: nombreDoc, tipo: doc.tipo || 'application/octet-stream', fechaSubida: new Date().toISOString() }]),
     titularId, JSON.stringify([{ url: doc.url }])]);

  await ratificarConsentimientoPorCorreo(titularId, { email, nombre, ip: ctx.ip, userAgent: ctx.userAgent }, doc.nombre);
  try {
    await registrarAuditoriaAutoaprobacion({ contrato: an.contrato, titularId, usuarioEmail: email, usuarioNombre: nombre, ip: ctx.ip, userAgent: ctx.userAgent });
  } catch { /* la auditoría de la firma no debe tumbar la ratificación */ }

  // Con el correo adjunto queda LISTO (toma el cupo). Si el salón no tiene lugar,
  // la ratificación ya quedó hecha y se avisa para resolverlo en Gestión Contrato.
  let listo = false; let avisoListo: string | null = null;
  try { await dejarContratoListo(session, { titularId }); listo = true; }
  catch (e: any) { avisoListo = e?.message || 'No se pudo dejar el contrato listo.'; }
  return { contrato: an.contrato, ratificado: true, listo, avisoListo };
}
