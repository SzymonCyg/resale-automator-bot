import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

export interface VintedProxyOpts {
  method?: string;
  path: string;
  body?: unknown;
  isUpload?: boolean;
  uploadData?: { dataUrl: string; filename: string; tempUuid: string };
  domain?: string;
}

export interface VintedProxyResult {
  ok: boolean;
  status: number;
  json: unknown;
  text: string;
}

export async function vintedProxy(opts: VintedProxyOpts): Promise<VintedProxyResult> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Nie zalogowano w panelu");

  const res = await fetch(`${SUPABASE_URL}/functions/v1/vinted-proxy`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      apikey: SUPABASE_ANON,
    },
    body: JSON.stringify({
      method: opts.method || "GET",
      path: opts.path,
      body: opts.body,
      isUpload: opts.isUpload || false,
      uploadData: opts.uploadData,
      domain: opts.domain,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    if (err.error === "NO_VINTED_TOKEN") throw new Error("NO_VINTED_TOKEN");
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function vintedApi<T = unknown>(
  path: string,
  init?: { method?: string; body?: unknown; domain?: string },
): Promise<T> {
  const r = await vintedProxy({
    method: init?.method || "GET",
    path,
    body: init?.body,
    domain: init?.domain,
  });
  if (!r.ok) throw new Error(`Vinted ${r.status}: ${(r.text || "").slice(0, 200)}`);
  return r.json as T;
}

export async function saveVintedToken(payload: {
  access_token: string;
  refresh_token?: string | null;
  vinted_user_id: string;
  vinted_username?: string;
  vinted_domain?: string;
}): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Nie zalogowano w panelu");
  const res = await fetch(`${SUPABASE_URL}/functions/v1/save-vinted-token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      apikey: SUPABASE_ANON,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
}
