import 'server-only';
import { query } from '@/lib/postgres';
import { ids } from '@/lib/id-generator';
import { parseHorario, fechasEntre } from '@/lib/cursos-campaign';

/**
 * Generación de eventos de CALENDARIO a partir de un curso de campaña.
 *
 * Cada curso (campaña + tipo + salón + guía + horario + inicio/final + cupos) se
 * expande a N sesiones reales: por cada día de la semana del horario, una sesión
 * en cada fecha del intervalo [inicioCurso, finalCurso].
 *
 * Zona horaria: el `dia` se ancla a la hora de Chile (`America/Santiago`, donde
 * opera la academia) — el front lo renderiza en la hora LOCAL de cada cliente, así
 * un usuario en Chile/Colombia/España ve la hora que le corresponde, sin desfases.
 *
 * Tipo de evento: SESSION. (En la UI, el tipo CLUB se muestra como "TALLER".)
 */

const PLATAFORMA_TZ = 'America/Santiago';
const MAX_EVENTOS_POR_CURSO = 2000;

export interface CursoParaEventos {
  _id: string;
  campaign: string;
  tipoCurso: string;
  salon?: string | null;
  guia?: string | null;
  horarioCurso: string;
  inicioCurso?: string | null;
  finalCurso?: string | null;
  numeroUsuarios?: number | null;
  linkZoom?: string | null;
}

/** Elimina todos los eventos de CALENDARIO generados por un curso de campaña. */
export async function eliminarEventosCurso(cursoId: string): Promise<number> {
  const r = await query(`DELETE FROM "CALENDARIO" WHERE "cursoCampaignId" = $1`, [cursoId]);
  return r.rowCount ?? 0;
}

/**
 * (Re)genera los eventos de un curso: borra los previos del curso e inserta los
 * nuevos según horario + intervalo de fechas. Idempotente (enlazado por
 * cursoCampaignId). Devuelve la cantidad de eventos creados.
 */
export async function generarEventosCurso(curso: CursoParaEventos): Promise<number> {
  const inicio = curso.inicioCurso ? String(curso.inicioCurso).slice(0, 10) : '';
  const fin = curso.finalCurso ? String(curso.finalCurso).slice(0, 10) : '';
  const parsed = parseHorario(curso.horarioCurso);

  // Siempre limpiamos los previos (regeneración en edición / upsert).
  await eliminarEventosCurso(curso._id);

  if (!parsed || !inicio || !fin) return 0;
  let fechas = fechasEntre(inicio, fin, parsed.dias);
  if (fechas.length === 0) return 0;
  if (fechas.length > MAX_EVENTOS_POR_CURSO) fechas = fechas.slice(0, MAX_EVENTOS_POR_CURSO);

  const hora = parsed.hora.length === 4 ? `0${parsed.hora}` : parsed.hora; // "9:00"→"09:00"
  const salon = (curso.salon || '').trim();
  const titulo = [curso.campaign, curso.tipoCurso, salon].filter(Boolean).join(' - ');
  const advisor = (curso.guia || '').trim();
  const nivel = curso.tipoCurso;
  const limite = Number(curso.numeroUsuarios) || 0;
  const linkZoom = curso.linkZoom || null;

  // INSERT multi-fila. Columnas parametrizadas por evento (14); el resto literales.
  const cols = '"_id","tipo","evento","fecha","hora","dia","advisor","nivel","titulo","tituloONivel","nombreEvento","linkZoom","limiteUsuarios","cursoCampaignId","inscritos","origen","sesionCerrada","_createdDate","_updatedDate"';
  const params: any[] = [];
  const rows: string[] = [];
  fechas.forEach((fecha, r) => {
    const b = r * 14;
    rows.push(
      `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},` +
      `($${b + 6}::timestamp AT TIME ZONE '${PLATAFORMA_TZ}'),` +
      `$${b + 7},$${b + 8},$${b + 9},$${b + 10},$${b + 11},$${b + 12},$${b + 13},$${b + 14},` +
      `0,'POSTGRES',false,NOW(),NOW())`
    );
    params.push(
      ids.event(),      // _id
      'SESSION',        // tipo
      'SESSION',        // evento
      fecha,            // fecha
      hora,             // hora
      `${fecha} ${hora}:00`, // dia (timestamp local → AT TIME ZONE Chile)
      advisor,          // advisor (guía _id)
      nivel,            // nivel (tipoCurso)
      titulo,           // titulo (NOT NULL)
      titulo,           // tituloONivel = "Campaña - Curso - Salón"
      curso.horarioCurso, // nombreEvento = horario
      linkZoom,         // linkZoom
      limite,           // limiteUsuarios
      curso._id,        // cursoCampaignId
    );
  });

  await query(`INSERT INTO "CALENDARIO" (${cols}) VALUES ${rows.join(', ')}`, params);
  return fechas.length;
}
