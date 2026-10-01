import 'server-only';
import { queryOne, queryMany } from '@/lib/postgres';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { campanasExcluidasMigracion } from '@/lib/cursos-campaign';
import { isContratoPrueba } from '@/lib/contrato-prueba';
import { autoApproveConsent, registrarAuditoriaAutoaprobacion } from '@/services/consent.service';
import { marcarListoConCupo } from '@/services/gestion-cupo.service';
import { approveContract, motivoNoAprobable } from '@/services/approval.service';
import { promoteFromWelcome } from '@/services/student.service';
import { regenerarContratoEnDrive } from '@/services/contract-archive.service';

/**
 * Pestaña «Migración» del Centro de Aprobaciones.
 *
 * Lista los contratos dados de alta por back-office (`PEOPLE.altaMigracion`:
 * Migrar Contrato, Importar PDF, Subir Lote) que siguen sin aprobar, y los
 * aprueba de a uno haciendo todo lo que el flujo normal reparte entre varias
 * pantallas: firma automática si falta, «dejar listo» si falta, aprobación,
 * paso del alumno de WELCOME a su salón, PDF de nuevo en Drive y, si se pide,
 * el WhatsApp de bienvenida.
 *
 * Dos reglas propias de estos contratos:
 *   - Quedan fuera los de la campaña EN MATRÍCULA y la inmediatamente anterior
 *     (`campanasExcluidasMigracion`): esos los gestiona Comercial por el flujo
 *     normal. Se valida en el servidor, no sólo en el listado.
 *   - Sus salones llevan tiempo dictando: se agendan SÓLO las clases futuras
 *     (con las pasadas el alumno quedaría ausente en clases en las que nunca
 *     estuvo inscrito) y el alumno queda en la lección por la que VA su salón.
 */

/** Decisiones que anulan un contrato: no son algo que se vaya a aprobar. */
const ANULAN = ['Devuelto', 'Rechazado', 'Retractado', 'Contrato nulo'];
const APROBADOS = ['Aprobado', 'Aprobada', 'FINALIZADA'];

async function campanasExcluidas() {
  const rows = await queryMany<{ campaign: string; inicioCurso: string | null; finalCurso: string | null }>(
    `SELECT "campaign", "inicioCurso"::text AS "inicioCurso", "finalCurso"::text AS "finalCurso"
       FROM "CURSOS_CAMPAIGN" WHERE "activa" IS NOT FALSE AND "campaign" IS NOT NULL`
  );
  return campanasExcluidasMigracion(rows);
}

export interface BeneficiarioMigracion {
  _id: string;
  nombre: string;
  numeroId: string | null;
  campaign: string | null;
  tipoCurso: string | null;
  horarioCurso: string | null;
  salon: string | null;
  aprobacion: string | null;
  /** Por qué no se va a aprobar (sin salón, cupo liberado). null = se aprueba. */
  motivoNoAprobable: string | null;
  cursoAcademica: string | null;
}

export interface ContratoMigracion {
  _id: string;
  primerNombre: string;
  primerApellido: string;
  segundoApellido: string | null;
  numeroId: string;
  contrato: string;
  plataforma: string | null;
  celular: string | null;
  email: string | null;
  aprobacion: string | null;
  firmado: boolean;
  listo: boolean;
  _createdDate: string;
  beneficiarios: BeneficiarioMigracion[];
}

