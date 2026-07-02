// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

async function vintedRequest(tokenRow: any, path: string, method = 'GET', body?: any) {
  const domain = tokenRow.vinted_domain || 'vinted.pl';
  const baseUrl = `https://www.${domain}`;
  const url = path.startsWith('http') ? path : `${baseUrl}${path}`;
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${tokenRow.access_token}`,
    'Accept': 'application/json, text/plain, */*',
    'User-Agent': tokenRow.user_agent || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept-Language': 'pl-PL,pl;q=0.9',
    'Referer': baseUrl + '/',
    'Origin': baseUrl,
    ...(body ? { 'Content-Type': 'application/json' } : {}),
  };
  let resp = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });

  if (resp.status === 401 && tokenRow.refresh_token) {
    const refreshRes = await fetch(`${baseUrl}/api/v2/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: tokenRow.refresh_token, client_id: 'web' }),
    });
    if (refreshRes.ok) {
      const rd: any = await refreshRes.json();
      if (rd.access_token) {
        await supabaseAdmin.from('vinted_tokens').update({
          access_token: rd.access_token,
          refresh_token: rd.refresh_token || tokenRow.refresh_token,
          updated_at: new Date().toISOString(),
        }).eq('id', tokenRow.id);
        tokenRow.access_token = rd.access_token;
        headers['Authorization'] = `Bearer ${rd.access_token}`;
        resp = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
      }
    }
  }
  const text = await resp.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /**/ }
  return { ok: resp.ok, status: resp.status, json, text };
}

async function getToken(accountId: string) {
  const { data: account } = await supabaseAdmin.from('vinted_accounts').select('*').eq('id', accountId).single();
  if (!account) throw new Error('Konto nie znalezione');
  const { data: tokens } = await supabaseAdmin.from('vinted_tokens')
    .select('*').eq('user_id', account.user_id).eq('vinted_domain', `vinted.${account.country}`)
    .order('updated_at', { ascending: false }).limit(1);
  if (!tokens?.[0]) throw new Error('Brak tokenu Vinted');
  return { account, tokenRow: tokens[0] };
}

async function logAction(userId: string, accountId: string, type: string, status: string, message: string, itemId?: string) {
  await supabaseAdmin.from('action_logs').insert({ user_id: userId, account_id: accountId, type, status, message, item_id: itemId || null });
}

async function runTask(task: any): Promise<{ ok: boolean; result?: any; error?: string }> {
  const { account, tokenRow } = await getToken(task.account_id);
  const payload = task.payload || {};

  switch (task.type) {
    case 'bump_item': {
      const itemRes = await vintedRequest(tokenRow, `/api/v2/items/${payload.vinted_item_id}`);
      if (!itemRes.ok) return { ok: false, error: `Nie można pobrać ogłoszenia: ${itemRes.status}` };
      const item = itemRes.json?.item;
      if (!item) return { ok: false, error: 'Pusta odpowiedź dla ogłoszenia' };

      const createRes = await vintedRequest(tokenRow, '/api/v2/items', 'POST', {
        item: {
          title: item.title,
          description: item.description,
          price: item.price,
          currency: item.currency,
          category_id: item.category_id,
          brand_id: item.brand_id,
          size_id: item.size_id,
          status_id: item.status_id,
          photo_ids: item.photos?.map((p: any) => p.id) || [],
          is_visible: 1,
        }
      });
      if (!createRes.ok) return { ok: false, error: `Błąd tworzenia: ${createRes.status}` };
      const newId = createRes.json?.item?.id;

      await vintedRequest(tokenRow, `/api/v2/items/${payload.vinted_item_id}`, 'DELETE');

      await supabaseAdmin.from('vinted_items').update({
        vinted_item_id: String(newId),
        last_bumped_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', payload.item_id);

      await logAction(account.user_id, task.account_id, 'bump', 'ok', `Odświeżono: ${item.title} → nowy ID ${newId}`, payload.item_id);
      return { ok: true, result: { newId } };
    }

    case 'delete_item': {
      const r = await vintedRequest(tokenRow, `/api/v2/items/${payload.vinted_item_id}`, 'DELETE');
      if (!r.ok && r.status !== 404) return { ok: false, error: `Błąd usuwania: ${r.status}` };
      if (payload.item_id) await supabaseAdmin.from('vinted_items').delete().eq('id', payload.item_id);
      await logAction(account.user_id, task.account_id, 'delete', 'ok', `Usunięto: ${payload.title || payload.vinted_item_id}`, payload.item_id);
      return { ok: true };
    }

    case 'send_like_reply': {
      const convRes = await vintedRequest(tokenRow, '/api/v2/conversations', 'POST', {
        conversation: { item_id: payload.item_id, opposite_user_id: payload.user_id, initiator: 'seller_enters_notification' }
      });
      if (!convRes.ok) return { ok: false, error: `Błąd konwersacji: ${convRes.status}` };
      const conv = convRes.json?.conversation;
      if (!conv?.id) return { ok: false, error: 'Brak ID konwersacji' };

      if (conv.messages?.length > 0) return { ok: true, result: { skipped: true, reason: 'already_messaged' } };

      if (payload.discount_enabled && payload.discount_amount && conv.item?.price) {
        const origPrice = parseFloat(conv.item.price);
        const discPrice = payload.discount_unit === '%'
          ? Math.max(1, origPrice * (1 - payload.discount_amount / 100))
          : Math.max(1, origPrice - payload.discount_amount);
        await vintedRequest(tokenRow, `/api/v2/items/${payload.item_id}/offers`, 'POST', {
          offer: { price: discPrice.toFixed(2), currency: conv.item.currency || 'PLN' }
        });
      }

      const msg = (payload.template || 'Cześć @username!').replace('@username', payload.login || 'Użytkowniku');
      const msgRes = await vintedRequest(tokenRow, `/api/v2/conversations/${conv.id}/messages`, 'POST', {
        message: { body: msg }
      });
      if (!msgRes.ok) return { ok: false, error: `Błąd wiadomości: ${msgRes.status}` };

      await logAction(account.user_id, task.account_id, 'like_reply', 'ok', `Odpowiedziano na polubienie od @${payload.login}: "${msg.slice(0, 60)}"`);
      return { ok: true };
    }

    default:
      return { ok: false, error: `Nieznany typ: ${task.type}` };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const now = new Date().toISOString();
    const { data: tasks } = await supabaseAdmin.from('tasks')
      .select('*').eq('status', 'pending').lte('scheduled_for', now)
      .order('scheduled_for', { ascending: true }).limit(20);

    if (!tasks?.length) return new Response(JSON.stringify({ ok: true, processed: 0 }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

    let processed = 0, errors = 0;
    for (const task of tasks) {
      await supabaseAdmin.from('tasks').update({ status: 'running', attempts: (task.attempts || 0) + 1 }).eq('id', task.id);
      try {
        const result = await runTask(task);
        await supabaseAdmin.from('tasks').update({
          status: result.ok ? 'done' : 'failed',
          result,
          completed_at: new Date().toISOString(),
        }).eq('id', task.id);
        if (result.ok) processed++; else errors++;
      } catch (e: any) {
        await supabaseAdmin.from('tasks').update({
          status: (task.attempts || 0) >= 3 ? 'failed' : 'pending',
          result: { error: e?.message || String(e) },
          scheduled_for: new Date(Date.now() + 60000).toISOString(),
        }).eq('id', task.id);
        errors++;
      }
    }
    return new Response(JSON.stringify({ ok: true, processed, errors }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
