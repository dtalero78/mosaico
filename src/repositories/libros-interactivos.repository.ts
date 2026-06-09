/**
 * Libros Interactivos Repository
 *
 * SQL para LIBROS_INTERACTIVOS (catálogo de libros del visor interactivo)
 * y para las columnas de NIVELES que vinculan cada nivel a un libro + rango
 * de páginas (libroInteractivoCode / libroPaginaInicio / libroPaginaFin).
 *
 * Modelo: un libro completo se sube UNA vez a Spaces (carpeta
 * materials/interactive/{codigo}/). Los sub-niveles (BN1/BN2/BN3 → libro
 * BEGINNER) son rangos sobre el mismo libro — cuando se actualiza el libro
 * padre, los sub-niveles quedan actualizados sin tocar nada más.
 */

import 'server-only';
import { query, queryOne, queryMany } from '@/lib/postgres';
import { BaseRepository } from './base.repository';

const LIBROS_JSONB = ['audios'];

export interface LibroAudio {
  pagina: number;       // página del LIBRO completo (1-indexed)
  key: string;          // ruta relativa: "audio/page-012.mp3"
  titulo?: string | null;
}

export interface LibroInteractivoRow {
  codigo: string;
  titulo: string;
  totalPaginas: number;
  audios: LibroAudio[];
  activo: boolean;
  _createdDate: Date;
  _updatedDate: Date;
}

export interface NivelLibroBinding {
  code: string;                          // NIVELES.code (ej. 'BN1')
  libroInteractivoCode: string | null;   // FK a LIBROS_INTERACTIVOS.codigo
  libroPaginaInicio: number | null;
  libroPaginaFin: number | null;
}

class LibrosInteractivosRepositoryClass extends BaseRepository<LibroInteractivoRow> {
  constructor() {
    super('LIBROS_INTERACTIVOS', LIBROS_JSONB);
  }

  async findAll(opts?: { includeInactive?: boolean }): Promise<LibroInteractivoRow[]> {
    const where = opts?.includeInactive ? '' : 'WHERE "activo" = true';
    // Orden pedagógico canónico del programa LGS (no alfabético).
    // Libros desconocidos van al final.
    const rows = await queryMany<LibroInteractivoRow>(
      `SELECT "codigo", "titulo", "totalPaginas", "audios", "activo",
              "_createdDate", "_updatedDate"
         FROM "LIBROS_INTERACTIVOS"
         ${where}
        ORDER BY
          CASE "codigo"
            WHEN 'ESS'        THEN 1
            WHEN 'BEGINNER'   THEN 2
            WHEN 'PRACTICAL'  THEN 3
            WHEN 'FUNCTIONAL' THEN 4
            WHEN 'IELTS'      THEN 5
            WHEN 'B2FIRST'    THEN 6
            WHEN 'TOEFL'      THEN 7
            ELSE 99
          END ASC,
          "codigo" ASC`
    );
    return this.parseMany(rows);
  }

  async findByCodigo(codigo: string): Promise<LibroInteractivoRow | null> {
    const row = await queryOne<LibroInteractivoRow>(
      `SELECT "codigo", "titulo", "totalPaginas", "audios", "activo",
              "_createdDate", "_updatedDate"
         FROM "LIBROS_INTERACTIVOS"
        WHERE "codigo" = $1`,
      [codigo]
    );
    return this.parse(row);
  }

  /** Crea o actualiza un libro (usado por el script de subida). */
  async upsert(input: {
    codigo: string;
    titulo: string;
    totalPaginas: number;
  }): Promise<LibroInteractivoRow | null> {
    const row = await queryOne<LibroInteractivoRow>(
      `INSERT INTO "LIBROS_INTERACTIVOS" ("codigo", "titulo", "totalPaginas")
            VALUES ($1, $2, $3)
       ON CONFLICT ("codigo") DO UPDATE SET
         "titulo"       = EXCLUDED."titulo",
         "totalPaginas" = EXCLUDED."totalPaginas",
         "_updatedDate" = NOW()
       RETURNING *`,
      [input.codigo, input.titulo, input.totalPaginas]
    );
    return this.parse(row);
  }

  /** Actualiza solo el total de páginas (script de re-conversión). */
  async setTotalPaginas(codigo: string, totalPaginas: number): Promise<void> {
    await query(
      `UPDATE "LIBROS_INTERACTIVOS"
          SET "totalPaginas" = $1, "_updatedDate" = NOW()
        WHERE "codigo" = $2`,
      [totalPaginas, codigo]
    );
  }

