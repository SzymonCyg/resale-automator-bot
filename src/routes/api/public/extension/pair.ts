import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { corsHeaders, generateToken, hashToken } from "@/lib/extension-auth.server";

export const Route = createFileRoute("/api/public/extension/pair")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders() }),
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        let body: { code?: string; label?: string; userAgent?: string };
        try {
          body = await request.json();
        } catch {
          return new Response(JSON.stringify({ error: "invalid json" }), {
            status: 400,
            headers: corsHeaders(),
          });
        }
        const parsed = z
          .object({
            code: z.string().min(4).max(16),
            label: z.string().max(120).optional(),
            userAgent: z.string().max(500).optional(),
          })
          .safeParse(body);
        if (!parsed.success) {
          return new Response(JSON.stringify({ error: "invalid input" }), {
            status: 400,
            headers: corsHeaders(),
          });
        }

        const { data: pc, error } = await supabaseAdmin
          .from("pairing_codes")
          .select("*")
          .eq("code", parsed.data.code.toUpperCase())
          .maybeSingle();

        if (error || !pc) {
          return new Response(JSON.stringify({ error: "invalid code" }), {
            status: 404,
            headers: corsHeaders(),
          });
        }
        if (pc.used_at) {
          return new Response(JSON.stringify({ error: "code already used" }), {
            status: 410,
            headers: corsHeaders(),
          });
        }
        if (new Date(pc.expires_at) < new Date()) {
          return new Response(JSON.stringify({ error: "code expired" }), {
            status: 410,
            headers: corsHeaders(),
          });
        }

        const token = generateToken();
        const { data: device, error: devErr } = await supabaseAdmin
          .from("extension_devices")
          .insert({
            user_id: pc.user_id,
            device_token_hash: hashToken(token),
            label: parsed.data.label ?? "Wtyczka Chrome",
            user_agent: parsed.data.userAgent ?? null,
            last_seen_at: new Date().toISOString(),
          })
          .select()
          .single();
        if (devErr) {
          return new Response(JSON.stringify({ error: devErr.message }), {
            status: 500,
            headers: corsHeaders(),
          });
        }

        await supabaseAdmin
          .from("pairing_codes")
          .update({ used_at: new Date().toISOString() })
          .eq("code", pc.code);

        return new Response(
          JSON.stringify({ deviceToken: token, deviceId: device.id }),
          { status: 200, headers: corsHeaders() },
        );
      },
    },
  },
});
