import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { generatePairingCode, listDevices, revokeDevice } from "@/lib/vinted.functions";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { Download, RefreshCw, Copy, Trash2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/download-extension")({
  head: () => ({ meta: [{ title: "Wtyczka Chrome — Vinted Manager" }] }),
  component: DownloadPage,
});

function DownloadPage() {
  const qc = useQueryClient();
  const gen = useServerFn(generatePairingCode);
  const list = useServerFn(listDevices);
  const revoke = useServerFn(revokeDevice);
  const devicesQ = useQuery({ queryKey: ["devices"], queryFn: () => list() });

  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const genM = useMutation({
    mutationFn: () => gen(),
    onSuccess: (c) => setCode(c),
    onError: (e: Error) => toast.error(e.message),
  });
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
          Wtyczka działa lokalnie w Twojej przeglądarce i łączy się z panelem przez kod parowania.
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
        <h2 className="font-display text-lg font-semibold">2. Sparuj wtyczkę z panelem</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Wygeneruj kod (ważny przez 10 minut) i wpisz go w popupie wtyczki.
        </p>

        {code ? (
          <div className="mt-5 rounded-2xl border border-primary/30 bg-primary/10 p-6 text-center">
            <p className="text-xs uppercase tracking-widest text-primary">Kod parowania</p>
            <p className="mt-2 font-mono text-5xl font-bold tracking-[0.4em] text-primary">
              {code.code}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Wygasa: {new Date(code.expiresAt).toLocaleTimeString("pl-PL")}
            </p>
            <div className="mt-4 flex justify-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  navigator.clipboard.writeText(code.code);
                  toast.success("Skopiowano");
                }}
              >
                <Copy className="mr-2 h-4 w-4" /> Kopiuj
              </Button>
              <Button variant="ghost" size="sm" onClick={() => genM.mutate()}>
                <RefreshCw className="mr-2 h-4 w-4" /> Nowy kod
              </Button>
            </div>
          </div>
        ) : (
          <Button onClick={() => genM.mutate()} disabled={genM.isPending} className="mt-5">
            Wygeneruj kod parowania
          </Button>
        )}
      </section>

      <section className="surface-card p-6">
        <h2 className="font-display text-lg font-semibold">Twoje wtyczki</h2>
        {devicesQ.data?.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Żadna wtyczka nie jest sparowana.</p>
        ) : (
          <div className="mt-3 divide-y divide-border">
            {devicesQ.data?.map((d) => (
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
        )}
      </section>
    </div>
  );
}
