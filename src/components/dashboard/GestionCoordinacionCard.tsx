'use client'

import { useEffect, useState } from 'react'

/**
 * "Gestión Coordinación" — cuánto tuvo que rescatar la Coordinación en el mes.
 *
 * Ocupa el sitio del antiguo mapa de calor de canceladas porque responde algo más
 * útil: no *cuándo* se canceló, sino *cuánto* de lo que le tocaba al guía terminó
 * haciéndolo otro.
 *
 * Cada fila lleva su propia tasa y la del resto de los guías. La comparación es
 * en tasa y no en total: un guía con 40 sesiones y otro con 4 no se pueden
 * comparar en números absolutos. Las cuentas de Coordinación quedan fuera del
 * promedio — son quienes hacen el rescate, así que se estarían comparando contra
 * su propio trabajo.
 */

interface Metrica {
  valor: number; base: number;
  tasa: number | null; tasaPares: number | null; pares: number;
}
interface Datos {
  guia: { id: string; nombre: string | null; enComparacion: boolean };
  canceladas: Metrica; sesiones: Metrica; reportes: Metrica;
}

const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 1000) / 10}%`);

/** Menos es mejor en las tres: por eso el verde es estar por debajo del resto. */
function veredicto(m: Metrica): { texto: string; clase: string } {
  if (m.tasa === null || m.tasaPares === null) return { texto: 'sin comparación', clase: 'text-gray-400' };
  const d = m.tasa - m.tasaPares;
  if (Math.abs(d) < 0.005) return { texto: 'igual que el resto', clase: 'text-gray-500' };
  return d < 0
    ? { texto: `${pct(Math.abs(d))} por debajo del resto`, clase: 'text-emerald-600' }
    : { texto: `${pct(d)} por encima del resto`, clase: 'text-red-600' };
}

function Fila({ label, sub, m, color }: { label: string; sub: string; m: Metrica; color: string }) {
  const v = veredicto(m);
  // Barras a la misma escala, acotadas para que una tasa alta no desborde.
  const ancho = (x: number | null) => (x === null ? 0 : Math.min(100, Math.round(x * 100)));
  return (
    <div className="py-2.5 border-b border-gray-100 last:border-0">
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">{label}</p>
          <p className="text-[11px] text-gray-500 truncate">{sub}</p>
        </div>
        <div className="text-right shrink-0">
          <p className={`text-xl font-bold ${color} tabular-nums leading-none`}>{m.valor}</p>
          <p className="text-[11px] text-gray-500 tabular-nums">
            {m.base > 0 ? `de ${m.base} · ${pct(m.tasa)}` : 'sin base'}
          </p>
        </div>
      </div>
      <div className="mt-1.5 space-y-1">
        <div className="flex items-center gap-2">
          <div className="h-1.5 flex-1 rounded-full bg-gray-100 overflow-hidden">
            <div className={`h-full rounded-full ${color.replace('text-', 'bg-')}`} style={{ width: `${ancho(m.tasa)}%` }} />
          </div>
          <span className="text-[10px] text-gray-500 w-24 shrink-0">este guía</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-1.5 flex-1 rounded-full bg-gray-100 overflow-hidden">
            <div className="h-full rounded-full bg-gray-400" style={{ width: `${ancho(m.tasaPares)}%` }} />
          </div>
          <span className="text-[10px] text-gray-500 w-24 shrink-0">
            resto ({m.pares}) · {pct(m.tasaPares)}
          </span>
        </div>
      </div>
      <p className={`text-[11px] font-medium mt-1 ${v.clase}`}>{v.texto}</p>
    </div>
  );
}

export default function GestionCoordinacionCard(
  { advisorId, year, month, mesLabel }: { advisorId: string; year: number; month: number; mesLabel?: string },
) {
  const [d, setD] = useState<Datos | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!advisorId) return;
    let vivo = true;
    setD(null); setErr(null);
    fetch(`/api/postgres/guias/${advisorId}/gestion-coordinacion?year=${year}&month=${month}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(j => { if (!vivo) return; if (!j?.success) throw new Error(j?.error || 'Error'); setD(j as Datos); })
      .catch(e => { if (vivo) setErr(e?.message || 'Error al cargar'); });
    return () => { vivo = false };
  }, [advisorId, year, month]);

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <h3 className="text-sm font-semibold text-gray-900">🛡 Gestión Coordinación</h3>
        {mesLabel && <span className="text-[11px] text-gray-400">{mesLabel}</span>}
      </div>
      <p className="text-[11px] text-gray-500 mb-2">
        Lo que tuvo que resolver la Coordinación por este guía. Menos es mejor.
      </p>

      {err && <p className="text-sm text-red-600 py-6 text-center">{err}</p>}
      {!d && !err && <p className="text-sm text-gray-400 py-8 text-center">Cargando…</p>}

      {d && (
        <>
          <Fila label="Clases canceladas" sub="canceladas por el guía, sobre su agenda del mes"
            m={d.canceladas} color="text-red-600" />
          <Fila label="Sesiones registradas por Coordinación" sub="el guía no las cerró en su plazo"
            m={d.sesiones} color="text-amber-600" />
          <Fila label="Informes cerrados por Coordinación" sub="informes semanales que el guía no cerró"
            m={d.reportes} color="text-violet-600" />
          {!d.guia.enComparacion && (
            <p className="text-[11px] text-sky-700 bg-sky-50 border border-sky-200 rounded-lg px-2 py-1.5 mt-2">
              Esta es una cuenta de Coordinación: queda fuera del promedio con el que se compara al resto.
            </p>
          )}
        </>
      )}
    </div>
  );
}
