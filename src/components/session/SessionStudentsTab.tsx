'use client'

import { useState, useEffect, type ComponentType } from 'react'
import toast from 'react-hot-toast'
import {
  CheckCircleIcon,
  XCircleIcon,
  UserGroupIcon,
  ChatBubbleLeftRightIcon,
  DocumentTextIcon,
  ExclamationTriangleIcon,
  HandRaisedIcon,
} from '@heroicons/react/24/outline'
import ReportarCasoModal from './ReportarCasoModal'
import { isJumpStep as esJumpStep } from '@/lib/motor-academico'

interface CalendarioEvent {
  _id: string
  nombreEvento: string
  evento: 'SESSION' | 'CLUB' | 'WELCOME' | 'NIVELACION' | 'OLIMPIADA'
  tipo?: string
  dia: string
  advisor: string
  tituloONivel: string
  nivel?: string   // MOSAICO: = tipoCurso del evento (YOJI, KODOMO, …) — curso para las lecciones de nivelación
  step?: string
  observaciones?: string
  limiteUsuarios: number
  linkZoom?: string
}

interface ClassRecord {
  _id: string
  idEstudiante: string
  idEvento: string
  asistencia: boolean
  participacion: boolean
  calificacion?: string
  comentarios?: string
  advisorAnotaciones?: string
  actividadPropuesta?: string
  hePuntualidad?: boolean
  heAsignacion?: boolean
  daDominio?: boolean
  daDesafio?: boolean
  acPermanencia?: boolean
  acRespeto?: boolean
  acDisposicion?: boolean
  nivel?: string
  step?: string
  noAprobo?: boolean
  /** Cómo le fue en su clase ANTERIOR de este curso (para el aviso de inasistencia). */
  prevFecha?: string | null
  prevAsistio?: boolean | null
  prevLeccion?: string | null
}

interface StudentWithClass {
  _id: string
  primerNombre: string
  primerApellido: string
  segundoApellido?: string
  email?: string
  celular?: string
  plataforma?: string
  edad?: number
  pais?: string
  hobbies?: string
  foto?: string
  nivel?: string
  step?: string
  classRecord?: ClassRecord
}

interface SessionStudentsTabProps {
  evento: CalendarioEvent
  students: StudentWithClass[]
  selectedStudent: StudentWithClass | null
  onStudentSelect: (student: StudentWithClass | null) => void
  onDataUpdate: () => void
  /** Si false → inputs deshabilitados (fuera de ventana o sesión cerrada). Default true. */
  canMarkAttendance?: boolean
  /** Mensaje a mostrar en el banner cuando `!canMarkAttendance`. */
  attendanceLockedReason?: string | null
}

/**
 * Cómo le fue al alumno en su clase ANTERIOR de este curso.
 *
 * El Guía necesita saber, al abrir a un alumno, si viene de faltar — hoy tenía que
 * salir a buscarlo al historial. Mismo lenguaje que el óvalo del Reporte Académico:
 * verde cumplió, rojo no. Sin clase anterior (su primera sesión) no se muestra
 * nada: un indicador en gris se leería como una falta.
 */
function SesionAnteriorBadge({ rec }: { rec?: ClassRecord }) {
  const fecha = rec?.prevFecha
  if (!fecha) return null
  const asistio = rec?.prevAsistio === true
  const cuando = new Date(fecha).toLocaleDateString('es', {
    day: 'numeric', month: 'short',
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  })
  const detalle = rec?.prevLeccion ? `${rec.prevLeccion} · ${cuando}` : cuando
  return (
    <span
      title={`Clase anterior (${detalle}): ${asistio ? 'asistió' : 'no asistió'}`}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${
        asistio ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                : 'border-red-300 bg-red-50 text-red-700'}`}
    >
      {asistio ? <CheckCircleIcon className="h-4 w-4" /> : <XCircleIcon className="h-4 w-4" />}
      {asistio ? 'Asistió la clase anterior' : 'Faltó la clase anterior'}
      <span className="font-normal opacity-80">· {cuando}</span>
    </span>
  )
}

/** Fila de criterio: casilla + ícono + texto (estilo ítem del sidebar). */
function CritRow({ Icon, checked, onChange, disabled, label }: {
  Icon: ComponentType<{ className?: string }>
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  label: string
}) {
  return (
    <label className={`flex items-center gap-3 ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="w-5 h-5 text-primary-600 rounded focus:ring-primary-500 disabled:cursor-not-allowed"
      />
      <Icon className="h-5 w-5 text-gray-400 flex-shrink-0" />
      <span className="text-gray-700">{label}</span>
    </label>
  )
}

