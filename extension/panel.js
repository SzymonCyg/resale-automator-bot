// Panel UI — komunikuje się z content script na otwartej karcie vinted.*
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

let items = [];
let selected = new Set();
let relistState = [];
let extensionSignedIn = false;
let currentScreen = null;

// ---------- TABS ----------
$$(".tab").forEach((t) =>
  t.addEventListener("click", () => {
    $$(".tab").forEach((x) => x.classList.toggle("active", x === t));
    $$(".view").forEach((v) => v.classList.toggle("hidden", v.dataset.view !== t.dataset.tab));
  }),
);

// ---------- BACKGROUND BRIDGE ----------
function bg(kind, payload) {
  return new Promise((resolve) => chrome.runtime.sendMessage({ kind, ...payload }, (r) => resolve(r)));
}

// ---------- SCREEN MANAGEMENT ----------
function showScreen(name) {
  currentScreen = name;
  $("#screenLogin").classList.toggle("hidden", name !== "login");
  $("#screenConfirm").classList.toggle("hidden", name !== "confirm");
  $("#screenMain").classList.toggle("hidden", name !== "main");
}

const DEFAULT_PANEL_URL = "https://resale-automator-bot.lovable.app";

$("#signinBtn").addEventListener("click", async () => {
  const panelUrl = DEFAULT_PANEL_URL.replace(/\/$/, "");
  await chrome.storage.local.set({ panelUrl });
  let vintedHost = "";
  try { vintedHost = document.referrer ? new URL(document.referrer).hostname : ""; } catch {}
  const next = `/extension-connect?extId=${encodeURIComponent(chrome.runtime.id)}${vintedHost ? `&vinted=${encodeURIComponent(vintedHost)}` : ""}`;
  await chrome.tabs.create({ url: `${panelUrl}/auth?next=${encodeURIComponent(next)}` });
  $("#signinStatus").textContent = "Otwarto panel — zaloguj się i wróć tutaj.";
});

chrome.storage.onChanged.addListener(async (changes) => {
  if (changes.session) {
    const status = await bg("GET_STATUS");
    if (status?.signedIn && currentScreen === "login") {
      await enterConfirmThenMain(status);
    } else if (!status?.signedIn) {
      showScreen("login");
    }
  }
});

$("#signoutBtn").addEventListener("click", async () => {
  await bg("SIGN_OUT");
  extensionSignedIn = false;
  showScreen("login");
});

$("#goToPanelBtn").addEventListener("click", () => enterMain());

async function enterConfirmThenMain(status) {
  showScreen("confirm");
  let who = status?.user?.email || "konto Google";
  try {
    const tab = await getVintedTab();
    if (tab) {
      const r = await vintedMsg(tab.id, { kind: "GET_ME_V2" });
      if (r?.ok && r.username) who = r.username;
    }
  } catch {}
  $("#confirmWho").textContent = who;
  setTimeout(() => { if (currentScreen === "confirm") enterMain(); }, 2000);
}

async function enterMain() {
  showScreen("main");
  extensionSignedIn = true;
  await loadSettings();
  await loadWhoami();
  await loadItems();
}

