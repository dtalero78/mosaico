import 'server-only';
import { randomUUID } from 'crypto';
import { query, transaction } from '@/lib/postgres';
import { ValidationError } from '@/lib/errors';
import { ids } from '@/lib/id-generator';
import { generateUserLogin } from '@/lib/user-login';
import { syncFinancieroSaldo } from '@/services/pagos-titulares.service';

/**
 * Regla numeroId MOSAICO: sólo el titular puede compartir numeroId con su propia
 * inscripción como beneficiario. Cualquier otro duplicado (repetido en el
 * formulario, o ya existente en PEOPLE) se rechaza. Compartida por Crear
 * Contrato y Migrar Contrato.
 */
export async function validarNumeroIds(titular: any, beneficiarios: any[]) {
  const incomingIds: string[] = [titular.numeroId, ...((beneficiarios || []).map((b: any) => b?.numeroId))]
    .filter((x: any) => typeof x === 'string' && x.trim() !== '');
  const dupEnFormulario = incomingIds.find((id, i) => incomingIds.indexOf(id) !== i);
  if (dupEnFormulario) {
    throw new ValidationError(`numeroId duplicado en el formulario: ${dupEnFormulario}. Solo el titular puede ser su propio beneficiario (marque "¿Este titular será beneficiario?").`);
  }
  if (incomingIds.length > 0) {
    const yaExiste = await query(
      `SELECT DISTINCT "numeroId" FROM "PEOPLE" WHERE "numeroId" = ANY($1)`,
      [incomingIds]
    );
    if (yaExiste.rows.length > 0) {
      throw new ValidationError(`numeroId ya registrado: ${yaExiste.rows.map((r: any) => r.numeroId).join(', ')}. El numeroId solo puede compartirse entre un titular y su propia inscripción como beneficiario.`);
    }
  }
}

/**
 * Servicio compartido de creación de contrato MOSAICO.
 *
 * Contiene TODA la lógica de creación (PEOPLE titular + beneficiarios, ACADEMICA
 * en el curso puente WELCOME inactiva, USUARIOS_ROLES con login bloqueado, cupos
 * en CURSOS_CAMPAIGN, FINANCIEROS y PAGOS_TITULARES cuota#0). Lo usan:
 *   - Crear Contrato  (POST /api/postgres/contracts)  → N° auto-generado.
 *   - Migrar Contrato (POST /api/admin/migrar-contrato) → N° digitado manualmente.
 *
 * La ÚNICA diferencia entre ambos flujos es de dónde viene `contrato`. Todo lo
 * demás (estado inicial Pendiente/inactivo, ACADEMICA WELCOME, login bloqueado)
 * es idéntico — mantener esto en un solo lugar evita que las rutas diverjan.
 */

export const VALID_TIPO_PLAN = ['Contado', 'Credito', 'Colaborador'] as const;
export type TipoPlan = typeof VALID_TIPO_PLAN[number];

export function normalizeTipoPlan(v: any): TipoPlan | null {
  if (!v) return null;
  const s = String(v).trim();
  return (VALID_TIPO_PLAN as readonly string[]).includes(s) ? (s as TipoPlan) : null;
}

