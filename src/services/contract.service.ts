/**
 * Contract Service
 *
 * Business logic for contract extensions and OnHold management.
 */

import 'server-only';
import { PeopleRepository } from '@/repositories/people.repository';
import { ValidationError, NotFoundError } from '@/lib/errors';
import { query, queryMany } from '@/lib/postgres';
import { hoyEnChile } from '@/lib/cursos-campaign';
import { fechaISO, diasEntre, sumarDiasISO, diasAExtenderOnHold } from '@/lib/onhold';
import { isContractExpired } from '@/lib/contract-expiry';
import { ESTADOS_LIBERAN_CUPO } from '@/lib/cupo';

// ── Contract Extension ──

interface ExtendByDaysInput {
  studentId: string;
  diasExtension: number;
  motivo: string;
  ejecutadoPor: string;
  ejecutadoPorEmail: string;
}

export async function extendByDays(input: ExtendByDaysInput) {
  if (!input.diasExtension || input.diasExtension <= 0) {
    throw new ValidationError('diasExtension must be a positive number');
  }
  if (!input.motivo?.trim()) {
    throw new ValidationError('motivo is required');
  }

  const person = await PeopleRepository.findByIdOrThrow(input.studentId);

  if (!person.finalContrato) {
    throw new ValidationError('Student does not have a contract end date (finalContrato)');
  }

  const currentFinal = new Date(person.finalContrato);
  const newFinal = new Date(currentFinal);
  newFinal.setDate(newFinal.getDate() + input.diasExtension);

  const today = new Date();
  const newVigencia = Math.ceil((newFinal.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  const currentHistory = Array.isArray(person.extensionHistory) ? person.extensionHistory : [];
  const extensionEntry = {
    numero: (person.extensionCount || 0) + 1,
    fechaEjecucion: new Date().toISOString(),
    vigenciaAnterior: currentFinal.toISOString().split('T')[0],
    vigenciaNueva: newFinal.toISOString().split('T')[0],
    diasExtendidos: input.diasExtension,
    motivo: input.motivo,
    ejecutadoPor: input.ejecutadoPor,
    ejecutadoPorEmail: input.ejecutadoPorEmail,
  };

  const updatedHistory = [...currentHistory, extensionEntry];

  const student = await PeopleRepository.extendContract(
    input.studentId,
    newFinal.toISOString().split('T')[0],
    newVigencia,
    updatedHistory
  );

  // Reactivar: PEOPLE estadoInactivo = false
  await query(
    `UPDATE "PEOPLE" SET "estadoInactivo" = false, "_updatedDate" = NOW() WHERE "_id" = $1`,
    [input.studentId]
  );

  // Reactivar: ACADEMICA estadoInactivo = false (por numeroId)
  if (person.numeroId) {
    await query(
      `UPDATE "ACADEMICA" SET "estadoInactivo" = false, "_updatedDate" = NOW() WHERE "numeroId" = $1`,
      [person.numeroId]
    );
  }

  // Reactivar el login por IDENTIDAD (userLogin de su ficha o documento), no por
  // correo: los hermanos comparten el del apoderado y se reactivaba también al otro.
  if (person.numeroId) {
    await query(
      `UPDATE "USUARIOS_ROLES" SET "activo" = true, "_updatedDate" = NOW()
        WHERE "rol" = 'ESTUDIANTE'
          AND ("userLogin" IN (SELECT "userLogin" FROM "ACADEMICA" WHERE "numeroId" = $1 AND "userLogin" IS NOT NULL)
               OR UPPER(TRIM("numberid")) = UPPER(TRIM($1)))`,
      [person.numeroId]
    );
  }

  return {
    student,
    extension: {
      vigenciaAnterior: currentFinal.toISOString().split('T')[0],
      vigenciaNueva: newFinal.toISOString().split('T')[0],
      diasExtendidos: input.diasExtension,
      nuevaVigencia: newVigencia,
      motivo: input.motivo,
    },
    extensionEntry,
  };
}

interface ExtendToDateInput {
  studentId: string;
  nuevaFecha: string;
  motivo: string;
  ejecutadoPor: string;
  ejecutadoPorEmail: string;
}

export async function extendToDate(input: ExtendToDateInput) {
  const person = await PeopleRepository.findByIdOrThrow(input.studentId);

  if (!person.finalContrato) {
    throw new ValidationError('Student does not have a contract end date (finalContrato)');
  }
  if (!input.motivo?.trim()) {
    throw new ValidationError('motivo is required');
  }

  const currentFinal = new Date(person.finalContrato);
  const newFinal = new Date(input.nuevaFecha);

  if (newFinal <= currentFinal) {
    throw new ValidationError('nuevaFecha must be after current finalContrato');
  }

  const diasExtendidos = Math.ceil(
    (newFinal.getTime() - currentFinal.getTime()) / (1000 * 60 * 60 * 24)
  );

  return extendByDays({
    studentId: input.studentId,
    diasExtension: diasExtendidos,
    motivo: input.motivo,
    ejecutadoPor: input.ejecutadoPor,
    ejecutadoPorEmail: input.ejecutadoPorEmail,
  });
}

// ── OnHold ──

interface ActivateOnHoldInput {
  studentId: string;
  fechaOnHold: string;
  fechaFinOnHold: string;
  motivo?: string;
  activadoPor: string;
}

export async function activateOnHold(input: ActivateOnHoldInput) {
  if (!input.fechaOnHold || !input.fechaFinOnHold) {
    throw new ValidationError('fechaOnHold and fechaFinOnHold are required');
  }

  const person = await PeopleRepository.findByIdOrThrow(input.studentId);

  // Una pausa sobre otra pausa sumaba un OnHold más al contador sin pausar nada
  // nuevo (le pasó a un alumno el 5-ago: dos activaciones el mismo día le gastaron
  // los 2 OnHold permitidos). Para cambiar las fechas se reactiva y se vuelve a pausar.
  if (person.fechaOnHold) {
    throw new ValidationError('El estudiante ya está en OnHold. Para cambiar las fechas, reactívalo primero.');
  }

  // Reglas de bloqueo de OnHold:
  //  - Máximo 2 OnHolds por contrato.
  //  - No se permite OnHold si el contrato ya tuvo extensión manual
  //    (extensionCount > 0). OnHold y extensión son procesos
  //    independientes con conteos separados — OnHold no cuenta para
  //    extensionCount, sólo para onHoldCount.
  const onHoldCount = Number(person.onHoldCount) || 0;
  const extensionCount = Number(person.extensionCount) || 0;
  if (onHoldCount >= 2) {
    throw new ValidationError('No se puede activar OnHold: el contrato ya alcanzó el máximo de 2 OnHolds');
  }
  if (extensionCount > 0) {
    throw new ValidationError('No se puede activar OnHold: el contrato ya tuvo una extensión manual');
  }

  const currentHistory = Array.isArray(person.onHoldHistory) ? person.onHoldHistory : [];
  const onHoldEntry = {
    fechaActivacion: new Date().toISOString(),
    fechaOnHold: input.fechaOnHold,
    fechaFinOnHold: input.fechaFinOnHold,
    motivo: input.motivo || '',
    activadoPor: input.activadoPor,
    // El curso se SUELTA al entrar en OnHold (abajo), así que se guarda aquí de
    // dónde salió: si no, al volver nadie sabría en qué salón estaba.
    cursoAlPausar: [person.campaign, person.tipoCurso, person.horarioCurso, person.salon]
      .filter(Boolean).join(' · ') || null,
  };

  const updatedHistory = [...currentHistory, onHoldEntry];

  const student = await PeopleRepository.activateOnHold(
    input.studentId,
    input.fechaOnHold,
    input.fechaFinOnHold,
    updatedHistory
  );

  // ── El alumno SUELTA el salón ──
  // En OnHold ya no ocupa cupo (regla de `lib/cupo`), pero además deja de tener
  // curso: al volver se le asigna uno nuevo, porque el suyo habrá avanzado sin él
  // y su asiento lo habrá tomado otro. Sin esto seguiría figurando en el salón —
  // en el Reporte Académico, en la Lista de Usuarios y en la lista de su guía.
  const soltado = await soltarCursoYClases(input.studentId, person.numeroId);

  // Sync: bloquear el login. Por IDENTIDAD, no por email: los hermanos comparten
  // el correo del apoderado y bloquear por correo dejaría fuera también al otro.
  try {
    await query(
      // El userLogin sale de la ficha académica (la del contrato puede no tenerlo).
      // Antes el relleno para "sin usuario" era un carácter NULO, que Postgres
      // rechaza: la consulta entera fallaba y el login nunca se bloqueaba.
      `UPDATE "USUARIOS_ROLES" SET "activo" = false, "_updatedDate" = NOW()
        WHERE "rol" = 'ESTUDIANTE'
          AND ("userLogin" IN (SELECT "userLogin" FROM "ACADEMICA" WHERE "numeroId" = $1 AND "userLogin" IS NOT NULL
                                UNION SELECT $2::text WHERE $2::text <> '')
               OR ($1 <> '' AND UPPER(TRIM("numberid")) = UPPER(TRIM($1))))`,
      [person.numeroId || '', person.userLogin || '']
    );
  } catch (err) {
    console.warn('⚠️ No se pudo bloquear el login en OnHold para', person.numeroId, err);
  }

  return { student, onHoldEntry, ...soltado };
}

/**
 * Suelta el salón del alumno: borra su curso y sus clases FUTURAS.
 *
 * Las clases ya dictadas se conservan — son su historia, y al volver querrá ver
 * lo que alcanzó a cursar. Sólo se sueltan las que aún no ocurrieron, que son las
 * que lo mantendrían en la lista de un guía al que ya no va a asistir.
 *
 * Best-effort: si algo falla, el OnHold ya quedó activo y eso es lo que importa;
 * el resto se puede repasar después.
 */
async function soltarCursoYClases(peopleId: string, numeroId?: string | null) {
  let clasesSoltadas = 0;
  try {
    const ac = await query<{ _id: string }>(
      `SELECT "_id" FROM "ACADEMICA" WHERE "peopleId" = $1
        UNION SELECT "_id" FROM "ACADEMICA" WHERE $2 <> '' AND "numeroId" = $2`,
      [peopleId, numeroId || '']
    );
    const ids = (ac.rows || []).map(r => r._id);
    if (ids.length) {
      const del = await query<{ evid: string }>(
        `DELETE FROM "ACADEMICA_BOOKINGS" b
          USING "CALENDARIO" c
          WHERE (c."_id" = b."eventoId" OR c."_id" = b."idEvento")
            AND c."dia" >= NOW()
            AND (b."idEstudiante" = ANY($1::text[]) OR b."studentId" = ANY($1::text[]))
          RETURNING c."_id" AS evid`,
        [ids]
      );
      clasesSoltadas = del.rowCount ?? 0;
      const evs = Array.from(new Set((del.rows || []).map(r => r.evid).filter(Boolean)));
      if (evs.length) {
        await query(
          `UPDATE "CALENDARIO" SET "inscritos" = GREATEST(0, COALESCE("inscritos",0) - 1), "_updatedDate" = NOW()
            WHERE "_id" = ANY($1::text[])`, [evs]);
      }
      await query(
        `UPDATE "ACADEMICA" SET "campaign" = NULL, "salon" = NULL, "_updatedDate" = NOW()
          WHERE "_id" = ANY($1::text[])`, [ids]);
    }
    await query(
      `UPDATE "PEOPLE" SET "campaign" = NULL, "tipoCurso" = NULL, "horarioCurso" = NULL, "salon" = NULL,
              "_updatedDate" = NOW() WHERE "_id" = $1`, [peopleId]);
  } catch (err) {
    console.warn('⚠️ No se pudo soltar el curso al activar OnHold para', peopleId, err);
  }
  return { clasesSoltadas };
}

export type ModoReactivacionOnHold = 'MANUAL' | 'AUTOMATICO';

/**
 * Saca al alumno del OnHold. Es la ÚNICA definición de "reactivar": la usan el
 * botón de la ficha (MANUAL, se puede adelantar), el cron diario y la carga del
 * panel del alumno (AUTOMATICO, al vencer). Hasta oct-2026 eran tres copias y el
 * cron hacía la mitad: dejaba el login bloqueado, el estado en "On Hold" y
 * contaba la pausa como extensión manual.
 *
 *  - Extiende `finalContrato` por los días REALMENTE pausados (`diasAExtenderOnHold`).
 *  - NO toca extensionCount/extensionHistory: OnHold y extensión son procesos
 *    distintos (una extensión manual impide pausar después). La traza va en la
 *    última entrada de onHoldHistory.
 *  - Reactiva ACADEMICA y el login. El login por IDENTIDAD (userLogin / numberid),
 *    no por correo: los hermanos comparten el del apoderado y se reactivaba también
 *    la cuenta del otro. Si con la extensión el contrato ya estaría vencido, el
 *    login no se abre.
 *  - NO asigna salón: al pausarse el alumno soltó su curso. El botón de la ficha
 *    lo mueve antes de llamar aquí; si vuelve solo, queda en "Reactivados sin salón".
 */
export async function deactivateOnHold(
  studentId: string,
  opts: { modo?: ModoReactivacionOnHold; actor?: string; hoy?: string } = {}
) {
  const person = await PeopleRepository.findByIdOrThrow(studentId);
  const inicio = fechaISO(person.fechaOnHold);
  const fin = fechaISO(person.fechaFinOnHold);
  if (!inicio || !fin) {
    throw new ValidationError('El estudiante no está en OnHold');
  }

  const modo = opts.modo || 'MANUAL';
  const hoy = opts.hoy || hoyEnChile();
  const diasPausados = diasAExtenderOnHold(inicio, fin, hoy);
  const finalAnterior = fechaISO(person.finalContrato);
  const finalNuevo = finalAnterior ? sumarDiasISO(finalAnterior, diasPausados) : null;
  const vigencia = finalNuevo ? diasEntre(hoy, finalNuevo) : null;

  const nota = {
    reactivadoEn: new Date().toISOString(),
    reactivadoPor: opts.actor || null,
    modoReactivacion: modo,
    diasProgramados: Math.max(0, diasEntre(inicio, fin)),
    diasPausados,
    finalContratoAnterior: finalAnterior,
    finalContratoNuevo: finalNuevo,
  };

  const student = await PeopleRepository.deactivateOnHold(studentId, finalNuevo, vigencia, nota);

  // Sync: ACADEMICA. Sin esto puede entrar pero no agendar (la reserva bloquea con
  // ACADEMICA.estadoInactivo=true).
  if (person.numeroId) {
    try {
      await query(
        `UPDATE "ACADEMICA" SET "estadoInactivo" = false, "_updatedDate" = NOW() WHERE "numeroId" = $1`,
        [person.numeroId]
      );
    } catch (err) {
      console.warn('⚠️ No se pudo reactivar ACADEMICA al salir de OnHold:', person.numeroId, err);
    }
  }

  // Sync: login, por IDENTIDAD del alumno.
  let loginReactivado = false;
  if (person.numeroId && !(finalNuevo && isContractExpired(finalNuevo))) {
    try {
      const r = await query(
        `UPDATE "USUARIOS_ROLES" SET "activo" = true, "_updatedDate" = NOW()
          WHERE "rol" = 'ESTUDIANTE'
            AND ("userLogin" IN (SELECT "userLogin" FROM "ACADEMICA" WHERE "numeroId" = $1 AND "userLogin" IS NOT NULL)
                 OR UPPER(TRIM("numberid")) = UPPER(TRIM($1)))`,
        [person.numeroId]
      );
      loginReactivado = (r.rowCount ?? 0) > 0;
    } catch (err) {
      console.warn('⚠️ No se pudo reactivar el login al salir de OnHold:', person.numeroId, err);
    }
  }

  return {
    student,
    loginReactivado,
    extension: {
      daysPaused: diasPausados,
      diasProgramados: nota.diasProgramados,
      previousFinalContrato: finalAnterior,
      newFinalContrato: finalNuevo,
      newVigencia: vigencia,
    },
  };
}

/**
 * Alumnos que salieron del OnHold SIN salón: al pausarse soltaron su curso y la
 * reactivación automática no puede elegir uno nuevo. Se DERIVA (activo, sin
 * curso, con historial de OnHold), así que sale de la lista en cuanto se le
 * asigna salón. Quedan fuera los contratos de prueba, el cupo liberado a mano y
 * los contratos anulados — esos no vuelven a ningún salón.
 */
export async function listarReactivadosSinSalon() {
  return queryMany(
    `SELECT p."_id" AS "peopleId", a."_id" AS "academicaId",
            p."primerNombre", p."primerApellido", p."numeroId", p."contrato",
            COALESCE(p."celular", '') AS "celular",
            COALESCE(p."apoderado", '') AS "apoderado",
            COALESCE(p."apoderadoTelefono", '') AS "apoderadoTelefono",
            p."finalContrato"::text AS "finalContrato",
            p."onHoldHistory" -> -1 ->> 'cursoAlPausar' AS "cursoAlPausar",
            p."onHoldHistory" -> -1 ->> 'fechaOnHold' AS "fechaOnHold",
            p."onHoldHistory" -> -1 ->> 'fechaFinOnHold' AS "fechaFinOnHold",
            p."onHoldHistory" -> -1 ->> 'reactivadoEn' AS "reactivadoEn",
            p."onHoldHistory" -> -1 ->> 'modoReactivacion' AS "modoReactivacion"
       FROM "PEOPLE" p
       JOIN LATERAL (
         SELECT ac."_id" FROM "ACADEMICA" ac WHERE ac."numeroId" = p."numeroId"
          ORDER BY (ac."peopleId" = p."_id") DESC NULLS LAST LIMIT 1
       ) a ON TRUE
      WHERE p."tipoUsuario" IN ('BENEFICIARIO', 'BENEFICIARIA')
        AND p."fechaOnHold" IS NULL
        AND p."estadoInactivo" IS NOT TRUE
        AND (p."campaign" IS NULL OR p."tipoCurso" IS NULL OR p."horarioCurso" IS NULL)
        AND p."cupoLiberado" IS NOT TRUE
        AND jsonb_typeof(p."onHoldHistory") = 'array' AND jsonb_array_length(p."onHoldHistory") > 0
        AND COALESCE(p."contrato", '') NOT LIKE 'PRB-%'
        AND NOT EXISTS (
          SELECT 1 FROM "PEOPLE" t WHERE t."contrato" = p."contrato" AND t."tipoUsuario" = 'TITULAR'
             AND LOWER(TRIM(COALESCE(t."aprobacion", ''))) IN (${ESTADOS_LIBERAN_CUPO.map((e) => `'${e}'`).join(', ')}))
      ORDER BY (p."onHoldHistory" -> -1 ->> 'reactivadoEn') ASC NULLS FIRST, p."primerApellido" ASC`,
    []
  );
}
