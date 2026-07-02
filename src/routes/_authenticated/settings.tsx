import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { vintedProxy, saveVintedToken } from "@/lib/vintedProxy";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckCircle2, XCircle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Ustawienia — Vinted Manager" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const qc = useQueryClient();
  const [manualToken, setManualToken] = useState("");
  const [domain, setDomain] = useState("vinted.pl");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: tokenStatus } = useQuery({
    queryKey: ["vinted-token-status"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await supabase
        .from("vinted_tokens")
        .select("vinted_username, vinted_domain, updated_at")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
  });

  async function handleManualToken() {
    setError(null);
    setSaving(true);
    try {
      const tok = manualToken.trim();
      if (!tok) throw new Error("Wklej token");

      // Zapisz tymczasowo (bez user_id z Vinted) — używamy proxy z pominięciem cache; więc najpierw zrobimy inline fetch
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Brak sesji");

      // Zweryfikuj token bezpośrednio na Vinted przez proxy: najpierw zapisz w prowizorycznej postaci,
      // by proxy mogło pobrać token. Wpierw musimy znać vinted_user_id — pobierz przez direct call.
      // Robimy weryfikację poprzez tymczasowe zapisanie tokenu z placeholder user_id, weryfikację i update.
      await saveVintedToken({
        access_token: tok,
        vinted_user_id: "pending",
        vinted_username: "",
        vinted_domain: domain,
      });

      const res = await vintedProxy({ path: "/api/v2/users/current", method: "GET", domain });
      if (!res.ok) throw new Error(`Vinted odpowiedział ${res.status}`);
      const j = res.json as { user?: { id?: number; login?: string } } | null;
      const uid = j?.user?.id;
      const login = j?.user?.login || "";
      if (!uid) throw new Error("Nie udało się pobrać profilu Vinted");

      await saveVintedToken({
        access_token: tok,
        vinted_user_id: String(uid),
        vinted_username: login,
        vinted_domain: domain,
      });

      setManualToken("");
      qc.invalidateQueries({ queryKey: ["vinted-token-status"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Ustawienia</h1>

      <section className="rounded-xl border border-border bg-surface p-6">
        <h2 className="mb-4 text-lg font-semibold">Połączenie z Vinted</h2>

        {tokenStatus ? (
          <div className="mb-6 flex items-center gap-3 rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-3">
            <CheckCircle2 className="h-5 w-5 text-green-500" />
            <div className="text-sm">
              <strong>@{tokenStatus.vinted_username || "—"}</strong>
              <span className="text-muted-foreground">
                {" "}· {tokenStatus.vinted_domain} · zaktualizowano{" "}
                {new Date(tokenStatus.updated_at).toLocaleString("pl")}
              </span>
            </div>
          </div>
        ) : (
          <div className="mb-6 flex items-center gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3">
            <XCircle className="h-5 w-5 text-red-500" />
            <span className="text-sm text-muted-foreground">Nie połączono z Vinted</span>
          </div>
        )}

        <div className="space-y-6">
          <div>
            <h3 className="mb-1 text-sm font-semibold">Metoda 1: Automatycznie przez wtyczkę</h3>
            <p className="text-sm text-muted-foreground">
              Otwórz vinted.pl z zainstalowaną wtyczką — token zostanie pobrany i zapisany automatycznie
              (co ~30 min).
            </p>
          </div>

          <div>
            <h3 className="mb-1 text-sm font-semibold">Metoda 2: Wklej token ręcznie</h3>
            <p className="mb-3 text-sm text-muted-foreground">
              W przeglądarce na vinted.pl otwórz DevTools (F12) → Application → Local Storage →
              skopiuj wartość klucza <code>access_token</code> lub <code>access_token_web</code>.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <select
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                className="h-10 rounded-md border border-border bg-background px-3 text-sm"
              >
                {["vinted.pl", "vinted.fr", "vinted.de", "vinted.es", "vinted.it", "vinted.nl", "vinted.cz", "vinted.sk", "vinted.co.uk"].map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
              <Input
                type="password"
                placeholder="Wklej access_token..."
                value={manualToken}
                onChange={(e) => setManualToken(e.target.value)}
                className="flex-1"
              />
              <Button onClick={handleManualToken} disabled={saving || !manualToken.trim()}>
                {saving ? "Zapisywanie..." : "Zapisz token"}
              </Button>
            </div>
            {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
          </div>
        </div>
      </section>
    </div>
  );
}