// ---------- VINTED TAB BRIDGE ----------
async function getVintedTab() {
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

async function ensureVintedScripts(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  await chrome.scripting.executeScript({ target: { tabId }, files: ["page-bridge.js"], world: "MAIN" });
}

async function vintedMsg(tabId, msg) {
  await ensureVintedScripts(tabId);
  try {
    return await tabMsg(tabId, msg);
  } catch (error) {
    const message = error?.message || String(error);
    if (!/Receiving end does not exist|Could not establish connection/i.test(message)) throw error;
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    await ensureVintedScripts(tabId);
    await new Promise((resolve) => setTimeout(resolve, 400));
    return tabMsg(tabId, msg);
  }
}

// ---------- WHOAMI ----------
async function loadWhoami() {
  const el = $("#whoami");
  el.textContent = "Sprawdzam sesję Vinted...";
  const tab = await getVintedTab();
  if (!tab) { el.textContent = "Otwórz zalogowaną kartę vinted.*"; return; }
  try {
    const r = await vintedMsg(tab.id, { kind: "GET_ME_V2" });
    if (r?.ok && r.username) el.textContent = `Zalogowano: ${r.username}`;
    else el.textContent = r?.error || "Niezalogowany na Vinted";
  } catch (e) {
    el.textContent = `Brak połączenia z kartą Vinted: ${e.message}`;
  }
}

// ---------- ITEMS ----------
async function loadItems() {
  $("#itemsStatus").textContent = "Pobieram...";
  const tab = await getVintedTab();
  if (!tab) { $("#itemsStatus").textContent = "Otwórz zalogowaną kartę vinted.*"; return; }
  try {
    const r = await vintedMsg(tab.id, { kind: "FETCH_ITEMS_V2" });
    if (!r?.ok) throw new Error(r?.error || "fetch fail");
    items = r.items || [];
    renderItems();
    $("#itemsStatus").textContent = `${items.length} przedmiotów (${r.username || "?"})`;
  } catch (e) {
    $("#itemsStatus").textContent = "Błąd: " + e.message;
  }
}

let filterStatus = "all";

function categorizeStatus(it) {
  const s = String(it.status ?? "").toLowerCase();
  if (s === "draft" || s === "backup" || s === "processing" || s === "verification") return "draft";
  if (s === "sold") return "sold";
  if (s === "hidden" || s === "reserved") return "inactive";
  return "active"; // wszystko inne (w tym brak statusu) = aktywne
}

function statusLabel(it) {
  const s = it.status;
  if (s === "active") return "Aktywne";
  if (s === "reserved") return "Zarezerwowane";
  if (s === "hidden") return "Ukryte";
  if (s === "draft") return "Szkic";
  if (s === "sold") return "Sprzedane";
  if (s === "backup") return "Kopia";
  if (s === "processing") return "Przetwarzane";
  if (s === "verification") return "Weryfikacja";
  return "Aktywne";
}

function getFilteredItems() {
  if (filterStatus === "all") return items;
  return items.filter((it) => categorizeStatus(it) === filterStatus);
}

function renderItems() {
  const body = $("#itemsBody");
  const filtered = getFilteredItems();
  if (!filtered.length) {
    body.innerHTML = `<tr><td colspan="8" class="empty">Brak przedmiotów.</td></tr>`;
    updateSel();
    return;
  }
  body.innerHTML = filtered.map((it) => `
    <tr data-id="${it.id}">
      <td><input type="checkbox" class="sel" data-id="${it.id}" ${selected.has(String(it.id)) ? "checked" : ""}/></td>
      <td>${it.photo_url ? `<img class="thumb" src="${it.photo_url}" />` : `<div class="thumb"></div>`}</td>
      <td><a href="${it.url || "#"}" target="_blank">${escapeHtml(it.title || "")}</a><br/><span class="muted">#${it.id}</span></td>
      <td class="muted">${escapeHtml(it.brand || "")} ${it.size_title ? "· " + escapeHtml(it.size_title) : ""}</td>
      <td style="text-align:right"><b>${it.price} ${it.currency || ""}</b></td>
      <td style="text-align:right" class="muted">${it.views ?? 0}</td>
      <td style="text-align:right" class="muted">${it.favourite_count ?? 0}</td>
      <td><span class="pill pill--${categorizeStatus(it)}">${statusLabel(it)}</span></td>
    </tr>`).join("");
  body.querySelectorAll(".sel").forEach((cb) =>
    cb.addEventListener("change", () => {
      const id = cb.dataset.id;
      cb.checked ? selected.add(id) : selected.delete(id);
      updateSel();
    }),
  );
  updateSel();
}

function updateSel() {
  $("#selCount").textContent = `${selected.size} zaznaczonych`;
  $("#relistBtn").disabled = !extensionSignedIn || selected.size === 0;
  const del = $("#deleteBtn");
  if (del) del.disabled = !extensionSignedIn || selected.size === 0;
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
    const r = await vintedMsg(tab.id, { kind: "SYNC_NOW_V2" });
    if (!r?.ok) throw new Error(r?.error || "fail");
    $("#itemsStatus").textContent = `✓ Zsynchronizowano ${r.count} przedmiotów (${r.username})`;
  } catch (e) {
    $("#itemsStatus").textContent = "Błąd synchr.: " + e.message;
  }
});
$("#selAll").addEventListener("change", (e) => {
  const checked = e.target.checked;
  getFilteredItems().forEach((it) => (checked ? selected.add(String(it.id)) : selected.delete(String(it.id))));
  renderItems();
  updateSel();
});
$("#filterStatus").addEventListener("change", (e) => {
  filterStatus = e.target.value;
  renderItems();
});
$("#deleteBtn").addEventListener("click", async () => {
  if (!selected.size) return;
  const count = selected.size;
  if (!confirm(`Czy na pewno chcesz usunąć ${count} przedmiot(ów)? Tej akcji nie można cofnąć.`)) return;
  const tab = await getVintedTab();
  if (!tab) { $("#itemsStatus").textContent = "Otwórz zalogowaną kartę vinted.*"; return; }
  const btn = $("#deleteBtn");
  btn.disabled = true;
  const orig = btn.textContent;
  btn.textContent = "Usuwam...";
  let deleted = 0, errors = 0;
  for (const id of [...selected]) {
    try {
      const r = await vintedMsg(tab.id, { kind: "DELETE_ITEM_V2", id });
      if (r?.ok) {
        deleted++;
        items = items.filter((it) => String(it.id) !== String(id));
        selected.delete(id);
      } else {
        errors++;
        console.warn("Delete failed:", id, r?.error);
      }
    } catch (e) {
      errors++;
      console.warn("Delete error:", id, e.message);
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  renderItems();
  updateSel();
  btn.textContent = orig;
  $("#itemsStatus").textContent = `Usunięto ${deleted} przedmiotów${errors ? `, błędy: ${errors}` : ""}`;
});

// ---------- RELIST ----------
$("#relistBtn").addEventListener("click", openRelist);
$("#closeRelist").addEventListener("click", closeRelist);
$("#cancelRelist").addEventListener("click", closeRelist);

let photoMode = "auto";   // 'auto' | 'manual'
let priceMode = "keep";   // 'keep' | 'percent' | 'amount'
let textMode  = "ai";     // 'ai' | 'keep'

$$(".tile[data-photo]").forEach((t) =>
  t.addEventListener("click", () => {
    $$(".tile[data-photo]").forEach((x) => x.classList.toggle("active", x === t));
    photoMode = t.dataset.photo;
    if (photoMode === "manual") openPhotoEditor();
  }),
);
$$(".tile[data-price]").forEach((t) =>
  t.addEventListener("click", () => {
    $$(".tile[data-price]").forEach((x) => x.classList.toggle("active", x === t));
    priceMode = t.dataset.price;
    $("#percentBox").classList.toggle("hidden", priceMode !== "percent");
    $("#amountBox").classList.toggle("hidden", priceMode !== "amount");
    refreshPricePreviews();
  }),
);
$$(".tile[data-text]").forEach((t) =>
  t.addEventListener("click", () => {
    $$(".tile[data-text]").forEach((x) => x.classList.toggle("active", x === t));
    textMode = t.dataset.text;
    applyTextModeLock();
  }),
);
$("#pricePercent").addEventListener("input", refreshPricePreviews);
$("#priceAmount").addEventListener("input", refreshPricePreviews);

function getPercent() {
  const v = Number($("#pricePercent").value);
  return Number.isFinite(v) && v > 0 && v < 100 ? v : 0;
}
function getAmount() {
  const v = Number($("#priceAmount").value);
  return Number.isFinite(v) && v > 0 ? v : 0;
}
function computePrice(st) {
  if (st.manualPrice != null) return st.manualPrice;
  if (priceMode === "percent") {
    const pct = getPercent();
    if (pct > 0) return Math.round(st.origPrice * (1 - pct / 100) * 100) / 100;
  }
  if (priceMode === "amount") {
    const amt = getAmount();
    if (amt > 0) return Math.max(0, Math.round((st.origPrice - amt) * 100) / 100);
  }
  return st.origPrice;
}
function refreshPricePreviews() {
  $$("#relistList .r-item").forEach((row) => {
    const i = Number(row.dataset.i);
    const st = relistState[i];
    if (!st) return;
    const input = row.querySelector(".r-price input");
    const prev = row.querySelector(".r-price .r-preview");
    if (st.manualPrice == null) input.value = String(computePrice(st));
    let previewText = "";
    if (st.manualPrice == null) {
      if (priceMode === "percent" && getPercent() > 0) {
        previewText = `−${getPercent()}% z ${st.origPrice}`;
      } else if (priceMode === "amount" && getAmount() > 0) {
        previewText = `−${getAmount()} z ${st.origPrice}`;
      }
    }
    prev.textContent = previewText;
  });
}

function applyTextModeLock() {
  const locked = textMode === "ai";
  const list = $("#relistList");
  if (!list) return;
  list.classList.toggle("text-locked", locked);
}

const RELIST_DELAY_DEFAULTS = { relistDelayMin: 30, relistDelayMax: 45 };

async function openRelist() {
  const chosen = items.filter((i) => selected.has(String(i.id)));
  $("#relistCount").textContent = chosen.length;
  $("#relistLog").innerHTML = "";
  $("#relistModal").classList.remove("hidden");

  // load delay settings
  const rd = await chrome.storage.local.get(Object.keys(RELIST_DELAY_DEFAULTS));
  const rdMin = Number.isFinite(rd.relistDelayMin) ? rd.relistDelayMin : RELIST_DELAY_DEFAULTS.relistDelayMin;
  const rdMax = Number.isFinite(rd.relistDelayMax) ? rd.relistDelayMax : RELIST_DELAY_DEFAULTS.relistDelayMax;
  $("#relistDelayMin").value = rdMin;
  $("#relistDelayMax").value = rdMax;
  $("#relistDelayMinLabel").textContent = `${rdMin}s`;
  $("#relistDelayMaxLabel").textContent = `${rdMax}s`;
  initDualSlider("#relistDelayMin", "#relistDelayMax", "#relistDelayRange", "#relistDelayMinLabel", "#relistDelayMaxLabel");

  const delayRow = document.getElementById("relistDelayRow");
  if (delayRow) delayRow.classList.toggle("hidden", chosen.length <= 1);


  // reset modes
  photoMode = "auto"; priceMode = "keep"; textMode = "ai";
  $$(".tile[data-photo]").forEach((x) => x.classList.toggle("active", x.dataset.photo === "auto"));
  $$(".tile[data-price]").forEach((x) => x.classList.toggle("active", x.dataset.price === "keep"));
  $$(".tile[data-text]").forEach((x) => x.classList.toggle("active", x.dataset.text === "ai"));
  $("#percentBox").classList.add("hidden");
  $("#amountBox").classList.add("hidden");
  $("#pricePercent").value = "";
  $("#priceAmount").value = "";
  const amtCur = document.getElementById("amountCurrency");
  if (amtCur) amtCur.textContent = getCurrency();

  const tab = await getVintedTab();
  $("#relistSummary").textContent = "Wczytuję zdjęcia...";
  $("#relistSummary").classList.remove("hidden");
  $("#relistList").classList.add("hidden");
  relistState = [];
  for (const it of chosen) {
    try {
      const r = await vintedMsg(tab.id, { kind: "FETCH_ITEM_DETAIL_V2", id: it.id });
      const detail = r?.item || it;
      const photoUrls = detail.photos?.map((p) => p.full_size_url || p.url) || (it.photo_url ? [it.photo_url] : []);
      const photos = await Promise.all(photoUrls.map(loadPhoto));
      const price = Number(it.price) || 0;
      relistState.push({
        item: detail,
        origPrice: price,
        manualPrice: null,
        currency: it.currency,
        title: detail.title || it.title || "",
        description: detail.description || "",
        photos: photos.map((p) => ({ ...p, rotation: 0, crop: null })),
      });
    } catch (e) {
      log(`✗ ${it.title}: ${e.message}`, "err");
    }
  }
  $("#relistSummary").classList.add("hidden");
  $("#relistList").classList.remove("hidden");
  renderRelistList();
}

function closeRelist() {
  $("#relistModal").classList.add("hidden");
  $("#photoEditOverlay").classList.add("hidden");
  relistState = [];
}

async function loadPhoto(url) {
  let dataUrl = null;
  try {
    const res = await fetch(url, { mode: "cors", credentials: "omit" });
    if (!res.ok) throw new Error("status " + res.status);
    const blob = await res.blob();
    dataUrl = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
  } catch {
    const r = await bg("FETCH_PHOTO", { url });
    if (!r?.ok) throw new Error(r?.error || "Nie mogę pobrać zdjęcia");
    dataUrl = r.dataUrl;
  }
  const img = await new Promise((res2, rej) => {
    const i = new Image();
    i.onload = () => res2(i);
    i.onerror = () => rej(new Error("decode fail"));
    i.src = dataUrl;
  });
  return { dataUrl, w: img.naturalWidth, h: img.naturalHeight, url };
}

function renderRelistList() {
  const list = $("#relistList");
  if (!relistState.length) {
    list.innerHTML = `<p class="muted" style="padding:16px">Brak przedmiotów do edycji.</p>`;
    return;
  }
  list.innerHTML = relistState.map((st, i) => `
    <div class="r-item" data-i="${i}">
      <img class="r-thumb" src="${st.photos[0]?.dataUrl || ''}" alt="" />
      <div class="r-fields">
        <div class="r-label">Tytuł</div>
        <div class="r-title-wrap"></div>
        <div class="r-label">Opis</div>
        <div class="r-desc-wrap"></div>
        <div class="r-price">
          <label class="r-price-label">Cena</label>
          <div class="r-price-input">
            <input type="number" step="0.01" min="0" value="${computePrice(st)}" />
            <span class="r-currency">${getCurrency()}</span>
          </div>
          <span class="r-preview"></span>
        </div>
      </div>
    </div>`).join("");

  $$("#relistList .r-item").forEach((row) => {
    const i = Number(row.dataset.i);
    const st = relistState[i];
    mountCollapsible(row.querySelector(".r-title-wrap"), "title", st, i, false);
    mountCollapsible(row.querySelector(".r-desc-wrap"), "desc", st, i, true);
    const priceInput = row.querySelector(".r-price input");
    priceInput.addEventListener("input", () => {
      const v = Number(priceInput.value);
      st.manualPrice = Number.isFinite(v) ? v : null;
    });
  });
  refreshPricePreviews();
}

// ---------- CURRENCY DETECTION ----------
const CURRENCY_MAP = {
  "vinted.at": "€", "vinted.be": "€", "vinted.cz": "Kč", "vinted.de": "€",
  "vinted.dk": "kr", "vinted.ee": "€", "vinted.es": "€", "vinted.fi": "€",
  "vinted.fr": "€", "vinted.gr": "€", "vinted.hr": "€", "vinted.hu": "Ft",
  "vinted.ie": "€", "vinted.it": "€", "vinted.lt": "€", "vinted.lu": "€",
  "vinted.lv": "€", "vinted.nl": "€", "vinted.pl": "zł", "vinted.pt": "€",
  "vinted.ro": "lei", "vinted.se": "kr", "vinted.si": "€", "vinted.sk": "€",
  "vinted.co.uk": "£", "vinted.com": "$", "vinted.com.au": "A$",
};
function getCurrency() {
  try {
    const ref = document.referrer || "";
    const host = ref ? new URL(ref).hostname.replace(/^www\./, "") : "";
    // try exact + suffix match
    if (CURRENCY_MAP[host]) return CURRENCY_MAP[host];
    for (const d of Object.keys(CURRENCY_MAP)) {
      if (host.endsWith(d)) return CURRENCY_MAP[d];
    }
  } catch {}
  return "zł";
}

function mountCollapsible(host, kind, st, i, multiline) {
  const key = kind === "title" ? "title" : "description";
  const text = st[key] || "";
  host.innerHTML = "";
  const collapsed = document.createElement("div");
  collapsed.className = "r-collapsed" + (multiline ? " desc" : "");
  collapsed.textContent = text || (multiline ? "(brak opisu)" : "(brak tytułu)");
  collapsed.title = textMode === "ai" ? "Edycja zablokowana — wybierz „Zostaw, lub edytuj ręcznie”" : "Kliknij aby edytować";
  collapsed.addEventListener("click", () => {
    if (textMode === "ai") return;
    host.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "r-expanded";
    const field = document.createElement(multiline ? "textarea" : "input");
    if (!multiline) field.type = "text";
    field.value = st[key] || "";
    const done = document.createElement("button");
    done.className = "btn r-done";
    done.textContent = "Gotowe";
    done.addEventListener("click", () => {
      st[key] = field.value;
      mountCollapsible(host, kind, st, i, multiline);
    });
    wrap.appendChild(field);
    wrap.appendChild(done);
    host.appendChild(wrap);
    field.focus();
  });
  host.appendChild(collapsed);
}

// ---------- PHOTO EDITOR OVERLAY ----------
$("#closePhotoEdit").addEventListener("click", () => {
  $("#photoEditOverlay").classList.add("hidden");
});

const peActiveIdx = {}; // i -> active photo index

function openPhotoEditor() {
  if (!relistState.length) return;
  $("#photoEditOverlay").classList.remove("hidden");
  const body = $("#photoEditBody");
  body.innerHTML = relistState.map((st, i) => {
    if (peActiveIdx[i] == null || peActiveIdx[i] >= st.photos.length) peActiveIdx[i] = 0;
    const j = peActiveIdx[i];
    return `
    <div class="pe-item" data-i="${i}">
      <h4>${escapeHtml(st.title || st.item.title || "")}</h4>
      <div class="pe-stage">
        <button class="pe-nav prev" data-act="prev" ${st.photos.length<2?'disabled':''}>‹</button>
        <div class="pe-photo" data-j="${j}">
          <div class="pe-canvas-wrap"><canvas width="900" height="900"></canvas></div>
          <div class="pe-counter">${j+1} / ${st.photos.length}</div>
          <div class="pe-actions">
            <button data-act="rotL">⟲ −90°</button>
            <button data-act="rotR">⟳ +90°</button>
            <button data-act="rotN1">−1°</button>
            <button data-act="rot1">+1°</button>
            <button data-act="cropClear">Resetuj crop</button>
            <button data-act="reset">↺ Reset</button>
            <button data-act="del">× Usuń</button>
          </div>
        </div>
        <button class="pe-nav next" data-act="next" ${st.photos.length<2?'disabled':''}>›</button>
      </div>
      <div class="pe-thumbs">
        ${st.photos.map((p, k) => `
          <button class="pe-thumb ${k===j?'active':''}" data-k="${k}" type="button">
            <img src="${p.dataUrl}" alt="" />
            <span>${k+1}</span>
          </button>`).join("")}
      </div>
    </div>`;
  }).join("");

  $$(".pe-item").forEach((row) => {
    const i = Number(row.dataset.i);
    const pe = row.querySelector(".pe-photo");
    const j = Number(pe.dataset.j);
    const canvas = pe.querySelector("canvas");
    drawEditorCanvas(canvas, relistState[i].photos[j]);
    attachCropDrag(canvas, relistState[i].photos[j]);

    row.querySelectorAll(".pe-thumb").forEach((tb) => {
      tb.addEventListener("click", () => {
        peActiveIdx[i] = Number(tb.dataset.k);
        openPhotoEditor();
      });
    });

    row.querySelectorAll("[data-act]").forEach((b) => {
      b.addEventListener("click", () => {
        const a = b.dataset.act;
        const st = relistState[i];
        const cj = peActiveIdx[i];
        const p = st.photos[cj];
        if (a === "prev") { peActiveIdx[i] = (cj - 1 + st.photos.length) % st.photos.length; openPhotoEditor(); return; }
        if (a === "next") { peActiveIdx[i] = (cj + 1) % st.photos.length; openPhotoEditor(); return; }
        if (a === "del") {
          if (st.photos.length <= 1) { alert("Min. 1 zdjęcie."); return; }
          st.photos.splice(cj, 1);
          peActiveIdx[i] = Math.max(0, cj - 1);
          openPhotoEditor();
          return;
        }
        if (a === "rotL") p.rotation -= 90;
        else if (a === "rotR") p.rotation += 90;
        else if (a === "rot1") p.rotation += 1;
        else if (a === "rotN1") p.rotation -= 1;
        else if (a === "cropClear") p.crop = null;
        else if (a === "reset") { p.rotation = 0; p.crop = null; }
        drawEditorCanvas(canvas, p);
      });
    });
  });
}

function drawEditorCanvas(canvas, p) {
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const img = new Image();
  img.onload = () => {
    let sx = 0, sy = 0, sw = img.width, sh = img.height;
    if (p.crop) { sx = p.crop.x; sy = p.crop.y; sw = p.crop.w; sh = p.crop.h; }
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((p.rotation * Math.PI) / 180);
    const scale = Math.min(canvas.width / sw, canvas.height / sh);
    const w = sw * scale, h = sh * scale;
    ctx.drawImage(img, sx, sy, sw, sh, -w / 2, -h / 2, w, h);
    ctx.restore();
    // existing crop is already applied to source; show pending drag rect via overlay layer
    if (canvas._pendingRect) {
      const r = canvas._pendingRect;
      ctx.strokeStyle = "#5eead4";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.setLineDash([]);
    }
  };
  img.src = p.dataUrl;
}

function attachCropDrag(canvas, p) {
  let start = null;
  canvas.addEventListener("mousedown", (e) => {
    const r = canvas.getBoundingClientRect();
    start = { x: (e.clientX - r.left) * (canvas.width / r.width), y: (e.clientY - r.top) * (canvas.height / r.height) };
    canvas._pendingRect = { x: start.x, y: start.y, w: 0, h: 0 };
  });
  canvas.addEventListener("mousemove", (e) => {
    if (!start) return;
    const r = canvas.getBoundingClientRect();
    const cx = (e.clientX - r.left) * (canvas.width / r.width);
    const cy = (e.clientY - r.top) * (canvas.height / r.height);
    canvas._pendingRect = {
      x: Math.min(start.x, cx), y: Math.min(start.y, cy),
      w: Math.abs(cx - start.x), h: Math.abs(cy - start.y),
    };
    drawEditorCanvas(canvas, p);
  });
  canvas.addEventListener("mouseup", () => {
    if (!start || !canvas._pendingRect) { start = null; return; }
    const rect = canvas._pendingRect;
    canvas._pendingRect = null;
    start = null;
    if (rect.w < 8 || rect.h < 8) { drawEditorCanvas(canvas, p); return; }
    // Map canvas-space rect to source-image space (accounting for current crop & fit)
    const baseW = p.crop ? p.crop.w : p.w;
    const baseH = p.crop ? p.crop.h : p.h;
    const scale = Math.min(canvas.width / baseW, canvas.height / baseH);
    const drawnW = baseW * scale, drawnH = baseH * scale;
    const offX = (canvas.width - drawnW) / 2;
    const offY = (canvas.height - drawnH) / 2;
    const rx = Math.max(0, (rect.x - offX) / scale);
    const ry = Math.max(0, (rect.y - offY) / scale);
    const rw = Math.min(baseW - rx, rect.w / scale);
    const rh = Math.min(baseH - ry, rect.h / scale);
    if (rw < 4 || rh < 4) { drawEditorCanvas(canvas, p); return; }
    const baseX = p.crop ? p.crop.x : 0;
    const baseY = p.crop ? p.crop.y : 0;
    p.crop = { x: baseX + rx, y: baseY + ry, w: rw, h: rh };
    drawEditorCanvas(canvas, p);
  });
  canvas.addEventListener("mouseleave", () => { start = null; canvas._pendingRect = null; });
}

async function exportPhoto(p, mode) {
  const img = await new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = p.dataUrl; });
  let sx = 0, sy = 0, sw = img.width, sh = img.height;
  let rotation = 0;
  if (mode === "manual") {
    if (p.crop) { sx = p.crop.x; sy = p.crop.y; sw = p.crop.w; sh = p.crop.h; }
    rotation = p.rotation || 0;
  } else {
    // auto: drobny obrót ±1°
    rotation = Math.random() < 0.5 ? -1 : 1;
  }
  const rad = (rotation * Math.PI) / 180;
  const sin = Math.abs(Math.sin(rad)), cos = Math.abs(Math.cos(rad));
  const cw = Math.round(sw * cos + sh * sin);
  const ch = Math.round(sw * sin + sh * cos);
  const c = new OffscreenCanvas(cw, ch);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, cw, ch);
  ctx.translate(cw / 2, ch / 2);
  ctx.rotate(rad);
  ctx.drawImage(img, sx, sy, sw, sh, -sw / 2, -sh / 2, sw, sh);
  return await c.convertToBlob({ type: "image/jpeg", quality: 0.92 });
}

