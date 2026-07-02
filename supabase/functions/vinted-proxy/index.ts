// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authz = req.headers.get('Authorization');
    if (!authz) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authz } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const {
      method = 'GET',
      path,
      headers: extraHeaders = {},
      body: requestBody,
      isUpload = false,
      uploadData,
      domain: preferredDomain,
    } = body || {};

    if (!path) {
      return new Response(JSON.stringify({ error: 'Missing path' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let query = supabase.from('vinted_tokens').select('*').eq('user_id', user.id);
    if (preferredDomain) query = query.eq('vinted_domain', preferredDomain);
    const { data: tokens, error: tokenError } = await query
      .order('updated_at', { ascending: false })
      .limit(1);
    const tokenRow = tokens?.[0];

    if (tokenError || !tokenRow) {
      return new Response(JSON.stringify({
        error: 'NO_VINTED_TOKEN',
        message: 'Nie połączono konta Vinted. Zaloguj się przez wtyczkę lub wklej token w ustawieniach.',
      }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const domain = tokenRow.vinted_domain || 'vinted.pl';
    const baseUrl = `https://www.${domain}`;
    const url = path.startsWith('http') ? path : `${baseUrl}${path}`;

    function buildHeaders(token: string): Record<string, string> {
      return {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'pl-PL,pl;q=0.9,en;q=0.8',
        'Referer': baseUrl + '/',
        'Origin': baseUrl,
        ...extraHeaders,
      };
    }

    function buildBody(hdrs: Record<string, string>): BodyInit | undefined {
      if (isUpload && uploadData) {
        const dataUrl: string = uploadData.dataUrl || '';
        const base64 = dataUrl.split(',')[1] || '';
        const mimeType = (dataUrl.split(';')[0].split(':')[1]) || 'image/jpeg';
        const binaryStr = atob(base64);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
        const blob = new Blob([bytes], { type: mimeType });
        const form = new FormData();
        form.append('photo[type]', 'item');
        form.append('photo[file]', blob, uploadData.filename || `photo-${Date.now()}.jpg`);
        form.append('photo[temp_uuid]', uploadData.tempUuid || crypto.randomUUID());
        delete hdrs['Content-Type'];
        return form;
      }
      if (requestBody != null) {
        hdrs['Content-Type'] = hdrs['Content-Type'] || 'application/json';
        return typeof requestBody === 'string' ? requestBody : JSON.stringify(requestBody);
      }
      return undefined;
    }

    let headers = buildHeaders(tokenRow.access_token);
    let fetchBody = buildBody(headers);
    let resp = await fetch(url, { method, headers, body: fetchBody });

    if (resp.status === 401 && tokenRow.refresh_token) {
      try {
        const refreshRes = await fetch(`${baseUrl}/api/v2/oauth/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            grant_type: 'refresh_token',
            refresh_token: tokenRow.refresh_token,
            client_id: 'web',
          }),
        });
        if (refreshRes.ok) {
          const rd: any = await refreshRes.json();
          if (rd.access_token) {
            await supabase.from('vinted_tokens').update({
              access_token: rd.access_token,
              refresh_token: rd.refresh_token || tokenRow.refresh_token,
              expires_at: rd.expires_in ? new Date(Date.now() + rd.expires_in * 1000).toISOString() : null,
              updated_at: new Date().toISOString(),
            }).eq('id', tokenRow.id);
            headers = buildHeaders(rd.access_token);
            fetchBody = buildBody(headers);
            resp = await fetch(url, { method, headers, body: fetchBody });
          }
        }
      } catch (e) {
        console.error('Token refresh failed:', e);
      }
    }

    const text = await resp.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not json */ }

    return new Response(JSON.stringify({
      ok: resp.ok,
      status: resp.status,
      json,
      text,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error: any) {
    return new Response(JSON.stringify({ error: error?.message || String(error) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
