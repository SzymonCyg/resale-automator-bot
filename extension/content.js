// Content script — działa na vinted.*, używa sesji zalogowanego użytkownika.
(async () => {
  if (window.__VM_CONTENT_LOADED__) return;
  window.__VM_CONTENT_LOADED__ = true;

  const host = location.hostname.replace(/^www\./, "");
  const country = host.split(".").pop();
  const origin = location.origin;
  const requestPrefix = `vm-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let requestSeq = 0;

  function injectPageBridge() {
    if (document.getElementById("vm-page-bridge")) return;
    const script = document.createElement("script");
    script.id = "vm-page-bridge";
    script.src = chrome.runtime.getURL("page-bridge.js");
    script.async = false;
    (document.head || document.documentElement).appendChild(script);
  }

  injectPageBridge();

  function getCookie(name) {
    return document.cookie.split(";").map((c) => c.trim()).find((c) => c.startsWith(name + "="))?.split("=")[1];
  }

  function buildHeaders(init = {}, hasBody = false) {
    const csrf = document.querySelector('meta[name="csrf-token"]')?.content;
    const anon = getCookie("anon_id") || getCookie("anonymous-locale") || "";
    const accessToken = getCookie("access_token_web");
    const h = {
      Accept: "application/json, text/plain, */*",
      "X-CSRF-Token": csrf || "",
      "X-Requested-With": "XMLHttpRequest",
      ...(anon ? { "X-Anon-Id": decodeURIComponent(anon) } : {}),
      ...(accessToken ? { Authorization: `Bearer ${decodeURIComponent(accessToken)}` } : {}),
      ...(init.headers || {}),
    };
    if (hasBody && !h["Content-Type"]) h["Content-Type"] = "application/json";
    return h;
  }

  function pageFetch(path, init = {}) {
    const id = `${requestPrefix}-${++requestSeq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        window.removeEventListener("message", onMessage);
        reject(new Error("Timeout połączenia z Vinted"));
      }, 20000);

      function onMessage(event) {
        if (event.source !== window) return;
        const msg = event.data;
        if (!msg || msg.source !== "VM_PAGE_BRIDGE" || msg.id !== id) return;
        clearTimeout(timer);
        window.removeEventListener("message", onMessage);
        if (!msg.ok) reject(new Error(msg.error || "Vinted fetch failed"));
        else resolve(msg.response);
      }

      window.addEventListener("message", onMessage);
      window.postMessage({
        source: "VM_CONTENT",
        kind: "FETCH",
        id,
        path,
        init: {
          ...init,
          headers: buildHeaders(init, !!init.body),
        },
      }, origin);
    });
  }

  async function vintedApi(path, init = {}) {
    const res = await pageFetch(path, init);
    if (!res.ok) throw new Error(`Vinted ${res.status}${res.text ? `: ${res.text.slice(0, 120)}` : ""}`);
    return res.json;
  }

  async function vintedRaw(path, init = {}) {
    return pageFetch(path, init);
  }

  function findUserInObject(value, depth = 0) {
    if (!value || depth > 5) return null;
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 25)) {
        const found = findUserInObject(item, depth + 1);
        if (found) return found;
      }
      return null;
    }
    if (typeof value !== "object") return null;
    const id = value.id ?? value.user_id ?? value.userId;
    const login = value.login ?? value.username ?? value.user_login ?? value.userName;
    if (id && login && typeof login === "string" && !/zaloguj|signup|login/i.test(login)) {
      return { id: String(id), login };
    }
    for (const key of Object.keys(value).slice(0, 80)) {
      if (/owner|seller|buyer/.test(key)) continue;
      const found = findUserInObject(value[key], depth + 1);
      if (found) return found;
    }
    return null;
  }

  function parseUserFromStorage() {
    const stores = [window.localStorage, window.sessionStorage];
    for (const store of stores) {
      for (let i = 0; i < store.length; i += 1) {
        const key = store.key(i) || "";
        const raw = store.getItem(key) || "";
        if (raw.length > 1_500_000) continue;
        if (!/(user|member|session|auth|current|profile|account)/i.test(key + raw.slice(0, 400))) continue;
        try {
          const found = findUserInObject(JSON.parse(raw));
          if (found) return found;
        } catch {
          const m = raw.match(/"(?:id|user_id|userId)"\s*:\s*"?(\d+)"?[\s\S]{0,500}"(?:login|username)"\s*:\s*"([^"\\]+)"/i)
            || raw.match(/"(?:login|username)"\s*:\s*"([^"\\]+)"[\s\S]{0,500}"(?:id|user_id|userId)"\s*:\s*"?(\d+)"?/i);
          if (m) return m[2] && /^\d+$/.test(m[1]) ? { id: m[1], login: m[2] } : { id: m[2], login: m[1] };
        }
      }
    }
    return null;
  }

  function parseUserFromDom() {
    const roots = [document.querySelector("header"), document.querySelector(".l-header"), document.body].filter(Boolean);
    for (const root of roots) {
      const links = [...root.querySelectorAll('a[href*="/member/"]')];
      for (const a of links) {
        const href = a.getAttribute("href") || "";
        if (/signup|login|help|items\/new/.test(href)) continue;
        const m = href.match(/\/member\/(\d+)-([^/?#]+)/);
        if (m) return { id: m[1], login: decodeURIComponent(m[2]) };
      }
    }
    const html = document.documentElement.innerHTML.slice(0, 2_000_000);
    const m = html.match(/"current_user"\s*:\s*\{[\s\S]{0,2500}?"id"\s*:\s*(\d+)[\s\S]{0,2500}?"login"\s*:\s*"([^"\\]+)"/i)
      || html.match(/"viewer"\s*:\s*\{[\s\S]{0,2500}?"id"\s*:\s*(\d+)[\s\S]{0,2500}?"login"\s*:\s*"([^"\\]+)"/i);
    if (m) return { id: m[1], login: m[2] };
    return null;
  }

  async function getMe() {
    const endpoints = ["/api/v2/users/current", "/api/v2/users/me"];
    for (const endpoint of endpoints) {
      try {
        const me = await vintedApi(endpoint);
        const user = me?.user ?? me?.current_user ?? me;
        if (user?.id && (user.login || user.username)) {
          return { ...user, login: user.login || user.username };
        }
      } catch (e) {
        console.warn("[VM] getMe endpoint fail", endpoint, e);
      }
    }
    const fallback = parseUserFromStorage() || parseUserFromDom();
    if (fallback?.id && fallback?.login) return fallback;
    throw new Error("Nie mogę odczytać konta Vinted — odśwież kartę Vinted po zalogowaniu");
  }

  async function fetchRawItems(userId) {
    // Vinted ma kilka endpointów — próbujemy po kolei.
    const tries = [
      `/api/v2/wardrobe/${userId}/items?per_page=200&page=1&order=newest_first`,
      `/api/v2/wardrobe/${userId}?per_page=200&page=1&order=newest_first`,
      `/api/v2/wardrobe/${userId}/?per_page=200&page=1&order=newest_first`,
      `/api/v2/users/${userId}/items?per_page=200&page=1`,
      `/api/v2/wardrobe-items?user_id=${userId}&per_page=200`,
    ];
    let lastErr;
    for (const path of tries) {
      try {
        const r = await vintedApi(path);
        const arr = r?.items ?? r?.wardrobe_items ?? r?.user?.items ?? r?.data?.items;
        if (Array.isArray(arr)) return arr;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error("Brak działającego endpointu /items");
  }

  function normalize(it) {
    return {
      id: it.id,
      title: it.title,
      brand: it.brand_title || it.brand?.title,
      size_title: it.size_title || it.size?.title,
      price: Number(it.price?.amount ?? it.price ?? 0),
      currency: it.price?.currency_code ?? it.currency,
      status: it.status,
      url: it.url || (it.path ? `https://${host}${it.path}` : null),
      photo_url: it.photo?.url ?? it.photos?.[0]?.url ?? null,
      views: it.view_count ?? 0,
      favourite_count: it.favourite_count ?? 0,
    };
  }

  async function fetchMyItems() {
    const me = await getMe();
    if (!me) throw new Error("Niezalogowany na vinted");
    const raw = await fetchRawItems(me.id);
    return { username: me.login, userId: me.id, items: raw.map(normalize) };
  }

  async function fetchItemDetail(id) {
    const r = await vintedApi(`/api/v2/items/${id}`);
    return r?.item || null;
  }

  // ===== Ponowne wystawianie =====
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
    const photoIds = [];
    for (const p of photos) {
      const id = await uploadPhotoDataUrl(p);
      if (id) photoIds.push(id);
    }
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
    try {
      await vintedRaw(`/api/v2/items/${original.id}`, { method: "DELETE" });
    } catch (e) {
      console.warn("[VM] delete old fail", e);
    }
    return newId;
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
    const { username, userId, items } = await fetchMyItems();
    const resp = await chrome.runtime.sendMessage({
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
    if (!resp?.ok) throw new Error(resp?.error || "sync fail");
    return { count: items.length, username, ...resp.r };
  }

  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    (async () => {
      try {
        if (msg.kind === "FETCH_ITEMS") sendResponse({ ok: true, ...(await fetchMyItems()) });
        else if (msg.kind === "GET_ME") {
          const me = await getMe();
          sendResponse({ ok: true, username: me?.login, userId: me?.id, photo: me?.photo?.url });
        }
        else if (msg.kind === "FETCH_ITEM_DETAIL") sendResponse({ ok: true, item: await fetchItemDetail(msg.id) });
        else if (msg.kind === "RELIST_ITEM") {
          const newId = await relistItem(msg);
          sendResponse({ ok: true, newId });
        } else if (msg.kind === "RUN_REPLIES") { await runReplies(); sendResponse({ ok: true }); }
        else if (msg.kind === "SYNC_NOW") sendResponse({ ok: true, ...(await syncToPanel()) });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  });

  // Sync w tle (best-effort, błędy ciche)
  syncToPanel().catch((e) => console.warn("[VM] sync err", e));
  setInterval(() => syncToPanel().catch(() => {}), 10 * 60 * 1000);
  runReplies();
  setInterval(runReplies, 5 * 60 * 1000);

  // ===================================================================
  // SIDEBAR DRAWER — pasek z prawej + rozsuwany panel (iframe panel.html)
  // ===================================================================
  function injectSidebar() {
    if (document.getElementById("vm-sidebar-root")) return;
    const root = document.createElement("div");
    root.id = "vm-sidebar-root";
    root.innerHTML = `
      <style>
        #vm-sidebar-root { position: fixed; top:0; right:0; height:100vh; z-index: 2147483646; font-family:-apple-system,system-ui,sans-serif; }
        #vm-handle {
          position:absolute; top:50%; right:0; transform:translateY(-50%);
          width:32px; height:84px; background:#5eead4; color:#0b1220;
          border-radius:8px 0 0 8px; display:flex; align-items:center; justify-content:center;
          cursor:pointer; box-shadow:-2px 2px 8px rgba(0,0,0,.25); font-size:18px; font-weight:700;
          transition:right .25s ease;
        }
        #vm-handle:hover { background:#7af0db; }
        #vm-drawer {
          position:absolute; top:0; right:-560px; width:560px; max-width:95vw; height:100vh;
          background:#0f1420; box-shadow:-4px 0 16px rgba(0,0,0,.5);
          transition:right .25s ease; display:flex; flex-direction:column;
        }
        #vm-sidebar-root.open #vm-drawer { right:0; }
        #vm-sidebar-root.open #vm-handle { right:560px; }
        #vm-drawer iframe { flex:1; width:100%; border:0; background:#0f1420; }
        @media (max-width: 640px) {
          #vm-drawer { width:95vw; right:-95vw; }
          #vm-sidebar-root.open #vm-handle { right:95vw; }
        }
      </style>
      <div id="vm-handle" title="Vinted Manager">
        <span id="vm-arrow">‹</span>
      </div>
      <div id="vm-drawer"></div>
    `;
    document.documentElement.appendChild(root);

    const drawer = root.querySelector("#vm-drawer");
    const handle = root.querySelector("#vm-handle");
    const arrow = root.querySelector("#vm-arrow");
    let loaded = false;
    handle.addEventListener("click", () => {
      const open = root.classList.toggle("open");
      arrow.textContent = open ? "›" : "‹";
      if (open && !loaded) {
        const iframe = document.createElement("iframe");
        iframe.src = chrome.runtime.getURL("panel.html?embedded=1");
        drawer.appendChild(iframe);
        loaded = true;
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", injectSidebar);
  } else {
    injectSidebar();
  }
})();
