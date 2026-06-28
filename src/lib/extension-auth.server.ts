// Helpers for /api/public/extension/* routes. Server-only.
import { createHash, randomBytes } from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateToken(): string {
  return randomBytes(32).toString("hex");
}

export function corsHeaders(extra: Record<string, string> = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-Device-Token",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Content-Type": "application/json",
    ...extra,
  };
}

export async function authenticateDevice(request: Request): Promise<
  | { ok: true; userId: string; deviceId: string }
  | { ok: false; response: Response }
> {
  const token = request.headers.get("x-device-token");
  if (!token) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "missing token" }), {
        status: 401,
        headers: corsHeaders(),
      }),
    };
  }
  const tokenHash = hashToken(token);
  const { data, error } = await supabaseAdmin
    .from("extension_devices")
    .select("id,user_id")
    .eq("device_token_hash", tokenHash)
    .maybeSingle();
  if (error || !data) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "invalid token" }), {
        status: 401,
        headers: corsHeaders(),
      }),
    };
  }
  await supabaseAdmin
    .from("extension_devices")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", data.id);
  return { ok: true, userId: data.user_id, deviceId: data.id };
}
