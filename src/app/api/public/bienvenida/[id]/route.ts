import 'server-only';
import { handler, successResponse } from '@/lib/api-helpers';
import { ForbiddenError } from '@/lib/errors';
import { verifyBienvenidaToken } from '@/lib/bienvenida-token';
import { query } from '@/lib/postgres';
import { normalizeNumeroId } from '@/lib/numeroid-normalize';

/**
 * GET /api/public/bienvenida/[id]?t=<token> — PÚBLICO, pero exige token válido.
 *
 * Entrega solo lo que la página de bienvenida necesita mostrar. El token acota
 * el acceso a la ventana posterior a la firma (ver bienvenida-token.ts).
 *
 * El hash se enmascara AQUÍ, en el servidor: el sello completo nunca sale del
 * backend, ni siquiera dentro del JSON que recibe el navegador.
 */
function maskHash(hash?: string | null): string {
  if (!hash) return '';
  if (hash.length <= 26) return hash;
  return `${hash.slice(0, 12)} ${'·'.repeat(12)} ${hash.slice(-11)}`;
}

export const GET = handler(async (request, { params }) => {
  const token = new URL(request.url).searchParams.get('t');
  if (!verifyBienvenidaToken(params.id, token)) {
    throw new ForbiddenError('Enlace no válido o expirado');
  }

  const res = await query<any>(
    `SELECT "primerNombre", "segundoNombre", "contrato",
            "consentimientoDeclarativo", "hashConsentimiento"
       FROM "PEOPLE" WHERE "_id" = $1 LIMIT 1`,
    [params.id],
  );
  const p = res.rows[0];
  if (!p) throw new ForbiddenError('Enlace no válido o expirado');

  let consent: any = p.consentimientoDeclarativo;
  if (typeof consent === 'string') {
    try { consent = JSON.parse(consent); } catch { consent = null; }
  }

  return successResponse({
    // .replace colapsa el doble espacio que dejan los nombres con espacio al borde.
    nombre: [p.primerNombre, p.segundoNombre].filter(Boolean).join(' ').replace(/s+/g, ' ').trim(),
    contrato: p.contrato || '',
    // En MOSAICO los documentos se guardan sin puntos ni guiones; se normaliza
    // igual por si el cliente los tecleó al firmar.
    documento: normalizeNumeroId(consent?.numeroDocumento),
    fechaFirma: consent?.timestampAcceptacion || '',
    tipoAprobacion: consent?.tipoAprobacion || '',
    hashMasked: maskHash(p.hashConsentimiento),
  });
});
