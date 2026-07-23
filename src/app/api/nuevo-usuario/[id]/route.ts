import 'server-only';
import { handler, successResponse } from '@/lib/api-helpers';
import { query, queryOne, queryMany } from '@/lib/postgres';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { ids } from '@/lib/id-generator';

// One-time migration: ensure columns exist (idempotent, runs once per server start)
let migrationDone = false;
async function ensureColumns() {
  if (migrationDone) return;
  try {
    await query(`ALTER TABLE "ACADEMICA" ADD COLUMN IF NOT EXISTS "detallesPersonales" TEXT`, []);
    await query(`ALTER TABLE "ACADEMICA" ADD COLUMN IF NOT EXISTS "hobbies" TEXT`, []);
    await query(`ALTER TABLE "ACADEMICA" ADD COLUMN IF NOT EXISTS "foto" TEXT`, []);
    await query(`ALTER TABLE "USUARIOS_ROLES" ADD COLUMN IF NOT EXISTS "contrato" VARCHAR(50)`, []);
    await query(`ALTER TABLE "USUARIOS_ROLES" ADD COLUMN IF NOT EXISTS "perfilActualizado" TIMESTAMPTZ`, []);
    migrationDone = true;
    console.log('✅ [NuevoUsuario] Columnas verificadas en ACADEMICA y USUARIOS_ROLES');
  } catch (err: any) {
    console.error('⚠️ [NuevoUsuario] Error verificando columnas:', err.message);
  }
}

/**
 * GET /api/nuevo-usuario/[id]
 *
 * Public endpoint. Loads student data for registration form.
 * [id] = ACADEMICA._id (sent via WhatsApp link)
 */
