/**
 * API Route: /api/postgres/config/banner/avisos — editor del carrusel del login.
 *
 *   GET    → interruptor general + lista de avisos (con vista previa firmada)
 *   POST   → agrega un aviso (FormData: file, nombre?, desde?, hasta?) — máx. 3
 *   PATCH  → { active } interruptor general, o { avisos: [{id, nombre, activo, desde, hasta}] }
 *            (el orden del arreglo es el orden del carrusel)
 *   DELETE → ?id= quita SOLO ese aviso (y su imagen); los demás quedan igual
 *
 * Gate: MANTENIMIENTO.AVISOS.BANNER (SUPER_ADMIN / ADMIN hacen bypass).
 */
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { MantenimientoPermission } from '@/types/permissions';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { getPresignedUrlEstable } from '@/lib/spaces';
import {
  MAX_AVISOS, AvisoLogin, avisoVigente, borrarImagenAviso, guardarActivo, guardarAvisos,
  hoyAvisos, leerActivo, leerAvisos, migrarBannerLegado, subirImagenAviso, validarFecha,
} from '@/lib/banner-avisos';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const emailDe = (session: any) => session?.user?.email || 'admin';

async function estado() {
  const [active, avisos] = await Promise.all([leerActivo(), leerAvisos()]);
  const hoy = hoyAvisos();
  return {
    active,
    hoy,
    max: MAX_AVISOS,
    avisos: await Promise.all(avisos.map(async a => ({
      ...a,
      vigente: avisoVigente(a, hoy),
      url: await getPresignedUrlEstable(a.key),
    }))),
  };
}

function validarRango(desde: string | null, hasta: string | null) {
  if (desde && hasta && desde > hasta) throw new ValidationError('La fecha "desde" no puede ser posterior a "hasta"');
}

export const GET = handlerWithAuth(async (_req, _ctx, session) => {
  await requirePermission(session, MantenimientoPermission.AVISOS_BANNER);
  await migrarBannerLegado(emailDe(session));
  return successResponse(await estado());
});

export const POST = handlerWithAuth(async (req, _ctx, session) => {
  await requirePermission(session, MantenimientoPermission.AVISOS_BANNER);
  const email = emailDe(session);
  const avisos = await leerAvisos();
  if (avisos.length >= MAX_AVISOS) throw new ValidationError(`Máximo ${MAX_AVISOS} avisos. Quite uno para agregar otro.`);

  const form = await req.formData();
  const file = form.get('file') as File | null;
  if (!file?.size) throw new ValidationError('Debe seleccionar una imagen');
  const desde = validarFecha(form.get('desde'), 'Desde');
  const hasta = validarFecha(form.get('hasta'), 'Hasta');
  validarRango(desde, hasta);
  const nombre = String(form.get('nombre') || '').trim().slice(0, 80) || `Aviso ${avisos.length + 1}`;

  const { id, key } = await subirImagenAviso(Buffer.from(await file.arrayBuffer()), email);
  const nuevo: AvisoLogin = {
    id, key, nombre, activo: true, orden: avisos.length + 1, desde, hasta,
    subidoPor: email, subidoEn: new Date().toISOString(),
  };
  await guardarAvisos([...avisos, nuevo], email);
  console.log(`🖼️ [Banner] Aviso "${nombre}" agregado por ${email}`);
  return successResponse(await estado());
});

export const PATCH = handlerWithAuth(async (req, _ctx, session) => {
  await requirePermission(session, MantenimientoPermission.AVISOS_BANNER);
  const email = emailDe(session);
  const body = await req.json();

  if (body.active !== undefined) {
    if (typeof body.active !== 'boolean') throw new ValidationError('active debe ser booleano');
    await guardarActivo(body.active, email);
  }

  if (body.avisos !== undefined) {
    if (!Array.isArray(body.avisos)) throw new ValidationError('avisos debe ser una lista');
    const actuales = await leerAvisos();
    const porId = new Map(actuales.map(a => [a.id, a]));
    // Se exige la lista completa: así un cambio de orden nunca deja avisos fuera.
    if (body.avisos.length !== actuales.length || body.avisos.some((x: any) => !porId.has(x?.id))) {
      throw new ValidationError('La lista de avisos cambió; recargue la página');
    }
    const nuevos = body.avisos.map((x: any, i: number) => {
      const a = porId.get(x.id)!;
      const desde = validarFecha(x.desde, 'Desde');
      const hasta = validarFecha(x.hasta, 'Hasta');
      validarRango(desde, hasta);
      return {
        ...a,
        nombre: typeof x.nombre === 'string' && x.nombre.trim() ? x.nombre.trim().slice(0, 80) : a.nombre,
        activo: typeof x.activo === 'boolean' ? x.activo : a.activo,
        desde, hasta, orden: i + 1,
      };
    });
    await guardarAvisos(nuevos, email);
  }

  return successResponse(await estado());
});

export const DELETE = handlerWithAuth(async (req, _ctx, session) => {
  await requirePermission(session, MantenimientoPermission.AVISOS_BANNER);
  const email = emailDe(session);
  const id = new URL(req.url).searchParams.get('id');
  const avisos = await leerAvisos();
  const aviso = avisos.find(a => a.id === id);
  if (!aviso) throw new NotFoundError('Aviso no encontrado');

  await guardarAvisos(avisos.filter(a => a.id !== id), email);
  try { await borrarImagenAviso(aviso.key); } catch (e) {
    console.warn('[Banner] No se pudo borrar la imagen en Spaces:', (e as Error).message);
  }
  console.log(`🖼️ [Banner] Aviso "${aviso.nombre}" quitado por ${email}`);
  return successResponse(await estado());
});
