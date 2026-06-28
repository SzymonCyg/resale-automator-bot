import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { authenticateRequest, corsHeaders } from "@/lib/extension-auth.server";

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
});

export const Route = createFileRoute("/api/public/extension/sync-items")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders() }),
      POST: async ({ request }) => {
        const auth = await authenticateRequest(request);
        if (!auth.ok) return auth.response;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const body = await request.json().catch(() => null);
        const parsed = z
          .object({
            vintedUserId: z.string(),
            vintedUsername: z.string(),
            country: z.string().min(2).max(8),
            items: z.array(itemSchema).max(500),
          })
          .safeParse(body);
        if (!parsed.success) {
          return new Response(JSON.stringify({ error: "invalid input" }), {
            status: 400,
            headers: corsHeaders(),
          });
        }

        // Upsert konta po (user_id, vinted_username)
        const { data: existing } = await supabaseAdmin
          .from("vinted_accounts")
          .select("id")
          .eq("user_id", auth.userId)
          .eq("vinted_username", parsed.data.vintedUsername)
          .maybeSingle();

        let accountId = existing?.id;
        if (!accountId) {
          const { data: created, error: createErr } = await supabaseAdmin
            .from("vinted_accounts")
            .insert({
              user_id: auth.userId,
              label: parsed.data.vintedUsername,
              country: parsed.data.country,
              vinted_username: parsed.data.vintedUsername,
              vinted_user_id: parsed.data.vintedUserId,
              status: "active",
              last_sync_at: new Date().toISOString(),
            })
            .select("id")
            .single();
          if (createErr || !created) {
            return new Response(JSON.stringify({ error: createErr?.message ?? "create failed" }), {
              status: 500,
              headers: corsHeaders(),
            });
          }
          accountId = created.id;
        } else {
          await supabaseAdmin
            .from("vinted_accounts")
            .update({
              last_sync_at: new Date().toISOString(),
              status: "active",
              vinted_user_id: parsed.data.vintedUserId,
              country: parsed.data.country,
            })
            .eq("id", accountId);
        }

        const rows = parsed.data.items.map((it) => ({
          account_id: accountId!,
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

        return new Response(
          JSON.stringify({ ok: true, accountId, count: rows.length }),
          { status: 200, headers: corsHeaders() },
        );
      },
    },
  },
});
