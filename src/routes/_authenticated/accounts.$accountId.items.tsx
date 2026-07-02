import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getAccount,
  listItems,
  bumpItem,
  deleteItem,
  runTaskRunner,
  listActionLogs,
} from "@/lib/vinted.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FileCode2, FileDown, FileSpreadsheet, RefreshCw, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { exportToCSV, exportToExcel, exportToXML } from "@/lib/export";
import { AccountHeader } from "@/components/account-header";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/accounts/$accountId/items")({
  head: () => ({ meta: [{ title: "Przedmioty — Vinted Manager" }] }),
  component: ItemsPage,
});

function ItemsPage() {
  const { accountId } = Route.useParams();
  const getA = useServerFn(getAccount);
  const list = useServerFn(listItems);
  const bumpFn = useServerFn(bumpItem);
  const deleteFn = useServerFn(deleteItem);
  const runRunner = useServerFn(runTaskRunner);
  const logsFn = useServerFn(listActionLogs);
  const accountQ = useQuery({ queryKey: ["account", accountId], queryFn: () => getA({ data: { accountId } }) });
  const itemsQ = useQuery({ queryKey: ["items", accountId], queryFn: () => list({ data: { accountId } }) });
  const logsQ = useQuery({ queryKey: ["logs", accountId], queryFn: () => logsFn({ data: { accountId } }) });

  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<"" | "bump" | "delete">("");
  const [showLogs, setShowLogs] = useState(false);

  const filtered = useMemo(() => {
    if (!itemsQ.data) return [];
    let rows = itemsQ.data;
    if (q.trim()) {
      const s = q.toLowerCase();
      rows = rows.filter(
        (i) =>
          i.title?.toLowerCase().includes(s) ||
          i.brand?.toLowerCase().includes(s) ||
          i.vinted_item_id.includes(s),
      );
    }
    if (statusFilter === "active")
      rows = rows.filter((i) => i.status === "active" || i.status === "visible");
    if (statusFilter === "inactive")
      rows = rows.filter((i) => i.status !== "active" && i.status !== "visible");
    return rows;
  }, [itemsQ.data, q, statusFilter]);

  useEffect(() => {
    setSelected(new Set());
  }, [q, statusFilter]);

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((i) => i.vinted_item_id)));
  }

  const account = accountQ.data;
  const base = account?.label ?? "items";

  return (
    <div className="space-y-6">
      <AccountHeader account={account} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 flex-1">
          <div className="relative max-w-sm flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Szukaj po tytule, marce, ID..."
              className="pl-9"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as "all" | "active" | "inactive")}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="all">Wszystkie statusy</option>
            <option value="active">Aktywne</option>
            <option value="inactive">Nieaktywne</option>
          </select>
        </div>
        <div className="flex flex-wrap gap-2">
          {selected.size > 0 && (
            <>
              <Button
                variant="outline"
                disabled={busy !== ""}
                onClick={async () => {
                  const items = filtered.filter((i) => selected.has(i.vinted_item_id));
                  setBusy("bump");
                  let ok = 0, err = 0;
                  for (const it of items) {
                    try {
                      await bumpFn({ data: { accountId, itemId: it.id, vintedItemId: it.vinted_item_id } });
                      ok++;
                    } catch (e) {
                      console.warn("Bump task create failed", it.vinted_item_id, e);
                      err++;
                    }
                  }
                  try {
                    const res = await runRunner();
                    toast.success(`Odświeżanie: kolejka ${ok}${err ? `, błędy ${err}` : ""}. Wykonano: ${res?.processed ?? 0}`);
                  } catch (e) {
                    toast.error(`Task runner: ${(e as Error).message}`);
                  }
                  setSelected(new Set());
                  setBusy("");
                  itemsQ.refetch();
                  logsQ.refetch();
                }}
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${busy === "bump" ? "animate-spin" : ""}`} />
                {busy === "bump" ? "Odświeżam..." : `Odśwież zaznaczone (${selected.size})`}
              </Button>
              <Button
                variant="destructive"
                disabled={busy !== ""}
                onClick={async () => {
                  if (!confirm(`Usunąć ${selected.size} przedmiot(ów) z Vinted? Tej akcji nie można cofnąć.`)) return;
                  const items = filtered.filter((i) => selected.has(i.vinted_item_id));
                  setBusy("delete");
                  let ok = 0, err = 0;
                  for (const it of items) {
                    try {
                      await deleteFn({ data: { accountId, itemId: it.id, vintedItemId: it.vinted_item_id, title: it.title ?? undefined } });
                      ok++;
                    } catch (e) {
                      console.warn("Delete task create failed", it.vinted_item_id, e);
                      err++;
                    }
                  }
                  try {
                    const res = await runRunner();
                    toast.success(`Usuwanie: kolejka ${ok}${err ? `, błędy ${err}` : ""}. Wykonano: ${res?.processed ?? 0}`);
                  } catch (e) {
                    toast.error(`Task runner: ${(e as Error).message}`);
                  }
                  setSelected(new Set());
                  setBusy("");
                  itemsQ.refetch();
                  logsQ.refetch();
                }}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                {busy === "delete" ? "Usuwam..." : `Usuń zaznaczone (${selected.size})`}
              </Button>
            </>
          )}
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
                  <th className="px-4 py-3 w-8">
                    <input
                      type="checkbox"
                      checked={filtered.length > 0 && selected.size === filtered.length}
                      onChange={toggleAll}
                      className="cursor-pointer"
                    />
                  </th>
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
                    <td className="px-4 py-2 w-8">
                      <input
                        type="checkbox"
                        checked={selected.has(it.vinted_item_id)}
                        onChange={() => toggleOne(it.vinted_item_id)}
                        className="cursor-pointer"
                      />
                    </td>
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

      <div className="surface-card">
        <button
          onClick={() => setShowLogs((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium"
        >
          <span>Log akcji {logsQ.data?.length ? `(${logsQ.data.length})` : ""}</span>
          <span className="text-xs text-muted-foreground">{showLogs ? "Ukryj" : "Pokaż"}</span>
        </button>
        {showLogs && (
          <div className="border-t border-border">
            {logsQ.isLoading ? (
              <div className="p-4 text-sm text-muted-foreground">Wczytywanie...</div>
            ) : !logsQ.data?.length ? (
              <div className="p-4 text-sm text-muted-foreground">Brak wpisów.</div>
            ) : (
              <ul className="divide-y divide-border">
                {logsQ.data.slice(0, 20).map((l) => (
                  <li key={l.id} className="flex items-start gap-3 px-4 py-2 text-sm">
                    <span
                      className={`mt-0.5 rounded-full px-2 py-0.5 text-[10px] uppercase ${
                        l.status === "ok"
                          ? "bg-emerald-500/10 text-emerald-600"
                          : l.status === "error"
                            ? "bg-destructive/10 text-destructive"
                            : "bg-muted"
                      }`}
                    >
                      {l.type}
                    </span>
                    <span className="flex-1">{l.message}</span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(l.created_at).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
