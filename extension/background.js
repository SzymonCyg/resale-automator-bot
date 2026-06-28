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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.kind === "SYNC_ITEMS") {
    postSyncItems(msg.payload)
      .then((r) => sendResponse({ ok: true, r }))
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
