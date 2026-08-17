import 'server-only';
import { withTransaction, queryOne } from '@/lib/postgres';
import { ValidationError } from '@/lib/errors';
import { ids } from '@/lib/id-generator';

/**
 * Borrado completo de un contrato y todos sus registros.
 *
 * Lo usan dos flujos con guardas distintas:
 *   - Mantenimiento › Contratos de prueba  (sólo `PRB-`)
 *   - Comercial › Gestión Contrato › Dar de baja (sólo contratos NI aprobados
 *     NI listos — ver `motivoNoDableDeBaja`)
 *
 * Siempre deja el snapshot completo en `PURGE_LOG` ANTES de borrar, así que
 * un borrado equivocado se puede reconstruir a mano.
 *
 * ⚠ Los logins se borran por **userLogin / numberid, NUNCA por email**: desde
 * la Fase 2 el email de `USUARIOS_ROLES` no es único y los hermanos comparten
 * el correo del apoderado — borrar por email se llevaría por delante la cuenta
 * de un alumno de OTRO contrato.
 *
 * ⚠ Si una persona del contrato aparece también en otro contrato, se la excluye
 * de la cascada (no se borra su ACADEMICA, sus clases ni su login) y se reporta.
 * Sólo se le quita la fila de PEOPLE de ESTE contrato.
 */

export interface FilasBorradas {
  people: number; academica: number; bookings: number; financieros: number;
  pagos: number; stepOverrides: number; complementarias: number; usuariosRoles: number;
}

export interface PurgaResultado {
  contrato: string;
  status: 'ok' | 'error' | 'rechazado';
  borrados?: FilasBorradas;
  /** Personas que están en otro contrato y por eso se conservaron. */
  conservados?: { numeroId: string; nombre: string; otrosContratos: string[] }[];
  error?: string;
}

export interface PurgaContexto {
  tipoPurga: string;
  motivo: string;
  actorEmail: string;
  actorNombre?: string | null;
  ip?: string;
  userAgent?: string;
}

/**
 * ¿Por qué NO se puede dar de baja este contrato? (null = sí se puede)
 *
 * Un contrato aprobado ya tiene alumnos activos, con clases y accesos: darlo de
 * baja no es una corrección, es destruir un curso en marcha. Y uno marcado
 * listo ya tomó el cupo del salón y está a la espera de aprobación — si de
 * verdad hay que eliminarlo, primero se revierte esa marca.
 */
export function motivoNoDableDeBaja(titular: {
  aprobacion?: string | null; gestionContratoListo?: boolean | null; contrato?: string | null;
}): string | null {
  const a = String(titular.aprobacion || '').trim().toLowerCase();
  if (['aprobado', 'aprobada'].includes(a)) return 'El contrato está APROBADO.';
  if (a === 'finalizada') return 'El contrato está finalizado.';
  if (titular.gestionContratoListo === true) return 'El contrato ya está marcado como LISTO (tiene el cupo tomado).';
  return null;
}

