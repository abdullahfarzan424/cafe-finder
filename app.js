// ---------- Helpers ----------
const $ = (sel) => document.querySelector(sel);

function haversine(lat1, lon1, lat2, lon2){
  const toRad = x => x * Math.PI / 180;
  const R = 6371000; // m
  const dLat = toRad(lat2-lat1);
  const dLon = toRad(lon2-lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
function fmtDistance(m){ return m >= 1000 ? (m/1000).toFixed(2) + " km" : Math.round(m) + " m"; }
function escapeHTML(s=""){ return s.replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }

// ---------- Map ----------
const map = L.map('map', { zoomControl: true, scrollWheelZoom: true }).setView([6.9271, 79.8612], 13); // Colombo default
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 20,
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

const centerMarker = L.circleMarker([0,0], {
  radius: 8, weight:2, color:'#62b0ff', fillColor:'#62b0ff', fillOpacity:.35
}).addTo(map);
const radiusCircle = L.circle([0,0], { radius: 1500, color:'#62b0ff', weight:1, opacity:.5, fillOpacity: .05 }).addTo(map);
const cafeLayer = L.layerGroup().addTo(map);

// ---------- DOM refs ----------
const searchInput = $('#searchInput');
const searchBtn = $('#searchBtn');
const locateBtn = $('#locateBtn');
const resultsEl = $('#results');
const radiusInput = $('#radius');
const radiusLabel = $('#radiusLabel');
const limitInput = $('#limit');
const limitLabel = $('#limitLabel');

radiusLabel.textContent = radiusInput.value;
limitLabel.textContent = limitInput.value;

radiusInput.addEventListener('input', () => {
  radiusLabel.textContent = radiusInput.value;
  radiusCircle.setRadius(Number(radiusInput.value));
  if (state.center) fetchAndRenderCafes();
});
limitInput.addEventListener('input', () => {
  limitLabel.textContent = limitInput.value;
  if (state.center) fetchAndRenderCafes();
});

// ---------- State ----------
const state = { center: null };
const markersById = new Map();

function setCenter(lat, lon, zoom=15){
  state.center = {lat, lon};
  map.setView([lat, lon], zoom);
  centerMarker.setLatLng([lat, lon]);
  radiusCircle.setLatLng([lat, lon]);
}

// ---------- Overpass query (amenity=cafe) ----------
function overpassQuery(lat, lon, radius, limit=30){
  return `
    [out:json][timeout:25];
    (
      node["amenity"="cafe"](around:${radius},${lat},${lon});
      way["amenity"="cafe"](around:${radius},${lat},${lon});
      relation["amenity"="cafe"](around:${radius},${lat},${lon});
    );
    out center ${limit > 0 ? limit : ''};
  `;
}

async function fetchCafes(lat, lon, radius, limit=30){
  const body = overpassQuery(lat, lon, radius, limit);
  const resp = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
    body: new URLSearchParams({ data: body })
  });
  if (!resp.ok) throw new Error("Overpass request failed");
  const data = await resp.json();
  return (data.elements || [])
    .map(el => {
      const lat_ = el.lat ?? el.center?.lat;
      const lon_ = el.lon ?? el.center?.lon;
      return { id: el.id, lat: lat_, lon: lon_, tags: el.tags || {} };
    })
    .filter(x => x.lat && x.lon);
}

function makePopupHTML(cafe, dist){
  const t = cafe.tags || {};
  const name = t.name || "Unnamed café";
  const addr = [t['addr:housenumber'], t['addr:street'], t['addr:city']].filter(Boolean).join(", ");
  const oh = t.opening_hours ? `<div><strong>Hours:</strong> ${escapeHTML(t.opening_hours)}</div>` : "";
  const phone = t.phone || t['contact:phone'];
  const web = t.website || t['contact:website'];
  return `
    <div style="min-width:200px">
      <div style="font-weight:800;margin-bottom:4px">${escapeHTML(name)}</div>
      <div style="color:#8aa0b2">${addr ? escapeHTML(addr) : "Address: N/A"}</div>
      ${oh}
      ${phone ? `<div><strong>Phone:</strong> ${escapeHTML(phone)}</div>` : ""}
      ${web ? `<div><a href="${web}" target="_blank" rel="noreferrer">Website</a></div>` : ""}
      <div style="margin-top:6px;color:#a6b7c7">Distance: ${fmtDistance(dist)}</div>
    </div>
  `;
}

