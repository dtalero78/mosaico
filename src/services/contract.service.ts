/**
 * Contract Service
 *
 * Business logic for contract extensions and OnHold management.
 */

import 'server-only';
import { PeopleRepository } from '@/repositories/people.repository';
import { ValidationError, NotFoundError } from '@/lib/errors';
import { query } from '@/lib/postgres';

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

  // Reactivar: USUARIOS_ROLES activo = true (por email)
  if (person.email) {
    await query(
      `UPDATE "USUARIOS_ROLES" SET "activo" = true, "_updatedDate" = NOW() WHERE LOWER("email") = LOWER($1)`,
      [person.email]
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
  };

  const updatedHistory = [...currentHistory, onHoldEntry];

  const student = await PeopleRepository.activateOnHold(
    input.studentId,
    input.fechaOnHold,
    input.fechaFinOnHold,
    updatedHistory
  );

  // Sync: block login in USUARIOS_ROLES
  if (person.email) {
    try {
      await query(
        `UPDATE "USUARIOS_ROLES" SET "activo" = false, "_updatedDate" = NOW() WHERE LOWER("email") = LOWER($1)`,
        [person.email]
      );
    } catch (err) {
      console.warn('⚠️ Could not sync USUARIOS_ROLES.activo on OnHold activate for', person.email, err);
    }
  }

  return { student, onHoldEntry };
}

export async function deactivateOnHold(studentId: string) {
  const person = await PeopleRepository.findByIdOrThrow(studentId);

  if (!person.fechaOnHold || !person.fechaFinOnHold) {
    throw new ValidationError('Student is not currently on hold');
  }
  if (!person.finalContrato) {
    throw new ValidationError('Student does not have a contract end date');
  }

  // Calculate paused days
  const fechaOnHold = new Date(person.fechaOnHold);
  const fechaFinOnHold = new Date(person.fechaFinOnHold);
  const daysPaused = Math.ceil(
    (fechaFinOnHold.getTime() - fechaOnHold.getTime()) / (1000 * 60 * 60 * 24)
  );

  // Extend contract automatically
  const currentFinal = new Date(person.finalContrato);
  const newFinal = new Date(currentFinal);
  newFinal.setDate(newFinal.getDate() + daysPaused);

  const today = new Date();
  const newVigencia = Math.ceil(
    (newFinal.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  );

  // NOTA: OnHold y Extensión son procesos independientes con contadores
  // separados. OnHold extiende finalContrato por los días pausados, pero
  // NO toca extensionCount ni extensionHistory (esos son sólo de
  // extensiones manuales). La traza del OnHold ya está en onHoldHistory.
  const student = await PeopleRepository.deactivateOnHold(
    studentId,
    newFinal.toISOString().split('T')[0],
    newVigencia,
  );

  // Sync: reactivar ACADEMICA.estadoInactivo (por numeroId).
  // Sin esto el estudiante puede loguear (USUARIOS_ROLES.activo=true)
  // pero NO puede agendar porque student-booking.service bloquea cuando
  // ACADEMICA.estadoInactivo=true. Bug histórico que generaba muchos
  // estudiantes "puede entrar pero no agendar".
  if (person.numeroId) {
    try {
      await query(
        `UPDATE "ACADEMICA" SET "estadoInactivo" = false, "_updatedDate" = NOW() WHERE "numeroId" = $1`,
        [person.numeroId]
      );
    } catch (err) {
      console.warn('⚠️ Could not sync ACADEMICA.estadoInactivo on OnHold deactivate for', person.numeroId, err);
    }
  }

  // Sync: restore login in USUARIOS_ROLES
  if (person.email) {
    try {
      await query(
        `UPDATE "USUARIOS_ROLES" SET "activo" = true, "_updatedDate" = NOW() WHERE LOWER("email") = LOWER($1)`,
        [person.email]
      );
    } catch (err) {
      console.warn('⚠️ Could not sync USUARIOS_ROLES.activo on OnHold deactivate for', person.email, err);
    }
  }

  return {
    student,
    extension: {
      daysPaused,
      previousFinalContrato: currentFinal.toISOString().split('T')[0],
      newFinalContrato: newFinal.toISOString().split('T')[0],
      newVigencia,
    },
  };
}