/** Purga un contrato dentro de su propia transacción. */
export async function purgarContrato(contrato: string, ctx: PurgaContexto): Promise<FilasBorradas & { conservados: PurgaResultado['conservados'] }> {
  return withTransaction(async (client) => {
    // 1) Snapshot ANTES de borrar nada.
    const peopleSnap = await client.query(`SELECT * FROM "PEOPLE" WHERE "contrato" = $1`, [contrato]);
    if (!peopleSnap.rows.length) throw new ValidationError(`No se encontró el contrato ${contrato}.`);

    // Personas que además están en OTRO contrato: se conservan enteras.
    const conservados: NonNullable<PurgaResultado['conservados']> = [];
    const numeroIdsTodos = Array.from(new Set(peopleSnap.rows.map((p: any) => p.numeroId).filter(Boolean)));
    for (const nid of numeroIdsTodos) {
      const { rows } = await client.query(
        `SELECT DISTINCT "contrato" FROM "PEOPLE"
          WHERE "numeroId" = $1 AND "contrato" IS NOT NULL AND "contrato" <> $2`, [nid, contrato]);
      if (rows.length) {
        const p: any = peopleSnap.rows.find((x: any) => x.numeroId === nid);
        conservados.push({
          numeroId: nid,
          nombre: `${p?.primerNombre || ''} ${p?.primerApellido || ''}`.trim(),
          otrosContratos: rows.map((r: any) => r.contrato),
        });
      }
    }
    const excluidos = new Set(conservados.map(c => c.numeroId));

    const filas = peopleSnap.rows.filter((p: any) => !excluidos.has(p.numeroId));
    const numeroIds = Array.from(new Set(filas.map((p: any) => p.numeroId).filter(Boolean)));
    const peopleIds = filas.map((p: any) => p._id);
    const userLogins = Array.from(new Set(filas.map((p: any) => p.userLogin).filter(Boolean)));

    const arr = (a: any[]) => (a.length ? a : ['__none__']);

    const academicaSnap = numeroIds.length
      ? await client.query(`SELECT * FROM "ACADEMICA" WHERE "numeroId" = ANY($1::text[])`, [numeroIds])
      : { rows: [] as any[] };
    const academicaIds = academicaSnap.rows.map((a: any) => a._id);

    const bookingsSnap = academicaIds.length
      ? await client.query(
          `SELECT * FROM "ACADEMICA_BOOKINGS" WHERE "studentId" = ANY($1::text[]) OR "idEstudiante" = ANY($1::text[])`,
          [academicaIds])
      : { rows: [] as any[] };
    const finSnap = await client.query(`SELECT * FROM "FINANCIEROS" WHERE "contrato" = $1`, [contrato]);
    const pagosSnap = await client.query(
      `SELECT * FROM "PAGOS_TITULARES" WHERE "idPeople" = ANY($1::text[]) OR "numeroId" = ANY($2::text[])`,
      [arr(peopleIds), arr(numeroIds)]);
    const overridesSnap = academicaIds.length
      ? await client.query(`SELECT * FROM "STEP_OVERRIDES" WHERE "studentId" = ANY($1::text[])`, [academicaIds])
      : { rows: [] as any[] };
    const complemSnap = academicaIds.length
      ? await client.query(`SELECT * FROM "COMPLEMENTARIA_ATTEMPTS" WHERE "studentId" = ANY($1::text[])`, [academicaIds]).catch(() => ({ rows: [] as any[] }))
      : { rows: [] as any[] };
    // Login por IDENTIDAD (userLogin / numberid), nunca por email.
    const usuariosSnap = (userLogins.length || numeroIds.length)
      ? await client.query(
          `SELECT * FROM "USUARIOS_ROLES" WHERE "userLogin" = ANY($1::text[]) OR "numberid" = ANY($2::text[])`,
          [arr(userLogins), arr(numeroIds)])
      : { rows: [] as any[] };

    const titular: any = peopleSnap.rows.find((p: any) => p.tipoUsuario === 'TITULAR');
    const filasBorradas: FilasBorradas = {
      people: peopleSnap.rows.length,
      academica: academicaSnap.rows.length,
      bookings: bookingsSnap.rows.length,
      financieros: finSnap.rows.length,
      pagos: pagosSnap.rows.length,
      stepOverrides: overridesSnap.rows.length,
      complementarias: complemSnap.rows.length,
      usuariosRoles: usuariosSnap.rows.length,
    };

    // 2) Auditoría → PURGE_LOG, antes de borrar.
    await client.query(
      `INSERT INTO "PURGE_LOG"
         ("_id", "tipoPurga", "contrato", "titularId", "titularNombre",
          "snapshot", "motivo", "realizadoPor", "realizadoPorNombre",
          "ip", "userAgent", "filasBorradas")
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12::jsonb)`,
      [ids.audit(), ctx.tipoPurga, contrato, titular?._id ?? null,
       titular ? `${titular.primerNombre || ''} ${titular.primerApellido || ''}`.trim() : null,
       JSON.stringify({
         people: peopleSnap.rows, academica: academicaSnap.rows, bookings: bookingsSnap.rows,
         financieros: finSnap.rows, pagos: pagosSnap.rows, stepOverrides: overridesSnap.rows,
         complementarias: complemSnap.rows, usuariosRoles: usuariosSnap.rows, conservados,
       }),
       ctx.motivo, ctx.actorEmail, ctx.actorNombre ?? null,
       (ctx.ip || '').slice(0, 45), ctx.userAgent || '', JSON.stringify(filasBorradas)]
    );

    // 3) DELETE de dependientes hacia PEOPLE.
    if (academicaIds.length) {
      await client.query(`DELETE FROM "STEP_OVERRIDES" WHERE "studentId" = ANY($1::text[])`, [academicaIds]);
      await client.query(`DELETE FROM "COMPLEMENTARIA_ATTEMPTS" WHERE "studentId" = ANY($1::text[])`, [academicaIds]).catch(() => null);
      await client.query(`DELETE FROM "ACADEMICA_BOOKINGS" WHERE "studentId" = ANY($1::text[]) OR "idEstudiante" = ANY($1::text[])`, [academicaIds]);
    }
    await client.query(
      `DELETE FROM "PAGOS_TITULARES" WHERE "idPeople" = ANY($1::text[]) OR "numeroId" = ANY($2::text[])`,
      [arr(peopleIds), arr(numeroIds)]);
    if (numeroIds.length) {
      await client.query(`DELETE FROM "ACADEMICA" WHERE "numeroId" = ANY($1::text[])`, [numeroIds]);
    }
    await client.query(`DELETE FROM "FINANCIEROS" WHERE "contrato" = $1`, [contrato]);
    if (userLogins.length || numeroIds.length) {
      await client.query(
        `DELETE FROM "USUARIOS_ROLES" WHERE "userLogin" = ANY($1::text[]) OR "numberid" = ANY($2::text[])`,
        [arr(userLogins), arr(numeroIds)]);
    }
    // PEOPLE va entera: incluso las filas conservadas pierden su vínculo con
    // ESTE contrato, que es justamente lo que se está dando de baja.
    await client.query(`DELETE FROM "PEOPLE" WHERE "contrato" = $1`, [contrato]);

    return { ...filasBorradas, conservados };
  });
}

