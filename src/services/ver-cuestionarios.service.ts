import 'server-only'
import { query } from '@/lib/postgres'
import { deriveCuestionarios, type Cuestionario } from '@/lib/cuestionarios'
import { nombresTiposCurso } from '@/services/tipos-curso.service'
import { esRolGuia, guiaIdDeSesion } from '@/services/guia-sesion.service'

/**
 * Ver Evaluación / Ver Entrenamiento (Académico › Guías): el CONTENIDO de los
 * cuestionarios de un curso, completo y sin depender del avance de nadie.
 *
 * Misma fuente que el panel del alumno (`/panel-estudiante/evaluacion`): las
 * filas de NIVELES del curso cuyo módulo es "Evaluación NN" o "Entrenamiento NN",
 * con sus cuestionarios (`deriveCuestionarios`). Un módulo puede repartir su
 * contenido en varias lecciones; se agrupa por módulo, en orden de lección,
 * igual que se lo presenta al alumno.
 *
 * A diferencia del alumno, aquí van las respuestas correctas y la explicación:
 * la pantalla las oculta por defecto y el Guía las muestra con un interruptor.
 */
export type TipoCuestionario = 'evaluacion' | 'entrenamiento'

export interface ModuloCuestionarios {
  code: string
  numero: string
  lecciones: string[]
  cuestionarios: Array<Cuestionario & { step: string }>
  totalPreguntas: number
}

const numDe = (code: string) => (String(code).match(/(\d+)/)?.[1] ?? '')

export async function listarCuestionariosCurso(session: any, tipo: TipoCuestionario, cursoPedido?: string) {
  const cursos = await nombresTiposCurso()

  // Curso por defecto: para el GUIA, el primero de los que dicta; si no, el
  // primero del catálogo. El Guía puede mirar cualquier curso: el contenido del
  // currículo no es información de un alumno.
  let cursosGuia: string[] = []
  if (esRolGuia(session)) {
    const gid = await guiaIdDeSesion((session as any)?.user?.email)
    if (gid) {
      cursosGuia = (await query<{ curso: string }>(
        `SELECT DISTINCT UPPER("tipoCurso") AS curso FROM "CURSOS_CAMPAIGN"
          WHERE "guia" = $1 AND COALESCE("activa", true) = true ORDER BY 1`, [gid]
      )).rows.map(r => r.curso)
    }
  }
  const pedido = String(cursoPedido || '').trim().toUpperCase()
  const curso = (pedido && cursos.map(c => c.toUpperCase()).includes(pedido))
    ? pedido
    : (cursosGuia[0] || cursos[0] || '')

  const cat = tipo === 'evaluacion' ? `"code" ILIKE '%evaluac%'` : `"code" ILIKE '%entren%'`
  const filas = curso ? (await query<any>(
    `SELECT "code","step","orden","evaluacionModo","evaluacionMinutos","preguntasManual","cuestionarios"
       FROM "NIVELES"
      WHERE UPPER("curso") = UPPER($1) AND ${cat}
      ORDER BY "orden" ASC NULLS LAST, "step" ASC`, [curso]
  )).rows : []

  const porModulo = new Map<string, ModuloCuestionarios>()
  for (const f of filas) {
    const m: ModuloCuestionarios = porModulo.get(f.code)
      || { code: f.code, numero: numDe(f.code), lecciones: [], cuestionarios: [], totalPreguntas: 0 }
    if (!m.lecciones.includes(f.step)) m.lecciones.push(f.step)
    for (const c of deriveCuestionarios(f)) {
      m.cuestionarios.push({ ...c, step: f.step })
      m.totalPreguntas += c.preguntas.length
    }
    porModulo.set(f.code, m)
  }

  return { cursos, cursosGuia, curso, modulos: Array.from(porModulo.values()) }
}
