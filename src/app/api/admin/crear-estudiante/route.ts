import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { MantenimientoPermission } from '@/types/permissions';
import { ValidationError, NotFoundError, ConflictError } from '@/lib/errors';
import { query, queryOne, withTransaction } from '@/lib/postgres';
import { ids } from '@/lib/id-generator';
import { generateUserLogin } from '@/lib/user-login';
import { generarClave } from '@/lib/password-gen';
import { randomUUID } from 'crypto';

/**
 * Crear Estudiante — login para un beneficiario YA VINCULADO A UN CONTRATO que
 * aún no tiene cuenta. Sigue el patrón de createFullContract (ACADEMICA nace en
 * el curso puente WELCOME según la campaña/curso seleccionados) pero crea el
 * login USUARIOS_ROLES ACTIVO de una vez (rol ESTUDIANTE, por userLogin).
 *
 * GET  ?numeroId=X → preview (persona + si ya tiene login/academica)
 * POST { numeroId, email?, celular?, domicilio?, ciudad?, fechaNacimiento?,
 *        campaign, tipoCurso, horarioCurso, clave? } → crea academica + login.
 * Gateado por MANTENIMIENTO.USUARIOS.CREAR_ROL.
 */

/** Busca la persona por numeroId (prefiere BENEFICIARIO). Debe tener contrato. */
async function findPersona(numeroId: string) {
  return queryOne<any>(
    `SELECT "_id","numeroId","primerNombre","segundoNombre","primerApellido","segundoApellido",
            "email","celular","fechaNacimiento","domicilio","ciudad","tipoUsuario",
            "contrato","plataforma","tipoCurso","horarioCurso","campaign","userLogin"
     FROM "PEOPLE"
     WHERE UPPER(REGEXP_REPLACE("numeroId",'[.\\s-]','','g')) = UPPER(REGEXP_REPLACE($1,'[.\\s-]','','g'))
     ORDER BY CASE "tipoUsuario" WHEN 'BENEFICIARIO' THEN 0 ELSE 1 END
     LIMIT 1`,
    [numeroId]
  );
}

/** ¿Ya existe un login (USUARIOS_ROLES) para esta persona? */
async function findLogin(numeroId: string, userLogin: string | null) {
  return queryOne<{ email: string; rol: string; activo: boolean | null }>(
    `SELECT "email","rol","activo" FROM "USUARIOS_ROLES"
     WHERE ("numberid" = $1 AND "rol" = 'ESTUDIANTE')
        OR ($2::text IS NOT NULL AND "userLogin" = $2)
     LIMIT 1`,
    [numeroId, userLogin]
  );
}

export const GET = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, MantenimientoPermission.CREAR_ROL);
  const numeroId = new URL(request.url).searchParams.get('numeroId')?.trim();
  if (!numeroId) throw new ValidationError('numeroId es requerido.');

  const persona = await findPersona(numeroId);
  if (!persona) {
    return successResponse({ found: false, message: 'No existe una persona con ese número de ID en PEOPLE.' });
  }
  if (!persona.contrato) {
    return successResponse({
      found: true, canCreate: false,
      persona,
      message: 'La persona no tiene contrato. Este flujo es solo para beneficiarios vinculados a un contrato.',
    });
  }

  const login = await findLogin(persona.numeroId, persona.userLogin || null);
  const aca = await queryOne<{ _id: string }>(`SELECT "_id" FROM "ACADEMICA" WHERE "numeroId"=$1 LIMIT 1`, [persona.numeroId]);

  return successResponse({
    found: true,
    canCreate: !login,
    persona,
    loginExists: !!login,
    loginInfo: login || null,
    academicaExists: !!aca,
    message: login
      ? `Ya existe una cuenta para esta persona (rol ${login.rol}${login.activo === false ? ', INACTIVA' : ''}). No se puede duplicar.`
      : null,
  });
});

