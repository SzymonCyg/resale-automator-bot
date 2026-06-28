const $ = (id) => document.getElementById(id);

async function refresh() {
  const { deviceToken, panelUrl } = await chrome.storage.local.get(["deviceToken", "panelUrl"]);
  if (deviceToken) {
    $("unpaired").style.display = "none";
    $("paired").style.display = "block";
    $("pairedStatus").textContent = `✓ Sparowane z ${panelUrl}`;
  } else {
    $("unpaired").style.display = "block";
    $("paired").style.display = "none";
    if (panelUrl) $("panelUrl").value = panelUrl;
  }
}

$("pair").addEventListener("click", async () => {
  const panelUrl = $("panelUrl").value.trim().replace(/\/$/, "");
  const code = $("code").value.trim().toUpperCase();
  const msg = $("msg");
  msg.className = "status";
  msg.textContent = "Parowanie...";
  try {
    const res = await fetch(`${panelUrl}/api/public/extension/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        label: "Chrome — " + navigator.platform,
        userAgent: navigator.userAgent,
      }),
    });
    if (!res.ok) throw new Error(await res.text());
    const { deviceToken } = await res.json();
    await chrome.storage.local.set({ deviceToken, panelUrl });
    msg.className = "status ok";
    msg.textContent = "Sparowano!";
    refresh();
  } catch (e) {
    msg.className = "status err";
    msg.textContent = e.message;
  }
});

$("unpair").addEventListener("click", async () => {
  await chrome.storage.local.remove(["deviceToken"]);
  refresh();
});

refresh();