  async setTitulo(codigo: string, titulo: string): Promise<void> {
    await query(
      `UPDATE "LIBROS_INTERACTIVOS"
          SET "titulo" = $1, "_updatedDate" = NOW()
        WHERE "codigo" = $2`,
      [titulo, codigo]
    );
  }

  async setActivo(codigo: string, activo: boolean): Promise<void> {
    await query(
      `UPDATE "LIBROS_INTERACTIVOS"
          SET "activo" = $1, "_updatedDate" = NOW()
        WHERE "codigo" = $2`,
      [activo, codigo]
    );
  }

  /**
   * Reemplaza COMPLETAMENTE el array de audios del libro.
   * Cada entry: {pagina, key, titulo?}. La página es del LIBRO completo (no del rango).
   */
  async replaceAudios(codigo: string, audios: LibroAudio[]): Promise<void> {
    await query(
      `UPDATE "LIBROS_INTERACTIVOS"
          SET "audios" = $1::jsonb, "_updatedDate" = NOW()
        WHERE "codigo" = $2`,
      [JSON.stringify(audios), codigo]
    );
  }

  /**
   * Agrega un audio. Permite MÚLTIPLES audios en la misma página.
   * La unicidad se controla por `key` (la ruta dentro del libro):
   * si ya hay otro audio con la misma key se reemplaza (idempotente),
   * de lo contrario se agrega a la lista.
   * Orden final: por página ASC, después por título ASC.
   */
  async addAudio(codigo: string, audio: LibroAudio): Promise<void> {
    const libro = await this.findByCodigo(codigo);
    if (!libro) return;
    const existing = (libro.audios || []).filter(a => a.key !== audio.key);
    existing.push(audio);
    existing.sort((a, b) => {
      if (a.pagina !== b.pagina) return a.pagina - b.pagina;
      return (a.titulo || '').localeCompare(b.titulo || '');
    });
    await this.replaceAudios(codigo, existing);
  }

  /** Elimina UN audio específico por su key (no por página). */
  async removeAudio(codigo: string, key: string): Promise<void> {
    const libro = await this.findByCodigo(codigo);
    if (!libro) return;
    const filtered = (libro.audios || []).filter(a => a.key !== key);
    await this.replaceAudios(codigo, filtered);
  }

  /**
   * Actualiza solo el título de un audio existente, identificándolo por su key.
   * Sin tocar Spaces — el archivo MP3 mantiene la misma ruta. Útil para
   * titular audios viejos sin tener que re-subirlos.
   * Si la key no existe, no hace nada.
   * `titulo` puede ser null/'' para limpiar el título (volverá a mostrarse
   * como "Audio N" en el visor).
   */
  async updateAudioTitulo(codigo: string, key: string, titulo: string | null): Promise<boolean> {
    const libro = await this.findByCodigo(codigo);
    if (!libro) return false;
    const cleanTitulo = titulo ? String(titulo).trim() : null;
    const next = (libro.audios || []).map(a =>
      a.key === key ? { ...a, titulo: cleanTitulo || null } : a
    );
    // Verifica que la key realmente existía
    const existed = (libro.audios || []).some(a => a.key === key);
    if (!existed) return false;
    // Re-ordena por pagina y título
    next.sort((a, b) => {
      if (a.pagina !== b.pagina) return a.pagina - b.pagina;
      return (a.titulo || '').localeCompare(b.titulo || '');
    });
    await this.replaceAudios(codigo, next);
    return true;
  }
}

/**
 * Lecturas y escrituras sobre las 3 columnas que NIVELES adquirió para el binding
 * con libros interactivos. No extiende BaseRepository porque opera por code (no _id).
 */
class NivelLibroBindingRepositoryClass {
  /** Devuelve el binding del nivel (puede traer libroInteractivoCode=NULL si no se configuró). */
  async findByNivelCode(code: string): Promise<NivelLibroBinding | null> {
    return queryOne<NivelLibroBinding>(
      `SELECT DISTINCT "code", "libroInteractivoCode", "libroPaginaInicio", "libroPaginaFin"
         FROM "NIVELES"
        WHERE "code" = $1
        LIMIT 1`,
      [code]
    );
  }

