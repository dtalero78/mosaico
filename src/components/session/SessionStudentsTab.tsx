'use client'

import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import {
  CheckCircleIcon,
  UserGroupIcon,
  ChatBubbleLeftRightIcon,
  DocumentTextIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline'

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
  nivel?: string
  step?: string
  noAprobo?: boolean
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
  const [calificacion, setCalificacion] = useState('')
  const [comentarios, setComentarios] = useState('')
  const [advisorAnotaciones, setAdvisorAnotaciones] = useState('')
  const [actividadPropuesta, setActividadPropuesta] = useState('')
  const [isGeneratingActivity, setIsGeneratingActivity] = useState(false)

  // Nivelación (ACADEMICA.nivelacion / detalleNivelacion) — casilla + dropdown de lecciones
  const [nivelacion, setNivelacion] = useState(false)
  const [nivelacionLeccion, setNivelacionLeccion] = useState('')
  const [lecciones, setLecciones] = useState<Array<{ value: string; label: string; modulo: string }>>([])
  const [moduloActual, setModuloActual] = useState<string | null>(null)
  const [savingNivel, setSavingNivel] = useState(false)

  // Cierre de nivelación cuando el EVENTO es tipo NIVELACION
  const esNivelacionEvent = (evento?.tipo || evento?.evento) === 'NIVELACION'
  const [showNivelComentario, setShowNivelComentario] = useState(false)
  const [nivelComentarioText, setNivelComentarioText] = useState('')
  const [showNivelReminder, setShowNivelReminder] = useState(false)
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
    if (!selectedStudent?._id) { setNivelacion(false); setNivelacionLeccion(''); setModuloActual(null); return }
    fetch(`/api/postgres/students/${selectedStudent._id}/nivelacion`, { cache: 'no-store' })
      .then(r => r.json())
      .then(d => { setNivelacion(d.nivelacion === true); setNivelacionLeccion(d.detalleNivelacion?.leccion || ''); setModuloActual(d.moduloActual || null) })
      .catch(() => { setNivelacion(false); setNivelacionLeccion(''); setModuloActual(null) })
  }, [selectedStudent?._id])

  // Guarda nivelación inmediatamente (al marcar la casilla o elegir lección)
  const saveNivelacion = async (checked: boolean, leccion: string) => {
    if (!selectedStudent?._id) return
    setSavingNivel(true)
    try {
      const modulo = lecciones.find(l => l.value === leccion)?.modulo || null
      const r = await fetch(`/api/postgres/students/${selectedStudent._id}/nivelacion`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nivelacion: checked, leccion: checked ? leccion : null, modulo: checked ? modulo : null }),
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
      setCalificacion(selectedStudent.classRecord.calificacion || '')
      setComentarios(selectedStudent.classRecord.comentarios || '')
      setAdvisorAnotaciones(selectedStudent.classRecord.advisorAnotaciones || '')
      setActividadPropuesta(selectedStudent.classRecord.actividadPropuesta || '')
    } else {
      resetForm()
    }
  }, [selectedStudent])

  const resetForm = () => {
    setAsistencia(false)
    setParticipacion(false)
    setNoAprobo(false)
    setCalificacion('')
    setComentarios('')
    setAdvisorAnotaciones('')
    setActividadPropuesta('')
  }

  const isJumpStep = () => {
    if (!evento?.nombreEvento) return false
    const stepMatch = evento.nombreEvento.match(/Step\s+(\d+)/i)
    if (!stepMatch) return false
    const stepNumber = parseInt(stepMatch[1])
    const JUMP_STEPS = [5, 10, 15, 20, 25, 30, 35, 40, 45]
    return JUMP_STEPS.includes(stepNumber)
  }

  const handleGenerateActivity = async () => {
    if (!selectedStudent || !evento?.tituloONivel) {
      alert('Selecciona un estudiante primero')
      return
    }

    try {
      setIsGeneratingActivity(true)

      const response = await fetch('/api/postgres/academic/activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId: selectedStudent._id,
          nivel: evento.tituloONivel
        })
      })

      if (!response.ok) throw new Error('Error al generar actividad')

      const data = await response.json()

      if (data.success && data.activity) {
        setActividadPropuesta(data.activity)
      } else {
        throw new Error(data.error || 'No se pudo generar la actividad')
      }
    } catch (err) {
      console.error('Error generating activity:', err)
      alert('Error al generar actividad personalizada')
    } finally {
      setIsGeneratingActivity(false)
    }
  }

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
          calificacion,
          comentarios,
          advisorAnotaciones,
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
                        {student.classRecord?.calificacion && (
                          <span className="text-xs px-2 py-1 rounded-full bg-blue-100 text-blue-800">
                            {student.classRecord.calificacion}
                          </span>
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
              <h2 className="text-xl font-semibold text-gray-900 mb-4">
                {selectedStudent.primerNombre} {selectedStudent.primerApellido}
              </h2>
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
                <h3 className="font-semibold text-gray-900 mb-4">Asistencia y Participación</h3>
                <div className="space-y-4">
                  <label className={`flex items-center gap-3 ${isLocked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
                    <input
                      type="checkbox"
                      checked={asistencia}
                      onChange={(e) => setAsistencia(e.target.checked)}
                      disabled={isLocked}
                      className="w-5 h-5 text-primary-600 rounded focus:ring-primary-500 disabled:cursor-not-allowed"
                    />
                    <span className="text-gray-700">Asistió a la clase</span>
                  </label>
                  <label className={`flex items-center gap-3 ${isLocked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
                    <input
                      type="checkbox"
                      checked={participacion}
                      onChange={(e) => setParticipacion(e.target.checked)}
                      disabled={isLocked}
                      className="w-5 h-5 text-primary-600 rounded focus:ring-primary-500 disabled:cursor-not-allowed"
                    />
                    <span className="text-gray-700">Participó activamente</span>
                  </label>
                  {/* Nivelación — casilla + dropdown de lecciones del curso.
                      Se OCULTA cuando el evento es tipo NIVELACION (el evento ya
                      es la nivelación; marcar asistencia la cierra). */}
                  {!esNivelacionEvent && (
                  <div>
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={nivelacion}
                        onChange={(e) => {
                          const c = e.target.checked
                          setNivelacion(c)
                          if (!c) setNivelacionLeccion('')
                          saveNivelacion(c, c ? nivelacionLeccion : '')
                        }}
                        className="w-5 h-5 text-amber-600 rounded focus:ring-amber-500"
                      />
                      <span className="text-gray-700 font-medium">Nivelación</span>
                      {savingNivel && <span className="text-xs text-gray-400">guardando…</span>}
                    </label>
                    {(() => {
                      // Solo las lecciones del módulo ACTUAL del estudiante
                      const leccionesModulo = moduloActual ? lecciones.filter(l => l.modulo === moduloActual) : lecciones
                      return (
                        <select
                          value={nivelacionLeccion}
                          onChange={(e) => { const v = e.target.value; setNivelacionLeccion(v); saveNivelacion(true, v) }}
                          disabled={!nivelacion || !leccionesModulo.length}
                          className="mt-2 ml-8 w-[calc(100%-2rem)] px-3 py-2 border border-gray-300 rounded-lg text-sm disabled:bg-gray-100 disabled:cursor-not-allowed"
                        >
                          <option value="">{moduloActual ? `— Lección de ${moduloActual} —` : '— Selecciona lección —'}</option>
                          {leccionesModulo.map(l => <option key={l.value} value={l.value}>{l.value}</option>)}
                        </select>
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

            {/* Calificación */}
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h3 className="font-semibold text-gray-900 mb-4">Calificación</h3>
              <select
                value={calificacion}
                onChange={(e) => setCalificacion(e.target.value)}
                disabled={isLocked}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <option value="">Seleccionar calificación</option>
                <option value="Excelente">Excelente</option>
                <option value="Muy Bien">Muy Bien</option>
                <option value="Bien">Bien</option>
                <option value="Regular">Regular</option>
                <option value="Necesita Mejorar">Necesita Mejorar</option>
              </select>
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

            {/* Anotaciones del Advisor */}
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <DocumentTextIcon className="h-5 w-5" />
                Anotaciones del Advisor (Privadas)
              </h3>
              <textarea
                value={advisorAnotaciones}
                onChange={(e) => setAdvisorAnotaciones(e.target.value)}
                disabled={isLocked}
                rows={4}
                placeholder="Notas privadas del advisor..."
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none disabled:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
              />
            </div>

            {/* Actividad Propuesta por IA */}
            <div className="bg-white rounded-lg shadow-sm p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                  <svg className="h-5 w-5 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                  Actividad Propuesta (IA)
                </h3>
                <button
                  type="button"
                  onClick={handleGenerateActivity}
                  disabled={isGeneratingActivity || !selectedStudent || isLocked}
                  className="px-3 py-1.5 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {isGeneratingActivity ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                      <span>Generando...</span>
                    </>
                  ) : (
                    <>
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      <span>Generar con IA</span>
                    </>
                  )}
                </button>
              </div>
              <textarea
                value={actividadPropuesta}
                onChange={(e) => setActividadPropuesta(e.target.value)}
                disabled={isLocked}
                rows={6}
                placeholder="Haz clic en 'Generar con IA' para crear una actividad personalizada para este estudiante..."
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none disabled:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
              />
              <p className="text-xs text-gray-500 mt-2">
                La IA genera una actividad personalizada basada en el perfil del estudiante y su nivel
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
                {isLocked ? 'Edición bloqueada' : 'Guardar Calificación y Comentarios'}
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
              <strong> Asistió a la clase</strong> y <strong>Participó activamente</strong>.
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
    </div>
  )
}
