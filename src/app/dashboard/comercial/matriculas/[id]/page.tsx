'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions'
import { ComercialPermission, PersonPermission } from '@/types/permissions'
import { ArrowLeft, ExternalLink, AlertCircle, GraduationCap, Users, BookOpen, UserCheck } from 'lucide-react'
import { isContratoPrueba } from '@/lib/contrato-prueba'

/**
 * Resumen de Matrícula — misma vista que LGS (Comercial › Matrículas › detalle).
 * Se abre desde el botón "Resumen" de la ficha /person (titular o beneficiario).
 *
 * En LGS el bloque de curso/salón/horario/apoderado sólo aparece en los
 * beneficiarios KIDS. En MOSAICO todo beneficiario lo tiene, así que va siempre.
 */

interface Titular {
  _id: string
  primerNombre: string; primerApellido: string
  numeroId: string; contrato: string; plataforma: string; celular: string; email: string
  domicilio?: string; ciudad?: string; fechaNacimiento?: string
  estadoMatricula: string; firmado: boolean
  asesor?: string; asesorMail?: string; liderComercial?: string
  inicioContrato?: string; fechaContrato?: string; finalContrato?: string
  vigencia?: string | number; modulo?: boolean
}
interface Beneficiario {
  _id: string
  primerNombre: string; primerApellido: string
  numeroId: string; celular: string; email: string; plataforma: string; fechaNacimiento?: string
  campaign?: string; tipoCurso?: string; horarioCurso?: string; salon?: string
  apoderado?: string; apoderadoTelefono?: string; apoderadoMail?: string
  academicaId?: string | null; nivel?: string; step?: string; userLogin?: string
  academicaInactivo?: boolean; tienePerfilAcademico: boolean; enWelcome: boolean
  enOnHold: boolean; suspendido: boolean
  cupo: 'CONFIRMADO' | 'PROVISIONAL' | 'LIBERADO'
}