export async function listarMigracion() {
  const excl = await campanasExcluidas();

  const titulares = await queryMany<any>(
    `SELECT p."_id", p."primerNombre", p."primerApellido", p."segundoApellido", p."numeroId",
            p."contrato", p."plataforma", p."celular", p."email", p."aprobacion", p."_createdDate",
            (COALESCE(p."hashConsentimiento", '') <> '') AS firmado,
            COALESCE(p."gestionContratoListo", false) AS listo
       FROM "PEOPLE" p
      WHERE p."tipoUsuario" = 'TITULAR'
        AND p."altaMigracion" = true
        AND COALESCE(p."aprobacion", '') <> ALL($1::text[])
        AND COALESCE(p."contrato", '') NOT LIKE 'PRB-%'
      ORDER BY p."_createdDate" DESC`,
    [[...APROBADOS, ...ANULAN]]
  );

  const contratos = titulares.map(t => t.contrato).filter(Boolean);
  const benefs = contratos.length
    ? await queryMany<any>(
        `SELECT b."_id", b."contrato", b."numeroId", b."campaign", b."tipoCurso", b."horarioCurso",
                b."salon", b."aprobacion", b."cupoLiberado",
                TRIM(CONCAT_WS(' ', b."primerNombre", b."primerApellido")) AS nombre,
                a."curso" AS "cursoAcademica"
           FROM "PEOPLE" b
           LEFT JOIN LATERAL (
             SELECT "curso" FROM "ACADEMICA" WHERE "numeroId" = b."numeroId" LIMIT 1
           ) a ON true
          WHERE b."tipoUsuario" = 'BENEFICIARIO' AND b."contrato" = ANY($1::text[])
          ORDER BY b."_createdDate" ASC`,
        [contratos]
      )
    : [];

  const porContrato = new Map<string, BeneficiarioMigracion[]>();
  for (const b of benefs) {
    const lista = porContrato.get(b.contrato) || [];
    lista.push({
      _id: b._id, nombre: b.nombre, numeroId: b.numeroId,
      campaign: b.campaign, tipoCurso: b.tipoCurso, horarioCurso: b.horarioCurso, salon: b.salon,
      aprobacion: b.aprobacion,
      motivoNoAprobable: b.aprobacion === 'Aprobado' ? null : motivoNoAprobable(b),
      cursoAcademica: b.cursoAcademica,
    });
    porContrato.set(b.contrato, lista);
  }

  const excluidas = new Set(excl.excluidas);
  let excluidos = 0;
  const visibles: ContratoMigracion[] = [];
  for (const t of titulares) {
    const beneficiarios = porContrato.get(t.contrato) || [];
    if (beneficiarios.some(b => b.campaign && excluidas.has(b.campaign))) { excluidos++; continue; }
    visibles.push({ ...t, beneficiarios });
  }

  return { contratos: visibles, excluidos, ...excl };
}

export interface ResultadoMigracion {
  titularId: string;
  contrato: string;
  nombre: string;
  firma: 'REGISTRADA' | 'YA_ESTABA';
  listo: 'MARCADO' | 'YA_ESTABA';
  beneficiarios: Array<{
    nombre: string;
    aprobado: boolean;
    salon: string | null;
    leccion: string | null;
    agendamientos: number;
    whatsapp: 'ENVIADO' | 'NO_ENVIADO' | 'ERROR';
    detalle: string | null;
  }>;
  omitidos: Array<{ nombre: string; motivo: string }>;
  pdf: { ok: boolean; archivo: string | null; error: string | null };
}

