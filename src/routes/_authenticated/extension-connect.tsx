import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/extension-connect")({
  head: () => ({ meta: [{ title: "Łączenie z wtyczką — Vinted Manager" }] }),
  validateSearch: z.object({
    extId: z.string().min(10).max(64),
    vinted: z.string().optional(),
  }),
  component: ConnectPage,
});

type Status = "idle" | "sending" | "ok" | "err";

function ConnectPage() {
  const { extId, vinted } = useSearch({ from: "/_authenticated/extension-connect" });
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<{ email?: string | null; id: string } | null>(null);

  async function send() {
    setStatus("sending");
    setError(null);
    try {
      const { data: sessionData, error: sErr } = await supabase.auth.getSession();
      if (sErr) throw sErr;
      const session = sessionData.session;
      if (!session) throw new Error("Brak aktywnej sesji. Zaloguj się ponownie.");

      const chromeApi = (window as unknown as {
        chrome?: {
          runtime?: {
            sendMessage?: (
              extId: string,
              msg: unknown,
              cb: (resp: { ok?: boolean; error?: string } | undefined) => void,
            ) => void;
            lastError?: { message: string };
          };
        };
      }).chrome;
      if (!chromeApi?.runtime?.sendMessage) {
        throw new Error(
          "Ta strona musi być otwarta w Chrome / Edge / Brave z zainstalowaną wtyczką Vinted Manager.",
        );
      }

      await new Promise<void>((resolve, reject) => {
        chromeApi.runtime!.sendMessage!(
          extId,
          {
            kind: "SUPABASE_SESSION",
            session: {
              access_token: session.access_token,
              refresh_token: session.refresh_token,
              expires_at: session.expires_at,
            },
            user: { id: session.user.id, email: session.user.email },
            supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
            supabaseAnonKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            panelUrl: window.location.origin,
          },
          (resp) => {
            const lastErr = chromeApi.runtime!.lastError;
            if (lastErr) {
              reject(
                new Error(
                  `Wtyczka nie odpowiada (${lastErr.message}). Upewnij się, że jest zainstalowana i włączona.`,
                ),
              );
              return;
            }
            if (resp?.ok) resolve();
            else reject(new Error(resp?.error ?? "Nieznany błąd wtyczki"));
          },
        );
      });
      setUser({ id: session.user.id, email: session.user.email });
      setStatus("ok");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("err");
    }
  }

  useEffect(() => {
    send();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extId]);

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold">Łączenie wtyczki z panelem</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Przekazujemy Twoją sesję Google do wtyczki <code>{extId}</code>.
        </p>
      </div>

      <section className="surface-card p-6">
        {status === "sending" && (
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Łączenie z wtyczką…
          </div>
        )}
        {status === "ok" && (
          <div className="space-y-3">
            <div className="flex items-center gap-3 text-success">
              <CheckCircle2 className="h-5 w-5" />
              <p className="font-medium">Wtyczka połączona</p>
            </div>
            <p className="text-sm text-muted-foreground">
              Zalogowano jako <strong>{user?.email ?? user?.id}</strong>. Możesz zamknąć tę
              kartę i wrócić do popupu wtyczki.
            </p>
            <Button variant="outline" onClick={() => window.close()}>
              Zamknij kartę
            </Button>
          </div>
        )}
        {status === "err" && (
          <div className="space-y-3">
            <div className="flex items-center gap-3 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              <p className="font-medium">Nie udało się połączyć</p>
            </div>
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button onClick={send}>Spróbuj ponownie</Button>
          </div>
        )}
      </section>
    </div>
  );
}
