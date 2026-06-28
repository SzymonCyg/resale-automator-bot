import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { authenticateDevice, corsHeaders } from "@/lib/extension-auth.server";

// Wtyczka pyta o sugerowaną odpowiedź na wiadomość — dopasowanie reguł server-side.
export const Route = createFileRoute("/api/public/extension/match-reply")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders() }),
      POST: async ({ request }) => {
        const auth = await authenticateDevice(request);
        if (!auth.ok) return auth.response;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const body = await request.json().catch(() => null);
        const parsed = z
          .object({
            accountId: z.string().uuid(),
            messageText: z.string().max(4000),
            username: z.string().optional(),
            itemTitle: z.string().optional(),
          })
          .safeParse(body);
        if (!parsed.success) {
          return new Response(JSON.stringify({ error: "invalid input" }), {
            status: 400,
            headers: corsHeaders(),
          });
        }

        const { data: rules } = await supabaseAdmin
          .from("reply_rules")
          .select("*")
          .eq("account_id", parsed.data.accountId)
          .eq("user_id", auth.userId)
          .eq("enabled", true)
          .order("priority", { ascending: false });

        const text = parsed.data.messageText.toLowerCase();
        let matched: { template: string; ruleId: string } | null = null;
        for (const r of rules ?? []) {
          const p = (r.pattern as string).toLowerCase();
          let hit = false;
          if (r.match_type === "contains") hit = text.includes(p);
          else if (r.match_type === "exact") hit = text.trim() === p;
          else if (r.match_type === "starts_with") hit = text.startsWith(p);
          else if (r.match_type === "regex") {
            try {
              hit = new RegExp(r.pattern, "i").test(parsed.data.messageText);
            } catch {
              hit = false;
            }
          }
          if (hit) {
            matched = { template: r.response_template, ruleId: r.id };
            break;
          }
        }

        let autoSend = false;
        if (!matched) {
          const { data: fb } = await supabaseAdmin
            .from("reply_fallback")
            .select("*")
            .eq("account_id", parsed.data.accountId)
            .eq("enabled", true)
            .maybeSingle();
          if (fb?.template) {
            matched = { template: fb.template, ruleId: "fallback" };
            autoSend = fb.auto_send;
          }
        }

        if (!matched) {
          return new Response(JSON.stringify({ reply: null }), {
            status: 200,
            headers: corsHeaders(),
          });
        }

        const reply = matched.template
          .replaceAll("{username}", parsed.data.username ?? "")
          .replaceAll("{item_title}", parsed.data.itemTitle ?? "");

        return new Response(JSON.stringify({ reply, ruleId: matched.ruleId, autoSend }), {
          status: 200,
          headers: corsHeaders(),
        });
      },
    },
  },
});
