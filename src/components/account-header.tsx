type Account = {
  id: string;
  label: string;
  country: string;
  status: string;
  vinted_username?: string | null;
} | null | undefined;

export function AccountHeader({ account }: { account: Account }) {
  if (!account) return <div className="h-16 animate-pulse rounded-xl bg-surface" />;
  return (
    <div>
      <h1 className="font-display text-2xl font-semibold">{account.label}</h1>
      <p className="text-xs text-muted-foreground">
        vinted.{account.country}
        {account.vinted_username ? ` · @${account.vinted_username}` : ""} · status: {account.status}
      </p>
    </div>
  );
}
