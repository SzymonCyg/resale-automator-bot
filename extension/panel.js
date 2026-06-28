// Panel UI — komunikuje się z content script na otwartej karcie vinted.*
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

let items = [];
let selected = new Set();
let relistState = []; // {item, price, photos:[{dataUrl, rotation, crop}]}

// ---------- TABS ----------
$$(".tab").forEach((t) =>
  t.addEventListener("click", () => {
    $$(".tab").forEach((x) => x.classList.toggle("active", x === t));
    $$(".view").forEach((v) => v.classList.toggle("hidden", v.dataset.view !== t.dataset.tab));
  }),
);

// ---------- BACKGROUND BRIDGE ----------
function bg(kind, payload) {
  return new Promise((resolve) =>
    chrome.runtime.sendMessage({ kind, ...payload }, (r) => resolve(r)),
  );
}

async function getVintedTab() {
  // W trybie embedded (iframe na vinted.*) — preferuj aktywną kartę.
  const isEmbedded = window.location.search.includes("embedded=1");
  if (isEmbedded) {
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (active && /vinted\./.test(active.url || "")) return active;
  }
  const tabs = await chrome.tabs.query({
    url: ["*://*.vinted.pl/*","*://*.vinted.fr/*","*://*.vinted.de/*","*://*.vinted.es/*","*://*.vinted.it/*","*://*.vinted.nl/*","*://*.vinted.cz/*","*://*.vinted.sk/*","*://*.vinted.co.uk/*"],
  });
  return tabs[0] ?? null;
}

function tabMsg(tabId, msg) {
  return new Promise((resolve, reject) =>
    chrome.tabs.sendMessage(tabId, msg, (r) =>
      chrome.runtime.lastError ? reject(chrome.runtime.lastError) : resolve(r),
    ),
  );
}

// ---------- WHOAMI ----------
(async () => {
  const status = await bg("GET_STATUS");
  $("#whoami").textContent = status?.user?.email ? `Zalogowano: ${status.user.email}` : "Niezalogowano do panelu";
})();

// ---------- ITEMS ----------
async function loadItems() {
  $("#itemsStatus").textContent = "Pobieram...";
  const tab = await getVintedTab();
  if (!tab) {
    $("#itemsStatus").textContent = "Otwórz zalogowaną kartę vinted.*";
    return;
  }
  try {
    const r = await tabMsg(tab.id, { kind: "FETCH_ITEMS" });
    if (!r?.ok) throw new Error(r?.error || "fetch fail");
    items = r.items || [];
    renderItems();
    $("#itemsStatus").textContent = `${items.length} przedmiotów (${r.username || "?"})`;
  } catch (e) {
    $("#itemsStatus").textContent = "Błąd: " + e.message;
  }
}

function renderItems() {
  const body = $("#itemsBody");
  if (!items.length) {
    body.innerHTML = `<tr><td colspan="8" class="empty">Brak przedmiotów.</td></tr>`;
    return;
  }
  body.innerHTML = items
    .map(
      (it) => `
    <tr data-id="${it.id}">
      <td><input type="checkbox" class="sel" data-id="${it.id}" ${selected.has(String(it.id)) ? "checked" : ""}/></td>
      <td>${it.photo_url ? `<img class="thumb" src="${it.photo_url}" />` : `<div class="thumb"></div>`}</td>
      <td><a href="${it.url || "#"}" target="_blank">${escapeHtml(it.title || "")}</a><br/><span class="muted">#${it.id}</span></td>
      <td class="muted">${escapeHtml(it.brand || "")} ${it.size_title ? "· " + escapeHtml(it.size_title) : ""}</td>
      <td style="text-align:right"><b>${it.price} ${it.currency || ""}</b></td>
      <td style="text-align:right" class="muted">${it.views ?? 0}</td>
      <td style="text-align:right" class="muted">${it.favourite_count ?? 0}</td>
      <td><span class="pill">${it.status || "—"}</span></td>
    </tr>`,
    )
    .join("");
  body.querySelectorAll(".sel").forEach((cb) =>
    cb.addEventListener("change", () => {
      const id = cb.dataset.id;
      cb.checked ? selected.add(id) : selected.delete(id);
      updateSel();
    }),
  );
}

