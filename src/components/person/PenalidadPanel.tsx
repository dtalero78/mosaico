'use client'

/**
 * Pago Especial › Última Penalidad en pagos.
 *
 *  · Sin penalidad activa: calcula el 30% del saldo (editable, con confirmación), pide el
 *    número de cuotas, muestra el plan (fechas editables) y se aprueba con una nota obligatoria.
 *  · Con penalidad activa: muestra las cuotas marcadas, registra cada pago por aquí (se aplica
 *    a la siguiente cuota; permite adelantar) y permite cancelar el proceso (jefatura).
 *  · Máximo dos penalidades por contrato.
 */
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { api, handleApiError } from '@/hooks/use-api'
import { getLocalToday } from '@/lib/fecha-local'
import { mediosPagoPara } from '@/lib/medios-pago'
import { usePermissions } from '@/hooks/usePermissions'
import { PersonPermission } from '@/types/permissions'
import RecibosDobles, { type ReciboArchivo } from '@/components/common/RecibosDobles'
import {
  MAX_CUOTAS_PENALIDAD, MAX_PENALIDADES_POR_CONTRATO, armarPlan, pendientePlan, siguienteCuota, totalPagado,
  valorPenalidad, type CuotaPenalidad,
} from '@/lib/penalidad'

interface PlanRow {
  _id: string; numero: number; estado: string; saldoInicial: number; porcentaje: number; valorPenalidad: number
  condonado: number | null; numCuotas: number; cuotas: (CuotaPenalidad & { cancelada?: boolean })[]
  nota: string | null; motivoCancelacion: string | null
}
interface Estado {
  contrato: string | null; estado: string | null; saldo: number; porcentaje: number
  activa: PlanRow | null; historial: PlanRow[]; creadas: number; puedeNueva: boolean
}

interface Props {
  titular: { _id: string; plataforma?: string }
  onChanged: () => void
}

const fmt = (n: number) => '$ ' + new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(Math.round(n || 0))
const soloDigitos = (s: string) => s.replace(/[^0-9]/g, '')
const toNum = (s: string) => Number(soloDigitos(s)) || 0
const money = (s: string) => (s ? new Intl.NumberFormat('es-CO').format(toNum(s)) : '')

