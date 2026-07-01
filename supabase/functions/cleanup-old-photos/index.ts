import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const BUCKET = 'item-photos';
const MAX_AGE_DAYS = 90;
const BATCH = 100;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    // Get old objects from storage.objects
    const cutoff = new Date(Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000).toISOString();
    let deletedTotal = 0;
    const affectedItems = new Set<string>();

    while (true) {
      const { data: rows, error } = await admin
        .schema('storage' as any)
        .from('objects')
        .select('name')
        .eq('bucket_id', BUCKET)
        .lt('created_at', cutoff)
        .limit(BATCH);
      if (error) { console.warn('list error', error.message); break; }
      if (!rows || rows.length === 0) break;

      const paths = rows.map((r: any) => r.name).filter(Boolean);
      if (paths.length === 0) break;

      for (const p of paths) {
        const parts = String(p).split('/');
        if (parts.length >= 2) affectedItems.add(parts[1]);
      }

      const rm = await admin.storage.from(BUCKET).remove(paths);
      if (rm.error) { console.warn('remove error', rm.error.message); break; }
      deletedTotal += paths.length;
      if (paths.length < BATCH) break;
    }

    // For each affected vinted_item_id: if no more objects for it, clear photo_urls.
    let clearedItems = 0;
    for (const vid of affectedItems) {
      const { data: remaining } = await admin
        .schema('storage' as any)
        .from('objects')
        .select('name')
        .eq('bucket_id', BUCKET)
        .like('name', `%/${vid}/%`)
        .limit(1);
      if (!remaining || remaining.length === 0) {
        const { error: updErr } = await admin
          .from('vinted_items')
          .update({ photo_urls: [] })
          .eq('vinted_item_id', vid);
        if (!updErr) clearedItems++;
      }
    }

    return new Response(JSON.stringify({ deleted: deletedTotal, cleared_items: clearedItems }), {
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
