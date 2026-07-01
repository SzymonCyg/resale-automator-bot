import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const BUCKET = 'item-photos';
const SIGNED_URL_TTL = 60 * 60 * 24 * 365 * 10; // 10 lat

function guessExt(url: string, contentType: string | null): string {
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('png')) return 'png';
  if (ct.includes('webp')) return 'webp';
  if (ct.includes('gif')) return 'gif';
  if (ct.includes('jpeg') || ct.includes('jpg')) return 'jpg';
  const m = url.split('?')[0].toLowerCase().match(/\.(jpg|jpeg|png|webp|gif)$/);
  if (m) return m[1] === 'jpeg' ? 'jpg' : m[1];
  return 'jpg';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      return new Response(JSON.stringify({ error: 'missing token' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data: userData, error: userErr } = await userClient.auth.getUser(token);
    if (userErr || !userData?.user?.id) {
      return new Response(JSON.stringify({ error: 'invalid token' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const userId = userData.user.id;

    const body = await req.json();
    const vintedItemId = String(body?.vinted_item_id || '').trim();
    const photoUrls: string[] = Array.isArray(body?.photo_urls) ? body.photo_urls.filter((u: unknown) => typeof u === 'string' && u) : [];
    if (!vintedItemId) {
      return new Response(JSON.stringify({ error: 'missing vinted_item_id' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const publicUrls: string[] = [];

    for (let i = 0; i < photoUrls.length; i++) {
      const src = photoUrls[i];
      try {
        const resp = await fetch(src);
        if (!resp.ok) { console.warn(`skip ${i}: HTTP ${resp.status}`); continue; }
        const ct = resp.headers.get('content-type');
        const ext = guessExt(src, ct);
        const bytes = new Uint8Array(await resp.arrayBuffer());
        const path = `${userId}/${vintedItemId}/${i}.${ext}`;
        const up = await admin.storage.from(BUCKET).upload(path, bytes, {
          contentType: ct || `image/${ext}`,
          upsert: true,
        });
        if (up.error) { console.warn(`upload ${i}:`, up.error.message); continue; }
        const signed = await admin.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL);
        if (signed.error || !signed.data?.signedUrl) { console.warn(`sign ${i}:`, signed.error?.message); continue; }
        publicUrls.push(signed.data.signedUrl);
      } catch (e) {
        console.warn(`fetch ${i} failed`, (e as Error).message);
      }
    }

    const { error: updErr } = await admin
      .from('vinted_items')
      .update({ photo_urls: publicUrls })
      .eq('vinted_item_id', vintedItemId)
      .eq('user_id', userId);
    if (updErr) console.warn('db update:', updErr.message);

    return new Response(JSON.stringify({ urls: publicUrls }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
