'use client';

import { useEffect, useMemo, useState } from 'react';
import { campaignNameToDate } from '@/lib/cursos-campaign';
import { ArrowUpTrayIcon, CheckCircleIcon, ExclamationTriangleIcon, XCircleIcon } from '@heroicons/react/24/outline';

/**
 * Subir Lote → modo Contratos. Sube un CSV de contratos MOSAICO, elige la campaña
 * destino, valida (dry-run) contra la BD y migra los que no tengan errores. Reusa
 * el endpoint /api/admin/contratos/bulk → createFullContract (la misma creación que
 * Crear/Migrar Contrato). El PDF NO se envía por WhatsApp (es migración).
 */

interface BenefRes { nombre: string; curso: string | null; horario: string | null; id: string }
interface ContratoRes {
  contrato: string; titular: string; campaign: string | null; campaignRaw: string;
  titularEsBeneficiario: boolean;
  beneficiarios: BenefRes[];
  financial: { totalPlan: string; pagoInscripcion: string; saldo: string; numeroCuotas: string; valorCuota: string; plan: string };
  issues: string[]; bloqueante: boolean;
  estado?: 'creado' | 'omitido' | 'fallido'; mensaje?: string; beneficiariosCreados?: number;
}
interface Resumen {
  total: number; bloqueantes: number; observaciones: number;
  creados?: number; omitidos?: number; fallidos?: number;
  contratos: ContratoRes[];
}

/** Decodifica el CSV tolerando UTF-8 (con/sin BOM) y latin1 (windows-1252). */
async function decodeCsv(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
    return new TextDecoder('utf-8').decode(buf.slice(3)); // UTF-8 con BOM
  }
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  if (utf8.includes('�')) return new TextDecoder('windows-1252').decode(buf); // latin1
  return utf8;
}

