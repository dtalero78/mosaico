'use client'

import { useState, useEffect } from 'react'
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
  evento: 'SESSION' | 'CLUB' | 'WELCOME'
  dia: string
  advisor: string
  tituloONivel: string
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
  pruebainter?: string | null
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
  // Only used for F3 Step 45 (Jump): routes promotion to MASTER/IELS/B2FIRST/TOEFL
  const [pruebainter, setPruebainter] = useState<string>('')

  useEffect(() => {
    if (selectedStudent?.classRecord) {
      setAsistencia(selectedStudent.classRecord.asistencia || false)
      setParticipacion(selectedStudent.classRecord.participacion || false)
      setNoAprobo((selectedStudent.classRecord as any).noAprobo || false)
      setCalificacion(selectedStudent.classRecord.calificacion || '')
      setComentarios(selectedStudent.classRecord.comentarios || '')
      setAdvisorAnotaciones(selectedStudent.classRecord.advisorAnotaciones || '')
      setActividadPropuesta(selectedStudent.classRecord.actividadPropuesta || '')
      setPruebainter(selectedStudent.pruebainter || '')
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
    setPruebainter('')
  }

  const isJumpStep = () => {
    if (!evento?.nombreEvento) return false
    const stepMatch = evento.nombreEvento.match(/Step\s+(\d+)/i)
    if (!stepMatch) return false
    const stepNumber = parseInt(stepMatch[1])
    const JUMP_STEPS = [5, 10, 15, 20, 25, 30, 35, 40, 45]
    return JUMP_STEPS.includes(stepNumber)
  }

  // F3 Step 45 (Jump) → show "Pruebas Internacionales" box for routing promotion
  const isStep45 = () => {
    if (!evento?.nombreEvento) return false
    const stepMatch = evento.nombreEvento.match(/Step\s+(\d+)/i)
    return !!stepMatch && parseInt(stepMatch[1]) === 45
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

  const handleSaveClassRecord = async () => {
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
          // pruebainter is only sent when the event is Step 45 (Jump)
          // Empty string → null (default → MASTER); 'IELTS'/'B2F'/'TOEF' → that nivel
          pruebainter: isStep45() ? (pruebainter || null) : undefined,
        })
      })

      if (!response.ok) throw new Error('Error al guardar')

      const data = await response.json()

      if (data.success) {
        alert('Datos guardados exitosamente')
        onDataUpdate()

        // Debug code removed - diagnostic endpoint no longer needed after Wix → PostgreSQL migration
      } else {
        throw new Error(data.error)
      }
    } catch (err) {
      console.error('Error saving class record:', err)
      alert('Error al guardar los datos')
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

            {/* Asistencia y Participación + Pruebas Internacionales (Step 45) */}
            <div className={isStep45() ? 'grid grid-cols-1 md:grid-cols-2 gap-4' : ''}>
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

              {/* Pruebas Internacionales — solo en Step 45 (F3 Jump) */}
              {isStep45() && (
                <div className="bg-white rounded-lg shadow-sm p-6">
                  <h3 className="font-semibold text-gray-900 mb-1">Pruebas Internacionales</h3>
                  <p className="text-xs text-gray-500 mb-4">
                    Define la promoción al aprobar el Jump. Sin selección → MASTER.
                  </p>
                  <div className="space-y-3">
                    {[
                      { value: '',        label: 'Ninguna (→ MASTER · Step 46)' },
                      { value: 'IELTS',   label: 'IELTS (→ IELTS · Step 47)' },
                      { value: 'B2FIRST', label: 'B2 First (→ B2FIRST · Step 48)' },
                      { value: 'TOEFL',   label: 'TOEFL (→ TOEFL · Step 49)' },
                    ].map(opt => (
                      <label key={opt.value || 'none'} className={`flex items-center gap-3 ${isLocked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
                        <input
                          type="radio"
                          name="pruebainter"
                          value={opt.value}
                          checked={pruebainter === opt.value}
                          onChange={(e) => setPruebainter(e.target.value)}
                          disabled={isLocked}
                          className="w-4 h-4 text-primary-600 focus:ring-primary-500 disabled:cursor-not-allowed"
                        />
                        <span className="text-gray-700 text-sm">{opt.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
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
    </div>
  )
}
