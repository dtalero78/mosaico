import 'server-only';
import { query, queryOne, queryMany } from '@/lib/postgres';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { ids } from '@/lib/id-generator';
import { sendWhatsAppMessage } from '@/lib/whatsapp';
import { generarBookingsBeneficiario } from '@/services/cursos-campaign-eventos.service';

/**
 * Aprobación de personas (titular + beneficiarios). Extraído desde
 * `api/postgres/people/[id]/approve/route.ts` para poder reutilizarlo también
 * desde el "Autoaprobar" del centro de aprobación (que aprueba SIN WhatsApp).
 *
 * `approveOnePerson` y `approveContract` son la ÚNICA definición de "cómo se
 * aprueba" en MOSAICO: el endpoint clásico y el de autoaprobar comparten esto.
 */

export interface ApproveResult {
  personId: string;
  nombre: string;
  academicId: string | null;
  academicCreated: boolean;
  whatsappSent: boolean;
  whatsappError: string | null;
}

export interface ApproveOpts {
  /** default true. false = no envía el WhatsApp de bienvenida (autoaprobar). */
  sendWhatsApp?: boolean;
}

/**
 * ¿Por qué NO se puede aprobar a este beneficiario? (null = sí se puede)
 *
 * Un beneficiario sin salón no puede aprobarse: la aprobación le genera los
 * agendamientos a partir de (campaña, curso, horario), así que sin eso quedaría
 * aprobado, activo y con acceso, pero sin clases — y encima recibiría el
 * WhatsApp de bienvenida a un curso que no tiene.
 *
 * ⚠ NO se usa `estadoInactivo` como señal: TODO beneficiario pendiente está
 * inactivo (nace así y es la aprobación la que lo activa), así que bloquear por
 * eso no aprobaría a nadie nunca. Lo que discrimina es haber soltado el salón:
 * el cupo liberado, que además borra los datos de curso.
 */
/**
 * Un contrato sólo se aprueba si Comercial ya lo dejó **listo** en Gestión
 * Contrato, que es el momento en que se toma el cupo del salón.
 *
 * Se resuelve por el TITULAR del contrato (la marca vive ahí), así que da igual
 * si lo que se está aprobando es el titular o un beneficiario suelto.
 *
 * Los contratos anteriores a esta regla ya quedaron marcados por el backfill de
 * `scripts/add-cupo-confirmado-columns.js`, y las altas de back-office (Migrar,
 * importar PDF, bulk) nacen listas.
 */
export async function assertContratoListo(person: {
  _id: string; contrato?: string | null; tipoUsuario?: string | null; gestionContratoListo?: boolean | null;
}): Promise<void> {
  const esTitular = String(person.tipoUsuario || '').toUpperCase() === 'TITULAR';
  if (esTitular) {
    if (person.gestionContratoListo === true) return;
  } else if (person.contrato) {
    const t = await queryOne(
      `SELECT "gestionContratoListo" FROM "PEOPLE"
        WHERE "contrato" = $1 AND "tipoUsuario" = 'TITULAR' LIMIT 1`,
      [person.contrato]
    );
    // Sin titular en la base no hay a quién exigirle la gestión: se deja pasar
    // en vez de bloquear una aprobación por un dato incompleto.
    if (!t || t.gestionContratoListo === true) return;
  } else {
    return; // sin contrato no hay gestión comercial que esperar
  }
  throw new ValidationError(
    'El contrato aún no está listo. Comercial debe marcarlo en Gestión Contrato ' +
    '(ahí se confirma el cupo del salón) antes de aprobarlo.'
  );
}

export function motivoNoAprobable(person: {
  cupoLiberado?: boolean | null;
  campaign?: string | null;
  tipoCurso?: string | null;
  horarioCurso?: string | null;
}): string | null {
  // Los mensajes dicen QUÉ HACER, no sólo qué falta: el usuario que choca con esto
  // está intentando aprobar y necesita saber que la salida es "Asignar cupo".
  if (person.cupoLiberado === true) {
    return 'Cupo liberado: no ocupa asiento en ningún salón. Usa "Asignar cupo" en su ficha para devolverle uno y vuelve a aprobar.';
  }
  const falta = (v: any) => !String(v ?? '').trim();
  if (falta(person.campaign) || falta(person.tipoCurso) || falta(person.horarioCurso)) {
    return 'Sin curso asignado (campaña, curso u horario). Usa "Asignar cupo" en su ficha para elegirle campaña, curso y salón, y vuelve a aprobar.';
  }
  return null;
}

