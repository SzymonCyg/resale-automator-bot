import { useState, type ReactNode } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, LogOut, Menu, X, Sun, Moon, Settings } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { listAccounts } from "@/lib/vinted.functions";
import { useServerFn } from "@tanstack/react-start";
import { cn } from "@/lib/utils";
import { useTheme } from "@/hooks/use-theme";

export function AppLayout({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-screen bg-background text-foreground">
      <button
        onClick={() => setOpen(true)}
        className="fixed left-4 top-4 z-40 grid h-10 w-10 place-items-center rounded-lg border border-border bg-surface md:hidden"
        aria-label="Menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-64 border-r border-sidebar-border bg-sidebar p-4 transition-transform md:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full md:translate-x-0",
        )}
      >
        <div className="mb-6 flex items-center justify-between">
          <Link to="/dashboard" className="flex items-center gap-2 font-display font-semibold">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground">V</span>
            Vinted Manager
          </Link>
          <button onClick={() => setOpen(false)} className="md:hidden" aria-label="Zamknij">
            <X className="h-5 w-5" />
          </button>
        </div>
        <Sidebar onNavigate={() => setOpen(false)} />
      </aside>

      {open && (
        <div
          className="fixed inset-0 z-40 bg-background/60 backdrop-blur-sm md:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      <main className="md:pl-64">
        <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-10">{children}</div>
      </main>
    </div>
  );
}

function Sidebar({ onNavigate }: { onNavigate: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const list = useServerFn(listAccounts);
  const { data: accounts } = useQuery({ queryKey: ["accounts"], queryFn: () => list() });
  const path = useRouterState({ select: (s) => s.location.pathname });

  async function handleSignOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <nav className="flex h-[calc(100vh-6rem)] flex-col gap-1 overflow-y-auto pr-1">
      <Link
        to="/dashboard"
        onClick={onNavigate}
        className={cn(
          "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
          path === "/dashboard"
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-sidebar-foreground hover:bg-sidebar-accent/50",
        )}
      >
        <LayoutDashboard className="h-4 w-4" /> Dashboard
      </Link>

      <p className="mt-6 px-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        Konta Vinted
      </p>
      {accounts?.length === 0 && (
        <p className="px-3 py-2 text-xs text-muted-foreground">
          Brak kont. Wtyczka doda je automatycznie.
        </p>
      )}
      {accounts?.map((a) => {
        const base = `/accounts/${a.id}/items`;
        const isActive = path === base;
        return (
          <Link
            key={a.id}
            to="/accounts/$accountId/items"
            params={{ accountId: a.id }}
            onClick={onNavigate}
            className={cn(
              "flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm transition-colors",
              isActive
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground hover:bg-sidebar-accent/50",
            )}
          >
            <span className="truncate">{a.label}</span>
            <span className="text-[10px] uppercase text-muted-foreground">{a.country}</span>
          </Link>
        );
      })}

      <div className="mt-auto space-y-1">
        <ThemeToggle />
        <Button onClick={handleSignOut} variant="ghost" className="w-full justify-start" size="sm">
          <LogOut className="mr-2 h-4 w-4" /> Wyloguj
        </Button>
      </div>
    </nav>
  );
}

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";
  return (
    <button
      onClick={toggle}
      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent/50"
      aria-label="Przełącz motyw"
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      <span>{isDark ? "Jasny motyw" : "Ciemny motyw"}</span>
    </button>
  );
}
