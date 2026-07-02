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
      <td><a href="${it.url || "#"}" target="_blank">${importEscapeHtml(it.title || "")}</a><br/><span class="muted">#${it.id}</span></td>
      <td class="muted">${importEscapeHtml(it.brand || "")} ${it.size_title ? "· " + importEscapeHtml(it.size_title) : ""}</td>
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
  updatePublishDraftsVisibility();
}

function updateSel() {
  $("#selCount").textContent = `${selected.size} zaznaczonych`;
  $("#relistBtn").disabled = !extensionSignedIn || selected.size === 0;
  const del = $("#deleteBtn");
  if (del) del.disabled = !extensionSignedIn || selected.size === 0;
}

function importEscapeHtml(s) {
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

async function mirrorItemPhotos(vintedItemId, photoUrls) {
  const { session, supabaseUrl, supabaseAnonKey } = await chrome.storage.local.get([
    "session", "supabaseUrl", "supabaseAnonKey",
  ]);
  const base = supabaseUrl || "https://vdkxhhgoloiylkscessp.supabase.co";
  const token = session?.access_token || "";
  const anon = supabaseAnonKey || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZka3hoaGdvbG9peWxrc2Nlc3NwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2NjYxMjUsImV4cCI6MjA5ODI0MjEyNX0.ZQzRkY2Utf405okkc0b-JJK2zXW40C0EM9XxlzWUOek";
  if (!token) throw new Error("Zaloguj się w panelu (brak sesji).");
  const res = await fetch(`${base}/functions/v1/mirror-item-photo`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
      "apikey": anon,
    },
    body: JSON.stringify({ vinted_item_id: String(vintedItemId), photo_urls: photoUrls || [] }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return { urls: Array.isArray(data.urls) ? data.urls : [] };
}

$("#exportPhotosBtn").addEventListener("click", async () => {
  const btn = $("#exportPhotosBtn");
  const status = $("#exportPhotosStatus");
  if (typeof XLSX === "undefined") { status.textContent = "Błąd: brak biblioteki XLSX"; return; }
  const tab = await getVintedTab();
  if (!tab) { status.textContent = "Otwórz zalogowaną kartę vinted.*"; return; }

  const target = selected.size
    ? items.filter((it) => selected.has(String(it.id)))
    : items.slice();
  if (!target.length) { status.textContent = "Brak przedmiotów do eksportu"; return; }

  btn.disabled = true;
  const rows = [];
  let totalPhotos = 0;
  let maxPhotos = 0;

  for (let i = 0; i < target.length; i++) {
    const it = target[i];
    status.textContent = `Przetwarzam ${i + 1}/${target.length}…`;
    try {
      const r = await vintedMsg(tab.id, { kind: "FETCH_ITEM_DETAIL_V2", id: it.id });
      const detail = r?.item || it;
      let resolved = null;
      try {
        const rl = await vintedMsg(tab.id, { kind: "RESOLVE_LABELS_V2", catalog_id: detail.catalog_id, size_id: detail.size_id });
        resolved = rl || null;
      } catch (e) { console.warn("resolve failed", it.id, e); }
      let labels = null;
      try {
        const lab = await vintedMsg(tab.id, { kind: "FETCH_ITEM_LABELS_V2", id: it.id });
        labels = lab?.labels || null;
      } catch (e) { console.warn("labels failed", it.id, e); }


      let photoUrls = (detail.photos || [])
        .map((p) => p?.full_size_url || p?.url)
        .filter(Boolean);
      if (!photoUrls.length && it.photo_url) photoUrls = [it.photo_url];
      let mirrored = [];
      try {
        const m = await mirrorItemPhotos(it.id, photoUrls);
        mirrored = m.urls;
      } catch (e) {
        console.warn("mirror failed", it.id, e);
      }
      totalPhotos += mirrored.length;
      if (mirrored.length > maxPhotos) maxPhotos = mirrored.length;
      rows.push({
        _it: it,
        _detail: detail,
        _labels: labels,
        _resolved: resolved,
        _photos: mirrored,
      });
    } catch (e) {
      console.warn("item failed", it.id, e);
      rows.push({ _it: it, _detail: it, _labels: null, _resolved: null, _photos: [] });
    }
    await new Promise((res) => setTimeout(res, 400 + Math.random() * 400));
  }


  const STATUS_ID_TO_LABEL = { 1: "Nowy z metką", 2: "Nowy bez metki", 6: "Bardzo dobry", 3: "Dobry", 4: "Zadowalający" };
  const valId = (v) => (v && typeof v === "object" ? v.id : v) ?? "";
  const valTitle = (v) => (v && typeof v === "object" ? v.title : "") ?? "";

  function labelFromDetail(d) {
    if (!d) return { brand:"", size:"", category:"", colors:[] };
    const t = v => (v && typeof v === "object") ? (v.title || v.name || "") : (typeof v === "string" ? v : "");
    const brand = d.brand_title || t(d.brand) || t(d.brand_dto) || "";
    const size = d.size_title || t(d.size) || t(d.size_dto) || "";
    const category = d.catalog_branch_title || d.catalog_title || t(d.catalog) || t(d.category) || "";
    const colors = [ t(d.color1) || d.color1_title || "", t(d.color2) || d.color2_title || "" ].filter(Boolean);
    return { brand, size, category, colors };
  }

  const outRows = rows.map(({ _it, _detail, _labels, _resolved, _photos }) => {
    const d = _detail || {};
    const pub = _labels || {};
    const rl = _resolved || {};
    const det = labelFromDetail(d);
    const attrs = Array.isArray(d.item_attributes) ? d.item_attributes : [];
    const condAttr = attrs.find(a => a && a.code === "condition");
    const statusId = d.status_id || valId(d.status) || d.condition_id || valId(d.condition) || (condAttr?.ids?.[0]) || "";
    const statusLabel = valTitle(d.status) || valTitle(d.condition) || STATUS_ID_TO_LABEL[statusId] || "";
    const brandId = d.brand_id || valId(d.brand_dto) || valId(d.brand) || "";
    const brandLabel = det.brand || pub.brand || _it.brand || "";
    const sizeId = d.size_id || valId(d.size) || "";
    const sizeLabel = rl.size || det.size || pub.size || _it.size_title || "";
    const catalogId = d.catalog_id || valId(d.catalog) || "";
    const catalogLabel = rl.category || det.category || pub.category || "";
    const colorIds = [d.color1_id, d.color2_id].filter(c => c != null);
    const colorLabels = (det.colors && det.colors.length) ? det.colors : (Array.isArray(pub.colors) ? pub.colors.filter(Boolean) : []);
    const packageId = d.package_size_id || valId(d.package_size) || "";



    const row = {
      "ID": _it.id,
      "Tytuł": d.title || _it.title || "",
      "Opis": d.description || _it.description || "",
      "Marka": brandLabel,
      "Marka_ID": brandId,
      "Rozmiar": sizeLabel,
      "Rozmiar_ID": sizeId,
      "Stan": statusLabel,
      "Stan_ID": statusId,
      "Kategoria": catalogLabel,
      "Kategoria_ID": catalogId,
      "Kolor": colorLabels.join(", "),
      "Kolor_ID": colorIds.join(","),
      "Paczka_ID": packageId,
      "Cena": d.price?.amount ?? _it.price ?? "",
      "Waluta": d.currency || d.price?.currency_code || _it.currency || "",
      "Unisex": d.is_unisex === true || d.is_unisex === 1 ? 1 : 0,
      "Wymiar_dl": d.measurement_length ?? "",
      "Wymiar_szer": d.measurement_width ?? "",
    };
    for (let i = 0; i < maxPhotos; i++) {
      row[`Zdjęcie_${i + 1}`] = _photos[i] || "";
    }
    return row;
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(outRows);
  XLSX.utils.book_append_sheet(wb, ws, "Przedmioty");
  XLSX.writeFile(wb, "vinted-ze-zdjeciami.xlsx");

  status.textContent = `✓ Wyeksportowano ${outRows.length} przedmiotów (${totalPhotos} zdjęć)`;
  btn.disabled = false;
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
  updatePublishDraftsVisibility();
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
  applyTextModeLock();
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


/* ============ IMPORT (Etap 2) ============ */
let importItems = [];

function importValidateRow(it) {
  const w = [];
  if (!it.title || !String(it.title).trim()) w.push("brak tytułu");
  if (!(Number(it.price) > 0)) w.push("cena");
  if (!it.photos || it.photos.length === 0) w.push("brak zdjęć");
  if (!it.brand_id) w.push("brak Marka_ID");
  if (!it.size_id) w.push("brak Rozmiar_ID");
  if (!it.status_id) w.push("brak Stan_ID");
  if (!it.catalog_id) w.push("brak Kategoria_ID");
  return w;
}


function renderImportPreview() {
  const box = document.getElementById("importPreview");
  if (!box) return;
  if (!importItems.length) { box.innerHTML = ""; return; }
  const rows = importItems.map((it, i) => {
    const warns = importValidateRow(it);
    const bad = warns.length > 0;
    const thumb = it.photos[0]
      ? `<img src="${importEscapeHtml(it.photos[0])}" loading="lazy" style="width:48px;height:48px;object-fit:cover;border-radius:4px" />`
      : `<div style="width:48px;height:48px;background:#eee;border-radius:4px"></div>`;
    return `<tr style="${bad ? "background:rgba(220,50,50,.08)" : ""}">
      <td>${bad ? '<span title="' + importEscapeHtml(warns.join(", ")) + '" style="color:#c33">●</span>' : ""}</td>
      <td>${thumb}</td>
      <td>${importEscapeHtml(it.title)}</td>
      <td>${importEscapeHtml(it.price)} ${importEscapeHtml(it.currency)}</td>
      <td>${importEscapeHtml(it.brand)}</td>
      <td>${importEscapeHtml(it.size_title)}</td>
      <td>${importEscapeHtml(it.status_label)}</td>
      <td>${importEscapeHtml(it.catalog_title)}</td>
      <td style="text-align:center">${it.photos.length}</td>
    </tr>`;
  }).join("");
  box.innerHTML = `<table class="tbl" style="width:100%;border-collapse:collapse">
    <thead><tr>
      <th></th><th>Miniatura</th><th>Tytuł</th><th>Cena</th><th>Marka</th><th>Rozmiar</th><th>Stan</th><th>Kategoria</th><th>Zdjęć</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
}

async function handleImportParse() {
  const input = document.getElementById("importFile");
  const status = document.getElementById("importStatus");
  const file = input && input.files && input.files[0];
  if (!file) { status.textContent = "Wybierz plik."; return; }
  if (typeof XLSX === "undefined") { status.textContent = "Brak biblioteki XLSX."; return; }
  status.textContent = "Wczytywanie…";
  try {
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(ws, { defval: "" });
    const numOrNull = (v) => { const n = Number(String(v).replace(",", ".")); return Number.isFinite(n) && n > 0 ? n : null; };
    importItems = raw.map(r => {
      const photoKeys = Object.keys(r)
        .filter(k => /^Zdjęcie_\d+$/.test(k))
        .sort((a, b) => Number(a.split("_")[1]) - Number(b.split("_")[1]));
      const photos = photoKeys.map(k => r[k]).filter(v => typeof v === "string" && v.trim());
      const colorIds = String(r["Kolor_ID"] || "")
        .split(/[,;]/).map(s => Number(s.trim())).filter(n => Number.isFinite(n) && n > 0);
      return {
        id: r["ID"] || "",
        title: r["Tytuł"] || "",
        description: r["Opis"] || "",
        brand: r["Marka"] || "",
        brand_id: numOrNull(r["Marka_ID"]),
        size_title: r["Rozmiar"] || "",
        size_id: numOrNull(r["Rozmiar_ID"]),
        status_label: r["Stan"] || "",
        status_id: numOrNull(r["Stan_ID"]),
        catalog_title: r["Kategoria"] || "",
        catalog_id: numOrNull(r["Kategoria_ID"]),
        color: r["Kolor"] || "",
        color_ids: colorIds,
        package_size_id: numOrNull(r["Paczka_ID"]),
        price: Number(String(r["Cena"]).replace(",", ".")) || 0,
        currency: r["Waluta"] || "",
        is_unisex: String(r["Unisex"] || "").trim() === "1",
        measurement_length: numOrNull(r["Wymiar_dl"]),
        measurement_width: numOrNull(r["Wymiar_szer"]),
        photos,
      };
    });
    const warned = importItems.filter(it => importValidateRow(it).length > 0).length;
    status.textContent = `Wczytano ${importItems.length} przedmiotów (${warned} z ostrzeżeniami)`;
    renderImportPreview();
    updateImportActionsVisibility();
  } catch (e) {
    console.warn("import parse failed", e);
    status.textContent = "Nie udało się odczytać pliku (sprawdź format).";
  }
}

document.getElementById("importParseBtn")?.addEventListener("click", handleImportParse);

/* ============ IMPORT — tworzenie ogłoszeń (Etap 3a) ============ */
const IMPORT_DELAY_DEFAULTS = { importDelayMin: 30, importDelayMax: 60 };

async function initImportUI() {
  try {
    const s = await chrome.storage.local.get(["importDelayMin", "importDelayMax"]);
    const mn = Number.isFinite(s.importDelayMin) ? s.importDelayMin : IMPORT_DELAY_DEFAULTS.importDelayMin;
    const mx = Number.isFinite(s.importDelayMax) ? s.importDelayMax : IMPORT_DELAY_DEFAULTS.importDelayMax;
    const $mn = document.getElementById("importDelayMin");
    const $mx = document.getElementById("importDelayMax");
    if ($mn && $mx) {
      $mn.value = mn; $mx.value = mx;
      document.getElementById("importDelayMinLabel").textContent = `${mn}s`;
      document.getElementById("importDelayMaxLabel").textContent = `${mx}s`;
      if (typeof initDualSlider === "function") {
        initDualSlider("#importDelayMin", "#importDelayMax", "#importDelayRange", "#importDelayMinLabel", "#importDelayMaxLabel");
      }
    }
  } catch {}
}

function updateImportActionsVisibility() {
  const box = document.getElementById("importActions");
  const delayRow = document.getElementById("importDelayRow");
  if (!box) return;
  const valid = importItems.filter(it => importValidateRow(it).length === 0);
  if (importItems.length === 0) {
    box.classList.add("hidden");
    return;
  }
  box.classList.remove("hidden");
  if (delayRow) delayRow.classList.toggle("hidden", valid.length <= 1);
}

function importLog(msg, cls = "") {
  const el = document.getElementById("importRunLog");
  if (!el) return;
  const line = document.createElement("div");
  if (cls) line.className = cls;
  const ts = new Date().toLocaleTimeString();
  line.textContent = `[${ts}] ${msg}`;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

async function runImport(mode) {
  const target = importItems.filter(it => importValidateRow(it).length === 0);
  if (!target.length) { importLog("Brak poprawnych przedmiotów (uzupełnij braki)", "err"); return; }
  if (mode === "publish" && !confirm(`Opublikować ${target.length} ogłoszeń na Vinted?`)) return;

  const tab = await getVintedTab();
  if (!tab) { importLog("Otwórz zalogowaną kartę vinted.*", "err"); return; }

  const $mn = document.getElementById("importDelayMin");
  const $mx = document.getElementById("importDelayMax");
  let dMin = parseInt($mn?.value) || IMPORT_DELAY_DEFAULTS.importDelayMin;
  let dMax = parseInt($mx?.value) || IMPORT_DELAY_DEFAULTS.importDelayMax;
  if (dMax < dMin) dMax = dMin;
  try { await chrome.storage.local.set({ importDelayMin: dMin, importDelayMax: dMax }); } catch {}

  const btnD = document.getElementById("importDraftBtn");
  const btnP = document.getElementById("importPublishBtn");
  btnD.disabled = true; btnP.disabled = true;

  for (let i = 0; i < target.length; i++) {
    const it = target[i];
    if (mode === "publish" && i > 0 && target.length > 1) {
      const wait = Math.floor(dMin + Math.random() * (dMax - dMin + 1));
      importLog(`⏳ Czekam ${wait}s…`);
      await new Promise(r => setTimeout(r, wait * 1000));
    } else if (mode === "draft" && (i + 1) % 10 === 0 && i < target.length - 1) {
      importLog("⏳ Pauza 10 s (co 10 ogłoszeń)");
      await new Promise(r => setTimeout(r, 10000));
    }
    importLog(`(${i+1}/${target.length}) ${it.title}`);
    try {
      const photos = [];
      for (const url of it.photos) {
        try { const p = await loadPhoto(url); photos.push(p.dataUrl); }
        catch (e) { importLog(`  · pominięto zdjęcie: ${e.message}`, "warn"); }
      }
      if (!photos.length) { importLog("  ✗ brak zdjęć do wgrania", "err"); continue; }
      const attributes = {
        title: it.title,
        description: it.description,
        price: it.price,
        currency: it.currency,
        brand_id: it.brand_id,
        brand: it.brand,
        size_id: it.size_id,
        status_id: it.status_id,
        catalog_id: it.catalog_id,
        color_ids: it.color_ids,
        package_size_id: it.package_size_id,
        is_unisex: it.is_unisex,
        measurement_length: it.measurement_length,
        measurement_width: it.measurement_width,
      };
      const r = await vintedMsg(tab.id, { kind: "CREATE_LISTING_V2", attributes, photos, mode });
      if (r?.ok) {
        importLog(`  ✓ ${mode === "publish" ? "opublikowano" : "zapisano jako draft"} (ID ${r.id})`, "ok");
      } else {
        importLog(`  ✗ ${r?.error || "nieznany błąd"}`, "err");
      }
    } catch (e) {
      importLog(`  ✗ ${e.message}`, "err");
    }
  }
  importLog("— gotowe —");
  btnD.disabled = false; btnP.disabled = false;
}

document.getElementById("importDraftBtn")?.addEventListener("click", () => runImport("draft"));
document.getElementById("importPublishBtn")?.addEventListener("click", () => runImport("publish"));
initImportUI();

/* ============ PUBLISH DRAFTS (Etap 3b) ============ */
const PUBLISH_DELAY_DEFAULTS = { publishDelayMin: 30, publishDelayMax: 60 };

async function initPublishDraftsUI() {
  try {
    const s = await chrome.storage.local.get(["publishDelayMin", "publishDelayMax"]);
    const mn = Number.isFinite(s.publishDelayMin) ? s.publishDelayMin : PUBLISH_DELAY_DEFAULTS.publishDelayMin;
    const mx = Number.isFinite(s.publishDelayMax) ? s.publishDelayMax : PUBLISH_DELAY_DEFAULTS.publishDelayMax;
    const $mn = document.getElementById("publishDelayMin");
    const $mx = document.getElementById("publishDelayMax");
    if ($mn && $mx) {
      $mn.value = mn; $mx.value = mx;
      document.getElementById("publishDelayMinLabel").textContent = `${mn}s`;
      document.getElementById("publishDelayMaxLabel").textContent = `${mx}s`;
      if (typeof initDualSlider === "function") {
        initDualSlider("#publishDelayMin", "#publishDelayMax", "#publishDelayRange", "#publishDelayMinLabel", "#publishDelayMaxLabel");
      }
    }
  } catch {}
}

function updatePublishDraftsVisibility() {
  const btn = document.getElementById("publishDraftsBtn");
  const row = document.getElementById("publishDelayRow");
  const log = document.getElementById("publishDraftsLog");
  if (!btn) return;
  if (filterStatus !== "draft") {
    btn.classList.add("hidden");
    row?.classList.add("hidden");
    log?.classList.add("hidden");
    return;
  }
  btn.classList.remove("hidden");
  const targets = [...selected].filter(id => {
    const it = items.find(x => String(x.id) === String(id));
    return it && categorizeStatus(it) === "draft";
  });
  btn.disabled = !extensionSignedIn || targets.length === 0;
  if (row) row.classList.toggle("hidden", targets.length <= 1);
}

function publishLog(msg, cls = "") {
  const el = document.getElementById("publishDraftsLog");
  if (!el) return;
  el.classList.remove("hidden");
  const line = document.createElement("div");
  if (cls) line.className = cls;
  const ts = new Date().toLocaleTimeString();
  line.textContent = `[${ts}] ${msg}`;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

const _origUpdateSel = updateSel;
updateSel = function() {
  _origUpdateSel();
  updatePublishDraftsVisibility();
};

document.getElementById("publishDraftsBtn")?.addEventListener("click", async () => {
  const target = [...selected]
    .map(id => items.find(x => String(x.id) === String(id)))
    .filter(it => it && categorizeStatus(it) === "draft");
  if (!target.length) { $("#itemsStatus").textContent = "Zaznacz szkice do wystawienia"; return; }

  const tab = await getVintedTab();
  if (!tab) { publishLog("Otwórz zalogowaną kartę vinted.*", "err"); return; }

  const $mn = document.getElementById("publishDelayMin");
  const $mx = document.getElementById("publishDelayMax");
  let dMin = parseInt($mn?.value) || PUBLISH_DELAY_DEFAULTS.publishDelayMin;
  let dMax = parseInt($mx?.value) || PUBLISH_DELAY_DEFAULTS.publishDelayMax;
  if (dMax < dMin) dMax = dMin;
  try { await chrome.storage.local.set({ publishDelayMin: dMin, publishDelayMax: dMax }); } catch {}

  if (!confirm(`Wystawić ${target.length} szkiców na Vinted?`)) return;

  const btn = document.getElementById("publishDraftsBtn");
  btn.disabled = true;
  document.getElementById("publishDraftsLog").classList.remove("hidden");

  let ok = 0, fail = 0;
  for (let i = 0; i < target.length; i++) {
    const it = target[i];
    if (i > 0 && target.length > 1) {
      const wait = Math.floor(dMin + Math.random() * (dMax - dMin + 1));
      publishLog(`⏳ Czekam ${wait}s…`);
      await new Promise(r => setTimeout(r, wait * 1000));
    }
    publishLog(`(${i+1}/${target.length}) ${it.title || "#" + it.id}`);
    try {
      const r = await vintedMsg(tab.id, { kind: "PUBLISH_DRAFT_V2", id: it.id });
      if (r?.ok) {
        publishLog(`  ✓ opublikowano (ID ${r.id})`, "ok");
        items = items.filter(x => String(x.id) !== String(it.id));
        selected.delete(String(it.id));
        ok++;
      } else {
        publishLog(`  ✗ ${r?.error || "nieznany błąd"}`, "err");
        fail++;
      }
    } catch (e) {
      publishLog(`  ✗ ${e.message}`, "err");
      fail++;
    }
  }
  publishLog(`— gotowe — sukces: ${ok}, błędy: ${fail}`);
  renderItems();
  updateSel();
  btn.disabled = false;
  try { await loadItems(); } catch {}
});

initPublishDraftsUI();

// =================== DODAJ Z AI ===================
let aiItems = [];
const AI_DELAY_DEFAULTS = { aiDelayMin: 30, aiDelayMax: 60 };
const AI_STATUS_MAP = { "Nowy z metką": 1, "Nowy bez metki": 2, "Bardzo dobry": 6, "Dobry": 3, "Zadowalający": 4 };
const AI_STATUS_OPTIONS = ["Nowy z metką", "Nowy bez metki", "Bardzo dobry", "Dobry", "Zadowalający"];
let aiCatalogLeaves = [];
let aiLeafByLabel = {};
let aiSizesCache = {};

function aiNorm(s) { return String(s == null ? "" : s).trim().toLowerCase(); }

async function aiEnsureCatalogLeaves() {
  if (aiCatalogLeaves.length) return;
  try {
    const tab = await getVintedTab();
    if (!tab) return;
    const r = await vintedMsg(tab.id, { kind: "GET_CATALOG_LEAVES_V2" });
    if (r?.ok && Array.isArray(r.leaves)) {
      aiCatalogLeaves = r.leaves;
      aiLeafByLabel = {};
      const dl = document.getElementById("aiCatList");
      if (dl) dl.innerHTML = "";
      for (const l of aiCatalogLeaves) {
        aiLeafByLabel[l.path] = l.id;
        if (dl) {
          const opt = document.createElement("option");
          opt.value = l.path;
          dl.appendChild(opt);
        }
      }
    }
  } catch {}
}

async function aiLoadSizesForCatalog(catalogId) {
  if (!catalogId) return [];
  if (aiSizesCache[catalogId]) return aiSizesCache[catalogId];
  try {
    const tab = await getVintedTab();
    if (!tab) return [];
    const r = await vintedMsg(tab.id, { kind: "GET_CATALOG_SIZES_V2", catalog_id: catalogId });
    aiSizesCache[catalogId] = (r?.ok && Array.isArray(r.sizes)) ? r.sizes : [];
  } catch { aiSizesCache[catalogId] = []; }
  return aiSizesCache[catalogId];
}

function aiFindLeafIdByLabel(value) {
  if (!value) return null;
  if (aiLeafByLabel[value] != null) return aiLeafByLabel[value];
  const v = aiNorm(value);
  const exact = aiCatalogLeaves.find(l => aiNorm(l.path) === v || aiNorm(l.title) === v);
  if (exact) return exact.id;
  const contain = aiCatalogLeaves.find(l => aiNorm(l.path).includes(v) || v.includes(aiNorm(l.title)));
  return contain ? contain.id : null;
}

function aiPickSizeFromList(sizes, userSize) {
  if (!sizes.length || !userSize) return null;
  const raw = aiNorm(userSize);
  const clean = raw.replace(/eu|us|uk/g, "").trim();
  let hit = sizes.find(s => aiNorm(s.title) === raw);
  if (!hit && clean) hit = sizes.find(s => aiNorm(s.title) === clean);
  if (!hit && clean) hit = sizes.find(s => aiNorm(s.title).replace(/\s+/g, "") === clean.replace(/\s+/g, ""));
  if (!hit && clean) hit = sizes.find(s => aiNorm(s.title).includes(clean));
  return hit || null;
}

function aiUid() { return "ai_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }


function aiLog(msg, cls = "") {
  const el = document.getElementById("aiRunLog");
  if (!el) return;
  const line = document.createElement("div");
  if (cls) line.className = cls;
  const ts = new Date().toLocaleTimeString();
  line.textContent = `[${ts}] ${msg}`;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

function aiEscape(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

async function readFilesAsDataUrls(files) {
  const out = [];
  for (const f of files) {
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(new Error("FileReader"));
        r.readAsDataURL(f);
      });
      out.push(dataUrl);
    } catch {}
  }
  return out;
}

function aiFieldWarn(v) {
  return (v == null || v === "" ) ? `<div class="muted" style="color:#c47b00">⚠ nie rozpoznano — popraw nazwę/rozmiar i wygeneruj ponownie</div>` : "";
}

async function aiCompressPhoto(dataUrl, maxSide = 2000, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let w = img.naturalWidth, h = img.naturalHeight;
      if (w > maxSide || h > maxSide) {
        const ratio = Math.min(maxSide / w, maxSide / h);
        w = Math.round(w * ratio); h = Math.round(h * ratio);
      }
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => reject(new Error("decode fail"));
    img.src = dataUrl;
  });
}

const AI_CATEGORY_TREE = {
  "Mężczyźni": {
    "Obuwie": {
      "__items": ["Sneakersy","Trekkingi","Buty do biegania","Sandały i klapki","Mokasyny i lordsy","Kozaki i botki","Półbuty i oksfordy","Kalosze i śniegowce","Kapcie"],
      "Obuwie sportowe": ["Halówki piłkarskie","Buty do fitnessu","Buty motocyklowe","Rolki i wrotki"]
    },
    "Ubrania": { "__items": ["Kurtki i płaszcze","Bluzy","T-shirty","Spodnie","Swetry i kardigany","Koszule","Dresy","Szorty","Bielizna i skarpety"] },
    "Akcesoria": { "__items": ["Czapki i kapelusze","Torby i plecaki","Paski","Zegarki"] }
  },
  "Kobiety": {
    "Obuwie": { "__items": ["Sneakersy","Trekkingi","Buty na obcasie","Kozaki i botki","Sandały i klapki","Baleriny i mokasyny","Buty sportowe","Kapcie","Kalosze i śniegowce"] },
    "Ubrania": { "__items": ["Sukienki","Bluzki i koszule","Kurtki i płaszcze","Spodnie","Spódnice","Swetry i kardigany","Bluzy","T-shirty","Bielizna i piżamy","Stroje kąpielowe","Dresy i komplety"] },
    "Akcesoria": { "__items": ["Torebki","Szale i chusty","Biżuteria","Zegarki","Czapki i kapelusze"] }
  },
  "Dzieci": {
    "Obuwie": { "__items": ["Sneakersy","Sandały","Buty zimowe","Kapcie"] },
    "Ubrania": { "__items": ["Kurtki","Spodnie","Bluzy","T-shirty","Sukienki i spódniczki"] },
    "Akcesoria": { "__items": ["Czapki"] }
  }
};

function aiParsePathToCat(path) {
  if (!path) return { gender: "", section: "", sub: "" };
  const parts = String(path).split(">").map(s => s.trim());
  const gender = parts[0] || "";
  const section = parts[1] || "";
  const sub = parts.slice(2).join(" > ");
  return { gender, section, sub };
}

async function aiApplyCatPath(item, path) {
  item.resolved = item.resolved || {};
  const id = aiFindLeafIdByLabel(path);
  if (id) {
    item.resolved.catalog_id = id;
    const leaf = aiCatalogLeaves.find(l => l.id === id);
    item.resolved.catalog_title = leaf?.title || path.split(">").pop().trim();
    item.resolved.size_id = null;
    item.resolved.size_title = "";
    await aiLoadSizesForCatalog(id);
    const sizes = aiSizesCache[id] || [];
    const pick = aiPickSizeFromList(sizes, item.size);
    if (pick) { item.resolved.size_id = pick.id; item.resolved.size_title = pick.title; }
  } else {
    item.resolved.catalog_id = null;
    item.resolved.catalog_title = path.split(">").pop().trim();
  }
}

function aiCatButtonsHtml(item) {
  const cat = item.aiCat || { gender: "", section: "", subsection: "" };

  if (!cat.gender && item.resolved?.catalog_id) {
    const leaf = aiCatalogLeaves.find(l => l.id === Number(item.resolved.catalog_id));
    if (leaf?.path) {
      const parts = leaf.path.split(">").map(s => s.trim());
      cat.gender = parts[0] || "";
      cat.section = parts[1] || "";
      cat.subsection = parts.length > 3 ? parts[2] : "";
      item.aiCat = cat;
    }
  }

  const currentPath = item.resolved?.catalog_id
    ? (aiCatalogLeaves.find(l => l.id === Number(item.resolved.catalog_id))?.path || item.resolved.catalog_title || "")
    : "";

  const tagBtn = currentPath
    ? `<div style="margin-bottom:6px"><span style="display:inline-flex;align-items:center;gap:6px;background:color-mix(in srgb,var(--p) 15%,var(--s2));color:var(--p);padding:4px 8px;border-radius:12px;font-size:12px">${aiEscape(currentPath)} <button type="button" class="ai-cat-clear" style="background:transparent;border:0;color:var(--p);cursor:pointer;font-weight:bold">×</button></span></div>`
    : "";

  let breadParts = [];
  if (cat.gender) breadParts.push({ label: cat.gender, lvl: 1 });
  if (cat.section) breadParts.push({ label: cat.section, lvl: 2 });
  if (cat.subsection) breadParts.push({ label: cat.subsection, lvl: 3 });
  const breadcrumb = breadParts.length
    ? `<div class="muted" style="font-size:11px;margin-bottom:4px">
        <a href="#" class="ai-cat-crumb" data-lvl="0" style="color:inherit;text-decoration:underline">wszystkie</a>
        ${breadParts.map(p => ` › <a href="#" class="ai-cat-crumb" data-lvl="${p.lvl}" style="color:inherit;text-decoration:underline">${aiEscape(p.label)}</a>`).join("")}
      </div>`
    : "";

  const genderBtns = `<div>${Object.keys(AI_CATEGORY_TREE).map(g =>
    `<button type="button" class="btn ai-cat-gender${cat.gender===g?" primary":""}" data-g="${aiEscape(g)}" style="margin:2px">${aiEscape(g)}</button>`
  ).join("")}</div>`;

  let sectionRow = "";
  if (cat.gender && AI_CATEGORY_TREE[cat.gender]) {
    const sections = Object.keys(AI_CATEGORY_TREE[cat.gender]);
    sectionRow = `<div style="margin-top:6px">${sections.map(s =>
      `<button type="button" class="btn ai-cat-section${cat.section===s?" primary":""}" data-s="${aiEscape(s)}" style="margin:2px">${aiEscape(s)}</button>`
    ).join("")}</div>`;
  }

  let subgroupRow = "";
  let subRow = "";
  if (cat.gender && cat.section && AI_CATEGORY_TREE[cat.gender]?.[cat.section]) {
    const sectionData = AI_CATEGORY_TREE[cat.gender][cat.section];
    const directItems = sectionData["__items"] || [];
    const subgroups = Object.keys(sectionData).filter(k => k !== "__items");

    if (subgroups.length) {
      subgroupRow = `<div style="margin-top:6px">${subgroups.map(sg =>
        `<button type="button" class="btn ai-cat-subgroup${cat.subsection===sg?" primary":""}" data-sg="${aiEscape(sg)}" style="margin:2px;font-size:12px;background:color-mix(in srgb,var(--p) 8%,var(--s2))">${aiEscape(sg)}</button>`
      ).join("")}</div>`;
    }

    if (cat.subsection && sectionData[cat.subsection]) {
      const subItems = sectionData[cat.subsection];
      subRow = `<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px">${subItems.map(sub => {
        const fullPath = `${cat.gender} > ${cat.section} > ${cat.subsection} > ${sub}`;
        const active = currentPath === fullPath;
        return `<button type="button" class="btn ai-cat-sub${active?" primary":""}" data-sub="${aiEscape(sub)}" data-full="${aiEscape(fullPath)}" style="margin:2px;font-size:12px">${aiEscape(sub)}</button>`;
      }).join("")}</div>`;
    } else if (directItems.length) {
      subRow = `<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px">${directItems.map(sub => {
        const fullPath = `${cat.gender} > ${cat.section} > ${sub}`;
        const active = currentPath === fullPath;
        return `<button type="button" class="btn ai-cat-sub${active?" primary":""}" data-sub="${aiEscape(sub)}" data-full="${aiEscape(fullPath)}" style="margin:2px;font-size:12px">${aiEscape(sub)}</button>`;
      }).join("")}</div>`;
    }
  }

  return `
    ${tagBtn}
    ${breadcrumb}
    ${genderBtns}
    ${sectionRow}
    ${subgroupRow}
    ${subRow}
    <label class="muted" style="margin-top:8px;display:block;font-size:11px">lub wpisz ręcznie</label>
    <input class="ai-cat" list="aiCatList" type="text" value="${aiEscape(currentPath)}" style="width:100%" placeholder="np. Mężczyźni > Obuwie > Trekkingi" />
    ${aiFieldWarn(item.resolved?.catalog_id)}
  `;
}


function aiRenderCard(item) {
  const container = document.getElementById("aiItems");
  if (!container) return;
  let card = container.querySelector(`[data-ai-id="${item.id}"]`);
  if (!card) {
    card = document.createElement("div");
    card.className = "card";
    card.style.padding = "12px";
    card.style.border = "1px solid var(--border, #333)";
    card.style.borderRadius = "8px";
    card.dataset.aiId = item.id;
    container.appendChild(card);
  }
  const thumbs = (item.photos || []).map(u =>
    `<img src="${aiEscape(u)}" style="width:48px;height:48px;object-fit:cover;border-radius:4px;margin:2px" />`
  ).join("");
  const gen = item.gen;
  const res = item.resolved;

  let previewHtml = "";
  if (gen) {
    const statusCurrent = res?.status_label || gen.condition || "";
    const statusOpts = AI_STATUS_OPTIONS.map(s =>
      `<option value="${aiEscape(s)}"${aiNorm(s)===aiNorm(statusCurrent)?" selected":""}>${aiEscape(s)}</option>`
    ).join("");
    const catValue = res?.catalog_id
      ? (aiCatalogLeaves.find(l => l.id === Number(res.catalog_id))?.path || res.catalog_title || "")
      : "";
    const sizeList = (res?.catalog_id && aiSizesCache[res.catalog_id]) || [];
    const sizeOpts = sizeList.length
      ? `<option value="">— wybierz —</option>` + sizeList.map(s =>
          `<option value="${s.id}"${Number(res?.size_id)===Number(s.id)?" selected":""}>${aiEscape(s.title)}</option>`
        ).join("")
      : `<option value="">najpierw wybierz kategorię</option>`;
    previewHtml = `
      <div style="margin-top:10px;padding-top:10px;border-top:1px dashed var(--border,#333)">
        <label class="muted">Tytuł</label>
        <input class="ai-title" type="text" value="${aiEscape(gen.title)}" style="width:100%" />
        <label class="muted" style="margin-top:6px;display:block">Opis</label>
        <textarea class="ai-desc" rows="4" style="width:100%">${aiEscape(gen.description)}</textarea>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px;font-size:12px">
          <div style="grid-column:1/-1">
            <label class="muted">Kategoria</label>
            ${aiCatButtonsHtml(item)}
          </div>
          <div>
            <label class="muted">Rozmiar</label>
            <select class="ai-size" style="width:100%" ${res?.catalog_id?"":"disabled"}>${sizeOpts}</select>
            ${aiFieldWarn(res?.size_id)}
          </div>
          <div>
            <label class="muted">Stan</label>
            <select class="ai-status" style="width:100%">${statusOpts}</select>
          </div>
          <div><b>Marka:</b> ${aiEscape(res?.brand_title) || "—"} ${aiFieldWarn(res?.brand_id)}</div>
          <div><b>Kolor:</b> ${aiEscape(res?.color_title) || "—"} ${aiFieldWarn(res?.color_id)}</div>
          <div><b>Paczka (ID):</b> ${res?.package_size_id ?? "—"} ${aiFieldWarn(res?.package_size_id)}</div>
        </div>
      </div>`;
  }

  card.innerHTML = `
    <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-start">
      <div style="flex:1;min-width:260px">
        <label class="muted">Zdjęcia</label>
        <input class="ai-photos" type="file" accept="image/*" multiple />
        <div class="ai-thumbs" style="display:flex;flex-wrap:wrap;margin-top:4px">${thumbs}</div>
      </div>
      <div style="flex:2;min-width:260px;display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div style="grid-column:1/-1">
          <label class="muted">Nazwa produktu</label>
          <input class="ai-name" type="text" value="${aiEscape(item.name)}" style="width:100%" placeholder="np. Nike Air Force 1 białe" />
        </div>
        <div style="grid-column:1/-1">
          <label class="muted">Opis stanu (wady, użycie)</label>
          <textarea class="ai-condition" rows="2" style="width:100%" placeholder="np. lekkie zabrudzenia na podeszwie">${aiEscape(item.condition)}</textarea>
        </div>
        <div>
          <label class="muted">Rozmiar</label>
          <input class="ai-size-in" type="text" value="${aiEscape(item.size)}" style="width:100%" placeholder="np. 45 (EU)" />
        </div>
        <div>
          <label class="muted">Cena (PLN)</label>
          <input class="ai-price" type="number" min="0" step="0.01" value="${aiEscape(item.price)}" style="width:100%" />
        </div>
        <div>
          <label class="muted">Wielkość paczki</label>
          <select class="ai-package" style="width:100%">
            <option value="S"${item.packageSize==="S"?" selected":""}>Mała (S)</option>
            <option value="M"${item.packageSize==="M"?" selected":""}>Średnia (M)</option>
            <option value="L"${item.packageSize==="L"?" selected":""}>Duża (L)</option>
          </select>
        </div>
        <div style="display:flex;align-items:flex-end;justify-content:flex-end">
          <button class="btn ghost ai-remove" type="button">Usuń</button>
        </div>
      </div>
    </div>
    ${previewHtml}
  `;

  card.querySelector(".ai-photos").addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const urls = await readFilesAsDataUrls(files);
    item.photos = (item.photos || []).concat(urls);
    aiRenderCard(item);
  });
  card.querySelector(".ai-name").addEventListener("input", e => { item.name = e.target.value; });
  card.querySelector(".ai-condition").addEventListener("input", e => { item.condition = e.target.value; });
  card.querySelector(".ai-size-in").addEventListener("input", e => { item.size = e.target.value; });
  card.querySelector(".ai-price").addEventListener("input", e => { item.price = e.target.value; });
  card.querySelector(".ai-package").addEventListener("change", e => { item.packageSize = e.target.value; });
  card.querySelector(".ai-remove").addEventListener("click", () => {
    aiItems = aiItems.filter(x => x.id !== item.id);
    card.remove();
    aiRefreshActionsVisibility();
  });
  const titleEl = card.querySelector(".ai-title");
  if (titleEl) titleEl.addEventListener("input", e => { if (item.gen) item.gen.title = e.target.value; });
  const descEl = card.querySelector(".ai-desc");
  if (descEl) descEl.addEventListener("input", e => { if (item.gen) item.gen.description = e.target.value; });

  const statusEl = card.querySelector(".ai-status");
  if (statusEl) statusEl.addEventListener("change", e => {
    const label = e.target.value;
    item.resolved = item.resolved || {};
    item.resolved.status_label = label;
    item.resolved.status_id = AI_STATUS_MAP[label] || null;
  });
  const catEl = card.querySelector(".ai-cat");
  if (catEl) catEl.addEventListener("change", async e => {
    const val = e.target.value;
    const id = aiFindLeafIdByLabel(val);
    item.resolved = item.resolved || {};
    if (id) {
      item.resolved.catalog_id = id;
      const leaf = aiCatalogLeaves.find(l => l.id === id);
      item.resolved.catalog_title = leaf?.title || val;
      item.resolved.size_id = null;
      item.resolved.size_title = "";
      await aiLoadSizesForCatalog(id);
      const sizes = aiSizesCache[id] || [];
      const pick = aiPickSizeFromList(sizes, item.size);
      if (pick) { item.resolved.size_id = pick.id; item.resolved.size_title = pick.title; }
      aiRenderCard(item);
    } else {
      item.resolved.catalog_id = null;
      item.resolved.catalog_title = "";
      aiRenderCard(item);
    }
  });
  card.querySelectorAll(".ai-cat-gender").forEach(btn => btn.addEventListener("click", () => {
    item.aiCat = { gender: btn.dataset.g, section: "" };
    aiRenderCard(item);
  }));
  card.querySelectorAll(".ai-cat-section").forEach(btn => btn.addEventListener("click", () => {
    item.aiCat = { gender: item.aiCat?.gender || "", section: btn.dataset.s };
    aiRenderCard(item);
  }));
  card.querySelectorAll(".ai-cat-sub").forEach(btn => btn.addEventListener("click", async () => {
    const g = item.aiCat?.gender || ""; const s = item.aiCat?.section || "";
    if (!g || !s) return;
    const fullPath = `${g} > ${s} > ${btn.dataset.sub}`;
    await aiApplyCatPath(item, fullPath);
    aiRenderCard(item);
  }));
  card.querySelectorAll(".ai-cat-crumb").forEach(a => a.addEventListener("click", (e) => {
    e.preventDefault();
    const lvl = Number(a.dataset.lvl);
    if (lvl === 0) item.aiCat = { gender: "", section: "" };
    else if (lvl === 1) item.aiCat = { gender: item.aiCat?.gender || "", section: "" };
    aiRenderCard(item);
  }));
  const catClear = card.querySelector(".ai-cat-clear");
  if (catClear) catClear.addEventListener("click", () => {
    item.resolved = item.resolved || {};
    item.resolved.catalog_id = null;
    item.resolved.catalog_title = "";
    item.resolved.size_id = null;
    item.resolved.size_title = "";
    aiRenderCard(item);
  });
  const sizeEl = card.querySelector(".ai-size");
  if (sizeEl && res?.catalog_id) sizeEl.addEventListener("change", e => {
    const id = Number(e.target.value) || null;
    item.resolved = item.resolved || {};
    item.resolved.size_id = id;
    const sizes = aiSizesCache[res.catalog_id] || [];
    const hit = sizes.find(s => Number(s.id) === id);
    item.resolved.size_title = hit ? hit.title : "";
  });
}


function aiAddCard(seed) {
  const item = Object.assign({
    id: aiUid(), photos: [], name: "", condition: "", size: "", price: "", packageSize: "M", gen: null, resolved: null,
  }, seed || {});
  aiItems.push(item);
  aiRenderCard(item);
  return item;
}

function aiRefreshActionsVisibility() {
  const actions = document.getElementById("aiActions");
  const delayRow = document.getElementById("aiDelayRow");
  if (!actions) return;
  const anyGen = aiItems.some(it => it.gen);
  actions.classList.toggle("hidden", !anyGen);
  if (delayRow) delayRow.classList.toggle("hidden", !(anyGen && aiItems.length > 1));
}

async function generateListingAI(input, categoryLeaves) {
  const { session, supabaseUrl, supabaseAnonKey } = await chrome.storage.local.get([
    "session", "supabaseUrl", "supabaseAnonKey",
  ]);
  const base = supabaseUrl || "https://vdkxhhgoloiylkscessp.supabase.co";
  const token = session?.access_token || "";
  const anon = supabaseAnonKey || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZka3hoaGdvbG9peWxrc2Nlc3NwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2NjYxMjUsImV4cCI6MjA5ODI0MjEyNX0.ZQzRkY2Utf405okkc0b-JJK2zXW40C0EM9XxlzWUOek";
  const res = await fetch(`${base}/functions/v1/generate-listing`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token || anon}`,
      "apikey": anon,
    },
    body: JSON.stringify({
      name: input.name || "",
      condition: input.condition || "",
      size: input.size || "",
      price: input.price || "",
      packageSize: input.packageSize || "",
      categoryLeaves: Array.isArray(categoryLeaves) ? categoryLeaves : [],
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return {
    title: data.title || "",
    description: data.description || "",
    brand: data.brand || "",
    category: data.category || "",
    color: data.color || "",
    condition: data.condition || "",
  };
}


async function initAiUI() {
  try {
    const s = await chrome.storage.local.get(["aiDelayMin", "aiDelayMax"]);
    const mn = Number.isFinite(s.aiDelayMin) ? s.aiDelayMin : AI_DELAY_DEFAULTS.aiDelayMin;
    const mx = Number.isFinite(s.aiDelayMax) ? s.aiDelayMax : AI_DELAY_DEFAULTS.aiDelayMax;
    const $mn = document.getElementById("aiDelayMin");
    const $mx = document.getElementById("aiDelayMax");
    if ($mn && $mx) {
      $mn.value = mn; $mx.value = mx;
      document.getElementById("aiDelayMinLabel").textContent = `${mn}s`;
      document.getElementById("aiDelayMaxLabel").textContent = `${mx}s`;
      if (typeof initDualSlider === "function") {
        initDualSlider("#aiDelayMin", "#aiDelayMax", "#aiDelayRange", "#aiDelayMinLabel", "#aiDelayMaxLabel");
      }
    }
  } catch {}
  if (!aiItems.length) aiAddCard();
}

document.getElementById("aiAddItemBtn")?.addEventListener("click", () => { aiAddCard(); });

document.getElementById("aiGenerateBtn")?.addEventListener("click", async () => {
  const btn = document.getElementById("aiGenerateBtn");
  const status = document.getElementById("aiGenStatus");
  const targets = aiItems.filter(it => (it.name || "").trim());
  if (!targets.length) { aiLog("Uzupełnij co najmniej jeden przedmiot (nazwa)", "err"); return; }
  const tab = await getVintedTab();
  if (!tab) { aiLog("Otwórz zalogowaną kartę vinted.*", "err"); return; }
  btn.disabled = true;
  try {
    await aiEnsureCatalogLeaves();
    const leafPaths = (aiCatalogLeaves || []).map(l => l.path).filter(Boolean);
    for (let i = 0; i < targets.length; i++) {
      const it = targets[i];
      if (status) status.textContent = `Generuję (${i+1}/${targets.length}): ${it.name}`;
      aiLog(`Generuję (${i+1}/${targets.length}): ${it.name}`);
      try {
        const gen = await generateListingAI(it, leafPaths);
        it.gen = gen;
        const r = await vintedMsg(tab.id, {
          kind: "RESOLVE_AI_ATTRS_V2",
          category: gen.category, brand: gen.brand, color: gen.color,
          condition: gen.condition, size: it.size, packageSize: it.packageSize,
        });
        it.resolved = r?.resolved || null;
        if (it.resolved) {
          if (!it.resolved.status_id && AI_STATUS_MAP[gen.condition]) {
            it.resolved.status_id = AI_STATUS_MAP[gen.condition];
            it.resolved.status_label = gen.condition;
          }
          if (it.resolved.catalog_id) {
            const sizes = await aiLoadSizesForCatalog(it.resolved.catalog_id);
            if (!it.resolved.size_id) {
              const pick = aiPickSizeFromList(sizes, it.size);
              if (pick) { it.resolved.size_id = pick.id; it.resolved.size_title = pick.title; }
            }
          }
        }
        aiRenderCard(it);
        aiLog(`  ✓ wygenerowano: ${gen.title}`, "ok");
      } catch (e) {
        aiLog(`  ✗ ${e.message}`, "err");
      }
    }

  } finally {
    btn.disabled = false;
    if (status) status.textContent = "";
    aiRefreshActionsVisibility();
  }
});

async function aiRun(mode) {
  const target = aiItems.filter(it => {
    const r = it.resolved;
    return it.gen && (it.photos || []).length &&
      r && r.catalog_id && r.size_id && r.status_id && Number(it.price) > 0;
  });
  const skipped = aiItems.length - target.length;
  if (skipped > 0) aiLog(`Pomijam ${skipped} niekompletnych przedmiotów`, "warn");
  if (!target.length) { aiLog("Brak kompletnych przedmiotów do wysłania", "err"); return; }
  if (mode === "publish" && !confirm(`Opublikować ${target.length} ogłoszeń?`)) return;

  const tab = await getVintedTab();
  if (!tab) { aiLog("Otwórz zalogowaną kartę vinted.*", "err"); return; }

  const $mn = document.getElementById("aiDelayMin");
  const $mx = document.getElementById("aiDelayMax");
  let dMin = parseInt($mn?.value) || AI_DELAY_DEFAULTS.aiDelayMin;
  let dMax = parseInt($mx?.value) || AI_DELAY_DEFAULTS.aiDelayMax;
  if (dMax < dMin) dMax = dMin;
  try { await chrome.storage.local.set({ aiDelayMin: dMin, aiDelayMax: dMax }); } catch {}

  const btnD = document.getElementById("aiDraftBtn");
  const btnP = document.getElementById("aiPublishBtn");
  btnD.disabled = true; btnP.disabled = true;

  for (let i = 0; i < target.length; i++) {
    const it = target[i];
    if (mode === "publish" && i > 0 && target.length > 1) {
      const wait = Math.floor(dMin + Math.random() * (dMax - dMin + 1));
      aiLog(`⏳ Czekam ${wait}s…`);
      await new Promise(r => setTimeout(r, wait * 1000));
    } else if (mode === "draft" && (i + 1) % 10 === 0 && i < target.length - 1) {
      aiLog("⏳ Pauza 10 s (co 10 ogłoszeń)");
      await new Promise(r => setTimeout(r, 10000));
    }
    aiLog(`(${i+1}/${target.length}) ${it.gen.title}`);
    try {
      const r = it.resolved;
      const attributes = {
        title: it.gen.title,
        description: it.gen.description,
        price: Number(it.price),
        currency: "PLN",
        brand_id: r.brand_id,
        brand: r.brand_title,
        size_id: r.size_id,
        status_id: r.status_id,
        catalog_id: r.catalog_id,
        color_ids: r.color_id ? [r.color_id] : [],
        package_size_id: r.package_size_id,
        is_unisex: false,
      };
      const resp = await vintedMsg(tab.id, { kind: "CREATE_LISTING_V2", attributes, photos: it.photos, mode });
      if (resp?.ok) {
        aiLog(`  ✓ ${mode === "publish" ? "opublikowano" : "zapisano jako draft"} (ID ${resp.id})`, "ok");
      } else {
        aiLog(`  ✗ ${resp?.error || "nieznany błąd"}`, "err");
      }
    } catch (e) {
      aiLog(`  ✗ ${e.message}`, "err");
    }
  }
  aiLog("— gotowe —");
  btnD.disabled = false; btnP.disabled = false;
}

document.getElementById("aiDraftBtn")?.addEventListener("click", () => aiRun("draft"));
document.getElementById("aiPublishBtn")?.addEventListener("click", () => aiRun("publish"));
initAiUI();

