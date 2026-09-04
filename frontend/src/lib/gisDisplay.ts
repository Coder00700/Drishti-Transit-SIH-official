/** Escape external OSM/API strings before inserting them into Leaflet popup HTML. */
export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]!);
}

export function gridColor(health?: string | null, risk?: string | null): string {
  const h = health?.toUpperCase();
  const r = risk?.toUpperCase();
  if (r === "HIGH" || r === "CRITICAL" || h === "POOR") return "#ef4444";
  if (r === "MEDIUM" || h === "FAIR") return "#f59e0b";
  if (r === "LOW" || h === "HEALTHY" || h === "GOOD") return "#10b981";
  return "#94a3b8";
}