const nombre = (p: any) => `${p.primerNombre || ''} ${p.primerApellido || ''}`.trim()
const inicial = (p: any) => (p.primerNombre || p.primerApellido || '?').charAt(0).toUpperCase()
// Las columnas DATE llegan como 'YYYY-MM-DD' (sin hora): se leen en UTC para que
// desde Chile o Colombia no se pinten un día antes.
const fmtFecha = (v: any) => {
  if (!v) return '—'
  const d = new Date(String(v).length === 10 ? `${v}T00:00:00Z` : v)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('es', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' })
}

function estadoBadge(estado?: string) {
  const e = (estado || '').toLowerCase()
  if (e.includes('aprobad')) return 'bg-green-100 text-green-800'
  if (e.includes('gestión') || e.includes('gestion')) return 'bg-sky-100 text-sky-800'
  if (e.includes('pendiente')) return 'bg-yellow-100 text-yellow-800'
  if (e.includes('devuelto')) return 'bg-blue-100 text-blue-800'
  if (e.includes('rechaz') || e.includes('nulo') || e.includes('retract')) return 'bg-red-100 text-red-800'
  return 'bg-gray-200 text-gray-700'
}

const CUPO_META: Record<Beneficiario['cupo'], { label: string; cls: string }> = {
  CONFIRMADO: { label: 'Cupo confirmado', cls: 'bg-green-100 text-green-800' },
  PROVISIONAL: { label: 'Cupo provisional', cls: 'bg-amber-100 text-amber-800' },
  LIBERADO: { label: 'Cupo liberado', cls: 'bg-gray-200 text-gray-700' },
}

export default function MatriculaDetallePage() {
  const params = useParams()
  const router = useRouter()
  const id = params?.id as string

  const [loading, setLoading] = useState(true)
  const [titular, setTitular] = useState<Titular | null>(null)
  const [beneficiarios, setBeneficiarios] = useState<Beneficiario[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    ;(async () => {
      setLoading(true)
      try {
        const r = await fetch(`/api/postgres/matriculas/${id}`, { cache: 'no-store' })
        const j = await r.json()
        if (!r.ok) { setError(j?.error || 'No se pudo cargar la matrícula'); return }
        setTitular(j.titular); setBeneficiarios(j.beneficiarios || [])
      } catch { setError('Error al cargar la matrícula') } finally { setLoading(false) }
    })()
  }, [id])

  const prueba = titular ? isContratoPrueba(titular.contrato) : false

  return (
    <DashboardLayout>
      <PermissionGuard anyPermissions={[PersonPermission.RESUMEN, ComercialPermission.MATRICULAS_DETALLE]} showDefaultMessage>
        <div className="max-w-6xl mx-auto space-y-6 py-2">
          {/* Header */}
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => router.back()} title="Volver" className="p-2 rounded-lg hover:bg-gray-200">
              <ArrowLeft className="h-5 w-5 text-gray-600" />
            </button>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Resumen de Matrícula</h1>
              {titular && <p className="text-sm text-gray-500">Contrato {titular.contrato} · {titular.plataforma}</p>}
            </div>
          </div>

          {loading ? (
            <div className="bg-white rounded-xl border p-12 text-center"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600 mx-auto" /><p className="mt-3 text-gray-500 text-sm">Cargando...</p></div>
          ) : error ? (
            <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-red-700">{error}</div>
          ) : titular && (
            <>
              {/* Tarjeta del TITULAR */}
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="bg-gradient-to-r from-primary-700 to-accent-600 px-5 py-4 flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 text-white min-w-0">
                    <div className="h-14 w-14 rounded-full bg-white/25 flex items-center justify-center text-xl font-bold ring-2 ring-white/40 shrink-0">{inicial(titular)}</div>
                    <div className="min-w-0">
                      <div className="text-xs uppercase tracking-wide opacity-80">Titular</div>
                      <div className="text-lg font-bold leading-tight truncate">{nombre(titular)}</div>
                      <div className="text-xs opacity-90">ID {titular.numeroId} · {titular.contrato}</div>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${estadoBadge(titular.estadoMatricula)}`} title="Estado del contrato">
                      {titular.estadoMatricula}
                    </span>
                    <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${titular.firmado ? 'bg-white/90 text-emerald-700' : 'bg-white/90 text-gray-600'}`}>
                      {titular.firmado ? '✓ Firmado' : 'Sin firmar'}
                    </span>
                    {prueba && <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-orange-500 text-white">🧪 Contrato de prueba</span>}
                  </div>
                </div>
                <div className="p-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3 text-sm">
                  <Field label="Documento" value={titular.numeroId} />
                  <Field label="Plataforma" value={titular.plataforma} />
                  <Field label="Asesor" value={titular.asesor || '—'} sub={titular.asesorMail || undefined} />
                  <Field label="Celular" value={titular.celular || '—'} />
                  <Field label="Email" value={titular.email || '—'} />
                  <Field label="Líder comercial" value={titular.liderComercial || '—'} />
                  <Field label="Domicilio" value={titular.domicilio || '—'} />
                  <Field label="Ciudad" value={titular.ciudad || '—'} />
                  <Field label="Fecha de nacimiento" value={fmtFecha(titular.fechaNacimiento)} />
                  <Field label="Vigencia (meses)" value={`${titular.vigencia ?? '—'}${titular.modulo ? ' · Módulo' : ''}`} />
                  <Field label="Inicio contrato" value={fmtFecha(titular.inicioContrato || titular.fechaContrato)} />
                  <Field label="Fin contrato" value={fmtFecha(titular.finalContrato)} />
                  <div className="flex items-end">
                    <a href={`/person/${titular._id}`} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white">
                      <ExternalLink className="h-3.5 w-3.5" /> Ver ficha completa
                    </a>
                  </div>
                </div>
              </div>

              {/* Beneficiarios */}
              <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <Users className="h-5 w-5 text-gray-500" /> Beneficiarios ({beneficiarios.length})
                </h2>

                {beneficiarios.length === 0 ? (
                  <div className="bg-white rounded-xl border border-dashed border-gray-300 p-8 text-center">
                    <AlertCircle className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                    <p className="text-gray-500 font-medium">No hay beneficiarios</p>
                    <p className="text-xs text-gray-400 mt-0.5">Este contrato no tiene beneficiarios registrados.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {beneficiarios.map(b => {
                      const conPerfil = !!b.tienePerfilAcademico
                      const cupo = CUPO_META[b.cupo]
                      const tieneCurso = !!(b.campaign || b.tipoCurso || b.horarioCurso || b.salon)
                      const tieneApoderado = !!(b.apoderado || b.apoderadoTelefono || b.apoderadoMail)
                      return (
                        <div key={b._id} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex flex-col">
                          <div className={`px-4 py-3 flex items-center gap-3 text-white ${conPerfil ? 'bg-gradient-to-r from-emerald-600 to-emerald-500' : 'bg-gradient-to-r from-amber-500 to-amber-400'}`}>
                            <div className="h-11 w-11 rounded-full bg-white/25 flex items-center justify-center text-lg font-bold ring-2 ring-white/40 shrink-0">{inicial(b)}</div>
                            <div className="min-w-0">
                              <div className="font-bold leading-tight truncate">{nombre(b)}</div>
                              <div className="text-[11px] opacity-90">ID {b.numeroId}</div>
                            </div>
                            {(b.suspendido || b.enOnHold) && (
                              <span className="ml-auto shrink-0 inline-flex items-center bg-red-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full ring-1 ring-white/40">
                                {b.enOnHold ? 'ON HOLD' : 'SUSPENDIDO'}
                              </span>
                            )}
                          </div>
                          <div className="p-4 text-sm space-y-1.5 flex-1">
                            <Field label="Celular" value={b.celular || '—'} />
                            <Field label="Email" value={b.email || '—'} />
                            <Field label="Plataforma" value={b.plataforma || '—'} />
                            <Field label="Fecha de nacimiento" value={fmtFecha(b.fechaNacimiento)} />

                            {/* Curso (en LGS: "Programa Kids") */}
                            <div className="mt-3 pt-3 border-t border-gray-100">
                              <div className="flex items-center justify-between gap-2 mb-1.5">
                                <div className="flex items-center gap-1.5 text-xs font-semibold text-primary-700">
                                  <BookOpen className="h-4 w-4" /> Curso
                                </div>
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${cupo.cls}`}>{cupo.label}</span>
                              </div>
                              {tieneCurso ? (
                                <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                                  <Field label="Campaña" value={b.campaign || '—'} />
                                  <Field label="Curso" value={b.tipoCurso || '—'} />
                                  <Field label="Salón" value={b.salon || '—'} />
                                  <Field label="Horario" value={b.horarioCurso || '—'} />
                                </div>
                              ) : (
                                <p className="text-xs text-gray-400">Sin curso asignado</p>
                              )}
                            </div>

                            {/* Apoderado */}
                            {tieneApoderado && (
                              <div className="mt-3 pt-3 border-t border-gray-100">
                                <div className="flex items-center gap-1.5 text-xs font-semibold text-accent-700 mb-1.5">
                                  <UserCheck className="h-4 w-4" /> Apoderado
                                </div>
                                <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                                  <div className="col-span-2"><Field label="Nombre" value={b.apoderado || '—'} /></div>
                                  <Field label="Teléfono" value={b.apoderadoTelefono || '—'} />
                                  <Field label="Correo" value={b.apoderadoMail || '—'} />
                                </div>
                              </div>
                            )}

                            {conPerfil ? (
                              <div className="mt-3 pt-3 border-t border-gray-100">
                                <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 mb-1.5">
                                  <GraduationCap className="h-4 w-4" /> Perfil académico
                                </div>
                                <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                                  <Field label="Módulo" value={b.nivel || '—'} />
                                  <Field label="Lección" value={b.step || '—'} />
                                  <div className="col-span-2"><Field label="Usuario" value={b.userLogin || '—'} /></div>
                                  <div className="col-span-2 flex flex-wrap gap-1.5">
                                    <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold ${b.academicaInactivo ? 'bg-gray-200 text-gray-700' : 'bg-green-100 text-green-800'}`}>
                                      {b.academicaInactivo ? 'Académica: Inactiva' : 'Académica: Activa'}
                                    </span>
                                    {b.enWelcome && (
                                      <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold bg-purple-100 text-purple-800" title="Aún en el curso puente WELCOME: pasa a su curso al aprobar su bienvenida">
                                        En WELCOME
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <a href={`/student/${b.academicaId}`} target="_blank" rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 mt-2 text-xs text-blue-600 hover:text-blue-800">
                                  <ExternalLink className="h-3.5 w-3.5" /> Ver usuario
                                </a>
                              </div>
                            ) : (
                              <div className="mt-3 pt-3 border-t border-gray-100">
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-800">
                                  <AlertCircle className="h-3.5 w-3.5" /> Usuario aún no tiene perfil académico
                                </span>
                                <a href={`/person/${b._id}`} target="_blank" rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 mt-2 text-xs text-blue-600 hover:text-blue-800">
                                  <ExternalLink className="h-3.5 w-3.5" /> Ver ficha
                                </a>
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </PermissionGuard>
    </DashboardLayout>
  )
}

function Field({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-gray-400">{label}</div>
      <div className="text-gray-800 break-words">{value}</div>
      {sub && <div className="text-xs text-gray-500 break-words">{sub}</div>}
    </div>
  )
}