function renderResults(list, origin){
  resultsEl.innerHTML = "";
  markersById.clear();
  cafeLayer.clearLayers();

  list.forEach((cafe) => {
    const dist = haversine(origin.lat, origin.lon, cafe.lat, cafe.lon);
    const t = cafe.tags || {};
    const el = document.createElement("div");
    el.className = "result";
    el.setAttribute("role", "listitem");
    el.innerHTML = `
      <div class="name">${escapeHTML(t.name || "Unnamed café")}</div>
      <div class="meta">${fmtDistance(dist)} • ${escapeHTML(t['addr:street'] || t['addr:city'] || "Address N/A")}</div>
      <div class="badges">
        ${t.cuisine ? `<span class="badge">${escapeHTML(t.cuisine)}</span>` : ""}
        ${t['internet_access'] ? `<span class="badge">Wi-Fi: ${escapeHTML(t['internet_access'])}</span>` : ""}
        ${t['outdoor_seating']==="yes" ? `<span class="badge">Outdoor</span>` : ""}
      </div>
    `;
    el.addEventListener('click', () => {
      const m = markersById.get(cafe.id);
      if (m){
        m.openPopup();
        map.flyTo([cafe.lat, cafe.lon], 17, { duration: .6 });
      }
    });
    resultsEl.appendChild(el);

    const marker = L.marker([cafe.lat, cafe.lon]);
    marker.bindPopup(makePopupHTML(cafe, dist));
    marker.addTo(cafeLayer);
    markersById.set(cafe.id, marker);
  });
}

async function fetchAndRenderCafes(){
  if (!state.center) return;
  const radius = Number(radiusInput.value);
  const limit = Number(limitInput.value);

  resultsEl.innerHTML = `<div class="result"><div class="name">Searching…</div><div class="meta">Looking for cafés within ${radius} m</div></div>`;

  try{
    const cafes = await fetchCafes(state.center.lat, state.center.lon, radius, limit);
    cafes.sort((a,b) => {
      const da = haversine(state.center.lat, state.center.lon, a.lat, a.lon);
      const db = haversine(state.center.lat, state.center.lon, b.lat, b.lon);
      return da - db;
    });
    renderResults(cafes.slice(0, limit), state.center);
  } catch(err){
    console.error(err);
    resultsEl.innerHTML = `
      <div class="result">
        <div class="name">Couldn’t load cafés</div>
        <div class="meta">The Overpass API might be busy. Try again or reduce the radius.</div>
      </div>`;
  }
}

// ---------- Geocoding (Nominatim) ----------
async function geocode(q){
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format","json");
  url.searchParams.set("addressdetails","1");
  url.searchParams.set("limit","1");
  url.searchParams.set("q", q);

  const r = await fetch(url.toString(), { headers: { "Accept": "application/json" } });
  if (!r.ok) throw new Error("Geocoding failed");
  const arr = await r.json();
  if (!arr.length) throw new Error("No results");
  const { lat, lon } = arr[0];
  return { lat: Number(lat), lon: Number(lon) };
}

// ---------- Events ----------
searchBtn.addEventListener('click', async () => {
  const q = (searchInput.value || "").trim();
  if (!q) { searchInput.focus(); return; }
  try{
    const g = await geocode(q);
    setCenter(g.lat, g.lon, 15);
    fetchAndRenderCafes();
  }catch(err){
    alert("Place not found. Try a different search.");
  }
});
searchInput.addEventListener('keydown', (e) => {
  if (e.key === "Enter") searchBtn.click();
});

locateBtn.addEventListener('click', () => {
  if (!navigator.geolocation){
    alert("Geolocation is not supported by your browser.");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    pos => {
      const { latitude, longitude } = pos.coords;
      setCenter(latitude, longitude, 16);
      fetchAndRenderCafes();
    },
    () => alert("Couldn’t get your location. You can still search a place above."),
    { enableHighAccuracy:true, timeout: 12000, maximumAge: 0 }
  );
});

// ---------- Initial load ----------
setCenter(6.9271, 79.8612, 14); // Colombo center
fetchAndRenderCafes();
