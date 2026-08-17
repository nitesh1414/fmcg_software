// CSV / Excel export helpers (no external deps; Excel opens CSV natively)
export function toCSV(rows, columns) {
  // columns: [{ key, label }]
  const header = columns.map((c) => esc(c.label)).join(',');
  const body = rows
    .map((r) => columns.map((c) => esc(format(r[c.key]))).join(','))
    .join('\n');
  return header + '\n' + body;
}

function format(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v);
  return String(v);
}
function esc(s) {
  s = String(s);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

export function downloadCSV(filename, rows, columns) {
  const csv = toCSV(rows, columns);
  // Prepend BOM so Excel reads UTF-8 correctly
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : filename + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
