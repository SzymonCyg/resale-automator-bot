import { useState, type ReactNode } from "react";
import { Link, useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Boxes,
  RefreshCw,
  MessageSquareReply,
  ScrollText,
  Download,
  LogOut,
  Menu,
  X,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { listAccounts } from "@/lib/vinted.functions";
import { useServerFn } from "@tanstack/react-start";
import { cn } from "@/lib/utils";

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
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground">
              V
            </span>
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
  const router = useRouter();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const list = useServerFn(listAccounts);
  const { data: accounts } = useQuery({
    queryKey: ["accounts"],
    queryFn: () => list(),
  });
  const path = useRouterState({ select: (s) => s.location.pathname });

  async function handleSignOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <nav className="flex h-[calc(100vh-6rem)] flex-col gap-1 overflow-y-auto pr-1">
      <NavItem to="/dashboard" icon={<LayoutDashboard className="h-4 w-4" />} active={path === "/dashboard"} onNavigate={onNavigate}>
        Dashboard
      </NavItem>
      <NavItem to="/download-extension" icon={<Download className="h-4 w-4" />} active={path === "/download-extension"} onNavigate={onNavigate}>
        Wtyczka Chrome
      </NavItem>

      <p className="mt-6 px-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        Konta Vinted
      </p>
      {accounts?.length === 0 && (
        <p className="px-3 py-2 text-xs text-muted-foreground">
          Brak kont. Dodaj w panelu Dashboard.
        </p>
      )}
      {accounts?.map((a) => {
        const base = `/accounts/${a.id}`;
        const isActive = path.startsWith(base);
        return (
          <div key={a.id} className="mb-1">
            <Link
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
            {isActive && (
              <div className="mt-1 ml-3 flex flex-col gap-0.5 border-l border-sidebar-border pl-3">
                <SubLink to="/accounts/$accountId/items" params={{ accountId: a.id }} icon={<Boxes className="h-3.5 w-3.5" />} active={path === `${base}/items`} onNavigate={onNavigate}>
                  Przedmioty
                </SubLink>
                <SubLink to="/accounts/$accountId/auto-bump" params={{ accountId: a.id }} icon={<RefreshCw className="h-3.5 w-3.5" />} active={path === `${base}/auto-bump`} onNavigate={onNavigate}>
                  Auto-bump
                </SubLink>
                <SubLink to="/accounts/$accountId/auto-reply" params={{ accountId: a.id }} icon={<MessageSquareReply className="h-3.5 w-3.5" />} active={path === `${base}/auto-reply`} onNavigate={onNavigate}>
                  Auto-odpowiedzi
                </SubLink>
                <SubLink to="/accounts/$accountId/logs" params={{ accountId: a.id }} icon={<ScrollText className="h-3.5 w-3.5" />} active={path === `${base}/logs`} onNavigate={onNavigate}>
                  Logi
                </SubLink>
              </div>
            )}
          </div>
        );
      })}

      <div className="mt-auto">
        <Button onClick={handleSignOut} variant="ghost" className="w-full justify-start" size="sm">
          <LogOut className="mr-2 h-4 w-4" /> Wyloguj
        </Button>
      </div>
    </nav>
  );
}

function NavItem({
  to,
  icon,
  children,
  active,
  onNavigate,
}: {
  to: string;
  icon: ReactNode;
  children: ReactNode;
  active: boolean;
  onNavigate: () => void;
}) {
  return (
    <Link
      to={to}
      onClick={onNavigate}
      className={cn(
        "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground hover:bg-sidebar-accent/50",
      )}
    >
      {icon} {children}
    </Link>
  );
}

function SubLink({
  to,
  params,
  icon,
  children,
  active,
  onNavigate,
}: {
  to: "/accounts/$accountId/items" | "/accounts/$accountId/auto-bump" | "/accounts/$accountId/auto-reply" | "/accounts/$accountId/logs";
  params: { accountId: string };
  icon: ReactNode;
  children: ReactNode;
  active: boolean;
  onNavigate: () => void;
}) {
  return (
    <Link
      to={to}
      params={params}
      onClick={onNavigate}
      className={cn(
        "flex items-center gap-2 rounded px-2 py-1 text-xs transition-colors",
        active ? "text-primary" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {icon} {children}
    </Link>
  );
}
