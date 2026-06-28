const $ = (id) => document.getElementById(id);

let rules = [];

function renderRules() {
  const container = $("rules");
  container.innerHTML = "";
  rules.forEach((r, idx) => {
    const div = document.createElement("div");
    div.className = "rule";
    div.innerHTML = `
      <div class="row">
        <div>
          <label>Typ</label>
          <select data-idx="${idx}" data-k="matchType">
            <option value="contains">zawiera</option>
            <option value="exact">dokładnie</option>
            <option value="starts_with">zaczyna się od</option>
            <option value="regex">regex</option>
          </select>
        </div>
        <div>
          <label>Wzorzec (np. "rezerwacja", "cena")</label>
          <input data-idx="${idx}" data-k="pattern" value="" />
        </div>
        <div>
          <button class="secondary" data-del="${idx}">Usuń</button>
        </div>
      </div>
      <label>Odpowiedź</label>
      <textarea data-idx="${idx}" data-k="response"></textarea>
      <div class="flex" style="margin-top: 8px">
        <input type="checkbox" data-idx="${idx}" data-k="enabled" style="width: auto" ${r.enabled !== false ? "checked" : ""} />
        <span class="muted">Aktywna</span>
      </div>
    `;
    container.appendChild(div);
    div.querySelector(`[data-k="matchType"]`).value = r.matchType || "contains";
    div.querySelector(`[data-k="pattern"]`).value = r.pattern || "";
    div.querySelector(`[data-k="response"]`).value = r.response || "";
  });

  container.querySelectorAll("[data-k]").forEach((el) => {
    el.addEventListener("input", () => {
      const idx = Number(el.dataset.idx);
      const k = el.dataset.k;
      const v = el.type === "checkbox" ? el.checked : el.value;
      rules[idx][k] = v;
    });
  });
  container.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", () => {
      rules.splice(Number(btn.dataset.del), 1);
      renderRules();
    });
  });
}

async function load() {
  const { settings } = await chrome.storage.local.get(["settings"]);
  const s = settings || {};
  $("bumpEnabled").checked = !!s.bumpEnabled;
  $("bumpInterval").value = s.bumpIntervalHours || 8;
  rules = Array.isArray(s.replies) ? [...s.replies] : [];
  renderRules();
}

$("addRule").addEventListener("click", () => {
  rules.push({ matchType: "contains", pattern: "", response: "", enabled: true });
  renderRules();
});

$("save").addEventListener("click", async () => {
  const settings = {
    bumpEnabled: $("bumpEnabled").checked,
    bumpIntervalHours: Math.max(3, Math.min(168, Number($("bumpInterval").value) || 8)),
    replies: rules.filter((r) => r.pattern && r.response),
  };
  await chrome.runtime.sendMessage({ kind: "SAVE_SETTINGS", settings });
  $("status").textContent = "✓ Zapisano";
  setTimeout(() => ($("status").textContent = ""), 2000);
});

load();
