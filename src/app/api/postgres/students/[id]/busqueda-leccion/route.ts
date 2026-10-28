import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-permissions'
import { StudentPermission } from '@/types/permissions'
import { query, queryOne, withTransaction } from '@/lib/postgres'
import { resolverCurso } from '@/services/curso-resolver.service'
import { ids } from '@/lib/id-generator'
import { ValidationError, NotFoundError } from '@/lib/errors'
import { crearReporte } from '@/services/casos-atencion.service'
import { cambiarCursoAcademico } from '@/services/cambio-academico.service'
import { cierraElCaso } from '@/lib/casos-atencion-estados'

/**
 * POST /api/postgres/students/[id]/busqueda-leccion   [id] = ACADEMICA._id
 *
 * «Búsqueda Lección» (ficha del alumno › Académica). La búsqueda de salones en la
 * misma lección o más abajo la hace `recomendar-salones`; aquí van las dos acciones
 * que le siguen:
 *
 *  - action = 'asignar'   → abre un caso de tipo «Cambio de curso» para el alumno y
 *      lo asigna a Servicio Académico, con el salón elegido y el motivo en el texto.
 *  - action = 'confirmar' → Servicio confirma: se hace el cambio de curso/salón/lección
 *      (el mismo Cambio Académico) y el caso queda cerrado como «Salón cambiado».
 *
 * Gateado por STUDENT.ACADEMIA.BUSQUEDA_LECCION (permiso propio).
 */
interface Destino { campaign: string; tipoCurso: string; horarioCurso: string; salon: string }

async function validarDestino(b: any): Promise<Destino> {
  const campaign = String(b?.campaign || '').trim()
  const tipoCurso = String(b?.tipoCurso || '').trim()
  const horarioCurso = String(b?.horarioCurso || '').trim()
  if (!campaign || !tipoCurso || !horarioCurso) throw new ValidationError('Elige el salón destino.')
  const cc = await resolverCurso<{ salon: string | null }>({ query }, {
    campaign, tipoCurso, horarioCurso, salon: String(b?.salon || '').trim() || null,
  }, { soloActivo: true, columnas: '"salon"' })
  if (!cc) throw new ValidationError('El salón destino no existe o no está activo.')
  return { campaign, tipoCurso, horarioCurso, salon: cc.salon || '' }
}

export const POST = handlerWithAuth(async (req, { params }, session) => {
  await requirePermission(session, StudentPermission.BUSQUEDA_LECCION)
  const academicaId = decodeURIComponent(params.id || '').trim()
  const body = await req.json().catch(() => ({}))
  const action = String(body?.action || '')
  const actor = { email: session.user?.email || null, nombre: (session.user as any)?.name || null }
  const destino = await validarDestino(body)
  const etiqueta = `${destino.campaign} · ${destino.tipoCurso} · Salón ${destino.salon || '—'} · ${destino.horarioCurso}`

  if (action === 'asignar') {
    const motivo = String(body?.motivo || '').trim()
    if (!motivo) throw new ValidationError('Escribe el motivo del cambio de curso.')
    const buscada = body?.leccionBuscada ? ` Lección buscada: ${body.moduloBuscado || ''} · ${body.leccionBuscada}.` : ''
    const r = await crearReporte({
      academicaId,
      tema: 'CAMBIO_CURSO',
      texto: `Cambio de curso solicitado → ${etiqueta}.${buscada} Motivo: ${motivo}`,
      destino: 'nuevo',
      origen: 'SERVICIO',
      registradoPor: actor.nombre,
      registradoPorEmail: actor.email,
    })
    // El caso va directo a Servicio Académico (como el «Asignar» de las bandejas).
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE "CASOS_ATENCION" SET "estado"='REMITIDO_A_SERVICIO_ACADEMICO'::estado_caso, "area"='ACADEMICOS', "_updatedDate"=NOW()
          WHERE "_id"=$1`, [r.casoId])
      await client.query(
        `INSERT INTO "CASOS_ESTADO_HISTORIAL"("_id","casoId","estadoAnterior","estadoNuevo","autorEmail","autorNombre","motivo")
         VALUES ($1,$2,'EN_GESTION','REMITIDO_A_SERVICIO_ACADEMICO',$3,$4,$5)`,
        [ids.comment(), r.casoId, actor.email, actor.nombre, `Cambio de curso solicitado → ${etiqueta}. ${motivo}`])
    })
    return successResponse({ ok: true, casoId: r.casoId, codigo: r.codigo, destino: etiqueta })
  }

  if (action === 'confirmar') {
    const casoId = String(body?.casoId || '').trim()
    const motivo = String(body?.motivo || '').trim() || 'Cambio de curso confirmado por Servicio Académico'
    const caso = await queryOne<any>(
      `SELECT "_id","estado"::text AS estado,"tema"::text AS tema,"academicaId" FROM "CASOS_ATENCION" WHERE "_id"=$1`, [casoId])
    if (!caso || caso.academicaId !== academicaId) throw new NotFoundError('Caso de atención', casoId)
    if (caso.tema !== 'CAMBIO_CURSO') throw new ValidationError('Ese caso no es de cambio de curso.')
    if (cierraElCaso(caso.estado)) throw new ValidationError('El caso ya está cerrado.')

    // Mismo Cambio Académico de la ficha: curso, salón y lección del salón destino.
    const cambio = await cambiarCursoAcademico(
      academicaId, { ...destino, motivo: `[Búsqueda Lección · ${caso.estado === 'EN_GESTION' ? 'caso' : 'Servicio Académico'}] ${motivo}` },
      actor, { confirmarCupo: true })

    await withTransaction(async (client) => {
      await client.query(
        `UPDATE "CASOS_ATENCION" SET "estado"='SALON_CAMBIADO'::estado_caso, "area"='ACADEMICOS',
                "cerradoPor"=$2, "cerradoEn"=NOW(), "_updatedDate"=NOW() WHERE "_id"=$1`,
        [casoId, actor.email])
      await client.query(
        `INSERT INTO "CASOS_ESTADO_HISTORIAL"("_id","casoId","estadoAnterior","estadoNuevo","autorEmail","autorNombre","motivo")
         VALUES ($1,$2,$3::estado_caso,'SALON_CAMBIADO',$4,$5,$6)`,
        [ids.comment(), casoId, caso.estado, actor.email, actor.nombre, `Cambio aplicado → ${etiqueta}. ${motivo}`])
    })
    return successResponse({ ok: true, destino: etiqueta, ...(cambio as any) })
  }

  throw new ValidationError('Acción no válida.')
})
