/**
 * /dbmosaico - Database Viewer & Editor
 *
 * Standalone page (outside DashboardLayout) that provides a Wix-like
 * spreadsheet interface for viewing and editing PostgreSQL tables.
 * Restricted to SUPER_ADMIN/ADMIN roles.
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { QueryClient, QueryClientProvider } from 'react-query';
import toast, { Toaster } from 'react-hot-toast';
import {
  useDbmosaicoTables,
  useDbmosaicoSchema,
  useDbmosaicoRows,
  useUpdateCell,
  useInsertRow,
  useDeleteRows,
} from '@/hooks/use-dbmosaico';
import { Role } from '@/types/permissions';

// ── Types ──────────────────────────────────────────────────────────

interface ColumnMeta {
  name: string;
  type: string;
  pgType: string;
  nullable: boolean;
  defaultValue: string | null;
  maxLength: number | null;
  isPrimaryKey: boolean;
}

interface SavedView {
  id: string;
  name: string;
  table: string;
  filters: Record<string, string>;
  search: string;
  sortBy?: string;
  sortDir: 'asc' | 'desc';
}

// ── Saved Views localStorage helpers ──────────────────────────────

const VIEWS_STORAGE_KEY = 'dbmosaico-saved-views';

function loadViews(): SavedView[] {
  try {
    const raw = localStorage.getItem(VIEWS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function persistViews(views: SavedView[]) {
  try { localStorage.setItem(VIEWS_STORAGE_KEY, JSON.stringify(views)); } catch {}
}

// ── Session state persistence (table + active view) ───────────────

const SESSION_KEY = 'dbmosaico-session';

interface DbmosaicoSession {
  table: string | null;
  activeViewId: string | null;
}

function loadSession(): DbmosaicoSession {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : { table: null, activeViewId: null };
  } catch { return { table: null, activeViewId: null }; }
}

function persistSession(session: DbmosaicoSession) {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch {}
}

// ── Helpers ────────────────────────────────────────────────────────

function getTypeBadge(pgType: string): { label: string; className: string } {
  const map: Record<string, { label: string; className: string }> = {
    varchar: { label: 'T', className: 'bg-blue-100 text-blue-700' },
    text: { label: 'T', className: 'bg-blue-100 text-blue-700' },
    bpchar: { label: 'T', className: 'bg-blue-100 text-blue-700' },
    name: { label: 'T', className: 'bg-blue-100 text-blue-700' },
    uuid: { label: 'T', className: 'bg-blue-100 text-blue-700' },
    int2: { label: '#', className: 'bg-purple-100 text-purple-700' },
    int4: { label: '#', className: 'bg-purple-100 text-purple-700' },
    int8: { label: '#', className: 'bg-purple-100 text-purple-700' },
    float4: { label: '#', className: 'bg-purple-100 text-purple-700' },
    float8: { label: '#', className: 'bg-purple-100 text-purple-700' },
    numeric: { label: '#', className: 'bg-purple-100 text-purple-700' },
    bool: { label: 'B', className: 'bg-green-100 text-green-700' },
    timestamp: { label: 'D', className: 'bg-orange-100 text-orange-700' },
    timestamptz: { label: 'D', className: 'bg-orange-100 text-orange-700' },
    date: { label: 'D', className: 'bg-orange-100 text-orange-700' },
    jsonb: { label: '{}', className: 'bg-yellow-100 text-yellow-700' },
    json: { label: '{}', className: 'bg-yellow-100 text-yellow-700' },
  };
  return map[pgType] || { label: '?', className: 'bg-gray-100 text-gray-600' };
}

function formatCellValue(value: any, pgType: string): string {
  if (value === null || value === undefined) return '';
  if (pgType === 'jsonb' || pgType === 'json') {
    if (typeof value === 'object') {
      const str = JSON.stringify(value);
      return str.length > 80 ? str.substring(0, 80) + '...' : str;
    }
    return String(value).substring(0, 80);
  }
  if (['timestamp', 'timestamptz', 'date'].includes(pgType)) {
    try {
      const d = new Date(value);
      if (pgType === 'date') return d.toISOString().split('T')[0];
      return d.toLocaleString('es-CO', { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    } catch { return String(value); }
  }
  if (pgType === 'bool') return value ? 'true' : 'false';
  return String(value);
}

function getEditValue(value: any, pgType: string): string {
  if (value === null || value === undefined) return '';
  if (pgType === 'jsonb' || pgType === 'json') {
    if (typeof value === 'object') return JSON.stringify(value, null, 2);
    try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return String(value); }
  }
  if (['timestamp', 'timestamptz'].includes(pgType)) {
    try { return new Date(value).toISOString(); } catch { return String(value); }
  }
  return String(value);
}

// ── QueryClient for standalone page ────────────────────────────────

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
});

// ── Main page wrapper (provides QueryClient) ──────────────────────

export default function DbmosaicoPageWrapper() {
  return (
    <QueryClientProvider client={queryClient}>
      <Toaster position="top-right" />
      <DbmosaicoPage />
    </QueryClientProvider>
  );
}

// ── DbmosaicoPage Component ────────────────────────────────────────────

function DbmosaicoPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  // ── Auth check ──────────────────────────────────────────────────
  useEffect(() => {
    if (status === 'loading') return;
    if (!session?.user) { router.push('/login'); return; }
    const userRole = (session.user as any).role;
    const allowed = [Role.SUPER_ADMIN, Role.ADMIN, 'admin'];
    if (!allowed.includes(userRole)) {
      toast.error('No tienes permisos para acceder');
      router.push('/');
    }
  }, [session, status, router]);

  // ── State ───────────────────────────────────────────────────────
  const restoredSession = typeof window !== 'undefined' ? loadSession() : { table: null, activeViewId: null };
  const [selectedTable, setSelectedTable] = useState<string | null>(restoredSession.table);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sortBy, setSortBy] = useState<string | undefined>(undefined);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [debouncedFilters, setDebouncedFilters] = useState<Record<string, string>>({});
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [editingCell, setEditingCell] = useState<{ rowId: string; column: string } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [newRowData, setNewRowData] = useState<Record<string, string>>({});
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deletingRowId, setDeletingRowId] = useState<string | null>(null);

  // ── Saved views state ─────────────────────────────────────────
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [renamingViewId, setRenamingViewId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [showViewModal, setShowViewModal] = useState(false);
  const [viewModalName, setViewModalName] = useState('');
  const [viewModalFilters, setViewModalFilters] = useState<Array<{ column: string; value: string }>>([]);
  const [viewModalSearch, setViewModalSearch] = useState('');
  const [viewModalSortBy, setViewModalSortBy] = useState<string>('');
  const [viewModalSortDir, setViewModalSortDir] = useState<'asc' | 'desc'>('asc');
  const [editingViewId, setEditingViewId] = useState<string | null>(null); // null = creating new

  // Load saved views from localStorage on mount + restore active view
  useEffect(() => {
    const views = loadViews();
    setSavedViews(views);
    const session = loadSession();
    if (session.activeViewId && session.table) {
      const view = views.find(v => v.id === session.activeViewId && v.table === session.table);
      if (view) {
        setFilters(view.filters);
        setDebouncedFilters(view.filters);
        setSearch(view.search);
        setDebouncedSearch(view.search);
        if (view.sortBy) setSortBy(view.sortBy);
        if (view.sortDir) setSortDir(view.sortDir);
        setActiveViewId(view.id);
      }
    }
  }, []);

  // Persist session when table or active view changes
  useEffect(() => {
    persistSession({ table: selectedTable, activeViewId });
  }, [selectedTable, activeViewId]);

  // ── Debounce search ─────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [search]);

  // ── Debounce filters ────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedFilters(filters); setPage(1); }, 500);
    return () => clearTimeout(t);
  }, [filters]);

  // ── Data hooks ──────────────────────────────────────────────────
  const { data: tablesData, isLoading: tablesLoading } = useDbmosaicoTables();
  const { data: schemaData } = useDbmosaicoSchema(selectedTable);
  const { data: rowsData, isLoading: rowsLoading, isFetching } = useDbmosaicoRows(selectedTable, {
    page, pageSize, sortBy, sortDir,
    search: debouncedSearch || undefined,
    filters: Object.keys(debouncedFilters).length > 0 ? debouncedFilters : undefined,
  });

  const updateCellMutation = useUpdateCell(selectedTable);
  const insertRowMutation = useInsertRow(selectedTable);
  const deleteRowsMutation = useDeleteRows(selectedTable);

  const tables: string[] = tablesData?.tables || [];
  const columns: ColumnMeta[] = rowsData?.columns || schemaData?.columns || [];
  const rows: any[] = rowsData?.rows || [];
  const total: number = rowsData?.total || 0;
  const totalPages: number = rowsData?.totalPages || 0;

  // ── Table change handler ────────────────────────────────────────
  const handleTableChange = useCallback((tableName: string) => {
    setSelectedTable(tableName || null);
    setPage(1);
    setSortBy(undefined);
    setSortDir('asc');
    setSearch('');
    setDebouncedSearch('');
    setFilters({});
    setDebouncedFilters({});
    setSelectedRows(new Set());
    setEditingCell(null);
    setNewRowData({});
    setActiveViewId(null);
    setRenamingViewId(null);
  }, []);

  // ── Lookup in PEOPLE or ACADEMICA ─────────────────────────────
  const lookupInTable = useCallback((targetTable: string, row: any) => {
    // Priority: numeroId → academicaId (USUARIOS_ROLES) → studentId/idEstudiante (BOOKINGS) → _id
    const lookupId = row.numeroId || row.academicaId || row.studentId || row.idEstudiante || row._id || '';
    if (!lookupId) return;
    setSelectedTable(targetTable);
    setPage(1);
    setSortBy(undefined);
    setSortDir('asc');
    setSearch(String(lookupId));
    setDebouncedSearch(String(lookupId));
    setFilters({});
    setDebouncedFilters({});
    setSelectedRows(new Set());
    setEditingCell(null);
    setNewRowData({});
    setActiveViewId(null);
    setRenamingViewId(null);
  }, []);

  // ── Sort handler ────────────────────────────────────────────────
  const handleSort = useCallback((colName: string) => {
    if (sortBy === colName) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(colName);
      setSortDir('asc');
    }
    setPage(1);
  }, [sortBy]);

  // ── Cell editing ────────────────────────────────────────────────
  const startEdit = useCallback((rowId: string, column: string, value: any, pgType: string) => {
    setEditingCell({ rowId, column });
    setEditValue(getEditValue(value, pgType));
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingCell(null);
    setEditValue('');
  }, []);

  const saveCell = useCallback(() => {
    if (!editingCell) return;
    const val = editValue === '' ? null : editValue;
    updateCellMutation.mutate(
      { rowId: editingCell.rowId, column: editingCell.column, value: val },
      { onSettled: () => { setEditingCell(null); setEditValue(''); } }
    );
  }, [editingCell, editValue, updateCellMutation]);

  // ── Row selection ───────────────────────────────────────────────
  const toggleRow = useCallback((id: string) => {
    setSelectedRows(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleAllRows = useCallback(() => {
    if (selectedRows.size === rows.length) {
      setSelectedRows(new Set());
    } else {
      setSelectedRows(new Set(rows.map(r => r._id)));
    }
  }, [selectedRows.size, rows]);

  // ── Add row ─────────────────────────────────────────────────────
  const handleAddRow = useCallback(() => {
    insertRowMutation.mutate(newRowData, {
      onSuccess: () => { setShowAddModal(false); setNewRowData({}); },
    });
  }, [newRowData, insertRowMutation]);

  // ── Delete rows ─────────────────────────────────────────────────
  const handleDeleteRows = useCallback(() => {
    const ids = Array.from(selectedRows);
    deleteRowsMutation.mutate(ids, {
      onSuccess: () => { setSelectedRows(new Set()); setShowDeleteConfirm(false); },
    });
  }, [selectedRows, deleteRowsMutation]);

  // ── Filter handler ──────────────────────────────────────────────
  const handleFilterChange = useCallback((colName: string, value: string) => {
    setFilters(prev => {
      const next = { ...prev };
      if (value) next[colName] = value; else delete next[colName];
      return next;
    });
  }, []);

  // ── Date range filter (clears null sentinel for that col) ────────
  const handleDateRangeChange = useCallback((colName: string, suffix: '__gte' | '__lte', value: string) => {
    setFilters(prev => {
      const next = { ...prev };
      delete next[colName]; // clear any null filter on this col
      const key = colName + suffix;
      if (value) next[key] = value; else delete next[key];
      return next;
    });
  }, []);

  // ── Null/empty toggle (clears date range for date cols) ──────────
  const toggleNullFilter = useCallback((colName: string) => {
    setFilters(prev => {
      const next = { ...prev };
      const isActive = next[colName] === '__NULL__' || next[colName] === '__EMPTY__';
      if (isActive) {
        delete next[colName];
      } else {
        delete next[colName + '__gte'];
        delete next[colName + '__lte'];
        next[colName] = '__EMPTY__';
      }
      return next;
    });
  }, []);

  // ── Saved views handlers ───────────────────────────────────────
  const tableViews = savedViews.filter(v => v.table === selectedTable);

  const applyView = useCallback((view: SavedView) => {
    setFilters(view.filters);
    setDebouncedFilters(view.filters);
    setSearch(view.search);
    setDebouncedSearch(view.search);
    setSortBy(view.sortBy);
    setSortDir(view.sortDir);
    setActiveViewId(view.id);
    setPage(1);
  }, []);

  const applyDefaultView = useCallback(() => {
    setFilters({});
    setDebouncedFilters({});
    setSearch('');
    setDebouncedSearch('');
    setSortBy(undefined);
    setSortDir('asc');
    setActiveViewId(null);
    setPage(1);
  }, []);

  // Open view modal for creating a new view (pre-fill with current state)
  const openNewViewModal = useCallback(() => {
    if (!selectedTable) return;
    const currentFilterEntries = Object.entries(debouncedFilters).map(([column, value]) => ({ column, value }));
    setViewModalName('');
    setViewModalFilters(currentFilterEntries.length > 0 ? currentFilterEntries : [{ column: '', value: '' }]);
    setViewModalSearch(debouncedSearch);
    setViewModalSortBy(sortBy || '');
    setViewModalSortDir(sortDir);
    setEditingViewId(null);
    setShowViewModal(true);
  }, [selectedTable, debouncedFilters, debouncedSearch, sortBy, sortDir]);

  // Open view modal for editing an existing view
  const openEditViewModal = useCallback((view: SavedView) => {
    const entries = Object.entries(view.filters).map(([column, value]) => ({ column, value }));
    setViewModalName(view.name);
    setViewModalFilters(entries.length > 0 ? entries : [{ column: '', value: '' }]);
    setViewModalSearch(view.search);
    setViewModalSortBy(view.sortBy || '');
    setViewModalSortDir(view.sortDir);
    setEditingViewId(view.id);
    setShowViewModal(true);
  }, []);

  // Save view from modal (create or update)
  const saveViewFromModal = useCallback(() => {
    if (!selectedTable || !viewModalName.trim()) return;
    // Build filters record from the modal rows
    const filtersRecord: Record<string, string> = {};
    viewModalFilters.forEach(f => {
      if (f.column && f.value.trim()) filtersRecord[f.column] = f.value.trim();
    });

    if (editingViewId) {
      // Update existing view
      const updated = savedViews.map(v =>
        v.id === editingViewId ? {
          ...v,
          name: viewModalName.trim(),
          filters: filtersRecord,
          search: viewModalSearch,
          sortBy: viewModalSortBy || undefined,
          sortDir: viewModalSortDir,
        } : v
      );
      setSavedViews(updated);
      persistViews(updated);
      // Re-apply if this is the active view
      if (activeViewId === editingViewId) {
        setFilters(filtersRecord);
        setDebouncedFilters(filtersRecord);
        setSearch(viewModalSearch);
        setDebouncedSearch(viewModalSearch);
        setSortBy(viewModalSortBy || undefined);
        setSortDir(viewModalSortDir);
        setPage(1);
      }
      toast.success('Vista actualizada');
    } else {
      // Create new view
      const newView: SavedView = {
        id: `v_${Date.now()}`,
        name: viewModalName.trim(),
        table: selectedTable,
        filters: filtersRecord,
        search: viewModalSearch,
        sortBy: viewModalSortBy || undefined,
        sortDir: viewModalSortDir,
      };
      const updated = [...savedViews, newView];
      setSavedViews(updated);
      persistViews(updated);
      setActiveViewId(newView.id);
      // Apply the new view's filters immediately
      setFilters(filtersRecord);
      setDebouncedFilters(filtersRecord);
      setSearch(viewModalSearch);
      setDebouncedSearch(viewModalSearch);
      setSortBy(viewModalSortBy || undefined);
      setSortDir(viewModalSortDir);
      setPage(1);
      toast.success(`Vista "${newView.name}" creada`);
    }
    setShowViewModal(false);
  }, [selectedTable, viewModalName, viewModalFilters, viewModalSearch, viewModalSortBy, viewModalSortDir, editingViewId, activeViewId, savedViews]);

  // Add a filter row in the modal
  const addViewModalFilter = useCallback(() => {
    setViewModalFilters(prev => [...prev, { column: '', value: '' }]);
  }, []);

  // Remove a filter row in the modal
  const removeViewModalFilter = useCallback((idx: number) => {
    setViewModalFilters(prev => prev.filter((_, i) => i !== idx));
  }, []);

  // Update a filter row in the modal
  const updateViewModalFilter = useCallback((idx: number, field: 'column' | 'value', val: string) => {
    setViewModalFilters(prev => prev.map((f, i) => i === idx ? { ...f, [field]: val } : f));
  }, []);

  const deleteView = useCallback((viewId: string) => {
    const updated = savedViews.filter(v => v.id !== viewId);
    setSavedViews(updated);
    persistViews(updated);
    if (activeViewId === viewId) setActiveViewId(null);
  }, [savedViews, activeViewId]);

  const startRenameView = useCallback((viewId: string, currentName: string) => {
    setRenamingViewId(viewId);
    setRenameValue(currentName);
  }, []);

  const finishRenameView = useCallback(() => {
    if (!renamingViewId || !renameValue.trim()) { setRenamingViewId(null); return; }
    const updated = savedViews.map(v =>
      v.id === renamingViewId ? { ...v, name: renameValue.trim() } : v
    );
    setSavedViews(updated);
    persistViews(updated);
    setRenamingViewId(null);
  }, [renamingViewId, renameValue, savedViews]);

  // ── Export CSV ─────────────────────────────────────────────────
  const handleExportCSV = useCallback(async () => {
    if (!selectedTable || columns.length === 0) return;
    setExporting(true);
    try {
      // Fetch ALL filtered rows (no pagination limit)
      const params = new URLSearchParams();
      params.set('page', '1');
      params.set('pageSize', '50000');
      params.set('export', 'true');
      if (sortBy) params.set('sortBy', sortBy);
      if (sortDir) params.set('sortDir', sortDir);
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (Object.keys(debouncedFilters).length > 0) params.set('filters', JSON.stringify(debouncedFilters));

      const res = await fetch(`/api/postgres/dbmosaico/${encodeURIComponent(selectedTable)}?${params.toString()}`);
      if (!res.ok) throw new Error('Error al exportar');
      const data = await res.json();
      const exportRows: any[] = data.rows || [];

      if (exportRows.length === 0) {
        toast.error('No hay datos para exportar');
        return;
      }

      // Build CSV with BOM for Excel UTF-8 compatibility
      const colNames = columns.map(c => c.name);
      const escapeCSV = (val: any): string => {
        if (val === null || val === undefined) return '';
        const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
        if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };

      const header = colNames.map(escapeCSV).join(',');
      const lines = exportRows.map(row =>
        colNames.map(col => escapeCSV(row[col])).join(',')
      );

      const bom = '\uFEFF';
      const csv = bom + [header, ...lines].join('\r\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${selectedTable}_${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);

      toast.success(`${exportRows.length} filas exportadas`);
    } catch (err: any) {
      toast.error(err.message || 'Error al exportar');
    } finally {
      setExporting(false);
    }
  }, [selectedTable, columns, sortBy, sortDir, debouncedSearch, debouncedFilters]);

  // ── Loading state ───────────────────────────────────────────────
  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-500">Cargando...</div>
      </div>
    );
  }

  // Count __gte/__lte pairs for the same column as a single filter
  const uniqueFilterCols = new Set(
    Object.keys(debouncedFilters).map(k => k.replace(/__gte$|__lte$/, ''))
  );
  const activeFiltersCount = uniqueFilterCols.size + (debouncedSearch ? 1 : 0) + (sortBy ? 1 : 0);

  // ── Render ──────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-lg font-semibold text-gray-900">Base de Datos MOSAICO</h1>
            <select
              value={selectedTable || ''}
              onChange={e => handleTableChange(e.target.value)}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">Seleccionar tabla...</option>
              {tables.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            {tablesLoading && <span className="text-xs text-gray-400">Cargando tablas...</span>}
          </div>
          <a
            href="/"
            className="text-sm text-blue-600 hover:text-blue-800 hover:underline"
          >
            Volver al Dashboard
          </a>
        </div>
      </div>

      {/* ── Views Tab Bar ──────────────────────────────────────── */}
      {selectedTable && (
        <div className="bg-white border-b border-gray-200 px-4 py-1.5">
          <div className="flex items-center gap-1 overflow-x-auto">
            {/* Default "Tabla" tab */}
            <button
              onClick={applyDefaultView}
              className={`px-3 py-1 text-sm rounded-md whitespace-nowrap transition-colors ${
                activeViewId === null
                  ? 'bg-blue-100 text-blue-800 font-medium'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              Tabla
              <span className="ml-1.5 text-xs text-gray-400">{total.toLocaleString()}</span>
            </button>

            {/* Divider */}
            {tableViews.length > 0 && (
              <div className="w-px h-5 bg-gray-200 mx-1" />
            )}

            {/* Saved view tabs */}
            {tableViews.map(view => {
              const isActive = activeViewId === view.id;
              const filterCount = Object.keys(view.filters).length + (view.search ? 1 : 0) + (view.sortBy ? 1 : 0);
              const isRenaming = renamingViewId === view.id;

              return (
                <div
                  key={view.id}
                  className={`group flex items-center gap-1 px-3 py-1 rounded-md whitespace-nowrap transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-blue-100 text-blue-800'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                  onClick={() => !isRenaming && applyView(view)}
                >
                  {isRenaming ? (
                    <input
                      autoFocus
                      type="text"
                      value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onBlur={finishRenameView}
                      onKeyDown={e => {
                        if (e.key === 'Enter') finishRenameView();
                        if (e.key === 'Escape') setRenamingViewId(null);
                      }}
                      onClick={e => e.stopPropagation()}
                      className="px-1 py-0 text-sm border border-blue-400 rounded w-28 focus:ring-1 focus:ring-blue-500 bg-white"
                    />
                  ) : (
                    <span
                      className="text-sm font-medium"
                      onDoubleClick={e => { e.stopPropagation(); startRenameView(view.id, view.name); }}
                    >
                      {view.name}
                    </span>
                  )}

                  {filterCount > 0 && !isRenaming && (
                    <span className="text-[10px] text-gray-400">{filterCount} filtro{filterCount !== 1 ? 's' : ''}</span>
                  )}

                  {/* Edit view button */}
                  {!isRenaming && (
                    <button
                      onClick={e => { e.stopPropagation(); openEditViewModal(view); }}
                      className="opacity-0 group-hover:opacity-100 text-blue-500 hover:text-blue-700 transition-opacity"
                      title="Editar filtros de esta vista"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                  )}

                  {/* Delete button */}
                  {!isRenaming && (
                    <button
                      onClick={e => { e.stopPropagation(); deleteView(view.id); }}
                      className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-opacity"
                      title="Eliminar vista"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              );
            })}

            {/* + Nueva vista */}
            <button
              onClick={openNewViewModal}
              className="px-2.5 py-1 text-sm text-blue-600 hover:bg-blue-50 rounded-md whitespace-nowrap flex items-center gap-1 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Nueva vista
            </button>
          </div>
        </div>
      )}

      {!selectedTable ? (
        <div className="flex items-center justify-center h-[60vh]">
          <div className="text-center">
            <div className="text-6xl mb-4">🗄️</div>
            <p className="text-gray-500 text-lg">Selecciona una tabla para comenzar</p>
            <p className="text-gray-400 text-sm mt-1">{tables.length} tablas disponibles</p>
          </div>
        </div>
      ) : (
        <>
          {/* ── Toolbar ──────────────────────────────────────── */}
          <div className="bg-white border-b border-gray-200 px-4 py-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {/* Search */}
                <div className="relative">
                  <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <input
                    type="text"
                    placeholder="Buscar..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="pl-8 pr-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-64"
                  />
                </div>

                {/* Add Row */}
                <button
                  onClick={() => { setNewRowData({}); setShowAddModal(true); }}
                  className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-1"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Agregar
                </button>

                {/* Export CSV */}
                <button
                  onClick={handleExportCSV}
                  disabled={exporting || rows.length === 0}
                  className="px-3 py-1.5 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  {exporting ? 'Exportando...' : 'Exportar CSV'}
                </button>

                {/* Delete */}
                {selectedRows.size > 0 && (
                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    className="px-3 py-1.5 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 flex items-center gap-1"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    Eliminar ({selectedRows.size})
                  </button>
                )}

                {activeFiltersCount > 0 && (
                  <button
                    onClick={applyDefaultView}
                    className="px-3 py-1.5 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
                  >
                    Limpiar filtros ({activeFiltersCount})
                  </button>
                )}
              </div>

              <div className="flex items-center gap-3">
                {/* Page size */}
                <select
                  value={pageSize}
                  onChange={e => { setPageSize(parseInt(e.target.value)); setPage(1); }}
                  className="px-2 py-1.5 text-sm border border-gray-300 rounded-lg bg-white"
                >
                  {[20, 50, 100, 200].map(n => (
                    <option key={n} value={n}>{n} filas</option>
                  ))}
                </select>

                {/* Row count */}
                <span className="text-sm text-gray-500">
                  {total.toLocaleString()} registros
                </span>

                {isFetching && (
                  <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                )}
              </div>
            </div>
          </div>

          {/* ── Table ────────────────────────────────────────── */}
          <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 160px)' }}>
            <table className="min-w-full text-sm">
              {/* Column headers */}
              <thead className="bg-gray-50 sticky top-0 z-10">
                <tr className="border-b border-gray-200">
                  {/* Checkbox header */}
                  <th className="px-2 py-2 w-10 bg-gray-50 sticky left-0 z-20 border-r border-gray-200">
                    <input
                      type="checkbox"
                      checked={rows.length > 0 && selectedRows.size === rows.length}
                      onChange={toggleAllRows}
                      className="rounded border-gray-300"
                    />
                  </th>
                  {/* Row number */}
                  <th className="px-2 py-2 w-12 text-left text-xs font-medium text-gray-400 bg-gray-50 sticky left-10 z-20 border-r border-gray-200">#</th>
                  {/* Lookup buttons header */}
                  <th className="px-1 py-2 w-16 text-center text-xs font-medium text-gray-400 bg-gray-50 border-r border-gray-200">Lookup</th>
                  {columns.map(col => {
                    const badge = getTypeBadge(col.pgType);
                    const isSorted = sortBy === col.name;
                    return (
                      <th
                        key={col.name}
                        className="px-3 py-2 text-left text-xs font-medium text-gray-600 cursor-pointer hover:bg-gray-100 select-none whitespace-nowrap border-r border-gray-100"
                        onClick={() => handleSort(col.name)}
                      >
                        <div className="flex items-center gap-1.5">
                          <span className={`inline-flex items-center justify-center w-5 h-4 text-[10px] font-bold rounded ${badge.className}`}>
                            {badge.label}
                          </span>
                          <span className="truncate max-w-[200px]">{col.name}</span>
                          {isSorted && (
                            <span className="text-blue-600">
                              {sortDir === 'asc' ? '▲' : '▼'}
                            </span>
                          )}
                        </div>
                      </th>
                    );
                  })}
                  {/* Actions column header */}
                  <th className="px-2 py-2 w-16 text-left text-xs font-medium text-gray-400 bg-gray-50" />
                </tr>
                {/* Filter row */}
                <tr className="border-b border-gray-300 bg-gray-50">
                  <td className="px-2 py-1 sticky left-0 z-20 bg-gray-50 border-r border-gray-200" />
                  <td className="px-2 py-1 sticky left-10 z-20 bg-gray-50 border-r border-gray-200" />
                  <td className="px-1 py-1 bg-gray-50 border-r border-gray-200" />
                  {columns.map(col => {
                    const isDateCol = ['timestamp', 'timestamptz', 'date'].includes(col.pgType);
                    const isNullActive = filters[col.name] === '__NULL__' || filters[col.name] === '__EMPTY__';
                    const gteVal = filters[col.name + '__gte'] || '';
                    const lteVal = filters[col.name + '__lte'] || '';
                    return (
                      <td key={col.name} className="px-1 py-1 border-r border-gray-100">
                        {isDateCol ? (
                          <div className="flex flex-col gap-0.5 min-w-[112px]">
                            <input
                              type="date"
                              title="Desde (≥)"
                              value={gteVal}
                              onChange={e => handleDateRangeChange(col.name, '__gte', e.target.value)}
                              className="w-full px-1 py-0.5 text-xs border border-gray-200 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white"
                            />
                            <input
                              type="date"
                              title="Hasta (≤)"
                              value={lteVal}
                              onChange={e => handleDateRangeChange(col.name, '__lte', e.target.value)}
                              className="w-full px-1 py-0.5 text-xs border border-gray-200 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white"
                            />
                            <button
                              type="button"
                              onClick={() => toggleNullFilter(col.name)}
                              title={isNullActive ? 'Quitar filtro nulo' : 'Mostrar solo registros nulos'}
                              className={`px-1 py-0.5 text-[10px] rounded border transition-colors ${isNullActive ? 'bg-amber-100 border-amber-400 text-amber-700 font-medium' : 'border-gray-200 text-gray-400 hover:border-gray-400 hover:text-gray-600'}`}
                            >
                              ∅ nulo
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-0.5">
                            <input
                              type="text"
                              placeholder="Filtrar..."
                              value={isNullActive ? '' : (filters[col.name] || '')}
                              disabled={isNullActive}
                              onChange={e => handleFilterChange(col.name, e.target.value)}
                              className={`w-full px-1.5 py-0.5 text-xs border rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 ${isNullActive ? 'bg-gray-100 border-gray-200 text-gray-400' : 'bg-white border-gray-200'}`}
                            />
                            <button
                              type="button"
                              onClick={() => toggleNullFilter(col.name)}
                              title={isNullActive ? 'Quitar filtro nulo' : 'Mostrar solo registros nulos/vacíos'}
                              className={`shrink-0 px-1.5 py-0.5 text-[11px] font-medium rounded border transition-colors ${isNullActive ? 'bg-amber-100 border-amber-400 text-amber-700' : 'border-gray-200 text-gray-400 hover:border-gray-400 hover:text-gray-600'}`}
                            >
                              ∅
                            </button>
                          </div>
                        )}
                      </td>
                    );
                  })}
                  {/* Actions filter spacer */}
                  <td className="px-2 py-1" />
                </tr>
              </thead>

              {/* Data rows */}
              <tbody className="bg-white">
                {rowsLoading && rows.length === 0 ? (
                  <tr>
                    <td colSpan={columns.length + 4} className="px-4 py-12 text-center text-gray-400">
                      Cargando datos...
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={columns.length + 4} className="px-4 py-12 text-center text-gray-400">
                      No se encontraron registros
                    </td>
                  </tr>
                ) : (
                  rows.map((row, rowIdx) => {
                    const rowId = row._id;
                    const isSelected = selectedRows.has(rowId);
                    return (
                      <tr
                        key={rowId || rowIdx}
                        className={`border-b border-gray-100 hover:bg-blue-50/30 ${isSelected ? 'bg-blue-50' : ''}`}
                      >
                        {/* Checkbox */}
                        <td className="px-2 py-1 sticky left-0 z-10 bg-white border-r border-gray-200">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleRow(rowId)}
                            className="rounded border-gray-300"
                          />
                        </td>
                        {/* Row number */}
                        <td className="px-2 py-1 text-xs text-gray-400 sticky left-10 z-10 bg-white border-r border-gray-200">
                          {(page - 1) * pageSize + rowIdx + 1}
                        </td>
                        {/* Lookup buttons */}
                        <td className="px-1 py-1 border-r border-gray-200">
                          <div className="flex gap-0.5 justify-center">
                            <button
                              onClick={() => lookupInTable('PEOPLE', row)}
                              className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-indigo-100 text-indigo-700 hover:bg-indigo-200 transition-colors"
                              title="Buscar en PEOPLE"
                            >
                              P
                            </button>
                            <button
                              onClick={() => lookupInTable('ACADEMICA', row)}
                              className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-emerald-100 text-emerald-700 hover:bg-emerald-200 transition-colors"
                              title="Buscar en ACADEMICA"
                            >
                              A
                            </button>
                          </div>
                        </td>
                        {/* Data cells */}
                        {columns.map(col => {
                          const cellValue = row[col.name];
                          const isEditing = editingCell?.rowId === rowId && editingCell?.column === col.name;
                          const isJsonb = col.pgType === 'jsonb' || col.pgType === 'json';

                          if (isEditing) {
                            if (col.pgType === 'bool') {
                              return (
                                <td key={col.name} className="px-2 py-1 border-r border-gray-100">
                                  <select
                                    autoFocus
                                    value={editValue}
                                    onChange={e => setEditValue(e.target.value)}
                                    onBlur={saveCell}
                                    onKeyDown={e => { if (e.key === 'Escape') cancelEdit(); }}
                                    className="px-1 py-0.5 text-xs border border-blue-500 rounded focus:ring-1 focus:ring-blue-500"
                                  >
                                    <option value="">null</option>
                                    <option value="true">true</option>
                                    <option value="false">false</option>
                                  </select>
                                </td>
                              );
                            }

                            if (isJsonb || (typeof cellValue === 'string' && cellValue.length > 100)) {
                              return (
                                <td key={col.name} className="px-1 py-1 border-r border-gray-100">
                                  <textarea
                                    autoFocus
                                    value={editValue}
                                    onChange={e => setEditValue(e.target.value)}
                                    onBlur={saveCell}
                                    onKeyDown={e => {
                                      if (e.key === 'Escape') cancelEdit();
                                      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) saveCell();
                                    }}
                                    className="w-full min-w-[200px] min-h-[80px] p-1 text-xs border border-blue-500 rounded font-mono focus:ring-1 focus:ring-blue-500 resize"
                                  />
                                </td>
                              );
                            }

                            return (
                              <td key={col.name} className="px-1 py-1 border-r border-gray-100">
                                <input
                                  autoFocus
                                  type="text"
                                  value={editValue}
                                  onChange={e => setEditValue(e.target.value)}
                                  onBlur={saveCell}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') saveCell();
                                    if (e.key === 'Escape') cancelEdit();
                                  }}
                                  className="w-full min-w-[100px] px-1 py-0.5 text-xs border border-blue-500 rounded focus:ring-1 focus:ring-blue-500"
                                />
                              </td>
                            );
                          }

                          // Display mode
                          const displayVal = formatCellValue(cellValue, col.pgType);
                          const isBool = col.pgType === 'bool';

                          return (
                            <td
                              key={col.name}
                              className="px-2 py-1 border-r border-gray-100 cursor-pointer hover:bg-blue-50 whitespace-nowrap"
                              onClick={() => startEdit(rowId, col.name, cellValue, col.pgType)}
                              title={cellValue != null ? String(typeof cellValue === 'object' ? JSON.stringify(cellValue) : cellValue) : 'null'}
                            >
                              {cellValue === null || cellValue === undefined ? (
                                <span className="text-gray-300 italic text-xs">null</span>
                              ) : isBool ? (
                                <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${cellValue ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                  {displayVal}
                                </span>
                              ) : (
                                <span className="text-xs truncate block max-w-[300px]">{displayVal}</span>
                              )}
                            </td>
                          );
                        })}
                        {/* Actions cell */}
                        <td className="px-2 py-1 text-center">
                          {deletingRowId === rowId ? (
                            <span className="flex items-center gap-1 justify-center">
                              <button
                                onClick={() => {
                                  deleteRowsMutation.mutate([rowId], {
                                    onSuccess: () => setDeletingRowId(null),
                                    onError: () => setDeletingRowId(null),
                                  });
                                }}
                                disabled={deleteRowsMutation.isLoading}
                                className="text-red-600 hover:text-red-800 disabled:opacity-40"
                                title="Confirmar"
                              >
                                ✓
                              </button>
                              <button
                                onClick={() => setDeletingRowId(null)}
                                className="text-gray-500 hover:text-gray-700"
                                title="Cancelar"
                              >
                                ✗
                              </button>
                            </span>
                          ) : (
                            <button
                              onClick={() => setDeletingRowId(rowId)}
                              className="text-gray-300 hover:text-red-500 transition-colors"
                              title="Eliminar fila"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* ── Pagination ──────────────────────────────────── */}
          {totalPages > 0 && (
            <div className="bg-white border-t border-gray-200 px-4 py-2 flex items-center justify-between sticky bottom-0">
              <span className="text-sm text-gray-600">
                {((page - 1) * pageSize) + 1}–{Math.min(page * pageSize, total)} de {total.toLocaleString()}
              </span>
              <div className="flex items-center gap-2">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage(1)}
                  className="px-2 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  ««
                </button>
                <button
                  disabled={page <= 1}
                  onClick={() => setPage(p => p - 1)}
                  className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Anterior
                </button>
                <span className="text-sm text-gray-600 px-2">
                  Pág. {page} de {totalPages}
                </span>
                <button
                  disabled={page >= totalPages}
                  onClick={() => setPage(p => p + 1)}
                  className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Siguiente
                </button>
                <button
                  disabled={page >= totalPages}
                  onClick={() => setPage(totalPages)}
                  className="px-2 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  »»
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Add Row Modal ────────────────────────────────────── */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">
                Agregar fila a {selectedTable}
              </h2>
              <button onClick={() => setShowAddModal(false)} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-6 py-4 overflow-y-auto flex-1 space-y-3">
              {columns
                .filter(c => c.name !== '_createdDate' && c.name !== '_updatedDate')
                .map(col => {
                  const badge = getTypeBadge(col.pgType);
                  const isJsonb = col.pgType === 'jsonb' || col.pgType === 'json';
                  return (
                    <div key={col.name}>
                      <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1">
                        <span className={`inline-flex items-center justify-center w-5 h-4 text-[10px] font-bold rounded ${badge.className}`}>
                          {badge.label}
                        </span>
                        {col.name}
                        {col.isPrimaryKey && <span className="text-yellow-600 text-xs">(PK)</span>}
                        {!col.nullable && <span className="text-red-500 text-xs">*</span>}
                      </label>
                      {col.pgType === 'bool' ? (
                        <select
                          value={newRowData[col.name] || ''}
                          onChange={e => setNewRowData(prev => ({ ...prev, [col.name]: e.target.value }))}
                          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg"
                        >
                          <option value="">null</option>
                          <option value="true">true</option>
                          <option value="false">false</option>
                        </select>
                      ) : isJsonb ? (
                        <textarea
                          value={newRowData[col.name] || ''}
                          onChange={e => setNewRowData(prev => ({ ...prev, [col.name]: e.target.value }))}
                          placeholder='{"key": "value"}'
                          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg font-mono min-h-[60px] resize-y"
                        />
                      ) : (
                        <input
                          type="text"
                          value={newRowData[col.name] || ''}
                          onChange={e => setNewRowData(prev => ({ ...prev, [col.name]: e.target.value }))}
                          placeholder={col.defaultValue ? `Default: ${col.defaultValue}` : col.nullable ? 'null' : 'Requerido'}
                          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg"
                        />
                      )}
                    </div>
                  );
                })}
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-2">
              <button
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleAddRow}
                disabled={insertRowMutation.isLoading}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {insertRowMutation.isLoading ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Confirm Modal ─────────────────────────────── */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Confirmar eliminación</h2>
            <p className="text-sm text-gray-600 mb-4">
              ¿Estás seguro de eliminar <strong>{selectedRows.size}</strong> fila(s) de <strong>{selectedTable}</strong>?
              Esta acción no se puede deshacer.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleDeleteRows}
                disabled={deleteRowsMutation.isLoading}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {deleteRowsMutation.isLoading ? 'Eliminando...' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── View Modal (Create / Edit) ─────────────────────────── */}
      {showViewModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">
                {editingViewId ? 'Editar vista' : 'Nueva vista'}
              </h2>
              <button onClick={() => setShowViewModal(false)} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Body */}
            <div className="px-6 py-4 overflow-y-auto flex-1 space-y-4">
              {/* View name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nombre de la vista</label>
                <input
                  autoFocus
                  type="text"
                  value={viewModalName}
                  onChange={e => setViewModalName(e.target.value)}
                  placeholder="Ej: Contratos recientes"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              {/* Filters */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-gray-700">Filtros</label>
                  <button
                    onClick={addViewModalFilter}
                    className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-0.5"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Agregar filtro
                  </button>
                </div>
                <div className="space-y-2">
                  {viewModalFilters.map((f, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <select
                        value={f.column}
                        onChange={e => updateViewModalFilter(idx, 'column', e.target.value)}
                        className="flex-1 px-2 py-1.5 text-sm border border-gray-300 rounded-lg bg-white focus:ring-1 focus:ring-blue-500"
                      >
                        <option value="">Columna...</option>
                        {columns.map(col => (
                          <option key={col.name} value={col.name}>{col.name}</option>
                        ))}
                      </select>
                      <span className="text-xs text-gray-400">contiene</span>
                      <input
                        type="text"
                        value={f.value}
                        onChange={e => updateViewModalFilter(idx, 'value', e.target.value)}
                        placeholder="Valor..."
                        className="flex-1 px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-1 focus:ring-blue-500"
                      />
                      <button
                        onClick={() => removeViewModalFilter(idx)}
                        className="text-gray-400 hover:text-red-500 p-1"
                        title="Quitar filtro"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                  {viewModalFilters.length === 0 && (
                    <p className="text-xs text-gray-400 italic py-1">Sin filtros. Haz clic en "Agregar filtro" para agregar uno.</p>
                  )}
                </div>
              </div>

              {/* Global search */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Búsqueda global</label>
                <input
                  type="text"
                  value={viewModalSearch}
                  onChange={e => setViewModalSearch(e.target.value)}
                  placeholder="Buscar en todos los campos de texto..."
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              {/* Sort */}
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Ordenar por</label>
                  <select
                    value={viewModalSortBy}
                    onChange={e => setViewModalSortBy(e.target.value)}
                    className="w-full px-2 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="">Sin ordenar</option>
                    {columns.map(col => (
                      <option key={col.name} value={col.name}>{col.name}</option>
                    ))}
                  </select>
                </div>
                <div className="w-32">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Dirección</label>
                  <select
                    value={viewModalSortDir}
                    onChange={e => setViewModalSortDir(e.target.value as 'asc' | 'desc')}
                    className="w-full px-2 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="asc">Ascendente</option>
                    <option value="desc">Descendente</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-2">
              <button
                onClick={() => setShowViewModal(false)}
                className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={saveViewFromModal}
                disabled={!viewModalName.trim()}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {editingViewId ? 'Guardar cambios' : 'Crear vista'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
