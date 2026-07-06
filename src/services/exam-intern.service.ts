/**
 * Exam Internacional Service
 *
 * Handles the "Aplicar Confirmación" flow for IELTS / B2 First / TOEFL pages:
 *   - CONFIRMADOS: extend contract by 100 days from a user-provided base date,
 *     restore login, keep the student in their special Step (47/48/49), and
 *     send a WhatsApp message.
 *   - NO CONFIRMADOS: promote to DONE Step 50 and block the account (reuses
 *     promoteToDoneAndBlock from special-nivel.service).
 *
 * Every processed student generates an audit row in EXAM_INTERN_AUDIT, with
 * the WhatsApp delivery status when applicable.
 *
 * The audit table is created on first use (CREATE TABLE IF NOT EXISTS) so the
 * service is idempotent and self-installing — no separate migration needed.
 */

import 'server-only';
import { query, queryOne } from '@/lib/postgres';
import { ids } from '@/lib/id-generator';
import { ValidationError } from '@/lib/errors';
import { sendWhatsAppMessage, formatPhoneNumber } from '@/lib/whatsapp';
import { promoteToDoneAndBlock } from '@/services/special-nivel.service';

export type ExamPrueba = 'IELTS' | 'B2FIRST' | 'TOEFL';

const PRUEBA_TO_STEP: Record<ExamPrueba, string> = {
  IELTS:   'Step 47',
  B2FIRST: 'Step 48',
  TOEFL:   'Step 49',
};

const PRUEBA_DISPLAY_NAME: Record<ExamPrueba, string> = {
  IELTS:   'IELTS',
  B2FIRST: 'B2 First',
  TOEFL:   'TOEFL',
};

/** Days added to fechaBase to compute the new finalContrato for confirmed students. */
const EXTENSION_DAYS = 100;

// ─────────────────────────────────────────────────────────────────────────────
// One-time table creation (idempotent)
// ─────────────────────────────────────────────────────────────────────────────

