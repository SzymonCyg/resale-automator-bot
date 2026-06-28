// Helpers for /api/public/extension/* routes. Server-only.
// Autoryzacja wyłącznie przez Supabase JWT (logowanie Google w panelu).
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export function corsHeaders(extra: Record<string, string> = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Content-Type": "application/json",
    ...extra,
  };
}

type AuthResult =
  | { ok: true; userId: string }
  | { ok: false; response: Response };

export async function authenticateRequest(request: Request): Promise<AuthResult> {
  const authz = request.headers.get("authorization");
  if (!authz?.startsWith("Bearer ")) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "missing bearer token" }), {
        status: 401,
        headers: corsHeaders(),
      }),
    };
  }
  const jwt = authz.slice(7).trim();
  if (jwt.split(".").length !== 3) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "invalid jwt" }), {
        status: 401,
        headers: corsHeaders(),
      }),
    };
  }
  const { data, error } = await supabaseAdmin.auth.getUser(jwt);
  if (error || !data?.user?.id) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "invalid jwt" }), {
        status: 401,
        headers: corsHeaders(),
      }),
    };
  }
  return { ok: true, userId: data.user.id };
}