export default function PenalidadPanel({ titular, onChanged }: Props) {
  const { hasPermission } = usePermissions()
  const puedeActivar = hasPermission(PersonPermission.PAGO_ESPECIAL_PENALIDAD)
  const puedeCancelar = hasPermission(PersonPermission.PAGO_ESPECIAL_CANCELAR_PENALIDAD)

  const [est, setEst] = useState<Estado | null>(null)
  const [cargando, setCargando] = useState(true)

  const cargar = async () => {
    setCargando(true)
    try { setEst(await api.get<Estado>(`/api/postgres/pagos-titulares/penalidad?idPeople=${encodeURIComponent(titular._id)}`)) }
    catch (e) { handleApiError(e, 'No se pudo consultar la penalidad') }
    finally { setCargando(false) }
  }
  useEffect(() => { cargar() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [titular._id])

  // ── Crear plan ─────────────────────────────────────────────────────────
  const [valorStr, setValorStr] = useState('')
  const [valorOk, setValorOk] = useState(false)
  const [numCuotas, setNumCuotas] = useState('')
  const [primeraFecha, setPrimeraFecha] = useState(getLocalToday())
  const [fechas, setFechas] = useState<string[]>([])
  const [nota, setNota] = useState('')
  const [confirmo, setConfirmo] = useState(false)
  const [guardando, setGuardando] = useState(false)

  useEffect(() => { if (est && !est.activa) setValorStr(String(valorPenalidad(est.saldo, est.porcentaje))) }, [est?.saldo, est?.activa])

  const n = Math.floor(Number(numCuotas)) || 0
  const plan: CuotaPenalidad[] = valorOk && n >= 1 && n <= MAX_CUOTAS_PENALIDAD && primeraFecha
    ? armarPlan(toNum(valorStr), n, primeraFecha).map((c, i) => ({ ...c, fecha: fechas[i] || c.fecha })) : []

  const aprobar = async () => {
    if (!nota.trim()) { toast.error('La nota es obligatoria'); return }
    setGuardando(true)
    try {
      await api.post('/api/postgres/pagos-titulares/penalidad', {
        idPeople: titular._id, valorPenalidad: toNum(valorStr), numCuotas: n, primeraFecha,
        fechas: plan.map(c => c.fecha), nota: nota.trim(),
      })
      toast.success('Penalidad aprobada: el contrato pasó a Cierre a cuotas')
      setValorOk(false); setNumCuotas(''); setFechas([]); setNota(''); setConfirmo(false)
      await cargar(); onChanged()
    } catch (e) { handleApiError(e, 'No se pudo activar la penalidad') }
    finally { setGuardando(false) }
  }

  // ── Registrar pago de la penalidad ─────────────────────────────────────
  const [pv, setPv] = useState('')
  const [pFecha, setPFecha] = useState(getLocalToday())
  const [pReporte, setPReporte] = useState(getLocalToday())
  const [pMedio, setPMedio] = useState('')
  const [pBanco, setPBanco] = useState('')
  const [pRef, setPRef] = useState('')
  const [pNota, setPNota] = useState('')
  const [dos, setDos] = useState(false)
  const [recs, setRecs] = useState<(ReciboArchivo | null)[]>([null, null])
  const [pagando, setPagando] = useState(false)

  const activa = est?.activa || null
  const sig = activa ? siguienteCuota(activa.cuotas) : undefined
  useEffect(() => { if (sig) setPv(String(Math.round(sig.valor - sig.pagado))) }, [activa?._id, sig?.n, sig?.pagado])

  const pagar = async () => {
    if (!activa) return
    if (toNum(pv) <= 0) { toast.error('Digita el valor del pago'); return }
    if (dos && (!recs[0] || !recs[1])) { toast.error('Adjunta el recibo 1 y el recibo 2'); return }
    setPagando(true)
    try {
      const r = await api.post<{ completada: boolean }>(`/api/postgres/pagos-titulares/penalidad/${activa._id}/pago`, {
        valorPagado: toNum(pv), fechaPago: pFecha, fechaReporte: pReporte || null,
        medioPago: pMedio || null, banco: pBanco.trim() || null, numeroReferencia: pRef || null,
        nota: pNota.trim() || null, dosRecibos: dos,
        documentosAdjuntos: dos ? recs.flatMap((x, i) => x ? [{ url: x.url, nombre: `Recibo ${i + 1} · ${x.nombre}`, tipo: x.tipo,
          fechaSubida: x.fechaSubida, recibo: i + 1, montoLeido: x.montoLeido ?? null }] : []) : [],
      })
      toast.success(r.completada ? 'Última cuota pagada: el contrato quedó finalizado' : 'Pago de penalidad registrado')
      setPNota(''); setPRef(''); setDos(false); setRecs([null, null])
      await cargar(); onChanged()
    } catch (e) { handleApiError(e, 'No se pudo registrar el pago') }
    finally { setPagando(false) }
  }

  // ── Cancelar ───────────────────────────────────────────────────────────
  const [verCancelar, setVerCancelar] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [okCancelar, setOkCancelar] = useState(false)
  const [cancelando, setCancelando] = useState(false)
  const cancelar = async () => {
    if (!activa) return
    setCancelando(true)
    try {
      await api.post(`/api/postgres/pagos-titulares/penalidad/${activa._id}/cancelar`, { motivo: motivo.trim() })
      toast.success('Penalidad cancelada: el contrato volvió a su plan inicial')
      setVerCancelar(false); setMotivo(''); setOkCancelar(false)
      await cargar(); onChanged()
    } catch (e) { handleApiError(e, 'No se pudo cancelar la penalidad') }
    finally { setCancelando(false) }
  }

  if (cargando && !est) return <p className="text-sm text-gray-500 py-6 text-center">Consultando…</p>
  if (!est) return null

  const tablaCuotas = (cuotas: PlanRow['cuotas']) => (
    <table className="min-w-full text-sm">
      <thead className="bg-gray-50 text-gray-600"><tr>
        <th className="px-3 py-1.5 text-center">Cuota</th><th className="px-3 py-1.5 text-left">Vence</th>
        <th className="px-3 py-1.5 text-right">Valor</th><th className="px-3 py-1.5 text-right">Pagado</th>
        <th className="px-3 py-1.5 text-center">Estado</th></tr></thead>
      <tbody>
        {cuotas.map(c => {
          const completa = c.pagado >= c.valor - 0.5
          return (
            <tr key={c.n} className="border-t border-gray-100">
              <td className="px-3 py-1.5 text-center font-semibold">{c.n}</td>
              <td className="px-3 py-1.5">{c.fecha}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{fmt(c.valor)}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{fmt(c.pagado)}</td>
              <td className="px-3 py-1.5 text-center">
                {c.cancelada ? <span className="px-2 py-0.5 rounded-full text-xs bg-gray-200 text-gray-700">Cancelada</span>
                  : completa ? <span className="px-2 py-0.5 rounded-full text-xs bg-emerald-100 text-emerald-800">✓ Pagada</span>
                  : c.pagado > 0 ? <span className="px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-800">Abonada</span>
                  : <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600">Pendiente</span>}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )

  const historial = est.historial.length > 0 && (
    <div className="text-xs text-gray-600 border-t border-gray-200 pt-3">
      <p className="font-semibold mb-1">Historial de penalidades ({est.creadas}/{MAX_PENALIDADES_POR_CONTRATO} usadas)</p>
      <ul className="space-y-1">
        {est.historial.map(h => (
          <li key={h._id}>
            Penalidad {h.numero} · {h.estado === 'COMPLETADA' ? 'completada' : 'cancelada'} · valor {fmt(h.valorPenalidad)} · saldo inicial {fmt(h.saldoInicial)}
            {h.condonado ? ` · condonado ${fmt(h.condonado)}` : ''}{h.motivoCancelacion ? ` · motivo: ${h.motivoCancelacion}` : ''}
          </li>
        ))}
      </ul>
    </div>
  )

  // ── Penalidad activa ───────────────────────────────────────────────────
  if (activa) {
    const pendiente = pendientePlan(activa.cuotas)
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-bold">Penalidad {activa.numero} activa — contrato en «Cierre a cuotas»</p>
          <p className="mt-1">Saldo inicial guardado: <strong>{fmt(activa.saldoInicial)}</strong> · Penalidad ({activa.porcentaje}%): <strong>{fmt(activa.valorPenalidad)}</strong> ·
            Pagado: <strong>{fmt(totalPagado(activa.cuotas))}</strong> · Pendiente: <strong>{fmt(pendiente)}</strong></p>
          <p className="mt-1 text-xs">Al pagar la última cuota el contrato se finaliza (titular y beneficiarios quedan inactivos) y el {100 - activa.porcentaje}% restante se condona.
            Mientras tanto «Registrar Pago» está deshabilitado y los usuarios siguen con acceso.</p>
          {activa.nota && <p className="mt-1 text-xs italic">Nota: {activa.nota}</p>}
        </div>

        <div className="border border-gray-200 rounded-lg overflow-hidden">{tablaCuotas(activa.cuotas)}</div>

        <div className="rounded-lg border border-purple-200 p-3 space-y-3">
          <p className="text-sm font-semibold text-purple-900">Registrar pago de la penalidad</p>
          <div className={`rounded-lg border p-3 space-y-3 ${dos ? 'border-emerald-300 bg-emerald-50/40' : 'border-gray-200 bg-gray-50'}`}>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-800 cursor-pointer select-none">
              <input type="checkbox" checked={dos} onChange={() => { setDos(v => !v); setRecs([null, null]) }}
                className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500" />
              El pago tiene dos recibos
            </label>
            {dos && <RecibosDobles carpetaId={titular._id} recibos={recs} onChange={setRecs} />}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700">Valor a pagar</label>
              <div className="relative mt-1"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">$</span>
                <input type="text" inputMode="numeric" value={money(pv)} onChange={e => setPv(soloDigitos(e.target.value))}
                  className="w-full pl-7 pr-3 py-2 border border-gray-300 rounded-md text-sm" /></div>
              <p className="mt-1 text-xs text-gray-500">Cuota {sig?.n}: faltan {fmt(sig ? sig.valor - sig.pagado : 0)}. Puedes adelantar varias.</p>
            </div>
            <div><label className="block text-sm font-medium text-gray-700">Fecha de pago</label>
              <input type="date" value={pFecha} onChange={e => setPFecha(e.target.value)} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-sm" /></div>
            <div><label className="block text-sm font-medium text-gray-700">Fecha de reporte</label>
              <input type="date" value={pReporte} onChange={e => setPReporte(e.target.value)} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-sm" /></div>
            <div><label className="block text-sm font-medium text-gray-700">Medio de pago</label>
              <select value={pMedio} onChange={e => setPMedio(e.target.value)} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-sm">
                <option value="">Seleccione</option>{mediosPagoPara(titular.plataforma).map(m => <option key={m} value={m}>{m}</option>)}
              </select></div>
            <div><label className="block text-sm font-medium text-gray-700">Banco</label>
              <input type="text" value={pBanco} maxLength={80} onChange={e => setPBanco(e.target.value)} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-sm" /></div>
            <div><label className="block text-sm font-medium text-gray-700"># Referencia</label>
              <input type="text" value={pRef} onChange={e => setPRef(e.target.value.replace(/[^A-Za-z0-9\-]/g, ''))} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-sm" /></div>
            <div className="md:col-span-2"><label className="block text-sm font-medium text-gray-700">Nota</label>
              <input type="text" value={pNota} maxLength={300} onChange={e => setPNota(e.target.value)} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-sm" /></div>
          </div>
          <div className="flex justify-end">
            <button type="button" onClick={pagar} disabled={pagando || toNum(pv) <= 0}
              className="px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-md hover:bg-purple-700 disabled:opacity-50">
              {pagando ? 'Guardando…' : 'Registrar pago de penalidad'}
            </button>
          </div>
        </div>

        {puedeCancelar && (
          <div className="rounded-lg border border-red-200 p-3">
            {!verCancelar ? (
              <button type="button" onClick={() => setVerCancelar(true)} className="text-sm font-medium text-red-700 hover:underline">
                Cancelar el proceso de penalidad…
              </button>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-red-800">Lo ya pagado pasa a abonos del saldo original, las cuotas pendientes se cancelan, el contrato vuelve a su estado anterior y se habilita «Registrar Pago».</p>
                <textarea value={motivo} onChange={e => setMotivo(e.target.value)} rows={2} placeholder="Motivo de la cancelación (mín. 10 caracteres)"
                  className="w-full px-3 py-2 border border-red-300 rounded-md text-sm" />
                <label className="flex items-center gap-2 text-sm text-red-900">
                  <input type="checkbox" checked={okCancelar} onChange={e => setOkCancelar(e.target.checked)} /> Confirmo la cancelación
                </label>
                <div className="flex gap-2">
                  <button type="button" onClick={cancelar} disabled={cancelando || !okCancelar || motivo.trim().length < 10}
                    className="px-3 py-1.5 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50">
                    {cancelando ? 'Cancelando…' : 'Cancelar penalidad'}
                  </button>
                  <button type="button" onClick={() => setVerCancelar(false)} className="px-3 py-1.5 text-sm text-gray-700 border border-gray-300 rounded-md">Volver</button>
                </div>
              </div>
            )}
          </div>
        )}
        {historial}
      </div>
    )
  }

  // ── Sin penalidad activa ───────────────────────────────────────────────
  if (!est.puedeNueva) {
    return (
      <div className="space-y-3">
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Este contrato ya usó sus {MAX_PENALIDADES_POR_CONTRATO} penalidades; no admite otra.
        </p>
        {historial}
      </div>
    )
  }
  if (!puedeActivar) {
    return <p className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">No tienes permiso para activar una penalidad.</p>
  }
  if (est.saldo <= 0) {
    return <p className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">El contrato no tiene saldo pendiente.</p>
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-900">
        El titular desiste y paga sólo el <strong>{est.porcentaje}% del saldo</strong> en cuotas; el resto se condona al pagar la última.
        Contrato {est.contrato || '—'} · Penalidad {est.creadas + 1} de {MAX_PENALIDADES_POR_CONTRATO} posibles.
      </div>

      {/* 1. Valor */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div><label className="block text-sm font-medium text-gray-700">Saldo a la fecha</label>
          <div className="mt-1 px-3 py-2 bg-gray-100 border border-gray-300 rounded-md text-sm font-medium">{fmt(est.saldo)}</div></div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Penalidad ({est.porcentaje}%) — corregible</label>
          <div className="relative mt-1"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">$</span>
            <input type="text" inputMode="numeric" value={money(valorStr)} disabled={valorOk}
              onChange={e => setValorStr(soloDigitos(e.target.value))}
              className="w-full pl-7 pr-3 py-2 border border-gray-300 rounded-md text-sm disabled:bg-gray-100" /></div>
        </div>
        <div className="flex items-end">
          {!valorOk ? (
            <button type="button" onClick={() => {
              const v = toNum(valorStr)
              if (v <= 0 || v > est.saldo) { toast.error('El valor debe ser mayor a 0 y no superar el saldo'); return }
              setValorOk(true)
            }} className="px-4 py-2 text-sm font-medium text-white bg-orange-600 rounded-md hover:bg-orange-700">Confirmar valor</button>
          ) : (
            <button type="button" onClick={() => { setValorOk(false); setFechas([]) }} className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-md">Corregir valor</button>
          )}
        </div>
      </div>

      {/* 2. Cuotas */}
      {valorOk && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div><label className="block text-sm font-medium text-gray-700">Número de cuotas (1–{MAX_CUOTAS_PENALIDAD})</label>
            <input type="text" inputMode="numeric" value={numCuotas} onChange={e => { setNumCuotas(soloDigitos(e.target.value)); setFechas([]) }}
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-center font-semibold" /></div>
          <div><label className="block text-sm font-medium text-gray-700">Vencimiento de la primera cuota</label>
            <input type="date" value={primeraFecha} onChange={e => { setPrimeraFecha(e.target.value); setFechas([]) }}
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-sm" /></div>
        </div>
      )}

      {/* 3. Plan */}
      {plan.length > 0 && (
        <>
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-gray-600"><tr>
                <th className="px-3 py-1.5 text-center">Cuota</th><th className="px-3 py-1.5 text-left">Vence (editable)</th><th className="px-3 py-1.5 text-right">Valor</th></tr></thead>
              <tbody>
                {plan.map((c, i) => (
                  <tr key={c.n} className="border-t border-gray-100">
                    <td className="px-3 py-1.5 text-center font-semibold">{c.n}</td>
                    <td className="px-3 py-1.5">
                      <input type="date" value={c.fecha} onChange={e => setFechas(plan.map((x, j) => j === i ? e.target.value : x.fecha))}
                        className="px-2 py-1 border border-gray-300 rounded text-sm" />
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmt(c.valor)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50 font-semibold"><tr><td className="px-3 py-1.5" colSpan={2}>Total del plan</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmt(plan.reduce((s, c) => s + c.valor, 0))}</td></tr></tfoot>
            </table>
          </div>
          <p className="text-xs text-gray-600">Se condonarían {fmt(est.saldo - toNum(valorStr))} (el resto del saldo) al pagar la última cuota.</p>
          <div>
            <label className="block text-sm font-bold text-rose-900">Nota <span className="text-rose-600">*</span></label>
            <textarea value={nota} onChange={e => setNota(e.target.value)} rows={2} maxLength={500}
              placeholder="Motivo: por qué el titular desiste y cómo se acordó la penalidad"
              className="mt-1 w-full px-3 py-2 border border-rose-300 rounded-md text-sm" />
          </div>
          <label className="flex items-start gap-2 text-sm text-gray-800">
            <input type="checkbox" className="mt-0.5" checked={confirmo} onChange={e => setConfirmo(e.target.checked)} />
            Apruebo este plan: el contrato pasará a «Cierre a cuotas», se deshabilitará «Registrar Pago» y se guardará el saldo inicial ({fmt(est.saldo)}).
          </label>
          <div className="flex justify-end">
            <button type="button" onClick={aprobar} disabled={guardando || !confirmo || !nota.trim()}
              className="px-4 py-2 text-sm font-medium text-white bg-orange-600 rounded-md hover:bg-orange-700 disabled:opacity-50">
              {guardando ? 'Aprobando…' : 'Aprobar plan de penalidad'}
            </button>
          </div>
        </>
      )}
      {historial}
    </div>
  )
}
