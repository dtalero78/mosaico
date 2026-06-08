/**
 * Libros Interactivos Service
 *
 * Lógica de negocio del visor de libros interactivos (Fase 1):
 *  - Resolver libro + rango aplicable a un nivel.
 *  - Generar presigned URLs de páginas e audios contra DO Spaces.
 *  - Computar metadata del visor (total páginas locales del estudiante,
 *    mapeo de audios traducido al rango).
 *
 * Las páginas viven en Spaces como:
 *   materials/interactive/{codigoLibro}/page-NNN.jpg
 *   materials/interactive/{codigoLibro}/audio/page-NNN.mp3
 *
 * "Página local" = la que ve el estudiante (1..N donde N = totalPaginasNivel).
 * "Página libro" = la que vive físicamente en Spaces (puede ser, por ej., 145
 *                  si BN3 empieza en la página 145 del libro Beginner).
 */

import 'server-only';
import { getPresignedVideoUrl } from '@/lib/spaces';
import {
  LibrosInteractivosRepository,
  NivelLibroBindingRepository,
  LibroAudio,
} from '@/repositories/libros-interactivos.repository';
import { AppConfigRepository } from '@/repositories/config.repository';
import { NotFoundError, ValidationError } from '@/lib/errors';

const FEATURE_FLAG_KEY = 'material_interactivo_v2_activo';

export interface VisorMetadata {
  /** Código del libro físico en Spaces (ej. 'BEGINNER'). */
  libroCodigo: string;
  /** Título legible del libro. */
  libroTitulo: string;
  /** Total de páginas que ve el estudiante (rango del nivel). */
  totalPaginas: number;
  /** Total de páginas del libro completo (informativo). */
  totalPaginasLibro: number;
  /** Mapa página-local → tiene audio? (true/false). */
  paginasConAudio: number[];
}

class LibrosInteractivosServiceClass {
  /** Lee el feature flag global; default false. */
  async isFeatureActive(): Promise<boolean> {
    const row = await AppConfigRepository.get(FEATURE_FLAG_KEY);
    return row?.value === 'true';
  }

  /** Activa/desactiva el feature flag (admin). */
  async setFeatureActive(active: boolean, actor: string): Promise<void> {
    await AppConfigRepository.set(FEATURE_FLAG_KEY, active ? 'true' : 'false', '#ffffff', actor);
  }

  /**
   * Resuelve la metadata que necesita el visor para un nivel dado.
   * Lanza NotFoundError si el nivel no tiene libro asociado o el libro no existe.
   */
  async getMetadataForNivel(nivelCode: string): Promise<VisorMetadata> {
    const binding = await NivelLibroBindingRepository.findByNivelCode(nivelCode);
    if (!binding || !binding.libroInteractivoCode) {
      throw new NotFoundError('LibroInteractivo', `nivel=${nivelCode}`);
    }

    const libro = await LibrosInteractivosRepository.findByCodigo(binding.libroInteractivoCode);
    if (!libro || !libro.activo) {
      throw new NotFoundError('LibroInteractivo', binding.libroInteractivoCode);
    }
    if (!libro.totalPaginas || libro.totalPaginas <= 0) {
      throw new ValidationError('El libro aún no tiene páginas cargadas');
    }

    const inicio = Math.max(1, binding.libroPaginaInicio ?? 1);
    const finRaw = binding.libroPaginaFin ?? libro.totalPaginas;
    const fin = Math.min(libro.totalPaginas, Math.max(inicio, finRaw));
    const totalPaginas = fin - inicio + 1;

    // Mapea audios del libro completo al rango del nivel
    const paginasConAudioLocales = (libro.audios || [])
      .filter(a => a.pagina >= inicio && a.pagina <= fin)
      .map(a => a.pagina - inicio + 1);

    return {
      libroCodigo: libro.codigo,
      libroTitulo: libro.titulo,
      totalPaginas,
      totalPaginasLibro: libro.totalPaginas,
      paginasConAudio: paginasConAudioLocales,
    };
  }

  /**
   * Genera presigned URL de la imagen de una página LOCAL del nivel.
   * Convierte página-local a página-libro usando el rango configurado.
   */
  async getPagePresignedUrl(nivelCode: string, paginaLocal: number): Promise<string> {
    const binding = await NivelLibroBindingRepository.findByNivelCode(nivelCode);
    if (!binding || !binding.libroInteractivoCode) {
      throw new NotFoundError('LibroInteractivo', `nivel=${nivelCode}`);
    }

    const libro = await LibrosInteractivosRepository.findByCodigo(binding.libroInteractivoCode);
    if (!libro || !libro.activo) {
      throw new NotFoundError('LibroInteractivo', binding.libroInteractivoCode);
    }

    const inicio = Math.max(1, binding.libroPaginaInicio ?? 1);
    const fin = Math.min(libro.totalPaginas, binding.libroPaginaFin ?? libro.totalPaginas);
    const totalPaginasNivel = fin - inicio + 1;

    if (!Number.isInteger(paginaLocal) || paginaLocal < 1 || paginaLocal > totalPaginasNivel) {
      throw new ValidationError(`Página ${paginaLocal} fuera de rango (1..${totalPaginasNivel})`);
    }

    const paginaLibro = inicio + paginaLocal - 1;
    const key = `materials/interactive/${libro.codigo}/page-${String(paginaLibro).padStart(3, '0')}.jpg`;
    return getPresignedVideoUrl(key, 600); // 10 min TTL
  }

  /**
   * Genera presigned URL del audio asociado a una página LOCAL (si existe).
   * Devuelve null si esa página no tiene audio.
   */
  async getAudioPresignedUrl(nivelCode: string, paginaLocal: number): Promise<string | null> {
    const binding = await NivelLibroBindingRepository.findByNivelCode(nivelCode);
    if (!binding || !binding.libroInteractivoCode) return null;

    const libro = await LibrosInteractivosRepository.findByCodigo(binding.libroInteractivoCode);
    if (!libro || !libro.activo) return null;

    const inicio = Math.max(1, binding.libroPaginaInicio ?? 1);
    const paginaLibro = inicio + paginaLocal - 1;
    const audio = (libro.audios || []).find(a => a.pagina === paginaLibro);
    if (!audio) return null;

    const key = `materials/interactive/${libro.codigo}/${audio.key}`;
    return getPresignedVideoUrl(key, 600);
  }

  /** Devuelve la lista completa del catálogo (admin). */
  async listAllForAdmin() {
    const [libros, bindings] = await Promise.all([
      LibrosInteractivosRepository.findAll({ includeInactive: true }),
      NivelLibroBindingRepository.findAll(),
    ]);

    // Agrupa bindings por libro
    const bindingsPorLibro = new Map<string, typeof bindings>();
    for (const b of bindings) {
      if (!b.libroInteractivoCode) continue;
      const arr = bindingsPorLibro.get(b.libroInteractivoCode) ?? [];
      arr.push(b);
      bindingsPorLibro.set(b.libroInteractivoCode, arr);
    }

    return libros.map(libro => ({
      ...libro,
      niveles: bindingsPorLibro.get(libro.codigo) ?? [],
    }));
  }
}

export const LibrosInteractivosService = new LibrosInteractivosServiceClass();
