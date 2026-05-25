import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { isAuthDisabled } from '@/lib/utils'
import { Role } from '@/types/permissions'
import { getPermissionsForRoleFromWix, hasAccessToRoute } from '@/lib/middleware-permissions'

// Respuesta con headers anti-caché aplicados a todas las rutas protegidas.
// Evita que el navegador muestre páginas cacheadas al presionar "atrás" después de logout.
function noCacheNext(): NextResponse {
  const res = NextResponse.next()
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  res.headers.set('Pragma', 'no-cache')
  res.headers.set('Expires', '0')
  return res
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Skip middleware para rutas públicas y archivos estáticos (sin headers anti-caché)
  if (
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon.ico') ||
    pathname.startsWith('/contrato') ||
    pathname.startsWith('/nuevo-usuario') ||
    pathname.startsWith('/nuevo-advisor') ||
    pathname.includes('.')
  ) {
    return NextResponse.next()
  }

  // COMENTADO: Skip auth está deshabilitado porque Codespaces tiene DISABLE_AUTH=true
  // pero el .env.local tiene DISABLE_AUTH=false. Ahora SIEMPRE verificamos auth.
  /*
  if (isAuthDisabled()) {
    return NextResponse.next()
  }
  */

  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  })

  console.log('🔍 Middleware Debug:', {
    pathname,
    hasToken: !!token,
    tokenEmail: token?.email,
    tokenRole: token?.role,
    tokenData: token ? JSON.stringify(token) : 'no token',
  })

  // Redirect to login if not authenticated (except if already on login page)
  if (!token && pathname !== '/login') {
    console.log('❌ No token, redirecting to /login')
    const loginUrl = new URL('/login', request.url)
    return NextResponse.redirect(loginUrl)
  }

  // Check permissions for protected routes
  if (token && pathname !== '/login' && pathname !== '/') {
    const userRole = (token.role as Role) || 'admin';

    // SUPER_ADMIN y ADMIN tienen acceso total
    if (userRole === Role.SUPER_ADMIN || userRole === Role.ADMIN || (userRole as string) === 'admin') {
      console.log(`✅ [Middleware] Full access granted to ${pathname} for ${userRole}`);
      return noCacheNext();
    }

    // Rutas que siempre están permitidas (búsqueda de personas/estudiantes, paneles).
    // /panel-advisor NO está aquí — se gatea via ROUTE_PERMISSIONS con
    // ACADEMICO.ADVISOR.VER_ENLACE para impedir que roles sin permiso (ej:
    // SERVICIO_JEFE) accedan por URL directa aunque el sidebar lo oculte.
    // La redirección de ADVISOR a /actualizar-datos se maneja en el Server Layout
    // de /panel-advisor para evitar importar pg en el Edge Runtime del middleware.
    const alwaysAllowedRoutes = ['/person', '/student', '/sesion', '/advisor', '/panel-estudiante', '/advisor-setup', '/student-setup'];
    if (alwaysAllowedRoutes.some(route => pathname.startsWith(route))) {
      console.log(`✅ [Middleware] Access granted to ${pathname} (always allowed route)`);
      return noCacheNext();
    }

    // Para otras rutas, cargar permisos desde Wix
    console.log(`🔐 [Middleware] Verificando permisos para ${userRole} → ${pathname}`);

    try {
      // Cargar permisos del usuario desde Wix (con cache)
      const userPermissions = await getPermissionsForRoleFromWix(userRole);

      console.log(`📋 [Middleware] Permisos de ${userRole}: ${userPermissions.length} permisos`);

      // Verificar si tiene acceso basándose en permisos
      const hasAccess = hasAccessToRoute(pathname, userPermissions);

      if (!hasAccess) {
        console.log(`🚫 [Middleware] Access DENIED to ${pathname} for ${userRole}`);
        console.log(`   Permisos del usuario: ${userPermissions.slice(0, 3).join(', ')}...`);
        return NextResponse.redirect(new URL('/', request.url));
      }

      console.log(`✅ [Middleware] Access granted to ${pathname} for ${userRole}`);
    } catch (error) {
      console.error(`❌ [Middleware] Error verificando permisos:`, error);
      // En caso de error, denegar acceso por seguridad
      return NextResponse.redirect(new URL('/', request.url));
    }
  }

  return noCacheNext()
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
}