export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, MantenimientoPermission.CREAR_ROL);
  const body = await request.json();
  const numeroId = String(body?.numeroId || '').trim();
  const campaign = String(body?.campaign || '').trim();
  const tipoCurso = String(body?.tipoCurso || '').trim();
  const horarioCurso = String(body?.horarioCurso || '').trim();
  if (!numeroId) throw new ValidationError('numeroId es requerido.');
  if (!campaign || !tipoCurso || !horarioCurso) throw new ValidationError('Selecciona campaña, curso y horario.');

  const persona = await findPersona(numeroId);
  if (!persona) throw new NotFoundError('Persona', numeroId);
  if (!persona.contrato) throw new ValidationError('La persona no tiene contrato.');

  const existingLogin = await findLogin(persona.numeroId, persona.userLogin || null);
  if (existingLogin) {
    throw new ConflictError(`Ya existe una cuenta para esta persona (rol ${existingLogin.rol}${existingLogin.activo === false ? ', INACTIVA' : ''}).`);
  }

  // Campos de perfil (opcionales; si vienen, se guardan en PEOPLE).
  const email = String(body?.email || persona.email || '').trim();
  const celular = String(body?.celular || persona.celular || '').trim();
  const domicilio = String(body?.domicilio || persona.domicilio || '').trim();
  const ciudad = String(body?.ciudad || persona.ciudad || '').trim();
  const fechaNacimiento = String(body?.fechaNacimiento || persona.fechaNacimiento || '').trim();
  const clave = String(body?.clave || '').trim() || generarClave();

  // Resolver curso desde CURSOS_CAMPAIGN.
  const cc = await queryOne<{ salon: string | null; inicioCurso: string | null }>(
    `SELECT "salon","inicioCurso" FROM "CURSOS_CAMPAIGN"
     WHERE "campaign"=$1 AND "tipoCurso"=$2 AND "horarioCurso"=$3 LIMIT 1`,
    [campaign, tipoCurso, horarioCurso]
  );
  if (!cc) throw new ValidationError('No existe ese curso en la campaña seleccionada.');
  const welcomeModulo = tipoCurso === 'IMPULSA' ? 'IMPULSA' : 'MOSAICO';

  // Curso real → primer módulo/lección (para PEOPLE.nivel/step).
  const nr = await queryOne<{ code: string; step: string }>(
    `SELECT "code","step" FROM "NIVELES" WHERE "curso"=$1 ORDER BY "orden" NULLS LAST, "step" LIMIT 1`, [tipoCurso]
  );
  const realNivel = nr?.code || '';
  const realStep = nr?.step || '';

  const result = await withTransaction(async (client) => {
    // userLogin único (USUARIOS_ROLES + ACADEMICA).
    let userLogin = String(persona.userLogin || generateUserLogin(persona.primerNombre, persona.primerApellido, persona.numeroId)).slice(0, 10);
    for (let i = 0; i < 6; i++) {
      const dup = await client.query(
        `SELECT 1 FROM "USUARIOS_ROLES" WHERE "userLogin"=$1 UNION ALL SELECT 1 FROM "ACADEMICA" WHERE "userLogin"=$1 LIMIT 1`,
        [userLogin]
      );
      if (dup.rows.length === 0) break;
      userLogin = generateUserLogin(persona.primerNombre, persona.primerApellido, persona.numeroId);
    }

    // 1) PEOPLE — completar perfil + curso/campaña seleccionados.
    await client.query(
      `UPDATE "PEOPLE" SET
         "email"=$2, "celular"=$3, "domicilio"=$4, "ciudad"=$5, "fechaNacimiento"=$6,
         "tipoCurso"=$7, "horarioCurso"=$8, "campaign"=$9, "salon"=$10, "nivel"=$11, "step"=$12,
         "userLogin"=$13, "_updatedDate"=NOW()
       WHERE "_id"=$1`,
      [persona._id, email || null, celular || null, domicilio || null, ciudad || null, fechaNacimiento || null,
       tipoCurso, horarioCurso, campaign, cc.salon, realNivel, realStep, userLogin]
    );

    // 2) ACADEMICA — puente WELCOME (si no existe).
    let academicId: string;
    const exA = await client.query(`SELECT "_id" FROM "ACADEMICA" WHERE "numeroId"=$1 LIMIT 1`, [persona.numeroId]);
    if (exA.rows.length > 0) {
      academicId = exA.rows[0]._id;
    } else {
      academicId = ids.academic();
      await client.query(
        `INSERT INTO "ACADEMICA" (
           "_id","studentId","numeroId","primerNombre","segundoNombre","primerApellido","segundoApellido",
           "email","celular","nivel","step","plataforma","estadoInactivo","tipoUsuario",
           "contrato","usuarioId","peopleId","campaign","curso","salon","inicioCurso","userLogin",
           "_createdDate","_updatedDate"
         ) VALUES ($1,$13,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,false,'BENEFICIARIO',$12,$13,$14,$15,'WELCOME','Salon 00',$16::date,$17,NOW(),NOW())`,
        [academicId, persona.numeroId, persona.primerNombre, persona.segundoNombre || null,
         persona.primerApellido, persona.segundoApellido || null,
         email || null, celular || null, welcomeModulo, 'Leccion 00', persona.plataforma || null,
         persona.contrato, persona._id, persona._id, campaign, cc.inicioCurso, userLogin]
      );
    }

    // 3) USUARIOS_ROLES — login ACTIVO (rol ESTUDIANTE).
    const usuarioRolId = randomUUID();
    await client.query(
      `INSERT INTO "USUARIOS_ROLES" ("_id","email","password","nombre","apellido","celular",
         "numberid","contrato","plataforma","userLogin","rol","activo","origen",
         "fechaCreacion","fechaActualizacion","_createdDate","_updatedDate")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'ESTUDIANTE',true,'ADMIN',NOW(),NOW(),NOW(),NOW())`,
      [usuarioRolId, email || null, clave, persona.primerNombre, persona.primerApellido || null,
       celular || null, persona.numeroId, persona.contrato, persona.plataforma || null, userLogin]
    );

    return { academicId, userLogin };
  });

  return successResponse({
    created: true,
    nombre: `${persona.primerNombre} ${persona.primerApellido}`.trim(),
    userLogin: result.userLogin,
    clave,
    message: 'Estudiante creado con login activo.',
  });
});
