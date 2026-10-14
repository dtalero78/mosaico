import 'server-only'
import { queryOne, transaction } from '@/lib/postgres'
import { ValidationError, NotFoundError } from '@/lib/errors'
import { ids } from '@/lib/id-generator'
import { normalizeTelefono } from '@/lib/telefono-normalize'
import { SPACES_BUCKET } from '@/lib/spaces'

/**
 * Botón «Perfil» de /student/[id] (personal): el mismo perfil que el alumno ve
 * en su panel ("Mi Perfil"), con los campos editables y la foto.
 *
 * El alumno vive en tres tablas y cada una se escribe por SU `_id` resuelto,
 * nunca por correo (los hermanos comparten el del apoderado):
 *  - ACADEMICA (el `id` de /student): nombres, correo, celular, nacimiento, edad, foto;
 *  - PEOPLE (su ficha BENEFICIARIO): lo mismo + domicilio y ciudad;
 *  - USUARIOS_ROLES (su cuenta, por `userLogin` o documento, rol ESTUDIANTE):
 *    nombre, apellido, correo y celular.
 *
 * El DOCUMENTO no se edita: es la llave con la que se enlazan las tres tablas.
 */

const ISO = /^\d{4}-\d{2}-\d{2}$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const txt = (v: any) => String(v ?? '').trim()

/** Prefijo público de las fotos de ESTE alumno en el bucket. */
const prefijoFoto = (academicaId: string) =>
  `https://${SPACES_BUCKET}.sfo3.digitaloceanspaces.com/fotos/${academicaId}/`

function edadDe(fecha: string | null): number | null {
  if (!fecha) return null
  const [y, m, d] = fecha.split('-').map(Number)
  const hoy = new Date()
  let e = hoy.getFullYear() - y
  if (hoy.getMonth() + 1 < m || (hoy.getMonth() + 1 === m && hoy.getDate() < d)) e--
  return e
}

async function resolver(academicaId: string) {
  const a = await queryOne<any>(
    `SELECT "_id","numeroId","userLogin","peopleId","foto","nivel","step",
            "primerNombre","segundoNombre","primerApellido","segundoApellido",
            "email","celular","fechaNacimiento"
       FROM "ACADEMICA" WHERE "_id" = $1`, [academicaId]
  )
  if (!a) throw new NotFoundError('Alumno', academicaId)
  // Ficha PEOPLE: la enlazada; si no, la BENEFICIARIO con su documento.
  const p = await queryOne<any>(
    `SELECT * FROM "PEOPLE"
      WHERE "_id" = $1
         OR ("numeroId" = $2 AND "tipoUsuario" IN ('BENEFICIARIO','BENEFICIARIA'))
      ORDER BY ("_id" = $1) DESC LIMIT 1`,
    [a.peopleId || '', a.numeroId || '']
  )
  return { a, p }
}

export async function leerPerfilEstudiante(academicaId: string) {
  const { a, p } = await resolver(academicaId)
  const f = (k: string) => p?.[k] ?? a?.[k] ?? ''
  return {
    academicaId: a._id,
    peopleId: p?._id || null,
    numeroId: a.numeroId || p?.numeroId || '',
    primerNombre: f('primerNombre'),
    segundoNombre: f('segundoNombre'),
    primerApellido: f('primerApellido'),
    segundoApellido: f('segundoApellido'),
    email: f('email'),
    celular: f('celular'),
    fechaNacimiento: String(p?.fechaNacimiento || a?.fechaNacimiento || '').slice(0, 10),
    domicilio: p?.domicilio || '',
    ciudad: p?.ciudad || '',
    plataforma: p?.plataforma || '',
    nivel: a.nivel || '',
    step: a.step || '',
    foto: a.foto || null,
  }
}

export interface PerfilInput {
  primerNombre?: string; segundoNombre?: string; primerApellido?: string; segundoApellido?: string
  email?: string; celular?: string; fechaNacimiento?: string; domicilio?: string; ciudad?: string
  /** URL pública de la foto recién subida (debe ser de ESTE alumno en nuestro bucket). */
  foto?: string | null
}

