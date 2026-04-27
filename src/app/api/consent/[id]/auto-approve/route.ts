import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { autoApproveConsent } from '@/services/consent.service';
import { query, queryOne } from '@/lib/postgres';
import { generateId } from '@/lib/id-generator';

// One-time migration: ensure auditautoaprov table exists
let auditTableReady = false;
async function ensureAuditTable() {
  if (auditTableReady) return;
  await query(
    `CREATE TABLE IF NOT EXISTS "auditautoaprov" (
      "_id"          VARCHAR(60) PRIMARY KEY,
      "contrato"     VARCHAR(50),
      "titularId"    VARCHAR(60),
      "usuarioEmail" VARCHAR(200),
      "usuarioNombre" VARCHAR(200),
      "ip"           VARCHAR(100),
      "userAgent"    TEXT,
      "_createdDate" TIMESTAMPTZ DEFAULT NOW()
    )`,
    []
  );
  auditTableReady = true;
}

export const POST = handlerWithAuth(async (request, { params }, session) => {
  const ip =
    request.headers.get('x-forwarded-for') ||
    request.headers.get('x-real-ip') ||
    'unknown';
  const ua = request.headers.get('user-agent') || 'unknown';

  const result = await autoApproveConsent(
    params.id,
    session.user?.email || 'system@lgs.com',
    session.user?.name || 'System',
    ip,
    ua
  );

  // Fetch contract number for audit log
  const person = await queryOne<{ contrato: string }>(
    `SELECT "contrato" FROM "PEOPLE" WHERE "_id" = $1 LIMIT 1`,
    [params.id]
  );

  // Write audit record
  await ensureAuditTable();
  await query(
    `INSERT INTO "auditautoaprov"
       ("_id", "contrato", "titularId", "usuarioEmail", "usuarioNombre", "ip", "userAgent", "_createdDate")
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
    [
      generateId('aud'),
      person?.contrato || null,
      params.id,
      session.user?.email || 'system@lgs.com',
      session.user?.name || 'System',
      ip,
      ua,
    ]
  );

  return successResponse({
    message: 'Consentimiento automático registrado exitosamente',
    hash: result.hash,
  });
});
