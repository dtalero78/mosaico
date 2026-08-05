/**
 * Utilidades para incrustar/visualizar archivos de Google Drive. Cliente + servidor.
 *
 * El material del guía (NIVELES.material) se guarda como [{name, url}]. Un "material"
 * puede ser un archivo en DO Spaces (key `materials/...`) o un ENLACE de Google Drive
 * (URL `https://drive.google.com/...` o `https://docs.google.com/...`). Estas funciones
 * detectan los enlaces de Drive y los convierten a su URL de vista previa incrustable
 * (`/preview`), que se puede mostrar en un iframe sin descargar.
 *
 * Requisito: el archivo/carpeta en Drive debe estar compartido como
 * "Cualquiera con el enlace: Lector" para que cargue en la plataforma.
 */

/** ¿La URL apunta a Google Drive / Google Docs? */
export function isDriveUrl(url: string | null | undefined): boolean {
  return /^https?:\/\/(?:[a-z0-9-]+\.)*(?:drive|docs)\.google\.com\//i.test(String(url || ''));
}

/**
 * Convierte una URL de Drive/Docs a su versión incrustable (`/preview`).
 * Soporta: drive.google.com/file/d/ID, open?id=ID, ?id=ID, /d/ID;
 * y docs.google.com/{presentation|document|spreadsheets}/d/ID.
 * Devuelve null si no reconoce el formato.
 */
export function driveEmbedUrl(url: string | null | undefined): string | null {
  const u = String(url || '');
  if (!u) return null;

  // Google Slides / Docs / Sheets → /preview del mismo tipo de documento
  const docs = u.match(/docs\.google\.com\/(presentation|document|spreadsheets)\/d\/([a-zA-Z0-9_-]+)/);
  if (docs) return `https://docs.google.com/${docs[1]}/d/${docs[2]}/preview`;

  // Google Drive file → /file/d/ID/preview
  const m =
    u.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) ||
    u.match(/[?&]id=([a-zA-Z0-9_-]+)/) ||
    u.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return `https://drive.google.com/file/d/${m[1]}/preview`;

  return null;
}