/**
 * Aprueba UNA persona: actualiza PEOPLE, crea ACADEMICA (sólo beneficiarios),
 * genera bookings, y — si `sendWhatsApp` no es false — envía el WhatsApp de
 * bienvenida. Reutilizable para titular y beneficiario.
 * @param inicioContrato - fecha de consentimiento del titular a copiar a beneficiarios (null = omitir)
 */
export async function approveOnePerson(
  personId: string,
  contrato: string | null,
  inicioContrato: string | null = null,
  opts: ApproveOpts = {}
): Promise<ApproveResult> {
  const sendWhatsApp = opts.sendWhatsApp !== false;

  const person = await queryOne(
    `SELECT * FROM "PEOPLE" WHERE "_id" = $1`,
    [personId]
  );
  if (!person) throw new NotFoundError('Person', personId);

  // Skip if already approved
  if (person.aprobacion === 'Aprobado') {
    console.log(`ℹ️ [Approve] ${person.primerNombre} ya está aprobado, saltando`);
    const existingAcademic = await queryOne(
      `SELECT "_id" FROM "ACADEMICA" WHERE "numeroId" = $1 LIMIT 1`,
      [person.numeroId]
    );
    return {
      personId,
      nombre: `${person.primerNombre} ${person.primerApellido}`,
      academicId: existingAcademic?._id || null,
      academicCreated: false,
      whatsappSent: false,
      whatsappError: 'Ya estaba aprobado',
    };
  }

  // El contrato tiene que estar LISTO para aprobarse: ahí es donde Comercial
  // toma el cupo del salón. Sin esta guarda un contrato podía aprobarse por el
  // Centro sin haber pasado por Gestión Contrato, y el alumno quedaba activo y
  // estudiando sin ocupar cupo — el salón se sobrevendía solo.
  await assertContratoListo(person);

  // Sin salón no se aprueba ni se manda WhatsApp (ver `motivoNoAprobable`).
  // La guarda va aquí, no sólo en la cascada, para que cubra también el botón
  // "Aprobar" individual del beneficiario y el "Autoaprobar" del centro.
  if (String(person.tipoUsuario || '').toUpperCase() !== 'TITULAR') {
    const motivo = motivoNoAprobable(person as any);
    if (motivo) throw new ValidationError(`No se puede aprobar a ${person.primerNombre} ${person.primerApellido}: ${motivo}`);
  }

  console.log(`🟢 [Approve] Aprobando ${person.tipoUsuario}: ${person.primerNombre} ${person.primerApellido} (${personId})`);

  // Use provided contrato or person's own
  const effectiveContrato = contrato || person.contrato;

  // Update PEOPLE.aprobacion = 'Aprobado' + estado = 'ACTIVA'.
  // El mapeo aprobacion→estado está documentado en /api/postgres/approvals/[id]
  // (APROBACION_TO_ESTADO); aquí lo aplicamos para que ambos endpoints dejen el
  // titular/beneficiario en estado consistente. Antes este route sólo tocaba
  // aprobacion y dejaba `estado` en NULL — el badge "Estado: Null" aparecía
  // en /person/[id] aunque el contrato estuviera aprobado.
  // Para BENEFICIARIO además copia `contrato` (si falta) y `inicioContrato` del titular.
  if (person.tipoUsuario === 'BENEFICIARIO') {
    const extraFields = [];
    const extraValues: any[] = [];

    if (effectiveContrato && !person.contrato) {
      extraFields.push(`"contrato" = $${extraValues.length + 2}`);
      extraValues.push(effectiveContrato);
    }
    if (inicioContrato) {
      extraFields.push(`"inicioContrato" = $${extraValues.length + 2}`);
      extraValues.push(inicioContrato);
    }

    const setClause = extraFields.length > 0 ? `, ${extraFields.join(', ')}` : '';
    await query(
      `UPDATE "PEOPLE" SET "aprobacion" = 'Aprobado', "estado" = 'ACTIVA', "estadoInactivo" = false${setClause}, "_updatedDate" = NOW() WHERE "_id" = $1`,
      [personId, ...extraValues]
    );
  } else {
    await query(
      `UPDATE "PEOPLE" SET "aprobacion" = 'Aprobado', "estado" = 'ACTIVA', "estadoInactivo" = false, "_updatedDate" = NOW() WHERE "_id" = $1`,
      [personId]
    );
  }
  console.log(`✅ [Approve] PEOPLE.aprobacion='Aprobado' + estado='ACTIVA' + estadoInactivo=false`);

  // Check/Create ACADEMICA record — SÓLO para BENEFICIARIO.
  // Los TITULARES no son estudiantes (no toman clases); su rol es contractual.
  // Crear ACADEMICA para un titular que NO es beneficiario produce un registro
  // espurio que aparece como "estudiante" en búsquedas, paneles y reports.
  // Si el titular ES también beneficiario (titularEsBeneficiario), existe una fila
  // PEOPLE separada con tipoUsuario='BENEFICIARIO' que sí dispara ACADEMICA.
  let academicId: string | null = null;
  let academicCreated = false;

  if (person.tipoUsuario === 'BENEFICIARIO') {
    const existingAcademic = await queryOne(
      `SELECT "_id" FROM "ACADEMICA" WHERE "numeroId" = $1 LIMIT 1`,
      [person.numeroId]
    );

    academicId = existingAcademic?._id ?? null;

    if (!existingAcademic) {
      academicId = ids.academic();
      await query(
        `INSERT INTO "ACADEMICA" (
          "_id", "studentId", "numeroId", "primerNombre", "segundoNombre",
          "primerApellido", "segundoApellido", "email", "celular",
          "nivel", "step", "plataforma", "estadoInactivo", "tipoUsuario",
          "contrato", "usuarioId", "peopleId",
          "_createdDate", "_updatedDate"
        ) VALUES (
          $1, $13, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, false, 'BENEFICIARIO', $12, $13, $13, NOW(), NOW()
        )`,
        [
          academicId,
          person.numeroId,
          person.primerNombre,
          person.segundoNombre || null,
          person.primerApellido,
          person.segundoApellido || null,
          person.email || null,
          person.celular || null,
          'WELCOME',
          'WELCOME',
          person.plataforma || null,
          effectiveContrato || null,
          personId,
        ]
      );
      academicCreated = true;
      console.log(`✅ [Approve] Registro ACADEMICA creado: ${academicId}`);
    } else {
      console.log(`ℹ️ [Approve] Registro ACADEMICA ya existía: ${academicId}`);
    }
  } else {
    console.log(`ℹ️ [Approve] ${person.tipoUsuario} — se omite creación de ACADEMICA (sólo beneficiarios necesitan registro académico)`);
  }

  // Generar bookings PRECARGADOS en los N eventos del curso del beneficiario.
  // Best-effort + idempotente: si falla NO rompe la aprobación; si un curso aún no
  // tiene eventos generados, simplemente no crea bookings (sin error).
  // ACADEMICA y USUARIOS_ROLES siguen INACTIVOS — el cron los enciende 1 semana
  // antes de inicioCurso. Aquí sólo se dejan listos los agendamientos.
  if (person.tipoUsuario === 'BENEFICIARIO' && academicId) {
    try {
      const creados = await generarBookingsBeneficiario(academicId, {
        campaign: person.campaign,
        tipoCurso: person.tipoCurso,
        horarioCurso: person.horarioCurso,
        numeroId: person.numeroId,
        primerNombre: person.primerNombre,
        primerApellido: person.primerApellido,
        celular: person.celular,
        plataforma: person.plataforma,
      });
      console.log(`✅ [Approve] Bookings precargados para ${person.primerNombre}: ${creados}`);
    } catch (err: any) {
      console.warn(`⚠️ [Approve] No se pudieron generar bookings para ${personId}:`, err?.message || err);
    }
  }

  // Send WhatsApp welcome message — SÓLO a BENEFICIARIOS.
  // El mensaje contiene un link de auto-registro (/nuevo-usuario/{academicId})
  // que sólo aplica a estudiantes. Para TITULARES el academicId es null y el
  // link saldría roto; además los titulares no son usuarios de la plataforma.
  let whatsappSent = false;
  let whatsappError: string | null = null;

  if (!sendWhatsApp) {
    whatsappError = 'Omitido — autoaprobación sin WhatsApp';
    console.log(`ℹ️ [Approve] Autoaprobación — se omite WhatsApp de bienvenida`);
  } else if (person.tipoUsuario !== 'BENEFICIARIO') {
    whatsappError = 'Omitido — los titulares no reciben mensaje de auto-registro';
    console.log(`ℹ️ [Approve] ${person.tipoUsuario} — se omite WhatsApp de bienvenida`);
  } else {
    const celular = person.celular;
    console.log(`📱 [Approve] Celular: "${celular}" (${celular ? celular.length + ' chars' : 'null/undefined'})`);

    if (celular) {
      try {
        const nombre = person.primerNombre || '';
        const message = `Hola ${nombre} 👋:\n\n*¡Eres parte de MOSAICO!* 🎉 \n\nPara terminar tu registro y crear tu usuario sigue este enlace:\n\n${process.env.APP_URL || 'https://mosaicosorobanplataforma.com'}/nuevo-usuario/${academicId}\n\nSi tienes alguna pregunta, no dudes en contactarnos.\n\n¡Bienvenido a la familia MOSAICO! 🚀`;
        console.log(`📤 [Approve] Enviando WhatsApp a: ${celular}`);
        const whatsappResult = await sendWhatsAppMessage(celular, message);
        whatsappSent = true;
        console.log(`✅ [Approve] WhatsApp enviado a ${celular}`, whatsappResult);
      } catch (err: any) {
        whatsappError = err.message;
        console.error(`⚠️ [Approve] Error enviando WhatsApp a "${celular}":`, err.message);
      }
    } else {
      whatsappError = 'Sin número de celular registrado';
      console.log(`ℹ️ [Approve] Sin celular, no se envió WhatsApp`);
    }
  }

  return {
    personId,
    nombre: `${person.primerNombre} ${person.primerApellido}`,
    academicId,
    academicCreated,
    whatsappSent,
    whatsappError,
  };
}

