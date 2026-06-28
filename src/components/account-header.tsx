import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { Boxes, RefreshCw, MessageSquareReply, ScrollText } from "lucide-react";

type Account = {
  id: string;
  label: string;
  country: string;
  status: string;
} | null | undefined;

export function AccountHeader({
  account,
  active,
}: {
  account: Account;
  active: "items" | "auto-bump" | "auto-reply" | "logs";
}) {
  if (!account) return <div className="h-20 animate-pulse rounded-xl bg-surface" />;
  const tabs = [
    { id: "items", label: "Przedmioty", icon: Boxes, to: "/accounts/$accountId/items" },
    { id: "auto-bump", label: "Auto-bump", icon: RefreshCw, to: "/accounts/$accountId/auto-bump" },
    { id: "auto-reply", label: "Auto-odpowiedzi", icon: MessageSquareReply, to: "/accounts/$accountId/auto-reply" },
    { id: "logs", label: "Logi", icon: ScrollText, to: "/accounts/$accountId/logs" },
  ] as const;
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">{account.label}</h1>
          <p className="text-xs text-muted-foreground">
            vinted.{account.country} · status: {account.status}
          </p>
        </div>
      </div>
      <nav className="mt-4 flex gap-1 border-b border-border">
        {tabs.map((t) => {
          const Icon = t.icon;
          const isActive = t.id === active;
          return (
            <Link
              key={t.id}
              to={t.to}
              params={{ accountId: account.id }}
              className={cn(
                "flex items-center gap-2 border-b-2 px-3 pb-2 pt-1 text-sm transition-colors",
                isActive
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
