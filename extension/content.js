// Content script — działa na vinted.*, używa sesji zalogowanego użytkownika.
(async () => {
  const host = location.hostname.replace(/^www\./, "");
  const country = host.split(".").pop();

  async function vintedApi(path, init = {}) {
    const csrf = document.querySelector('meta[name="csrf-token"]')?.content;
    const res = await fetch(`https://${host}${path}`, {
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-CSRF-Token": csrf || "",
        ...(init.headers || {}),
      },
      ...init,
    });
    if (!res.ok) throw new Error(`Vinted ${res.status}: ${await res.text().catch(() => "")}`);
    return res.json();
  }

  async function vintedRaw(path, init = {}) {
    const csrf = document.querySelector('meta[name="csrf-token"]')?.content;
    return fetch(`https://${host}${path}`, {
      credentials: "include",
      headers: { "X-CSRF-Token": csrf || "", ...(init.headers || {}) },
      ...init,
    });
  }

  async function getMe() {
    const me = await vintedApi("/api/v2/users/current");
    return me?.user;
  }

  async function fetchMyItems() {
    const me = await getMe();
    if (!me) throw new Error("Niezalogowany");
    const items = await vintedApi(`/api/v2/users/${me.id}/items?per_page=200`);
    const list = (items?.items ?? []).map((it) => ({
      id: it.id,
      title: it.title,
      brand: it.brand_title,
      size_title: it.size_title,
      price: Number(it.price?.amount ?? it.price ?? 0),
      currency: it.price?.currency_code ?? it.currency,
      status: it.status,
      url: it.url,
      photo_url: it.photo?.url ?? it.photos?.[0]?.url ?? null,
      views: it.view_count ?? 0,
      favourite_count: it.favourite_count ?? 0,
    }));
    return { username: me.login, userId: me.id, items: list };
  }

  async function fetchItemDetail(id) {
    const r = await vintedApi(`/api/v2/items/${id}`);
    return r?.item || null;
  }

  // Próba ponownego wystawienia: 1) upload zdjęć, 2) draft item, 3) publish, 4) usuń stary.
  // Endpointy Vinted bywają zmienne — funkcja best-effort z logiem.
  async function uploadPhotoDataUrl(dataUrl) {
    const blob = await (await fetch(dataUrl)).blob();
    const fd = new FormData();
    fd.append("photo[type]", "item");
    fd.append("photo[file]", blob, `photo-${Date.now()}.jpg`);
    const csrf = document.querySelector('meta[name="csrf-token"]')?.content;
    const res = await fetch(`https://${host}/api/v2/photos`, {
      method: "POST",
      credentials: "include",
      headers: { "X-CSRF-Token": csrf || "" },
      body: fd,
    });
    if (!res.ok) throw new Error(`upload ${res.status}`);
    const j = await res.json();
    return j?.photo?.id ?? j?.id;
  }

  async function relistItem({ original, price, photos }) {
    // Upload nowych zdjęć
    const photoIds = [];
    for (const p of photos) {
      const id = await uploadPhotoDataUrl(p);
      if (id) photoIds.push(id);
    }
    // Stwórz nowy item z metadanymi oryginału
    const body = {
      item: {
        title: original.title,
        description: original.description,
        price: String(price),
        currency: original.currency || original.price?.currency_code,
        catalog_id: original.catalog_id,
        brand_id: original.brand_id,
        size_id: original.size_id,
        status_id: original.status_id,
        package_size_id: original.package_size_id,
        color_ids: original.color_ids,
        material_ids: original.material_ids,
        is_unisex: original.is_unisex ? 1 : 0,
        assigned_photos: photoIds.map((id) => ({ id })),
      },
      feedback_id: null,
      push_up: false,
    };
    const created = await vintedApi(`/api/v2/items`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    const newId = created?.item?.id;
    // Usuń stary
    try {
      await vintedRaw(`/api/v2/items/${original.id}`, { method: "DELETE" });
    } catch (e) {
      console.warn("[Vinted Manager] delete old fail", e);
    }
    return newId;
  }

  // ===== Auto-bump (z poprzedniej wersji) =====
  async function runBump() {
    try {
      const me = await getMe();
      const items = await vintedApi(`/api/v2/users/${me.id}/items?per_page=200`);
      for (const it of items?.items ?? []) {
        try {
          await vintedApi(`/api/v2/items/${it.id}/push_ups`, { method: "POST", body: "{}" });
          await new Promise((r) => setTimeout(r, 1500 + Math.random() * 1500));
        } catch (e) {
          console.warn("[VM] bump fail", it.id, e.message);
        }
      }
    } catch (e) {
      console.warn("[VM] bump err", e);
    }
  }

  // ===== Auto-reply =====
  function matchRule(text, rule) {
    if (!text || !rule?.pattern) return false;
    const t = text.toLowerCase(), p = rule.pattern.toLowerCase();
    if (rule.matchType === "exact") return t === p;
    if (rule.matchType === "starts_with") return t.startsWith(p);
    if (rule.matchType === "regex") { try { return new RegExp(rule.pattern, "i").test(text); } catch { return false; } }
    return t.includes(p);
  }
  async function runReplies() {
    const { settings } = await chrome.storage.local.get(["settings"]);
    const rules = settings?.replies ?? [];
    if (!rules.length) return;
    try {
      const inbox = await vintedApi("/api/v2/inbox?per_page=20").catch(() => null);
      const threads = inbox?.threads ?? inbox?.conversations ?? [];
      for (const th of threads) {
        const lastMsg = th.last_message?.body ?? th.preview ?? "";
        if (th.last_message?.user_id && th.last_message.user_id === th.current_user_id) continue;
        const match = rules.find((r) => r.enabled !== false && matchRule(lastMsg, r));
        if (!match) continue;
        const threadId = th.id ?? th.thread_id;
        if (!threadId) continue;
        await vintedApi(`/api/v2/inbox/${threadId}/messages`, {
          method: "POST",
          body: JSON.stringify({ message: { body: match.response } }),
        }).catch((e) => console.warn("[VM] reply fail", e));
        await new Promise((r) => setTimeout(r, 2000));
      }
    } catch (e) {
      console.warn("[VM] replies err", e);
    }
  }

  // ===== Sync z panelem =====
  async function syncToPanel() {
    try {
      const { username, userId, items } = await fetchMyItems();
      await chrome.runtime.sendMessage({
        kind: "SYNC_ITEMS",
        payload: {
          vintedUserId: String(userId),
          vintedUsername: username,
          country,
          items: items.map((it) => ({
            vinted_item_id: String(it.id),
            title: it.title,
            price: it.price,
            currency: it.currency,
            brand: it.brand,
            size_title: it.size_title,
            status: it.status,
            url: it.url,
            photo_url: it.photo_url,
            views: it.views,
            favourite_count: it.favourite_count,
          })),
        },
      });
    } catch (e) {
      console.warn("[VM] sync err", e);
    }
  }

  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    (async () => {
      try {
        if (msg.kind === "FETCH_ITEMS") sendResponse({ ok: true, ...(await fetchMyItems()) });
        else if (msg.kind === "FETCH_ITEM_DETAIL") sendResponse({ ok: true, item: await fetchItemDetail(msg.id) });
        else if (msg.kind === "RELIST_ITEM") {
          const newId = await relistItem(msg);
          sendResponse({ ok: true, newId });
        } else if (msg.kind === "RUN_BUMP") { await runBump(); sendResponse({ ok: true }); }
        else if (msg.kind === "RUN_REPLIES") { await runReplies(); sendResponse({ ok: true }); }
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  });

  syncToPanel();
  setInterval(syncToPanel, 10 * 60 * 1000);
  runReplies();
  setInterval(runReplies, 5 * 60 * 1000);
})();
