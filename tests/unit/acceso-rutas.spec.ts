import { test, expect } from '@playwright/test'
import { hasAccessToRoute } from '../../src/lib/middleware-permissions'
import type { Permission } from '../../src/types/permissions'

/**
 * La regla que fija este archivo: **lo que no está marcado no se ve**.
 *
 * `hasAccessToRoute` decide el acceso a las páginas para todo rol que no sea
 * SUPER_ADMIN/ADMIN (esos dos se resuelven antes, en el middleware). Antes
 * permitía por defecto cualquier ruta no declarada, así que una página nueva
 * nacía abierta hasta que alguien se acordara de gatearla.
 */
const p = (...xs: string[]) => xs as Permission[]

const NIVELACIONES = p(
  'SERVICIO.NIVELACIONES.VER',
  'SERVICIO.NIVELACIONES.GESTION',
  'SERVICIO.NIVELACIONES.EXPORTAR',
)

test('una ruta no declarada se deniega', () => {
  // El visor de base de datos no está en la tabla de rutas: sin declararlo, antes
  // quedaba abierto a cualquier autenticado.
  expect(hasAccessToRoute('/dbmosaico', NIVELACIONES)).toBe(false)
  expect(hasAccessToRoute('/ruta/que/no/existe', NIVELACIONES)).toBe(false)
  // La matriz de permisos: dejarla abierta permitiría curiosear la configuración
  // de todos los roles.
  expect(hasAccessToRoute('/admin/permissions', NIVELACIONES)).toBe(false)
})

test('sin ningún permiso no se accede a nada', () => {
  const rutas = [
    '/dashboard/servicio/nivelaciones',
    '/dashboard/comercial/crear-contrato',
    '/dashboard/academic/agenda-sesiones',
    '/dashboard/informes/usuarios',
    '/admin/migrar-contrato',
    '/dbmosaico',
  ]
  for (const r of rutas) expect(hasAccessToRoute(r, [])).toBe(false)
})

test('SERVICIO_NIVELACIONES entra a lo suyo y a nada más', () => {
  expect(hasAccessToRoute('/dashboard/servicio/nivelaciones', NIVELACIONES)).toBe(true)
  // La sección Servicio se abre porque tiene un permiso SERVICIO.* — es el
  // fallback genérico y es deliberado: si no, el grupo del menú no cargaría.
  expect(hasAccessToRoute('/dashboard/servicio', NIVELACIONES)).toBe(true)
  // Pero las otras pantallas de Servicio, cada una con su permiso, quedan fuera.
  expect(hasAccessToRoute('/dashboard/servicio/casos-atencion', NIVELACIONES)).toBe(false)
  expect(hasAccessToRoute('/dashboard/servicio/welcome-session', NIVELACIONES)).toBe(false)
  // Y los otros módulos, también.
  expect(hasAccessToRoute('/dashboard/comercial/crear-contrato', NIVELACIONES)).toBe(false)
  expect(hasAccessToRoute('/dashboard/recaudos/gestion', NIVELACIONES)).toBe(false)
  expect(hasAccessToRoute('/admin/migrar-contrato', NIVELACIONES)).toBe(false)
})

test('el permiso correcto sí abre su ruta', () => {
  expect(hasAccessToRoute('/dashboard/servicio/casos-atencion', p('SERVICIO.CASOS_ATENCION.VER'))).toBe(true)
  expect(hasAccessToRoute('/admin/migrar-contrato', p('MANTENIMIENTO.CONTRATOS.MIGRAR'))).toBe(true)
  expect(hasAccessToRoute('/panel-advisor', p('ACADEMICO.ADVISOR.VER_ENLACE'))).toBe(true)
})

test('las subrutas que se habían quedado sin declarar ya piden permiso', () => {
  const material = p('ACADEMICO.MATERIAL.ACTUALIZAR')
  expect(hasAccessToRoute('/dashboard/academic/actualizar-material/usuarios', material)).toBe(true)
  expect(hasAccessToRoute('/dashboard/academic/actualizar-material/advisor', material)).toBe(true)
  // Sin el permiso, no.
  expect(hasAccessToRoute('/dashboard/academic/actualizar-material/usuarios', NIVELACIONES)).toBe(false)

  expect(hasAccessToRoute('/panel-advisor/actualizar-datos', p('ACADEMICO.ADVISOR.VER_ENLACE'))).toBe(true)
  expect(hasAccessToRoute('/panel-advisor/actualizar-datos', NIVELACIONES)).toBe(false)

  expect(hasAccessToRoute('/admin/roles/create/consultar', p('MANTENIMIENTO.USUARIOS.CREAR_ROL'))).toBe(true)
  expect(hasAccessToRoute('/admin/actualizar-videos/instructivos', p('MANTENIMIENTO.MATERIAL.ACTUALIZAR_VIDEOS'))).toBe(true)
})
