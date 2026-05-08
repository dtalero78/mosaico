'use client';

import { useState, useEffect } from 'react';
import { X, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';

interface StudentChangeStepProps {
  studentId: string;
  numeroId: string;
  currentStep: string;
  currentNivel: string;
  studentName: string;
  onClose: () => void;
  onSuccess: () => void;
}

interface StepOption {
  label: string;   // "BN1 — Step 5"
  value: string;   // "Step 5" (full name, used by both endpoints)
  numero: string;  // "5"
}

export default function StudentChangeStep({
  studentId,
  currentStep,
  currentNivel,
  studentName,
  onClose,
  onSuccess,
}: StudentChangeStepProps) {
  const [selectedStep, setSelectedStep] = useState('');
  const [isUpdating, setIsUpdating]     = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [success, setSuccess]           = useState(false);
  const [stepOptions, setStepOptions]   = useState<StepOption[]>([]);
  const [loadingSteps, setLoadingSteps] = useState(true);

  // Toggle "Cambio Académico" — activa campos de auditoría
  const [auditMode, setAuditMode]       = useState(false);
  const [motivo, setMotivo]             = useState('');
  const [autorizadoPor, setAutorizado]  = useState('');
  const [comentario, setComentario]     = useState('');

  useEffect(() => {
    const fetchAllSteps = async () => {
      try {
        setLoadingSteps(true);
        const response = await fetch('/api/postgres/niveles');
        if (!response.ok) throw new Error('Error al cargar los niveles');
        const data = await response.json();

        if (data.success && data.niveles) {
          const allSteps: StepOption[] = [];
          data.niveles.forEach((nivel: any) => {
            if (nivel.steps && Array.isArray(nivel.steps)) {
              nivel.steps.forEach((step: string) => {
                if (!allSteps.find(s => s.value === step)) {
                  const numero = step.replace(/[^0-9]/g, '');
                  allSteps.push({ label: `${nivel.code} — ${step}`, value: step, numero });
                }
              });
            }
          });
          allSteps.sort((a, b) => Number(a.numero) - Number(b.numero));
          setStepOptions(allSteps);
        } else {
          throw new Error('No se encontraron niveles');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al cargar los steps');
      } finally {
        setLoadingSteps(false);
      }
    };
    fetchAllSteps();
  }, []);

  const handleUpdateStep = async () => {
    if (!selectedStep) { setError('Debes seleccionar un nuevo Step'); return; }
    if (auditMode) {
      if (!motivo.trim())        { setError('El motivo es requerido'); return; }
      if (!autorizadoPor.trim()) { setError('El autorizante es requerido'); return; }
    }

    setIsUpdating(true);
    setError(null);

    try {
      let response: Response;

      if (auditMode) {
        // ── Modo auditado: guarda auditoría + comentario ──────────────────
        response = await fetch(
          `/api/postgres/students/${encodeURIComponent(studentId)}/cambio-step-auditado`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ newStep: selectedStep, motivo, autorizadoPor, comentario }),
          }
        );
      } else {
        // ── Modo simple: igual que antes ──────────────────────────────────
        response = await fetch(
          `/api/postgres/students/${encodeURIComponent(studentId)}/step`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ newStep: selectedStep }),
          }
        );
      }

      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Error al actualizar el step');

      setSuccess(true);
      setTimeout(() => { onSuccess(); onClose(); }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setIsUpdating(false);
    }
  };

  const fmtNow = () => new Date().toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">

        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">Cambiar Step</h2>
          <button onClick={onClose} disabled={isUpdating} className="text-gray-400 hover:text-gray-500">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 space-y-5">

          {/* Info estudiante */}
          <div className="p-4 bg-blue-50 rounded-lg">
            <h3 className="font-medium text-gray-900 mb-1">{studentName}</h3>
            <p className="text-sm text-gray-600">Nivel actual: <strong>{currentNivel}</strong></p>
            <p className="text-sm text-gray-600">Step actual: <strong>{currentStep}</strong></p>
          </div>

          {/* Selector de Step */}
          <div>
            <label htmlFor="newStep" className="block text-sm font-medium text-gray-700 mb-2">
              Nuevo Step
            </label>
            {loadingSteps ? (
              <div className="flex items-center py-3 px-3 border border-gray-300 rounded-md bg-gray-50">
                <Loader2 className="h-5 w-5 animate-spin text-blue-600 mr-2" />
                <span className="text-sm text-gray-600">Cargando steps...</span>
              </div>
            ) : (
              <select
                id="newStep"
                value={selectedStep}
                onChange={e => setSelectedStep(e.target.value)}
                disabled={isUpdating}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Selecciona un Step</option>
                {stepOptions.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            )}
          </div>

          {/* Advertencia */}
          <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-yellow-800">
                Esta acción actualizará el Step y el Nivel del estudiante en las tablas ACADEMICA y PEOPLE.
                El nuevo Nivel se asignará automáticamente según el Step seleccionado.
              </p>
            </div>
          </div>

          {/* ── Toggle "Cambio Académico" ──────────────────────────────────── */}
          <div className="border border-gray-200 rounded-lg p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-700">Cambio Académico</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {auditMode
                    ? 'Se registrará la auditoría y un comentario en el historial'
                    : 'Activar para registrar auditoría del cambio'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => { setAuditMode(v => !v); setError(null); }}
                disabled={isUpdating}
                title={auditMode ? 'Desactivar Cambio Académico' : 'Activar Cambio Académico'}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${auditMode ? 'bg-indigo-600' : 'bg-gray-300'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${auditMode ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>

            {/* Campos de auditoría — visibles solo cuando auditMode = true */}
            {auditMode && (
              <div className="space-y-3 pt-1 border-t border-gray-100">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Motivo del cambio *
                  </label>
                  <textarea
                    value={motivo}
                    onChange={e => setMotivo(e.target.value)}
                    rows={2}
                    placeholder="Describa el motivo del cambio..."
                    disabled={isUpdating}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Autorizado por *
                  </label>
                  <input
                    type="text"
                    value={autorizadoPor}
                    onChange={e => setAutorizado(e.target.value)}
                    placeholder="Nombre de quien autoriza"
                    disabled={isUpdating}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Comentario para historial
                    <span className="ml-1 text-gray-400">(opcional — Académico → General)</span>
                  </label>
                  <textarea
                    value={comentario}
                    onChange={e => setComentario(e.target.value)}
                    rows={2}
                    placeholder="Observaciones adicionales..."
                    disabled={isUpdating}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                  />
                </div>
                <p className="text-xs text-gray-400">
                  Fecha y hora: {fmtNow()} (se registra al confirmar)
                </p>
              </div>
            )}
          </div>

          {/* Éxito */}
          {success && (
            <div className="p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              <p className="text-sm text-green-800 font-medium">Step actualizado exitosamente</p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 p-6 border-t border-gray-200">
          <button
            onClick={onClose}
            disabled={isUpdating}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleUpdateStep}
            disabled={isUpdating || !selectedStep || success || loadingSteps}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            {isUpdating ? 'Actualizando...' : success ? 'Actualizado ✓' : 'Actualizar Step'}
          </button>
        </div>
      </div>
    </div>
  );
}
