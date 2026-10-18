/**
 * Panel del guía — columnas del CSV (cliente).
 *
 * Una fila por alumno con las mismas columnas que la vista; las alertas van como
 * texto (su detalle, con la cifra). Se exporta desde el navegador con
 * `exportToExcel(..., { separator: ';' })`: UTF-8 con BOM y separador `;`, que
 * es lo que el Excel en español abre en columnas. No hay endpoint de exportación,
 * así que no hay una segunda puerta que proteger.
 */
import { hoyEnChile } from './cursos-campaign';
import { formatoNota } from './reglas-alertas-guia';
import type { FilaResumenAlumno } from './resumen-guia';

export interface CursoCsv { tipoCurso: string; salon: string | null; campaign: string; horarioCurso: string }

/** Fecha del instante en hora de Chile (AAAA-MM-DD), o vacío. */
const fechaChile = (iso: string | null) => (iso ? hoyEnChile(new Date(iso)) : '');
const num = (n: number | null) => (n === null ? '' : n);
const nota = (n: number | null) => (n === null ? '' : formatoNota(n));

export function columnasCsvPanelGuia(curso: CursoCsv) {
  type F = FilaResumenAlumno;
  return [
    { header: 'Curso', accessor: (_f: F) => curso.tipoCurso },
    { header: 'Salón', accessor: (_f: F) => curso.salon || '' },
    { header: 'Campaña', accessor: (_f: F) => curso.campaign },
    { header: 'Horario', accessor: (_f: F) => curso.horarioCurso },
    { header: 'Alumno', accessor: (f: F) => f.nombre },
    { header: 'ID', accessor: (f: F) => f.numeroId || '' },
    { header: 'Estado', accessor: (f: F) => (f.estado === 'risk' ? 'Rojo' : f.estado === 'warn' ? 'Ámbar' : 'Sin alertas') },
    { header: 'Últ. asistencia', accessor: (f: F) => fechaChile(f.asistencia.ultimaAsistencia) },
    { header: 'Asistencia %', accessor: (f: F) => num(f.asistencia.pct) },
    { header: 'Presentes', accessor: (f: F) => f.asistencia.presentes },
    { header: 'Sesiones', accessor: (f: F) => f.asistencia.sesiones },
    { header: 'Faltas', accessor: (f: F) => f.asistencia.faltas },
    { header: 'Justificadas', accessor: (f: F) => f.asistencia.justificadas },
    { header: 'Sin marcar', accessor: (f: F) => f.asistencia.sinMarcar },
    { header: 'Faltas seguidas', accessor: (f: F) => f.asistencia.faltasSeguidas },
    { header: 'Lecciones vistas', accessor: (f: F) => f.lecciones.vistas },
    { header: 'Lecciones dictadas', accessor: (f: F) => f.lecciones.dictadas },
    { header: 'Lecciones sin ver', accessor: (f: F) => f.lecciones.sinVer },
    { header: 'Lecciones del programa', accessor: (f: F) => f.lecciones.totalPrograma },
    { header: 'Nivelaciones', accessor: (f: F) => f.nivelaciones.realizadas },
    { header: 'Últ. nivelación', accessor: (f: F) => fechaChile(f.nivelaciones.ultima) },
    { header: 'Nivelación en curso', accessor: (f: F) => (f.nivelaciones.enCurso ? 'Sí' : 'No') },
    { header: 'Casos abiertos', accessor: (f: F) => f.casos.abiertos },
    { header: 'Casos total', accessor: (f: F) => f.casos.total },
    { header: 'Promedio', accessor: (f: F) => nota(f.evaluaciones.promedio) },
    { header: 'Nota mínima', accessor: (f: F) => nota(f.evaluaciones.minima) },
    { header: 'Evaluaciones rendidas', accessor: (f: F) => f.evaluaciones.rendidas },
    { header: 'Evaluaciones dictadas', accessor: (f: F) => f.evaluaciones.dictadas },
    { header: 'Evaluaciones pendientes', accessor: (f: F) => f.evaluaciones.pendientes },
    { header: 'Hábitos %', accessor: (f: F) => num(f.criterios.H) },
    { header: 'Desempeño %', accessor: (f: F) => num(f.criterios.D) },
    { header: 'Actitudes %', accessor: (f: F) => num(f.criterios.A) },
    { header: 'Alertas', accessor: (f: F) => f.alertas.map(a => a.detalle).join(' | ') || 'Sin alertas' },
  ];
}

/** Nombre del archivo: panel-guia_YOJI-02_ABRIL132026M_2026-10-17 */
export function nombreArchivoCsv(curso: CursoCsv, now: Date = new Date()): string {
  const limpio = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `panel-guia_${limpio(curso.tipoCurso)}-${limpio(curso.salon || '')}_${limpio(curso.campaign)}_${hoyEnChile(now)}`;
}