export default function SessionStudentsTab({
  evento,
  students,
  selectedStudent,
  onStudentSelect,
  onDataUpdate,
  canMarkAttendance = true,
  attendanceLockedReason = null,
}: SessionStudentsTabProps) {
  const isLocked = !canMarkAttendance
  // Form states
  const [asistencia, setAsistencia] = useState(false)
  const [participacion, setParticipacion] = useState(false)
  const [noAprobo, setNoAprobo] = useState(false)
  // Criterios de evaluación de la sesión (Hábitos / Desempeño / Actitudes).
  // asistencia = HE_ASISTENCIA, participacion = DA_PARTICIPACION (reusados).
  const [hePuntualidad, setHePuntualidad] = useState(false)
  const [heAsignacion, setHeAsignacion] = useState(false)
  const [daDominio, setDaDominio] = useState(false)
  const [daDesafio, setDaDesafio] = useState(false)
  const [acPermanencia, setAcPermanencia] = useState(false)
  const [acRespeto, setAcRespeto] = useState(false)
  const [acDisposicion, setAcDisposicion] = useState(false)
  const [comentarios, setComentarios] = useState('')
  // Modal de "Reportar caso": ÚNICO origen de un Caso de Atención. El textarea
  // que había aquí se retiró — el reporte alimenta el módulo de Casos y también
  // el informe de Servicio.
  const [reportarCaso, setReportarCaso] = useState(false)
  // La caja "Actividad Propuesta (IA)" se movió al botón "Actividad IA" de la
  // barra de pestañas: ahora es UNA actividad para todo el grupo. El valor ya
  // guardado en el booking se conserva y se reenvía tal cual al guardar, así que
  // ningún texto escrito antes se pierde ni se pisa con vacío.
  const [actividadPropuesta, setActividadPropuesta] = useState('')

  // Nivelación (ACADEMICA.nivelacion / detalleNivelacion) — casilla + dropdown de lecciones
  const [nivelacion, setNivelacion] = useState(false)
  const [nivelacionLeccion, setNivelacionLeccion] = useState('')
  /** Módulo elegido para la nivelación. Arranca en el del alumno, pero se puede
   *  cambiar: la nivelación puede ser sobre cualquier punto del curso. */
  const [nivelacionModulo, setNivelacionModulo] = useState('')
  const [lecciones, setLecciones] = useState<Array<{ value: string; label: string; modulo: string }>>([])
  const [moduloActual, setModuloActual] = useState<string | null>(null)
  const [savingNivel, setSavingNivel] = useState(false)

  // Cierre de nivelación cuando el EVENTO es tipo NIVELACION
  const esNivelacionEvent = (evento?.tipo || evento?.evento) === 'NIVELACION'
  // Curso del evento (en MOSAICO evento.nivel = tipoCurso: YOJI/OKINA/…).
  const cursoUpper = String(evento?.nivel || (evento as any)?.curso || '').trim().toUpperCase()
  // Curso IMPULSA (cualquier salón): oculta la casilla de Nivelación.
  const esImpulsa = cursoUpper === 'IMPULSA'
  // Cursos MOSAICO soroban: ocultan la casilla "Participó en la Sesión".
  // IMPULSA la conserva. (La "Actividad Propuesta (IA)" ya no vive aquí: se
  // movió al botón "Actividad IA" de la barra de pestañas, para todo el grupo.)
  const esCursoMosaico = ['YOJI', 'OKINA', 'KODOMO', 'DANSHI', 'SENPAI'].includes(cursoUpper)
  // Excepción: en un evento tipo NIVELACION el cierre EXIGE marcar asistencia Y
  // participación (ver handleSaveClassRecord), así que ahí la casilla se mantiene
  // aunque el curso sea MOSAICO — si no, la nivelación no se podría cerrar.
  const mostrarParticipacion = !esCursoMosaico || esNivelacionEvent
  const [showNivelComentario, setShowNivelComentario] = useState(false)
  const [nivelComentarioText, setNivelComentarioText] = useState('')
  const [showNivelReminder, setShowNivelReminder] = useState(false)
  // Aviso al guardar sin marcar nada (evento normal).
  const [showEmptyWarn, setShowEmptyWarn] = useState(false)
  const [savingNivelClose, setSavingNivelClose] = useState(false)

  // Cargar lecciones del curso del evento (evento.nivel = tipoCurso en MOSAICO)
  useEffect(() => {
    const curso = evento?.nivel
    if (!curso) { setLecciones([]); return }
    fetch(`/api/postgres/niveles?curso=${encodeURIComponent(curso)}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(d => {
        const opts: Array<{ value: string; label: string; modulo: string }> = []
        ;(d.modulos || []).forEach((m: any) => (m.steps || []).forEach((s: string) => opts.push({ value: s, label: `${m.code} · ${s}`, modulo: m.code })))
        setLecciones(opts)
      })
      .catch(() => setLecciones([]))
  }, [evento?.nivel])

  // Cargar estado de nivelación del estudiante seleccionado
  useEffect(() => {
    if (!selectedStudent?._id) { setNivelacion(false); setNivelacionLeccion(''); setNivelacionModulo(''); setModuloActual(null); return }
    fetch(`/api/postgres/students/${selectedStudent._id}/nivelacion`, { cache: 'no-store' })
      .then(r => r.json())
      .then(d => {
        setNivelacion(d.nivelacion === true)
        setNivelacionLeccion(d.detalleNivelacion?.leccion || '')
        setModuloActual(d.moduloActual || null)
        // Si ya había una nivelación marcada se respeta SU módulo; si no, se
        // propone el del alumno, que es el caso habitual.
        setNivelacionModulo(d.detalleNivelacion?.modulo || d.moduloActual || '')
      })
      .catch(() => { setNivelacion(false); setNivelacionLeccion(''); setNivelacionModulo(''); setModuloActual(null) })
  }, [selectedStudent?._id])

  // Guarda nivelación inmediatamente (al marcar la casilla o elegir lección)
  const saveNivelacion = async (checked: boolean, modulo: string, leccion: string) => {
    if (!selectedStudent?._id) return
    setSavingNivel(true)
    try {
      const r = await fetch(`/api/postgres/students/${selectedStudent._id}/nivelacion`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nivelacion: checked,
          leccion: checked && leccion ? leccion : null,
          modulo: checked && modulo ? modulo : null,
        }),
      }).then(x => x.json())
      if (r.error) throw new Error(r.error)
      toast.success('Nivelación actualizada')
    } catch (e: any) {
      toast.error(e?.message || 'Error al guardar nivelación')
    } finally {
      setSavingNivel(false)
    }
  }

  useEffect(() => {
    if (selectedStudent?.classRecord) {
      setAsistencia(selectedStudent.classRecord.asistencia || false)
      setParticipacion(selectedStudent.classRecord.participacion || false)
      setNoAprobo((selectedStudent.classRecord as any).noAprobo || false)
      setComentarios(selectedStudent.classRecord.comentarios || '')
      setActividadPropuesta(selectedStudent.classRecord.actividadPropuesta || '')
      const cr = selectedStudent.classRecord as any
      setHePuntualidad(cr.hePuntualidad || false)
      setHeAsignacion(cr.heAsignacion || false)
      setDaDominio(cr.daDominio || false)
      setDaDesafio(cr.daDesafio || false)
      setAcPermanencia(cr.acPermanencia || false)
      setAcRespeto(cr.acRespeto || false)
      setAcDisposicion(cr.acDisposicion || false)
    } else {
      resetForm()
    }
  }, [selectedStudent])

  const resetForm = () => {
    setAsistencia(false)
    setParticipacion(false)
    setNoAprobo(false)
    setComentarios('')
    setActividadPropuesta('')
    setHePuntualidad(false)
    setHeAsignacion(false)
    setDaDominio(false)
    setDaDesafio(false)
    setAcPermanencia(false)
    setAcRespeto(false)
    setAcDisposicion(false)
  }

  // La regla del jump vive en lib/motor-academico. Aqui habia una lista literal
  // [5..45]; la canonica es aritmetica (multiplos de 5).
  const isJumpStep = () => esJumpStep(evento?.nombreEvento)

  const doSaveClassRecord = async (comentarioNivel?: string) => {
    if (!selectedStudent) return
    try {
      // Extraer solo el número del step del nombreEvento
      // Ej: "Step 5 Club - Conversation Practice" → "Step 5"
      const extractStepNumber = (nombreEvento: string): string => {
        const match = nombreEvento.match(/Step\s+(\d+)/i)
        return match ? `Step ${match[1]}` : nombreEvento
      }

      const response = await fetch('/api/postgres/academic-record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idEstudiante: selectedStudent._id,
          idEvento: evento._id,
          asistencia,
          participacion,
          noAprobo,
          hePuntualidad,
          heAsignacion,
          daDominio,
          daDesafio,
          acPermanencia,
          acRespeto,
          acDisposicion,
          // `calificacion` NO se envía: se retiró del panel porque MOSAICO no la
          // usa. El endpoint sólo la toca si viene, así que lo ya guardado en
          // bookings antiguos se conserva.
          comentarios,
          // `advisorAnotaciones` NO se envía a propósito: el endpoint recalcula
          // `casoAtencion` a partir de este campo, así que mandarlo vacío
          // cerraría el caso al guardar la evaluación. Ahora lo escribe sólo el
          // flujo de "Reportar caso".
          actividadPropuesta,
          nivel: evento?.tituloONivel,
          step: evento?.nombreEvento ? extractStepNumber(evento.nombreEvento) : evento?.nombreEvento,
          ...(comentarioNivel !== undefined ? { nivelacionComentario: comentarioNivel } : {}),
        })
      })

      if (!response.ok) {
        let msg = 'Error al guardar'
        try { const j = await response.json(); msg = j.error || j.message || msg } catch {}
        throw new Error(msg)
      }

      const data = await response.json()
      if (data.success) {
        alert('Datos guardados exitosamente')
        onDataUpdate()
      } else {
        throw new Error(data.error)
      }
    } catch (err: any) {
      console.error('Error saving class record:', err)
      alert(err?.message || 'Error al guardar los datos')
    }
  }

  const handleSaveClassRecord = async () => {
    if (!selectedStudent) return
    // Evento tipo NIVELACION: el guardado CIERRA la nivelación.
    //  - Asistió Y Participó → modal de comentario obligatorio → REALIZADA.
    //  - Ninguna → no asistió (guarda directo; backend limpia detalle y baja conteo).
    //  - Solo una → recordatorio (requiere ambas).
    if (esNivelacionEvent) {
      if (asistencia && participacion) {
        setNivelComentarioText('')
        setShowNivelComentario(true)
        return
      }
      if (!asistencia && !participacion) {
        await doSaveClassRecord()
        return
      }
      setShowNivelReminder(true)
      return
    }
    // Evento normal: si no se marcó NADA, avisar antes de guardar.
    const vacio = !asistencia && !participacion && !noAprobo
      && !hePuntualidad && !heAsignacion && !daDominio && !daDesafio
      && !acPermanencia && !acRespeto && !acDisposicion
      && !comentarios.trim()
      && !actividadPropuesta.trim()
    if (vacio) { setShowEmptyWarn(true); return }
    await doSaveClassRecord()
  }

  const confirmNivelComentario = async () => {
    const c = nivelComentarioText.trim()
    if (!c) return
    setSavingNivelClose(true)
    try {
      await doSaveClassRecord(c)
      setShowNivelComentario(false)
    } finally {
      setSavingNivelClose(false)
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Lista de estudiantes */}
      <div className="lg:col-span-1">
        <div className="bg-white rounded-lg shadow-sm">
          <div className="p-4 border-b border-gray-200 bg-gray-50">
            <h2 className="font-semibold text-gray-900">Estudiantes Inscritos</h2>
            <p className="text-sm text-gray-600 mt-1">
              {students.length} / {evento.limiteUsuarios} estudiantes
            </p>
          </div>
          <div className="divide-y divide-gray-200 max-h-[600px] overflow-y-auto">
            {students.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                <UserGroupIcon className="h-12 w-12 mx-auto mb-3 text-gray-400" />
                <p>No hay estudiantes inscritos</p>
              </div>
            ) : (
              students.map((student) => (
                <button
                  key={student._id}
                  onClick={() => onStudentSelect(student)}
                  className={`w-full text-left p-4 hover:bg-gray-50 transition-colors ${
                    selectedStudent?._id === student._id ? 'bg-primary-50 border-l-4 border-primary-500' : ''
                  }`}
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <p className="font-medium text-gray-900">
                          {student.primerNombre} {student.primerApellido}
                        </p>
                        <p className="text-sm text-gray-600">{student.plataforma || '-'}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {student.classRecord?.asistencia && (
                          <CheckCircleIcon className="h-5 w-5 text-green-600" title="Asistió" />
                        )}
                      </div>
                    </div>

                    {/* Tags de edad y país */}
                    <div className="flex gap-2">
                      {student.edad && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800">
                          {student.edad} años
                        </span>
                      )}
                      {student.pais && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-800">
                          {student.pais}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Panel de calificación */}
      <div className="lg:col-span-2 space-y-6">
        {/* Banner global: fuera de ventana o sesión cerrada → todo read-only */}
        {isLocked && attendanceLockedReason && (
          <div className="bg-amber-50 border-l-4 border-amber-500 rounded-r-lg p-4 flex items-start gap-3">
            <ExclamationTriangleIcon className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-amber-900">{attendanceLockedReason}</p>
          </div>
        )}

        {!selectedStudent ? (
          <div className="bg-white rounded-lg shadow-sm p-8 text-center">
            <UserGroupIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600">Selecciona un estudiante de la lista para calificar</p>
          </div>
        ) : (
          <>
            {/* Información del estudiante */}
            <div className="bg-white rounded-lg shadow-sm p-6">
              <div className="flex flex-wrap items-center gap-3 mb-4">
                <h2 className="text-xl font-semibold text-gray-900">
                  {selectedStudent.primerNombre} {selectedStudent.primerApellido}
                </h2>
                <SesionAnteriorBadge rec={selectedStudent.classRecord} />
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-gray-600">Plataforma:</span>
                  <span className="ml-2 font-medium">{selectedStudent.plataforma || '-'}</span>
                </div>
                <div>
                  <span className="text-gray-600">Email:</span>
                  <span className="ml-2 font-medium">{selectedStudent.email || '-'}</span>
                </div>
                {selectedStudent.hobbies && (
                  <div className="col-span-2">
                    <span className="text-gray-600">Hobbies:</span>
                    <span className="ml-2 font-medium">{selectedStudent.hobbies}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Asistencia y Participación */}
            <div>
              <div className="bg-white rounded-lg shadow-sm p-6">
                <h3 className="font-semibold text-gray-900 mb-4">Asistencia</h3>
                <div className="space-y-5">
                  <div className="space-y-3">
                    <CritRow Icon={CheckCircleIcon} checked={asistencia} onChange={setAsistencia} disabled={isLocked} label="Asistió a la sesión" />
                    {mostrarParticipacion && (
                      <CritRow Icon={HandRaisedIcon} checked={participacion} onChange={setParticipacion} disabled={isLocked} label="Participó en la Sesión" />
                    )}
                  </div>
                  {/* Nivelación — casilla + dropdown de lecciones del curso.
                      Se OCULTA cuando el evento es tipo NIVELACION (el evento ya
                      es la nivelación; marcar asistencia la cierra) o cuando el
                      curso es IMPULSA (no usa nivelación). */}
                  {!esNivelacionEvent && !esImpulsa && (
                  <div>
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={nivelacion}
                        onChange={(e) => {
                          const c = e.target.checked
                          setNivelacion(c)
                          if (!c) setNivelacionLeccion('')
                          saveNivelacion(c, c ? nivelacionModulo : '', c ? nivelacionLeccion : '')
                        }}
                        className="w-5 h-5 text-amber-600 rounded focus:ring-amber-500"
                      />
                      <span className="text-gray-700 font-medium">Nivelación</span>
                      {savingNivel && <span className="text-xs text-gray-400">guardando…</span>}
                    </label>
                    {(() => {
                      // Módulo y lección se eligen APARTE: la nivelación puede ser
                      // sobre cualquier punto del curso, no sólo sobre el módulo en
                      // que va el alumno (arrastra algo de un módulo anterior). El
                      // módulo llega preseleccionado en el suyo, que es el caso
                      // habitual, y las lecciones se acotan al módulo elegido.
                      const modulos: string[] = []
                      for (const l of lecciones) if (!modulos.includes(l.modulo)) modulos.push(l.modulo)
                      const leccionesModulo = nivelacionModulo
                        ? lecciones.filter(l => l.modulo === nivelacionModulo)
                        : []
                      return (
                        <div className="mt-2 ml-8 w-[calc(100%-2rem)] grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <select
                            value={nivelacionModulo}
                            onChange={(e) => {
                              const m = e.target.value
                              setNivelacionModulo(m)
                              // Al cambiar de módulo la lección deja de pertenecerle:
                              // se limpia y se guarda así, para que lo registrado no
                              // contradiga al módulo elegido.
                              setNivelacionLeccion('')
                              if (nivelacion) saveNivelacion(true, m, '')
                            }}
                            disabled={!nivelacion || !modulos.length}
                            className="px-3 py-2 border border-gray-300 rounded-lg text-sm disabled:bg-gray-100 disabled:cursor-not-allowed"
                          >
                            <option value="">— Módulo —</option>
                            {modulos.map(m => (
                              <option key={m} value={m}>{m}{m === moduloActual ? ' (actual)' : ''}</option>
                            ))}
                          </select>
                          <select
                            value={nivelacionLeccion}
                            onChange={(e) => { const v = e.target.value; setNivelacionLeccion(v); saveNivelacion(true, nivelacionModulo, v) }}
                            disabled={!nivelacion || !leccionesModulo.length}
                            className="px-3 py-2 border border-gray-300 rounded-lg text-sm disabled:bg-gray-100 disabled:cursor-not-allowed"
                          >
                            <option value="">{nivelacionModulo ? '— Lección —' : '— Elige módulo primero —'}</option>
                            {leccionesModulo.map(l => <option key={l.value} value={l.value}>{l.value}</option>)}
                          </select>
                        </div>
                      )
                    })()}
                  </div>
                  )}
                  {isJumpStep() && (
                    <label className={`flex items-center gap-3 ${isLocked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
                      <input
                        type="checkbox"
                        checked={noAprobo}
                        onChange={(e) => setNoAprobo(e.target.checked)}
                        disabled={isLocked}
                        className="w-5 h-5 text-red-600 rounded focus:ring-red-500 disabled:cursor-not-allowed"
                      />
                      <span className="text-red-700 font-medium">No aprobó (Jump Step)</span>
                    </label>
                  )}
                </div>
              </div>
            </div>

            {/* Comentarios para el usuario */}
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <ChatBubbleLeftRightIcon className="h-5 w-5" />
                Comentarios para el Usuario
              </h3>
              <textarea
                value={comentarios}
                onChange={(e) => setComentarios(e.target.value)}
                disabled={isLocked}
                rows={4}
                placeholder="Escribe comentarios que verá el estudiante..."
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none disabled:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
              />
            </div>

            {/* Casos de Atención */}
            <div className="bg-white rounded-lg shadow-sm p-6">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                  <DocumentTextIcon className="h-5 w-5" />
                  Casos de Atención
                </h3>
                {/* ÚNICO origen de un caso. El textarea que había aquí se
                    retiró: eran dos formas de reportar lo mismo, y además el
                    caso se cerraba solo si el guía borraba el texto y volvía a
                    guardar. Ahora el reporte alimenta el módulo de Casos y
                    también el informe de Servicio. */}
                <button
                  type="button"
                  onClick={() => setReportarCaso(true)}
                  disabled={isLocked || !selectedStudent?._id}
                  title="Reportar una situación de este estudiante"
                  className="px-3 py-1.5 rounded-lg bg-primary-600 text-white text-xs font-medium hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Reportar caso
                </button>
              </div>
              <p className="text-sm text-gray-500">
                Usa <span className="font-medium text-gray-700">Reportar caso</span> para dejar constancia de una
                situación del estudiante. El reporte no se puede editar ni borrar; queda en su ficha y en el
                módulo de Casos de Atención.
              </p>
            </div>

            {/* Botón Guardar */}
            <div className="bg-white rounded-lg shadow-sm p-6">
              <button
                type="button"
                onClick={handleSaveClassRecord}
                disabled={isLocked}
                className="w-full px-6 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors font-medium disabled:bg-gray-300 disabled:cursor-not-allowed disabled:hover:bg-gray-300"
              >
                {isLocked ? 'Edición bloqueada' : 'Guardar registro Usuario'}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Modal: comentario OBLIGATORIO al cerrar una nivelación (asistió + participó) */}
      {showNivelComentario && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black bg-opacity-60">
          <div className="bg-white rounded-lg max-w-md w-full p-6 shadow-2xl">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Comentario de la nivelación</h3>
            <p className="text-sm text-gray-600 mb-3">
              El estudiante asistió y participó. Registra un comentario sobre la nivelación
              (se guarda en el historial). <span className="text-red-600 font-medium">Obligatorio.</span>
            </p>
            <textarea
              value={nivelComentarioText}
              onChange={(e) => setNivelComentarioText(e.target.value)}
              rows={4}
              autoFocus
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              placeholder="Ej: reforzó suma con soroban; avanzó bien en…"
            />
            <div className="flex justify-end gap-2 mt-4">
              <button type="button" onClick={() => setShowNivelComentario(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50">
                Cancelar
              </button>
              <button type="button" onClick={confirmNivelComentario}
                disabled={!nivelComentarioText.trim() || savingNivelClose}
                className="px-4 py-2 text-sm font-semibold text-white bg-primary-600 rounded hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed">
                {savingNivelClose ? 'Guardando…' : 'Guardar nivelación'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: recordatorio de que la nivelación requiere marcar AMBAS opciones */}
      {showNivelReminder && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black bg-opacity-60">
          <div className="bg-white rounded-lg max-w-md w-full p-6 shadow-2xl">
            <h3 className="text-lg font-semibold text-gray-900 mb-2 flex items-center gap-2">⚠️ Asistencia incompleta</h3>
            <p className="text-sm text-gray-700 mb-4">
              La asistencia de la Nivelación requiere marcar <strong>ambas</strong> opciones:
              <strong> Asistió a la sesión</strong> y <strong>Participó en la Sesión</strong>.
              Si el estudiante no asistió, deja las dos sin marcar.
            </p>
            <div className="flex justify-end">
              <button type="button" onClick={() => setShowNivelReminder(false)}
                className="px-4 py-2 text-sm font-semibold text-white bg-primary-600 rounded hover:bg-primary-700">
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Aviso: guardar sin marcar nada */}
      {showEmptyWarn && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black bg-opacity-60">
          <div className="bg-white rounded-lg max-w-md w-full p-6 shadow-2xl">
            <h3 className="text-lg font-semibold text-gray-900 mb-2 flex items-center gap-2">⚠️ No marcaste nada</h3>
            <p className="text-sm text-gray-700 mb-5">
              No marcaste asistencia ni ninguna evaluación para este estudiante.
              ¿Deseas volver para marcarla, o salir a la lista de estudiantes sin guardar?
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowEmptyWarn(false)}
                className="px-4 py-2 text-sm font-semibold text-gray-700 bg-gray-100 rounded hover:bg-gray-200">
                Cancelar (volver a marcar)
              </button>
              <button type="button"
                onClick={() => { setShowEmptyWarn(false); onStudentSelect(null) }}
                className="px-4 py-2 text-sm font-semibold text-white bg-primary-600 rounded hover:bg-primary-700">
                Aceptar (volver a estudiantes)
              </button>
            </div>
          </div>
        </div>
      )}

      {reportarCaso && selectedStudent && (
        <ReportarCasoModal
          academicaId={selectedStudent._id}
          alumno={`${selectedStudent.primerNombre || ''} ${selectedStudent.primerApellido || ''}`.trim()}
          eventoId={evento?._id}
          bookingId={selectedStudent.classRecord?._id ?? null}
          sesionLabel={evento?.dia
            ? `Sesión del ${new Date(evento.dia).toLocaleDateString('es-CL', { day: '2-digit', month: 'short' })}${evento?.step ? ` · ${evento.step}` : ''}`
            : undefined}
          onClose={() => setReportarCaso(false)}
          onEnviado={(r) => toast.success(
            r.abrioCaso ? `Reporte enviado. Se abrió el caso ${r.codigo}.` : `Reporte agregado al caso ${r.codigo}.`
          )}
        />
      )}
    </div>
  )
}
