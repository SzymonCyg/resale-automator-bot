// Background service worker — sesja panelu + komunikacja z backendem.
const DEFAULT_PANEL_URL = "https://resale-automator-bot.lovable.app";

async function getConfig() {
  const { panelUrl, session, supabaseUrl, supabaseAnonKey, user, settings } =
    await chrome.storage.local.get([
      "panelUrl",
      "session",
      "supabaseUrl",
      "supabaseAnonKey",
      "user",
      "settings",
    ]);
  return {
    panelUrl: panelUrl || DEFAULT_PANEL_URL,
    session,
    supabaseUrl,
    supabaseAnonKey,
    user,
    settings: settings || { replies: [] },
  };
}

async function refreshSession() {
  const { session, supabaseUrl, supabaseAnonKey } = await getConfig();
  if (!session?.refresh_token || !supabaseUrl || !supabaseAnonKey) return null;
  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${supabaseAnonKey}`,
    },
    body: JSON.stringify({ refresh_token: session.refresh_token }),
  });
  if (!res.ok) return null;
  const fresh = await res.json();
  const next = {
    access_token: fresh.access_token,
    refresh_token: fresh.refresh_token,
    expires_at: fresh.expires_at ?? Math.floor(Date.now() / 1000) + (fresh.expires_in ?? 3600),
  };
  await chrome.storage.local.set({ session: next });
  return next;
}

async function getValidAccessToken() {
  const { session } = await getConfig();
  if (!session?.access_token) return null;
  const exp = session.expires_at ?? 0;
  if (exp - 60 < Math.floor(Date.now() / 1000)) {
    const fresh = await refreshSession();
    return fresh?.access_token ?? null;
  }
  return session.access_token;
}

async function postSyncItems(payload) {
  const { panelUrl } = await getConfig();
  const token = await getValidAccessToken();
  if (!token) throw new Error("Wtyczka niezalogowana");
  const res = await fetch(`${panelUrl}/api/public/extension/sync-items`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Sync ${res.status}: ${await res.text()}`);
  return res.json();
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("vintedRefresh", { periodInMinutes: 30 });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  try {
    if (alarm.name === "vintedRefresh") await refreshSession();
  } catch (e) {
    console.warn("[Vinted Manager] alarm:", e);
  }
});

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function waitTabComplete(tabId, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpd);
      reject(new Error("tab load timeout"));
    }, timeout);
    function onUpd(id, info) {
      if (id === tabId && info.status === "complete") {
        clearTimeout(t);
        chrome.tabs.onUpdated.removeListener(onUpd);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(onUpd);
    chrome.tabs.get(tabId).then((tab) => {
      if (tab?.status === "complete") {
        clearTimeout(t);
        chrome.tabs.onUpdated.removeListener(onUpd);
        resolve();
      }
    });
  });
}

function waitForNewItemId(tabId, timeout = 90000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpd);
      reject(new Error("timeout: brak navigacji do nowego ogłoszenia"));
    }, timeout);
    function onUpd(id, info, tab) {
      if (id !== tabId) return;
      const url = info.url || tab?.url || "";
      const m = url.match(/\/items\/(\d+)(?:[/?#-]|$)/);
      if (m && !/\/items\/new/.test(url)) {
        clearTimeout(t);
        chrome.tabs.onUpdated.removeListener(onUpd);
        resolve(m[1]);
      }
    }
    chrome.tabs.onUpdated.addListener(onUpd);
  });
}