let auditTableEnsured = false;
async function ensureAuditTable() {
  if (auditTableEnsured) return;
  try {
    await query(
      `CREATE TABLE IF NOT EXISTS "EXAM_INTERN_AUDIT" (
        "_id"                TEXT PRIMARY KEY,
        "studentId"          TEXT NOT NULL,
        "numeroId"           TEXT,
        "primerNombre"       TEXT,
        "primerApellido"     TEXT,
        "email"              TEXT,
        "celular"            TEXT,
        "prueba"             TEXT NOT NULL,
        "accion"             TEXT NOT NULL,
        "fechaBase"          DATE,
        "nuevoFinalContrato" DATE,
        "vigenciaAnterior"   DATE,
        "whatsappEnviado"    BOOLEAN DEFAULT false,
        "whatsappError"      TEXT,
        "ejecutadoPor"       TEXT,
        "_createdDate"       TIMESTAMPTZ DEFAULT NOW()
      )`,
      []
    );
    auditTableEnsured = true;
  } catch (err: any) {
    console.error('⚠️ [exam-intern] No se pudo crear EXAM_INTERN_AUDIT:', err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

interface ExamInternStudent {
  _id: string;                // ACADEMICA._id
  numeroId: string | null;
  primerNombre: string | null;
  primerApellido: string | null;
  email: string | null;
  celular: string | null;
  plataforma: string | null;
}

async function loadStudent(academicaId: string): Promise<ExamInternStudent | null> {
  return queryOne<ExamInternStudent>(
    `SELECT "_id", "numeroId", "primerNombre", "primerApellido",
            "email", "celular", "plataforma"
     FROM "ACADEMICA"
     WHERE "_id" = $1`,
    [academicaId]
  ).catch(() => null);
}

function formatBogotaDate(d: Date | string): string {
  return new Date(d).toLocaleDateString('es-CO', {
    day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

/**
 * Build the WhatsApp message sent to CONFIRMED students.
 * Sample:
 *   "Francisca, te felicitamos. Estás inscrita en la preparación para el
 *    examen IELTS. Tus sesiones comienzan el 15 de mayo de 2026. Te esperamos.
 *    Gracias por confiar en MOSAICO."
 */
function buildConfirmadoMessage(
  primerNombre: string | null,
  prueba: ExamPrueba,
  fechaBase: string
): string {
  const nombre = (primerNombre || '').trim() || 'Estudiante';
  const examen = PRUEBA_DISPLAY_NAME[prueba];
  const fecha  = formatBogotaDate(fechaBase);
  return (
    `${nombre}, te felicitamos. Estás inscrito en la preparación para el examen ${examen}. ` +
    `Tus sesiones comienzan el ${fecha}. Te esperamos. ` +
    `Gracias por confiar en MOSAICO.`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Apply Confirmación flow
// ─────────────────────────────────────────────────────────────────────────────

export interface AplicarConfirmacionParams {
  prueba: ExamPrueba;
  fechaBase: string;             // YYYY-MM-DD
  confirmados: string[];         // ACADEMICA._id list
  noConfirmados: string[];       // ACADEMICA._id list
  ejecutadoPor: string;          // admin email
}

export interface AplicarConfirmacionResult {
  extendidos: number;
  bloqueados: number;
  whatsappEnviados: number;
  whatsappFallidos: number;
  errores: Array<{ studentId: string; error: string }>;
}

export async function aplicarConfirmacion(
  params: AplicarConfirmacionParams
): Promise<AplicarConfirmacionResult> {
  const { prueba, fechaBase, confirmados, noConfirmados, ejecutadoPor } = params;

  // Validaciones de entrada
  if (!PRUEBA_TO_STEP[prueba]) {
    throw new ValidationError(`Prueba inválida: ${prueba}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaBase)) {
    throw new ValidationError(`fechaBase inválida (esperado YYYY-MM-DD): ${fechaBase}`);
  }
  if (confirmados.length === 0 && noConfirmados.length === 0) {
    throw new ValidationError('No se enviaron estudiantes para procesar');
  }

  await ensureAuditTable();

  const targetStep = PRUEBA_TO_STEP[prueba];
  const result: AplicarConfirmacionResult = {
    extendidos: 0,
    bloqueados: 0,
    whatsappEnviados: 0,
    whatsappFallidos: 0,
    errores: [],
  };

  const whatsappMessageFor = (nombre: string | null) =>
    buildConfirmadoMessage(nombre, prueba, fechaBase);

  // ── CONFIRMADOS: extender contrato + reactivar + Step especial + WhatsApp ──
  for (const studentId of confirmados) {
    try {
      const student = await loadStudent(studentId);
      if (!student) {
        result.errores.push({ studentId, error: 'ACADEMICA._id no encontrado' });
        continue;
      }

      // Buscar PEOPLE (prefiere BENEFICIARIO) para leer estado de contrato actual
      const peopleRow = student.numeroId
        ? await queryOne<{
            _id: string;
            finalContrato: string | null;
            extensionCount: number | null;
            extensionHistory: any;
          }>(
            `SELECT "_id", "finalContrato", "extensionCount", "extensionHistory"
             FROM "PEOPLE"
             WHERE "numeroId" = $1
             ORDER BY CASE WHEN "tipoUsuario" IN ('BENEFICIARIO','BENEFICIARIA') THEN 0 ELSE 1 END
             LIMIT 1`,
            [student.numeroId]
          ).catch(() => null)
        : null;

      // Nueva fecha final = fechaBase + 100 días (DATE puro)
      const nuevoFinal = await queryOne<{ d: string }>(
        `SELECT ($1::date + INTERVAL '${EXTENSION_DAYS} days')::date::text AS d`,
        [fechaBase]
      );
      const nuevoFinalContrato = nuevoFinal?.d || null;

      const vigenciaAnterior = peopleRow?.finalContrato || null;
      const currentExtHistory = Array.isArray(peopleRow?.extensionHistory)
        ? peopleRow!.extensionHistory
        : [];
      const newExtNumber = ((peopleRow?.extensionCount as number) || 0) + 1;
      const updatedExtHistory = [
        ...currentExtHistory,
        {
          numero: newExtNumber,
          fechaEjecucion: new Date().toISOString(),
          vigenciaAnterior,
          vigenciaNueva: nuevoFinalContrato,
          diasExtendidos: EXTENSION_DAYS,
          motivo: `Confirmación ${PRUEBA_DISPLAY_NAME[prueba]} — extensión ${EXTENSION_DAYS} días desde ${fechaBase}`,
          ejecutadoPor,
        },
      ];

      // PEOPLE: actualiza contrato + nivel/step + estado
      if (peopleRow?._id) {
        await query(
          `UPDATE "PEOPLE"
           SET "finalContrato"    = $1::date,
               "vigencia"         = ($1::date - CURRENT_DATE)::text,
               "extensionCount"   = $2,
               "extensionHistory" = $3::jsonb,
               "estadoInactivo"   = false,
               "aprobacion"       = 'APROBADA',
               "nivel"            = $4,
               "step"             = $5,
               "_updatedDate"     = NOW()
           WHERE "_id" = $6`,
          [
            nuevoFinalContrato,
            newExtNumber,
            JSON.stringify(updatedExtHistory),
            prueba,
            targetStep,
            peopleRow._id,
          ]
        );
      }

      // ACADEMICA: nivel/step + estado activo
      await query(
        `UPDATE "ACADEMICA"
         SET "nivel"          = $1,
             "step"           = $2,
             "estadoInactivo" = false,
             "_updatedDate"   = NOW()
         WHERE "_id" = $3`,
        [prueba, targetStep, studentId]
      );

      // USUARIOS_ROLES: restaura login
      if (student.email) {
        await query(
          `UPDATE "USUARIOS_ROLES"
           SET "activo" = true, "_updatedDate" = NOW()
           WHERE LOWER("email") = LOWER($1)`,
          [student.email]
        ).catch(err =>
          console.warn('[exam-intern] USUARIOS_ROLES update failed:', err.message)
        );
      }

      result.extendidos += 1;

      // WhatsApp (best-effort)
      let whatsappOk = false;
      let whatsappErr: string | null = null;
      if (student.celular) {
        try {
          const phone = formatPhoneNumber(student.celular);
          await sendWhatsAppMessage(phone, whatsappMessageFor(student.primerNombre));
          whatsappOk = true;
          result.whatsappEnviados += 1;
        } catch (err: any) {
          whatsappErr = err?.message || 'Error desconocido al enviar WhatsApp';
          result.whatsappFallidos += 1;
          console.warn(`[exam-intern] WhatsApp falló para ${student.numeroId}:`, whatsappErr);
        }
      } else {
        whatsappErr = 'Estudiante sin celular registrado';
        result.whatsappFallidos += 1;
      }

      // Auditoría
      await query(
        `INSERT INTO "EXAM_INTERN_AUDIT" (
          "_id", "studentId", "numeroId", "primerNombre", "primerApellido",
          "email", "celular", "prueba", "accion",
          "fechaBase", "nuevoFinalContrato", "vigenciaAnterior",
          "whatsappEnviado", "whatsappError", "ejecutadoPor"
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'EXTENDIDO',$9::date,$10::date,$11::date,$12,$13,$14)`,
        [
          ids.audit(),
          studentId,
          student.numeroId,
          student.primerNombre,
          student.primerApellido,
          student.email,
          student.celular,
          prueba,
          fechaBase,
          nuevoFinalContrato,
          vigenciaAnterior,
          whatsappOk,
          whatsappErr,
          ejecutadoPor,
        ]
      ).catch(err => console.warn('[exam-intern] Audit insert failed:', err.message));
    } catch (err: any) {
      result.errores.push({ studentId, error: err?.message || 'Error desconocido' });
    }
  }

  // ── NO CONFIRMADOS: promover a DONE Step 50 + bloquear (sin WhatsApp) ──
  for (const studentId of noConfirmados) {
    try {
      const student = await loadStudent(studentId);
      if (!student) {
        result.errores.push({ studentId, error: 'ACADEMICA._id no encontrado' });
        continue;
      }

      await promoteToDoneAndBlock(
        {
          _id: studentId,
          numeroId: student.numeroId,
          email: student.email,
          nivel: prueba,
          step: targetStep,
        },
        `No confirmado en proceso Exam. Intern. ${PRUEBA_DISPLAY_NAME[prueba]} (${fechaBase})`
      );

      result.bloqueados += 1;

      // Auditoría
      await query(
        `INSERT INTO "EXAM_INTERN_AUDIT" (
          "_id", "studentId", "numeroId", "primerNombre", "primerApellido",
          "email", "celular", "prueba", "accion",
          "fechaBase", "ejecutadoPor"
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'BLOQUEADO',$9::date,$10)`,
        [
          ids.audit(),
          studentId,
          student.numeroId,
          student.primerNombre,
          student.primerApellido,
          student.email,
          student.celular,
          prueba,
          fechaBase,
          ejecutadoPor,
        ]
      ).catch(err => console.warn('[exam-intern] Audit insert failed:', err.message));
    } catch (err: any) {
      result.errores.push({ studentId, error: err?.message || 'Error desconocido' });
    }
  }

  return result;
}