function updateSel() {
  $("#selCount").textContent = `${selected.size} zaznaczonych`;
  $("#relistBtn").disabled = selected.size === 0;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

$("#refreshItems").addEventListener("click", loadItems);
$("#syncItems").addEventListener("click", async () => {
  $("#itemsStatus").textContent = "Synchronizuję...";
  const tab = await getVintedTab();
  if (!tab) { $("#itemsStatus").textContent = "Otwórz zalogowaną kartę vinted.*"; return; }
  try {
    const r = await tabMsg(tab.id, { kind: "SYNC_NOW" });
    if (!r?.ok) throw new Error(r?.error || "fail");
    $("#itemsStatus").textContent = `✓ Zsynchronizowano ${r.count} przedmiotów (${r.username})`;
  } catch (e) {
    $("#itemsStatus").textContent = "Błąd synchr.: " + e.message;
  }
});
$("#selAll").addEventListener("change", (e) => {
  const checked = e.target.checked;
  items.forEach((it) => (checked ? selected.add(String(it.id)) : selected.delete(String(it.id))));
  renderItems();
  updateSel();
});

// ---------- RELIST ----------
$("#relistBtn").addEventListener("click", openRelist);
$("#closeRelist").addEventListener("click", closeRelist);
$("#cancelRelist").addEventListener("click", closeRelist);

async function openRelist() {
  const chosen = items.filter((i) => selected.has(String(i.id)));
  $("#relistCount").textContent = chosen.length;
  $("#relistLog").innerHTML = "";
  $("#relistModal").classList.remove("hidden");

  // Pobierz pełne dane (w tym wszystkie zdjęcia) z karty vinted
  const tab = await getVintedTab();
  const list = $("#relistList");
  list.innerHTML = `<p class="muted" style="padding:16px">Wczytuję zdjęcia...</p>`;
  relistState = [];
  for (const it of chosen) {
    try {
      const r = await tabMsg(tab.id, { kind: "FETCH_ITEM_DETAIL", id: it.id });
      const detail = r?.item || it;
      const photoUrls = detail.photos?.map((p) => p.full_size_url || p.url) || (it.photo_url ? [it.photo_url] : []);
      const photos = await Promise.all(photoUrls.map(loadPhoto));
      relistState.push({
        item: detail,
        price: Number(it.price) || 0,
        currency: it.currency,
        photos: photos.map((p) => ({ ...p, rotation: 0, crop: null })),
      });
    } catch (e) {
      log(`✗ ${it.title}: ${e.message}`, "err");
    }
  }
  renderRelist();
}

function closeRelist() {
  $("#relistModal").classList.add("hidden");
  relistState = [];
}

async function loadPhoto(url) {
  // wczytaj jako dataURL przez fetch (content_script tab nie potrzebne — Vinted serwuje obrazki publicznie)
  const res = await fetch(url);
  const blob = await res.blob();
  const dataUrl = await new Promise((res2) => {
    const fr = new FileReader();
    fr.onload = () => res2(fr.result);
    fr.readAsDataURL(blob);
  });
  const img = await new Promise((res2) => {
    const i = new Image();
    i.onload = () => res2(i);
    i.src = dataUrl;
  });
  return { dataUrl, w: img.naturalWidth, h: img.naturalHeight, url };
}

function renderRelist() {
  const list = $("#relistList");
  if (!relistState.length) {
    list.innerHTML = `<p class="muted" style="padding:16px">Brak przedmiotów do edycji.</p>`;
    return;
  }
  list.innerHTML = relistState
    .map(
      (st, i) => `
    <div class="relist-item" data-i="${i}">
      <div>
        <h3>${escapeHtml(st.item.title || "")}</h3>
        <p class="muted">#${st.item.id} · ${st.item.brand_title || st.item.brand || ""}</p>
        <div class="price-edit">
          <label class="muted">Cena:</label>
          <input type="number" step="0.01" class="price-in" value="${st.price}" />
          <span class="muted">${st.currency || ""}</span>
        </div>
      </div>
      <div>
        <div class="photos">
          ${st.photos
            .map(
              (_, j) => `
            <div class="photo-edit" data-j="${j}">
              <canvas width="240" height="240"></canvas>
              <div class="actions">
                <button data-act="rotL">⟲</button>
                <button data-act="rot1">+1°</button>
                <button data-act="rotN1">-1°</button>
                <button data-act="rotR">⟳</button>
                <button data-act="reset">×</button>
              </div>
            </div>`,
            )
            .join("")}
        </div>
      </div>
    </div>`,
    )
    .join("");

  // Bind canvas + actions
  $$(".relist-item").forEach((row) => {
    const i = Number(row.dataset.i);
    row.querySelector(".price-in").addEventListener("input", (e) => {
      relistState[i].price = Number(e.target.value) || 0;
    });
    row.querySelectorAll(".photo-edit").forEach((pe) => {
      const j = Number(pe.dataset.j);
      drawPhoto(i, j);
      pe.querySelectorAll("button").forEach((b) =>
        b.addEventListener("click", () => {
          const p = relistState[i].photos[j];
          const a = b.dataset.act;
          if (a === "rotL") p.rotation -= 90;
          else if (a === "rotR") p.rotation += 90;
          else if (a === "rot1") p.rotation += 1;
          else if (a === "rotN1") p.rotation -= 1;
          else if (a === "reset") { p.rotation = 0; p.crop = null; }
          drawPhoto(i, j);
        }),
      );
    });
  });
}

function drawPhoto(i, j) {
  const p = relistState[i].photos[j];
  const canvas = document.querySelector(`.relist-item[data-i="${i}"] .photo-edit[data-j="${j}"] canvas`);
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const img = new Image();
  img.onload = () => {
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((p.rotation * Math.PI) / 180);
    const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
    const w = img.width * scale, h = img.height * scale;
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
  };
  img.src = p.dataUrl;
}

// Bulk price
$("#applyBulkPrice").addEventListener("click", () => {
  const op = $("#bulkPriceOp").value;
  const v = Number($("#bulkPriceVal").value) || 0;
  if (op === "none") return;
  relistState.forEach((st) => {
    if (op === "set") st.price = v;
    else if (op === "add") st.price = +(st.price + v).toFixed(2);
    else if (op === "sub") st.price = Math.max(0, +(st.price - v).toFixed(2));
    else if (op === "pct") st.price = +(st.price * (1 + v / 100)).toFixed(2);
  });
  renderRelist();
});

// Eksport zedytowanego zdjęcia → blob
async function exportPhoto(p, mode) {
  let rotation = p.rotation;
  if (mode === "auto" && rotation === 0) rotation = Math.random() < 0.5 ? 1 : -1;
  if (mode === "none") rotation = 0;
  const img = await new Promise((r) => {
    const i = new Image();
    i.onload = () => r(i);
    i.src = p.dataUrl;
  });
  const rad = (rotation * Math.PI) / 180;
  const sin = Math.abs(Math.sin(rad)), cos = Math.abs(Math.cos(rad));
  const w = img.width, h = img.height;
  const cw = Math.round(w * cos + h * sin);
  const ch = Math.round(w * sin + h * cos);
  const c = new OffscreenCanvas(cw, ch);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, cw, ch);
  ctx.translate(cw / 2, ch / 2);
  ctx.rotate(rad);
  ctx.drawImage(img, -w / 2, -h / 2);
  return await c.convertToBlob({ type: "image/jpeg", quality: 0.92 });
}

