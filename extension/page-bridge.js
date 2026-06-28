(function () {
  if (window.__VM_PAGE_BRIDGE__) return;
  window.__VM_PAGE_BRIDGE__ = true;

  function getCookie(name) {
    return document.cookie
      .split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith(name + "="))
      ?.split("=")[1];
  }

  async function toPayload(response) {
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      text,
      json,
      contentType: response.headers.get("content-type") || "",
    };
  }

  window.addEventListener("message", async (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.source !== "VM_CONTENT" || msg.kind !== "FETCH" || !msg.id) return;

    try {
      const url = new URL(msg.path, window.location.origin);
      if (url.origin !== window.location.origin) throw new Error("Zablokowano obcy origin");

      const init = msg.init || {};
      const headers = new Headers(init.headers || {});
      const csrf = document.querySelector('meta[name="csrf-token"]')?.content;
      const anon = getCookie("anon_id") || getCookie("anonymous-locale");
      const accessToken = getCookie("access_token_web");
      if (csrf && !headers.has("X-CSRF-Token")) headers.set("X-CSRF-Token", csrf);
      if (anon && !headers.has("X-Anon-Id")) headers.set("X-Anon-Id", decodeURIComponent(anon));
      if (accessToken && !headers.has("Authorization")) {
        headers.set("Authorization", `Bearer ${decodeURIComponent(accessToken)}`);
      }
      if (!headers.has("X-Requested-With")) headers.set("X-Requested-With", "XMLHttpRequest");

      const response = await fetch(url.toString(), {
        ...init,
        headers,
        credentials: "include",
        mode: "same-origin",
      });

      window.postMessage(
        { source: "VM_PAGE_BRIDGE", id: msg.id, ok: true, response: await toPayload(response) },
        window.location.origin,
      );
    } catch (error) {
      window.postMessage(
        { source: "VM_PAGE_BRIDGE", id: msg.id, ok: false, error: error?.message || String(error) },
        window.location.origin,
      );
    }
  });
})();