export interface ApproveContractResult {
  mainResult: ApproveResult;
  beneficiaryResults: ApproveResult[];
  /** Beneficiarios NO aprobados a propósito (sin salón). No reciben WhatsApp. */
  skippedBeneficiaries: Array<{ personId: string; nombre: string; motivo: string }>;
}

/**
 * Aprueba un TITULAR y, en cascada, todos sus beneficiarios pendientes.
 * Propaga `inicioContrato` del titular a los beneficiarios. Best-effort por
 * beneficiario: si uno falla, se registra el error y sigue con los demás.
 *
 * Es la misma cascada que el POST de `people/[id]/approve` para un titular,
 * ahora reutilizable con la opción `sendWhatsApp` (el autoaprobar la pone en
 * false).
 */
export async function approveContract(
  titularId: string,
  opts: ApproveOpts = {}
): Promise<ApproveContractResult> {
  const titular = await queryOne(
    `SELECT "_id", "contrato", "inicioContrato" FROM "PEOPLE" WHERE "_id" = $1`,
    [titularId]
  );
  if (!titular) throw new NotFoundError('Person', titularId);

  const contrato = titular.contrato;
  const mainResult = await approveOnePerson(titularId, contrato, null, opts);

  const beneficiaryResults: ApproveResult[] = [];
  const skippedBeneficiaries: ApproveContractResult['skippedBeneficiaries'] = [];
  if (contrato) {
    const pendingBeneficiaries = await queryMany(
      `SELECT "_id", "cupoLiberado", "campaign", "tipoCurso", "horarioCurso",
              TRIM(CONCAT_WS(' ', "primerNombre", "primerApellido")) AS nombre
         FROM "PEOPLE"
       WHERE "contrato" = $1
         AND "tipoUsuario" = 'BENEFICIARIO'
         AND ("aprobacion" IS NULL OR "aprobacion" != 'Aprobado')`,
      [contrato]
    );

    const titularInicioContrato = titular.inicioContrato || null;
    for (let i = 0; i < pendingBeneficiaries.length; i++) {
      const ben = pendingBeneficiaries[i];
      // Sin salón: no se aprueba ni se le manda WhatsApp, y NO aborta la cascada
      // (los hermanos que sí tienen curso se aprueban igual).
      const motivo = motivoNoAprobable(ben as any);
      if (motivo) {
        console.log(`⏭️ [Approve] Saltando a ${ben.nombre}: ${motivo}`);
        skippedBeneficiaries.push({ personId: ben._id, nombre: ben.nombre || ben._id, motivo });
        continue;
      }
      try {
        const result = await approveOnePerson(ben._id, contrato, titularInicioContrato, opts);
        beneficiaryResults.push(result);
      } catch (err: any) {
        console.error(`⚠️ [Approve] Error aprobando beneficiario ${i + 1} (${ben._id}):`, err.message);
        beneficiaryResults.push({
          personId: ben._id,
          nombre: ben._id,
          academicId: null,
          academicCreated: false,
          whatsappSent: false,
          whatsappError: err.message,
        });
      }
    }
  }

  return { mainResult, beneficiaryResults, skippedBeneficiaries };
}
