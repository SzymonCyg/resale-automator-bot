const $ = (id) => document.getElementById(id);
const DEFAULT_PANEL_URL = "https://resale-automator-bot.lovable.app";

async function refresh() {
  const status = await chrome.runtime.sendMessage({ kind: "GET_STATUS" });
  if (status?.signedIn) {
    $("signedOut").style.display = "none";
    $("signedIn").style.display = "block";
    const who = status.user?.email ?? status.user?.id ?? "konto Google";
    $("signedInStatus").textContent = `✓ Zalogowano jako ${who}`;
  } else {
    $("signedOut").style.display = "block";
    $("signedIn").style.display = "none";
    $("panelUrl").value = status?.panelUrl || DEFAULT_PANEL_URL;
  }
}

$("signin").addEventListener("click", async () => {
  const panelUrl = ($("panelUrl").value.trim() || DEFAULT_PANEL_URL).replace(/\/$/, "");
  await chrome.storage.local.set({ panelUrl });
  await chrome.tabs.create({ url: `${panelUrl}/extension-connect?extId=${chrome.runtime.id}` });
  $("msg").innerHTML = '<div class="status ok">Otwarto panel — zaloguj się i wróć tutaj.</div>';
  const listener = (changes) => {
    if (changes.session) {
      chrome.storage.onChanged.removeListener(listener);
      refresh();
    }
  };
  chrome.storage.onChanged.addListener(listener);
});

$("openPanel").addEventListener("click", () =>
  chrome.tabs.create({ url: chrome.runtime.getURL("panel.html") }),
);
$("openOptions").addEventListener("click", () => chrome.runtime.openOptionsPage());

$("signout").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ kind: "SIGN_OUT" });
  refresh();
});

refresh();
