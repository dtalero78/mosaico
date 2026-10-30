/**
 * API Route: /api/postgres/config/banner
 * GET - Avisos vigentes del login (público: lo pide el login sin sesión).
 *       La administración del carrusel está en ./avisos (ver lib/banner-avisos).
 */

import { handler, successResponse } from '@/lib/api-helpers';
import { avisosParaLogin } from '@/lib/banner-avisos';

export const dynamic = 'force-dynamic';

export const GET = handler(async () => {
  const avisos = await avisosParaLogin();
  return successResponse({
    active: avisos.length > 0,
    avisos,
    // Compatibilidad con un login viejo abierto durante el despliegue.
    image: avisos[0]?.url ?? null,
  });
});
