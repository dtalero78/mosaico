import 'server-only';
import { query } from '@/lib/postgres';
import { ids } from '@/lib/id-generator';
import { ValidationError, NotFoundError } from '@/lib/errors';
import { dentroVentanaIngreso, zoomLimites } from '@/lib/zoom-window';

/**
 * Registro del acceso a Zoom del alumno.
 *
 * Sirve para dos cosas distintas:
 *
 *  1. **Trazabilidad** — queda quién pulsó el ícono, a qué clase y a qué hora. Es
 *     la bitácora que después se puede contrastar contra el reporte de asistentes
 *     de Zoom.
 *  2. **Reconexión** — quien generó el acceso dentro de la ventana conserva el
 *     ícono hasta 10 minutos antes de que termine la clase, para volver a entrar
 *     si se le cae la conexión. Es un derecho PERSONAL, así que tiene que vivir en
 *     un dato guardado y no en un cálculo de reloj: quien no alcanzó a entrar no
 *     lo tiene, y a quien sí, un F5 no se lo quita.
 *
 * El alumno sale SIEMPRE de la sesión; el cliente sólo dice a qué clase entra.
 */

export interface ZoomAccesoInput {
  eventoId: string;
  ip?: string | null;
  userAgent?: string | null;
}

export interface ZoomAccesoResult {
  /** Primer acceso del alumno a ESA clase (ISO). Es el que abre la reconexión. */
  accesoEn: string;
  /** Cuántas veces ha entrado, contando ésta. */
  veces: number;
  /** Instante hasta el que le queda activo el ícono (ISO). */
  reconexionHasta: string;
}

/**
 * Registra que el alumno generó el acceso y devuelve hasta cuándo le dura.
 *
 * Valida la ventana en el SERVIDOR: registrar un acceso fuera de plazo crearía el
 * derecho a reconectarse a quien nunca llegó a la clase. Se admite el clic dentro
 * de la reconexión ya abierta (volver a entrar) — eso no extiende nada, sólo suma
 * una fila a la bitácora.
 */
export async function registrarAccesoZoom(
  academicaId: string,
  input: ZoomAccesoInput,
): Promise<ZoomAccesoResult> {
  const eventoId = String(input.eventoId || '').trim();
  if (!eventoId) throw new ValidationError('Falta el evento.');

  // El agendamiento del ALUMNO en ESE evento: si no lo tiene, no es su clase.
  const bk = (await query<any>(
    `SELECT b."_id" AS "bookingId", b."fechaEvento",
            c."tipo", c."nombreEvento", c."cursoCampaignId", c."curso", c."salon",
            a."numeroId",
            TRIM(CONCAT_WS(' ', a."primerNombre", a."primerApellido")) AS nombre
       FROM "ACADEMICA_BOOKINGS" b
       JOIN "CALENDARIO" c ON c."_id" = $2
       LEFT JOIN "ACADEMICA" a ON a."_id" = $1
      WHERE (b."idEstudiante" = $1 OR b."studentId" = $1)
        AND (b."eventoId" = $2 OR b."idEvento" = $2)
        AND b."cancelo" IS NOT TRUE
      LIMIT 1`,
    [academicaId, eventoId],
  )).rows[0];
  if (!bk) throw new NotFoundError('No tienes esta clase agendada.');

  const inicioMs = new Date(bk.fechaEvento).getTime();
  // La duración sale del horario del curso; el tipo es el respaldo.
  const { cierraReconexion } = zoomLimites(inicioMs, bk.tipo, bk.nombreEvento);

  // Sin `::text`: `timestamptz` vuelve como Date y se serializa en ISO. En texto,
  // Postgres lo da como "2026-08-25 20:10:18.42+00", que no es lo mismo y obligaría
  // al navegador a interpretarlo.
  const previo = (await query<{ primero: Date | null; veces: number }>(
    `SELECT MIN("_createdDate") AS primero, COUNT(*)::int AS veces
       FROM "ZOOM_ACCESOS"
      WHERE "academicaId" = $1 AND ("eventoId" = $2 OR "fechaEvento" = $3)`,
    [academicaId, eventoId, bk.fechaEvento],
  )).rows[0];

  const ahora = Date.now();
  const yaTeniaAcceso = !!previo?.primero;
  const puede = dentroVentanaIngreso(inicioMs, ahora)
    || (yaTeniaAcceso && ahora <= cierraReconexion);
  if (!puede) {
    throw new ValidationError(
      ahora < inicioMs
        ? 'Todavía no es hora de esta clase.'
        : 'El plazo para ingresar a esta clase ya venció.',
    );
  }

  await query(
    `INSERT INTO "ZOOM_ACCESOS"
       ("_id","academicaId","numeroId","nombre","bookingId","eventoId","fechaEvento",
        "cursoCampaignId","curso","salon","tipo","minutosDesdeInicio","ip","userAgent")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [ids.audit(), academicaId, bk.numeroId || null, bk.nombre || null,
     bk.bookingId, eventoId, bk.fechaEvento, bk.cursoCampaignId || null,
     bk.curso || null, bk.salon || null, bk.tipo || null,
     Math.round((ahora - inicioMs) / 60_000),
     // `x-forwarded-for` llega encadenado por los proxies y la columna es acotada.
     (input.ip || '').slice(0, 45) || null, (input.userAgent || '').slice(0, 300) || null],
  );

  return {
    accesoEn: (previo?.primero ? new Date(previo.primero) : new Date(ahora)).toISOString(),
    veces: (previo?.veces || 0) + 1,
    reconexionHasta: new Date(cierraReconexion).toISOString(),
  };
}
