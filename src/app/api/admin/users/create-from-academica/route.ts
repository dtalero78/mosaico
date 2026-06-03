/**
 * Crea UserRol — endpoints para generar una cuenta de login en USUARIOS_ROLES
 * a partir de un estudiante existente en ACADEMICA.
 *
 * Sólo crea cuentas con rol='ESTUDIANTE'. Para staff (advisor, comercial, etc.)
 * usar los flujos dedicados.
 *
 *   GET  ?numeroId=X   → preview: datos detectados en ACADEMICA + validaciones
 *   POST { numeroId, password? } → crea la cuenta
 *
 * Permiso: MANTENIMIENTO.USUARIOS.CREAR_ROL (SUPER_ADMIN/ADMIN bypass).
 */
import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { MantenimientoPermission } from '@/types/permissions';
import { ValidationError, NotFoundError, ConflictError } from '@/lib/errors';
import { query, queryOne } from '@/lib/postgres';
import crypto from 'crypto';

interface AcademicaPreview {
  _id: string;
  numeroId: string;
  primerNombre: string | null;
  segundoNombre: string | null;
  primerApellido: string | null;
  segundoApellido: string | null;
  email: string | null;
  celular: string | null;
  contrato: string | null;
  plataforma: string | null;
  tipoUsuario: string | null;
  nivel: string | null;
  step: string | null;
  clave: string | null;        // si está poblado, se usa como password default
  estadoInactivo: boolean | null;
}

/**
 * Busca ACADEMICA por numeroId. Si hay duplicados (mismo numeroId en varias
 * filas), prefiere BENEFICIARIO sobre TITULAR (igual que otros flujos).
 */
async function findAcademicaByNumeroId(numeroId: string): Promise<AcademicaPreview | null> {
  return queryOne<AcademicaPreview>(
    `SELECT
       "_id", "numeroId",
       "primerNombre", "segundoNombre", "primerApellido", "segundoApellido",
       "email", "celular", "contrato", "plataforma", "tipoUsuario",
       "nivel", "step", "clave", "estadoInactivo"
     FROM "ACADEMICA"
     WHERE "numeroId" = $1
     ORDER BY
       CASE WHEN "tipoUsuario" = 'BENEFICIARIO' THEN 0 ELSE 1 END,
       "_createdDate" DESC NULLS LAST
     LIMIT 1`,
    [numeroId.trim()],
  );
}

/**
 * Concatena nombres: primer + segundo si existe. Trim + normaliza espacios.
 */
function joinNames(first: string | null, second: string | null): string {
  return [first, second]
    .map(s => (s ?? '').trim())
    .filter(Boolean)
    .join(' ')
    .trim();
}

/**
 * Detecta el usuario USUARIOS_ROLES existente con un email dado (case-insensitive).
 * Devuelve el rol + nombre para mostrar en el error si hay duplicado.
 */
async function findExistingByEmail(email: string) {
  return queryOne<{ _id: string; nombre: string; rol: string; activo: boolean | null }>(
    `SELECT "_id", "nombre", "rol", "activo" FROM "USUARIOS_ROLES"
     WHERE LOWER("email") = LOWER($1) LIMIT 1`,
    [email],
  );
}

// ───────────────────────────── GET (preview) ─────────────────────────────

export const GET = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, MantenimientoPermission.CREAR_ROL);

  const { searchParams } = new URL(request.url);
  const numeroId = (searchParams.get('numeroId') || '').trim();
  if (!numeroId) throw new ValidationError('numeroId requerido');

  const aca = await findAcademicaByNumeroId(numeroId);
  if (!aca) {
    throw new NotFoundError('ACADEMICA', `numeroId=${numeroId}`);
  }

  const nombre = joinNames(aca.primerNombre, aca.segundoNombre);
  const apellido = joinNames(aca.primerApellido, aca.segundoApellido);

  // Validaciones para mostrar en el preview (NO bloquean — el POST las re-valida).
  const issues: { code: string; message: string }[] = [];
  let existingUser: { _id: string; nombre: string; rol: string; activo: boolean | null } | null = null;

  if (!aca.email || !aca.email.trim()) {
    issues.push({
      code: 'NO_EMAIL',
      message: 'ACADEMICA no tiene email registrado. Actualízalo primero antes de crear la cuenta.',
    });
  } else {
    existingUser = await findExistingByEmail(aca.email);
    if (existingUser) {
      issues.push({
        code: 'EMAIL_DUPLICATE',
        message: `Ya hay una cuenta con ese email (rol ${existingUser.rol}${existingUser.activo === false ? ', INACTIVA' : ''}). No se puede duplicar.`,
      });
    }
  }

  if (!nombre) {
    issues.push({
      code: 'NO_NAME',
      message: 'ACADEMICA no tiene primerNombre. Actualízalo antes de crear la cuenta.',
    });
  }

  // ACADEMICA.clave puede estar NULL/vacío — el admin tendrá que ingresar una.
  const hasClaveInAcademica = !!(aca.clave && aca.clave.trim().length >= 1);

  return successResponse({
    academica: {
      _id: aca._id,
      numeroId: aca.numeroId,
      nombre,
      apellido,
      email: aca.email,
      celular: aca.celular,
      contrato: aca.contrato,
      plataforma: aca.plataforma,
      tipoUsuario: aca.tipoUsuario,
      nivel: aca.nivel,
      step: aca.step,
      estadoInactivo: aca.estadoInactivo,
    },
    canCreate: issues.length === 0,
    issues,
    existingUser: existingUser ? {
      _id: existingUser._id,
      nombre: existingUser.nombre,
      rol: existingUser.rol,
      activo: existingUser.activo,
    } : null,
    /** Si true → el cliente puede usar la clave de ACADEMICA sin pedir input al admin. */
    passwordFromAcademica: hasClaveInAcademica,
  });
});

