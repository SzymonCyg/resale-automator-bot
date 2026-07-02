import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getAccount, listItems } from "@/lib/vinted.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FileCode2, FileDown, FileSpreadsheet, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { exportToCSV, exportToExcel, exportToXML } from "@/lib/export";
import { AccountHeader } from "@/components/account-header";
import { vintedProxy } from "@/lib/vintedProxy";

export const Route = createFileRoute("/_authenticated/accounts/$accountId/items")({
  head: () => ({ meta: [{ title: "Przedmioty — Vinted Manager" }] }),
  component: ItemsPage,
});

function ItemsPage() {
  const { accountId } = Route.useParams();
  const getA = useServerFn(getAccount);
  const list = useServerFn(listItems);
  const accountQ = useQuery({ queryKey: ["account", accountId], queryFn: () => getA({ data: { accountId } }) });
  const itemsQ = useQuery({ queryKey: ["items", accountId], queryFn: () => list({ data: { accountId } }) });

  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    if (!itemsQ.data) return [];
    if (!q.trim()) return itemsQ.data;
    const s = q.toLowerCase();
    return itemsQ.data.filter(
      (i) =>
        i.title?.toLowerCase().includes(s) ||
        i.brand?.toLowerCase().includes(s) ||
        i.vinted_item_id.includes(s),
    );
  }, [itemsQ.data, q]);

  const account = accountQ.data;
  const base = account?.label ?? "items";

  return (
    <div className="space-y-6">
      <AccountHeader account={account} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Szukaj po tytule, marce, ID..."
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => exportToCSV(filtered, `vinted-${base}.csv`)} disabled={!filtered.length}>
            <FileDown className="mr-2 h-4 w-4" /> CSV
          </Button>
          <Button variant="outline" onClick={() => exportToXML(filtered, `vinted-${base}.xml`)} disabled={!filtered.length}>
            <FileCode2 className="mr-2 h-4 w-4" /> XML
          </Button>
          <Button onClick={() => exportToExcel(filtered, `vinted-${base}.xlsx`)} disabled={!filtered.length}>
            <FileSpreadsheet className="mr-2 h-4 w-4" /> Excel
          </Button>
        </div>
      </div>

      <div className="surface-card overflow-hidden">
        {itemsQ.isLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Wczytywanie...</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-sm text-muted-foreground">
              {itemsQ.data?.length === 0
                ? "Brak przedmiotów. Wtyczka zsynchronizuje listę przy następnym wejściu na vinted."
                : "Żaden przedmiot nie pasuje do wyszukiwania."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-surface-2 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Zdjęcie</th>
                  <th className="px-4 py-3">Tytuł</th>
                  <th className="px-4 py-3">Marka / rozmiar</th>
                  <th className="px-4 py-3 text-right">Cena</th>
                  <th className="px-4 py-3 text-right">Wyśw.</th>
                  <th className="px-4 py-3 text-right">❤</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((it) => (
                  <tr key={it.id} className="hover:bg-surface-2">
                    <td className="px-4 py-2">
                      {it.photo_url ? (
                        <img src={it.photo_url} alt="" className="h-12 w-12 rounded object-cover" loading="lazy" />
                      ) : (
                        <div className="h-12 w-12 rounded bg-muted" />
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {it.url ? (
                        <a href={it.url} target="_blank" rel="noreferrer" className="font-medium hover:text-primary">
                          {it.title}
                        </a>
                      ) : (
                        <span className="font-medium">{it.title}</span>
                      )}
                      <p className="text-xs text-muted-foreground">#{it.vinted_item_id}</p>
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {it.brand} {it.size_title && `· ${it.size_title}`}
                    </td>
                    <td className="px-4 py-2 text-right font-semibold text-primary">
                      {it.price} {it.currency}
                    </td>
                    <td className="px-4 py-2 text-right text-muted-foreground">{it.views ?? 0}</td>
                    <td className="px-4 py-2 text-right text-muted-foreground">{it.favourite_count ?? 0}</td>
                    <td className="px-4 py-2">
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase">{it.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Pokazano {filtered.length} z {itemsQ.data?.length ?? 0} przedmiotów.
      </p>
    </div>
  );
}
