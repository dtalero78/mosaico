import 'server-only';
import { encryptPDF } from '@pdfsmaller/pdf-encrypt-lite';

/**
 * Cifra un PDF con contraseña de apertura (RC4 de 128 bits). Se permite imprimir
 * pero no modificar ni copiar. El PDF ya viene de Chromium, que no sabe cifrar.
 */
export async function protegerPdf(pdf: Buffer | Uint8Array, clave: string): Promise<Buffer> {
  if (!clave) throw new Error('Falta la clave para proteger el PDF');
  const out = await encryptPDF(new Uint8Array(pdf), clave, {
    // Clave de propietario distinta de la de apertura: la de apertura NO puede
    // levantar los permisos.
    ownerPassword: `${clave}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    allowPrinting: true, allowModifying: false, allowCopying: false, allowAnnotating: false,
  });
  return Buffer.from(out);
}