export const GET = handler(async (
  _request: Request,
  { params }: { params: Record<string, string> }
) => {
  const academicId = params.id;

  await ensureColumns();

  // Get ACADEMICA record
  const student = await queryOne(
    `SELECT a."_id", a."numeroId", a."primerNombre", a."segundoNombre",
            a."primerApellido", a."segundoApellido", a."email", a."celular",
            a."nivel", a."step", a."plataforma", a."usuarioId", a."curso",
            a."detallesPersonales", a."hobbies", a."foto", a."clave", a."userLogin"
     FROM "ACADEMICA" a
     WHERE a."_id" = $1`,
    [academicId]
  );
  if (!student) throw new NotFoundError('Registro académico', academicId);

  // Fix: some Wix-migrated records have primerNombre = tipoUsuario value ("TITULAR", "BENEFICIARIO")
  // instead of the real name. Resolve from PEOPLE using numeroId.
  const TIPO_USUARIO_NAMES = ['TITULAR', 'BENEFICIARIO', 'BENEFICIARIA'];
  if (student.primerNombre && TIPO_USUARIO_NAMES.includes(student.primerNombre.toUpperCase()) && student.numeroId) {
    const peopleRecord = await queryOne<{ primerNombre: string; primerApellido: string }>(
      `SELECT "primerNombre", "primerApellido" FROM "PEOPLE"
       WHERE "numeroId" = $1
       ORDER BY CASE WHEN "tipoUsuario" IN ('BENEFICIARIO','BENEFICIARIA') THEN 0 ELSE 1 END
       LIMIT 1`,
      [student.numeroId]
    ).catch(() => null);
    if (peopleRecord?.primerNombre && !TIPO_USUARIO_NAMES.includes(peopleRecord.primerNombre.toUpperCase())) {
      (student as any).primerNombre  = peopleRecord.primerNombre;
      (student as any).primerApellido = peopleRecord.primerApellido || student.primerApellido;
    }
  }

  // Check if already registered (has detallesPersonales or clave)
  const alreadyRegistered = !!(student.clave && student.detallesPersonales);

  // MOSAICO — módulo de WELCOME según el CURSO real del alumno: IMPULSA → eventos
  // WELCOME de IMPULSA; cualquier otro curso (YOJI/OKINA/KODOMO/DANSHI/SENPAI) →
  // WELCOME de MOSAICO. El curso real vive en PEOPLE.tipoCurso (fallback a
  // ACADEMICA.curso si es un curso real y no el puente 'WELCOME').
  const tipoCursoRow = student.numeroId
    ? await queryOne<{ tipoCurso: string | null }>(
        `SELECT "tipoCurso" FROM "PEOPLE" WHERE "numeroId" = $1 AND "tipoUsuario" = 'BENEFICIARIO' AND "tipoCurso" IS NOT NULL LIMIT 1`,
        [student.numeroId]
      ).catch(() => null)
    : null;
  const cursoReal = (tipoCursoRow?.tipoCurso
    || ((student as any).curso && String((student as any).curso).toUpperCase() !== 'WELCOME' ? (student as any).curso : '')
    || '').toUpperCase();
  const welcomeModule = cursoReal === 'IMPULSA' ? 'IMPULSA' : 'MOSAICO';

  // Eventos WELCOME del módulo del alumno, sólo de las PRÓXIMAS 2 SEMANAS.
  const welcomeEvents = await queryMany(
    `SELECT "_id", "dia", "hora", "advisor", "linkZoom", "limiteUsuarios", "inscritos",
            "titulo", "nombreEvento"
     FROM "CALENDARIO"
     WHERE ("tipo" = 'WELCOME' OR "evento" = 'WELCOME' OR "nombreEvento" = 'WELCOME' OR "tituloONivel" LIKE '%WELCOME%')
       AND (UPPER(COALESCE("nivel", '')) = $1 OR "tituloONivel" ILIKE '%WELCOME - ' || $1 || '%')
       AND "dia" > NOW()
       AND "dia" <= NOW() + INTERVAL '14 days'
     ORDER BY "dia" ASC
     LIMIT 30`,
    [welcomeModule]
  );

  // Check if student already has a future WELCOME booking
  let hasWelcomeBooking = false;
  {
    const existingBooking = await queryOne(
      `SELECT "_id" FROM "ACADEMICA_BOOKINGS"
       WHERE ("studentId" = $1 OR "idEstudiante" = $1)
         AND ("tipoEvento" = 'WELCOME' OR "tipo" = 'WELCOME')
         AND "fechaEvento" > NOW()
       LIMIT 1`,
      [academicId]
    );
    hasWelcomeBooking = !!existingBooking;
  }

  return successResponse({
    student: {
      _id: student._id,
      primerNombre: student.primerNombre,
      segundoNombre: student.segundoNombre,
      primerApellido: student.primerApellido,
      segundoApellido: student.segundoApellido,
      email: student.email,
      celular: student.celular,
      nivel: student.nivel,
      plataforma: student.plataforma,
      foto: student.foto,
      userLogin: student.userLogin || null,
      detallesPersonales: student.detallesPersonales || null,
      hobbies: student.hobbies || null,
    },
    welcomeEvents: welcomeEvents.map(e => ({
      _id: e._id,
      dia: e.dia,
      hora: e.hora,
      advisor: e.advisor,
      linkZoom: e.linkZoom,
      limiteUsuarios: e.limiteUsuarios,
      inscritos: e.inscritos,
      lleno: e.limiteUsuarios > 0 && e.inscritos >= e.limiteUsuarios,
    })),
    hasWelcomeBooking,
    alreadyRegistered,
    welcomeModule, // 'MOSAICO' | 'IMPULSA' — módulo de las sesiones WELCOME ofrecidas
  });
});

/**
 * POST /api/nuevo-usuario/[id]
 *
 * Public endpoint. Complete student registration:
 * 1. Update ACADEMICA (detallesPersonales, hobbies, email, clave, foto, fechaNacimiento, edad)
 * 2. Update PEOPLE (email, domicilio, ciudad, fechaNacimiento, edad)
 * 3. Create/update USUARIOS_ROLES (email, password, celular, numberid, contrato)
 * 4. Optionally create a WELCOME booking
 */
