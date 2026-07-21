'use client';

import { useState, useCallback, useRef } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { PermissionGuard } from '@/components/permissions';
import { ComercialPermission } from '@/types/permissions';
import SubirLoteContratos from '@/components/comercial/SubirLoteContratos';

interface RegistroPeople {
  fila: number;
  numeroId: string;
  primerNombre: string;
  segundoNombre: string;
  primerApellido: string;
  segundoApellido: string;
  tipoUsuario: string;
  email: string;
  celular: string;
  pais: string;
  ciudad: string;
  direccion: string;
  contrato: string;
  plataforma: string;
  nivel: string;
  step: string;
  fechaNacimiento: string;
  inicioContrato: string;
  finalContrato: string;
  [key: string]: string | number;
}

const COLUMN_MAP: Record<string, string> = {
  // Exact matches
  numeroid: 'numeroId',
  primernombre: 'primerNombre',
  segundonombre: 'segundoNombre',
  primerapellido: 'primerApellido',
  segundoapellido: 'segundoApellido',
  tipousuario: 'tipoUsuario',
  email: 'email',
  celular: 'celular',
  pais: 'pais',
  ciudad: 'ciudad',
  direccion: 'direccion',
  contrato: 'contrato',
  plataforma: 'plataforma',
  nivel: 'nivel',
  step: 'step',
  fechanacimiento: 'fechaNacimiento',
  iniciocontrato: 'inicioContrato',
  finalcontrato: 'finalContrato',
  // Aliases
  'numero id': 'numeroId',
  'numero de id': 'numeroId',
  'documento': 'numeroId',
  'cedula': 'numeroId',
  'id': 'numeroId',
  'primer nombre': 'primerNombre',
  'nombres': 'primerNombre',
  'nombre': 'primerNombre',
  'segundo nombre': 'segundoNombre',
  'primer apellido': 'primerApellido',
  'apellidos': 'primerApellido',
  'apellido': 'primerApellido',
  'segundo apellido': 'segundoApellido',
  'tipo usuario': 'tipoUsuario',
  'tipo': 'tipoUsuario',
  'correo': 'email',
  'correo electronico': 'email',
  'telefono': 'celular',
  'celular2': 'celular',
  'phone': 'celular',
  'country': 'pais',
  'city': 'ciudad',
  'address': 'direccion',
  'contract': 'contrato',
  'numero contrato': 'contrato',
  'platform': 'plataforma',
  'level': 'nivel',
  'fecha nacimiento': 'fechaNacimiento',
  'nacimiento': 'fechaNacimiento',
  'inicio contrato': 'inicioContrato',
  'fecha inicio': 'inicioContrato',
  'fin contrato': 'finalContrato',
  'fecha fin': 'finalContrato',
  'final contrato': 'finalContrato',
};

const TABLE_COLUMNS = [
  { key: 'numeroId', label: 'Número ID', required: true },
  { key: 'primerNombre', label: 'Primer Nombre', required: true },
  { key: 'segundoNombre', label: 'Segundo Nombre', required: false },
  { key: 'primerApellido', label: 'Primer Apellido', required: true },
  { key: 'segundoApellido', label: 'Segundo Apellido', required: false },
  { key: 'tipoUsuario', label: 'Tipo Usuario', required: true },
  { key: 'email', label: 'Email', required: false },
  { key: 'celular', label: 'Celular', required: false },
  { key: 'pais', label: 'País', required: false },
  { key: 'ciudad', label: 'Ciudad', required: false },
  { key: 'direccion', label: 'Dirección', required: false },
  { key: 'contrato', label: 'Contrato', required: false },
  { key: 'plataforma', label: 'Plataforma', required: false },
  { key: 'nivel', label: 'Nivel', required: false },
  { key: 'step', label: 'Step', required: false },
  { key: 'fechaNacimiento', label: 'Fecha Nacimiento', required: false },
  { key: 'inicioContrato', label: 'Inicio Contrato', required: false },
  { key: 'finalContrato', label: 'Final Contrato', required: false },
];

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let current = '';
  let inQuotes = false;
  let row: string[] = [];

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',' || char === ';') {
        row.push(current.trim());
        current = '';
      } else if (char === '\n' || (char === '\r' && next === '\n')) {
        row.push(current.trim());
        if (row.some(c => c !== '')) rows.push(row);
        row = [];
        current = '';
        if (char === '\r') i++;
      } else {
        current += char;
      }
    }
  }
  // Last row
  row.push(current.trim());
  if (row.some(c => c !== '')) rows.push(row);

  return rows;
}