export default function SubirLoteContratos() {
  const [campaigns, setCampaigns] = useState<string[]>([]);
  const [campaign, setCampaign] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [csvText, setCsvText] = useState('');
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [aplicado, setAplicado] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState(false);

  useEffect(() => {
    fetch('/api/postgres/campaigns')
      .then(r => r.json())
      .then(j => {
        const nombres = [...new Set((j.rows || []).map((r: any) => r.campaign).filter(Boolean))] as string[];
        nombres.sort((a, b) => (campaignNameToDate(b) || '').localeCompare(campaignNameToDate(a) || ''));
        setCampaigns(nombres);
      })
      .catch(() => setError('No se pudieron cargar las campañas'));
  }, []);

  const migrables = useMemo(
    () => (resumen?.contratos || []).filter(c => !c.bloqueante).length,
    [resumen],
  );

  async function onFile(f: File | null) {
    setResumen(null); setAplicado(false); setError(null);
    setFile(f);
    if (!f) { setCsvText(''); return; }
    try { setCsvText(await decodeCsv(f)); } catch { setError('No se pudo leer el archivo'); }
  }

  async function llamar(apply: boolean) {
    if (!campaign) { setError('Selecciona la campaña destino'); return; }
    if (!csvText) { setError('Sube un archivo CSV'); return; }
    setLoading(true); setError(null);
    try {
      const r = await fetch('/api/admin/contratos/bulk', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvText, campaign, apply }),
      });
      const j = await r.json();
      if (!j.success) { setError(j.error || 'Error en el proceso'); return; }
      setResumen(j as Resumen);
      setAplicado(apply);
    } catch {
      setError('Error de red');
    } finally {
      setLoading(false); setConfirmar(false);
    }
  }

  const estadoBadge = (c: ContratoRes) => {
    if (aplicado) {
      if (c.estado === 'creado') return <span className="inline-flex items-center gap-1 text-green-700"><CheckCircleIcon className="w-4 h-4" /> Creado</span>;
      if (c.estado === 'fallido') return <span className="inline-flex items-center gap-1 text-red-700"><XCircleIcon className="w-4 h-4" /> Fallido</span>;
      return <span className="inline-flex items-center gap-1 text-gray-500"><XCircleIcon className="w-4 h-4" /> Omitido</span>;
    }
    if (c.bloqueante) return <span className="inline-flex items-center gap-1 text-red-700"><XCircleIcon className="w-4 h-4" /> Con errores</span>;
    if (c.issues.length) return <span className="inline-flex items-center gap-1 text-amber-600"><ExclamationTriangleIcon className="w-4 h-4" /> Observaciones</span>;
    return <span className="inline-flex items-center gap-1 text-green-700"><CheckCircleIcon className="w-4 h-4" /> Listo</span>;
  };

  return (
    <div className="max-w-6xl">
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 mb-5">
        Migra contratos existentes desde un CSV (titular + hasta 2 beneficiarios). Crea PEOPLE, ACADEMICA (curso puente WELCOME, inactivo),
        USUARIOS_ROLES, cupos y FINANCIEROS — <strong>sin enviar WhatsApp</strong>. Elige la campaña destino, <strong>valida</strong> primero
        y luego migra los que no tengan errores.
      </div>

      {/* Controles */}
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Campaña destino</label>
          <select value={campaign} onChange={e => { setCampaign(e.target.value); setResumen(null); setAplicado(false); }}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm min-w-[220px] focus:ring-2 focus:ring-primary-500">
            <option value="">Selecciona una campaña…</option>
            {campaigns.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Archivo CSV</label>
          <label className="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 cursor-pointer">
            <ArrowUpTrayIcon className="w-4 h-4" />
            {file ? file.name : 'Seleccionar archivo…'}
            <input type="file" accept=".csv,text/csv" className="hidden"
              onChange={e => onFile(e.target.files?.[0] || null)} />
          </label>
        </div>

        <button type="button" onClick={() => llamar(false)} disabled={loading || !csvText || !campaign}
          className="px-4 py-2 text-sm rounded-lg text-white bg-primary-600 hover:bg-primary-700 disabled:bg-gray-200 disabled:text-gray-400">
          {loading && !confirmar ? 'Validando…' : 'Validar'}
        </button>

        {resumen && !aplicado && migrables > 0 && (
          <button type="button" onClick={() => setConfirmar(true)} disabled={loading}
            className="px-4 py-2 text-sm rounded-lg text-white bg-green-600 hover:bg-green-700 disabled:bg-gray-200 disabled:text-gray-400">
            Migrar {migrables} contrato{migrables === 1 ? '' : 's'}
          </button>
        )}
      </div>

      {error && <div className="mb-3 text-sm text-red-600">{error}</div>}

      {/* Resumen */}
      {resumen && (
        <div className="rounded-lg border border-gray-200 bg-white p-3 mb-3 text-sm text-gray-700 flex flex-wrap gap-x-6 gap-y-1">
          <span><strong>{resumen.total}</strong> contratos</span>
          <span className="text-red-600"><strong>{resumen.bloqueantes}</strong> con errores</span>
          <span className="text-amber-600"><strong>{resumen.observaciones}</strong> observaciones</span>
          {aplicado && <>
            <span className="text-green-700"><strong>{resumen.creados ?? 0}</strong> creados</span>
            <span className="text-gray-500"><strong>{resumen.omitidos ?? 0}</strong> omitidos</span>
            <span className="text-red-600"><strong>{resumen.fallidos ?? 0}</strong> fallidos</span>
          </>}
        </div>
      )}

      {/* Tabla */}
      {resumen && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Estado</th>
                  <th className="px-3 py-2 text-left font-medium">Contrato</th>
                  <th className="px-3 py-2 text-left font-medium">Titular</th>
                  <th className="px-3 py-2 text-left font-medium">Beneficiarios / Curso</th>
                  <th className="px-3 py-2 text-left font-medium">Plan</th>
                  <th className="px-3 py-2 text-left font-medium">Detalle</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {resumen.contratos.map((c, i) => (
                  <tr key={`${c.contrato}-${i}`} className={c.bloqueante ? 'bg-red-50/40' : c.estado === 'creado' ? 'bg-green-50/40' : ''}>
                    <td className="px-3 py-2 whitespace-nowrap">{estadoBadge(c)}</td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-800">{c.contrato || <span className="text-gray-300">—</span>}</td>
                    <td className="px-3 py-2 text-gray-800">{c.titular || <span className="text-gray-300">—</span>}</td>
                    <td className="px-3 py-2 text-gray-700">
                      {c.beneficiarios.map((b, j) => (
                        <div key={j} className="text-xs">
                          {b.nombre} <span className="text-gray-400">·</span> {b.curso || '—'} {b.horario || ''}
                        </div>
                      ))}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-600 whitespace-nowrap">
                      {c.financial.plan} · {c.financial.numeroCuotas} cuota(s)
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {aplicado && c.mensaje && <div className={c.estado === 'fallido' ? 'text-red-600' : 'text-gray-500'}>{c.mensaje}</div>}
                      {c.issues.map((x, j) => (
                        <div key={j} className={x.startsWith('❌') ? 'text-red-600' : 'text-amber-600'}>{x}</div>
                      ))}
                      {!c.issues.length && !aplicado && <span className="text-gray-300">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal confirmación */}
      {confirmar && resumen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Confirmar migración</h3>
            <p className="text-sm text-gray-600 mb-4">
              Se crearán <strong>{migrables}</strong> contrato{migrables === 1 ? '' : 's'} en la campaña <strong>{campaign}</strong>.
              Los {resumen.bloqueantes} con errores se omiten. Esta acción escribe en producción y no se puede deshacer automáticamente.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmar(false)} disabled={loading}
                className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">Cancelar</button>
              <button type="button" onClick={() => llamar(true)} disabled={loading}
                className="px-4 py-2 text-sm rounded-lg text-white bg-green-600 hover:bg-green-700 disabled:bg-gray-300">
                {loading ? 'Migrando…' : `Sí, migrar ${migrables}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