async function paraphraseWithAI(title, description, language) {
  const { session, supabaseUrl, supabaseAnonKey } = await chrome.storage.local.get([
    "session", "supabaseUrl", "supabaseAnonKey",
  ]);
  const base = supabaseUrl || "https://vdkxhhgoloiylkscessp.supabase.co";
  const token = session?.access_token || "";
  const anon = supabaseAnonKey || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZka3hoaGdvbG9peWxrc2Nlc3NwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2NjYxMjUsImV4cCI6MjA5ODI0MjEyNX0.ZQzRkY2Utf405okkc0b-JJK2zXW40C0EM9XxlzWUOek";
  const res = await fetch(`${base}/functions/v1/paraphrase-text`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token || anon}`,
      "apikey": anon,
    },
    body: JSON.stringify({ title, description: description || "", language: language || "pl" }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return { title: data.title || title, description: data.description || description };
}

$("#runRelist").addEventListener("click", async () => {
  const tab = await getVintedTab();
  if (!tab) return log("✗ Brak otwartej karty Vinted", "err");
  $("#runRelist").disabled = true;

  const delayMin = parseInt($("#relistDelayMin").value) || RELIST_DELAY_DEFAULTS.relistDelayMin;
  const delayMax = parseInt($("#relistDelayMax").value) || RELIST_DELAY_DEFAULTS.relistDelayMax;
  const dMin = Math.min(delayMin, delayMax);
  const dMax = Math.max(delayMin, delayMax);
  try { await chrome.storage.local.set({ relistDelayMin: dMin, relistDelayMax: dMax }); } catch {}

  for (let idx = 0; idx < relistState.length; idx++) {
    const st = relistState[idx];

    if (idx > 0) {
      const delaySec = Math.floor(dMin + Math.random() * Math.max(1, dMax - dMin));
      log(`⏳ Czekam ${delaySec}s przed kolejnym ogłoszeniem...`);
      await new Promise(r => setTimeout(r, delaySec * 1000));
    }


    const finalPrice = computePrice(st);
    log(`→ ${st.title} (${finalPrice} ${st.currency})...`);
    try {
      let aiTitle = st.title;
      let aiDesc = st.description;
      if (textMode === "ai") {
        try {
          const lang = st.currency === 'PLN' ? 'pl'
            : st.currency === 'GBP' ? 'en'
            : st.currency === 'CZK' ? 'cs'
            : st.currency === 'EUR' ? 'de'
            : 'pl';
          const aiResult = await paraphraseWithAI(st.title, st.description, lang);
          if (aiResult) {
            aiTitle = aiResult.title || st.title;
            aiDesc = aiResult.description || st.description;
            log(`🤖 Tytuł: "${aiTitle}"`);
          }
        } catch (aiErr) {
          log(`⚠ AI niedostępne (${aiErr.message}) — używam oryginału`, "");
        }
      }

      const photos = [];
      for (const p of st.photos) {
        const blob = await exportPhoto(p, photoMode);
        const dataUrl = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
        photos.push(dataUrl);
      }
      const detail = await vintedMsg(tab.id, { kind: "FETCH_ITEM_DETAIL_V2", id: st.item.id });
      if (!detail?.ok) throw new Error(detail?.error || "Nie mogę pobrać szczegółów starego ogłoszenia");
      const original = {
        ...detail.item,
        id: st.item.id,
        currency: st.currency,
        title: aiTitle,
        description: aiDesc,
      };
      const r = await vintedMsg(tab.id, {
        kind: "RELIST_ITEM_V2",
        original,
        price: finalPrice,
        currency: st.currency,
        photos,
      });
      if (r?.ok) {
        const delMsg = r.deletedOld ? ", stare usunięte" : `, ⚠ usunięcie starego: ${r.deleteError || "fail"}`;
        log(`✓ ${aiTitle} — nowy ID ${r.newId}${delMsg}`, "ok");
      } else {
        log(`✗ ${st.title}: ${r?.error || "fail"}`, "err");
      }
    } catch (e) {
      log(`✗ ${st.title}: ${e.message}`, "err");
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
  const settings = { replies: rules.filter((r) => r.pattern && r.response) };
  await bg("SAVE_SETTINGS", { settings });
  $("#saveStatus").textContent = "✓ Zapisano";
  setTimeout(() => ($("#saveStatus").textContent = ""), 2000);
});


// ---------- AUTO-LIKES ----------
const AL_DEFAULTS = {
  autoLikesEnabled: false,
  autoLikesTemplate: "Cześć @username! Widziałem, że polubiłeś mój przedmiot i chciałem od razu zaoferować Ci specjalną zniżkę! 💸",
  autoLikesDiscount: false,
  autoLikesDiscountAmount: 10,
  autoLikesDiscountUnit: '%',
  autoLikesDelayNotifMin: 60000,
  autoLikesDelayNotifMax: 120000,
  autoLikesMsgDelayMin: 15000,
  autoLikesMsgDelayMax: 60000,
  autoLikesTimeFilter: 0,
};

function initDualSlider(minSel, maxSel, rangeSel, labelMinSel, labelMaxSel) {
  const minEl = $(minSel);
  const maxEl = $(maxSel);
  const rangeEl = $(rangeSel);
  const labelMin = $(labelMinSel);
  const labelMax = $(labelMaxSel);
  if (!minEl || !maxEl || !rangeEl) return;
  const lo = parseInt(minEl.min);
  const hi = parseInt(minEl.max);
  function update() {
    let vMin = parseInt(minEl.value);
    let vMax = parseInt(maxEl.value);
    if (vMin > vMax) {
      if (document.activeElement === minEl) { maxEl.value = vMin; vMax = vMin; }
      else { minEl.value = vMax; vMin = vMax; }
    }
    const pMin = ((vMin - lo) / (hi - lo)) * 100;
    const pMax = ((vMax - lo) / (hi - lo)) * 100;
    rangeEl.style.left = pMin + '%';
    rangeEl.style.width = (pMax - pMin) + '%';
    if (labelMin) labelMin.textContent = vMin + 's';
    if (labelMax) labelMax.textContent = vMax + 's';
  }
  if (!minEl.dataset.dsInit) {
    minEl.addEventListener('input', update);
    maxEl.addEventListener('input', update);
    minEl.dataset.dsInit = '1';
  }
  update();
}

async function loadAutoLikes() {
  const stored = await chrome.storage.local.get(Object.keys(AL_DEFAULTS).concat(["autoLikesStats"]));
  const s = { ...AL_DEFAULTS, ...stored };
  $("#alTemplate").value = s.autoLikesTemplate;
  $("#alDiscount").checked = !!s.autoLikesDiscount;
  $("#alDiscountAmount").value = s.autoLikesDiscountAmount;
  $("#alDiscountUnit").value = s.autoLikesDiscountUnit;
  $("#alNotifMin").value = Math.round(s.autoLikesDelayNotifMin / 1000);
  $("#alNotifMax").value = Math.round(s.autoLikesDelayNotifMax / 1000);
  $("#alMsgMin").value = Math.round(s.autoLikesMsgDelayMin / 1000);
  $("#alMsgMax").value = Math.round(s.autoLikesMsgDelayMax / 1000);
  $("#alTimeFilter").value = String(s.autoLikesTimeFilter ?? 0);
  initDualSlider("#alNotifMin", "#alNotifMax", "#alNotifRange", "#alNotifMinLabel", "#alNotifMaxLabel");
  initDualSlider("#alMsgMin", "#alMsgMax", "#alMsgRange", "#alMsgMinLabel", "#alMsgMaxLabel");
  $("#alRunStatus").textContent = s.autoLikesEnabled ? "działa ✓" : "zatrzymane";
  const stats = stored.autoLikesStats || { sent: 0, lastEvent: "—", logs: [] };
  $("#alSentCount").textContent = stats.sent || 0;
  $("#alLastEvent").textContent = stats.lastEvent || "—";
  const logEl = $("#alLog");
  if (logEl) {
    logEl.innerHTML = "";
    const logs = Array.isArray(stats.logs) ? stats.logs : [];
    logs.slice(-100).forEach((l) => {
      const div = document.createElement("div");
      div.textContent = l;
      logEl.appendChild(div);
    });
    logEl.scrollTop = logEl.scrollHeight;
  }
}


function readAutoLikesForm() {
  const num = (id, def) => {
    const v = Number($(id).value);
    return Number.isFinite(v) && v > 0 ? v : def;
  };
  return {
    autoLikesTemplate: $("#alTemplate").value,
    autoLikesDiscount: $("#alDiscount").checked,
    autoLikesDiscountAmount: num("#alDiscountAmount", AL_DEFAULTS.autoLikesDiscountAmount),
    autoLikesDiscountUnit: $("#alDiscountUnit").value,
    autoLikesDelayNotifMin: num("#alNotifMin", 60) * 1000,
    autoLikesDelayNotifMax: num("#alNotifMax", 120) * 1000,
    autoLikesMsgDelayMin: num("#alMsgMin", 15) * 1000,
    autoLikesMsgDelayMax: num("#alMsgMax", 60) * 1000,
    autoLikesTimeFilter: parseInt($("#alTimeFilter").value) || 0,
  };
}

async function saveAutoLikes(extra = {}) {
  const data = { ...readAutoLikesForm(), ...extra };
  await chrome.storage.local.set(data);
  return data;
}

$("#alSaveBtn").addEventListener("click", async () => {
  await saveAutoLikes();
  $("#alSaveStatus").textContent = "✓ Zapisano";
  setTimeout(() => ($("#alSaveStatus").textContent = ""), 2000);
});

$("#alStartBtn").addEventListener("click", async () => {
  await saveAutoLikes({ autoLikesEnabled: true });
  $("#alRunStatus").textContent = "działa ✓";
});

$("#alStopBtn").addEventListener("click", async () => {
  await chrome.storage.local.set({ autoLikesEnabled: false });
  $("#alRunStatus").textContent = "zatrzymane";
});

const alClearBtn = $("#alClearLogBtn");
if (alClearBtn) {
  alClearBtn.addEventListener("click", async () => {
    const cur = (await chrome.storage.local.get(["autoLikesStats"])).autoLikesStats || {};
    await chrome.storage.local.set({ autoLikesStats: { ...cur, logs: [], logLine: "" } });
    const el = $("#alLog");
    if (el) el.innerHTML = "";
  });
}


chrome.storage.onChanged.addListener((changes) => {
  if (changes.autoLikesStats) {
    const s = changes.autoLikesStats.newValue || {};
    $("#alSentCount").textContent = s.sent || 0;
    $("#alLastEvent").textContent = s.lastEvent || "—";
    if (s.logLine) {
      const el = $("#alLog");
      const div = document.createElement("div");
      div.textContent = s.logLine;
      el.appendChild(div);
      el.scrollTop = el.scrollHeight;
    }
  }
  if (changes.autoLikesEnabled) {
    $("#alRunStatus").textContent = changes.autoLikesEnabled.newValue ? "działa ✓" : "zatrzymane";
  }
});

// ========== THEME SYSTEM ==========
let currentTheme = 'light';

async function applyTheme(theme) {
  currentTheme = theme;
  document.body.classList.toggle('theme-light', theme === 'light');
  document.body.classList.toggle('theme-dark', theme === 'dark');
  const btn = document.getElementById('themeToggle');
  if (btn) btn.textContent = theme === 'light' ? '🌙' : '☀️';
  const stored = (await chrome.storage.local.get(['themeOverride'])).themeOverride || 'light';
  document.querySelectorAll('.theme-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.theme === stored)
  );
}

async function initTheme() {
  const { themeOverride } = await chrome.storage.local.get(['themeOverride']);
  await applyTheme(themeOverride === 'dark' ? 'dark' : 'light');
}

async function setThemeOverride(value) {
  await chrome.storage.local.set({ themeOverride: value });
  await applyTheme(value);
  document.querySelectorAll('.theme-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.theme === value)
  );
}
// ========== END THEME SYSTEM ==========

document.addEventListener('DOMContentLoaded', () => {
  const themeToggleBtn = document.getElementById('themeToggle');
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', async () => {
      const next = currentTheme === 'dark' ? 'light' : 'dark';
      await setThemeOverride(next);
    });
  }
  document.querySelectorAll('.theme-btn').forEach(b => {
    b.addEventListener('click', () => setThemeOverride(b.dataset.theme));
  });
});

// ---------- BOOT ----------
async function boot() {
  await initTheme();
  const status = await bg("GET_STATUS");
  if (status?.signedIn) {
    await enterMain();
    await loadAutoLikes();
  } else {
    showScreen("login");
  }
}
boot();

