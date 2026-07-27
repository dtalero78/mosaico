/**
 * POST /api/admin/envio-mensajes/lookup-apoderados
 *
 * Resuelve destinatarios que son APODERADOS de beneficiarios (nunca el estudiante).
 * El mensaje se envía al `PEOPLE.apoderadoTelefono` guardado en la BD; los datos de la
 * plantilla se rellenan con el BENEFICIARIO (para que el apoderado sepa de qué hijo se trata).
 *
 * Dos modos (body):
 *   1) CSV     → { rows: [{ contrato, numeroId }] }  — valida que exista el BENEFICIARIO
 *                (contrato+id) en la BD; el teléfono del CSV se IGNORA (se usa el de la BD).
 *   2) Filtro  → { filtro: { campaign?, tipoCurso?, salon? } }  — vacío = "todos".
 *                Si el alcance con teléfono de apoderado supera 300 → { excedeLimite, total }.
 *
 * Devuelve items en el MISMO formato que /lookup (celular = teléfono del apoderado) para
 * reusar la lista/preview/envío del wizard. `esApoderado:true` marca estas filas.
 *
 * Permiso: MANTENIMIENTO.USUARIOS.ENVIO_MENSAJES (SUPER_ADMIN/ADMIN bypass).
 */
import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { MantenimientoPermission } from '@/types/permissions';
import { ValidationError } from '@/lib/errors';
import { query } from '@/lib/postgres';
import { normalizeNumeroId } from '@/lib/numeroid-normalize';

const MAX = 300;
// numeroId normalizado en SQL (quita . - _ y espacios, UPPER)
const NRM = `UPPER(TRANSLATE(COALESCE(p."numeroId",''),'.-_ ',''))`;
// dígitos del teléfono del apoderado (cuenta para validar longitud)
const APO_DIGITS = `REGEXP_REPLACE(COALESCE(p."apoderadoTelefono",''),'[^0-9]','','g')`;

const SELECT_COLS = `
  p."_id" AS "peopleId", p."primerNombre" AS "nombre", p."primerApellido",
  p."apoderado", p."apoderadoTelefono", p."campaign", p."tipoCurso", p."salon",
  p."plataforma", p."contrato", p."nivel", p."step", p."estadoInactivo", p."numeroId"`;

function mapRow(r: any, numeroIdOriginal: string) {
  const tel = String(r?.apoderadoTelefono || '').replace(/\D/g, '');
  const valido = !!r?.peopleId && tel.length >= 10;
  const error = !r?.peopleId
    ? 'No existe beneficiario'
    : tel.length < 10 ? 'Sin teléfono de apoderado' : undefined;
  return {
    numeroIdOriginal,
    numeroId: r?.numeroId || r?.peopleId || numeroIdOriginal, // clave única de la fila
    valido, error,
    peopleId: r?.peopleId ?? null,
    nombre: r?.nombre ?? null,
    primerApellido: r?.primerApellido ?? null,
    celular: tel || null,               // DESTINO = teléfono del apoderado (BD)
    apoderado: r?.apoderado ?? null,
    campaign: r?.campaign ?? null,
    curso: r?.tipoCurso ?? null,
    salon: r?.salon ?? null,
    plataforma: r?.plataforma ?? null,
    contrato: r?.contrato ?? null,
    nivel: r?.nivel ?? null,
    step: r?.step ?? null,
    estadoInactivo: r?.estadoInactivo ?? null,
    esApoderado: true,
  };
}

export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, MantenimientoPermission.ENVIO_MENSAJES);
  const body = await request.json();

  // ─────────── Modo CSV: rows [{contrato, numeroId}] ───────────
  if (Array.isArray(body?.rows)) {
    const rows: any[] = body.rows;
    if (rows.length === 0) throw new ValidationError('El CSV no contiene filas.');
    if (rows.length > MAX) throw new ValidationError(`Máximo ${MAX} filas por operación. Recibidas: ${rows.length}`);

    const items: any[] = [];
    for (const row of rows) {
      const contrato = String(row?.contrato || '').trim();
      const idOrig = String(row?.numeroId || '').trim();
      const id = normalizeNumeroId(idOrig);
      if (!id) { items.push({ numeroIdOriginal: idOrig, numeroId: '', valido: false, error: 'ID vacío', esApoderado: true }); continue; }
      const found = (await query<any>(
        `SELECT ${SELECT_COLS}
           FROM "PEOPLE" p
          WHERE p."tipoUsuario"='BENEFICIARIO'
            AND ${NRM} = $1
            AND ($2 = '' OR p."contrato" = $2)
          ORDER BY p."_createdDate" DESC NULLS LAST
          LIMIT 1`,
        [id, contrato]
      )).rows[0];
      if (!found) {
        items.push({
          numeroIdOriginal: idOrig, numeroId: id, valido: false,
          error: contrato ? 'No existe beneficiario con ese contrato + id' : 'No existe beneficiario con ese id',
          esApoderado: true,
        });
        continue;
      }
      items.push(mapRow(found, idOrig));
    }
    return successResponse({ items });
  }

  // ─────────── Modo filtro: { campaign?, tipoCurso?, salon? } ───────────
  const f = body?.filtro || {};
  const campaign = String(f.campaign || '').trim();
  const tipoCurso = String(f.tipoCurso || '').trim();
  const salon = String(f.salon || '').trim();

  const conds = [`p."tipoUsuario" = 'BENEFICIARIO'`];
  const params: any[] = [];
  if (campaign) { params.push(campaign); conds.push(`p."campaign" = $${params.length}`); }
  if (tipoCurso) { params.push(tipoCurso); conds.push(`p."tipoCurso" = $${params.length}`); }
  if (salon) { params.push(salon); conds.push(`p."salon" = $${params.length}`); }
  const where = conds.join(' AND ');

  // Cuenta de VÁLIDOS (con teléfono de apoderado) para el tope de 300.
  const cnt = (await query<{ n: number }>(
    `SELECT COUNT(*)::int n FROM "PEOPLE" p WHERE ${where} AND LENGTH(${APO_DIGITS}) >= 10`, params
  )).rows[0];
  const totalValidos = Number(cnt?.n || 0);
  if (totalValidos > MAX) {
    return successResponse({ excedeLimite: true, total: totalValidos });
  }

  const rows = (await query<any>(
    `SELECT ${SELECT_COLS}
       FROM "PEOPLE" p
      WHERE ${where}
      ORDER BY p."campaign", p."tipoCurso", p."salon", p."primerApellido" NULLS LAST
      LIMIT ${MAX + 50}`, params
  )).rows;
  const items = rows.map((r: any) => mapRow(r, r.numeroId || ''));
  return successResponse({ items, total: totalValidos });
});