export async function actualizarPerfilEstudiante(
  academicaId: string, input: PerfilInput, actor: { email: string; nombre: string },
) {
  const { a, p } = await resolver(academicaId)

  const v = {
    primerNombre: txt(input.primerNombre),
    segundoNombre: txt(input.segundoNombre),
    primerApellido: txt(input.primerApellido),
    segundoApellido: txt(input.segundoApellido),
    email: txt(input.email).toLowerCase(),
    celular: normalizeTelefono(txt(input.celular)),
    fechaNacimiento: txt(input.fechaNacimiento),
    domicilio: txt(input.domicilio),
    ciudad: txt(input.ciudad),
  }
  if (!v.primerNombre) throw new ValidationError('El primer nombre es obligatorio.')
  if (!v.primerApellido) throw new ValidationError('El primer apellido es obligatorio.')
  if (v.email && !EMAIL.test(v.email)) throw new ValidationError('El correo no tiene un formato válido.')
  if (v.fechaNacimiento && !ISO.test(v.fechaNacimiento)) throw new ValidationError('La fecha de nacimiento no es válida.')
  if (v.fechaNacimiento && v.fechaNacimiento > new Date().toISOString().slice(0, 10)) {
    throw new ValidationError('La fecha de nacimiento no puede ser futura.')
  }
  // La foto sólo puede ser una subida para ESTE alumno a nuestro bucket: no se
  // acepta cualquier URL (quedaría mostrándose en su panel).
  let foto: string | undefined
  if (input.foto !== undefined && input.foto !== null && txt(input.foto) !== txt(a.foto)) {
    if (!txt(input.foto).startsWith(prefijoFoto(academicaId))) {
      throw new ValidationError('La foto no corresponde a este alumno.')
    }
    foto = txt(input.foto)
  }
  const fecha = v.fechaNacimiento || null
  const edad = edadDe(fecha)
  const nulo = (s: string) => (s ? s : null)

  // Lo que cambió, para la bitácora.
  const antes = await leerPerfilEstudiante(academicaId)
  const cambios: string[] = []
  const comp = (label: string, x: any, y: any) => { if (txt(x) !== txt(y)) cambios.push(`${label}: ${txt(x) || '—'} → ${txt(y) || '—'}`) }
  comp('Primer nombre', antes.primerNombre, v.primerNombre)
  comp('Segundo nombre', antes.segundoNombre, v.segundoNombre)
  comp('Primer apellido', antes.primerApellido, v.primerApellido)
  comp('Segundo apellido', antes.segundoApellido, v.segundoApellido)
  comp('Correo', antes.email, v.email)
  comp('Celular', antes.celular, v.celular)
  comp('Nacimiento', antes.fechaNacimiento, v.fechaNacimiento)
  comp('Domicilio', antes.domicilio, v.domicilio)
  comp('Ciudad', antes.ciudad, v.ciudad)
  if (foto) cambios.push('Foto actualizada')
  if (!cambios.length) return { cambios }

  await transaction(async (client) => {
    await client.query(
      `UPDATE "ACADEMICA"
          SET "primerNombre" = $2, "segundoNombre" = $3, "primerApellido" = $4, "segundoApellido" = $5,
              "email" = COALESCE($6, "email"), "celular" = $7, "fechaNacimiento" = $8::date, "edad" = $9,
              "foto" = COALESCE($10, "foto"), "_updatedDate" = NOW()
        WHERE "_id" = $1`,
      [a._id, v.primerNombre, nulo(v.segundoNombre), v.primerApellido, nulo(v.segundoApellido),
       nulo(v.email), nulo(v.celular), fecha, edad, foto ?? null]
    )
    if (p?._id) {
      await client.query(
        `UPDATE "PEOPLE"
            SET "primerNombre" = $2, "segundoNombre" = $3, "primerApellido" = $4, "segundoApellido" = $5,
                "email" = COALESCE($6, "email"), "celular" = $7, "fechaNacimiento" = $8::date, "edad" = $9,
                "domicilio" = $10, "ciudad" = $11, "_updatedDate" = NOW()
          WHERE "_id" = $1`,
        [p._id, v.primerNombre, nulo(v.segundoNombre), v.primerApellido, nulo(v.segundoApellido),
         nulo(v.email), nulo(v.celular), fecha, edad, nulo(v.domicilio), nulo(v.ciudad)]
      )
    }
    // Cuenta de acceso del alumno, por identidad (nunca por correo) y sólo ESTUDIANTE:
    // un documento puede coincidir con una cuenta del personal.
    // Nombre y apellido de la cuenta sólo si cambiaron: si no, cambiar la ciudad
    // reescribiría el nombre de la cuenta con otro formato.
    const nombresCambiaron = ['primerNombre', 'segundoNombre', 'primerApellido', 'segundoApellido']
      .some(k => txt((antes as any)[k]) !== txt((v as any)[k]))
    await client.query(
      `UPDATE "USUARIOS_ROLES"
          SET "nombre" = CASE WHEN $7 THEN $3 ELSE "nombre" END,
              "apellido" = CASE WHEN $7 THEN $4 ELSE "apellido" END,
              "email" = COALESCE($5, "email"),
              "celular" = COALESCE($6, "celular"), "_updatedDate" = NOW()
        WHERE "rol" = 'ESTUDIANTE'
          AND ( ($1::text <> '' AND "userLogin" = $1)
             OR ($1::text = '' AND $2::text <> ''
                 AND UPPER(REGEXP_REPLACE(COALESCE("numberid", ''), '[.\\s-]', '', 'g')) = UPPER($2)) )`,
      [txt(a.userLogin), txt(a.numeroId).toUpperCase(),
       [v.primerNombre, v.segundoNombre].filter(Boolean).join(' '),
       [v.primerApellido, v.segundoApellido].filter(Boolean).join(' '),
       nulo(v.email), nulo(v.celular), nombresCambiaron]
    )
    // Bitácora en los comentarios de la ficha.
    if (p?._id) {
      const comentario = {
        id: ids.comment(),
        texto: `[Perfil] ${cambios.join(' · ')}`,
        areaRemitente: 'Servicio', areaDestinatario: 'General',
        usuario: actor.nombre || actor.email || 'Sistema',
        fecha: new Date().toISOString(),
      }
      await client.query(
        `UPDATE "PEOPLE" SET "comentarios" = array_append(COALESCE("comentarios"::text[], ARRAY[]::text[]), $2)::text WHERE "_id" = $1`,
        [p._id, JSON.stringify(comentario)]
      )
    }
  })

  return { cambios }
}
