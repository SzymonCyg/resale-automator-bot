// Content script — działa na vinted.*, używa sesji zalogowanego użytkownika.
(async () => {
  const CONTENT_VERSION = "0.7.5";
  if (window.__VM_CONTENT_VERSION__ === CONTENT_VERSION) return;
  window.__VM_CONTENT_LOADED__ = true;
  window.__VM_CONTENT_VERSION__ = CONTENT_VERSION;

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
    script.onerror = () => console.warn("[Vinted Manager] page-bridge zablokowany przez CSP");
    (document.head || document.documentElement).appendChild(script);
  }
  injectPageBridge();

  function getCookie(name) {
    return document.cookie.split(";").map((c) => c.trim()).find((c) => c.startsWith(name + "="))?.split("=")[1];
  }

  function readCsrfTokenFromText(text) {
    return String(text || "").match(/CSRF_TOKEN\\?"\s*:\s*\\?"([^"\\]+)/i)?.[1]
      || String(text || "").match(/<meta\s+name="csrf-token"\s+content="([^"]+)"/i)?.[1]
      || String(text || "").match(/<meta\s+content="([^"]+)"\s+name="csrf-token"/i)?.[1]
      || String(text || "").match(/"csrfToken"\s*:\s*"([^"]+)"/i)?.[1]
      || String(text || "").match(/"csrf_token"\s*:\s*"([^"]+)"/i)?.[1]
      || "";
  }

  function readCsrfToken() {
    return document.querySelector('meta[name="csrf-token"]')?.content || readCsrfTokenFromText(document.documentElement.innerHTML);
  }

  function newUuid() {
    return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function buildHeaders(init = {}, hasBody = false) {
    const csrf = init.csrfToken || readCsrfToken();
    const anon = getCookie("anon_id") || getCookie("anonymous-locale") || "";
    const skipXRequestedWith = init.skipXRequestedWith;
    const h = {
      Accept: "application/json, text/plain, */*",
      "X-CSRF-Token": csrf || "",
      ...(anon ? { "X-Anon-Id": decodeURIComponent(anon) } : {}),
      ...(init.headers || {}),
    };
    if (!skipXRequestedWith) h["X-Requested-With"] = h["X-Requested-With"] || "XMLHttpRequest";
    if (hasBody && !h["Content-Type"]) h["Content-Type"] = "application/json";
    delete h.skipXRequestedWith;
    return h;
  }

  function bridgeRequest(kind, payload = {}, timeout = 30000) {
    const id = `${requestPrefix}-${++requestSeq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        window.removeEventListener("message", onMessage);
        reject(new Error("Timeout połączenia z Vinted"));
      }, timeout);
      function onMessage(event) {
        if (event.source !== window) return;
        const msg = event.data;
        if (!msg || msg.source !== "VM_PAGE_BRIDGE_058" || msg.id !== id) return;
        clearTimeout(timer);
        window.removeEventListener("message", onMessage);
        if (!msg.ok) reject(new Error(msg.error || "Vinted fetch failed"));
        else resolve(msg.response);
      }
      window.addEventListener("message", onMessage);
      window.postMessage({ source: "VM_CONTENT_058", id, kind, ...payload }, origin);
    });
  }

  function pageFetch(path, init = {}) {
    const { skipXRequestedWith, csrfToken, useApiHost, ...fetchInit } = init;
    return bridgeRequest("FETCH", {
      path,
      csrfToken,
      init: { ...fetchInit, skipXRequestedWith, useApiHost: !!useApiHost, headers: buildHeaders(init, !!init.body) },
    });
  }

  // Każde zdjęcie dostaje własne unikalne UUID (jak jv() w Dotb)
  function pageUploadPhoto(dataUrl, csrfToken) {
    return bridgeRequest("UPLOAD_PHOTO", {
      dataUrl,
      tempUuid: newUuid(),
      csrfToken,
      filename: `photo-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`,
    }, 60000);
  }

  async function vintedApi(path, init = {}) {
    const res = await pageFetch(path, init);
    if (!res.ok) throw new Error(`Vinted ${res.status}${res.text ? `: ${res.text.slice(0, 180)}` : ""}`);
    return res.json;
  }

  async function vintedRaw(path, init = {}) {
    return pageFetch(path, init);
  }

  async function getExtensionStatus() {
    return chrome.runtime.sendMessage({ kind: "GET_STATUS" }).catch(() => null);
  }

  async function ensureExtensionSignedIn() {
    const status = await getExtensionStatus();
    if (!status?.signedIn) throw new Error("Zaloguj wtyczkę przez Google w popupie, aby używać funkcji Vinted Manager");
    return status;
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
    if (id && login && typeof login === "string" && !/zaloguj|signup|login/i.test(login)) return { id: String(id), login };
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
    for (const endpoint of ["/api/v2/users/current", "/api/v2/users/me"]) {
      try {
        const me = await vintedApi(endpoint);
        const user = me?.user ?? me?.current_user ?? me;
        if (user?.id && (user.login || user.username)) return { ...user, login: user.login || user.username };
      } catch (e) {
        console.warn("[VM] getMe endpoint fail", endpoint, e);
      }
    }
    const fallback = parseUserFromStorage() || parseUserFromDom();
    if (fallback?.id && fallback?.login) return fallback;
    throw new Error("Nie mogę odczytać konta Vinted — odśwież kartę Vinted po zalogowaniu");
  }

  async function fetchRawItems(userId) {
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
      } catch (e) { lastErr = e; }
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

  // Dotb: bh(id) = GET /api/v2/item_upload/items/{id} — BEZ /edit
  async function fetchItemDetail(id) {
    const tries = [
      `/api/v2/item_upload/items/${id}`,
      `/api/v2/items/${id}?localize=false`,
      `/api/v2/items/${id}`,
      `/api/v2/items/${id}/details`,
    ];
    let lastErr;
    for (const path of tries) {
      try {
        const res = await vintedRaw(path, {});
        const text = res?.text || "";
        if (!res?.ok || text.trimStart().startsWith("<")) {
          lastErr = new Error(`Vinted ${res?.status || "?"}: HTML zamiast JSON (${path})`);
          continue;
        }
        const item = res?.json?.item || res?.json;
        if (item && (item.id || item.title)) return item;
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error("Nie mogę pobrać szczegółów przedmiotu");
  }

  const STATUS_LABEL_TO_ID = {
    "new with tags": 1, "nowy z metką": 1, "nowy z metka": 1, "neu mit etikett": 1, "neuf avec étiquette": 1,
    "new without tags": 2, "nowy bez metki": 2, "neu ohne etikett": 2, "neuf sans étiquette": 2,
    "very good": 6, "bardzo dobry": 6, "sehr gut": 6, "très bon état": 6,
    "good": 3, "dobry": 3, "gut": 3, "bon état": 3,
    "satisfactory": 4, "zadowalający": 4, "zadowalajacy": 4, "befriedigend": 4, "satisfaisant": 4,
  };

  function valueId(v) { return typeof v === "object" && v !== null ? v.id : v; }
  function valueTitle(v) { return typeof v === "object" && v !== null ? v.title : v; }

  function resolveStatusId(original) {
    const direct = original.status_id || valueId(original.status) || original.condition_id || valueId(original.condition);
    if (direct) return direct;
    // Fallback z item_attributes[condition]
    const condAttr = (original.item_attributes || []).find(a => a.code === "condition");
    if (condAttr?.ids?.[0]) return condAttr.ids[0];
    const label = String(valueTitle(original.status) || original.status || original.condition || "").trim().toLowerCase();
    return STATUS_LABEL_TO_ID[label] || null;
  }

  // Synchronizacja status_id <-> item_attributes[condition] — jak CZ() w Dotb
  function syncConditionAttr(draft) {
    const statusId = draft.status_id;
    const attrs = draft.item_attributes ?? [];
    const condAttr = attrs.find(a => a.code === "condition");
    if (statusId && condAttr === undefined) return { ...draft, item_attributes: [...attrs, { code: "condition", ids: [statusId] }] };
    if (!statusId && condAttr?.ids?.[0]) return { ...draft, status_id: condAttr.ids[0] };
    return draft;
  }

  // Synchronizacja size_id <-> item_attributes[size] — jak NZ() w Dotb
  function syncSizeAttr(draft) {
    const sizeId = draft.size_id;
    const attrs = draft.item_attributes ?? [];
    const sizeAttr = attrs.find(a => a.code === "size");
    if (sizeId && sizeAttr === undefined) return { ...draft, item_attributes: [...attrs, { code: "size", ids: [sizeId] }] };
    if (!sizeId && sizeAttr?.ids?.[0]) return { ...draft, size_id: sizeAttr.ids[0] };
    return draft;
  }

  async function deleteOldItem(itemId) {
    const attempts = [
      { path: `/api/v2/items/${itemId}`, init: { method: "DELETE" } },
      { path: `/api/v2/items/${itemId}/delete`, init: { method: "POST", body: JSON.stringify({}) } },
    ];
    let last = "";
    for (const attempt of attempts) {
      try {
        const res = await vintedRaw(attempt.path, attempt.init);
        if (res.ok) return true;
        last = `${res.status}${res.text ? `: ${res.text.slice(0, 180)}` : ""}`;
      } catch (e) { last = e?.message || String(e); }
    }
    throw new Error(`nie udało się usunąć starego (${last})`);
  }

  async function uploadPhotoDataUrl(dataUrl, csrfToken) {
    const res = await pageUploadPhoto(dataUrl, csrfToken);
    if (!res.ok) throw new Error(`upload zdjęcia ${res.status}${res.text ? `: ${res.text.slice(0, 180)}` : ""}`);
    const id = res.json?.photo?.id ?? res.json?.id;
    if (!id) throw new Error("Vinted nie zwrócił ID zdjęcia");
    return id;
  }

  // Buduje draft — jak ab()/yu() w Dotb, z syncConditionAttr + syncSizeAttr
  function buildDraft({ original, price, currency, photoIds }) {
    const statusId = resolveStatusId(original);
    if (!statusId) throw new Error("Brak stanu przedmiotu (status_id)");
    const finalCurrency = currency || original.currency || original.price?.currency_code || "PLN";
    const draft = {
      id: null,
      currency: finalCurrency,
      temp_uuid: newUuid(),
      title: original.title || "",
      description: original.description || original.title || "",
      brand_id: original.brand_id || valueId(original.brand_dto) || valueId(original.brand) || null,
      brand: original.brand_title || valueTitle(original.brand_dto) || valueTitle(original.brand) || null,
      size_id: original.size_id || valueId(original.size) || null,
      catalog_id: original.catalog_id || valueId(original.catalog) || null,
      isbn: original.isbn || null,
      is_unisex: original.is_unisex === true || original.is_unisex === 1,
      status_id: statusId,
      video_game_rating_id: original.video_game_rating_id ?? null,
      ai_photo: false,
      price: Number(price),
      package_size_id: original.package_size_id || valueId(original.package_size) || null,
      shipment_prices: { domestic: null, international: null },
      // Dotb: color_ids z color1_id i color2_id
      color_ids: [original.color1_id, original.color2_id].filter(c => c != null),
      assigned_photos: photoIds.map(id => ({ id, orientation: 0 })),
      item_attributes: original.item_attributes || [],
      measurement_length: original.measurement_length ?? null,
      measurement_width: original.measurement_width ?? null,
      manufacturer: original.manufacturer ?? null,
      manufacturer_labelling: original.manufacturer_labelling ?? null,
      model: original.model ?? null,
    };
    return syncSizeAttr(syncConditionAttr(draft));
  }

  // ===== Ponowne wystawianie — flow identyczny z Dotb =====
  // 1) POST /api/v2/photos (same-origin)          → upload zdjęć
  // 2) POST /api/v2/item_upload/drafts (same-origin) → stworzenie draftu
  // 3) GET  /api/v2/item_upload/items/{draftId}   → odświeżenie draftu (Ku())
  // 4) POST /api/v2/item_upload/drafts/{id}/completion → publikacja (nde/v9())
  // 5) DELETE starego ogłoszenia
  async function relistItem({ original, price, currency, photos }) {
    await ensureExtensionSignedIn();
    const csrfToken = readCsrfToken();

    // 1) Upload zdjęć — każde dostaje własne UUID
    const photoIds = [];
    for (const p of photos) {
      const id = await uploadPhotoDataUrl(p, csrfToken);
      if (id) photoIds.push(id);
    }
    if (!photoIds.length) throw new Error("Brak poprawnie wgranych zdjęć");

    // 2) Stworzenie draftu
    const draft = buildDraft({ original, price, currency, photoIds });
    const draftRes = await vintedApi(`/api/v2/item_upload/drafts`, {
      method: "POST",
      csrfToken,
      body: JSON.stringify({ draft, feedback_id: null, parcel: null, upload_session_id: draft.temp_uuid }),
    });
    const createdDraft = draftRes?.draft || draftRes;
    const draftId = createdDraft?.id;
    if (!draftId) throw new Error("Vinted nie zwrócił ID draftu");

    // 3) Odświeżenie draftu (jak Ku() w Dotb)
    await new Promise(r => setTimeout(r, 500));
    let refreshedDraft;
    try {
      const r = await vintedRaw(`/api/v2/item_upload/items/${draftId}`, {});
      refreshedDraft = r?.json?.item || r?.json || createdDraft;
    } catch {
      refreshedDraft = createdDraft;
    }

    // 4) Publikacja — POST /completion z odświeżonym draftem (jak nde/v9() w Dotb)
    const publishDraft = buildDraft({ original: { ...original, ...refreshedDraft }, price, currency, photoIds });
    publishDraft.id = draftId;
    const completedRes = await vintedApi(`/api/v2/item_upload/drafts/${draftId}/completion`, {
      method: "POST",
      csrfToken,
      body: JSON.stringify({ draft: publishDraft, feedback_id: null, parcel: null, push_up: false, upload_session_id: publishDraft.temp_uuid }),
    });
    const newId = completedRes?.item?.id ?? completedRes?.id;
    if (!newId) throw new Error("Vinted przyjął draft, ale nie zwrócił ID opublikowanego ogłoszenia");

    // 5) Usunięcie starego
    let deletedOld = false, deleteError = null;
    try { await deleteOldItem(original.id); deletedOld = true; }
    catch (e) { deleteError = e?.message || String(e); }

    return { newId, deletedOld, deleteError };
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
    } catch (e) { console.warn("[VM] replies err", e); }
  }

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

  async function deleteItemById(id) {
    await deleteOldItem(id);
    return { ok: true };
  }

  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    (async () => {
      try {
        const requiresLogin = ["FETCH_ITEMS","FETCH_ITEMS_V2","FETCH_ITEM_DETAIL","FETCH_ITEM_DETAIL_V2","RELIST_ITEM","RELIST_ITEM_V2","RUN_REPLIES","RUN_REPLIES_V2","SYNC_NOW","SYNC_NOW_V2","DELETE_ITEM_V2"].includes(msg.kind);
        if (requiresLogin) await ensureExtensionSignedIn();

        if (msg.kind === "FETCH_ITEMS" || msg.kind === "FETCH_ITEMS_V2") sendResponse({ ok: true, ...(await fetchMyItems()) });
        else if (msg.kind === "GET_ME" || msg.kind === "GET_ME_V2") {
          const me = await getMe();
          sendResponse({ ok: true, username: me?.login, userId: me?.id, photo: me?.photo?.url });
        }
        else if (msg.kind === "FETCH_ITEM_DETAIL" || msg.kind === "FETCH_ITEM_DETAIL_V2") sendResponse({ ok: true, item: await fetchItemDetail(msg.id) });
        else if (msg.kind === "RELIST_ITEM" || msg.kind === "RELIST_ITEM_V2") sendResponse({ ok: true, ...(await relistItem(msg)) });
        else if (msg.kind === "RUN_REPLIES" || msg.kind === "RUN_REPLIES_V2") { await runReplies(); sendResponse({ ok: true }); }
        else if (msg.kind === "SYNC_NOW" || msg.kind === "SYNC_NOW_V2") sendResponse({ ok: true, ...(await syncToPanel()) });
        else if (msg.kind === "DELETE_ITEM_V2") sendResponse({ ok: true, ...(await deleteItemById(msg.id)) });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  });

  ensureExtensionSignedIn()
    .then(() => {
      syncToPanel().catch((e) => console.warn("[VM] sync err", e));
      setInterval(() => syncToPanel().catch(() => {}), 10 * 60 * 1000);
      runReplies();
      setInterval(runReplies, 5 * 60 * 1000);
    })
    .catch(() => {});

  // ===================================================================
  // SIDEBAR DRAWER
  // ===================================================================
  function injectSidebar() {
    if (document.getElementById("vm-sidebar-root")) return;
    const root = document.createElement("div");
    root.id = "vm-sidebar-root";
    root.innerHTML = `
      <style>
        #vm-sidebar-root { position: fixed; top:0; right:0; height:100vh; z-index: 2147483646; font-family:-apple-system,system-ui,sans-serif; }
        #vm-handle {
          position:fixed; top:50%; right:0; transform:translateY(-50%);
          width:32px; height:84px; background:#5eead4; color:#0b1220;
          border-radius:8px 0 0 8px; display:flex; align-items:center; justify-content:center;
          cursor:pointer; box-shadow:-2px 2px 8px rgba(0,0,0,.25); font-size:18px; font-weight:700;
          transition:right .25s ease, top .25s ease, height .25s ease;
        }
        #vm-handle:hover { background:#7af0db; }
        #vm-drawer {
          position:fixed; inset:0; width:100vw; height:100vh;
          background:#0f1420; box-shadow:-4px 0 16px rgba(0,0,0,.5);
          transform:translateX(100%); transition:transform .25s ease; display:flex; flex-direction:column;
        }
        #vm-sidebar-root.open #vm-drawer { transform:translateX(0); }
        #vm-sidebar-root.open #vm-handle { right:12px; top:18px; height:44px; transform:none; border-radius:8px; z-index:2147483647; }
        #vm-drawer iframe { flex:1; width:100%; border:0; background:#0f1420; }
      </style>
      <div id="vm-handle" title="Vinted Manager"><span id="vm-arrow">‹</span></div>
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

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", injectSidebar);
  else injectSidebar();
})();