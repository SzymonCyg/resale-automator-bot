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
    if (!msg || msg.source !== "VM_CONTENT" || !msg.kind || !msg.id) return;

    try {
      const csrf = document.querySelector('meta[name="csrf-token"]')?.content;
      const anon = getCookie("anon_id") || getCookie("anonymous-locale");
      const accessToken = getCookie("access_token_web");

      if (msg.kind === "UPLOAD_PHOTO") {
        const form = new FormData();
        const blob = await dataUrlToBlob(msg.dataUrl);
        form.append("photo[type]", "item");
        if (msg.tempUuid) form.append("photo[temp_uuid]", msg.tempUuid);
        form.append("photo[file]", blob, msg.filename || `photo-${Date.now()}.jpg`);

        const headers = new Headers();
        if (csrf) headers.set("X-CSRF-Token", csrf);
        if (anon) headers.set("X-Anon-Id", decodeURIComponent(anon));
        if (accessToken) headers.set("Authorization", `Bearer ${decodeURIComponent(accessToken)}`);
        headers.set("X-Requested-With", "XMLHttpRequest");

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
          { source: "VM_PAGE_BRIDGE", id: msg.id, ok: true, response: await toPayload(response) },
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
      if (accessToken && !headers.has("Authorization")) {
        headers.set("Authorization", `Bearer ${decodeURIComponent(accessToken)}`);
      }
      if (!init.skipXRequestedWith && !headers.has("X-Requested-With")) headers.set("X-Requested-With", "XMLHttpRequest");
      if (!headers.has("Locale")) headers.set("Locale", document.documentElement.lang || navigator.language || "pl");
      if (String(url.pathname).includes("/api/v2/item_upload/items")) {
        headers.set("X-Upload-Form", "true");
        headers.set("X-Enable-Dynamic-Attribute-Condition", "true");
        headers.set("X-Enable-Dynamic-Attribute-Video-Game-Rating", "true");
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
        { source: "VM_PAGE_BRIDGE", id: msg.id, ok: true, response: await toPayload(response) },
        window.location.origin,
      );
    } catch (error) {
      window.postMessage(
        {
          source: "VM_PAGE_BRIDGE",
          id: msg.id,
          ok: false,
          error: `${msg.kind}${msg.path ? ` ${msg.path}` : ""}: ${error?.message || String(error)}`,
        },
        window.location.origin,
      );
    }
  });
})();