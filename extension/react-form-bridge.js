// MAIN-world script wstrzykiwany na /items/new i /items/*/edit.
// Pozwala content-scriptowi czytać / nadpisywać stan formularza React Vinted
// poprzez bezpośredni dispatch do useState hooka oraz natywne settery na inputach.
//
// Protokół postMessage:
//   request:  { source: "VM_RF_REQ", id, action, ...payload }
//   response: { source: "VM_RF_RES", id, ok, data?, error? }
//
// Akcje:
//   ping       — { ready: true }
//   read       — zwraca aktualny memoizedState formularza
//   write      — merge { ...state, ...partial } i dispatch
//   setInput   — ustawia value na danym selektorze (input/textarea) + dispatch
//   clickSave  — klika przycisk zapisz
//
(function () {
  if (window.__VM_RF_BRIDGE__) return;
  window.__VM_RF_BRIDGE__ = true;

  const FIELDS = [
    "catalogId", "brandId", "title", "description",
    "colorIds", "sizeId", "price", "packageSizeId",
  ];
  const MIN_MATCH = 5;
  const MAX_DEPTH = 60;

  function findFiber(el) {
    if (!el) return null;
    const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"));
    return key ? el[key] : null;
  }

  function getSaveButton() {
    return document.querySelector('[data-testid="upload-form-save-button"]')
      || document.querySelector('[data-testid="upload-form-save-draft-button"]')
      || document.querySelector("form");
  }

  function findFormHook() {
    let fiber = findFiber(getSaveButton());
    for (let i = 0; i < MAX_DEPTH && fiber; i += 1, fiber = fiber.return) {
      let hook = fiber.memoizedState;
      while (hook) {
        const st = hook.memoizedState;
        if (st && typeof st === "object" && !Array.isArray(st)) {
          const matches = FIELDS.filter((k) => k in st).length;
          if (matches >= MIN_MATCH && hook.queue?.dispatch) {
            return { state: st, dispatch: hook.queue.dispatch };
          }
        }
        hook = hook.next;
      }
    }
    return null;
  }

  function setNativeValue(el, value) {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (!setter) return false;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function respond(id, payload) {
    window.postMessage({ source: "VM_RF_RES", id, ...payload }, window.location.origin);
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.source !== "VM_RF_REQ" || !msg.id) return;

    try {
      switch (msg.action) {
        case "ping":
          respond(msg.id, { ok: true, data: { ready: !!getSaveButton() && !!findFormHook() } });
          return;
        case "read": {
          const hook = findFormHook();
          if (!hook) return respond(msg.id, { ok: false, error: "NO_FORM_STATE" });
          respond(msg.id, { ok: true, data: JSON.parse(JSON.stringify(hook.state)) });
          return;
        }
        case "write": {
          const hook = findFormHook();
          if (!hook) return respond(msg.id, { ok: false, error: "NO_FORM_STATE" });
          hook.dispatch({ ...hook.state, ...(msg.partial || {}) });
          respond(msg.id, { ok: true });
          return;
        }
        case "setInput": {
          const el = document.querySelector(msg.selector);
          if (!el) return respond(msg.id, { ok: false, error: "NO_ELEMENT" });
          const ok = setNativeValue(el, String(msg.value ?? ""));
          respond(msg.id, { ok });
          return;
        }
        case "clickSave": {
          const btn = document.querySelector('[data-testid="upload-form-save-button"]');
          if (!btn) return respond(msg.id, { ok: false, error: "NO_SAVE_BUTTON" });
          btn.scrollIntoView({ block: "center" });
          btn.click();
          respond(msg.id, { ok: true });
          return;
        }
        default:
          respond(msg.id, { ok: false, error: "UNKNOWN_ACTION" });
      }
    } catch (err) {
      respond(msg.id, { ok: false, error: err?.message || String(err) });
    }
  });
})();
