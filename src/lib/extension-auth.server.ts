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
    "Access-Control-Allow-Headers": "Content-Type, X-Device-Token, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Content-Type": "application/json",
    ...extra,
  };
}

type AuthResult =
  | { ok: true; userId: string; deviceId: string | null; via: "device" | "jwt" }
  | { ok: false; response: Response };

/**
 * Authenticate the extension request. Accepts EITHER:
 *  - `Authorization: Bearer <supabase_jwt>`  (preferred — Google login flow)
 *  - `X-Device-Token: <token>`               (legacy pairing-code flow)
 */
export async function authenticateDevice(request: Request): Promise<AuthResult> {
  const authz = request.headers.get("authorization");
  if (authz?.startsWith("Bearer ")) {
    const jwt = authz.slice(7).trim();
    if (jwt.split(".").length === 3) {
      const { data, error } = await supabaseAdmin.auth.getUser(jwt);
      if (!error && data?.user?.id) {
        return { ok: true, userId: data.user.id, deviceId: null, via: "jwt" };
      }
    }
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "invalid jwt" }), {
        status: 401,
        headers: corsHeaders(),
      }),
    };
  }

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
  return { ok: true, userId: data.user_id, deviceId: data.id, via: "device" };
}
