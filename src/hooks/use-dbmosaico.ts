/**
 * DBMOSAICO Hooks - React Query v3 data fetching for database viewer
 *
 * Provides hooks for listing tables, reading schema, CRUD operations.
 * Uses the api utility from use-api.ts and react-hot-toast for notifications.
 */

'use client';

import { useQuery, useMutation, useQueryClient } from 'react-query';
import { api, handleApiError } from './use-api';
import toast from 'react-hot-toast';

// ── Query keys ─────────────────────────────────────────────────────

const keys = {
  tables: ['dbmosaico', 'tables'] as const,
  schema: (table: string) => ['dbmosaico', 'schema', table] as const,
  rows: (table: string, params: string) => ['dbmosaico', 'rows', table, params] as const,
};

// ── Queries ────────────────────────────────────────────────────────

export function useDbmosaicoTables() {
  return useQuery(keys.tables, () =>
    api.get<{ success: boolean; tables: string[] }>('/api/postgres/dbmosaico?action=list-tables')
  );
}

export function useDbmosaicoSchema(table: string | null) {
  return useQuery(
    keys.schema(table!),
    () => api.get(`/api/postgres/dbmosaico?action=schema&table=${encodeURIComponent(table!)}`),
    { enabled: !!table }
  );
}

export function useDbmosaicoRows(table: string | null, params: Record<string, any>) {
  const searchParams = new URLSearchParams(
    Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== '' && v !== null)
      .map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)])
  ).toString();

  return useQuery(
    keys.rows(table!, searchParams),
    () => api.get(`/api/postgres/dbmosaico/${encodeURIComponent(table!)}?${searchParams}`),
    {
      enabled: !!table,
      keepPreviousData: true,
    }
  );
}

// ── Mutations ──────────────────────────────────────────────────────

export function useUpdateCell(table: string | null) {
  const qc = useQueryClient();
  return useMutation(
    (payload: { rowId: string; column: string; value: any }) =>
      api.patch(`/api/postgres/dbmosaico/${encodeURIComponent(table!)}`, payload),
    {
      onSuccess: () => {
        qc.invalidateQueries(['dbmosaico', 'rows', table]);
        toast.success('Celda actualizada');
      },
      onError: (err) => handleApiError(err, 'Error actualizando celda'),
    }
  );
}

export function useInsertRow(table: string | null) {
  const qc = useQueryClient();
  return useMutation(
    (row: Record<string, any>) =>
      api.post(`/api/postgres/dbmosaico/${encodeURIComponent(table!)}`, { row }),
    {
      onSuccess: () => {
        qc.invalidateQueries(['dbmosaico', 'rows', table]);
        qc.invalidateQueries(keys.schema(table!)); // rowCount changed
        toast.success('Fila creada exitosamente');
      },
      onError: (err) => handleApiError(err, 'Error creando fila'),
    }
  );
}

export function useDeleteRows(table: string | null) {
  const qc = useQueryClient();
  return useMutation(
    (ids: string[]) =>
      api.delete(`/api/postgres/dbmosaico/${encodeURIComponent(table!)}`, { ids }),
    {
      onSuccess: (data: any) => {
        qc.invalidateQueries(['dbmosaico', 'rows', table]);
        qc.invalidateQueries(keys.schema(table!)); // rowCount changed
        toast.success(`${data.deletedCount} fila(s) eliminada(s)`);
      },
      onError: (err) => handleApiError(err, 'Error eliminando filas'),
    }
  );
}
