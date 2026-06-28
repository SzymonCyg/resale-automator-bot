import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { Boxes, Download, MessageSquareReply, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Vinted Manager — panel i wtyczka Chrome do automatyzacji Vinted" },
      {
        name: "description",
        content:
          "Zarządzaj kontami Vinted: podgląd listy przedmiotów, eksport do Excela i CSV, auto-bump oraz automatyczne odpowiedzi na wiadomości.",
      },
    ],
  }),
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getUser();
    if (data.user) throw redirect({ to: "/dashboard" });
  },
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <Link to="/" className="flex items-center gap-2 font-display text-lg font-semibold">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground glow">
            V
          </span>
          Vinted Manager
        </Link>
        <Link to="/auth">
          <Button variant="ghost">Zaloguj</Button>
        </Link>
      </header>

      <main className="mx-auto max-w-6xl px-6 pb-24 pt-12">
        <section className="grid gap-12 lg:grid-cols-[1.1fr_1fr] lg:items-center">
          <div>
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              Panel + wtyczka Chrome
            </div>
            <h1 className="font-display text-5xl font-semibold leading-tight tracking-tight md:text-6xl">
              Twój Vinted{" "}
              <span className="bg-gradient-to-r from-primary to-success bg-clip-text text-transparent">
                na autopilocie
              </span>
            </h1>
            <p className="mt-5 max-w-xl text-base text-muted-foreground md:text-lg">
              Podgląd wszystkich przedmiotów, eksport do Excela/CSV, automatyczne ponowne wystawianie
              i odpowiedzi na wiadomości według Twoich szablonów — wszystko z jednego panelu.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/auth">
                <Button size="lg" className="glow">
                  Zacznij za darmo
                </Button>
              </Link>
              <Link to="/auth">
                <Button size="lg" variant="outline">
                  Mam już konto
                </Button>
              </Link>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              Wymaga zainstalowania wtyczki Chrome. Działa lokalnie z Twoją sesją Vinted — nie
              prosimy o hasło.
            </p>
          </div>

          <div className="surface-card glow p-6">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-widest text-muted-foreground">Dashboard</p>
                <p className="font-display text-xl font-semibold">2 konta aktywne</p>
              </div>
              <span className="rounded-full bg-success/15 px-2.5 py-1 text-xs font-medium text-success">
                Połączone
              </span>
            </div>
            <div className="space-y-3">
              {[
                { title: "Sukienka letnia, rozmiar M", price: "45 zł", views: 128 },
                { title: "Buty Nike Air Force", price: "120 zł", views: 412 },
                { title: "Kurtka jeansowa Levi's", price: "85 zł", views: 87 },
              ].map((it) => (
                <div
                  key={it.title}
                  className="flex items-center justify-between rounded-lg border border-border bg-surface-2 px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-medium">{it.title}</p>
                    <p className="text-xs text-muted-foreground">{it.views} wyświetleń</p>
                  </div>
                  <span className="text-sm font-semibold text-primary">{it.price}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 flex items-center justify-between rounded-lg bg-primary/10 px-4 py-3 text-xs">
              <span className="flex items-center gap-2 text-primary">
                <RefreshCw className="h-3.5 w-3.5" /> Auto-bump co 6 h
              </span>
              <span className="text-muted-foreground">Następny: za 2 h 14 min</span>
            </div>
          </div>
        </section>

        <section className="mt-24 grid gap-4 md:grid-cols-3">
          <Feature
            icon={<Boxes className="h-5 w-5" />}
            title="Lista przedmiotów + eksport"
            desc="Wszystkie ogłoszenia z wielu kont w jednym miejscu. Eksport do Excela i CSV jednym kliknięciem."
          />
          <Feature
            icon={<RefreshCw className="h-5 w-5" />}
            title="Auto-bump"
            desc="Harmonogram ponownego wystawiania ustawiony raz, działa w tle. Wybierz konkretne przedmioty lub wszystkie."
          />
          <Feature
            icon={<MessageSquareReply className="h-5 w-5" />}
            title="Auto-odpowiedzi"
            desc="Reguły: słowo kluczowe → szablon odpowiedzi. Tryb sugestii lub wysyłanie automatyczne."
          />
        </section>

        <section className="mt-20 surface-card flex flex-col items-start gap-4 p-8 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-4">
            <span className="grid h-12 w-12 place-items-center rounded-xl bg-primary/15 text-primary">
              <ShieldCheck className="h-6 w-6" />
            </span>
            <div>
              <h3 className="font-display text-lg font-semibold">Bezpiecznie — bez podawania hasła</h3>
              <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                Wtyczka korzysta z Twojej zalogowanej sesji w przeglądarce. Nie przekazujesz hasła
                ani tokenów na nasz serwer.
              </p>
            </div>
          </div>
          <Link to="/auth">
            <Button size="lg">
              <Download className="mr-2 h-4 w-4" /> Pobierz panel
            </Button>
          </Link>
        </section>
      </main>

      <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground">
        Vinted Manager • Narzędzie niezależne, niezwiązane z Vinted UAB. Używasz na własną odpowiedzialność.
      </footer>
    </div>
  );
}

function Feature({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="surface-card p-6">
      <span className="mb-4 inline-grid h-10 w-10 place-items-center rounded-lg bg-primary/15 text-primary">
        {icon}
      </span>
      <h3 className="font-display text-lg font-semibold">{title}</h3>
      <p className="mt-2 text-sm text-muted-foreground">{desc}</p>
    </div>
  );
}
