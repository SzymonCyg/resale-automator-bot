import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getAccount, listLogs } from "@/lib/vinted.functions";
import { AccountHeader } from "@/components/account-header";
import { formatDistanceToNow } from "date-fns";
import { pl } from "date-fns/locale";

export const Route = createFileRoute("/_authenticated/accounts/$accountId/logs")({
  head: () => ({ meta: [{ title: "Logi — Vinted Manager" }] }),
  component: LogsPage,
});

function LogsPage() {
  const { accountId } = Route.useParams();
  const getA = useServerFn(getAccount);
  const list = useServerFn(listLogs);
  const accountQ = useQuery({ queryKey: ["account", accountId], queryFn: () => getA({ data: { accountId } }) });
  const logsQ = useQuery({ queryKey: ["logs", accountId], queryFn: () => list({ data: { accountId, limit: 200 } }) });

  return (
    <div className="space-y-6">
      <AccountHeader account={accountQ.data} active="logs" />

      <div className="surface-card overflow-hidden">
        {logsQ.data?.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            Brak logów. Akcje pojawią się tutaj automatycznie.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface-2 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Czas</th>
                <th className="px-4 py-3">Typ</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Wiadomość</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {logsQ.data?.map((l) => (
                <tr key={l.id}>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(l.created_at), { locale: pl, addSuffix: true })}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs uppercase">{l.type}</td>
                  <td className="px-4 py-2">
                    <span
                      className={
                        "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase " +
                        (l.status === "error"
                          ? "bg-destructive/15 text-destructive"
                          : l.status === "ok"
                            ? "bg-success/15 text-success"
                            : "bg-muted text-muted-foreground")
                      }
                    >
                      {l.status}
                    </span>
                  </td>
                  <td className="px-4 py-2">{l.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
