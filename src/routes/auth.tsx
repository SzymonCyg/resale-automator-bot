import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Zaloguj się — Vinted Manager" },
      { name: "description", content: "Zaloguj się do panelu Vinted Manager." },
    ],
  }),
  validateSearch: z.object({ next: z.string().optional() }),
  component: AuthPage,
});

function safeNext(next?: string) {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/auth")) {
    return "/dashboard";
  }
  return next;
}

function AuthPage() {
  const navigate = useNavigate();
  const { next } = Route.useSearch();
  const nextTarget = safeNext(next);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  function goNext() {
    if (nextTarget === "/dashboard") navigate({ to: "/dashboard", replace: true });
    else window.location.assign(nextTarget);
  }

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) goNext();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate, nextTarget]);

  async function handleEmailSignIn(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) return toast.error(error.message);
    goNext();
  }

  async function handleEmailSignUp(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin + nextTarget },
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Konto utworzone. Sprawdź email aby potwierdzić.");
  }

  async function handleGoogle() {
    setLoading(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: `${window.location.origin}/auth?next=${encodeURIComponent(nextTarget)}`,
    });
    if (result.error) {
      setLoading(false);
      return toast.error(String(result.error));
    }
    if (result.redirected) return;
    goNext();
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between bg-surface p-12 lg:flex">
        <Link to="/" className="flex items-center gap-2 font-display text-lg font-semibold">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground glow">
            V
          </span>
          Vinted Manager
        </Link>
        <div>
          <p className="font-display text-3xl leading-snug">
            "Wystawiam 80 przedmiotów. Auto-bump i auto-odpowiedzi w&nbsp;tle robią to, na co nie
            mam już cierpliwości."
          </p>
          <p className="mt-4 text-sm text-muted-foreground">— sprzedawczyni z Krakowa</p>
        </div>
        <div className="absolute -right-32 top-1/4 h-96 w-96 rounded-full bg-primary/20 blur-3xl" />
      </div>

      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <h1 className="font-display text-2xl font-semibold">Witaj z powrotem</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Zaloguj się aby zarządzać swoimi kontami Vinted.
          </p>

          <Button
            onClick={handleGoogle}
            disabled={loading}
            variant="outline"
            className="mt-6 w-full"
            type="button"
          >
            <GoogleIcon className="mr-2 h-4 w-4" /> Kontynuuj z Google
          </Button>

          <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            albo emailem
            <span className="h-px flex-1 bg-border" />
          </div>

          <Tabs defaultValue="signin">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">Logowanie</TabsTrigger>
              <TabsTrigger value="signup">Rejestracja</TabsTrigger>
            </TabsList>
            <TabsContent value="signin">
              <form onSubmit={handleEmailSignIn} className="mt-4 space-y-3">
                <Field label="Email" id="email-in" type="email" value={email} onChange={setEmail} />
                <Field label="Hasło" id="pwd-in" type="password" value={password} onChange={setPassword} />
                <Button type="submit" disabled={loading} className="w-full">
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Zaloguj się
                </Button>
              </form>
            </TabsContent>
            <TabsContent value="signup">
              <form onSubmit={handleEmailSignUp} className="mt-4 space-y-3">
                <Field label="Email" id="email-up" type="email" value={email} onChange={setEmail} />
                <Field
                  label="Hasło (min. 6 znaków)"
                  id="pwd-up"
                  type="password"
                  value={password}
                  onChange={setPassword}
                />
                <Button type="submit" disabled={loading} className="w-full">
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Utwórz konto
                </Button>
              </form>
            </TabsContent>
          </Tabs>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            <Link to="/" className="hover:text-foreground">
              ← wróć do strony głównej
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  id,
  type,
  value,
  onChange,
}: {
  label: string;
  id: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type={type} value={value} onChange={(e) => onChange(e.target.value)} required />
    </div>
  );
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        fill="#EA4335"
        d="M12 10.2v3.9h5.5c-.2 1.4-1.6 4-5.5 4-3.3 0-6-2.7-6-6.1S8.7 6 12 6c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.5 14.6 2.5 12 2.5 6.8 2.5 2.6 6.7 2.6 12s4.2 9.5 9.4 9.5c5.4 0 9-3.8 9-9.2 0-.6-.1-1.1-.2-1.6H12z"
      />
    </svg>
  );
}
