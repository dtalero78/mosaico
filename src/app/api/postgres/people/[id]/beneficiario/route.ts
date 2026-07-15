import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { PersonPermission } from '@/types/permissions';
import { query, queryOne, transaction } from '@/lib/postgres';
import { NotFoundError, ValidationError, ConflictError } from '@/lib/errors';
import {
  insertBeneficiarioTx,
  incrementarCupoCurso,
  type BeneficiarioInput,
} from '@/services/contract-creation.service';

/**
 * POST /api/postgres/people/[id]/beneficiario
 *
 * Agrega un beneficiario a un contrato YA existente (desde /person/[id] ›
 * Administración). `id` = _id del TITULAR.
 *
 * Reusa `insertBeneficiarioTx` — el mismo código con el que nacen los
 * beneficiarios en Crear Contrato — así que el nuevo queda idéntico a sus
 * hermanos: PEOPLE con su curso real, ACADEMICA en el puente WELCOME y
 * USUARIOS_ROLES con su userLogin (login bloqueado hasta el cron). Después se
 * descuenta el cupo del curso.
 *
 * Nace `estadoInactivo=true` / `aprobacion=NULL`, igual que en Crear Contrato:
 * es la aprobación la que genera los bookings y lo activa.
 */
export const POST = handlerWithAuth(async (request, { params }, session) => {
  await requirePermission(session, PersonPermission.AGREGAR_BENEFICIARIO);

  const titularId = params.id;
  const body = await request.json();

  const titular = await queryOne<any>(
    `SELECT "_id", "tipoUsuario", "contrato", "plataforma", "vigencia", "finalContrato"::text AS "finalContrato"
     FROM "PEOPLE" WHERE "_id" = $1`,
    [titularId]
  );
  if (!titular) throw new NotFoundError('Person', titularId);
  if (titular.tipoUsuario !== 'TITULAR') {
    throw new ValidationError('Solo se pueden agregar beneficiarios a un TITULAR');
  }
  if (!titular.contrato) {
    throw new ValidationError('El titular no tiene número de contrato');
  }

  // Obligatorios: identidad + curso (sin curso no hay salón, ni bookings al aprobar).
  const required: Array<[string, any]> = [
    ['primerNombre', body.primerNombre],
    ['primerApellido', body.primerApellido],
    ['numeroId', body.numeroId],
    ['email', body.email],
    ['campaign', body.campaign],
    ['tipoCurso', body.tipoCurso],
    ['horarioCurso', body.horarioCurso],
  ];
  const faltantes = required.filter(([, v]) => !v || String(v).trim() === '').map(([k]) => k);
  if (faltantes.length) {
    throw new ValidationError(`Campos requeridos: ${faltantes.join(', ')}`);
  }

  // numeroId único (regla MOSAICO: sólo el titular puede compartirlo con su propia
  // inscripción como beneficiario, y eso se resuelve al crear el contrato).
  const dup = await queryOne(`SELECT "_id" FROM "PEOPLE" WHERE "numeroId" = $1 LIMIT 1`, [body.numeroId]);
  if (dup) throw new ConflictError(`Ya existe una persona con el número de ID ${body.numeroId}`);

  // El curso debe existir en la campaña y estar activo.
  const curso = await queryOne<any>(
    `SELECT "salon", COALESCE("numeroUsuarios",0) AS cupos, COALESCE("usuInscritos",0) AS inscritos
     FROM "CURSOS_CAMPAIGN"
     WHERE "campaign"=$1 AND "tipoCurso"=$2 AND "horarioCurso"=$3 AND "activa"=true LIMIT 1`,
    [body.campaign, body.tipoCurso, body.horarioCurso]
  );
  if (!curso) {
    throw new ValidationError(`El curso ${body.tipoCurso} ${body.horarioCurso} no existe en la campaña ${body.campaign}`);
  }
  if (curso.cupos > 0 && curso.inscritos >= curso.cupos) {
    throw new ValidationError(`El curso ${body.tipoCurso} ${body.horarioCurso} está lleno (${curso.inscritos}/${curso.cupos})`);
  }

  const b: BeneficiarioInput = {
    primerNombre: body.primerNombre,
    segundoNombre: body.segundoNombre || null,
    primerApellido: body.primerApellido,
    segundoApellido: body.segundoApellido || null,
    numeroId: body.numeroId,
    fechaNacimiento: body.fechaNacimiento || null,
    email: body.email,
    celular: body.celular || null,
    domicilio: body.domicilio || null,
    ciudad: body.ciudad || null,
    campaign: body.campaign,
    tipoCurso: body.tipoCurso,
    horarioCurso: body.horarioCurso,
    apoderado: body.apoderado || null,
    apoderadoTelefono: body.apoderadoTelefono || null,
    apoderadoMail: body.apoderadoMail || null,
    userLogin: body.userLogin || null,
  };

  const person = await transaction(async (client) =>
    insertBeneficiarioTx(client, {
      b,
      titularId,
      contrato: titular.contrato,
      plataforma: titular.plataforma || null,
      vigencia: titular.vigencia || null,
      finalContrato: titular.finalContrato || null,
    })
  );

  await incrementarCupoCurso(b.campaign, b.tipoCurso, b.horarioCurso);

  // userLogin definitivo (insertBeneficiarioTx pudo regenerarlo por colisión).
  const login = await queryOne<any>(
    `SELECT "userLogin" FROM "PEOPLE" WHERE "_id" = $1`, [person._id]
  );

  return successResponse({
    message: 'Beneficiario creado exitosamente',
    person,
    userLogin: login?.userLogin || null,
    salon: curso.salon || null,
  });
});
