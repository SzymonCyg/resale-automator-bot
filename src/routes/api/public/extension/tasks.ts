import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { authenticateDevice, corsHeaders } from "@/lib/extension-auth.server";

export const Route = createFileRoute("/api/public/extension/tasks")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders() }),
      // GET — wtyczka pobiera listę pending tasks
      GET: async ({ request }) => {
        const auth = await authenticateDevice(request);
        if (!auth.ok) return auth.response;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const nowIso = new Date().toISOString();
        const { data, error } = await supabaseAdmin
          .from("tasks")
          .select("id,account_id,type,payload,scheduled_for,attempts")
          .eq("user_id", auth.userId)
          .eq("status", "pending")
          .lte("scheduled_for", nowIso)
          .order("scheduled_for", { ascending: true })
          .limit(20);
        if (error) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: corsHeaders(),
          });
        }

        // additionally pull bump schedules to enqueue new tasks
        const { data: bumps } = await supabaseAdmin
          .from("auto_bump_settings")
          .select("account_id,user_id,enabled,interval_hours,item_ids,bump_all,next_run_at")
          .eq("user_id", auth.userId)
          .eq("enabled", true);

        for (const b of bumps ?? []) {
          if (!b.next_run_at || new Date(b.next_run_at) > new Date()) continue;
          const itemIds = b.bump_all ? null : b.item_ids;
          await supabaseAdmin.from("tasks").insert({
            account_id: b.account_id,
            user_id: b.user_id,
            type: "bump",
            payload: { item_ids: itemIds, bump_all: b.bump_all },
            scheduled_for: nowIso,
          });
          await supabaseAdmin
            .from("auto_bump_settings")
            .update({
              next_run_at: new Date(Date.now() + b.interval_hours * 3600_000).toISOString(),
            })
            .eq("account_id", b.account_id);
        }

        return new Response(JSON.stringify({ tasks: data ?? [] }), {
          status: 200,
          headers: corsHeaders(),
        });
      },

      // POST — wtyczka zgłasza wynik zadania
      POST: async ({ request }) => {
        const auth = await authenticateDevice(request);
        if (!auth.ok) return auth.response;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const body = await request.json().catch(() => null);
        const parsed = z
          .object({
            taskId: z.string().uuid(),
            status: z.enum(["done", "error"]),
            result: z.unknown().optional(),
            message: z.string().max(500).optional(),
          })
          .safeParse(body);
        if (!parsed.success) {
          return new Response(JSON.stringify({ error: "invalid input" }), {
            status: 400,
            headers: corsHeaders(),
          });
        }

        const { data: task } = await supabaseAdmin
          .from("tasks")
          .select("id,user_id,account_id,type")
          .eq("id", parsed.data.taskId)
          .maybeSingle();
        if (!task || task.user_id !== auth.userId) {
          return new Response(JSON.stringify({ error: "forbidden" }), {
            status: 403,
            headers: corsHeaders(),
          });
        }

        await supabaseAdmin
          .from("tasks")
          .update({
            status: parsed.data.status,
            result: (parsed.data.result as object) ?? null,
            completed_at: new Date().toISOString(),
          })
          .eq("id", task.id);

        await supabaseAdmin.from("action_logs").insert({
          account_id: task.account_id,
          user_id: auth.userId,
          type: task.type,
          status: parsed.data.status === "done" ? "ok" : "error",
          message: parsed.data.message ?? null,
          payload: (parsed.data.result as object) ?? null,
        });

        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: corsHeaders(),
        });
      },
    },
  },
});
