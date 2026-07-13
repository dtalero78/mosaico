'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import toast from 'react-hot-toast'
import { exportToExcel } from '@/lib/export-excel'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions/PermissionGuard'
import { AcademicoPermission } from '@/types/permissions'
import { usePermissions } from '@/hooks/usePermissions'
import { TIPOS_CURSO } from '@/lib/cursos-campaign'

interface Row {
  id: string
  academicaId: string | null
  numeroId: string | null
  nombre: string
  primerNombre: string | null
  segundoNombre: string | null
  primerApellido: string | null
  segundoApellido: string | null
  curso: string | null
  salon: string | null
  fechaNacimiento: string | null
  edad: number | null
  apoderado: string | null
  apoderadoTelefono: string | null
  apoderadoMail: string | null
  email: string | null
  celular: string | null
  domicilio: string | null
  ciudad: string | null
  guia: string | null
  modulo: string | null
  leccion: string | null
}
interface Guia { id: string; nombre: string }

function ListaUsuariosContent() {
  const { hasPermission, isRole } = usePermissions()
  const puedeEditar = isRole('SUPER_ADMIN') || isRole('ADMIN') || hasPermission(AcademicoPermission.LISTA_USUARIOS_EDITAR)

  const [editRow, setEditRow] = useState<Row | null>(null)
  const [form, setForm] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const [campaign, setCampaign] = useState('')
  const [curso, setCurso] = useState('')
  const [salon, setSalon] = useState('')
  const [guia, setGuia] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  const [rows, setRows] = useState<Row[]>([])
  const [campanias, setCampanias] = useState<string[]>([])
  const [salones, setSalones] = useState<string[]>([])
  const [guias, setGuias] = useState<Guia[]>([])
  const [loading, setLoading] = useState(true)

  // Barra de scroll horizontal sincronizada (arriba de la tabla)
  const scrollRef = useRef<HTMLDivElement>(null)
  const topRef = useRef<HTMLDivElement>(null)
  const [scrollW, setScrollW] = useState(0)
  useEffect(() => {
    const el = scrollRef.current
    if (el) setScrollW(el.scrollWidth)
  }, [rows, loading, puedeEditar])
  const syncFromTop = () => { if (scrollRef.current && topRef.current) scrollRef.current.scrollLeft = topRef.current.scrollLeft }
  const syncFromBottom = () => { if (scrollRef.current && topRef.current) topRef.current.scrollLeft = scrollRef.current.scrollLeft }

  const fetchData = useCallback(async (f?: { campaign?: string; curso?: string; salon?: string; guia?: string; startDate?: string; endDate?: string }) => {
    setLoading(true)
    try {
      const qs = new URLSearchParams()
      if (f?.campaign)  qs.set('campaign', f.campaign)
      if (f?.curso)     qs.set('curso', f.curso)
      if (f?.salon)     qs.set('salon', f.salon)
      if (f?.guia)      qs.set('guia', f.guia)
      if (f?.startDate) qs.set('startDate', f.startDate)
      if (f?.endDate)   qs.set('endDate', f.endDate)
      const r = await fetch(`/api/postgres/reports/academico/lista-usuarios?${qs}`, { cache: 'no-store' }).then(x => x.json())
      if (r.error) throw new Error(r.error)
      setRows(r.rows || [])
      setCampanias(r.campanias || [])
      setSalones(r.salones || [])
      setGuias(r.guias || [])
    } catch (e: any) {
      toast.error(e?.message || 'Error al cargar')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const aplicar = () => fetchData({ campaign, curso, salon, guia, startDate, endDate })
  const borrar = () => {
    setCampaign(''); setCurso(''); setSalon(''); setGuia(''); setStartDate(''); setEndDate('')
    fetchData()
  }
  const exportar = () => {
    exportToExcel(rows, [
      { header: 'Nombre', accessor: r => r.nombre },
      { header: 'Curso', accessor: r => r.curso || '' },
      { header: 'Salón', accessor: r => r.salon || '' },
      { header: 'Fecha nacimiento', accessor: r => r.fechaNacimiento || '' },
      { header: 'Edad', accessor: r => (r.edad ?? '') },
      { header: 'Apoderado', accessor: r => r.apoderado || '' },
      { header: 'Guía', accessor: r => r.guia || '' },
      { header: 'Módulo', accessor: r => r.modulo || '' },
      { header: 'Lección', accessor: r => r.leccion || '' },
    ], 'lista-usuarios')
  }

  const abrirEditar = (r: Row) => {
    setEditRow(r)
    setForm({
      primerNombre: r.primerNombre || '', segundoNombre: r.segundoNombre || '',
      primerApellido: r.primerApellido || '', segundoApellido: r.segundoApellido || '',
      fechaNacimiento: (r.fechaNacimiento || '').slice(0, 10),
      email: r.email || '', celular: r.celular || '', domicilio: r.domicilio || '', ciudad: r.ciudad || '',
      apoderado: r.apoderado || '', apoderadoTelefono: r.apoderadoTelefono || '', apoderadoMail: r.apoderadoMail || '',
    })
  }
  const setF = (k: string, v: string) => setForm(prev => ({ ...prev, [k]: v }))
  const guardar = async () => {
    if (!editRow) return
    setSaving(true)
    try {
      const payload: Record<string, any> = {}
      Object.entries(form).forEach(([k, v]) => { payload[k] = v.trim() === '' ? null : v })
      const r = await fetch(`/api/postgres/people/${editRow.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      }).then(x => x.json())
      if (r.error) throw new Error(r.error)
      toast.success('Datos actualizados')
      setEditRow(null)
      fetchData({ campaign, curso, salon, guia, startDate, endDate })
    } catch (e: any) { toast.error(e?.message || 'Error al guardar') } finally { setSaving(false) }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Lista de Usuarios</h1>
      <p className="text-gray-500 mb-5">Estudiantes por campaña, curso, salón y guía. Total: <span className="font-semibold text-gray-700">{rows.length}</span></p>

      {/* Filtros */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Campaña</label>
            <select value={campaign} onChange={e => setCampaign(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="">Todas</option>
              {campanias.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Curso</label>
            <select value={curso} onChange={e => setCurso(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="">Todos</option>
              {TIPOS_CURSO.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Salón</label>
            <select value={salon} onChange={e => setSalon(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="">Todos</option>
              {salones.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Guía</label>
            <select value={guia} onChange={e => setGuia(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="">Todos</option>
              {guias.map(g => <option key={g.id} value={g.id}>{g.nombre}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Fecha inicial</label>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Fecha final</label>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-4">
          <button type="button" onClick={aplicar} disabled={loading}
            className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 font-medium">Aplicar filtros</button>
          <button type="button" onClick={borrar}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50">Borrar filtros</button>
          <PermissionGuard permission={AcademicoPermission.LISTA_USUARIOS_EXPORTAR}>
            <button type="button" onClick={exportar} disabled={!rows.length}
              className="px-3 py-2 text-sm bg-green-100 text-green-700 rounded-lg hover:bg-green-200 disabled:opacity-50 font-medium">Exportar CSV</button>
          </PermissionGuard>
        </div>
      </div>

      {/* Tabla */}
      <div className="bg-white border border-gray-200 rounded-xl">
        {/* Barra de scroll superior sincronizada */}
        <div ref={topRef} onScroll={syncFromTop} className="overflow-x-auto rounded-t-xl border-b border-gray-100">
          <div style={{ width: scrollW, height: 1 }} />
        </div>
        <div ref={scrollRef} onScroll={syncFromBottom} className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['Nombre', 'Curso', 'Salón', 'Fecha nacimiento', 'Edad', 'Apoderado', 'Guía', 'Módulo', 'Lección'].map(h => (
                  <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
                {puedeEditar && <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Editar</th>}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={puedeEditar ? 10 : 9} className="px-3 py-10 text-center text-gray-400">Cargando…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={puedeEditar ? 10 : 9} className="px-3 py-10 text-center text-gray-400">Sin resultados</td></tr>
              ) : rows.map((r, idx) => (
                <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2 font-medium whitespace-nowrap">
                    <a href={r.academicaId ? `/student/${r.academicaId}` : `/person/${r.id}`}
                      target="_blank" rel="noopener noreferrer"
                      className="text-primary-700 hover:text-primary-900 hover:underline">
                      {r.nombre || '—'}
                    </a>
                  </td>
                  <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{r.curso || '—'}</td>
                  <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{r.salon || '—'}</td>
                  <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{r.fechaNacimiento || '—'}</td>
                  <td className="px-3 py-2 text-gray-600">{r.edad ?? '—'}</td>
                  <td className="px-3 py-2 text-gray-600">{r.apoderado || '—'}</td>
                  <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{r.guia || '—'}</td>
                  <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{r.modulo || '—'}</td>
                  <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{r.leccion || '—'}</td>
                  {puedeEditar && (
                    <td className="px-3 py-2">
                      <button type="button" onClick={() => abrirEditar(r)}
                        className="px-3 py-1 text-xs bg-primary-100 text-primary-700 rounded-lg hover:bg-primary-200 font-medium">Editar</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal editar */}
      {editRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !saving && setEditRow(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Editar datos del estudiante</h2>
                <p className="text-xs text-gray-500">{editRow.nombre}{editRow.numeroId ? ` · ${editRow.numeroId}` : ''}</p>
              </div>
              <button type="button" onClick={() => !saving && setEditRow(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Nombres del estudiante</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Primer nombre" value={form.primerNombre} onChange={v => setF('primerNombre', v)} />
                  <Field label="Segundo nombre" value={form.segundoNombre} onChange={v => setF('segundoNombre', v)} />
                  <Field label="Primer apellido" value={form.primerApellido} onChange={v => setF('primerApellido', v)} />
                  <Field label="Segundo apellido" value={form.segundoApellido} onChange={v => setF('segundoApellido', v)} />
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Datos del contrato</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Fecha de nacimiento" type="date" value={form.fechaNacimiento} onChange={v => setF('fechaNacimiento', v)} />
                  <Field label="Correo" type="email" value={form.email} onChange={v => setF('email', v)} />
                  <Field label="Celular" value={form.celular} onChange={v => setF('celular', v)} />
                  <Field label="Ciudad" value={form.ciudad} onChange={v => setF('ciudad', v)} />
                  <div className="sm:col-span-2">
                    <Field label="Domicilio" value={form.domicilio} onChange={v => setF('domicilio', v)} />
                  </div>
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Apoderado</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="sm:col-span-2">
                    <Field label="Nombre del apoderado" value={form.apoderado} onChange={v => setF('apoderado', v)} />
                  </div>
                  <Field label="Teléfono del apoderado" value={form.apoderadoTelefono} onChange={v => setF('apoderadoTelefono', v)} />
                  <Field label="Correo del apoderado" type="email" value={form.apoderadoMail} onChange={v => setF('apoderadoMail', v)} />
                </div>
              </div>
            </div>

            <div className="px-5 py-4 border-t border-gray-200 flex justify-end gap-2">
              <button type="button" onClick={() => setEditRow(null)} disabled={saving}
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50">Cancelar</button>
              <button type="button" onClick={guardar} disabled={saving}
                className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 font-medium">
                {saving ? 'Guardando…' : 'Guardar cambios'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      <input type={type} value={value || ''} onChange={e => onChange(e.target.value)}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
    </div>
  )
}

export default function ListaUsuariosPage() {
  return (
    <DashboardLayout>
      <PermissionGuard permission={AcademicoPermission.LISTA_USUARIOS_VER} showDefaultMessage>
        <ListaUsuariosContent />
      </PermissionGuard>
    </DashboardLayout>
  )
}