export async function aprobarContratoMigrado(
  titularId: string,
  opts: { enviarWhatsApp: boolean; actorEmail: string; actorNombre: string; ip: string; userAgent: string }
): Promise<ResultadoMigracion> {
  const titular = await queryOne<any>(
    `SELECT "_id", "tipoUsuario", "contrato", "aprobacion", "hashConsentimiento",
            "gestionContratoListo", "altaMigracion", "primerNombre", "primerApellido"
       FROM "PEOPLE" WHERE "_id" = $1`,
    [titularId]
  );
  if (!titular) throw new NotFoundError('Titular', titularId);
  if (titular.tipoUsuario !== 'TITULAR') throw new ValidationError('Sólo se aprueba desde el titular del contrato.');
  if (titular.altaMigracion !== true) {
    throw new ValidationError('El contrato no es una alta de migración: se aprueba por el flujo normal del Centro.');
  }
  if (isContratoPrueba(titular.contrato)) throw new ValidationError('Es un contrato de prueba: no se aprueba.');
  if (APROBADOS.includes(String(titular.aprobacion || ''))) throw new ValidationError('El contrato ya está aprobado.');
  if (ANULAN.includes(String(titular.aprobacion || ''))) {
    throw new ValidationError(`El contrato está ${titular.aprobacion}: no se aprueba.`);
  }

  const benefs = await queryMany<any>(
    `SELECT "_id", "campaign", "tipoCurso", "horarioCurso", "salon", "cupoLiberado", "aprobacion",
            TRIM(CONCAT_WS(' ', "primerNombre", "primerApellido")) AS nombre
       FROM "PEOPLE" WHERE "contrato" = $1 AND "tipoUsuario" = 'BENEFICIARIO'`,
    [titular.contrato]
  );

  // La regla de campañas se vuelve a mirar AQUÍ: el listado puede llevar horas
  // abierto, y una llamada directa no pasa por él.
  const excl = await campanasExcluidas();
  const enExcluida = benefs.find(b => b.campaign && excl.excluidas.includes(b.campaign));
  if (enExcluida) {
    throw new ValidationError(
      `${enExcluida.nombre} está en ${enExcluida.campaign}, que es la campaña en matrícula o la ` +
      `inmediatamente anterior: ese contrato se aprueba por el flujo normal del Centro.`
    );
  }
  // Un contrato sin ningún alumno con salón quedaría aprobado sin nadie que
  // estudie — casi siempre es un retiro que falta registrar en el contrato.
  const pendientes = benefs.filter(b => b.aprobacion !== 'Aprobado');
  if (pendientes.length > 0 && pendientes.every(b => motivoNoAprobable(b))) {
    throw new ValidationError(
      'Ningún alumno del contrato tiene salón asignado (cupo liberado o sin curso). ' +
      'Asígnales cupo, o registra el retiro en el estado del contrato, antes de aprobarlo.'
    );
  }

  // 1) Firma automática, sólo si falta.
  let firma: ResultadoMigracion['firma'] = 'YA_ESTABA';
  if (!String(titular.hashConsentimiento || '').trim()) {
    await autoApproveConsent(titularId, opts.actorEmail, opts.actorNombre, opts.ip, opts.userAgent);
    await registrarAuditoriaAutoaprobacion({
      contrato: titular.contrato || null, titularId,
      usuarioEmail: opts.actorEmail, usuarioNombre: opts.actorNombre, ip: opts.ip, userAgent: opts.userAgent,
    });
    firma = 'REGISTRADA';
  }

  // 2) Listo (toma el cupo del salón), sólo si falta. Sin lugar en el salón,
  //    `marcarListoConCupo` rechaza sin escribir nada y el contrato no sigue.
  let listo: ResultadoMigracion['listo'] = 'YA_ESTABA';
  if (titular.gestionContratoListo !== true) {
    await marcarListoConCupo({ titularId, actor: opts.actorEmail, cambios: [], sobrecupo: false });
    listo = 'MARCADO';
  }

  // 3) Aprobación: titular + beneficiarios, sólo clases futuras.
  const agendadoPor = `Migración (${opts.actorEmail})`;
  const { beneficiaryResults, skippedBeneficiaries } = await approveContract(titularId, {
    sendWhatsApp: opts.enviarWhatsApp,
    soloFuturos: true,
    agendadoPor,
  });

  // 4) Cada alumno aprobado sale de WELCOME a su salón, en la lección del grupo.
  const beneficiarios: ResultadoMigracion['beneficiarios'] = [];
  for (const r of beneficiaryResults) {
    const b = benefs.find(x => x._id === r.personId);
    const fila: ResultadoMigracion['beneficiarios'][number] = {
      nombre: b?.nombre || r.nombre,
      aprobado: true,
      salon: b ? [b.tipoCurso, b.salon ? `Salón ${b.salon}` : null, b.horarioCurso].filter(Boolean).join(' · ') : null,
      leccion: null,
      agendamientos: r.bookingsCreados || 0,
      whatsapp: r.whatsappSent ? 'ENVIADO' : (opts.enviarWhatsApp && r.whatsappError ? 'ERROR' : 'NO_ENVIADO'),
      detalle: opts.enviarWhatsApp && !r.whatsappSent ? r.whatsappError : null,
    };
    if (!r.academicId) {
      // approveOnePerson devolvió error para este alumno (queda en `whatsappError`).
      fila.aprobado = false;
      fila.detalle = r.whatsappError;
      beneficiarios.push(fila);
      continue;
    }
    const acad = await queryOne<{ curso: string | null; nivel: string | null; step: string | null }>(
      `SELECT "curso", "nivel", "step" FROM "ACADEMICA" WHERE "_id" = $1`, [r.academicId]
    );
    if (String(acad?.curso || '').trim().toUpperCase() === 'WELCOME') {
      try {
        const p = await promoteFromWelcome(r.academicId, { email: opts.actorEmail, nombre: opts.actorNombre }, {
          leccionDelSalon: true, soloFuturos: true,
        });
        fila.agendamientos += p.bookingsCreados || 0;
        fila.leccion = p.after.split(' / ').slice(1).join(' · ');
      } catch (err: any) {
        fila.detalle = `Aprobado, pero no salió de WELCOME: ${err?.message || err}`;
      }
    } else {
      fila.leccion = [acad?.nivel, acad?.step].filter(Boolean).join(' · ') || null;
    }
    beneficiarios.push(fila);
  }

  // 5) PDF de nuevo en Drive (sobreescribe MOS_<contrato>.pdf). Si falla, la
  //    aprobación ya está hecha: se informa y se puede reponer con Generar Contrato.
  let pdf: ResultadoMigracion['pdf'] = { ok: false, archivo: null, error: null };
  try {
    const r = await regenerarContratoEnDrive(titularId);
    pdf = { ok: true, archivo: r.archivo, error: null };
  } catch (err: any) {
    pdf = { ok: false, archivo: null, error: err?.message || String(err) };
  }

  return {
    titularId,
    contrato: titular.contrato,
    nombre: `${titular.primerNombre || ''} ${titular.primerApellido || ''}`.trim(),
    firma,
    listo,
    beneficiarios,
    omitidos: skippedBeneficiaries.map(s => ({ nombre: s.nombre, motivo: s.motivo })),
    pdf,
  };
}
