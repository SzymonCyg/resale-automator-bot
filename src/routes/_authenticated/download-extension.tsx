import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listDevices, revokeDevice } from "@/lib/vinted.functions";
import { Button } from "@/components/ui/button";
import { Download, Trash2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/download-extension")({
  head: () => ({ meta: [{ title: "Wtyczka Chrome — Vinted Manager" }] }),
  component: DownloadPage,
});

function DownloadPage() {
  const qc = useQueryClient();
  const list = useServerFn(listDevices);
  const revoke = useServerFn(revokeDevice);
  const devicesQ = useQuery({ queryKey: ["devices"], queryFn: () => list() });

  const revokeM = useMutation({
    mutationFn: (id: string) => revoke({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["devices"] }),
  });

  function downloadZip() {
    fetch("/vinted-helper.zip")
      .then((r) => {
        if (!r.ok) throw new Error("Plik niedostępny");
        return r.blob();
      })
      .then((blob) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "vinted-helper.zip";
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch((e) => toast.error(e.message));
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-semibold">Wtyczka Chrome</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Wtyczka loguje się tym samym kontem Google co panel — nie trzeba używać żadnych kodów parowania.
        </p>
      </div>

      <section className="surface-card p-6">
        <h2 className="font-display text-lg font-semibold">1. Pobierz i zainstaluj</h2>
        <ol className="mt-4 space-y-2 text-sm text-muted-foreground">
          <li>1. Pobierz plik ZIP poniżej i rozpakuj go.</li>
          <li>2. Otwórz <code className="rounded bg-muted px-1.5 py-0.5">chrome://extensions</code> w Chrome / Edge / Brave.</li>
          <li>3. Włącz <strong>Tryb dewelopera</strong> (przełącznik w prawym górnym rogu).</li>
          <li>4. Kliknij <strong>Załaduj rozpakowane</strong> i wskaż folder.</li>
        </ol>
        <Button onClick={downloadZip} className="mt-5">
          <Download className="mr-2 h-4 w-4" /> Pobierz vinted-helper.zip
        </Button>
      </section>

      <section className="surface-card p-6">
        <h2 className="font-display text-lg font-semibold">2. Zaloguj wtyczkę przez Google</h2>
        <ol className="mt-4 space-y-2 text-sm text-muted-foreground">
          <li>1. Kliknij ikonę wtyczki w pasku Chrome.</li>
          <li>2. Wpisz URL panelu (domyślnie podpowiedziany) i kliknij <strong>Zaloguj przez panel (Google)</strong>.</li>
          <li>3. W otwartej karcie panelu zaloguj się Googlem (jeśli nie jesteś jeszcze zalogowany).</li>
          <li>4. Sesja zostanie automatycznie przesłana do wtyczki — popup pokaże ✓ Zalogowano.</li>
        </ol>
        <p className="mt-3 text-xs text-muted-foreground">
          Wtyczka przechowuje tylko token sesji (access + refresh). Hasło nigdy nie opuszcza Google.
        </p>
      </section>

      {devicesQ.data && devicesQ.data.length > 0 && (
        <section className="surface-card p-6">
          <h2 className="font-display text-lg font-semibold">Wtyczki sparowane starym kodem</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Możesz je tutaj odłączyć — od wersji 0.2.0 wtyczka używa logowania Google.
          </p>
          <div className="mt-3 divide-y divide-border">
            {devicesQ.data.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-3 py-3">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="h-4 w-4 text-success" />
                  <div>
                    <p className="text-sm font-medium">{d.label ?? "Wtyczka Chrome"}</p>
                    <p className="text-xs text-muted-foreground">{d.user_agent}</p>
                  </div>
                </div>
                <Button size="icon" variant="ghost" onClick={() => revokeM.mutate(d.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
