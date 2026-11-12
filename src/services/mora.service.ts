import 'server-only';
import { queryMany } from '@/lib/postgres';
import { calcularMora, parseMonto, type MoraCalculo } from '@/lib/mora';
import { asignarPagos } from '@/lib/cuotas-pagos';
import { computePlataformaScope, getSessionPlataforma, buildPlataformaWhereSql } from '@/lib/recaudos-scope';

/**
 * Recaudos › Usuarios en mora.
 *
 * Mismo cálculo que el badge de la pestaña Financiera (src/lib/mora.ts): cuotas
 * COMPLETAS registradas (validadas o no, según src/lib/cuotas-pagos.ts) contra las
 * vencidas por el calendario de FINANCIEROS.
 *
 * A diferencia de LGS, MOSAICO NO bloquea certificados por mora (no emite
 * certificados) ni tiene desbloqueo manual: el informe es sólo de seguimiento.
 * Respeta el alcance por plataforma de Recaudos.
 */

export interface UsuarioEnMora {
  titularId: string;
  titular: string;
  numeroId: string;
  contrato: string;
  plataforma: string | null;
  finalContrato: string | null;
  estadoContrato: 'VIGENTE' | 'ONHOLD' | 'FINALIZADO' | 'INACTIVO';
  celular: string | null;
  email: string | null;
  gestorRecaudo: string | null;
  gestorNombre: string | null;
  /** Cursos de los beneficiarios del contrato (YOJI, OKINA...). */
  cursos: string[];
  mora: MoraCalculo;
  valorCuota: number | null;
  valorAtrasado: number | null;
  /**
   * La fecha del primer corte (FINANCIEROS.fechaPago) es anterior al contrato: casi
   * siempre un error de captura (p. ej. año 2023 en un contrato de 2026) que infla
   * los días de mora. Se avisa en vez de ocultar el contrato.
   */
  corteSospechoso: boolean;
}

const SQL_FIN = `SELECT DISTINCT ON (f."contrato") f."contrato", f."fechaPago", f."numeroCuotas", f."valorCuota", f."saldo", f."pagoInscripcion"
                   FROM "FINANCIEROS" f`;

const SQL_PAGOS = `SELECT "_id","idPeople","numCuota","fechaPago","_createdDate","valorPagado","descuento","inscripcion"
                     FROM "PAGOS_TITULARES"`;

function montoONull(v: unknown): number | null {
  const n = parseMonto(v);
  return isNaN(n) ? null : n;
}

function cuotasCompletas(fin: any, pagos: any[]): number {
  return asignarPagos({
    inscripcion: montoONull(fin.pagoInscripcion) ?? 0,
    valorCuota: montoONull(fin.valorCuota) ?? 0,
    numeroCuotas: parseInt(String(fin.numeroCuotas ?? 0), 10) || 0,
    pagos,
  }).cuotasCompletas;
}

/** Primer corte más de 60 días antes de la firma del contrato = fecha mal digitada. */
function corteAnteriorAlContrato(fechaPago: unknown, fechaContrato: unknown): boolean {
  if (!fechaPago || !fechaContrato) return false;
  const fp = new Date(fechaPago as any).getTime();
  const fc = new Date(fechaContrato as any).getTime();
  if (Number.isNaN(fp) || Number.isNaN(fc)) return false;
  return fp < fc - 60 * 86_400_000;
}

function estadoContrato(r: any): UsuarioEnMora['estadoContrato'] {
  if (String(r.estado || '').toUpperCase() === 'FINALIZADA') return 'FINALIZADO';
  if (r.estadoInactivo === true) return r.fechaOnHold ? 'ONHOLD' : 'INACTIVO';
  return 'VIGENTE';
}

