// Content script — działa na vinted.*, używa sesji zalogowanego użytkownika.
(async () => {
  const CONTENT_VERSION = "0.7.0";
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
    script.onerror = () => console.warn("[Vinted Manager] page-bridge został zablokowany przez CSP; panel wstrzyknie go przez chrome.scripting.");
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
      window.postMessage({
        source: "VM_CONTENT_058",
        id,
        kind,
        ...payload,
      }, origin);
    });
  }

  function pageFetch(path, init = {}) {
    const { skipXRequestedWith, csrfToken, ...fetchInit } = init;
    return bridgeRequest("FETCH", {
      path,
      csrfToken,
      init: {
        ...fetchInit,
        skipXRequestedWith,
        headers: buildHeaders(init, !!init.body),
      },
    });
  }

  function pageUploadPhoto(dataUrl, tempUuid, csrfToken) {
    return bridgeRequest("UPLOAD_PHOTO", {
      dataUrl,
      tempUuid,
      csrfToken,
      filename: `photo-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`,
    }, 60000);
  }

  async function vintedApi(path, init = {}) {
    const res = await pageFetch(path, init);
    if (!res.ok) throw new Error(`Vinted ${res.status}${res.text ? `: ${res.text.slice(0, 120)}` : ""}`);
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
    if (!status?.signedIn) {
      throw new Error("Zaloguj wtyczkę przez Google w popupie, aby używać funkcji Vinted Manager");
    }
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
    // /api/v2/item_upload/items/{id}/edit zwraca pełny payload edytowalny
    // razem ze status_id, catalog_id, brand_id itd. — używamy go w pierwszej kolejności,
    // bo /api/v2/items/{id} zwraca "status" jako etykietę tekstową i Vinted odrzuca
    // POST z validation_error: [:item, :status_id] = "".
    const tries = [
      `/api/v2/item_upload/items/${id}/edit`,
      `/api/v2/items/${id}/details`,
      `/api/v2/items/${id}?localize=false`,
      `/api/v2/items/${id}`,
    ];
    let lastErr;
    for (const path of tries) {
      try {
        const r = await vintedApi(path);
        const item = r?.item || r;
        if (item && (item.id || item.title)) return item;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error("Nie mogę pobrać szczegółów przedmiotu");
  }

  // Mapowanie etykiet stanu Vinted → status_id (stabilne globalnie).
  const STATUS_LABEL_TO_ID = {
    "new with tags": 1, "nowy z metką": 1, "nowy z metka": 1, "neu mit etikett": 1, "neuf avec étiquette": 1,
    "new without tags": 2, "nowy bez metki": 2, "neu ohne etikett": 2, "neuf sans étiquette": 2,
    "very good": 6, "bardzo dobry": 6, "sehr gut": 6, "très bon état": 6,
    "good": 3, "dobry": 3, "gut": 3, "bon état": 3,
    "satisfactory": 4, "zadowalający": 4, "zadowalajacy": 4, "befriedigend": 4, "satisfaisant": 4,
  };

  function resolveStatusId(original) {
    const direct = original.status_id
      || valueId(original.status)
      || original.condition_id
      || valueId(original.condition);
    if (direct) return direct;
    const label = String(valueTitle(original.status) || original.status || original.condition || "").trim().toLowerCase();
    if (label && STATUS_LABEL_TO_ID[label]) return STATUS_LABEL_TO_ID[label];
    return null;
  }

  // ===== Ponowne wystawianie =====
  async function getUploadContext() {
    const res = await vintedRaw("/items/new", {
      skipXRequestedWith: true,
      headers: { Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
    });
    const text = res?.text || "";
    if (!res?.ok) throw new Error(`Nie mogę otworzyć formularza dodawania (${res?.status || "brak statusu"})`);
    const uploadSessionId = text.match(/\\"uploadSessionId\\"\s*:\s*\\"([^\\]+)\\"/i)?.[1]
      || text.match(/"uploadSessionId"\s*:\s*"([^"]+)"/i)?.[1]
      || text.match(/uploadSessionId["\\:]+([^"\\]+)["\\]?/i)?.[1];
    const csrfToken = readCsrfTokenFromText(text) || readCsrfToken();
    if (!uploadSessionId) throw new Error("Nie mogę przygotować formularza dodawania ogłoszenia (brak uploadSessionId)");
    if (!csrfToken) throw new Error("Nie mogę przygotować formularza dodawania ogłoszenia (brak CSRF tokenu)");
    return { uploadSessionId, csrfToken };
  }

  async function uploadPhotoDataUrl(dataUrl, tempUuid, csrfToken) {
    const res = await pageUploadPhoto(dataUrl, tempUuid, csrfToken);
    if (!res.ok) throw new Error(`upload zdjęcia ${res.status}${res.text ? `: ${res.text.slice(0, 180)}` : ""}`);
    const j = res.json;
    const id = j?.photo?.id ?? j?.id;
    if (!id) throw new Error("Vinted nie zwrócił ID zdjęcia");
    return id;
  }

  function compact(value) {
    if (Array.isArray(value)) return value.filter((x) => x !== undefined && x !== null && x !== "");
    return Object.fromEntries(
      Object.entries(value).filter(([, v]) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0)),
    );
  }

  function valueId(value) {
    return typeof value === "object" && value !== null ? value.id : value;
  }

  function valueTitle(value) {
    return typeof value === "object" && value !== null ? value.title : value;
  }

  function extractColorIds(original) {
    if (Array.isArray(original.color_ids)) return original.color_ids;
    return [valueId(original.color1), valueId(original.color2), original.color1_id, original.color2_id, original.color_id].filter(Boolean);
  }

  function extractConditionIds(original) {
    const fromAttrs = Array.isArray(original.item_attributes)
      ? original.item_attributes.find((a) => a?.code === "condition" || a?.item_attribute_id === "condition")
      : null;
    const ids = fromAttrs?.ids || fromAttrs?.item_attribute_option_ids || original.condition_ids;
    if (Array.isArray(ids) && ids.length) return ids;
    return [original.status_id || valueId(original.status)].filter(Boolean);
  }

  function cleanPayload(value) {
    if (Array.isArray(value)) return value.map(cleanPayload).filter((x) => x !== undefined && x !== "");
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value)
          .map(([k, v]) => [k, cleanPayload(v)])
          .filter(([, v]) => v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0)),
      );
    }
    return value;
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
      } catch (e) {
        last = e?.message || String(e);
      }
    }
    throw new Error(`nowe ogłoszenie dodane, ale nie udało się usunąć starego (${last})`);
  }

  async function relistItem({ original, price, currency, photos }) {
    await ensureExtensionSignedIn();
    const { uploadSessionId, csrfToken } = await getUploadContext();
    const tempUuid = uploadSessionId || newUuid();
    const photoIds = [];
    for (const p of photos) {
      const id = await uploadPhotoDataUrl(p, tempUuid, csrfToken);
      if (id) photoIds.push(id);
    }
    if (!photoIds.length) throw new Error("Brak poprawnie wgranych zdjęć — przerwano dodawanie");

    const statusId = resolveStatusId(original);
    if (!statusId) {
      throw new Error("Brak stanu przedmiotu (status_id) — otwórz ogłoszenie ręcznie, ustaw stan i spróbuj ponownie");
    }
    const conditionIds = (Array.isArray(original.item_attributes)
      ? original.item_attributes.find((a) => a?.code === "condition")
      : null)?.ids || extractConditionIds(original);
    const safeConditionIds = (Array.isArray(conditionIds) && conditionIds.length) ? conditionIds : [statusId];

    const item = cleanPayload({
      id: null,
      temp_uuid: tempUuid,
      title: original.title,
      description: original.description || original.title || "",
      price: Number(price),
      currency: currency || original.currency || original.price?.currency_code || original.price?.currency,
      catalog_id: original.catalog_id || valueId(original.catalog),
      brand_id: original.brand_id || valueId(original.brand_dto) || valueId(original.brand),
      brand: original.brand_title || valueTitle(original.brand_dto) || valueTitle(original.brand),
      size_id: original.size_id || valueId(original.size),
      status_id: statusId,
      package_size_id: original.package_size_id || valueId(original.package_size),
      color_ids: extractColorIds(original),
      material_id: original.material_id,
      material_ids: original.material_ids,
      item_attributes: [{ code: "condition", ids: safeConditionIds }],
      isbn: original.isbn,
      is_unisex: !!original.is_unisex,
      is_for_swap: !!original.is_for_swap,
      is_for_sell: original.is_for_sell !== false,
      ...(original.shipment_prices ? { shipment_prices: original.shipment_prices } : {}),
      assigned_photos: photoIds.map((id) => ({ id, orientation: 0 })),
    });

    const body = {
      item,
      feedback_id: null,
      push_up: false,
      parcel: null,
      upload_session_id: uploadSessionId,
    };
    const created = await vintedApi(`/api/v2/item_upload/items`, {
      method: "POST",
      headers: {
        "X-Upload-Form": "true",
        "X-Enable-Dynamic-Attribute-Condition": "true",
        "X-Enable-Dynamic-Attribute-Video-Game-Rating": "true",
        "X-Enable-Multiple-Size-Groups": "true",
        "X-CSRF-Token": csrfToken,
      },
      referrer: `${origin}/items/new`,
      csrfToken,
      body: JSON.stringify(body),
    });
    const newId = created?.item?.id ?? created?.id;
    if (!newId) throw new Error("Vinted przyjął dodawanie, ale nie zwrócił ID nowego ogłoszenia");
    await deleteOldItem(original.id);
    return { newId, deletedOld: true };
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

  // ===== Form-driven relisting (v0.6.0) =====
  let rfSeq = 0;
  function formBridge(action, payload = {}, timeout = 8000) {
    const id = `vmrf-${Date.now()}-${++rfSeq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        window.removeEventListener("message", onMsg);
        reject(new Error(`form-bridge ${action} timeout`));
      }, timeout);
      function onMsg(ev) {
        if (ev.source !== window) return;
        const m = ev.data;
        if (!m || m.source !== "VM_RF_RES" || m.id !== id) return;
        clearTimeout(timer);
        window.removeEventListener("message", onMsg);
        if (!m.ok) reject(new Error(m.error || `form-bridge ${action} failed`));
        else resolve(m.data);
      }
      window.addEventListener("message", onMsg);
      window.postMessage({ source: "VM_RF_REQ", id, action, ...payload }, origin);
    });
  }

  async function waitForFormReady(maxMs = 30000) {
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
      try {
        const r = await formBridge("ping", {}, 2000);
        if (r?.ready) return true;
      } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error("Formularz Vinted nie załadował się w 30s");
  }

  function pickStatusLabelId(state, original) {
    // wybierz status_id na podstawie oryginalnego ogłoszenia + opcji w formularzu
    const id = resolveStatusId(original);
    return id || null;
  }

  async function fillAndSubmit({ original, price, currency, photos }) {
    await waitForFormReady();
    const state = await formBridge("read", {});
    if (!state) throw new Error("Brak stanu formularza Vinted");

    // 1) upload zdjęć (page-bridge musi już być w MAIN world — wstrzykuje go background)
    const tempUuid = state?.uploadSessionId || state?.tempUuid || newUuid();
    const csrfToken = readCsrfToken();
    const photoIds = [];
    for (const p of photos) {
      const id = await uploadPhotoDataUrl(p, tempUuid, csrfToken);
      if (id) photoIds.push(id);
    }
    if (!photoIds.length) throw new Error("Nie udało się wgrać żadnego zdjęcia");

    // 2) zbuduj partial state — używamy tylko pól istniejących w state, plus assignedPhotos
    const colorIds = extractColorIds(original);
    const statusId = pickStatusLabelId(state, original);
    const partial = {
      title: original.title || state.title || "",
      description: original.description || state.description || "",
      price: Number(price),
      currency: currency || original.currency || state.currency,
      catalogId: original.catalog_id || valueId(original.catalog) || state.catalogId,
      brandId: original.brand_id || valueId(original.brand_dto) || valueId(original.brand) || state.brandId,
      brandTitle: original.brand_title || valueTitle(original.brand_dto) || valueTitle(original.brand) || state.brandTitle,
      sizeId: original.size_id || valueId(original.size) || state.sizeId,
      colorIds: colorIds.length ? colorIds : state.colorIds,
      packageSizeId: original.package_size_id || valueId(original.package_size) || state.packageSizeId,
      statusId: statusId || state.statusId,
      isUnisex: !!original.is_unisex,
      isForSwap: !!original.is_for_swap,
      assignedPhotos: photoIds.map((id) => ({ id, orientation: 0 })),
    };
    // usuń puste klucze, żeby nie nadpisać dobrej wartości undefinedem
    Object.keys(partial).forEach((k) => {
      if (partial[k] === undefined || partial[k] === null || partial[k] === "") delete partial[k];
    });
    await formBridge("write", { partial }, 5000);

    // 3) wymuś też wartość pól tekstowych przez natywne settery (React + walidacja onBlur)
    await formBridge("setInput", { selector: '[data-testid="price-input--input"]', value: String(partial.price) }, 3000).catch(() => {});

    // 4) klik save
    await new Promise((r) => setTimeout(r, 500));
    await formBridge("clickSave", {}, 5000);
    return { ok: true, expectedTitle: partial.title };
  }

  async function deleteItemById(id) {
    await deleteOldItem(id);
    return { ok: true };
  }

  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    (async () => {
      try {
        const requiresLogin = ["FETCH_ITEMS", "FETCH_ITEMS_V2", "FETCH_ITEM_DETAIL", "FETCH_ITEM_DETAIL_V2", "RELIST_ITEM", "RELIST_ITEM_V2", "RUN_REPLIES", "RUN_REPLIES_V2", "SYNC_NOW", "SYNC_NOW_V2", "FILL_AND_SUBMIT_V2", "DELETE_ITEM_V2"].includes(msg.kind);
        if (requiresLogin) await ensureExtensionSignedIn();

        if (msg.kind === "FETCH_ITEMS" || msg.kind === "FETCH_ITEMS_V2") sendResponse({ ok: true, ...(await fetchMyItems()) });
        else if (msg.kind === "GET_ME" || msg.kind === "GET_ME_V2") {
          const me = await getMe();
          sendResponse({ ok: true, username: me?.login, userId: me?.id, photo: me?.photo?.url });
        }
        else if (msg.kind === "FETCH_ITEM_DETAIL" || msg.kind === "FETCH_ITEM_DETAIL_V2") sendResponse({ ok: true, item: await fetchItemDetail(msg.id) });
        else if (msg.kind === "RELIST_ITEM" || msg.kind === "RELIST_ITEM_V2") {
          sendResponse({ ok: true, ...(await relistItem(msg)) });
        } else if (msg.kind === "FILL_AND_SUBMIT_V2") {
          sendResponse({ ok: true, ...(await fillAndSubmit(msg)) });
        } else if (msg.kind === "DELETE_ITEM_V2") {
          sendResponse({ ok: true, ...(await deleteItemById(msg.id)) });
        } else if (msg.kind === "RUN_REPLIES" || msg.kind === "RUN_REPLIES_V2") { await runReplies(); sendResponse({ ok: true }); }
        else if (msg.kind === "SYNC_NOW" || msg.kind === "SYNC_NOW_V2") sendResponse({ ok: true, ...(await syncToPanel()) });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  });

  // Sync/auto-reply działa tylko po zalogowaniu wtyczki przez Google.
  ensureExtensionSignedIn()
    .then(() => {
      syncToPanel().catch((e) => console.warn("[VM] sync err", e));
      setInterval(() => syncToPanel().catch(() => {}), 10 * 60 * 1000);
      runReplies();
      setInterval(runReplies, 5 * 60 * 1000);
    })
    .catch(() => {});

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