/**
 * Da de baja varios contratos comprobando, uno por uno y **en el servidor**,
 * que ninguno esté aprobado ni listo. Los que no cumplen se rechazan sin tocar
 * nada y no abortan el resto.
 */
export async function darDeBajaContratos(
  titularIds: string[], ctx: Omit<PurgaContexto, 'tipoPurga'>
): Promise<PurgaResultado[]> {
  const out: PurgaResultado[] = [];
  for (const id of titularIds) {
    const t = await queryOne<any>(
      `SELECT "_id","contrato","aprobacion","gestionContratoListo","primerNombre","primerApellido"
         FROM "PEOPLE" WHERE "_id" = $1 AND "tipoUsuario" = 'TITULAR'`, [id]);
    if (!t) { out.push({ contrato: id, status: 'rechazado', error: 'No se encontró el titular.' }); continue; }
    if (!t.contrato) { out.push({ contrato: id, status: 'rechazado', error: 'El titular no tiene número de contrato.' }); continue; }

    const motivo = motivoNoDableDeBaja(t);
    if (motivo) { out.push({ contrato: t.contrato, status: 'rechazado', error: motivo }); continue; }

    try {
      const r = await purgarContrato(t.contrato, { ...ctx, tipoPurga: 'BAJA_CONTRATO' });
      const { conservados, ...borrados } = r;
      out.push({ contrato: t.contrato, status: 'ok', borrados, conservados });
    } catch (e: any) {
      out.push({ contrato: t.contrato, status: 'error', error: e?.message || 'Error desconocido' });
    }
  }
  return out;
}