// ───────────────────────────── POST (crear) ─────────────────────────────

export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, MantenimientoPermission.CREAR_ROL);

  const body = await request.json();
  const numeroId = (body?.numeroId || '').trim();
  const passwordInput = typeof body?.password === 'string' ? body.password : '';

  if (!numeroId) throw new ValidationError('numeroId requerido');

  const aca = await findAcademicaByNumeroId(numeroId);
  if (!aca) throw new NotFoundError('ACADEMICA', `numeroId=${numeroId}`);

  // Validaciones obligatorias
  if (!aca.email || !aca.email.trim()) {
    throw new ValidationError('ACADEMICA no tiene email registrado. Actualízalo primero.');
  }

  const nombre = joinNames(aca.primerNombre, aca.segundoNombre);
  if (!nombre) {
    throw new ValidationError('ACADEMICA no tiene primerNombre. No se puede crear la cuenta.');
  }
  const apellido = joinNames(aca.primerApellido, aca.segundoApellido) || null;

  // Resolver password: prioridad → ACADEMICA.clave existente, sino password del body
  const claveAcademica = (aca.clave ?? '').trim();
  let finalPassword: string;
  let passwordSource: 'academica' | 'admin';

  if (claveAcademica) {
    finalPassword = claveAcademica;
    passwordSource = 'academica';
  } else {
    if (!passwordInput || passwordInput.length < 4) {
      throw new ValidationError('ACADEMICA.clave está vacía. Debes ingresar una contraseña (mín 4 caracteres).');
    }
    finalPassword = passwordInput;
    passwordSource = 'admin';
  }

  // Duplicado por email (UNIQUE constraint en USUARIOS_ROLES)
  const existing = await findExistingByEmail(aca.email);
  if (existing) {
    throw new ConflictError(
      `Ya existe una cuenta con email ${aca.email} (rol ${existing.rol}). No se puede duplicar.`,
    );
  }

  // INSERT — `password` se guarda en plano (compatible con auth-postgres que
  // acepta bcrypt y plano; el sistema actual usa plano para estudiantes nuevos
  // creados desde /nuevo-usuario y otros flujos similares).
  const newId = crypto.randomUUID();
  const inserted = await queryOne<any>(
    `INSERT INTO "USUARIOS_ROLES" (
       "_id", "email", "nombre", "apellido", "password", "rol",
       "activo", "celular", "numberid", "contrato", "plataforma",
       "origen", "fechaCreacion", "fechaActualizacion",
       "_createdDate", "_updatedDate"
     ) VALUES (
       $1, $2, $3, $4, $5, 'ESTUDIANTE',
       true, $6, $7, $8, $9,
       'ADMIN', NOW(), NOW(),
       NOW(), NOW()
     )
     RETURNING "_id", "email", "nombre", "apellido", "rol",
               "celular", "numberid", "contrato", "plataforma", "origen",
               "_createdDate"`,
    [
      newId,
      aca.email.trim(),
      nombre,
      apellido,
      finalPassword,
      aca.celular ?? null,
      aca.numeroId,
      aca.contrato ?? null,
      aca.plataforma ?? null,
    ],
  );

  return successResponse({
    user: inserted,
    passwordSource,                 // 'academica' o 'admin' — para mostrar en UI
    academicaId: aca._id,
  });
});