/** Parse string monetario "$ 1.234.567" / "1234567" / "1234.5" → number. */
export function parseMoney(v: any): number {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return v;
  const cleaned = String(v).replace(/\./g, '').replace(',', '.').replace(/[^0-9.\-]/g, '');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

export interface BeneficiarioInput {
  primerNombre: string;
  segundoNombre?: string | null;
  primerApellido: string;
  segundoApellido?: string | null;
  numeroId: string;
  fechaNacimiento?: string | null;
  email?: string | null;
  celular?: string | null;
  domicilio?: string | null;
  ciudad?: string | null;
  campaign?: string | null;
  tipoCurso?: string | null;
  horarioCurso?: string | null;
  apoderado?: string | null;
  apoderadoTelefono?: string | null;
  apoderadoMail?: string | null;
  userLogin?: string | null;
}

/**
 * Inserta UN beneficiario completo dentro de una transacción:
 *   PEOPLE (inactivo, con el curso REAL) + ACADEMICA (curso puente WELCOME, inactiva)
 *   + USUARIOS_ROLES (login bloqueado, activo=false).
 *
 * Es la única definición de "cómo nace un beneficiario en MOSAICO". La usan:
 *   - createFullContract (Crear Contrato / Migrar Contrato) por cada beneficiario.
 *   - POST /api/postgres/people/[id]/beneficiario (agregar a un contrato existente).
 * Tenerla en un solo lugar evita que un beneficiario agregado después quede sin
 * curso, sin login o fuera del puente WELCOME.
 *
 * NO toca los cupos — el llamador debe invocar `incrementarCupoCurso` después del
 * commit (best-effort, igual que Crear Contrato).
 */
export async function insertBeneficiarioTx(
  client: any,
  args: {
    b: BeneficiarioInput;
    titularId: string;
    contrato: string;
    plataforma: string | null;
    vigencia: any;
    finalContrato: string | null;
  }
): Promise<any> {
  const { b, titularId, contrato, plataforma, vigencia, finalContrato } = args;
  const benefId = ids.person();

  // Resolver el curso desde CURSOS_CAMPAIGN: salón + inicioCurso
  let salon: string | null = null;
  let inicioCurso: string | null = null;
  if (b.campaign && b.tipoCurso && b.horarioCurso) {
    const cr = await client.query(
      `SELECT "_id", "salon", "inicioCurso" FROM "CURSOS_CAMPAIGN"
       WHERE "campaign"=$1 AND "tipoCurso"=$2 AND "horarioCurso"=$3 LIMIT 1`,
      [b.campaign, b.tipoCurso, b.horarioCurso]
    );
    salon = cr.rows[0]?.salon || null;
    inicioCurso = cr.rows[0]?.inicioCurso || null;
  }

  // userLogin del estudiante (viene del wizard; fallback server-side). 10 chars,
  // es el IDENTIFICADOR DE LOGIN → se garantiza único. Se verifica en USUARIOS_ROLES
  // (índice único) Y en ACADEMICA, porque los estudiantes con login omitido (hermanos
  // menores que comparten email) guardan su userLogin sólo en ACADEMICA — mirar ambas
  // evita colisiones futuras. La query corre dentro de la transacción, así que también
  // ve los beneficiarios ya insertados en este mismo contrato. Regenera hasta 6 veces.
  let userLogin = String(b.userLogin || generateUserLogin(b.primerNombre, b.primerApellido, b.numeroId)).slice(0, 10);
  for (let intento = 0; intento < 6; intento++) {
    const dup = await client.query(
      `SELECT 1 FROM "USUARIOS_ROLES" WHERE "userLogin"=$1
       UNION ALL
       SELECT 1 FROM "ACADEMICA" WHERE "userLogin"=$1
       LIMIT 1`,
      [userLogin]
    );
    if (dup.rows.length === 0) break;
    userLogin = generateUserLogin(b.primerNombre, b.primerApellido, b.numeroId);
  }

  // Curso REAL → primer módulo/lección (de NIVELES por curso). Va a PEOPLE.
  let realNivel = '';
  let realStep = '';
  if (b.tipoCurso) {
    const nr = await client.query(
      `SELECT "code", "step" FROM "NIVELES" WHERE "curso"=$1 ORDER BY "orden" NULLS LAST, "step" LIMIT 1`,
      [b.tipoCurso]
    );
    realNivel = nr.rows[0]?.code || '';
    realStep = nr.rows[0]?.step || '';
  }
  // Módulo del curso puente WELCOME según el curso real: IMPULSA → IMPULSA, resto → MOSAICO.
  const welcomeModulo = (b.tipoCurso === 'IMPULSA') ? 'IMPULSA' : 'MOSAICO';

  // 1. PEOPLE beneficiario — nace INACTIVO. Guarda el CURSO REAL.
  const benefResult = await client.query(
    `INSERT INTO "PEOPLE" ("_id", "numeroId", "primerNombre", "segundoNombre", "primerApellido", "segundoApellido",
      "email", "celular", "fechaNacimiento", "domicilio", "ciudad", "titularId",
      "tipoUsuario", "contrato", "plataforma", "estadoInactivo",
      "vigencia", "fechaContrato", "finalContrato", "tipoCurso", "horarioCurso", "campaign", "salon", "nivel", "step", "userLogin",
      "apoderado", "apoderadoTelefono", "apoderadoMail", "origen", "_createdDate", "_updatedDate")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$25,$26,$10,'BENEFICIARIO',$11,$12,true,$13,NOW(),$14::date,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,'POSTGRES',NOW(),NOW()) RETURNING *`,
    [benefId, b.numeroId, b.primerNombre, b.segundoNombre || null,
     b.primerApellido, b.segundoApellido || null,
     b.email || null, b.celular || null, b.fechaNacimiento || null, titularId,
     contrato, plataforma || null, vigencia || null, finalContrato,
     b.tipoCurso || null, b.horarioCurso || null, b.campaign || null, salon, realNivel, realStep, userLogin,
     b.apoderado || null, b.apoderadoTelefono || null, b.apoderadoMail || null,
     b.domicilio || null, b.ciudad || null]
  );

  // 2. ACADEMICA del beneficiario — INACTIVO, nace en el curso puente WELCOME.
  const exA = await client.query(`SELECT "_id" FROM "ACADEMICA" WHERE "numeroId"=$1 LIMIT 1`, [b.numeroId]);
  if (exA.rows.length === 0) {
    const academicId = ids.academic();
    await client.query(
      `INSERT INTO "ACADEMICA" (
         "_id", "studentId", "numeroId", "primerNombre", "segundoNombre", "primerApellido", "segundoApellido",
         "email", "celular", "nivel", "step", "plataforma", "estadoInactivo", "tipoUsuario",
         "contrato", "usuarioId", "peopleId", "campaign", "curso", "salon", "inicioCurso", "userLogin",
         "_createdDate", "_updatedDate"
       ) VALUES ($1,$13,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true,'BENEFICIARIO',$12,$13,$14,$15,'WELCOME','Salon 00',$16::date,$17,NOW(),NOW())`,
      [academicId, b.numeroId, b.primerNombre, b.segundoNombre || null,
       b.primerApellido, b.segundoApellido || null,
       b.email || null, b.celular || null, welcomeModulo, 'Leccion 00', plataforma || null,
       contrato, benefId, benefId, b.campaign || null, inicioCurso, userLogin]
    );
  }

  // 3. USUARIOS_ROLES — login BLOQUEADO (activo=false), clave placeholder=numeroId.
  //    El cron `activate-academica` lo enciende 1 semana antes de inicioCurso.
  if (b.email) {
    const exU = await client.query(
      `SELECT "_id" FROM "USUARIOS_ROLES" WHERE LOWER("email")=LOWER($1) LIMIT 1`,
      [b.email]
    );
    if (exU.rows.length === 0) {
      await client.query(
        `INSERT INTO "USUARIOS_ROLES" ("_id","email","password","nombre","apellido","celular",
          "numberid","contrato","plataforma","userLogin","rol","activo","origen",
          "fechaCreacion","fechaActualizacion","_createdDate","_updatedDate")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'ESTUDIANTE',false,'POSTGRES',NOW(),NOW(),NOW(),NOW())`,
        [randomUUID(), b.email, b.numeroId, b.primerNombre, b.primerApellido || null,
         b.celular || null, b.numeroId, contrato, plataforma || null, userLogin]
      );
    }
  }

  return benefResult.rows[0];
}

/**
 * Registra al asesor comercial del contrato en EQUIPO_COMERCIAL (nombre + correo +
 * plataforma), construyendo el catálogo del equipo comercial a medida que se vende.
 *
 * Por qué existe: `PEOPLE.asesor` guarda el NOMBRE del comercial, no su correo, y
 * los asesores no están en USUARIOS_ROLES → el correo del ejecutivo no se podía
 * resolver y salía vacío en el PDF del contrato. Con esto, cada contrato deja el
 * par nombre→correo registrado y `getAsesorInfo` puede resolverlo (incluso para
 * contratos viejos que sólo tienen el nombre).
 *
 * Es alta de CATÁLOGO: NO crea login. El alta con login vive en
 * `/admin/roles/create` → `POST /api/admin/equipo-comercial`; crear cuentas activas
 * sólo porque alguien tecleó un nombre en un contrato sería un agujero de
 * seguridad. Se marca `origen='CONTRATO'` para distinguir ambos orígenes.
 *
 * Si el correo ya existe NO se toca la fila (decisión de negocio): un typo en un
 * contrato no debe pisar el registro oficial de alguien dado de alta por un admin.
 *
 * Best-effort: nunca debe romper la creación del contrato.
 */
export async function registrarAsesorEnEquipoComercial(titular: any): Promise<void> {
  const nombre = String(titular?.asesor || '').trim();
  const correo = String(titular?.asesorMail || '').trim();
  const plataforma = String(titular?.plataforma || '').trim();

  // Sin correo válido no hay fila que crear (EQUIPO_COMERCIAL.correo es NOT NULL).
  if (!nombre || !correo || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) return;

  try {
    // ON CONFLICT sobre el índice único de LOWER(TRIM(correo)): si ya está, no se toca.
    await query(
      `INSERT INTO "EQUIPO_COMERCIAL"
         ("_id","nombre","correo","plataforma","rol","activo","origen","_createdDate","_updatedDate")
       VALUES ($1,$2,$3,$4,'COMERCIAL',true,'CONTRATO',NOW(),NOW())
       ON CONFLICT (LOWER(TRIM("correo"))) DO NOTHING`,
      [ids.comercial(), nombre, correo, plataforma || null]
    );
  } catch (err: any) {
    console.warn('[contract-creation] no se pudo registrar el asesor en EQUIPO_COMERCIAL:', err?.message || err);
  }
}

/** Incrementa el cupo del curso (+1). Best-effort — no rompe la creación si falla. */
export async function incrementarCupoCurso(campaign?: string | null, tipoCurso?: string | null, horarioCurso?: string | null) {
  if (!campaign || !tipoCurso || !horarioCurso) return;
  try {
    await query(
      `UPDATE "CURSOS_CAMPAIGN"
         SET "usuInscritos" = COALESCE("usuInscritos", 0) + 1, "_updatedDate" = NOW()
       WHERE "campaign" = $1 AND "tipoCurso" = $2 AND "horarioCurso" = $3`,
      [campaign, tipoCurso, horarioCurso]
    );
  } catch (err: any) {
    console.warn('[contract-creation] no se pudo incrementar usuInscritos:', err?.message || err);
  }
}

export interface CreateContractInput {
  /** Número de contrato ya resuelto (auto-generado o digitado manualmente). */
  contrato: string;
  titular: any;
  financial: any;
  beneficiarios: any[];
  titularEsBeneficiario: boolean;
  /** tipoPlan normalizado (Contado/Credito/Colaborador) o null. */
  tipoPlan: TipoPlan | null;
  /** email del usuario que crea/migra — createdBy + fallback de gestorRecaudo. */
  createdBy: string;
  /** YYYY-MM-DD en TZ local del cliente para fechaPago/fechaValidacion (opcional). */
  clientToday?: string | null;
}

/**
 * Crea el contrato completo (titular + beneficiarios + académico + financiero).
 * Asume que el llamador YA validó: contrato no vacío/no duplicado, y la regla de
 * numeroId (dup en formulario / dup existente salvo titular-beneficiario).
 */
export async function createFullContract(input: CreateContractInput) {
  const { contrato, titular, financial, beneficiarios, titularEsBeneficiario, tipoPlan, createdBy, clientToday } = input;

  // finalContrato = hoy + vigencia meses (misma regla que Crear Contrato).
  const vigenciaMeses = parseInt(financial?.vigencia || '0', 10);
  const fechaFinal = new Date();
  if (vigenciaMeses > 0) fechaFinal.setMonth(fechaFinal.getMonth() + vigenciaMeses);
  const finalContrato = vigenciaMeses > 0 ? fechaFinal.toISOString().split('T')[0] : null;

  const created: any = { contrato, titular: null, beneficiarios: [] };

  // Construir lista de beneficiarios (incluye al titular si titularEsBeneficiario).
  const allBeneficiarios: any[] = [];
  if (titularEsBeneficiario) {
    allBeneficiarios.push({
      primerNombre: titular.primerNombre,
      segundoNombre: titular.segundoNombre,
      primerApellido: titular.primerApellido,
      segundoApellido: titular.segundoApellido,
      numeroId: titular.numeroId,
      fechaNacimiento: titular.fechaNacimiento,
      email: titular.email,
      celular: titular.celular,
      tipoCurso: titular.tipoCurso,
      horarioCurso: titular.horarioCurso,
      campaign: titular.campaign,
      userLogin: titular.userLogin,
    });
  }
  if (beneficiarios?.length) allBeneficiarios.push(...beneficiarios);

  const titularId = ids.person();
  await transaction(async (client) => {
    // 1. TITULAR
    const titularResult = await client.query(
      `INSERT INTO "PEOPLE" ("_id", "numeroId", "primerNombre", "segundoNombre", "primerApellido", "segundoApellido",
        "email", "celular", "telefono", "fechaNacimiento", "domicilio", "ciudad",
        "plataforma", "ingresos", "empresa", "cargo", "genero",
        "referenciaUno", "parentezcoRefUno", "telefonoRefUno", "referenciaDos", "parentezcoRefDos", "telefonoRefDos",
        "asesor", "asesorMail", "tipoUsuario", "contrato", "vigencia", "fechaContrato", "finalContrato", "plan",
        "apoderado", "apoderadoTelefono", "apoderadoMail", "esCursoImpulsa", "extemporanea", "origen", "_createdDate", "_updatedDate")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$34,'TITULAR',$25,$26,NOW(),$27::date,$28,$29,$30,$31,$32,$33,'POSTGRES',NOW(),NOW()) RETURNING *`,
      [titularId, titular.numeroId, titular.primerNombre, titular.segundoNombre || null,
       titular.primerApellido, titular.segundoApellido || null,
       titular.email || null, titular.celular || null, titular.telefono || null,
       titular.fechaNacimiento || null, titular.domicilio || null, titular.ciudad || null,
       titular.plataforma || null, titular.ingresos || null, titular.empresa || null, titular.cargo || null, titular.genero || null,
       titular.referenciaUno || null, titular.parentezcoRefUno || null, titular.telRefUno || null,
       titular.referenciaDos || null, titular.parentezcoRefDos || null, titular.telRefDos || null,
       titular.asesor || null, contrato, financial?.vigencia || null, finalContrato, tipoPlan,
       titular.apoderado || null, titular.apoderadoTelefono || null, titular.apoderadoMail || null, titular.esCursoImpulsa === true, titular.extemporanea === true,
       titular.asesorMail || null]
    );
    created.titular = titularResult.rows[0];

    // 3. BENEFICIARIOS — PEOPLE (inactivo) + ACADEMICA (inactivo) + USUARIOS_ROLES (activo=false)
    for (const b of allBeneficiarios) {
      const row = await insertBeneficiarioTx(client, {
        b,
        titularId,
        contrato,
        plataforma: titular.plataforma || null,
        vigencia: financial?.vigencia || null,
        finalContrato,
      });
      created.beneficiarios.push(row);
    }
  });

  // Incrementar usuInscritos (+1) en CURSOS_CAMPAIGN por cada inscrito. Best-effort.
  for (const b of allBeneficiarios) {
    await incrementarCupoCurso(b.campaign, b.tipoCurso, b.horarioCurso);
  }

  // Registrar al asesor (nombre + correo + plataforma) en EQUIPO_COMERCIAL, para
  // que el correo del ejecutivo quede resoluble en el PDF. Best-effort.
  await registrarAsesorEnEquipoComercial(titular);

  // 4. FINANCIERO
  if (financial && financial.totalPlan) {
    const finResult = await query(
      `INSERT INTO "FINANCIEROS" ("_id", "contrato", "totalPlan", "numeroCuotas", "valorCuota",
        "pagoInscripcion", "saldo", "fechaPago", "medioPago", "vigencia", "plan",
        "origen", "_createdDate", "_updatedDate")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'POSTGRES',NOW(),NOW()) RETURNING *`,
      [ids.financial(), contrato, financial.totalPlan || 0, financial.numeroCuotas || 0,
       financial.valorCuota || 0, financial.pagoInscripcion || 0, financial.saldo || 0,
       financial.fechaPago || null, financial.medioPago || null, financial.vigencia || null,
       tipoPlan]
    );
    created.financiero = finResult.rows[0];

    // 5. PAGOS_TITULARES cuota #0 — best effort.
    try {
      const totalPlanNum    = parseMoney(financial.totalPlan);
      const inscripcionNum  = parseMoney(financial.pagoInscripcion);
      const saldoNum        = parseMoney(financial.saldo);
      const valorCuotaNum   = parseMoney(financial.valorCuota);

      const comercialEmail = (titular.asesor || createdBy || '').trim().toLowerCase();
      let comercialId: string | null = null;
      if (comercialEmail) {
        const found = await query(
          `SELECT "_id" FROM "USUARIOS_ROLES" WHERE LOWER("email") = $1 LIMIT 1`,
          [comercialEmail]
        );
        comercialId = found.rows[0]?._id ?? comercialEmail;
      }

      const cuotasTotalNum = parseInt(String(financial.numeroCuotas ?? 0), 10) || 0;
      const fechaPagoCliente = (typeof clientToday === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(clientToday))
        ? clientToday
        : null;

      const pagoResult = await query(
        `INSERT INTO "PAGOS_TITULARES" (
           "_id", "idPeople", "numeroId", "gestorRecaudo", "plataforma",
           "fechaPago", "fechaVencimiento", "numCuota", "cuotasTotal", "vlrTotalProg",
           "valorCuota", "valorPagado", "inscripcion", "saldo", "descuento",
           "medioPago", "documentosAdjuntos",
           "validado", "fechaValidacion", "validadoPor",
           "createdBy", "tipoCartera", "plan", "_createdDate", "_updatedDate"
         ) VALUES (
           $1, $2, $3, $4, $5,
           COALESCE($15::date, CURRENT_DATE), $6::date, 0, $7, $8,
           $9, $10, $11, $12, 0,
           $13, '[]'::jsonb,
           true, COALESCE($15::date, CURRENT_DATE), $14,
           $14, 'normal', $16, NOW(), NOW()
         ) RETURNING "_id"`,
        [
          ids.payment(),
          titularId,
          titular.numeroId,
          comercialId,
          titular.plataforma || null,
          financial.fechaPago || null,
          cuotasTotalNum,
          totalPlanNum,
          valorCuotaNum,
          inscripcionNum, // valorPagado
          inscripcionNum, // inscripcion
          saldoNum,
          financial.medioPago || null,
          createdBy,
          fechaPagoCliente,
          tipoPlan, // $16
        ]
      );
      created.pagoInicial = pagoResult.rows[0];

      await syncFinancieroSaldo(titularId);
    } catch (err: any) {
      console.warn(`[contract-creation] PAGOS_TITULARES cuota#0 falló para ${contrato}:`, err?.message || err);
    }
  }

  return { ...created, titularId };
}
