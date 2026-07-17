import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { query, queryOne, queryMany } from '@/lib/postgres';
import { NotFoundError, ValidationError, ConflictError } from '@/lib/errors';
import { generateId } from '@/lib/id-generator';
import { requirePermission } from '@/lib/api-permissions';
import { AprobacionPermission } from '@/types/permissions';
import { autoApproveConsent } from '@/services/consent.service';
import { approveContract } from '@/services/approval.service';
import { promoteFromWelcome } from '@/services/student.service';

/**
 * POST /api/postgres/approvals/[id]/autoaprobar   ([id] = titular PEOPLE._id)
 *
 * "Autoaprobar" del centro de aprobación. Gateado por APROBACION.MODIFICAR.AUTOAPROBAR
 * (SUPER_ADMIN/ADMIN bypass). Hace, en este orden:
 *
 *  1. Registra el CONSENTIMIENTO como AUTOMÁTICA (hash + auditoría) si el contrato
 *     aún no está firmado. Si ya lo está, se salta este paso.
 *  2. Aprueba el contrato (titular + beneficiarios en cascada, activa, genera
 *     bookings) — SIN enviar WhatsApp.
 *  3. Si `promoverWelcome` es true, mueve a cada beneficiario que siga en el curso
 *     puente WELCOME a su curso real.
 *
 * Regla de negocio: NO se puede promover de WELCOME sin autoaprobar. Por eso la
 * promoción ocurre DENTRO de este endpoint (después de aprobar), nunca sola.
 *
 * NOTA: no genera/archiva el PDF del contrato — el consentimiento y su hash sí
 * quedan registrados; el PDF se puede generar aparte con "Generar Contrato".
 */

// Auditoría de auto-aprobaciones (misma tabla que /api/consent/[id]/auto-approve)
let auditTableReady = false;
async function ensureAuditTable() {
  if (auditTableReady) return;
  await query(
    `CREATE TABLE IF NOT EXISTS "auditautoaprov" (
      "_id"           VARCHAR(60) PRIMARY KEY,
      "contrato"      VARCHAR(50),
      "titularId"     VARCHAR(60),
      "usuarioEmail"  VARCHAR(200),
      "usuarioNombre" VARCHAR(200),
      "ip"            VARCHAR(100),
      "userAgent"     TEXT,
      "_createdDate"  TIMESTAMPTZ DEFAULT NOW()
    )`,
    []
  );
  auditTableReady = true;
}

export const POST = handlerWithAuth(async (request, { params }, session) => {
  await requirePermission(session, AprobacionPermission.AUTOAPROBAR);

  const titularId = params.id;
  const { promoverWelcome } = await request.json().catch(() => ({}));

  const titular = await queryOne(
    `SELECT "_id", "tipoUsuario", "contrato", "aprobacion", "hashConsentimiento",
            "primerNombre", "primerApellido"
       FROM "PEOPLE" WHERE "_id" = $1`,
    [titularId]
  );
  if (!titular) throw new NotFoundError('Titular', titularId);
  if (titular.tipoUsuario !== 'TITULAR') {
    throw new ValidationError('Autoaprobar sólo aplica a un titular de contrato');
  }
  if (titular.aprobacion === 'Aprobado') {
    throw new ConflictError('El contrato ya está aprobado');
  }

  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    request.headers.get('x-real-ip') ||
    'unknown';
  const ua = request.headers.get('user-agent') || 'unknown';
  const actorEmail = (session.user as any)?.email || 'system@mosaico.com';
  const actorNombre = (session.user as any)?.name || 'System';

  // ── 1) Registrar consentimiento AUTOMÁTICA (sólo si aún no está firmado) ──
  let consentRegistrado = false;
  if (!titular.hashConsentimiento) {
    await autoApproveConsent(titularId, actorEmail, actorNombre, ip, ua);
    await ensureAuditTable();
    await query(
      `INSERT INTO "auditautoaprov"
         ("_id", "contrato", "titularId", "usuarioEmail", "usuarioNombre", "ip", "userAgent", "_createdDate")
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [generateId('aud'), titular.contrato || null, titularId, actorEmail, actorNombre, ip, ua]
    );
    consentRegistrado = true;
  }

  // ── 2) Aprobar el contrato (titular + beneficiarios) SIN WhatsApp ──
  const { mainResult, beneficiaryResults } = await approveContract(titularId, {
    sendWhatsApp: false,
  });

  // ── 3) Promover de WELCOME al curso real (opcional, sólo tras aprobar) ──
  const promociones: Array<{ academicId: string; ok: boolean; error?: string }> = [];
  if (promoverWelcome && titular.contrato) {
    // Sólo los beneficiarios que SIGUEN en el puente WELCOME — para no generar
    // historial espurio en los ya promovidos.
    const enWelcome = await queryMany(
      `SELECT a."_id"
         FROM "ACADEMICA" a
         JOIN "PEOPLE" p ON p."numeroId" = a."numeroId" AND p."tipoUsuario" = 'BENEFICIARIO'
        WHERE p."contrato" = $1 AND a."curso" = 'WELCOME'`,
      [titular.contrato]
    );
    for (const row of enWelcome) {
      try {
        await promoteFromWelcome(row._id, { email: actorEmail, nombre: actorNombre });
        promociones.push({ academicId: row._id, ok: true });
      } catch (err: any) {
        promociones.push({ academicId: row._id, ok: false, error: err?.message || String(err) });
      }
    }
  }

  return successResponse({
    message: 'Contrato autoaprobado',
    consentRegistrado,
    titular: { personId: mainResult.personId, nombre: mainResult.nombre },
    beneficiariosAprobados: beneficiaryResults.length,
    welcomePromovidos: promociones.filter(p => p.ok).length,
    welcomeErrores: promociones.filter(p => !p.ok),
  });
});
