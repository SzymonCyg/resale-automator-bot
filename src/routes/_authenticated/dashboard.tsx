import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listAccounts, deleteAccount, getDashboardStats } from "@/lib/vinted.functions";
import { Button } from "@/components/ui/button";
import { Boxes, Trash2, Users, Download, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { pl } from "date-fns/locale";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Vinted Manager" }] }),
  component: Dashboard,
});

function downloadExtension() {
  fetch("/vinted-helper.zip")
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.blob();
    })
    .then((blob) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "vinted-helper.zip";
      a.click();
      URL.revokeObjectURL(a.href);
    })
    .catch((e) => toast.error(`Nie udało się pobrać wtyczki: ${e.message}`));
}

function Dashboard() {
  const qc = useQueryClient();
  const list = useServerFn(listAccounts);
  const stats = useServerFn(getDashboardStats);
  const del = useServerFn(deleteAccount);

  const accountsQ = useQuery({ queryKey: ["accounts"], queryFn: () => list() });
  const statsQ = useQuery({ queryKey: ["stats"], queryFn: () => stats() });

  const delM = useMutation({
    mutationFn: (id: string) => del({ data: { accountId: id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      toast.success("Konto usunięte");
    },
  });

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Konta są dodawane automatycznie, gdy wtyczka wykryje zalogowaną sesję Vinted.
          </p>
        </div>
        <Button onClick={downloadExtension} variant="outline">
          <Download className="mr-2 h-4 w-4" /> Pobierz wtyczkę Chrome
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard icon={<Users className="h-4 w-4" />} label="Konta Vinted" value={statsQ.data?.accountsCount ?? 0} />
        <StatCard icon={<Boxes className="h-4 w-4" />} label="Przedmioty" value={statsQ.data?.itemsCount ?? 0} />
        <div className="surface-card flex items-center justify-between p-4">
          <div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Sparkles className="h-4 w-4 text-primary" /> Twój plan
            </div>
            <p className="mt-2 font-display text-xl font-semibold">Free (tryb testowy)</p>
          </div>
          <Button size="sm" variant="ghost" disabled>
            Zmień plan
          </Button>
        </div>
      </div>

      <section className="surface-card p-6">
        <h2 className="font-display text-lg font-semibold">Twoje konta</h2>
        {accountsQ.isLoading ? (
          <p className="mt-4 text-sm text-muted-foreground">Wczytywanie...</p>
        ) : accountsQ.data?.length === 0 ? (
          <div className="mt-6 rounded-lg border border-dashed border-border p-8 text-center">
            <p className="text-sm text-muted-foreground">
              Brak kont. Zainstaluj wtyczkę, zaloguj się przez Google i otwórz vinted.pl — konto pojawi się tu automatycznie.
            </p>
          </div>
        ) : (
          <div className="mt-4 divide-y divide-border">
            {accountsQ.data?.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-3 py-3">
                <div>
                  <Link
                    to="/accounts/$accountId/items"
                    params={{ accountId: a.id }}
                    className="font-medium hover:text-primary"
                  >
                    {a.label}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    vinted.{a.country}
                    {a.vinted_username ? ` · @${a.vinted_username}` : ""} ·{" "}
                    {a.last_sync_at
                      ? `synchr. ${formatDistanceToNow(new Date(a.last_sync_at), { locale: pl, addSuffix: true })}`
                      : "brak synchronizacji"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={
                      "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase " +
                      (a.status === "active" ? "bg-success/15 text-success" : "bg-warning/15 text-warning")
                    }
                  >
                    {a.status}
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => {
                      if (confirm(`Usunąć konto "${a.label}"? Przedmioty również zostaną usunięte.`)) delM.mutate(a.id);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="surface-card p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="text-primary">{icon}</span> {label}
      </div>
      <p className="mt-2 font-display text-3xl font-semibold">{value}</p>
    </div>
  );
}
