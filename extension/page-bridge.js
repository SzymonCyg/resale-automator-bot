(function () {
  const BRIDGE_VERSION = "0.5.8";
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

      if (msg.kind === "UPLOAD_PHOTO") {
        const form = new FormData();
        const blob = await dataUrlToBlob(msg.dataUrl);
        form.append("photo[type]", "item");
        if (msg.tempUuid) form.append("photo[temp_uuid]", msg.tempUuid);
        form.append("photo[file]", blob, msg.filename || `photo-${Date.now()}.jpg`);

        const headers = new Headers();
        if (csrf) headers.set("X-CSRF-Token", csrf);
        if (anon) headers.set("X-Anon-Id", decodeURIComponent(anon));
        headers.set("X-Enable-Multiple-Size-Groups", "true");
        headers.set("Accept", "application/json, text/plain, */*");
        headers.set("Locale", document.documentElement.lang || navigator.language || "pl");

        // To musi odpowiadać zwykłemu webowemu formularzowi Vinted: cookies + CSRF,
        // bez nagłówka Authorization i bez /web/ prefixu, inaczej endpoint zwraca code 106.
        const response = await fetch(new URL("/api/v2/photos", window.location.origin).toString(), {
          method: "POST",
          headers,
          credentials: "include",
          mode: "cors",
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

      const url = new URL(msg.path, window.location.origin);
      if (url.origin !== window.location.origin) throw new Error("Zablokowano obcy origin");

      const init = msg.init || {};
      const headers = new Headers(init.headers || {});
      if (init.skipXRequestedWith) headers.delete("X-Requested-With");
      if (csrf && !headers.has("X-CSRF-Token")) headers.set("X-CSRF-Token", csrf);
      if (anon && !headers.has("X-Anon-Id")) headers.set("X-Anon-Id", decodeURIComponent(anon));
      if (!init.skipXRequestedWith && !headers.has("X-Requested-With")) headers.set("X-Requested-With", "XMLHttpRequest");
      if (!headers.has("Locale")) headers.set("Locale", document.documentElement.lang || navigator.language || "pl");
      if (String(url.pathname).includes("/api/v2/item_upload/items")) {
        headers.set("X-Upload-Form", "true");
        headers.set("X-Enable-Dynamic-Attribute-Condition", "true");
        headers.set("X-Enable-Dynamic-Attribute-Video-Game-Rating", "true");
        headers.set("X-Enable-Multiple-Size-Groups", "true");
      }

      const response = await fetch(url.toString(), {
        ...init,
        headers,
        credentials: "include",
        mode: init.mode || "cors",
        cache: init.cache || "no-store",
        referrer: init.referrer || (String(url.pathname).includes("/api/v2/item_upload/items")
          ? new URL("/items/new", window.location.origin).toString()
          : undefined),
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