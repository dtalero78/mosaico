import { test, expect } from '@playwright/test'
import { fillTemplate, linkPerfil, usaLinkPerfil } from '../../src/lib/message-template-filler'

/**
 * {{linkPerfil}} en las plantillas de Envío de Mensajes: el enlace PERSONAL de
 * cada alumno para crear su perfil — el mismo que manda la aprobación.
 */

test('arma el enlace de perfil del alumno', () => {
  expect(linkPerfil('acd_123', 'https://mosaicosorobanplataforma.com'))
    .toBe('https://mosaicosorobanplataforma.com/nuevo-usuario/acd_123')
  // La barra final del dominio no duplica la del camino.
  expect(linkPerfil('acd_123', 'http://localhost:3002/')).toBe('http://localhost:3002/nuevo-usuario/acd_123')
  // Sin dominio cae al de la plataforma.
  expect(linkPerfil('acd_123')).toBe('https://mosaicosorobanplataforma.com/nuevo-usuario/acd_123')
  // Sin registro académico no se inventa un enlace.
  expect(linkPerfil(null)).toBe('')
})

test('cada destinatario recibe SU enlace dentro del mensaje', () => {
  const tpl = 'Hola, {{nombreCompleto}}\nCompleta tu perfil: {{ linkPerfil }}'
  const msg = fillTemplate(tpl, { nombre: 'Sharon', primerApellido: 'Capristano', academicaId: 'acd_9', baseUrl: 'https://x.cl' })
  expect(msg).toBe('Hola, Sharon Capristano\nCompleta tu perfil: https://x.cl/nuevo-usuario/acd_9')
})

test('detecta si la plantilla usa el enlace', () => {
  expect(usaLinkPerfil('… {{linkPerfil}} …')).toBe(true)
  expect(usaLinkPerfil('… {{ linkPerfil }} …')).toBe(true)
  expect(usaLinkPerfil('Hola, {{nombre}}')).toBe(false)
})
