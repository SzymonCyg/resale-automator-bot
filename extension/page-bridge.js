(function () {
  const BRIDGE_VERSION = "0.7.4";
  if (window.__VM_PAGE_BRIDGE_VERSION__ === BRIDGE_VERSION) return;
  window.__VM_PAGE_BRIDGE__ = true;
  window.__VM_PAGE_BRIDGE_VERSION__ = BRIDGE_VERSION;

  function getCookie(name) {
    return document.cookie
      .split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith(name + "="))
      ?.split("=")[1];
  }

  function readCsrfToken() {
    return window.__VM_CSRF_TOKEN__
      || document.querySelector('meta[name="csrf-token"]')?.content
      || document.documentElement.innerHTML.match(/CSRF_TOKEN\\?"\s*:\s*\\?"([^"\\]+)/i)?.[1]
      || document.documentElement.innerHTML.match(/"csrfToken"\s*:\s*"([^"]+)"/i)?.[1]
      || document.documentElement.innerHTML.match(/"csrf_token"\s*:\s*"([^"]+)"/i)?.[1]
      || "";
  }

  // Subdomena api.vinted.{tld} obsługuje wyłącznie auth mobilnego API i z poziomu
  // przeglądarki zwraca HTML 404 dla /api/v2/*. Wszystkie zapytania lecą więc
  // same-origin (www.vinted.{tld}) — wtedy lecą cookies sesji i CSRF jest ważny.
  function buildUrl(path) {
    if (/^https?:\/\//i.test(path)) return path;
    return new URL(path, window.location.origin).toString();
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
      url: response.url,
      redirected: response.redirected,
      text,
      json,
      contentType: response.headers.get("content-type") || "",
    };
  }

  async function dataUrlToBlob(dataUrl) {
    const [meta, raw] = String(dataUrl).split(",");
    const mime = meta.match(/^data:([^;]+)/)?.[1] || "image/jpeg";
    const binary = meta.includes(";base64") ? atob(raw) : decodeURIComponent(raw);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  window.addEventListener("message", async (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.source !== "VM_CONTENT_058" || !msg.kind || !msg.id) return;

    try {
      const csrf = msg.csrfToken || readCsrfToken();
      if (msg.csrfToken) window.__VM_CSRF_TOKEN__ = msg.csrfToken;
      const anon = getCookie("anon_id") || getCookie("anonymous-locale");
      const locale = document.documentElement.lang || navigator.language || "pl";

      if (msg.kind === "UPLOAD_PHOTO") {
        const form = new FormData();
        const blob = await dataUrlToBlob(msg.dataUrl);
        form.append("photo[type]", "item");
        if (msg.tempUuid) form.append("photo[temp_uuid]", msg.tempUuid);
        form.append("photo[file]", blob, msg.filename || `photo-${Date.now()}.jpg`);

        const headers = new Headers();
        if (csrf) headers.set("X-CSRF-Token", csrf);
        if (anon) headers.set("X-Anon-Id", decodeURIComponent(anon));
        headers.set("Accept", "application/json, text/plain, */*");
        headers.set("Locale", locale);

        // Same-origin upload — Vinted akceptuje /api/v2/photos na www.vinted.{tld}
        const url = buildUrl("/api/v2/photos");
        const response = await fetch(url, {
          method: "POST",
          headers,
          credentials: "include",
          mode: "same-origin",
          cache: "no-store",
          referrer: new URL("/items/new", window.location.origin).toString(),
          body: form,
        });

        window.postMessage(
          { source: "VM_PAGE_BRIDGE_058", id: msg.id, ok: true, response: await toPayload(response) },
          window.location.origin,
        );
        return;
      }

      if (msg.kind !== "FETCH") return;

      const init = msg.init || {};
      const url = buildUrl(msg.path);
      const headers = new Headers(init.headers || {});
      if (init.skipXRequestedWith) headers.delete("X-Requested-With");
      if (csrf && !headers.has("X-CSRF-Token")) headers.set("X-CSRF-Token", csrf);
      if (anon && !headers.has("X-Anon-Id")) headers.set("X-Anon-Id", decodeURIComponent(anon));
      if (!init.skipXRequestedWith && !headers.has("X-Requested-With")) headers.set("X-Requested-With", "XMLHttpRequest");
      if (!headers.has("Locale")) headers.set("Locale", locale);

      const response = await fetch(url, {
        ...init,
        headers,
        credentials: "include",
        mode: "same-origin",
        cache: init.cache || "no-store",
        referrer: init.referrer,
      });

      window.postMessage(
        { source: "VM_PAGE_BRIDGE_058", id: msg.id, ok: true, response: await toPayload(response) },
        window.location.origin,
      );
    } catch (error) {
      window.postMessage(
        {
          source: "VM_PAGE_BRIDGE_058",
          id: msg.id,
          ok: false,
          error: `${msg.kind}${msg.path ? ` ${msg.path}` : ""}: ${error?.message || String(error)}`,
        },
        window.location.origin,
      );
    }
  });
})();