async function relistViaForm({ origin, original, price, currency, photos }) {
  if (!origin) throw new Error("Brak origin (otwórz najpierw kartę vinted.*)");
  const tab = await chrome.tabs.create({ url: `${origin}/items/new`, active: false });
  let newId = null;
  try {
    await waitTabComplete(tab.id);
    // Wstrzykuję bridge'a do MAIN world (CSP Vinted blokuje <script src=chrome-extension://>)
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["page-bridge.js"], world: "MAIN" }).catch(() => {});
    // Daj Reactowi czas na zamontowanie formularza
    await sleep(2500);
    const navPromise = waitForNewItemId(tab.id, 90000);
    const r = await chrome.tabs.sendMessage(tab.id, { kind: "FILL_AND_SUBMIT_V2", original, price, currency, photos });
    if (!r?.ok) throw new Error(r?.error || "fill fail");
    newId = await navPromise;
    // delete starego — z tej samej karty (cookie + CSRF już są)
    const del = await chrome.tabs.sendMessage(tab.id, { kind: "DELETE_ITEM_V2", id: original.id }).catch((e) => ({ ok: false, error: e.message }));
    await chrome.tabs.remove(tab.id).catch(() => {});
    return { newId, deletedOld: !!del?.ok, deleteError: del?.ok ? null : del?.error };
  } catch (e) {
    await chrome.tabs.remove(tab.id).catch(() => {});
    throw e;
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.kind === "SYNC_ITEMS") {
    postSyncItems(msg.payload)
      .then((r) => sendResponse({ ok: true, r }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (msg.kind === "RELIST_VIA_FORM") {
    relistViaForm(msg.payload)
      .then((r) => sendResponse({ ok: true, ...r }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (msg.kind === "GET_STATUS") {
    getConfig().then(({ user, panelUrl, session, settings }) =>
      sendResponse({
        user: user ?? null,
        panelUrl,
        signedIn: !!session?.access_token,
        settings,
      }),
    );
    return true;
  }
  if (msg.kind === "SAVE_SETTINGS") {
    chrome.storage.local.set({ settings: msg.settings }).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.kind === "FETCH_PHOTO") {
    (async () => {
      try {
        const res = await fetch(msg.url, { credentials: "omit" });
        if (!res.ok) throw new Error("status " + res.status);
        const blob = await res.blob();
        const dataUrl = await new Promise((r) => {
          const fr = new FileReader();
          fr.onload = () => r(fr.result);
          fr.readAsDataURL(blob);
        });
        sendResponse({ ok: true, dataUrl });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  }
  if (msg.kind === "SIGN_OUT") {
    chrome.storage.local
      .remove(["session", "user", "supabaseUrl", "supabaseAnonKey"])
      .then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.kind === "PARAPHRASE_AI") {
    (async () => {
      try {
        const apiKey = "__ANTHROPIC_API_KEY__";
        if (!apiKey || apiKey === "BRAK_KLUCZA" || apiKey.startsWith("__")) {
          throw new Error("Brak klucza ANTHROPIC_API_KEY");
        }
        const prompt = `Jesteś pomocnikiem sprzedawcy na Vinted. Przepisz tytuł i opis ogłoszenia tak, aby miały to samo znaczenie, ale były wyrażone nieco innymi słowami (drobne zmiany synonimów, kolejność słów, skróty). Tytuł musi być krótki (max 60 znaków). Nie zmieniaj informacji o marce, rozmiarze, stanie ani cenie. Odpowiedz TYLKO w formacie JSON bez żadnego tekstu poza JSON:\n{"title": "...", "description": "..."}\n\nTytuł: ${msg.title}\nOpis: ${msg.description || "(brak opisu)"}`;
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 500,
            messages: [{ role: "user", content: prompt }],
          }),
        });
        if (!res.ok) throw new Error(`AI API ${res.status}: ${await res.text()}`);
        const data = await res.json();
        const text = data.content?.find((b) => b.type === "text")?.text || "";
        const clean = text.replace(/```json|```/g, "").trim();
        const parsed = JSON.parse(clean);
        sendResponse({ ok: true, title: parsed.title, description: parsed.description });
      } catch (e) {
        console.warn("[Vinted Manager] PARAPHRASE_AI:", e);
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  }
});

// Wiadomość ze strony panelu (Google login → przekazanie sesji)
chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
  if (msg?.kind !== "SUPABASE_SESSION") return;
  const origin = sender.origin || "";
  try {
    const host = new URL(origin).hostname;
    const ok = /\.lovable\.(app|dev)$/.test(host) || host === "localhost";
    if (!ok) {
      sendResponse({ ok: false, error: "forbidden origin" });
      return;
    }
  } catch {
    sendResponse({ ok: false, error: "bad origin" });
    return;
  }
  const { session, user, supabaseUrl, supabaseAnonKey, panelUrl } = msg;
  if (!session?.access_token || !session?.refresh_token) {
    sendResponse({ ok: false, error: "invalid session" });
    return;
  }
  chrome.storage.local
    .set({
      session: {
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_at: session.expires_at,
      },
      user: user ?? null,
      supabaseUrl: supabaseUrl ?? null,
      supabaseAnonKey: supabaseAnonKey ?? null,
      panelUrl: panelUrl ?? origin,
    })
    .then(() => sendResponse({ ok: true }));
  return true;
});
