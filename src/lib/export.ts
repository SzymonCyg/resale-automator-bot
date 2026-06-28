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
  last_bumped_at: string | null;
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
    "Wystawiony": it.created_at_vinted ?? "",
    "Ostatni bump": it.last_bumped_at ?? "",
    URL: it.url ?? "",
    Opis: it.description ?? "",
  }));
}

export function exportToExcel(items: ExportItem[], filename = "vinted-items.xlsx") {
  const rows = toRows(items);
  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [
    { wch: 12 }, { wch: 40 }, { wch: 18 }, { wch: 10 }, { wch: 8 },
    { wch: 6 }, { wch: 10 }, { wch: 8 }, { wch: 8 }, { wch: 20 },
    { wch: 20 }, { wch: 50 }, { wch: 60 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Przedmioty");
  XLSX.writeFile(wb, filename);
}

export function exportToCSV(items: ExportItem[], filename = "vinted-items.csv") {
  const rows = toRows(items);
  const ws = XLSX.utils.json_to_sheet(rows);
  const csv = XLSX.utils.sheet_to_csv(ws, { FS: ";" });
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
