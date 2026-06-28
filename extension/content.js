// Content script — działa na vinted.*, używa sesji zalogowanego użytkownika.
(async () => {
  const host = location.hostname.replace(/^www\./, "");
  const country = host.split(".").pop(); // pl, fr, de...

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
    if (!res.ok) throw new Error(`Vinted ${res.status}`);
    return res.json();
  }

  async function syncMyItems() {
    try {
      const me = await vintedApi("/api/v2/users/current");
      const userId = me?.user?.id;
      const username = me?.user?.login;
      if (!userId) return;
      const items = await vintedApi(`/api/v2/users/${userId}/items?per_page=200`);
      const payload = {
        vintedUserId: String(userId),
        vintedUsername: username,
        country,
        items: (items?.items ?? []).map((it) => ({
          vinted_item_id: String(it.id),
          title: it.title,
          description: it.description,
          price: Number(it.price?.amount ?? it.price ?? 0),
          currency: it.price?.currency_code ?? it.currency,
          brand: it.brand_title,
          size_title: it.size_title,
          status: it.status,
          url: it.url,
          photo_url: it.photo?.url ?? it.photos?.[0]?.url ?? null,
          views: it.view_count ?? 0,
          favourite_count: it.favourite_count ?? 0,
          created_at_vinted: it.created_at_ts ?? null,
        })),
      };
      const resp = await chrome.runtime.sendMessage({ kind: "SYNC_ITEMS", payload });
      console.log("[Vinted Manager] sync:", resp);
    } catch (e) {
      console.warn("[Vinted Manager] sync error:", e);
    }
  }

  async function runBump() {
    try {
      const me = await vintedApi("/api/v2/users/current");
      const userId = me?.user?.id;
      if (!userId) return;
      const items = await vintedApi(`/api/v2/users/${userId}/items?per_page=200`);
      const ids = (items?.items ?? []).map((i) => i.id);
      console.log(`[Vinted Manager] auto-bump: próba ${ids.length} przedmiotów`);
      for (const id of ids) {
        try {
          // Endpoint push-up bywa różny per kraj / wersja Vinted.
          // Najczęściej działa: POST /api/v2/items/{id}/push_ups
          await vintedApi(`/api/v2/items/${id}/push_ups`, { method: "POST", body: "{}" });
          await new Promise((r) => setTimeout(r, 1500 + Math.random() * 1500));
        } catch (e) {
          console.warn("[Vinted Manager] bump fail", id, e.message);
        }
      }
    } catch (e) {
      console.warn("[Vinted Manager] bump error:", e);
    }
  }

  function matchRule(text, rule) {
    if (!text || !rule?.pattern) return false;
    const t = text.toLowerCase();
    const p = rule.pattern.toLowerCase();
    switch (rule.matchType) {
      case "exact": return t === p;
      case "starts_with": return t.startsWith(p);
      case "regex": try { return new RegExp(rule.pattern, "i").test(text); } catch { return false; }
      case "contains":
      default: return t.includes(p);
    }
  }

  async function runReplies() {
    const { settings } = await chrome.storage.local.get(["settings"]);
    const rules = settings?.replies ?? [];
    if (!rules.length) return;
    try {
      // Pobieramy wątki
      const inbox = await vintedApi("/api/v2/inbox?per_page=20").catch(() => null);
      const threads = inbox?.threads ?? inbox?.conversations ?? [];
      for (const th of threads) {
        const lastMsg = th.last_message?.body ?? th.preview ?? "";
        const fromMe = th.last_message?.user_id && th.last_message.user_id === th.current_user_id;
        if (fromMe) continue;
        const match = rules.find((r) => r.enabled !== false && matchRule(lastMsg, r));
        if (!match) continue;
        const threadId = th.id ?? th.thread_id;
        if (!threadId) continue;
        await vintedApi(`/api/v2/inbox/${threadId}/messages`, {
          method: "POST",
          body: JSON.stringify({ message: { body: match.response } }),
        }).catch((e) => console.warn("[Vinted Manager] reply fail", e));
        await new Promise((r) => setTimeout(r, 2000));
      }
    } catch (e) {
      console.warn("[Vinted Manager] replies error:", e);
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.kind === "RUN_BUMP") {
      runBump().then(() => sendResponse({ ok: true }));
      return true;
    }
    if (msg.kind === "RUN_REPLIES") {
      runReplies().then(() => sendResponse({ ok: true }));
      return true;
    }
  });

  // Sync raz przy załadowaniu + co 10 min jeśli karta otwarta
  syncMyItems();
  setInterval(syncMyItems, 10 * 60 * 1000);
  // Auto-odpowiedzi co 5 min
  runReplies();
  setInterval(runReplies, 5 * 60 * 1000);
})();
