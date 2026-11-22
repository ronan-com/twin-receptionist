type Cell = string | number | boolean | null | undefined;

function escapeCell(v: Cell): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "string" ? v : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv<T extends Record<string, Cell>>(rows: T[], headers?: (keyof T & string)[]): string {
  if (rows.length === 0) return "";
  const cols = headers ?? (Object.keys(rows[0]!) as (keyof T & string)[]);
  const lines = [cols.join(","), ...rows.map((r) => cols.map((c) => escapeCell(r[c])).join(","))];
  return lines.join("\r\n");
}

export function downloadCsv<T extends Record<string, Cell>>(filename: string, rows: T[], headers?: (keyof T & string)[]) {
  if (typeof window === "undefined") return;
  const csv = toCsv(rows, headers);
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