export const POST = handler(async (
  request: Request,
  { params }: { params: Record<string, string> }
) => {
  const academicId = params.id;
  const body = await request.json();

  const {
    detallesPersonales, hobbies, email, clave, foto, welcomeEventId,
    domicilio, ciudad, fechaNacimiento,
  } = body;

  // Validate required fields
  if (!detallesPersonales?.trim()) throw new ValidationError('Detalles personales es requerido');
  if (!hobbies?.trim())            throw new ValidationError('Hobbies es requerido');
  if (!email?.trim())              throw new ValidationError('Email/usuario es requerido');
  if (!clave?.trim())              throw new ValidationError('Clave es requerida');

  // Normalize email
  const normalizedEmail = email.replace(/[^\x20-\x7E]/g, '').trim().toLowerCase();
  if (normalizedEmail.includes(' '))
    throw new ValidationError('El email no debe contener espacios');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail))
    throw new ValidationError('El formato del email no es válido. Ejemplo: usuario@correo.com');

  // Calculate edad from fechaNacimiento
  let edad: number | null = null;
  if (fechaNacimiento) {
    const birth = new Date(fechaNacimiento);
    const today = new Date();
    edad = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) edad--;
  }

  // Get ACADEMICA record
  const student = await queryOne(
    `SELECT a."_id", a."numeroId", a."primerNombre", a."primerApellido", a."celular",
            a."nivel", a."step", a."plataforma", a."usuarioId", a."contrato"
     FROM "ACADEMICA" a WHERE a."_id" = $1`,
    [academicId]
  );
  if (!student) throw new NotFoundError('Registro académico', academicId);

  // 1. Update ACADEMICA
  await query(
    `UPDATE "ACADEMICA"
     SET "detallesPersonales" = $1,
         "hobbies"            = $2,
         "email"              = $3,
         "clave"              = $4,
         "foto"               = COALESCE($5, "foto"),
         "fechaNacimiento"    = COALESCE($6::date, "fechaNacimiento"),
         "edad"               = COALESCE($7, "edad"),
         "_updatedDate"       = NOW()
     WHERE "_id" = $8`,
    [
      detallesPersonales.trim(), hobbies.trim(), normalizedEmail,
      clave.trim(), foto || null,
      fechaNacimiento || null, edad,
      academicId,
    ]
  );
  console.log(`✅ [NuevoUsuario] ACADEMICA actualizado`);

  // 2. Update PEOPLE — propagate email + new fields (matched by numeroId from ACADEMICA)
  if ((student as any).numeroId) {
    await query(
      `UPDATE "PEOPLE"
       SET "email"           = $1,
           "domicilio"       = COALESCE($2, "domicilio"),
           "ciudad"          = COALESCE($3, "ciudad"),
           "fechaNacimiento" = COALESCE($4::date, "fechaNacimiento"),
           "edad"            = COALESCE($5, "edad"),
           "_updatedDate"    = NOW()
       WHERE "numeroId" = $6`,
      [
        normalizedEmail,
        domicilio?.trim() || null,
        ciudad?.trim() || null,
        fechaNacimiento || null,
        edad,
        (student as any).numeroId,
      ]
    );
    console.log(`✅ [NuevoUsuario] PEOPLE actualizado (email propagado)`);
  }

  // 3. Create/update USUARIOS_ROLES
  const nombreCompleto = [student.primerNombre, student.primerApellido].filter(Boolean).join(' ');
  const usuarioId = ids.person();
  await query(
    `INSERT INTO "USUARIOS_ROLES"
       ("_id", "email", "password", "nombre", "rol", "activo",
        "numberid", "contrato", "celular", "perfilActualizado", "_createdDate", "_updatedDate")
     VALUES ($1, $2, $3, $4, 'ESTUDIANTE', true, $5, $6, $7, NOW(), NOW(), NOW())
     ON CONFLICT ("email") DO UPDATE
       SET "password"         = $3,
           "nombre"           = $4,
           "numberid"         = $5,
           "contrato"         = $6,
           "celular"          = $7,
           "perfilActualizado" = NOW(),
           "_updatedDate"     = NOW()`,
    [
      usuarioId, normalizedEmail, clave.trim(), nombreCompleto,
      (student as any).numeroId || null,
      (student as any).contrato  || null,
      (student as any).celular   || null,
    ]
  );
  console.log(`✅ [NuevoUsuario] USUARIOS_ROLES actualizado (email=${normalizedEmail})`);

  // Create WELCOME booking if event selected
  let bookingCreated = false;
  let bookingId: string | null = null;

  if (welcomeEventId) {
    // Get the event data
    const event = await queryOne(
      `SELECT "_id", "dia", "hora", "advisor", "linkZoom", "limiteUsuarios", "inscritos",
              "tipo", "evento", "nombreEvento", "tituloONivel", "titulo"
       FROM "CALENDARIO" WHERE "_id" = $1`,
      [welcomeEventId]
    );

    if (!event) {
      console.error(`⚠️ [NuevoUsuario] Evento WELCOME no encontrado: ${welcomeEventId}`);
    } else if (event.limiteUsuarios > 0 && event.inscritos >= event.limiteUsuarios) {
      console.error(`⚠️ [NuevoUsuario] Evento WELCOME lleno: ${welcomeEventId}`);
    } else {
      // Check for existing booking
      const existingBooking = await queryOne(
        `SELECT "_id" FROM "ACADEMICA_BOOKINGS"
         WHERE ("studentId" = $1 OR "idEstudiante" = $1)
           AND ("eventoId" = $2 OR "idEvento" = $2)
         LIMIT 1`,
        [academicId, welcomeEventId]
      );

      if (existingBooking) {
        console.log(`ℹ️ [NuevoUsuario] Booking ya existe para evento ${welcomeEventId}`);
        bookingId = existingBooking._id;
        bookingCreated = false;
      } else {
        bookingId = ids.booking();
        const eventType = event.tipo || event.evento || 'WELCOME';
        await query(
          `INSERT INTO "ACADEMICA_BOOKINGS" (
            "_id", "eventoId", "idEvento", "studentId", "idEstudiante",
            "primerNombre", "primerApellido",
            "nivel", "step", "advisor", "fecha", "fechaEvento", "hora",
            "tipo", "tipoEvento", "linkZoom", "nombreEvento", "tituloONivel",
            "asistio", "asistencia", "participacion", "noAprobo", "cancelo",
            "agendadoPor", "origen",
            "_createdDate", "_updatedDate"
          ) VALUES (
            $1, $2, $3, $4, $5,
            $6, $7,
            $8, $9, $10, $11, $12, $13,
            $14, $15, $16, $17, $18,
            false, false, false, false, false,
            'ESTUDIANTE', 'POSTGRES',
            NOW(), NOW()
          )`,
          [
            bookingId,
            welcomeEventId,       // $2 eventoId
            welcomeEventId,       // $3 idEvento
            academicId,           // $4 studentId
            academicId,           // $5 idEstudiante
            student.primerNombre, // $6
            student.primerApellido, // $7
            student.nivel || 'WELCOME', // $8
            student.step || 'WELCOME',  // $9
            event.advisor || null,      // $10
            event.dia,                  // $11 fecha
            event.dia,                  // $12 fechaEvento
            event.hora || null,         // $13
            eventType,                  // $14 tipo
            eventType,                  // $15 tipoEvento
            event.linkZoom || null,     // $16
            event.nombreEvento || event.titulo || 'WELCOME', // $17
            event.tituloONivel || null, // $18
          ]
        );

        // Increment inscritos on the event
        await query(
          `UPDATE "CALENDARIO" SET "inscritos" = COALESCE("inscritos", 0) + 1, "_updatedDate" = NOW() WHERE "_id" = $1`,
          [welcomeEventId]
        );

        bookingCreated = true;
        console.log(`✅ [NuevoUsuario] Booking WELCOME creado: ${bookingId}`);
      }
    }
  }

  return successResponse({
    message: 'Registro completado exitosamente',
    bookingCreated,
    bookingId,
  });
});
