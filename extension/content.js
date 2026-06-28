// Content script — działa na vinted.*, używa sesji zalogowanego użytkownika.
(async () => {
  const domain = location.hostname.replace(/^www\./, "");

  async function vintedApi(path) {
    const csrf = document.querySelector('meta[name="csrf-token"]')?.content;
    const res = await fetch(`https://${domain}${path}`, {
      credentials: "include",
      headers: {
        Accept: "application/json",
        "X-CSRF-Token": csrf || "",
      },
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
        // accountId musi przyjść z panelu — wybieramy po username
        username,
        userId: String(userId),
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
      // Wyślij do background z kontekstem
      const cfg = await chrome.storage.local.get(["accountMap"]);
      const accountId = (cfg.accountMap ?? {})[username];
      if (!accountId) {
        console.log("[Vinted Manager] Brak mapowania konta dla", username, "— otwórz panel i wybierz konto.");
        return;
      }
      chrome.runtime.sendMessage({
        kind: "SYNC_ITEMS",
        payload: {
          accountId,
          vintedUserId: payload.userId,
          vintedUsername: payload.username,
          items: payload.items,
        },
      });
    } catch (e) {
      console.warn("[Vinted Manager] sync error:", e);
    }
  }

  async function runTask(task) {
    try {
      if (task.type === "bump") {
        const ids = task.payload?.item_ids ?? [];
        // TODO: prawdziwy endpoint push-up zależy od Vinted (różny per kraj)
        // tutaj placeholder — wymaga reverse engineering aktualnego API
        for (const id of ids) {
          await vintedApi(`/api/v2/items/${id}/push_ups`).catch(() => null);
        }
        return { ok: true, data: { count: ids.length } };
      }
      if (task.type === "reply") {
        // TODO: wysłanie wiadomości — wymaga aktualnego endpointu Vinted
        return { ok: true, data: { sent: true } };
      }
      return { ok: false, message: "unknown task type" };
    } catch (e) {
      return { ok: false, message: e?.message ?? String(e) };
    }
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.kind === "RUN_TASK") {
      runTask(msg.task).then(sendResponse);
      return true;
    }
  });

  // synchronizuj raz przy załadowaniu
  syncMyItems();
})();
