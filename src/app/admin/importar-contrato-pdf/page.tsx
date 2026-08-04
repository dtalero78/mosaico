'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions/PermissionGuard'
import { MantenimientoPermission } from '@/types/permissions'

const set = (obj: any, k: string, v: any) => ({ ...obj, [k]: v })

function Input({ label, value, onChange, type = 'text', wide }: any) {
  return (
    <label className={`flex flex-col gap-1 text-sm ${wide ? 'sm:col-span-2' : ''}`}>
      <span className="text-[11px] font-medium text-gray-500 uppercase">{label}</span>
      <input type={type} value={value ?? ''} onChange={e => onChange(e.target.value)}
        className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
    </label>
  )
}

export default function ImportarContratoPdfPage() {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [data, setData] = useState<any>(null)      // { titular, beneficiarios, financial, contrato, titularEsBeneficiario, inconsistencias }
  const [campaigns, setCampaigns] = useState<string[]>([])
  const [candidateCampaigns, setCandidateCampaigns] = useState<string[]>([])
  const [campaign, setCampaign] = useState('')

  const extraer = async () => {
    if (!file) return
    setExtracting(true)
    try {
      const fd = new FormData(); fd.append('pdf', file)
      const res = await fetch('/api/admin/importar-contrato/extraer', { method: 'POST', body: fd }).then(r => r.json())
      if (res.error) throw new Error(res.error)
      setData(res)
      setCampaigns(res.campaigns || [])
      const cand: string[] = res.candidateCampaigns || []
      setCandidateCampaigns(cand)
      // Auto-selecciona sólo si hay UNA campaña candidata (con el curso+horario); si hay
      // varias, se deja vacío para que el usuario elija conscientemente.
      const impulsaDef = res.esImpulsa ? cand.find((c: string) => c.startsWith('AGOSTO10')) : null
      setCampaign(impulsaDef || (cand.length === 1 ? cand[0] : ''))
      toast.success('Datos extraídos. Revisa y corrige antes de crear.')
    } catch (e: any) { toast.error(e?.message || 'Error al extraer') } finally { setExtracting(false) }
  }

  const setTit = (k: string, v: any) => setData((d: any) => ({ ...d, titular: set(d.titular, k, v) }))
  const setFin = (k: string, v: any) => setData((d: any) => ({ ...d, financial: set(d.financial, k, v) }))
  const setBen = (i: number, k: string, v: any) => setData((d: any) => ({ ...d, beneficiarios: d.beneficiarios.map((b: any, j: number) => j === i ? set(b, k, v) : b) }))

  const crear = async () => {
    if (!data?.contrato?.trim()) { toast.error('Falta el número de contrato'); return }
    if (!data?.titular?.numeroId) { toast.error('Falta el RUT del titular'); return }
    const needsCampaign = (data.beneficiarios || []).some((b: any) => b.tipoCurso)
    if (needsCampaign && !campaign) { toast.error('Selecciona la campaña — de ahí sale el salón del curso'); return }
    setSaving(true)
    try {
      const beneficiarios = (data.beneficiarios || []).map((b: any) => ({ ...b, campaign: campaign || b.campaign || null }))
      const res = await fetch('/api/admin/migrar-contrato', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contrato: data.contrato.trim(), titular: data.titular, financial: data.financial,
          beneficiarios, titularEsBeneficiario: data.titularEsBeneficiario === true,
        }),
      }).then(r => r.json())
      if (res.error) throw new Error(res.error)
      toast.success('Contrato creado. Abriendo para editar…')
      router.push(`/dashboard/comercial/contrato/${res.titularId}`)
    } catch (e: any) { toast.error(e?.message || 'Error al crear el contrato') } finally { setSaving(false) }
  }

  const t = data?.titular || {}
  const f = data?.financial || {}

  return (
    <DashboardLayout>
      <PermissionGuard permission={MantenimientoPermission.IMPORTAR_CONTRATO_PDF} showDefaultMessage>
        <div className="p-6 max-w-5xl mx-auto space-y-5">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Importar Contrato desde PDF</h1>
            <p className="text-gray-500 text-sm">Sube el PDF del contrato (plantilla MOSAICO o IMPULSA). Se extraen los datos con IA, los <strong>revisas y corriges</strong>, y al confirmar se crea el contrato y se abre para editar. Los campos vacíos quedan vacíos.</p>
          </div>

          {/* Paso 1 — subir */}
          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm flex flex-wrap items-center gap-3">
            <input type="file" accept="application/pdf" onChange={e => setFile(e.target.files?.[0] || null)}
              className="text-sm" />
            <button type="button" onClick={extraer} disabled={!file || extracting}
              className="px-4 py-2 rounded-lg bg-primary-700 text-white text-sm font-medium hover:bg-primary-800 disabled:opacity-40">
              {extracting ? 'Extrayendo…' : 'Extraer datos'}</button>
          </div>

          {data && (
            <>
              {/* Log de inconsistencias */}
              {(data.inconsistencias || []).length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                  <h3 className="text-sm font-bold text-amber-800 mb-1">⚠ Inconsistencias ({data.inconsistencias.length}) — revísalas</h3>
                  <ul className="list-disc ml-5 text-sm text-amber-800">
                    {data.inconsistencias.map((x: string, i: number) => <li key={i}>{x}</li>)}
                  </ul>
                </div>
              )}

              {/* Contrato + campaña */}
              <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
                <h3 className="text-sm font-bold text-gray-800 uppercase mb-3">Contrato {data.esImpulsa ? '· IMPULSA' : '· MOSAICO'}</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <Input label="N.º Contrato" value={data.contrato} onChange={(v: any) => setData((d: any) => ({ ...d, contrato: v }))} />
                  <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                    <span className="text-[11px] font-medium text-gray-500 uppercase">Campaña <span className="text-red-500">*</span> — de aquí sale el salón</span>
                    <select value={campaign} onChange={e => setCampaign(e.target.value)}
                      className={`border rounded-lg px-3 py-2 text-sm ${!campaign ? 'border-amber-400 bg-amber-50' : 'border-gray-300'}`}>
                      <option value="">— Elige la campaña —</option>
                      {candidateCampaigns.length > 0 && (
                        <optgroup label="Con el curso de los beneficiarios">
                          {candidateCampaigns.map(c => <option key={c} value={c}>{c} ✓</option>)}
                        </optgroup>
                      )}
                      <optgroup label="Todas las campañas">
                        {campaigns.map(c => <option key={c} value={c}>{c}</option>)}
                      </optgroup>
                    </select>
                    {candidateCampaigns.length > 1 && <span className="text-[11px] text-amber-700">El curso existe en {candidateCampaigns.length} campañas — elige cuál corresponde (cambia el salón).</span>}
                  </label>
                </div>
              </div>

              {/* Titular */}
              <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
                <h3 className="text-sm font-bold text-gray-800 uppercase mb-3">Titular {data.titularEsBeneficiario && <span className="text-[11px] text-primary-700">· es beneficiario</span>}</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <Input label="Primer nombre" value={t.primerNombre} onChange={(v: any) => setTit('primerNombre', v)} />
                  <Input label="Segundo nombre" value={t.segundoNombre} onChange={(v: any) => setTit('segundoNombre', v)} />
                  <Input label="Primer apellido" value={t.primerApellido} onChange={(v: any) => setTit('primerApellido', v)} />
                  <Input label="Segundo apellido" value={t.segundoApellido} onChange={(v: any) => setTit('segundoApellido', v)} />
                  <Input label="RUT / N.º ID" value={t.numeroId} onChange={(v: any) => setTit('numeroId', v)} />
                  <Input label="Fecha nac." type="date" value={t.fechaNacimiento} onChange={(v: any) => setTit('fechaNacimiento', v)} />
                  <Input label="Email" value={t.email} onChange={(v: any) => setTit('email', v)} />
                  <Input label="Celular" value={t.celular} onChange={(v: any) => setTit('celular', v)} />
                  <Input label="Domicilio" value={t.domicilio} onChange={(v: any) => setTit('domicilio', v)} />
                  <Input label="Ciudad" value={t.ciudad} onChange={(v: any) => setTit('ciudad', v)} />
                  <Input label="Asesor" value={t.asesor} onChange={(v: any) => setTit('asesor', v)} />
                  <Input label="Correo asesor" value={t.asesorMail} onChange={(v: any) => setTit('asesorMail', v)} />
                  <Input label="Apoderado" value={t.apoderado} onChange={(v: any) => setTit('apoderado', v)} />
                  <Input label="Tel. apoderado" value={t.apoderadoTelefono} onChange={(v: any) => setTit('apoderadoTelefono', v)} />
                  <Input label="Mail apoderado" value={t.apoderadoMail} onChange={(v: any) => setTit('apoderadoMail', v)} />
                </div>
              </div>

              {/* Beneficiarios */}
              <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
                <h3 className="text-sm font-bold text-gray-800 uppercase mb-3">Beneficiarios ({(data.beneficiarios || []).length})</h3>
                <div className="space-y-4">
                  {(data.beneficiarios || []).map((b: any, i: number) => (
                    <div key={i} className="border border-gray-100 rounded-lg p-3 bg-gray-50/50">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <Input label="Primer nombre" value={b.primerNombre} onChange={(v: any) => setBen(i, 'primerNombre', v)} />
                        <Input label="Segundo nombre" value={b.segundoNombre} onChange={(v: any) => setBen(i, 'segundoNombre', v)} />
                        <Input label="Primer apellido" value={b.primerApellido} onChange={(v: any) => setBen(i, 'primerApellido', v)} />
                        <Input label="Segundo apellido" value={b.segundoApellido} onChange={(v: any) => setBen(i, 'segundoApellido', v)} />
                        <Input label="RUT / N.º ID" value={b.numeroId} onChange={(v: any) => setBen(i, 'numeroId', v)} />
                        <Input label="Fecha nac." type="date" value={b.fechaNacimiento} onChange={(v: any) => setBen(i, 'fechaNacimiento', v)} />
                        <Input label="Email" value={b.email} onChange={(v: any) => setBen(i, 'email', v)} />
                        <Input label="Celular" value={b.celular} onChange={(v: any) => setBen(i, 'celular', v)} />
                        <Input label="Programa (tipoCurso)" value={b.tipoCurso} onChange={(v: any) => setBen(i, 'tipoCurso', v)} />
                        <Input label="Horario (horarioCurso)" value={b.horarioCurso} onChange={(v: any) => setBen(i, 'horarioCurso', v)} wide />
                      </div>
                      {b.tipoCurso && b.horarioCurso && (() => {
                        const m = (b.cursoMatches || []).find((x: any) => x.campaign === campaign)
                        if (!campaign) return <p className="text-[11px] text-gray-500 mt-2">Curso disponible en: {(b.cursoMatches || []).map((x: any) => `${x.campaign} (salón ${x.salon})`).join(' · ') || '⚠ ninguna campaña'} — elige la campaña arriba.</p>
                        return m
                          ? <p className="text-[11px] text-emerald-700 mt-2 font-medium">✓ Salón {m.salon} en {campaign}</p>
                          : <p className="text-[11px] text-red-600 mt-2 font-medium">⚠ {b.tipoCurso} {b.horarioCurso} no existe en {campaign} → quedará sin salón (corrige el horario o la campaña).</p>
                      })()}
                    </div>
                  ))}
                </div>
              </div>

              {/* Financiero */}
              <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
                <h3 className="text-sm font-bold text-gray-800 uppercase mb-3">Financiero</h3>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <Input label="Total plan" type="number" value={f.totalPlan} onChange={(v: any) => setFin('totalPlan', Number(v) || 0)} />
                  <Input label="Inscripción" type="number" value={f.pagoInscripcion} onChange={(v: any) => setFin('pagoInscripcion', Number(v) || 0)} />
                  <Input label="Saldo" type="number" value={f.saldo} onChange={(v: any) => setFin('saldo', Number(v) || 0)} />
                  <Input label="N.º cuotas" type="number" value={f.numeroCuotas} onChange={(v: any) => setFin('numeroCuotas', Number(v) || 0)} />
                  <Input label="Valor cuota" type="number" value={f.valorCuota} onChange={(v: any) => setFin('valorCuota', Number(v) || 0)} />
                  <Input label="Valor pagado" type="number" value={f.valorPagado} onChange={(v: any) => setFin('valorPagado', Number(v) || 0)} />
                  <Input label="Forma de pago" value={f.formaPago} onChange={(v: any) => setFin('formaPago', v)} />
                  <Input label="Fecha 1er pago" type="date" value={f.fechaPago} onChange={(v: any) => setFin('fechaPago', v)} />
                </div>
              </div>

              <div className="flex justify-end">
                <button type="button" onClick={crear} disabled={saving}
                  className="px-5 py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-40">
                  {saving ? 'Creando…' : 'Crear contrato y editar'}</button>
              </div>
            </>
          )}
        </div>
      </PermissionGuard>
    </DashboardLayout>
  )
}
