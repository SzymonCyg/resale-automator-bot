// Content script — działa na vinted.*, używa sesji zalogowanego użytkownika.
(async () => {
  const CONTENT_VERSION = "0.9.19";
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

  function extractCsrfFromScripts() {
    const scripts = document.querySelectorAll("script");
    const patterns = [
      /"CSRF_TOKEN\\?"\s*:\s*\\?"([^"\\]+)/,
      /\\"CSRF_TOKEN\\":\\"([^"\\]+)/,
      /"csrfToken\\?"\s*:\s*\\?"([^"\\]+)/,
    ];
    for (const s of scripts) {
      const txt = s.textContent || "";
      if (!txt.includes("CSRF") && !txt.includes("csrf")) continue;
      for (const re of patterns) {
        const m = txt.match(re);
        if (m && m[1]) return m[1];
      }
    }
    return "";
  }

  function readCsrfTokenFromText(text) {
    return String(text || "").match(/"CSRF_TOKEN\\?"\s*:\s*\\?"([^"\\]+)/i)?.[1]
      || String(text || "").match(/<meta\s+name="csrf-token"\s+content="([^"]+)"/i)?.[1]
      || String(text || "").match(/<meta\s+content="([^"]+)"\s+name="csrf-token"/i)?.[1]
      || String(text || "").match(/"csrfToken"\s*:\s*"([^"]+)"/i)?.[1]
      || String(text || "").match(/"csrf_token"\s*:\s*"([^"]+)"/i)?.[1]
      || "";
  }

  function readCsrfToken() {
    return extractCsrfFromScripts()
      || document.querySelector('meta[name="csrf-token"]')?.content
      || readCsrfTokenFromText(document.documentElement.innerHTML);
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

  let alCaptchaInProgress = false;
  let alCaptchaLastFailAt = 0;
  let alDiagShown = false;

  function solveCaptchaViaBridge(captchaUrl) {
    return bridgeRequest("SOLVE_CAPTCHA", { captchaUrl, timeout: 180000 }, 190000);
  }

  async function handleCaptchaIfNeeded(res) {
    const captchaUrl = res?.captchaUrl;
    if (!captchaUrl) return false;
    if (alCaptchaInProgress) return false;
    alCaptchaInProgress = true;
    try {
      if (typeof alPushStat === "function") await alPushStat("🔐 Vinted wymaga weryfikacji — otwieram captchę...");
      const result = await solveCaptchaViaBridge(captchaUrl);
      if (result?.solved) {
        if (typeof alPushStat === "function") await alPushStat("✅ Weryfikacja zakończona — wznawiam");
        return true;
      }
      alCaptchaLastFailAt = Date.now();
      if (result?.hardblock) {
        if (typeof alPushStat === "function") await alPushStat("⛔ Vinted zablokował dostęp (hardblock) — spróbuj później");
      } else {
        if (typeof alPushStat === "function") await alPushStat("⚠ Weryfikacja nieukończona — spróbuj ręcznie odświeżyć Vinted");
      }
      return false;
    } finally {
      alCaptchaInProgress = false;
    }
  }

  function pageFetch(path, init = {}) {
    const { skipXRequestedWith, csrfToken, useApiHost, ...fetchInit } = init;
    return bridgeRequest("FETCH", {
      path,
      csrfToken,
      init: { ...fetchInit, skipXRequestedWith, useApiHost: !!useApiHost, headers: buildHeaders(init, !!init.body) },
    });
  }

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
    if (!res.ok) throw new Error(`Vinted ${res.status}${res.text ? `: ${res.text.slice(0, 250)}` : ""}`);
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
    const condAttr = (original.item_attributes || []).find(a => a.code === "condition");
    if (condAttr?.ids?.[0]) return condAttr.ids[0];
    const label = String(valueTitle(original.status) || original.status || original.condition || "").trim().toLowerCase();
    return STATUS_LABEL_TO_ID[label] || null;
  }

  function syncConditionAttr(draft) {
    const statusId = draft.status_id;
    const attrs = draft.item_attributes ?? [];
    const condAttr = attrs.find(a => a.code === "condition");
    if (statusId && condAttr === undefined) return { ...draft, item_attributes: [...attrs, { code: "condition", ids: [statusId] }] };
    if (!statusId && condAttr?.ids?.[0]) return { ...draft, status_id: condAttr.ids[0] };
    return draft;
  }

  function syncSizeAttr(draft) {
    const sizeId = draft.size_id;
    const attrs = draft.item_attributes ?? [];
    const sizeAttr = attrs.find(a => a.code === "size");
    if (sizeId && sizeAttr === undefined) return { ...draft, item_attributes: [...attrs, { code: "size", ids: [sizeId] }] };
    if (!sizeId && sizeAttr?.ids?.[0]) return { ...draft, size_id: sizeAttr.ids[0] };
    return draft;
  }

  async function uploadPhotoDataUrl(dataUrl, csrfToken) {
    const res = await pageUploadPhoto(dataUrl, csrfToken);
    if (!res.ok) throw new Error(`upload zdjęcia ${res.status}${res.text ? `: ${res.text.slice(0, 180)}` : ""}`);
    const id = res.json?.photo?.id ?? res.json?.id;
    if (!id) throw new Error("Vinted nie zwrócił ID zdjęcia");
    return id;
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

  function buildDraft({ original, price, currency, photoIds, tempUuid, assignedPhotos }) {
    const statusId = resolveStatusId(original);
    if (!statusId) throw new Error("Brak stanu przedmiotu (status_id) w danych źródłowych");
    const finalCurrency = currency || original.currency || original.price?.currency_code || original.price?.currency || "PLN";
    const photos = assignedPhotos || photoIds.map(id => ({ id, orientation: 0 }));
    const draft = {
      id: null,
      currency: finalCurrency,
      temp_uuid: tempUuid || newUuid(),
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
      color_ids: [original.color1_id, original.color2_id].filter(c => c != null),
      assigned_photos: photos,
      item_attributes: original.item_attributes || [],
      measurement_length: original.measurement_length ?? null,
      measurement_width: original.measurement_width ?? null,
      manufacturer: original.manufacturer ?? null,
      manufacturer_labelling: original.manufacturer_labelling ?? null,
      model: original.model ?? null,
    };
    return syncSizeAttr(syncConditionAttr(draft));
  }

  async function relistItem({ original, price, currency, photos }) {
    await ensureExtensionSignedIn();
    const csrfToken = readCsrfToken();

    const photoIds = [];
    for (const p of photos) {
      const id = await uploadPhotoDataUrl(p, csrfToken);
      if (id) photoIds.push(id);
    }
    if (!photoIds.length) throw new Error("Brak poprawnie wgranych zdjęć");

    const draft = buildDraft({ original, price, currency, photoIds });
    const draftRes = await vintedApi(`/api/v2/item_upload/drafts`, {
      method: "POST",
      csrfToken,
      body: JSON.stringify({ draft, feedback_id: null, parcel: null, upload_session_id: draft.temp_uuid }),
    });
    const createdDraft = draftRes?.draft || draftRes;
    const draftId = createdDraft?.id;
    if (!draftId) throw new Error("Vinted nie zwrócił ID draftu");

    await new Promise(r => setTimeout(r, 2500));
    let refreshedDraft = createdDraft;
    try {
      const r = await vintedRaw(`/api/v2/item_upload/items/${draftId}`, {});
      if (r?.ok && r?.json) refreshedDraft = r.json.item || r.json;
    } catch {}

    const draftPhotos = Array.isArray(refreshedDraft?.photos) && refreshedDraft.photos.length
      ? refreshedDraft.photos.map(p => ({ id: p.id, orientation: p.orientation ?? 0 }))
      : photoIds.map(id => ({ id, orientation: 0 }));

    const publishDraft = buildDraft({
      original: { ...original, ...refreshedDraft },
      price,
      currency,
      photoIds,
      tempUuid: refreshedDraft?.temp_uuid || newUuid(),
      assignedPhotos: draftPhotos,
    });
    publishDraft.id = draftId;

    const completedRes = await vintedApi(`/api/v2/item_upload/drafts/${draftId}/completion`, {
      method: "POST",
      csrfToken,
      body: JSON.stringify({ draft: publishDraft, feedback_id: null, parcel: null, push_up: false, upload_session_id: publishDraft.temp_uuid }),
    });
    const newId = completedRes?.item?.id ?? completedRes?.id;
    if (!newId) throw new Error("Vinted przyjął draft, ale nie zwrócił ID opublikowanego ogłoszenia");

    let deletedOld = false, deleteError = null;
    try { await deleteOldItem(original.id); deletedOld = true; }
    catch (e) { deleteError = e?.message || String(e); }

    return { newId, deletedOld, deleteError };
  }

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
        else if (msg.kind === "AUTOLIKES_KICK") {
          if (alKick) { try { alKick(); } catch {} alKick = null; }
          alProcessedIds = new Set();
          alLatestId = null;
          alLatestDate = null;
          alMode = 'idle';
          alStartLoop();
          sendResponse({ ok: true });
        }

      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  });

  // ============ AUTO-LIKES (auto-reply to item likes) ============
  const AL_DEFAULTS = {
    autoLikesEnabled: false,
    autoLikesTemplate: "Cześć @username! Widziałem, że polubiłeś mój przedmiot i chciałem od razu zaoferować Ci specjalną zniżkę! 💸",
    autoLikesDiscount: false,
    autoLikesDiscountAmount: 10,
    autoLikesDiscountUnit: '%',
    autoLikesDelayNotifMin: 60000,
    autoLikesDelayNotifMax: 120000,
    autoLikesMsgDelayMin: 30000,
    autoLikesMsgDelayMax: 60000,
    autoLikesMinGapMs: 8000,
    autoLikesTimeFilter: 0,
  };

  function alRand(min, max) { return Math.floor(min + Math.random() * Math.max(1, max - min)); }
  function alSleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  const AL_INSTANCE_ID = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const AL_LOCK_KEY = "autoLikesLock";
  const AL_LOCK_TTL_MS = 45000;
  let alHeartbeatTimer = null;

  async function alReadLock() {
    const { [AL_LOCK_KEY]: lock } = await chrome.storage.local.get([AL_LOCK_KEY]);
    return lock || null;
  }

  async function alWriteLock() {
    try {
      await chrome.storage.local.set({
        [AL_LOCK_KEY]: {
          instanceId: AL_INSTANCE_ID,
          heartbeat: Date.now(),
          visible: document.visibilityState === "visible",
        },
      });
    } catch {}
  }

  async function alTryAcquireLock() {
    const lock = await alReadLock();
    const now = Date.now();
    const fresh = !!lock && (now - lock.heartbeat) < AL_LOCK_TTL_MS;
    const mine = !!lock && lock.instanceId === AL_INSTANCE_ID;
    const iAmVisible = document.visibilityState === "visible";
    const takeOverFromHidden = fresh && !mine && !lock.visible && iAmVisible;
    if (fresh && !mine && !takeOverFromHidden) return false;
    await alWriteLock();
    await alSleep(250 + Math.random() * 250);
    const check = await alReadLock();
    return !!check && check.instanceId === AL_INSTANCE_ID;
  }

  async function alReleaseLockIfMine() {
    try {
      const lock = await alReadLock();
      if (lock && lock.instanceId === AL_INSTANCE_ID) await chrome.storage.local.remove([AL_LOCK_KEY]);
    } catch {}
  }

  function alStartHeartbeat() {
    if (alHeartbeatTimer) return;
    alHeartbeatTimer = setInterval(() => { alWriteLock(); }, 15000);
  }

  function alStopHeartbeat() {
    if (alHeartbeatTimer) { clearInterval(alHeartbeatTimer); alHeartbeatTimer = null; }
  }

  async function alGetSettings() {
    const s = await chrome.storage.local.get(Object.keys(AL_DEFAULTS).concat(["autoLikesStats"]));
    return { ...AL_DEFAULTS, ...s };
  }

  async function alPushStat(line, deltaSent = 0) {
    const cur = (await chrome.storage.local.get(["autoLikesStats"])).autoLikesStats || { sent: 0, logs: [] };
    const logs = Array.isArray(cur.logs) ? cur.logs : [];
    const newLine = `[${new Date().toLocaleTimeString()}] ${line}`;
    logs.push(newLine);
    if (logs.length > 100) logs.splice(0, logs.length - 100);
    const next = {
      sent: (cur.sent || 0) + deltaSent,
      lastEvent: line,
      lastAt: Date.now(),
      logLine: newLine,
      logs,
    };
    await chrome.storage.local.set({ autoLikesStats: next });
  }

  function alExtractLikeInfo(n) {
    const entryType = n?.entry_type ?? n?.entryType ?? n?.type;
    if (entryType !== 20 && entryType !== "20") return null;
    let linkUserId = null, linkItemId = null;
    if (n?.link && typeof n.link === 'string') {
      const qs = n.link.includes('?') ? n.link.split('?')[1] : '';
      const params = new URLSearchParams(qs);
      linkUserId = params.get('offering_id') || params.get('user_id');
      linkItemId = params.get('item_id') || params.get('subject_id');
    }
    const loginFromBody = (typeof n?.body === 'string' && n.body.trim())
      ? n.body.trim().split(/\s+/)[0]
      : null;
    const itemId = n?.item_id ?? n?.entity_id ?? n?.item?.id ?? n?.subject_id ?? linkItemId;
    // userId pochodzi z link query string (offering_id/user_id), NIE z n.user_id (to właściciel ogłoszenia)
    const userId = linkUserId ?? n?.notifier?.id ?? n?.actor?.id ?? n?.actor_id;
    const login = n?.notifier?.login ?? n?.actor?.login ?? loginFromBody ?? null;
    const updatedAt = n?.updated_at ?? n?.created_at ?? n?.time ?? null;
    if (!itemId || !userId) return null;
    return { notifId: String(n.id), itemId: String(itemId), userId: String(userId), login, updatedAt };
  }


  function alApiHostUrl(path) {
    const proto = window.location.protocol;
    const hostNoWww = window.location.hostname.replace(/^www\./, "");
    return `${proto}//api.${hostNoWww}${path}`;
  }

  async function alFetchNotificationsPage(page) {
    const tries = [
      { path: alApiHostUrl(`/inbox-notifications/v1/notifications?page=${page}&per_page=20`), headers: { platform: "web", "X-Next-App": "marketplace-web" } },
      { path: `/web/api/notifications/notifications?page=${page}&per_page=20`, headers: { platform: "web" } },
      { path: `/api/v2/notifications?page=${page}&per_page=20`, headers: {} },
    ];
    for (const t of tries) {
      try {
        const res = await vintedRaw(t.path, { headers: t.headers });
        if (res?.ok && res?.json) {
          const r = res.json;
          if (r.message_code === 'rate_limit_exceeded' || r.code === 106) {
            const mins = alSetCooldown(8, 12);
            await alPushStat(`⏳ Rate limit — wznowię za ~${mins} min`);
            return { notifications: [], pagination: {} };
          }
          const arr = r?.notifications ?? r?.data;
          if (Array.isArray(arr)) return { notifications: arr, pagination: r?.pagination || r?.meta || {} };
        }
      } catch (e) {
        const msg = String(e?.message || e);
        if (msg.includes('429') || msg.includes('rate_limit_exceeded')) {
          const mins = alSetCooldown(8, 12);
          await alPushStat(`⏳ Rate limit — wznowię za ~${mins} min`);
          return { notifications: [], pagination: {} };
        }
      }
    }
    return { notifications: [], pagination: {} };
  }

  let alProcessedIds = new Set();
  let alLatestId = null;
  let alLatestDate = null;
  let alMode = 'idle';

  async function alGetNotifications(settings) {
    const timeFilterSec = settings.autoLikesTimeFilter || 0;
    const maxAgeMs = timeFilterSec * 1000;
    const cutoffDate = maxAgeMs > 0 ? new Date(Date.now() - maxAgeMs) : null;
    const isBacklog = maxAgeMs > 0 && alMode === 'backlog';

    let page = 1;
    const collected = [];
    let stop = false;
    let totalNotifs = 0;
    let totalLikes = 0;

    while (!stop) {
      if (alInCooldown()) break;
      const { notifications, pagination } = await alFetchNotificationsPage(page);
      if (!notifications.length) break;
      totalNotifs += notifications.length;

      for (const notif of notifications) {
        const like = alExtractLikeInfo(notif);
        if (!like) continue;
        totalLikes++;
        const updatedAt = like.updatedAt ? new Date(like.updatedAt) : null;

        if (isBacklog) {
          if (updatedAt && cutoffDate && updatedAt < cutoffDate) { stop = true; break; }
          if (alProcessedIds.has(like.notifId)) continue;
          collected.push(like);
        } else {
          if (alLatestDate && updatedAt && updatedAt <= alLatestDate) { stop = true; break; }
          if (alLatestId && like.notifId === alLatestId) { stop = true; break; }
          if (alProcessedIds.has(like.notifId)) continue;
          collected.push(like);
        }
      }

      if (stop) break;
      if (!isBacklog) break;
      if (pagination.total_pages && page >= pagination.total_pages) break;
      if (page >= 10) break;
      page++;
      await alSleep(alRand(2000, 4000));
    }

    if (totalNotifs > 0 && totalLikes === 0) {
      await alPushStat(`ℹ ${totalNotifs} powiadomień, 0 polubień (entry_type≠20)`);
    } else if (totalLikes > 0 && collected.length === 0) {
      await alPushStat(`ℹ ${totalLikes} polubień ale wszystkie już przetworzone/poza oknem`);
    }

    return collected;
  }

  async function alCreateConversationRaw(itemId, oppositeUserId, csrfToken) {
    const referrer = new URL(`/inbox/want_it?receiver_id=${oppositeUserId}&item_id=${itemId}`, window.location.origin).toString();
    return vintedRaw(`/api/v2/conversations`, {
      method: "POST",
      csrfToken,
      referrer,
      body: JSON.stringify({
        initiator: "seller_enters_notification",
        item_id: Number(itemId),
        opposite_user_id: Number(oppositeUserId),
      }),
    });
  }

  async function alCreateConversation(itemId, oppositeUserId, csrfToken) {
    const res = await alCreateConversationRaw(itemId, oppositeUserId, csrfToken);
    if (!res?.ok) {
      const err = new Error(`Vinted ${res?.status}${res?.text ? `: ${res.text.slice(0,250)}` : ""}`);
      err.status = res?.status;
      err.code = res?.json?.code;
      err.message_code = res?.json?.message_code;
      err.captchaUrl = res?.captchaUrl;
      err.respHeaders = res?.respHeaders;
      err.sentHeaders = res?.sentHeaders;
      err.rawText = res?.text;
      throw err;
    }
    return res.json;
  }

  class AlSkipUser extends Error {}
  class AlRateLimited extends Error {}

  let alGlobalCooldownUntil = 0;

  function alInCooldown() {
    return Date.now() < alGlobalCooldownUntil;
  }

  function alCooldownMinutesLeft() {
    return Math.max(0, Math.ceil((alGlobalCooldownUntil - Date.now()) / 60000));
  }

  function alSetCooldown(minMinutes, maxMinutes) {
    const ms = alRand(minMinutes * 60000, maxMinutes * 60000);
    alGlobalCooldownUntil = Date.now() + ms;
    return Math.round(ms / 60000);
  }

  function alIsRateLimit(e) {
    const msg = String(e?.message || e);
    return e?.status === 429
      || e?.message_code === 'rate_limit_exceeded'
      || msg.includes('rate_limit_exceeded')
      || msg.includes('429');
  }

  function alIsUserBlocked(e) {
    const msg = String(e?.message || e);
    if (alIsRateLimit(e)) return false;
    return (e?.status === 403 && (e?.code === 106 || e?.message_code === 'access_denied'))
      || (msg.includes('403') && msg.includes('access_denied'));
  }

  async function alCreateConversationSafe(itemId, userId, csrfToken) {
    try {
      const r = await alCreateConversation(itemId, userId, csrfToken);
      if (r && r.message_code === 'rate_limit_exceeded') {
        const mins = alSetCooldown(8, 12);
        throw new AlRateLimited(`Rate limit — wznowię za ~${mins} min`);
      }
      return r;
    } catch (e) {
      if (e instanceof AlSkipUser || e instanceof AlRateLimited) throw e;

      if (e.captchaUrl) {
        const solved = await handleCaptchaIfNeeded({ captchaUrl: e.captchaUrl });
        if (solved) return alCreateConversation(itemId, userId, csrfToken);
        throw new AlSkipUser(`weryfikacja nieukończona`);
      }

      if (alIsRateLimit(e)) {
        const mins = alSetCooldown(8, 12);
        throw new AlRateLimited(`Rate limit — wznowię za ~${mins} min`);
      }

      if (alIsUserBlocked(e)) {
        throw new AlSkipUser(`użytkownik zablokował lub ogłoszenie nieaktywne`);
      }

      if (!alDiagShown) {
        alDiagShown = true;
        await alPushStat(`🔎 Nieznany błąd: status=${e.status} code=${e.code} msg_code=${e.message_code}`);
        await alPushStat(`🔎 Body: ${(e.rawText || String(e.message || '')).slice(0,200)}`);
      }
      throw e;
    }
  }

  function alCalcDiscount(orig, amount, unit) {
    if (unit === '%') return Math.max(1, Math.round(orig * (1 - amount/100) * 100) / 100);
    return Math.max(1, Math.round((orig - amount) * 100) / 100);
  }

  async function alSendOffer(transactionId, price, currency, csrfToken, convId) {
    const offerReferrer = convId
      ? new URL(`/inbox/${convId}`, window.location.origin).toString()
      : undefined;
    return vintedApi(`/api/v2/transactions/${transactionId}/offers`, {
      method: "POST",
      csrfToken,
      referrer: offerReferrer,
      body: JSON.stringify({ offer: { price: String(price), currency } }),
    });
  }

  async function alSendReply(conversationId, body, csrfToken) {
    const replyReferrer = new URL(`/inbox/${conversationId}`, window.location.origin).toString();
    let r;
    try {
      r = await vintedApi(`/api/v2/conversations/${conversationId}/replies`, {
        method: "POST",
        csrfToken,
        referrer: replyReferrer,
        body: JSON.stringify({ reply: { body, is_personal_data_sharing_check_skipped: false, photo_temp_uuids: null } }),
      });
    } catch (e) {
      const msg = String(e?.message || e);
      if (msg.includes('429') || msg.includes('rate_limit_exceeded')) {
        const mins = alSetCooldown(8, 12);
        throw new AlRateLimited(`Rate limit — wznowię za ~${mins} min`);
      }
      throw e;
    }
    if (r && r.message_code === 'rate_limit_exceeded') {
      const mins = alSetCooldown(8, 12);
      throw new AlRateLimited(`Rate limit — wznowię za ~${mins} min`);
    }
    if (r && r.message_code === 'access_denied') {
      throw new Error(`access_denied: brak dostępu do konwersacji`);
    }
    return r;
  }

  let alRunning = false;
  let alKick = null;

  async function alLoopOnce() {
    const s = await alGetSettings();
    if (!s.autoLikesEnabled) return false;
    const csrfToken = readCsrfToken();

    let likes = [];
    try { likes = await alGetNotifications(s); }
    catch (e) { await alPushStat(`✗ powiadomienia: ${e.message}`); return true; }

    if (!likes.length) { await alPushStat(`brak nowych polubień`); }
    else { await alPushStat(`📩 Znaleziono ${likes.length} polubień`); }

    for (const like of likes) {
      const cur = await alGetSettings();
      if (!cur.autoLikesEnabled) return false;
      try {
        const convRes = await alCreateConversationSafe(like.itemId, like.userId, csrfToken);
        const conv = convRes?.conversation || convRes?.thread || convRes;
        const oppLogin = conv?.opposite_user?.login || conv?.opposite_user?.username || like.login || String(like.userId);
        const msgs = conv?.messages || [];
        if (msgs.length > 0) {
          alProcessedIds.add(like.notifId);
        } else {
          if (cur.autoLikesDiscount) {
            const txId = conv?.transaction?.id || conv?.transaction_id;
            const origPrice = Number(conv?.transaction?.item_price?.amount
              ?? conv?.transaction?.offer_price?.amount
              ?? conv?.item?.price?.amount
              ?? conv?.item?.price
              ?? 0);
            const curCode = conv?.transaction?.currency_code
              || conv?.item?.price?.currency_code
              || conv?.item?.currency
              || "PLN";
            if (txId && origPrice > 0) {
              const newP = alCalcDiscount(origPrice, cur.autoLikesDiscountAmount, cur.autoLikesDiscountUnit);
              try {
                await alSendOffer(txId, newP, curCode, csrfToken, conv?.id || conv?.conversation_id);
                await alPushStat(`💸 oferta ${newP} ${curCode} → @${oppLogin}`);
              } catch (e) {
                await alPushStat(`⚠ oferta @${oppLogin}: ${e.message}`);
              }
            }
          }
          const convId = conv?.id || conv?.conversation_id;
          const body = (cur.autoLikesTemplate || "").replace(/@username/g, oppLogin);
          if (convId && body) {
            await alSendReply(convId, body, csrfToken);
            alProcessedIds.add(like.notifId);
            await alPushStat(`✓ Wiadomość wysłana → @${oppLogin}`, 1);
          }
        }
        if (!alLatestId || Number(like.notifId) > Number(alLatestId)) {
          alLatestId = like.notifId;
          if (like.updatedAt) alLatestDate = new Date(like.updatedAt);
        }
        const msgDelay = Math.max(30000, alRand(cur.autoLikesMsgDelayMin, cur.autoLikesMsgDelayMax));
        await alSleep(msgDelay);
      } catch (e) {
        if (!(e instanceof AlSkipUser)) {
          const errMsg = e.message || String(e);
          await alPushStat(`✗ Przerwano dla @${like.login || like.userId}: ${errMsg}`);
        }
        alProcessedIds.add(like.notifId);
        const curD = await alGetSettings();
        await alSleep(Math.max(8000, alRand(curD.autoLikesMsgDelayMin, curD.autoLikesMsgDelayMax)));
      }
    }

    if (alMode === 'backlog') {
      alMode = 'live';
      await alPushStat(`✅ Historia przetworzona — tryb live`);
    }
    return true;
  }

  async function alStartLoop() {
    if (alRunning) return;
    alRunning = true;
    try {
      const acquired = await alTryAcquireLock();
      if (!acquired) return;
      alStartHeartbeat();
      const s0 = await alGetSettings();
      alMode = (s0.autoLikesTimeFilter || 0) > 0 ? 'backlog' : 'live';
      await alPushStat(`🔍 Tryb: ${alMode === 'backlog' ? `historyczne (${s0.autoLikesTimeFilter}s wstecz)` : 'tylko nowe'}`);
      while (true) {
        const s = await alGetSettings();
        if (!s.autoLikesEnabled) break;
        try { await alLoopOnce(); } catch (e) { console.warn("[AL]", e); }
        const wait = alRand(s.autoLikesDelayNotifMin, s.autoLikesDelayNotifMax);
        await new Promise(r => { alKick = r; setTimeout(r, wait); });
        alKick = null;
      }
    } finally {
      alRunning = false;
      alMode = 'idle';
      alStopHeartbeat();
      await alReleaseLockIfMine();
    }
  }

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.autoLikesEnabled) {
      if (changes.autoLikesEnabled.newValue) alStartLoop();
      else if (alKick) { try { alKick(); } catch {} }
    }
  });

  window.addEventListener("pagehide", () => {
    if (alRunning) alReleaseLockIfMine();
  });

  ensureExtensionSignedIn()
    .then(() => {
      syncToPanel().catch((e) => console.warn("[VM] sync err", e));
      setInterval(() => syncToPanel().catch(() => {}), 10 * 60 * 1000);
      runReplies();
      setInterval(runReplies, 5 * 60 * 1000);
      alGetSettings().then((s) => { if (s.autoLikesEnabled) alStartLoop(); });
    })
    .catch(() => {});



  function injectSidebar() {
    if (document.getElementById("vm-sidebar-root")) return;
    const root = document.createElement("div");
    root.id = "vm-sidebar-root";
    root.innerHTML = `
      <style>
        #vm-sidebar-root { position: fixed; top:0; left:0; height:100vh; z-index: 2147483646; font-family:-apple-system,system-ui,sans-serif; }
        #vm-handle {
          position:fixed; top:50%; right:0; left:auto; transform:translateY(-50%);
          width:32px; height:84px; background:#5eead4; color:#0b1220;
          border-radius:8px 0 0 8px; display:flex; align-items:center; justify-content:center;
          cursor:pointer; box-shadow:-2px 2px 8px rgba(0,0,0,.25); font-size:18px; font-weight:700;
          transition:left .25s ease, right .25s ease, top .25s ease, height .25s ease, width .25s ease, border-radius .25s ease;
          z-index:2147483647;
        }
        #vm-handle:hover { background:#7af0db; }
        #vm-drawer {
          position:fixed; inset:0; width:100vw; height:100vh;
          background:#0f1420; box-shadow:-4px 0 16px rgba(0,0,0,.5);
          transform:translateX(100%); transition:transform .25s ease; display:flex; flex-direction:column;
        }
        #vm-sidebar-root.open #vm-drawer { transform:translateX(0); }
        #vm-sidebar-root.open #vm-handle { left:0 !important; right:auto !important; top:50%; transform:translateY(-50%); height:84px; width:32px; border-radius:0 8px 8px 0; box-shadow:2px 2px 8px rgba(0,0,0,.4); }
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
