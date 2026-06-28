import * as XLSX from "xlsx";

export type ExportItem = {
  vinted_item_id: string;
  title: string | null;
  description: string | null;
  price: number | null;
  currency: string | null;
  brand: string | null;
  size_title: string | null;
  status: string | null;
  url: string | null;
  views: number | null;
  favourite_count: number | null;
  created_at_vinted: string | null;
};

function toRows(items: ExportItem[]) {
  return items.map((it) => ({
    ID: it.vinted_item_id,
    Tytuł: it.title ?? "",
    Marka: it.brand ?? "",
    Rozmiar: it.size_title ?? "",
    Cena: it.price ?? "",
    Waluta: it.currency ?? "",
    Status: it.status ?? "",
    Wyświetlenia: it.views ?? 0,
    Polubienia: it.favourite_count ?? 0,
    Wystawiony: it.created_at_vinted ?? "",
    URL: it.url ?? "",
    Opis: it.description ?? "",
  }));
}

function triggerDownload(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function exportToExcel(items: ExportItem[], filename = "vinted-items.xlsx") {
  const ws = XLSX.utils.json_to_sheet(toRows(items));
  ws["!cols"] = [
    { wch: 12 }, { wch: 40 }, { wch: 18 }, { wch: 10 }, { wch: 8 },
    { wch: 6 }, { wch: 10 }, { wch: 8 }, { wch: 8 }, { wch: 20 },
    { wch: 50 }, { wch: 60 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Przedmioty");
  XLSX.writeFile(wb, filename);
}

export function exportToCSV(items: ExportItem[], filename = "vinted-items.csv") {
  const ws = XLSX.utils.json_to_sheet(toRows(items));
  const csv = XLSX.utils.sheet_to_csv(ws, { FS: ";" });
  triggerDownload(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }), filename);
}

function escapeXml(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function exportToXML(items: ExportItem[], filename = "vinted-items.xml") {
  const body = items
    .map(
      (it) => `  <item>
    <id>${escapeXml(it.vinted_item_id)}</id>
    <title>${escapeXml(it.title)}</title>
    <brand>${escapeXml(it.brand)}</brand>
    <size>${escapeXml(it.size_title)}</size>
    <price currency="${escapeXml(it.currency)}">${escapeXml(it.price)}</price>
    <status>${escapeXml(it.status)}</status>
    <views>${escapeXml(it.views ?? 0)}</views>
    <favourites>${escapeXml(it.favourite_count ?? 0)}</favourites>
    <created_at>${escapeXml(it.created_at_vinted)}</created_at>
    <url>${escapeXml(it.url)}</url>
    <description>${escapeXml(it.description)}</description>
  </item>`,
    )
    .join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<items>\n${body}\n</items>\n`;
  triggerDownload(new Blob([xml], { type: "application/xml;charset=utf-8" }), filename);
}