// RUN
$("#runRelist").addEventListener("click", async () => {
  const mode = document.querySelector("input[name=photoMode]:checked").value;
  const tab = await getVintedTab();
  if (!tab) return log("✗ Brak otwartej karty Vinted", "err");
  $("#runRelist").disabled = true;
  for (const st of relistState) {
    log(`→ ${st.item.title} (${st.price} ${st.currency})...`);
    try {
      const photos = [];
      for (const p of st.photos) {
        const blob = await exportPhoto(p, mode);
        const dataUrl = await new Promise((r) => {
          const fr = new FileReader();
          fr.onload = () => r(fr.result);
          fr.readAsDataURL(blob);
        });
        photos.push(dataUrl);
      }
      const r = await tabMsg(tab.id, {
        kind: "RELIST_ITEM",
        original: st.item,
        price: st.price,
        photos,
      });
      if (r?.ok) log(`✓ ${st.item.title} — nowy ID ${r.newId}`, "ok");
      else log(`✗ ${st.item.title}: ${r?.error || "fail"}`, "err");
    } catch (e) {
      log(`✗ ${st.item.title}: ${e.message}`, "err");
    }
  }
  $("#runRelist").disabled = false;
  log("— gotowe —", "ok");
});

function log(s, cls = "") {
  const el = $("#relistLog");
  const line = document.createElement("div");
  line.className = cls;
  line.textContent = s;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

// ---------- SETTINGS ----------
let rules = [];

async function loadSettings() {
  const { settings } = await chrome.storage.local.get(["settings"]);
  const s = settings || {};
  rules = Array.isArray(s.replies) ? [...s.replies] : [];
  renderRules();
}
function renderRules() {
  const c = $("#rules");
  c.innerHTML = "";
  rules.forEach((r, idx) => {
    const div = document.createElement("div");
    div.className = "rule";
    div.innerHTML = `
      <div class="row">
        <select data-idx="${idx}" data-k="matchType">
          <option value="contains">zawiera</option>
          <option value="exact">dokładnie</option>
          <option value="starts_with">zaczyna się od</option>
          <option value="regex">regex</option>
        </select>
        <input type="text" data-idx="${idx}" data-k="pattern" placeholder="wzorzec" />
        <button class="btn danger" data-del="${idx}">Usuń</button>
      </div>
      <textarea data-idx="${idx}" data-k="response" placeholder="Odpowiedź"></textarea>
      <label class="muted"><input type="checkbox" data-idx="${idx}" data-k="enabled" ${r.enabled !== false ? "checked" : ""} /> Aktywna</label>
    `;
    c.appendChild(div);
    div.querySelector('[data-k="matchType"]').value = r.matchType || "contains";
    div.querySelector('[data-k="pattern"]').value = r.pattern || "";
    div.querySelector('[data-k="response"]').value = r.response || "";
  });
  c.querySelectorAll("[data-k]").forEach((el) =>
    el.addEventListener("input", () => {
      const i = Number(el.dataset.idx);
      const k = el.dataset.k;
      rules[i][k] = el.type === "checkbox" ? el.checked : el.value;
    }),
  );
  c.querySelectorAll("[data-del]").forEach((b) =>
    b.addEventListener("click", () => {
      rules.splice(Number(b.dataset.del), 1);
      renderRules();
    }),
  );
}
$("#addRule").addEventListener("click", () => {
  rules.push({ matchType: "contains", pattern: "", response: "", enabled: true });
  renderRules();
});
$("#saveSettings").addEventListener("click", async () => {
  const settings = {
    replies: rules.filter((r) => r.pattern && r.response),
  };
  await bg("SAVE_SETTINGS", { settings });
  $("#saveStatus").textContent = "✓ Zapisano";
  setTimeout(() => ($("#saveStatus").textContent = ""), 2000);
});

loadSettings();
loadItems();