function mapHeaders(headers: string[]): string[] {
  return headers.map(h => {
    const normalized = h.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
    return COLUMN_MAP[normalized] || h;
  });
}

function parseDate(val: string): string {
  if (!val) return '';
  // Try YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(val)) return val.substring(0, 10);
  // Try DD/MM/YYYY
  const dmy = val.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  return val;
}

export default function SubirLotePage() {
  const [file, setFile] = useState<File | null>(null);
  const [registros, _setRegistros] = useState<RegistroPeople[]>([]);
  const registrosRef = useRef<RegistroPeople[]>([]);
  const setRegistros = (val: RegistroPeople[] | ((prev: RegistroPeople[]) => RegistroPeople[])) => {
    if (typeof val === 'function') {
      _setRegistros(prev => { const next = val(prev); registrosRef.current = next; return next; });
    } else {
      registrosRef.current = val;
      _setRegistros(val);
    }
  };
  const [errores, setErrores] = useState<string[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [loading, setLoading] = useState(false);
  const [importResult, setImportResult] = useState<{ exitosos: number; fallidos: number; errores: string[] } | null>(null);
  const [editingCell, setEditingCell] = useState<{ row: number; field: string } | null>(null);
  const [modo, setModo] = useState<'personas' | 'contratos'>('personas');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((f: File) => {
    if (!f.name.endsWith('.csv') && !f.name.endsWith('.xlsx') && !f.name.endsWith('.xls')) {
      alert('Solo se permiten archivos CSV');
      return;
    }
    setFile(f);
    setImportResult(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const previsualizar = useCallback(async () => {
    if (!file) return;
    setLoading(true);
    setErrores([]);

    try {
      const text = await file.text();
      // Remove BOM
      const clean = text.replace(/^\uFEFF/, '');
      const rows = parseCSV(clean);
      if (rows.length < 2) {
        alert('El archivo no tiene datos suficientes');
        setLoading(false);
        return;
      }

      const rawHeaders = rows[0];
      const mappedHeaders = mapHeaders(rawHeaders);
      const dataRows = rows.slice(1);
      const parsed: RegistroPeople[] = [];
      const errs: string[] = [];

      dataRows.forEach((row, idx) => {
        const reg: any = { fila: idx + 2 };
        mappedHeaders.forEach((header, colIdx) => {
          const val = row[colIdx] || '';
          if (['fechaNacimiento', 'inicioContrato', 'finalContrato'].includes(header)) {
            reg[header] = parseDate(val);
          } else {
            reg[header] = val;
          }
        });

        // Defaults
        if (!reg.tipoUsuario) reg.tipoUsuario = 'BENEFICIARIO';

        // Validate required
        if (!reg.numeroId) {
          errs.push(`Fila ${reg.fila}: Falta numeroId`);
          return;
        }
        if (!reg.primerNombre) {
          errs.push(`Fila ${reg.fila}: Falta primerNombre`);
          return;
        }
        if (!reg.primerApellido) {
          errs.push(`Fila ${reg.fila}: Falta primerApellido`);
          return;
        }

        parsed.push(reg as RegistroPeople);
      });

      setRegistros(parsed);
      setErrores(errs);
      setShowPreview(true);
    } catch (err: any) {
      alert('Error leyendo archivo: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [file]);

  const updateCell = useCallback((rowIdx: number, field: string, value: string) => {
    setRegistros(prev => {
      const next = [...prev];
      next[rowIdx] = { ...next[rowIdx], [field]: value };
      return next;
    });
  }, []);

  const importar = async () => {
    const regs = registrosRef.current;
    console.log('importar() registros:', regs.length);
    if (regs.length === 0) { alert('No hay registros'); return; }

    setLoading(true);
    setImportResult(null);

    try {
      const response = await fetch('/api/postgres/people/bulk-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ registros: regs }),
      });

      const data = await response.json();
      if (data.success) {
        setImportResult(data.data);
      } else {
        alert('Error: ' + data.error);
      }
    } catch (err: any) {
      alert('Error de conexión: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const reset = useCallback(() => {
    setFile(null);
    setRegistros([]);
    setErrores([]);
    setShowPreview(false);
    setImportResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  return (
    <DashboardLayout>
      <PermissionGuard permission={ComercialPermission.SUBIR_LOTE} showDefaultMessage>
      <div style={{ background: 'white', borderRadius: 16, boxShadow: '0 4px 20px rgba(0,0,0,0.1)', padding: 40, maxWidth: 1400, margin: '0 auto' }}>
        <h1 style={{ fontSize: 24, fontWeight: 600, color: '#1F2937', marginBottom: 8 }}>
          Subir Lote Contratos
        </h1>
        <p style={{ color: '#6B7280', fontSize: 14, marginBottom: 20 }}>
          {modo === 'personas'
            ? 'Importa múltiples registros a PEOPLE desde un archivo CSV'
            : 'Migra contratos MOSAICO (titular + beneficiarios) desde un archivo CSV'}
        </p>

        {/* Toggle de modo */}
        <div style={{ display: 'inline-flex', gap: 4, padding: 4, background: '#F3F4F6', borderRadius: 10, marginBottom: 28 }}>
          {(['personas', 'contratos'] as const).map(m => (
            <button key={m} type="button" onClick={() => setModo(m)}
              style={{
                padding: '8px 18px', borderRadius: 8, fontSize: 14, fontWeight: 500, border: 'none', cursor: 'pointer',
                background: modo === m ? 'white' : 'transparent',
                color: modo === m ? '#3b1d8a' : '#6B7280',
                boxShadow: modo === m ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              }}>
              {m === 'personas' ? 'Personas' : 'Contratos'}
            </button>
          ))}
        </div>

        {modo === 'contratos' ? (
          <SubirLoteContratos />
        ) : (
        <>

        {/* Import result */}
        {importResult && (
          <div style={{
            padding: '12px 16px',
            borderRadius: 8,
            marginBottom: 16,
            background: importResult.fallidos === 0 ? '#F0FDF4' : '#FFFBEB',
            border: `1px solid ${importResult.fallidos === 0 ? '#86EFAC' : '#FDE68A'}`,
            color: importResult.fallidos === 0 ? '#166534' : '#92400E',
          }}>
            Importaci&oacute;n completada: <strong>{importResult.exitosos}</strong> exitosos,{' '}
            <strong>{importResult.fallidos}</strong> fallidos
            {importResult.errores.length > 0 && (
              <ul style={{ marginTop: 8, fontSize: 13 }}>
                {importResult.errores.slice(0, 20).map((e, i) => <li key={i}>{e}</li>)}
                {importResult.errores.length > 20 && <li>... y {importResult.errores.length - 20} m&aacute;s</li>}
              </ul>
            )}
          </div>
        )}

        {!showPreview ? (
          <>
            {/* Format info */}
            <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, padding: 16, marginBottom: 24 }}>
              <div style={{ fontWeight: 600, fontSize: 14, color: '#1F2937', marginBottom: 8 }}>
                Campos del CSV
              </div>
              <div style={{ fontSize: 12, color: '#64748B', fontFamily: 'monospace', lineHeight: 1.8 }}>
                <span style={{ color: '#DC2626' }}>numeroId*</span>,{' '}
                <span style={{ color: '#DC2626' }}>primerNombre*</span>,{' '}
                segundoNombre,{' '}
                <span style={{ color: '#DC2626' }}>primerApellido*</span>,{' '}
                segundoApellido,{' '}
                <span style={{ color: '#DC2626' }}>tipoUsuario*</span> (BENEFICIARIO/TITULAR),{' '}
                email,{' '}celular,{' '}pais,{' '}ciudad,{' '}direccion,{' '}
                contrato,{' '}plataforma,{' '}nivel,{' '}step,{' '}
                fechaNacimiento (YYYY-MM-DD),{' '}
                inicioContrato (YYYY-MM-DD),{' '}
                finalContrato (YYYY-MM-DD)
              </div>
              <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 8 }}>
                * Campos obligatorios. Los encabezados pueden ser: &quot;Numero ID&quot;, &quot;Documento&quot;, &quot;C&eacute;dula&quot;, &quot;Nombres&quot;, &quot;Apellidos&quot;, etc.
                Si no se especifica tipoUsuario, se asigna BENEFICIARIO.
              </div>
            </div>

            {/* Upload zone */}
            <div
              onDragOver={e => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: '2px dashed #D1D5DB',
                borderRadius: 12,
                padding: 40,
                textAlign: 'center',
                cursor: 'pointer',
                marginBottom: 24,
                ...(file ? { display: 'none' } : {}),
              }}
            >
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2" style={{ margin: '0 auto 16px' }}>
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <div style={{ color: '#374151', fontSize: 16, marginBottom: 8 }}>Haz clic o arrastra tu archivo CSV aqu&iacute;</div>
              <div style={{ color: '#9CA3AF', fontSize: 13 }}>Solo archivos .csv</div>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              style={{ display: 'none' }}
              onChange={e => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }}
            />

            {file && (
              <div style={{
                background: '#F0FDF4',
                border: '1px solid #86EFAC',
                borderRadius: 8,
                padding: '12px 16px',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                marginBottom: 24,
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#22C55E" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
                <span style={{ flex: 1, fontSize: 14, color: '#166534' }}>{file.name}</span>
                <button onClick={reset} style={{ background: 'none', border: 'none', color: '#DC2626', cursor: 'pointer', padding: 4 }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            )}

            {loading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 20 }}>
                <div style={{
                  width: 24, height: 24,
                  border: '3px solid #E5E7EB',
                  borderTopColor: '#3B82F6',
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite',
                }} />
                <span>Procesando archivo...</span>
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              </div>
            )}

            <div style={{ display: 'flex', gap: 12 }}>
              <button
                onClick={previsualizar}
                disabled={!file || loading}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  padding: '12px 24px', borderRadius: 8, fontSize: 14, fontWeight: 500,
                  cursor: file && !loading ? 'pointer' : 'not-allowed',
                  border: 'none',
                  background: file && !loading ? '#3B82F6' : '#9CA3AF',
                  color: 'white',
                }}
              >
                Previsualizar Datos
              </button>
              <a
                href="/"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  padding: '12px 24px', borderRadius: 8, fontSize: 14, fontWeight: 500,
                  background: '#F3F4F6', color: '#374151', textDecoration: 'none',
                }}
              >
                Volver al Dashboard
              </a>
            </div>
          </>
        ) : (
          <>
            {/* Preview */}
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              marginBottom: 16, padding: 16, background: '#F8FAFC', borderRadius: 8,
            }}>
              <div style={{ fontSize: 14, color: '#374151' }}>
                <strong style={{ color: '#3B82F6', fontSize: 18 }}>{registros.length}</strong> registros v&aacute;lidos
              </div>
              <button
                onClick={reset}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  padding: '10px 20px', borderRadius: 8, fontSize: 14, fontWeight: 500,
                  cursor: 'pointer', border: 'none', background: '#3B82F6', color: 'white',
                }}
              >
                Subir Otro Archivo
              </button>
            </div>

            {errores.length > 0 && (
              <div style={{
                background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8,
                padding: '12px 16px', marginBottom: 16, fontSize: 14, color: '#92400E',
              }}>
                {errores.length} fila(s) omitidas por errores:
                <ul style={{ marginTop: 4, fontSize: 12 }}>
                  {errores.slice(0, 10).map((e, i) => <li key={i}>{e}</li>)}
                  {errores.length > 10 && <li>... y {errores.length - 10} m&aacute;s</li>}
                </ul>
              </div>
            )}

            {/* Table */}
            <div style={{
              overflowX: 'auto', border: '1px solid #E5E7EB', borderRadius: 8,
              marginBottom: 24, maxHeight: 600, overflowY: 'auto',
            }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead style={{ position: 'sticky', top: 0, background: '#F9FAFB', zIndex: 10 }}>
                  <tr>
                    <th style={{ padding: '12px 8px', textAlign: 'left', fontWeight: 600, color: '#374151', borderBottom: '2px solid #E5E7EB', whiteSpace: 'nowrap', width: 50 }}>
                      #
                    </th>
                    {TABLE_COLUMNS.map(col => (
                      <th key={col.key} style={{
                        padding: '12px 8px', textAlign: 'left', fontWeight: 600,
                        color: col.required ? '#DC2626' : '#374151',
                        borderBottom: '2px solid #E5E7EB', whiteSpace: 'nowrap',
                      }}>
                        {col.label}{col.required ? '*' : ''}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {registros.map((reg, rowIdx) => (
                    <tr key={rowIdx} style={{ borderBottom: '1px solid #F3F4F6' }}>
                      <td style={{ padding: 8, color: '#6B7280', fontWeight: 500 }}>{reg.fila}</td>
                      {TABLE_COLUMNS.map(col => (
                        <td
                          key={col.key}
                          onClick={() => setEditingCell({ row: rowIdx, field: col.key })}
                          style={{
                            padding: 8, cursor: 'pointer', minWidth: 100,
                            background: editingCell?.row === rowIdx && editingCell?.field === col.key ? '#EFF6FF' : undefined,
                          }}
                        >
                          {editingCell?.row === rowIdx && editingCell?.field === col.key ? (
                            <input
                              autoFocus
                              defaultValue={String(reg[col.key] || '')}
                              onBlur={e => {
                                updateCell(rowIdx, col.key, e.target.value.trim());
                                setEditingCell(null);
                              }}
                              onKeyDown={e => {
                                if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); }
                                if (e.key === 'Escape') { setEditingCell(null); }
                              }}
                              style={{
                                width: '100%', padding: '4px 8px', border: '1px solid #3B82F6',
                                borderRadius: 4, fontSize: 13, fontFamily: 'inherit',
                              }}
                            />
                          ) : (
                            String(reg[col.key] || '')
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: 12 }}>
              <button
                type="button"
                onClick={async () => {
                  const regs = registrosRef.current;
                  if (regs.length === 0) return;
                  const btn = document.getElementById('btn-importar') as HTMLButtonElement;
                  if (btn) { btn.disabled = true; btn.textContent = 'Importando...'; }
                  try {
                    const res = await fetch('/api/postgres/people/bulk-import', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ registros: regs }),
                    });
                    const data = await res.json();
                    if (data.success) {
                      const msg = `Importación: ${data.exitosos} exitosos, ${data.fallidos} fallidos de ${data.total}` +
                        (data.errores?.length ? '\n\nErrores:\n' + data.errores.join('\n') : '');
                      alert(msg);
                      if (data.exitosos > 0) window.location.reload();
                    } else {
                      alert('Error: ' + data.error);
                    }
                  } catch (err: any) {
                    alert('Error de conexión: ' + err.message);
                  }
                  if (btn) { btn.disabled = false; btn.textContent = `Aprobar e Importar (${regs.length} registros)`; }
                }}
                id="btn-importar"
                disabled={loading || registros.length === 0}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  padding: '12px 24px', borderRadius: 8, fontSize: 14, fontWeight: 500,
                  cursor: loading ? 'not-allowed' : 'pointer', border: 'none',
                  background: loading ? '#9CA3AF' : '#22C55E', color: 'white',
                }}
              >
                {loading ? 'Importando...' : `Aprobar e Importar (${registros.length} registros)`}
              </button>
              <button
                onClick={reset}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  padding: '12px 24px', borderRadius: 8, fontSize: 14, fontWeight: 500,
                  cursor: 'pointer', border: 'none', background: '#F3F4F6', color: '#374151',
                }}
              >
                Cancelar
              </button>
            </div>
          </>
        )}
        </>
        )}
      </div>
      </PermissionGuard>
    </DashboardLayout>
  );
}
