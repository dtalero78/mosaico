import { test, expect } from '@playwright/test'
import { parsearDocumentoTributario, normalizarRut, numeroConPrefijo } from '../../src/lib/documento-tributario'

/**
 * Lectura del número de boletas y facturas electrónicas del SII desde el texto
 * del PDF. Los textos son los que devuelve pdf-parse de documentos reales de
 * MOSAICO (octubre 2026).
 */

const BOLETA = '\n\n \n \nMOSAICO CHILE SPA\n77.744.966-4\nGiro: SERVICIOS EDUCACIONALES\nPRINCIPE DE GALES 5921 OF 910 \nLa Reina\nBOLETA EXENTA ELECTRÓNICA NUMERO: \n69.351\nREF. VENDEDOR: 13091370-9\nFecha: 2026-10-09\n \nDatos del receptor:\nSEÑOR(ES): MARIA NAVARRO MUÑOZ\nR.U.T: 12.782.368-5\nEmail: \nnavarromariaconsuelo@yahoo.es\n \nMonto Total\n$ 138.000\n \n \nTimbre Electrónico SII\nRes. 99 de 2014\nVerifique documento en sii.cl'

const FACTURA = '\n\nMOSAICO CHILE SPA\n Giro: SERVICIOS EDUCACIONALES\nPRINCIPE DE GALES 5921 OF 910 910- LA REINA\neMail : sandra_gonza_@hotmail.com Telefono :\nTIPO DE VENTA: DEL GIRO\nSEÑOR(ES):TURISMO SANTIAGO VIP SPA\nR.U.T.:76.745.458- 9\nGIRO:SERVICIOS DE TRANSPORTE DE TRABAJADORES\nDIRECCION:MERCED 838-A 117\nCOMUNASANTIAGOCIUDAD:SANTIAGO\nCONTACTO:MPAGUAYOS@GMAIL.COM\nTIPO DE\nCOMPRA:\nDEL GIRO\nR.U.T.:77.744.966- 4\nFACTURA NO AFECTA O\nEXENTA ELECTRONICA\nNº246\nS.I.I. - NUNOA\nFecha Emision:11 de Octubre del 2026\nCodigoDescripcionCantidadPrecio\n%Impto\nAdic.*\n%Desc.Valor\n-Curso Mosaico Chile1769.000769.000\nForma de Pago:Crédito\nTimbre Electrónico SII\nRes.99 de 2014 Verifique documento: www.sii.cl\nIMPUESTO ADICIONAL$0\nEXENTO$769.000\nTOTAL$769.000\n\nMOSAICO CHILE SPA\n'

test('boleta: número con prefijo B-, monto y RUT del receptor (no el del vendedor)', () => {
  const d = parsearDocumentoTributario(BOLETA)
  expect(d).toEqual({ tipo: 'BOLETA', numero: '69351', numeroFactura: 'B-69351', monto: 138000, rutReceptor: '127823685' })
})

test('factura: número con prefijo F-, total y RUT del receptor (no el de MOSAICO)', () => {
  const d = parsearDocumentoTributario(FACTURA)
  expect(d).toEqual({ tipo: 'FACTURA', numero: '246', numeroFactura: 'F-246', monto: 769000, rutReceptor: '767454589' })
})

test('un documento que no es boleta ni factura no devuelve nada', () => {
  expect(parsearDocumentoTributario('Comprobante de transferencia Banco Estado $ 115.000')).toBeNull()
  expect(parsearDocumentoTributario('')).toBeNull()
})

test('helpers de RUT y prefijo', () => {
  expect(normalizarRut('18.201.897-k')).toBe('18201897K')
  expect(numeroConPrefijo('BOLETA', '69.351')).toBe('B-69351')
})
