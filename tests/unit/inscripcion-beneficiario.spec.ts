import { test, expect } from '@playwright/test'
import { decidirInscripcion, type Fila } from '../../src/services/inscripcion-beneficiario.service'

/**
 * Una persona puede TENER varios contratos, pero sólo puede estar INSCRITA como
 * alumno en uno. Estas pruebas fijan las tres ramas de la regla y, sobre todo,
 * los dos casos que se confunden fácil: un beneficiario recién creado está
 * inactivo pero SÍ cuenta como inscrito, y uno en hold también.
 */

const fila = (p: Partial<Fila> & { tipoUsuario: string; contrato: string }): Fila => ({
  numeroId: '11111111',
  primerNombre: 'Julia',
  primerApellido: 'Jimenez',
  estadoInactivo: false,
  suspendAccion: '',
  aprobacion: 'Aprobado',
  estado: 'ACTIVA',
  aprobacionTitular: 'Aprobado',
  estadoTitular: 'ACTIVA',
  ...p,
})

const permite = (filas: Fila[], destino: string | null) =>
  expect(() => decidirInscripcion(filas, destino)).not.toThrow()

const rechaza = (filas: Fila[], destino: string | null, trozo: string) => {
  let msg = ''
  try { decidirInscripcion(filas, destino) } catch (e: any) { msg = e.message }
  expect(msg).toContain(trozo)
}

test('una persona sin ningún registro se puede inscribir', () => {
  permite([], 'C-1')
})

test('el titular se inscribe en SU contrato aunque tenga otro activo', () => {
  // El caso real: titular de dos contratos aprobados, se inscribe en uno.
  const filas = [
    fila({ tipoUsuario: 'TITULAR', contrato: 'C-1' }),
    fila({ tipoUsuario: 'TITULAR', contrato: 'C-2' }),
  ]
  permite(filas, 'C-1')
  permite(filas, 'C-2')
})

test('el titular NO se inscribe en el contrato de otro mientras el suyo viva', () => {
  const filas = [fila({ tipoUsuario: 'TITULAR', contrato: 'C-1' })]
  rechaza(filas, 'C-9', 'es titular del contrato C-1')
})

test('si su contrato ya está muerto, sí puede inscribirse en el de otro', () => {
  for (const estado of ['Retractado', 'Devuelto', 'Rechazado', 'Contrato nulo', 'FINALIZADA']) {
    const filas = [fila({ tipoUsuario: 'TITULAR', contrato: 'C-1', aprobacion: estado, aprobacionTitular: estado })]
    permite(filas, 'C-9')
  }
})

test('quien ya está inscrito en otro contrato queda bloqueado, y se dice en cuál', () => {
  const filas = [fila({ tipoUsuario: 'BENEFICIARIO', contrato: 'C-1' })]
  rechaza(filas, 'C-9', 'ya está inscrito como beneficiario en el contrato C-1')
})

test('un beneficiario PENDIENTE nace inactivo pero sigue contando como inscrito', () => {
  // Es el error que hay que evitar: `estadoInactivo` a secas no significa dado de baja.
  const filas = [fila({
    tipoUsuario: 'BENEFICIARIO', contrato: 'C-1',
    estadoInactivo: true, aprobacion: '', estado: '',
    aprobacionTitular: '', estadoTitular: '',
  })]
  rechaza(filas, 'C-9', 'ya está inscrito')
})

test('un beneficiario en hold sigue inscrito: está pausado, no dado de baja', () => {
  const filas = [fila({ tipoUsuario: 'BENEFICIARIO', contrato: 'C-1', estadoInactivo: true })]
  rechaza(filas, 'C-9', 'ya está inscrito')
})

test('si un admin lo inactivó a propósito, esa inscripción libera y puede tomar otra', () => {
  const filas = [fila({
    tipoUsuario: 'BENEFICIARIO', contrato: 'C-1',
    estadoInactivo: true, suspendAccion: 'INACTIVACION',
  })]
  permite(filas, 'C-9')
})

test('un contrato ya finalizado no impide volver a matricularse', () => {
  const filas = [fila({
    tipoUsuario: 'BENEFICIARIO', contrato: 'C-1',
    aprobacion: 'FINALIZADA', estado: 'FINALIZADA',
    aprobacionTitular: 'FINALIZADA', estadoTitular: 'FINALIZADA',
  })]
  permite(filas, 'C-9')
})

test('no se puede inscribir dos veces en el MISMO contrato', () => {
  const filas = [
    fila({ tipoUsuario: 'TITULAR', contrato: 'C-1' }),
    fila({ tipoUsuario: 'BENEFICIARIO', contrato: 'C-1' }),
  ]
  rechaza(filas, 'C-1', 'ya está inscrito como beneficiario en este contrato')
})

test('al crear un contrato nuevo (aún sin número) el titular de otro vivo se rechaza', () => {
  const filas = [fila({ tipoUsuario: 'TITULAR', contrato: 'C-1' })]
  rechaza(filas, null, 'es titular del contrato C-1')
})

test('la inscripción viva bloquea incluso si su titularidad ya está muerta', () => {
  const filas = [
    fila({ tipoUsuario: 'TITULAR', contrato: 'C-1', aprobacion: 'Retractado', aprobacionTitular: 'Retractado' }),
    fila({ tipoUsuario: 'BENEFICIARIO', contrato: 'C-2' }),
  ]
  rechaza(filas, 'C-9', 'ya está inscrito como beneficiario en el contrato C-2')
})
