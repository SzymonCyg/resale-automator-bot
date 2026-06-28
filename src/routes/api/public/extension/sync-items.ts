import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { authenticateDevice, corsHeaders } from "@/lib/extension-auth.server";

const itemSchema = z.object({
  vinted_item_id: z.string(),
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  price: z.number().nullable().optional(),
  currency: z.string().nullable().optional(),
  brand: z.string().nullable().optional(),
  size_title: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  photo_url: z.string().nullable().optional(),
  views: z.number().nullable().optional(),
  favourite_count: z.number().nullable().optional(),
  created_at_vinted: z.string().nullable().optional(),
  raw: z.unknown().optional(),
});

export const Route = createFileRoute("/api/public/extension/sync-items")({
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
            vintedUserId: z.string().optional(),
            vintedUsername: z.string().optional(),
            items: z.array(itemSchema).max(500),
          })
          .safeParse(body);
        if (!parsed.success) {
          return new Response(JSON.stringify({ error: "invalid input" }), {
            status: 400,
            headers: corsHeaders(),
          });
        }

        // verify account ownership
        const { data: acc } = await supabaseAdmin
          .from("vinted_accounts")
          .select("id,user_id")
          .eq("id", parsed.data.accountId)
          .maybeSingle();
        if (!acc || acc.user_id !== auth.userId) {
          return new Response(JSON.stringify({ error: "forbidden" }), {
            status: 403,
            headers: corsHeaders(),
          });
        }

        const rows = parsed.data.items.map((it) => ({
          account_id: parsed.data.accountId,
          user_id: auth.userId,
          vinted_item_id: it.vinted_item_id,
          title: it.title ?? null,
          description: it.description ?? null,
          price: it.price ?? null,
          currency: it.currency ?? null,
          brand: it.brand ?? null,
          size_title: it.size_title ?? null,
          status: it.status ?? null,
          url: it.url ?? null,
          photo_url: it.photo_url ?? null,
          views: it.views ?? 0,
          favourite_count: it.favourite_count ?? 0,
          created_at_vinted: it.created_at_vinted ?? null,
          raw: it.raw ?? null,
        }));

        if (rows.length > 0) {
          const { error } = await supabaseAdmin
            .from("vinted_items")
            .upsert(rows, { onConflict: "account_id,vinted_item_id" });
          if (error) {
            return new Response(JSON.stringify({ error: error.message }), {
              status: 500,
              headers: corsHeaders(),
            });
          }
        }

        await supabaseAdmin
          .from("vinted_accounts")
          .update({
            last_sync_at: new Date().toISOString(),
            status: "active",
            vinted_user_id: parsed.data.vintedUserId ?? null,
            vinted_username: parsed.data.vintedUsername ?? null,
          })
          .eq("id", parsed.data.accountId);

        await supabaseAdmin.from("action_logs").insert({
          account_id: parsed.data.accountId,
          user_id: auth.userId,
          type: "sync",
          status: "ok",
          message: `Zsynchronizowano ${rows.length} przedmiotów`,
        });

        return new Response(JSON.stringify({ ok: true, count: rows.length }), {
          status: 200,
          headers: corsHeaders(),
        });
      },
    },
  },
});
