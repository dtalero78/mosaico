import 'server-only';
import { NextResponse } from 'next/server';
import { urlReproduccionVideo } from '@/services/welcome-video.service';

/**
 * GET /api/public/video-welcome — PÚBLICO (lo abre quien recibe el WhatsApp).
 *
 * Devuelve una URL temporal (3 h) del video de bienvenida VIGENTE. Así el enlace
 * que se envía nunca cambia y siempre muestra el último video subido. El video es
 * un instructivo de acceso a la plataforma: no lleva datos de nadie.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const v = await urlReproduccionVideo();
    if (!v) return NextResponse.json({ success: false, error: 'Aún no hay video disponible.' }, { status: 404 });
    return NextResponse.json({ success: true, ...v }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err: any) {
    console.error('[video-welcome] error:', err?.message);
    return NextResponse.json({ success: false, error: 'No se pudo cargar el video.' }, { status: 500 });
  }
}
