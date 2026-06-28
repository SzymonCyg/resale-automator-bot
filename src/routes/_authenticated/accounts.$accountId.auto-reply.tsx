import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getAccount,
  getFallback,
  listRules,
  saveFallback,
  saveRule,
  deleteRule,
} from "@/lib/vinted.functions";
import { AccountHeader } from "@/components/account-header";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEffect, useState } from "react";
import { Plus, Trash2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/accounts/$accountId/auto-reply")({
  head: () => ({ meta: [{ title: "Auto-odpowiedzi — Vinted Manager" }] }),
  component: ReplyPage,
});

function ReplyPage() {
  const { accountId } = Route.useParams();
  const qc = useQueryClient();
  const getA = useServerFn(getAccount);
  const listR = useServerFn(listRules);
  const getF = useServerFn(getFallback);
  const saveR = useServerFn(saveRule);
  const delR = useServerFn(deleteRule);
  const saveF = useServerFn(saveFallback);

  const accountQ = useQuery({ queryKey: ["account", accountId], queryFn: () => getA({ data: { accountId } }) });
  const rulesQ = useQuery({ queryKey: ["rules", accountId], queryFn: () => listR({ data: { accountId } }) });
  const fallbackQ = useQuery({ queryKey: ["fallback", accountId], queryFn: () => getF({ data: { accountId } }) });

  const saveM = useMutation({
    mutationFn: (input: Parameters<typeof saveR>[0]["data"]) => saveR({ data: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rules", accountId] });
      toast.success("Reguła zapisana");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delM = useMutation({
    mutationFn: (id: string) => delR({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rules", accountId] }),
  });

  const [fbEnabled, setFbEnabled] = useState(false);
  const [fbTemplate, setFbTemplate] = useState("");
  const [fbAuto, setFbAuto] = useState(false);

  useEffect(() => {
    if (fallbackQ.data) {
      setFbEnabled(fallbackQ.data.enabled);
      setFbTemplate(fallbackQ.data.template ?? "");
      setFbAuto(fallbackQ.data.auto_send);
    }
  }, [fallbackQ.data]);

  const saveFM = useMutation({
    mutationFn: () =>
      saveF({ data: { accountId, enabled: fbEnabled, template: fbTemplate, autoSend: fbAuto } }),
    onSuccess: () => {
      toast.success("Ustawienia fallback zapisane");
      qc.invalidateQueries({ queryKey: ["fallback", accountId] });
    },
  });

  return (
    <div className="space-y-6">
      <AccountHeader account={accountQ.data} active="auto-reply" />

      <div className="surface-card flex items-start gap-3 border-warning/30 bg-warning/5 p-4 text-sm">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-warning" />
        <p>
          <strong>Domyślnie</strong> wtyczka tylko podpowiada odpowiedź — wysłanie wymaga Twojego kliknięcia.
          Włącz "auto-wysyłka" tylko jeśli ufasz swoim regułom.
        </p>
      </div>

      <section className="surface-card p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">Reguły dopasowania</h2>
          <Button
            size="sm"
            onClick={() =>
              saveM.mutate({
                accountId,
                matchType: "contains",
                pattern: "",
                responseTemplate: "",
                priority: 0,
                enabled: true,
              })
            }
          >
            <Plus className="mr-1 h-4 w-4" /> Nowa reguła
          </Button>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Pierwsza pasująca reguła (od najwyższego priorytetu) zostanie użyta. Możesz w szablonie użyć{" "}
          <code className="rounded bg-muted px-1">{"{username}"}</code> i{" "}
          <code className="rounded bg-muted px-1">{"{item_title}"}</code>.
        </p>

        <div className="mt-4 space-y-3">
          {rulesQ.data?.length === 0 && (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              Brak reguł. Dodaj pierwszą — np. "cena" → "Cena jest aktualna 😊".
            </div>
          )}
          {rulesQ.data?.map((r) => (
            <RuleRow
              key={r.id}
              rule={r}
              onSave={(updated) => saveM.mutate({ ...updated, id: r.id, accountId })}
              onDelete={() => delM.mutate(r.id)}
            />
          ))}
        </div>
      </section>

      <section className="surface-card p-6">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-display text-lg font-semibold">Domyślna odpowiedź (fallback)</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Używana gdy żadna reguła nie pasuje.
            </p>
          </div>
          <Switch checked={fbEnabled} onCheckedChange={setFbEnabled} />
        </div>
        <div className="mt-4 space-y-3">
          <Textarea
            value={fbTemplate}
            onChange={(e) => setFbTemplate(e.target.value)}
            placeholder="Cześć! Dziękuję za wiadomość, odpowiem najszybciej jak to możliwe :)"
            rows={3}
          />
          <div className="flex items-center justify-between rounded-lg border border-border bg-surface-2 p-3 text-sm">
            <span>Wysyłaj automatycznie (bez potwierdzenia)</span>
            <Switch checked={fbAuto} onCheckedChange={setFbAuto} />
          </div>
          <Button onClick={() => saveFM.mutate()} disabled={saveFM.isPending}>
            Zapisz fallback
          </Button>
        </div>
      </section>
    </div>
  );
}

function RuleRow({
  rule,
  onSave,
  onDelete,
}: {
  rule: {
    id: string;
    match_type: string;
    pattern: string;
    response_template: string;
    priority: number;
    enabled: boolean;
  };
  onSave: (r: {
    matchType: "contains" | "exact" | "regex" | "starts_with";
    pattern: string;
    responseTemplate: string;
    priority: number;
    enabled: boolean;
  }) => void;
  onDelete: () => void;
}) {
  const [matchType, setMatchType] = useState(rule.match_type);
  const [pattern, setPattern] = useState(rule.pattern);
  const [tpl, setTpl] = useState(rule.response_template);
  const [priority, setPriority] = useState(rule.priority);
  const [enabled, setEnabled] = useState(rule.enabled);

  return (
    <div className="rounded-xl border border-border bg-surface-2 p-4">
      <div className="grid gap-3 md:grid-cols-[120px_140px_1fr_80px_auto]">
        <div>
          <Label className="text-xs">Typ</Label>
          <Select value={matchType} onValueChange={setMatchType}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="contains">zawiera</SelectItem>
              <SelectItem value="starts_with">zaczyna się</SelectItem>
              <SelectItem value="exact">dokładnie</SelectItem>
              <SelectItem value="regex">regex</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Wzorzec</Label>
          <Input value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="cena" />
        </div>
        <div>
          <Label className="text-xs">Odpowiedź</Label>
          <Input value={tpl} onChange={(e) => setTpl(e.target.value)} placeholder="Cena aktualna :)" />
        </div>
        <div>
          <Label className="text-xs">Priorytet</Label>
          <Input
            type="number"
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value))}
          />
        </div>
        <div className="flex items-end gap-2">
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </div>
      </div>
      <div className="mt-3 flex justify-between">
        <Button size="sm" variant="ghost" onClick={onDelete}>
          <Trash2 className="mr-1 h-3.5 w-3.5" /> Usuń
        </Button>
        <Button
          size="sm"
          onClick={() =>
            onSave({
              matchType: matchType as "contains" | "exact" | "regex" | "starts_with",
              pattern,
              responseTemplate: tpl,
              priority,
              enabled,
            })
          }
        >
          Zapisz
        </Button>
      </div>
    </div>
  );
}
