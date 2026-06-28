// Background service worker — pętla zadań + zarządzanie sesją Supabase.
const DEFAULT_PANEL_URL = "https://resale-automator-bot.lovable.app";

async function getConfig() {
  const { panelUrl, session, supabaseUrl, supabaseAnonKey, deviceToken, user } =
    await chrome.storage.local.get([
      "panelUrl",
      "session",
      "supabaseUrl",
      "supabaseAnonKey",
      "deviceToken",
      "user",
    ]);
  return {
    panelUrl: panelUrl || DEFAULT_PANEL_URL,
    session,
    supabaseUrl,
    supabaseAnonKey,
    deviceToken,
    user,
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
  if (!res.ok) {
    console.warn("[Vinted Manager] refresh failed", res.status);
    return null;
  }
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

async function api(path, opts = {}) {
  const { panelUrl, deviceToken } = await getConfig();
  const token = await getValidAccessToken();
  const headers = {
    "Content-Type": "application/json",
    ...(opts.headers || {}),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  else if (deviceToken) headers["X-Device-Token"] = deviceToken;
  else throw new Error("Wtyczka niezalogowana");

  let res = await fetch(`${panelUrl}${path}`, { ...opts, headers });
  if (res.status === 401 && token) {
    const fresh = await refreshSession();
    if (fresh?.access_token) {
      headers["Authorization"] = `Bearer ${fresh.access_token}`;
      res = await fetch(`${panelUrl}${path}`, { ...opts, headers });
    }
  }
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("vintedTick", { periodInMinutes: 5 });
  chrome.alarms.create("vintedRefresh", { periodInMinutes: 30 });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  try {
    if (alarm.name === "vintedTick") await processTasks();
    if (alarm.name === "vintedRefresh") await refreshSession();
  } catch (e) {
    console.warn("[Vinted Manager] alarm error:", e);
  }
});

async function processTasks() {
  const token = await getValidAccessToken();
  const { deviceToken } = await getConfig();
  if (!token && !deviceToken) return;
  const { tasks } = await api("/api/public/extension/tasks", { method: "GET" });
  if (!tasks?.length) return;

  const tabs = await chrome.tabs.query({
    url: [
      "*://*.vinted.pl/*",
      "*://*.vinted.fr/*",
      "*://*.vinted.de/*",
      "*://*.vinted.com/*",
    ],
  });
  const tab = tabs[0];
  if (!tab) {
    console.log("[Vinted Manager] Brak otwartej karty Vinted — zadania poczekają.");
    return;
  }

  for (const task of tasks) {
    try {
      const result = await chrome.tabs.sendMessage(tab.id, { kind: "RUN_TASK", task });
      await api("/api/public/extension/tasks", {
        method: "POST",
        body: JSON.stringify({
          taskId: task.id,
          status: result?.ok ? "done" : "error",
          result: result?.data ?? null,
          message: result?.message ?? null,
        }),
      });
    } catch (e) {
      await api("/api/public/extension/tasks", {
        method: "POST",
        body: JSON.stringify({
          taskId: task.id,
          status: "error",
          message: e?.message ?? String(e),
        }),
      });
    }
  }
}

// Sync z content scriptu (Vinted tab)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.kind === "SYNC_ITEMS") {
    api("/api/public/extension/sync-items", {
      method: "POST",
      body: JSON.stringify(msg.payload),
    })
      .then((r) => sendResponse({ ok: true, r }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (msg.kind === "MATCH_REPLY") {
    api("/api/public/extension/match-reply", {
      method: "POST",
      body: JSON.stringify(msg.payload),
    })
      .then((r) => sendResponse({ ok: true, r }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (msg.kind === "GET_STATUS") {
    getConfig().then(({ user, panelUrl, session }) =>
      sendResponse({ user: user ?? null, panelUrl, signedIn: !!session?.access_token }),
    );
    return true;
  }
  if (msg.kind === "SIGN_OUT") {
    chrome.storage.local.remove(["session", "user", "supabaseUrl", "supabaseAnonKey"]).then(() =>
      sendResponse({ ok: true }),
    );
    return true;
  }
});

// Wiadomość ze strony panelu (Google login flow)
chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
  if (msg?.kind !== "SUPABASE_SESSION") return;
  const origin = sender.origin || "";
  if (!/\.lovable\.(app|dev)$/.test(new URL(origin).hostname) && !origin.startsWith("http://localhost")) {
    sendResponse({ ok: false, error: "forbidden origin" });
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
