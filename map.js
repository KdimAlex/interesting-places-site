const CAT_COLOR = {
  nature: "#61BB46",
  shop: "#FDB827",
  food: "#F5821F",
  stay: "#E03A3E",
  culture: "#963D97",
  cafe: "#F5821F",
  bar: "#E03A3E",
  view: "#009DDC",
  architecture: "#963D97",
  other: "#009DDC",
};

const CHIPS = ["all", "food", "cafe", "shop", "nature", "view", "culture", "other"];

const searchEl = document.getElementById("search");
const chipsEl = document.getElementById("chips");
const listEl = document.getElementById("list");
const statusEl = document.getElementById("status");
const panelEl = document.getElementById("panel");
const mapToggleEl = document.getElementById("mapToggle");
const detailEl = document.getElementById("detail");
const detailCloseEl = document.getElementById("detailClose");
const detailPhotoWrap = document.getElementById("detailPhotoWrap");
const detailPhoto = document.getElementById("detailPhoto");
const detailTitle = document.getElementById("detailTitle");
const detailAddress = document.getElementById("detailAddress");
const detailNotes = document.getElementById("detailNotes");
const mapsLink = document.getElementById("mapsLink");
const locateEl = document.getElementById("locate");

let places = [];
let activeCategory = "all";
let activeId = null;
let map;
let markerLayer;
let cryptoKey = null;
let photoUrl = "";
let photoGen = 0;
const markers = new Map();

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function annotationText(place) {
  return (place.annotations || []).map((item) => item.text).filter(Boolean);
}