export const moraService = {
  /** Titulares APROBADOS cuyo contrato está EN_MORA (todos los estados del contrato). */
  async listarEnMora(session: { email: string | null; role: string }): Promise<UsuarioEnMora[]> {
    const scope = computePlataformaScope(session.role, await getSessionPlataforma(session.email));
    const sc = buildPlataformaWhereSql(scope, 'p."plataforma"', 1);

    const rows = await queryMany<any>(`
      WITH tit AS (
        SELECT DISTINCT ON (p."contrato") p."_id", p."contrato", p."numeroId", p."plataforma", p."celular", p."email", p."gestorRecaudo",
               p."finalContrato"::text AS "finalContrato", p."fechaContrato"::text AS "fechaContrato", p."estado", p."estadoInactivo", p."fechaOnHold",
               TRIM(REGEXP_REPLACE(CONCAT_WS(' ', p."primerNombre", p."segundoNombre", p."primerApellido", p."segundoApellido"), '\\s+', ' ', 'g')) AS titular
          FROM "PEOPLE" p
         WHERE p."tipoUsuario" = 'TITULAR' AND p."aprobacion" = 'Aprobado'
           AND COALESCE(p."contrato",'') <> '' AND p."contrato" NOT LIKE 'PRB-%'${sc.sql}
         ORDER BY p."contrato", p."_createdDate" DESC
      ), fin AS (
        ${SQL_FIN} WHERE COALESCE(f."contrato",'') <> '' ORDER BY f."contrato", f."_createdDate" DESC
      ), cur AS (
        SELECT x."contrato", array_agg(DISTINCT x."tipoCurso") FILTER (WHERE x."tipoCurso" IS NOT NULL) AS cursos
          FROM "PEOPLE" x JOIN tit ON tit."contrato" = x."contrato"
         WHERE x."tipoUsuario" = 'BENEFICIARIO'
         GROUP BY x."contrato"
      )
      SELECT tit.*, fin."fechaPago", fin."numeroCuotas", fin."valorCuota", fin."saldo", fin."pagoInscripcion",
             COALESCE(cur.cursos, '{}') AS cursos,
             COALESCE(NULLIF(TRIM(u."nombre"), ''), u."email") AS "gestorNombre"
        FROM tit
        JOIN fin ON fin."contrato" = tit."contrato"
        LEFT JOIN cur ON cur."contrato" = tit."contrato"
        LEFT JOIN "USUARIOS_ROLES" u ON u."_id" = tit."gestorRecaudo"`, sc.params);

    // Pagos de todos los titulares del informe en una sola consulta.
    const pagosPorTitular = new Map<string, any[]>();
    const idsTit = rows.map(r => r._id);
    if (idsTit.length) {
      for (const p of await queryMany<any>(`${SQL_PAGOS} WHERE "idPeople" = ANY($1::text[]) AND "penalidadPlanId" IS NULL`, [idsTit])) {
        const arr = pagosPorTitular.get(p.idPeople);
        if (arr) arr.push(p); else pagosPorTitular.set(p.idPeople, [p]);
      }
    }

    const out: UsuarioEnMora[] = [];
    for (const r of rows) {
      const registradas = cuotasCompletas(r, pagosPorTitular.get(r._id) ?? []);
      const mora = calcularMora({ fechaPago: r.fechaPago, numeroCuotas: r.numeroCuotas, cuotasRegistradas: registradas, saldo: r.saldo });
      if (!mora || mora.estado !== 'EN_MORA') continue;
      const valorCuota = montoONull(r.valorCuota);
      out.push({
        titularId: r._id, titular: r.titular, numeroId: r.numeroId, contrato: r.contrato, plataforma: r.plataforma,
        finalContrato: r.finalContrato, estadoContrato: estadoContrato(r), celular: r.celular, email: r.email,
        gestorRecaudo: r.gestorRecaudo || null, gestorNombre: r.gestorRecaudo ? (r.gestorNombre || 'Gestor sin nombre') : null,
        cursos: Array.isArray(r.cursos) ? r.cursos.filter(Boolean) : [],
        mora, valorCuota, valorAtrasado: valorCuota != null ? valorCuota * mora.cuotasAtrasadas : null,
        corteSospechoso: corteAnteriorAlContrato(r.fechaPago, r.fechaContrato),
      });
    }
    return out.sort((a, b) => b.mora.diasMora - a.mora.diasMora);
  },

  /** Beneficiarios de un contrato (fila desplegable del informe). */
  async beneficiarios(contrato: string) {
    return queryMany<any>(
      `SELECT p."_id", p."numeroId", p."tipoCurso", p."campaign", p."salon", p."estadoInactivo", p."fechaOnHold",
              TRIM(REGEXP_REPLACE(CONCAT_WS(' ', p."primerNombre", p."segundoNombre", p."primerApellido", p."segundoApellido"), '\\s+', ' ', 'g')) AS nombre,
              a."_id" AS "academicaId", a."nivel", a."step"
         FROM "PEOPLE" p
         LEFT JOIN LATERAL (SELECT x."_id", x."nivel", x."step" FROM "ACADEMICA" x
                             WHERE x."peopleId" = p."_id" ORDER BY x."_createdDate" DESC LIMIT 1) a ON true
        WHERE p."contrato" = $1 AND p."tipoUsuario" = 'BENEFICIARIO'
        ORDER BY nombre`, [contrato]);
  },
};
