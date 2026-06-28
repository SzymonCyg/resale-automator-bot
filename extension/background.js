// Background service worker — pętla zadań, harmonogram.
const DEFAULT_PANEL_URL = "https://id-preview--ea1ec93b-9673-4248-b730-b54d73a1e3f8.lovable.app";

async function getConfig() {
  const { panelUrl, deviceToken } = await chrome.storage.local.get(["panelUrl", "deviceToken"]);
  return { panelUrl: panelUrl || DEFAULT_PANEL_URL, deviceToken };
}

async function api(path, opts = {}) {
  const { panelUrl, deviceToken } = await getConfig();
  if (!deviceToken) throw new Error("Wtyczka nie sparowana");
  const res = await fetch(`${panelUrl}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "X-Device-Token": deviceToken,
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("vintedTick", { periodInMinutes: 5 });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "vintedTick") return;
  try {
    await processTasks();
  } catch (e) {
    console.warn("[Vinted Manager] tick error:", e);
  }
});

async function processTasks() {
  const { deviceToken } = await getConfig();
  if (!deviceToken) return;
  const { tasks } = await api("/api/public/extension/tasks", { method: "GET" });
  if (!tasks?.length) return;

  // znajdź otwartą kartę vinted
  const tabs = await chrome.tabs.query({ url: ["*://*.vinted.pl/*", "*://*.vinted.fr/*", "*://*.vinted.de/*", "*://*.vinted.com/*"] });
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

// odbieranie syncu z content scriptu
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
});
