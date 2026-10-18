/**
 * Client-side Excel/CSV export utility.
 *
 * Generates a CSV with UTF-8 BOM so Excel opens it correctly
 * (proper encoding for Spanish characters like ñ, á, é, etc.)
 */

interface ExcelColumn<T> {
  header: string;
  accessor: (row: T) => string | number | boolean | null | undefined;
}

/**
 * Export data to Excel-compatible CSV and trigger download.
 *
 * @param data - Array of objects to export
 * @param columns - Column definitions with headers and accessors
 * @param filename - Filename without extension (date will NOT be appended)
 * @param opts.separator - ',' por defecto; ';' para el Excel en español, que usa
 *   la coma como separador decimal y abre el ';' en columnas sin preguntar.
 */
export function exportToExcel<T>(
  data: T[],
  columns: ExcelColumn<T>[],
  filename: string,
  opts: { separator?: ',' | ';' } = {}
) {
  if (data.length === 0) return;

  const separator = opts.separator ?? ',';
  const BOM = '\uFEFF'; // UTF-8 BOM for Excel

  // Header row
  const headerRow = columns.map((col) => escapeCSV(col.header, separator)).join(separator);

  // Data rows
  const dataRows = data.map((row) =>
    columns
      .map((col) => {
        const value = col.accessor(row);
        if (value === null || value === undefined) return '';
        return escapeCSV(String(value), separator);
      })
      .join(separator)
  );

  const csvContent = BOM + [headerRow, ...dataRows].join('\n');

  // Trigger download
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function escapeCSV(value: string, separator: string = ','): string {
  if (value.includes(separator) || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
