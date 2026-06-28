import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  listAccounts,
  createAccount,
  deleteAccount,
  getDashboardStats,
  listDevices,
} from "@/lib/vinted.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Boxes, Cpu, Activity, Users, Download } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { pl } from "date-fns/locale";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Vinted Manager" }] }),
  component: Dashboard,
});

function Dashboard() {
  const qc = useQueryClient();
  const list = useServerFn(listAccounts);
  const stats = useServerFn(getDashboardStats);
  const devs = useServerFn(listDevices);
  const create = useServerFn(createAccount);
  const del = useServerFn(deleteAccount);

  const accountsQ = useQuery({ queryKey: ["accounts"], queryFn: () => list() });
  const statsQ = useQuery({ queryKey: ["stats"], queryFn: () => stats() });
  const devicesQ = useQuery({ queryKey: ["devices"], queryFn: () => devs() });

  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [country, setCountry] = useState("pl");

  const createM = useMutation({
    mutationFn: () => create({ data: { label, country } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      setOpen(false);
      setLabel("");
      toast.success("Konto dodane");
    },
    onError: (e: Error) => toast.error(e.message),
  });

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
            Przegląd kont Vinted i aktywności wtyczek.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" /> Dodaj konto
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Nowe konto Vinted</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-1.5">
                <Label htmlFor="label">Etykieta</Label>
                <Input
                  id="label"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="np. moje główne konto"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="country">Kraj / domena</Label>
                <Select value={country} onValueChange={setCountry}>
                  <SelectTrigger id="country">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pl">vinted.pl (Polska)</SelectItem>
                    <SelectItem value="fr">vinted.fr (Francja)</SelectItem>
                    <SelectItem value="de">vinted.de (Niemcy)</SelectItem>
                    <SelectItem value="es">vinted.es (Hiszpania)</SelectItem>
                    <SelectItem value="it">vinted.it (Włochy)</SelectItem>
                    <SelectItem value="nl">vinted.nl (Holandia)</SelectItem>
                    <SelectItem value="cz">vinted.cz (Czechy)</SelectItem>
                    <SelectItem value="sk">vinted.sk (Słowacja)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <p className="text-xs text-muted-foreground">
                Wtyczka połączy się z tym kontem automatycznie gdy będziesz zalogowany na vinted.{country}.
              </p>
            </div>
            <DialogFooter>
              <Button onClick={() => createM.mutate()} disabled={!label || createM.isPending}>
                Utwórz
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard icon={<Users className="h-4 w-4" />} label="Konta Vinted" value={statsQ.data?.accountsCount ?? 0} />
        <StatCard icon={<Boxes className="h-4 w-4" />} label="Przedmioty" value={statsQ.data?.itemsCount ?? 0} />
        <StatCard icon={<Cpu className="h-4 w-4" />} label="Sparowane wtyczki" value={statsQ.data?.devicesCount ?? 0} />
        <StatCard icon={<Activity className="h-4 w-4" />} label="Akcje (24h)" value={statsQ.data?.recentLogs.length ?? 0} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <section className="surface-card p-6">
          <h2 className="font-display text-lg font-semibold">Twoje konta</h2>
          {accountsQ.data?.length === 0 ? (
            <div className="mt-6 rounded-lg border border-dashed border-border p-8 text-center">
              <p className="text-sm text-muted-foreground">
                Nie masz jeszcze żadnych kont. Dodaj pierwsze, aby zacząć.
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
                      vinted.{a.country} ·{" "}
                      {a.last_sync_at
                        ? `synced ${formatDistanceToNow(new Date(a.last_sync_at), { locale: pl, addSuffix: true })}`
                        : "brak synchronizacji"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={
                        "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase " +
                        (a.status === "active"
                          ? "bg-success/15 text-success"
                          : "bg-warning/15 text-warning")
                      }
                    >
                      {a.status}
                    </span>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => {
                        if (confirm(`Usunąć konto "${a.label}"?`)) delM.mutate(a.id);
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

        <section className="surface-card p-6">
          <h2 className="font-display text-lg font-semibold">Wtyczki Chrome</h2>
          {(devicesQ.data?.length ?? 0) === 0 ? (
            <div className="mt-4 space-y-3">
              <p className="text-sm text-muted-foreground">
                Brak sparowanych wtyczek. Zainstaluj wtyczkę Chrome aby korzystać z automatyzacji.
              </p>
              <Link to="/download-extension">
                <Button variant="outline" className="w-full" size="sm">
                  <Download className="mr-2 h-4 w-4" /> Pobierz wtyczkę
                </Button>
              </Link>
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              {devicesQ.data?.map((d) => (
                <div key={d.id} className="rounded-lg border border-border bg-surface-2 p-3 text-xs">
                  <p className="font-medium">{d.label ?? "Wtyczka"}</p>
                  <p className="text-muted-foreground">
                    {d.last_seen_at
                      ? `aktywna ${formatDistanceToNow(new Date(d.last_seen_at), { locale: pl, addSuffix: true })}`
                      : "nieaktywna"}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="surface-card p-6">
        <h2 className="font-display text-lg font-semibold">Ostatnia aktywność</h2>
        {(statsQ.data?.recentLogs.length ?? 0) === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Brak aktywności.</p>
        ) : (
          <div className="mt-3 divide-y divide-border">
            {statsQ.data?.recentLogs.map((l) => (
              <div key={l.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div className="flex items-center gap-3">
                  <span
                    className={
                      "h-2 w-2 rounded-full " +
                      (l.status === "error"
                        ? "bg-destructive"
                        : l.status === "ok"
                          ? "bg-success"
                          : "bg-warning")
                    }
                  />
                  <span className="font-mono text-xs uppercase text-muted-foreground">{l.type}</span>
                  <span>{l.message}</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(l.created_at), { locale: pl, addSuffix: true })}
                </span>
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
