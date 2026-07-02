(function () {
  const BRIDGE_VERSION = "1.0.22";
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

  function extractCsrfFromScripts() {
    const scripts = document.querySelectorAll("script");
    const patterns = [
      /"CSRF_TOKEN\\?"\s*:\s*\\?"([^"\\]+)/,
      /\\"CSRF_TOKEN\\":\\"([^"\\]+)/,
      /"csrfToken\\?"\s*:\s*\\?"([^"\\]+)/,
    ];
    for (const s of scripts) {
      const txt = s.textContent || "";
      if (!txt.includes("CSRF") && !txt.includes("csrf")) continue;
      for (const re of patterns) {
        const m = txt.match(re);
        if (m && m[1]) return m[1];
      }
    }
    return "";
  }

  function readCsrfToken() {
    return window.__VM_CSRF_TOKEN__
      || extractCsrfFromScripts()
      || document.querySelector('meta[name="csrf-token"]')?.content
      || document.documentElement.innerHTML.match(/"CSRF_TOKEN\\?"\s*:\s*\\?"([^"\\]+)/i)?.[1]
      || document.documentElement.innerHTML.match(/"csrfToken"\s*:\s*"([^"]+)"/i)?.[1]
      || document.documentElement.innerHTML.match(/"csrf_token"\s*:\s*"([^"]+)"/i)?.[1]
      || "";
  }

  function buildUrl(path) {
    if (/^https?:\/\//i.test(path)) return path;
    return new URL(path, window.location.origin).toString();
  }

  function detectCaptchaUrl(json, text) {
    let data = json;
    if (!data && text) { try { data = JSON.parse(text); } catch {} }
    const u = data && typeof data === "object" ? data.url : null;
    if (typeof u === "string" && u.includes("captcha-delivery.com")) return u;
    return null;
  }

  async function toPayload(response, requestHeaders) {
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    const respHeaders = {};
    try {
      for (const [k, v] of response.headers.entries()) respHeaders[k] = v;
    } catch {}
    const sentHeaders = {};
    try {
      if (requestHeaders) for (const [k, v] of requestHeaders.entries()) sentHeaders[k] = (k.toLowerCase().includes("csrf") || k.toLowerCase().includes("anon")) ? (v ? v.slice(0,8) + "…" : "") : v;
    } catch {}
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      url: response.url,
      redirected: response.redirected,
      text,
      json,
      contentType: response.headers.get("content-type") || "",
      captchaUrl: response.status === 403 ? detectCaptchaUrl(json, text) : null,
      respHeaders,
      sentHeaders,
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
        form.append("photo[file]", blob, msg.filename || `photo-${Date.now()}.jpg`);
        const tempUuid = msg.tempUuid
          || (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
        form.append("photo[temp_uuid]", tempUuid);


        const headers = new Headers();
        if (csrf) headers.set("X-CSRF-Token", csrf);
        if (anon) headers.set("X-Anon-Id", decodeURIComponent(anon));
        headers.set("Accept", "application/json, text/plain, */*");
        headers.set("Locale", locale);

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

      if (msg.kind === "SOLVE_CAPTCHA") {
        const captchaUrl = msg.captchaUrl;
        const timeout = msg.timeout || 120000;
        const CAPTCHA_ORIGIN = "https://geo.captcha-delivery.com";
        const result = await new Promise((resolve) => {
          const containerId = `vm-dd-captcha-${Date.now()}`;
          const container = document.createElement("div");
          container.id = containerId;
          Object.assign(container.style, {
            height: "100vh", width: "100%", position: "fixed",
            top: "0", left: "0", zIndex: "2147483647", backgroundColor: "#ffffff",
          });
          const banner = document.createElement("div");
          Object.assign(banner.style, {
            position: "fixed", top: "0", left: "0", width: "100%", padding: "10px 16px",
            background: "#0f1420", color: "#5eead4", fontFamily: "system-ui, sans-serif",
            fontSize: "14px", fontWeight: "600", zIndex: "2147483647", boxSizing: "border-box",
          });
          banner.textContent = "Vinted prosi o weryfikację — rozwiąż captchę aby kontynuować automatyzację";
          const iframe = document.createElement("iframe");
          iframe.src = captchaUrl;
          iframe.width = "100%";
          iframe.height = "100%";
          iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms");
          iframe.setAttribute("allow", "accelerometer; gyroscope; magnetometer");
          iframe.setAttribute("frameborder", "0");
          Object.assign(iframe.style, { height: "100vh", width: "100%", border: "0", marginTop: "40px" });
          container.appendChild(banner);
          container.appendChild(iframe);

          let timer;
          function cleanup() {
            clearTimeout(timer);
            window.removeEventListener("message", onMsg);
            container.remove();
          }
          function onMsg(ev) {
            if (ev.origin !== CAPTCHA_ORIGIN) return;
            try {
              const data = JSON.parse(ev.data);
              if (data.responseType === "hardblock") { cleanup(); resolve({ solved: false, hardblock: true }); }
              else if (data.eventType === "passed") {
                if (data.cookie) { try { document.cookie = data.cookie; } catch {} }
                cleanup();
                resolve({ solved: true });
              }
            } catch {}
          }
          timer = setTimeout(() => { cleanup(); resolve({ solved: false, timeout: true }); }, timeout);
          window.addEventListener("message", onMsg);
          document.body.insertAdjacentElement("afterbegin", container);
        });
        window.postMessage(
          { source: "VM_PAGE_BRIDGE_058", id: msg.id, ok: true, response: result },
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

      let fetchMode = "same-origin";
      try {
        const urlOrigin = new URL(url).origin;
        if (urlOrigin !== window.location.origin) fetchMode = "cors";
      } catch {}

      let lastHeaders = headers;
      const doFetch = (extraHeaders) => {
        const h = new Headers(headers);
        if (extraHeaders) for (const [k, v] of Object.entries(extraHeaders)) h.set(k, v);
        lastHeaders = h;
        return fetch(url, {
          ...init,
          headers: h,
          credentials: "include",
          mode: fetchMode,
          cache: init.cache || "no-store",
          referrer: init.referrer,
          referrerPolicy: init.referrer ? "unsafe-url" : undefined,
        });
      };

      let response = await doFetch();

      if ((response.status === 401 || response.status === 403) && (init.method && init.method !== "GET")) {
        try {
          delete window.__VM_CSRF_TOKEN__;
          window.csrfTokenCache = null;
          await fetch(new URL("/web/api/auth/refresh", window.location.origin).toString(), {
            method: "POST",
            credentials: "include",
            cache: "no-store",
          }).catch(() => {});
          const freshCsrf = extractCsrfFromScripts() || readCsrfToken();
          if (freshCsrf) {
            window.__VM_CSRF_TOKEN__ = freshCsrf;
            response = await doFetch({ "X-CSRF-Token": freshCsrf });
          }
        } catch {}
      }

      window.postMessage(
        { source: "VM_PAGE_BRIDGE_058", id: msg.id, ok: true, response: await toPayload(response, lastHeaders) },
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
