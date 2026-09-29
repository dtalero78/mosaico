import { test, expect } from '@playwright/test'
import {
  esAccionRetiro, motivoRechazoRetiro, marcasDevolucion, conteoAlRemover, entradaRemovida, MAX_RETIRO,
} from '../../src/lib/nivelacion-retiro'
import { metaResultadoNivelacion } from '../../src/lib/nivelacion-resultados'

/**
 * Las dos salidas de Agrupaciones que no agendan: devolver a Solicitudes y
 * remover. El detalle es el de una solicitud real del 24-sep-2026 (KODOMO,
 * grupo armado), con la confirmación que el usuario hizo al día siguiente.
 */
const DETALLE = {
  leccion: 'Leccion 07',
  modulo: 'Modulo 01',
  hora: '19:00',
  duracionMin: 60,
  motivo: 'Refuerzo de sumas',
  fecha: '2026-09-24T21:10:00.000Z',
  marcadoPor: 'guia@mosaico.cl',
  confirmadoEn: '2026-09-25T13:00:00.000Z',
  confirmadoPor: 'ESTUDIANTE',
  grupoId: '1e301a5a-7a86-45cd-8e6c-8dfa119d61d6',
}
const AHORA = new Date('2026-09-29T22:00:00.000Z')

test('sólo existen dos acciones', () => {
  expect(esAccionRetiro('devolver')).toBe(true)
  expect(esAccionRetiro('remover')).toBe(true)
  expect(esAccionRetiro('cancelar')).toBe(false)
  expect(esAccionRetiro('')).toBe(false)
  expect(esAccionRetiro(null)).toBe(false)
})

test('devolver no pide motivo; remover sí', () => {
  expect(motivoRechazoRetiro('devolver', ['a'], '')).toBeNull()
  expect(motivoRechazoRetiro('remover', ['a'], 'Ya no la necesita')).toBeNull()
  expect(motivoRechazoRetiro('remover', ['a'], '')).toMatch(/motivo/i)
  // Un motivo de puros espacios no es un motivo
  expect(motivoRechazoRetiro('remover', ['a'], '   ')).toMatch(/motivo/i)
  expect(motivoRechazoRetiro('remover', ['a'], null)).toMatch(/motivo/i)
})

test('sin usuarios, con demasiados o con una acción inventada se rechaza', () => {
  expect(motivoRechazoRetiro('devolver', [], '')).toMatch(/al menos un usuario/i)
  const muchos = Array.from({ length: MAX_RETIRO + 1 }, (_, i) => `acd_${i}`)
  expect(motivoRechazoRetiro('devolver', muchos, '')).toMatch(/máximo/i)
  expect(motivoRechazoRetiro('devolver', muchos.slice(0, MAX_RETIRO), '')).toBeNull()
  expect(motivoRechazoRetiro('borrar', ['a'], 'x')).toMatch(/accion/i)
})

test('devolver deja constancia de quién y cuándo', () => {
  expect(marcasDevolucion('Ana Pérez', AHORA)).toEqual({
    devueltaEn: '2026-09-29T22:00:00.000Z',
    devueltaPor: 'Ana Pérez',
  })
})

test('al remover el conteo baja 1 y nunca queda negativo', () => {
  expect(conteoAlRemover(2)).toBe(1)
  expect(conteoAlRemover(1)).toBe(0)
  expect(conteoAlRemover(0)).toBe(0)
  expect(conteoAlRemover(null)).toBe(0)
  expect(conteoAlRemover(undefined)).toBe(0)
})

test('la entrada del histórico guarda lo que se pidió, el motivo y quién la removió', () => {
  const e = entradaRemovida({ detalle: DETALLE, conteo: 2, motivo: '  El apoderado desistió  ', actor: 'Ana Pérez', ahora: AHORA })
  expect(e.resultado).toBe('REMOVIDA')
  expect(e.comentario).toBe('El apoderado desistió')
  expect(e.marcadoPor).toBe('Ana Pérez')
  expect(e.fecha).toBe('2026-09-29T22:00:00.000Z')
  expect(e.cerradoPorServicio).toBe(true)
  // Lo que pidió el guía: `detalleNivelacion` se borra al remover, así que si
  // no viaja aquí se pierde sobre qué era la nivelación.
  expect(e.fechaSolicitud).toBe(DETALLE.fecha)
  expect(e.modulo).toBe('Modulo 01')
  expect(e.leccion).toBe('Leccion 07')
  expect(e.confirmadoEn).toBe(DETALLE.confirmadoEn)
  expect(e.confirmadoPor).toBe('ESTUDIANTE')
})

test('el conteo de la entrada es el de ESTA nivelación, no el ya rebajado', () => {
  const e = entradaRemovida({ detalle: DETALLE, conteo: 2, motivo: 'x', actor: 'a', ahora: AHORA })
  expect(e.conteo).toBe(2)
  expect(conteoAlRemover(2)).toBe(1)
})

test('una removida nunca tuvo evento', () => {
  const e = entradaRemovida({ detalle: DETALLE, conteo: 1, motivo: 'x', actor: 'a', ahora: AHORA })
  expect(e.fechaEvento).toBeNull()
})

test('una solicitud sin detalle no rompe la entrada', () => {
  const e = entradaRemovida({ detalle: null, conteo: null, motivo: 'Aprobada por error', actor: 'a', ahora: AHORA })
  expect(e.resultado).toBe('REMOVIDA')
  expect(e.fechaSolicitud).toBeNull()
  expect(e.leccion).toBeNull()
  expect(e.conteo).toBe(0)
})

test('el Histórico y la ficha muestran «Removida», y un código desconocido no se esconde', () => {
  expect(metaResultadoNivelacion('REMOVIDA').label).toBe('Removida')
  expect(metaResultadoNivelacion('REALIZADA').label).toBe('Realizada')
  expect(metaResultadoNivelacion('NO_ASISTIO_JUSTIFICO').label).toBe('No asistió — justificó')
  expect(metaResultadoNivelacion('ALGO_NUEVO').label).toBe('ALGO_NUEVO')
  expect(metaResultadoNivelacion(null).label).toBe('—')
})