  /**
   * 1 query JOIN: binding del nivel + libro (si existe).
   * Reemplaza 2 queries separadas (findByNivelCode + findByCodigo) por 1.
   * Devuelve null si el nivel no existe o no tiene libro configurado.
   */
  async findNivelWithLibro(code: string): Promise<{
    nivelCode: string;
    libroPaginaInicio: number | null;
    libroPaginaFin: number | null;
    libro: LibroInteractivoRow | null;
  } | null> {
    const row = await queryOne<any>(
      `SELECT n."code"                 AS "nivelCode",
              n."libroPaginaInicio",
              n."libroPaginaFin",
              l."codigo"               AS "libroCodigo",
              l."titulo"               AS "libroTitulo",
              l."totalPaginas"         AS "libroTotalPaginas",
              l."audios"               AS "libroAudios",
              l."activo"               AS "libroActivo"
         FROM "NIVELES" n
         LEFT JOIN "LIBROS_INTERACTIVOS" l ON l."codigo" = n."libroInteractivoCode"
        WHERE n."code" = $1
        LIMIT 1`,
      [code]
    );
    if (!row) return null;
    const libro: LibroInteractivoRow | null = row.libroCodigo
      ? {
          codigo: row.libroCodigo,
          titulo: row.libroTitulo,
          totalPaginas: row.libroTotalPaginas,
          audios: typeof row.libroAudios === 'string' ? JSON.parse(row.libroAudios) : (row.libroAudios || []),
          activo: row.libroActivo,
          _createdDate: row._createdDate,
          _updatedDate: row._updatedDate,
        }
      : null;
    return {
      nivelCode: row.nivelCode,
      libroPaginaInicio: row.libroPaginaInicio,
      libroPaginaFin: row.libroPaginaFin,
      libro,
    };
  }

  /**
   * Lista TODOS los bindings (para el panel admin).
   *
   * NIVELES tiene una fila por (code, step) — varias por nivel. Como las 3
   * columnas de binding viven a nivel de code (no step), agrupamos por code.
   * Usamos MIN(orden) para ordenar pedagógicamente sin meter "orden" en el
   * GROUP BY (que multiplicaría filas si distintos steps del mismo code
   * tuvieran orden distinto).
   */
  async findAll(): Promise<NivelLibroBinding[]> {
    return queryMany<NivelLibroBinding>(
      `SELECT "code",
              MAX("libroInteractivoCode") AS "libroInteractivoCode",
              MAX("libroPaginaInicio")    AS "libroPaginaInicio",
              MAX("libroPaginaFin")       AS "libroPaginaFin"
         FROM "NIVELES"
        GROUP BY "code"
        ORDER BY MIN("orden") ASC NULLS LAST, "code" ASC`
    );
  }

  /** Lista los niveles que apuntan a un libro específico. */
  async findByLibroCodigo(libroCodigo: string): Promise<NivelLibroBinding[]> {
    return queryMany<NivelLibroBinding>(
      `SELECT "code",
              MAX("libroInteractivoCode") AS "libroInteractivoCode",
              MAX("libroPaginaInicio")    AS "libroPaginaInicio",
              MAX("libroPaginaFin")       AS "libroPaginaFin"
         FROM "NIVELES"
        WHERE "libroInteractivoCode" = $1
        GROUP BY "code"
        ORDER BY "code" ASC`,
      [libroCodigo]
    );
  }

  /**
   * Setea/actualiza el binding de un nivel.
   * Afecta TODAS las filas de NIVELES con ese code (un nivel puede tener varias filas, una por step).
   */
  async setBinding(input: {
    code: string;
    libroInteractivoCode: string | null;
    libroPaginaInicio: number | null;
    libroPaginaFin: number | null;
  }): Promise<number> {
    const r = await query(
      `UPDATE "NIVELES"
          SET "libroInteractivoCode" = $1,
              "libroPaginaInicio"    = $2,
              "libroPaginaFin"       = $3,
              "_updatedDate"         = NOW()
        WHERE "code" = $4`,
      [input.libroInteractivoCode, input.libroPaginaInicio, input.libroPaginaFin, input.code]
    );
    return r.rowCount ?? 0;
  }
}

export const LibrosInteractivosRepository = new LibrosInteractivosRepositoryClass();
export const NivelLibroBindingRepository = new NivelLibroBindingRepositoryClass();
