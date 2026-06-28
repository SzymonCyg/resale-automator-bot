import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getAccount, getBumpSettings, listItems, saveBumpSettings } from "@/lib/vinted.functions";
import { AccountHeader } from "@/components/account-header";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";

export const Route = createFileRoute("/_authenticated/accounts/$accountId/auto-bump")({
  head: () => ({ meta: [{ title: "Auto-bump — Vinted Manager" }] }),
  component: BumpPage,
});

function BumpPage() {
  const { accountId } = Route.useParams();
  const qc = useQueryClient();
  const getA = useServerFn(getAccount);
  const getS = useServerFn(getBumpSettings);
  const list = useServerFn(listItems);
  const save = useServerFn(saveBumpSettings);

  const accountQ = useQuery({ queryKey: ["account", accountId], queryFn: () => getA({ data: { accountId } }) });
  const settingsQ = useQuery({ queryKey: ["bump", accountId], queryFn: () => getS({ data: { accountId } }) });
  const itemsQ = useQuery({ queryKey: ["items", accountId], queryFn: () => list({ data: { accountId } }) });

  const [enabled, setEnabled] = useState(false);
  const [interval, setInt] = useState(6);
  const [bumpAll, setBumpAll] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (settingsQ.data) {
      setEnabled(settingsQ.data.enabled);
      setInt(settingsQ.data.interval_hours);
      setBumpAll(settingsQ.data.bump_all);
      setSelected(new Set(settingsQ.data.item_ids ?? []));
    }
  }, [settingsQ.data]);

  const saveM = useMutation({
    mutationFn: () =>
      save({
        data: {
          accountId,
          enabled,
          intervalHours: interval,
          bumpAll,
          itemIds: Array.from(selected),
        },
      }),
    onSuccess: () => {
      toast.success("Ustawienia zapisane");
      qc.invalidateQueries({ queryKey: ["bump", accountId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <AccountHeader account={accountQ.data} active="auto-bump" />

      <section className="surface-card p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-lg font-semibold">Automatyczne ponowne wystawianie</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Wtyczka będzie odświeżać wybrane przedmioty w stałych odstępach. Minimum 3 godziny — zbyt
              częste bumpy zwiększają ryzyko ograniczeń konta.
            </p>
          </div>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </div>

        <div className="mt-6 space-y-5">
          <div>
            <Label className="flex items-center justify-between">
              <span>Co ile godzin</span>
              <span className="font-mono text-primary">{interval} h</span>
            </Label>
            <Slider
              value={[interval]}
              onValueChange={(v) => setInt(v[0])}
              min={3}
              max={48}
              step={1}
              className="mt-3"
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border bg-surface-2 p-4">
            <div>
              <p className="font-medium">Bumpuj wszystkie aktywne przedmioty</p>
              <p className="text-xs text-muted-foreground">
                Wyłącz aby wybrać konkretne przedmioty z listy poniżej.
              </p>
            </div>
            <Switch checked={bumpAll} onCheckedChange={setBumpAll} />
          </div>

          {!bumpAll && (
            <div>
              <p className="mb-2 text-sm font-medium">Wybierz przedmioty ({selected.size})</p>
              <div className="surface-card max-h-80 overflow-y-auto p-2">
                {itemsQ.data?.length === 0 && (
                  <p className="p-4 text-sm text-muted-foreground">Brak przedmiotów do wyboru.</p>
                )}
                {itemsQ.data?.map((it) => (
                  <label
                    key={it.id}
                    className="flex cursor-pointer items-center gap-3 rounded px-2 py-1.5 text-sm hover:bg-surface-2"
                  >
                    <Checkbox
                      checked={selected.has(it.id)}
                      onCheckedChange={(c) => {
                        const next = new Set(selected);
                        if (c) next.add(it.id);
                        else next.delete(it.id);
                        setSelected(next);
                      }}
                    />
                    <span className="flex-1 truncate">{it.title}</span>
                    <span className="text-xs text-muted-foreground">{it.price} {it.currency}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {settingsQ.data?.next_run_at && enabled && (
            <p className="text-xs text-muted-foreground">
              Następne uruchomienie: {new Date(settingsQ.data.next_run_at).toLocaleString("pl-PL")}
            </p>
          )}

          <Button onClick={() => saveM.mutate()} disabled={saveM.isPending}>
            Zapisz ustawienia
          </Button>
        </div>
      </section>
    </div>
  );
}