function keyBytes() {
  const raw = new URLSearchParams(location.hash.replace(/^#/, "")).get("k") || "";
  if (!raw) return null;
  const pad = raw.length % 4 === 0 ? "" : "=".repeat(4 - (raw.length % 4));
  const b64 = raw.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out.length === 32 ? out : null;
}

async function placeKey() {
  if (cryptoKey) return cryptoKey;
  const raw = keyBytes();
  if (!raw) return null;
  cryptoKey = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
  return cryptoKey;
}

async function decryptBytes(packed) {
  const key = await placeKey();
  if (!key) throw new Error("locked");
  const iv = packed.slice(0, 12);
  const data = packed.slice(12);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  return new Uint8Array(plain);
}

function listed() {
  const q = searchEl.value.trim().toLowerCase();
  return places.filter((place) => {
    if (activeCategory !== "all" && (place.category || "other") !== activeCategory) return false;
    if (!q) return true;
    const hay = [place.name, place.address, place.notes, place.category, ...annotationText(place)]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
}

function renderChips() {
  chipsEl.replaceChildren();
  for (const id of CHIPS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chip" + (id === activeCategory ? " is-on" : "");
    button.textContent = id === "all" ? "All" : id[0].toUpperCase() + id.slice(1);
    button.addEventListener("click", () => {
      activeCategory = id;
      renderChips();
      renderList();
      renderMarkers();
    });
    chipsEl.appendChild(button);
  }
}

function renderList() {
  const rows = listed();
  statusEl.textContent = places.length ? `${rows.length} of ${places.length}` : "No places published yet.";
  const frag = document.createDocumentFragment();
  for (const place of rows) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "place-row" + (place.id === activeId ? " is-active" : "");
    const meta = [place.category || "other", place.address].filter(Boolean).join(" · ");
    button.innerHTML =
      `<span class="place-name">${escapeHtml(place.name || "Place")}</span>` +
      `<span class="place-meta">${escapeHtml(meta)}</span>`;
    button.addEventListener("click", () => selectPlace(place.id, true));
    frag.appendChild(button);
  }
  listEl.replaceChildren(frag);
}

function renderMarkers() {
  if (!map) return;
  if (markerLayer) map.removeLayer(markerLayer);
  markers.clear();
  markerLayer = L.layerGroup();
  for (const place of listed()) {
    if (place.lat == null || place.lon == null) continue;
    const selected = place.id === activeId;
    const marker = L.circleMarker([place.lat, place.lon], {
      radius: selected ? 9 : 7,
      weight: 2,
      color: "#fff",
      fillColor: CAT_COLOR[place.category] || CAT_COLOR.other,
      fillOpacity: 1,
    });
    marker.bindTooltip(escapeHtml(place.name || "Place"), { direction: "top", offset: [0, -8] });
    marker.on("click", (event) => {
      L.DomEvent.stopPropagation(event);
      selectPlace(place.id, false);
    });
    marker.addTo(markerLayer);
    markers.set(place.id, marker);
  }
  markerLayer.addTo(map);
}

function revokePhoto() {
  if (photoUrl) URL.revokeObjectURL(photoUrl);
  photoUrl = "";
  detailPhoto.removeAttribute("src");
}

async function showPhoto(place) {
  const gen = ++photoGen;
  revokePhoto();
  if (!place.photo) {
    detailPhotoWrap.hidden = true;
    return;
  }
  detailPhotoWrap.hidden = false;
  detailPhoto.alt = place.name || "";
  try {
    const response = await fetch(place.photo);
    if (!response.ok) throw new Error("missing");
    const plain = await decryptBytes(new Uint8Array(await response.arrayBuffer()));
    if (gen !== photoGen) return;
    photoUrl = URL.createObjectURL(new Blob([plain], { type: "image/jpeg" }));
    detailPhoto.src = photoUrl;
  } catch {
    if (gen !== photoGen) return;
    detailPhotoWrap.hidden = true;
  }
}

function showDetail(place) {
  if (!place) {
    detailEl.hidden = true;
    photoGen += 1;
    revokePhoto();
    return;
  }
  detailTitle.textContent = place.name || "Place";
  detailAddress.textContent = place.address || "";
  const notes = annotationText(place);
  detailNotes.hidden = notes.length === 0;
  detailNotes.textContent = notes.join("\n");
  if (place.maps_url) {
    mapsLink.hidden = false;
    mapsLink.href = place.maps_url;
  } else if (place.lat != null && place.lon != null) {
    mapsLink.hidden = false;
    mapsLink.href = `https://maps.apple.com/?ll=${place.lat},${place.lon}&q=${encodeURIComponent(place.name || "Place")}`;
  } else {
    mapsLink.hidden = true;
  }
  detailEl.hidden = false;
  showPhoto(place);
}

function selectPlace(id, pan) {
  activeId = id;
  const place = places.find((item) => item.id === id);
  showDetail(place);
  renderList();
  renderMarkers();
  if (pan && place && map && place.lat != null && place.lon != null) {
    map.setView([place.lat, place.lon], Math.max(map.getZoom(), 14), { animate: true });
  }
}

function fitPlaces(rows) {
  const coords = rows.filter((place) => place.lat != null && place.lon != null);
  if (!coords.length) {
    map.setView([25.77, -80.19], 11);
    return;
  }
  if (coords.length === 1) {
    map.setView([coords[0].lat, coords[0].lon], 14);
    return;
  }
  map.fitBounds(L.latLngBounds(coords.map((place) => [place.lat, place.lon])).pad(0.15), { animate: false });
}

function locate(pan) {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      if (pan && map) map.setView([pos.coords.latitude, pos.coords.longitude], Math.max(map.getZoom(), 13));
    },
    () => {},
    { enableHighAccuracy: false, maximumAge: 300000, timeout: 8000 }
  );
}

async function boot() {
  renderChips();
  map = L.map("map", { zoomControl: true, attributionControl: true });
  L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    {
      attribution: "Tiles &copy; Esri",
      maxZoom: 16,
      minZoom: 3,
    }
  ).addTo(map);
  if (!keyBytes()) {
    statusEl.textContent = "This map is private. Open the link that includes your key.";
    return;
  }
  let packed;
  try {
    const response = await fetch("data/catalog.enc");
    if (!response.ok) throw new Error("missing");
    packed = new Uint8Array(await response.arrayBuffer());
    const plain = await decryptBytes(packed);
    const data = JSON.parse(new TextDecoder().decode(plain));
    places = Array.isArray(data.places) ? data.places : [];
  } catch {
    statusEl.textContent = "This map is private. Open the link that includes your key.";
    return;
  }
  fitPlaces(places);
  renderList();
  renderMarkers();
  locate(false);
}

searchEl.addEventListener("input", () => {
  renderList();
  renderMarkers();
});
detailCloseEl.addEventListener("click", () => {
  activeId = null;
  showDetail(null);
  renderList();
  renderMarkers();
});
mapToggleEl.addEventListener("click", () => {
  const on = panelEl.classList.toggle("is-map");
  mapToggleEl.setAttribute("aria-pressed", on ? "true" : "false");
  mapToggleEl.textContent = on ? "List" : "Map";
  setTimeout(() => map.invalidateSize(), 220);
});
locateEl.addEventListener("click", () => locate(true));

boot();
