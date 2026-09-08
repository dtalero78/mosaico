/**
 * Contratos de PRUEBA (prefijo `PRB-`): la regla y la marca de agua.
 *
 * Un contrato de prueba se crea desde el wizard con la casilla marcada y lleva
 * su propio consecutivo (`PRB-M5-NNNNN-YY`), aparte del real. Desde sep-2026 SÍ
 * se le puede solicitar firma, enviar el PDF e imprimirlo —antes los tres
 * botones estaban bloqueados—, a cambio de que todo lo que salga de él vaya
 * marcado como lo que es.
 *
 * Este archivo NO lleva `server-only`: la marca tiene que salir en los TRES
 * sitios por donde el contrato llega a una persona, y dos de ellos son cliente:
 *   1. el PDF            (contract-pdf.ts, servidor)
 *   2. la ventana de Imprimir  (modal del comercial, cliente)
 *   3. la página pública que abre el titular al "Solicitar firma" (cliente)
 * Marcar sólo el PDF dejaba los otros dos con apariencia de contrato real.
 */

/** Texto de la marca, partido en dos líneas para que quepa en diagonal. */
export const MARCA_PRUEBA_L1 = 'CONTRATO DE PRUEBA';
export const MARCA_PRUEBA_L2 = 'SIN VALIDEZ LEGAL';
export const MARCA_PRUEBA = `${MARCA_PRUEBA_L1} ${MARCA_PRUEBA_L2}`;

export function isContratoPrueba(contrato?: string | null): boolean {
  return typeof contrato === 'string' && /^PRB-/i.test(contrato);
}

/**
 * La marca como imagen SVG repetible (data URI, listo para `background-image`).
 *
 * Es un MOSAICO que se repite y no un solo texto centrado a propósito: el
 * contrato tiene varias páginas y en la web scrollea, así que una marca única
 * al centro se pierde en cuanto el lector baja. Repetida, cubre el documento
 * completo sin importar su largo ni cuántas páginas tenga el PDF.
 *
 * Va en SVG y no en un <div> rotado porque así el mismo valor sirve igual para
 * Chrome imprimiendo el PDF y para el navegador mostrando la página.
 */
export function marcaPruebaDataUri(): string {
  const svg =
    `%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27560%27 height=%27330%27%3E` +
    `%3Cg transform=%27rotate(-30 280 165)%27 fill=%27rgba(190,18,60,0.16)%27 ` +
    `font-family=%27Georgia,Times New Roman,serif%27 font-size=%2725%27 font-weight=%27bold%27 text-anchor=%27middle%27%3E` +
    `%3Ctext x=%27280%27 y=%27157%27 textLength=%27330%27 lengthAdjust=%27spacing%27%3E${MARCA_PRUEBA_L1}%3C/text%3E` +
    `%3Ctext x=%27280%27 y=%27191%27 textLength=%27330%27 lengthAdjust=%27spacing%27%3E${MARCA_PRUEBA_L2}%3C/text%3E` +
    `%3C/g%3E%3C/svg%3E`;
  return `data:image/svg+xml,${svg}`;
}

/**
 * CSS + HTML de la capa de marca, para los dos consumidores que arman un
 * documento HTML completo: el PDF y la ventana de Imprimir.
 *
 * Usa `position: fixed` porque es lo que hace que Chrome repita la capa en
 * CADA página al imprimir; con el background sobre el <body> sólo se pinta la
 * primera. `print-color-adjust: exact` evita que Chrome lave el color al
 * imprimir, y `printBackground: true` (ya en buildContractPdfOptions) es lo que
 * permite que se dibuje.
 */
export function marcaPruebaCss(): string {
  return `
    .marca-prueba {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background-image: url("${marcaPruebaDataUri()}");
      background-repeat: repeat;
      pointer-events: none;
      z-index: 9999;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }`;
}

export function marcaPruebaHtml(): string {
  return `<div class="marca-prueba" aria-hidden="true"></div>`;
}
