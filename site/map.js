// The Map tab: every place on an Amap base map, or the trip day by day with the legs between stops.
// Leaflet loads only the first time the tab opens. Hotels (plan.hotels) are always on the map.
import { h, play, reduceMotion, yuan } from "./ui.js?v=19";
import { icon, svg } from "./icons.js?v=19";
import { transport } from "./now.js?v=19";
import * as T from "./trip.js?v=19";

// Amap street style with Chinese labels, the same names as the signs and the Amap app.
const TILES = "https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}";
const RAIL_H = 172; // room the leg cards take at the bottom of the map

let L = null, map = null, layer = null, youLayer = null, loading = null;
let ctx = null, els = null;
let mode = "all", area = null, day = null, you = null, pending = null, drawnKey = "", lastPts = [];
let segs = [], legGeo = [], activeLeg = -1;

export function renderMap(root, c) {
  ctx = c;
  if (!els) build(root);
  if (map && !root.hidden) draw();
}

// Called when the tab becomes visible (and from "Map" buttons elsewhere with what to show).
export function showMap(opts) {
  if (opts) pending = opts;
  ensure().then(() => {
    map.invalidateSize();
    if (pending) { mode = pending.mode || mode; day = pending.date || day; pending = null; drawnKey = ""; }
    draw();
  }).catch(() => { els.loading.textContent = "The map couldn't load. Check your connection."; });
}

function build(root) {
  const pill = h("span.mseg-pill");
  const segBtn = (m, label) => h("button", { role: "tab", "data-m": m, onclick: () => setMode(m) }, label);
  els = {
    seg: h("div.mseg", { role: "tablist", "aria-label": "Map view" }, pill, segBtn("all", "All places"), segBtn("trip", "Trip")),
    pill,
    top: h("div.map-top"),
    box: h("div.map-el"),
    rail: h("div.leg-rail", { hidden: true }),
    card: h("div.map-card", { hidden: true }),
    loading: h("div.map-loading", "Loading map"),
    below: h("div.map-below"),
  };
  const fab = (title, path, onclick) => h("button.map-fab.pressable", { title, "aria-label": title, onclick, html: `<svg viewBox="0 0 24 24">${path}</svg>` });
  els.wrap = h("div.map-wrap", els.box, els.loading,
    h("div.map-fabs",
      fab("Show me", '<path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2" class="fill"/>', locate),
      fab("Fit all", '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>', () => fitTo(lastPts))),
    els.rail, els.card);
  root.replaceChildren(
    h("div.map-head", h("h2.sec-title", "Map"), els.seg),
    els.top,
    els.wrap,
    els.below,
    h("p.foot", "Map © AutoNavi (Amap). Travel times are rough; tap one for live directions in Amap"));
}

function ensure() {
  if (loading) return loading;
  loading = new Promise((res, rej) => {
    document.head.append(h("link", { rel: "stylesheet", href: "vendor/leaflet.css?v=12" }));
    const s = h("script", { src: "vendor/leaflet.js?v=12" });
    s.onload = () => { L = window.L; init(); res(); };
    s.onerror = () => { loading = null; rej(); };
    document.head.append(s);
  });
  return loading;
}

function init() {
  map = L.map(els.box, { zoomControl: false, center: [29.56, 106.57], zoom: 13, zoomSnap: 0.25, attributionControl: false });
  const tiles = L.tileLayer(TILES, { subdomains: "1234", maxZoom: 19, maxNativeZoom: 18 });
  tiles.once("load", () => els.loading.remove());
  tiles.addTo(map);
  layer = L.layerGroup().addTo(map);
  youLayer = L.layerGroup().addTo(map);
  map.on("click", hideCard);
}

function setMode(m) {
  if (m === mode) return;
  mode = m;
  drawnKey = "";
  hideCard();
  draw();
}

function movePill() {
  const b = els.seg.querySelector(`button[data-m="${mode}"]`);
  els.seg.querySelectorAll("button").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
  const to = `translateX(${b.offsetLeft - 4}px)`, from = els.pill.style.transform || to;
  els.pill.style.width = b.offsetWidth + "px";
  els.pill.style.transform = to;
  if (from !== to) play(els.pill, [{ transform: from }, { transform: to }], { response: 0.35 });
}

// ---------- data ----------
const plan = () => ctx.state.plan || {};
const myGroup = () => T.groupOf(plan(), ctx.me);
const votes = (id) => ctx.state.votes.filter((v) => v.optionId === id).length;
function tripDays() {
  const evs = T.timeline(plan(), ctx.state, myGroup()).filter((e) => e.geo && !e.range);
  const by = new Map();
  for (const e of evs) { const k = e.day.date; if (!by.has(k)) by.set(k, []); by.get(k).push(e); }
  return by;
}
const hotelStop = (x, when) => ({ key: "hotel-" + when + x.name, title: x.name, zh: x.zh || "", geo: x.at, hotel: true, start: null });

// ---------- drawing ----------
function draw() {
  if (!map || !els) return;
  movePill();
  const key = JSON.stringify([mode, area, day, ctx.me?.id, plan().geo, plan().days, plan().hotels, ctx.state.votes.length]);
  if (key === drawnKey) return;
  drawnKey = key;
  layer.clearLayers();
  segs = []; legGeo = []; activeLeg = -1;
  els.wrap.classList.toggle("has-rail", mode === "trip");
  if (mode === "all") drawAll(); else drawTrip();
  drawHotels();
}

const L_icon = (cls, html, size = 34) => L.divIcon({ className: "pin-wrap", html: `<span class="pin ${cls}">${html}</span>`, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });

// Hotels sit on the map in both views, a bed on a dark tile.
function drawHotels() {
  for (const x of T.hotels(plan(), myGroup())) {
    const m = L.marker(x.at, { icon: L_icon("hotel", svg("bed"), 32), zIndexOffset: 500, title: x.name }).addTo(layer);
    m.on("click", (e) => { L.DomEvent.stopPropagation(e); showHotel(x); });
  }
}

// Only what's in your itinerary (voted places and extra spots), coloured by the city of that day.
function itineraryStops() {
  const g = myGroup(), geo = plan().geo || {}, seen = new Set(), out = [];
  for (const d of (plan().days || []).slice().sort((x, y) => x.date.localeCompare(y.date))) {
    if (!T.forGroup(d.groups, g)) continue;
    const tone = toneOf(d.city) === "cd" ? "cd" : "cq";
    for (const it of d.items || []) {
      if (!T.forGroup(it.groups, g)) continue;
      if (it.kind === "place" && it.optionId) {
        const o = ctx.state.options.find((x) => x.id === it.optionId), at = it.at || geo[it.optionId];
        if (!o || !at || seen.has(o.id)) continue;
        seen.add(o.id);
        out.push({ o, geo: at, tone, d });
      } else if (it.kind === "spot" && it.at) {
        const k = it.zh || it.text;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ spot: it, geo: it.at, tone, d });
      }
    }
  }
  return out;
}

function drawAll() {
  els.rail.hidden = true;
  const all = itineraryStops();
  const shown = area ? all.filter((s) => s.tone === area) : all;
  lastPts = shown.map((s) => s.geo).concat(T.hotels(plan(), myGroup()).map((x) => x.at));
  shown.forEach((s, i) => {
    const img = s.o?.image;
    const title = s.o ? s.o.zh || s.o.name : s.spot.zh || s.spot.text;
    const m = L.marker(s.geo, { icon: L_icon(`${s.tone} ${img ? "has-img" : "plain"}`, img ? `<img src="${ctx.imgSrc(img)}" alt="">` : ""), riseOnHover: true, title }).addTo(layer);
    m.on("click", (e) => { L.DomEvent.stopPropagation(e); s.o ? showPlace({ o: s.o, geo: s.geo }) : showSpot(s.spot, s.d); });
    pop(m, i);
  });
  const chip = (id, label, n) => h("button.chip.pressable", { "aria-pressed": String(area === id), onclick: () => { area = id; drawnKey = ""; hideCard(); draw(); } }, h("span", label), h("small", n));
  els.top.replaceChildren(h("div.chips", chip(null, "All", all.length),
    chip("cq", "重庆 Chongqing", all.filter((s) => s.tone === "cq").length),
    chip("cd", "成都 Chengdu", all.filter((s) => s.tone === "cd").length)));
  const key = (cls, label) => h("span.key-item", h("i", { class: `k ${cls}` }), label);
  els.below.replaceChildren(h("div.map-key", key("cq", "Chongqing"), key("cd", "Chengdu"),
    T.hotels(plan(), myGroup()).length ? key("hotel", "Hotel") : null));
  // Two cities 270 km apart: start on the city you're in (or Chongqing), leaving out far day trips.
  fitTo(core(all.filter((s) => s.tone === (area || cityNow())).map((s) => s.geo)));
}

function cityNow() {
  const st = T.status(plan(), ctx.state, myGroup());
  const e = st.now || st.next;
  return T.cityFor(e?.day.city || "") === "Chengdu" ? "cd" : "cq";
}

function drawTrip() {
  const days = tripDays();
  const dates = [...days.keys()];
  if (!dates.length) { els.rail.hidden = true; els.below.replaceChildren(h("p.plan-empty", "No pinned stops yet")); return; }
  const today = T.dateOf(T.now());
  if (!day || !days.has(day)) day = days.has(today) ? today : dates.find((d) => d >= today) || dates[0];
  const g = myGroup();
  const st = T.status(plan(), ctx.state, g);
  const live = st.phase === "during" && day === today;
  const t = T.now();

  // The day runs hotel → stops → hotel when the hotels are known.
  const evs = days.get(day);
  const hm = T.hotelMorning(plan(), g, day), hn = T.hotelNight(plan(), g, day);
  const stops = [...(hm ? [hotelStop(hm, "am")] : []), ...evs, ...(hn ? [hotelStop(hn, "pm")] : [])];
  lastPts = stops.map((e) => e.geo);

  const out = (e) => e.exit || e.geo;
  for (const e of stops) if (e.exit) L.polyline([e.geo, e.exit], { className: "ride-line", weight: 3, interactive: false }).addTo(layer); // the cable car itself
  for (let i = 1; i < stops.length; i++) {
    const seg = L.polyline([out(stops[i - 1]), stops[i].geo], { className: "route-line", weight: 4, dashArray: "1 9", lineCap: "round" }).addTo(layer);
    segs.push(seg);
    legGeo.push([out(stops[i - 1]), stops[i].geo]);
  }
  let n = 0;
  stops.forEach((e, i) => {
    if (e.hotel) return;
    n++;
    const state = live ? (st.now?.key === e.key ? "now" : st.next?.key === e.key ? "next" : e.end <= t ? "past" : "") : "";
    const m = L.marker(e.geo, { icon: L_icon(`num ${state}`, String(n), 30), zIndexOffset: state === "now" ? 1000 : 0, title: e.zh || e.title }).addTo(layer);
    const num = n;
    m.on("click", (ev) => { L.DomEvent.stopPropagation(ev); showStop(e, num); });
    pop(m, i);
  });

  // Day chips above the map
  const label = (d) => (d === today ? "Today" : T.fmt(T.at(d, "12:00"), { weekday: "short", day: "numeric", month: "short" }));
  const chips = h("div.chips", dates.map((d) => h("button.chip.pressable", { "aria-pressed": String(d === day), onclick: () => { day = d; drawnKey = ""; hideCard(); draw(); } }, h("span", label(d)), h("small", days.get(d).length))));
  const d0 = evs[0].day;
  els.top.replaceChildren(chips);
  els.below.replaceChildren(h("p.trip-day-line", h("span.city-chip", { class: `city-chip ${toneOf(d0.city)}` }, d0.city), h("span", d0.title)));
  requestAnimationFrame(() => { const c = chips.querySelector('[aria-pressed="true"]'); if (c) chips.scrollLeft = c.offsetLeft - (chips.clientWidth - c.offsetWidth) / 2; });

  // Leg cards on top of the map: swipe through them, the map follows.
  const cards = [];
  const numOf = (e) => (e.hotel ? "H" : String(evs.indexOf(e) + 1));
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1], b = stops[i];
    cards.push(legCard(`${numOf(a)} → ${numOf(b)}`, a, b, T.legs(out(a), b.geo), live && st.next?.key === b.key, i - 1));
  }
  if (you && live && st.next?.geo) cards.unshift(legCard("You", { title: "You", zh: "", geo: you }, st.next, T.legs(you, st.next.geo), true, -1));
  els.rail.replaceChildren(...(cards.length ? cards : [h("div.leg-card.empty", "One pinned stop this day")]));
  els.rail.hidden = false;
  els.rail.scrollLeft = 0;
  const hot = cards.findIndex((c) => c.classList.contains("hot"));
  requestAnimationFrame(() => {
    if (hot > 0) els.rail.scrollLeft = cards[hot].offsetLeft - 12;
    if (cards.length) setActive((hot >= 0 ? cards[hot] : cards[0]).dataset.leg, false);
  });
  els.rail.onscroll = () => {
    clearTimeout(els.rail._t);
    els.rail._t = setTimeout(() => {
      const mid = els.rail.scrollLeft + els.rail.clientWidth / 2;
      const c = cards.reduce((best, c) => (Math.abs(c.offsetLeft + c.offsetWidth / 2 - mid) < Math.abs(best.offsetLeft + best.offsetWidth / 2 - mid) ? c : best), cards[0]);
      if (c) setActive(c.dataset.leg, true);
    }, 90);
  };
  fitTo(lastPts);
}

const toneOf = (c = "") => (/chengdu/i.test(c) && !/chongqing/i.test(c) ? "cd" : /chongqing/i.test(c) ? "cq" : "camp");

function legCard(n, from, to, leg, hot, idx) {
  const fn = T.names(from), tn = T.names(to);
  const when = to.start ? `${from.start ? T.clock(from.start) + " → " : ""}${T.clock(to.start)}` : "Back to the hotel";
  return h("div.leg-card", { class: `leg-card ${hot ? "hot" : ""}`, "data-leg": idx },
    h("div.leg-top", h("span.leg-n", n), h("span.leg-when", when)),
    h("p.leg-route", h("b", fn.main), icon("arrow"), h("b", tn.main)),
    transport(leg, to));
}

// Highlight one leg on the map and bring it into view.
function setActive(idx, move) {
  idx = Number(idx);
  if (idx === activeLeg) return;
  activeLeg = idx;
  segs.forEach((s, i) => s.getElement()?.classList.toggle("hot", i === idx));
  if (move && legGeo[idx]) fitTo(legGeo[idx]);
}

// ---------- pin cards (on top of the map) ----------
function showPlace({ o, geo }) {
  const n = votes(o.id);
  card(o.image ? h("img.mc-img", { src: ctx.imgSrc(o.image), alt: "" }) : h("span.mc-img.blank"),
    h("div.mc-body",
      h("b", o.zh || o.name),
      h("small", [o.zh ? o.name : "", n ? `${n} want${n === 1 ? "s" : ""} to go` : "No votes yet", o.priceCny ? yuan(o.priceCny) : "", you ? `${T.dist(T.km(you, geo))} away` : ""].filter(Boolean).join(" · ")),
      h("div.mc-actions",
        h("a.mc-btn", { href: T.amapUrl(geo, o.zh || o.name, "bus"), target: "_blank", rel: "noopener" }, "Directions"),
        h("button.mc-btn.ghost", { onclick: () => ctx.openPlace(o.id) }, "See in Vote"))));
  map.panInside(geo, { paddingBottomRight: [20, 170], paddingTopLeft: [20, 20] });
}

function showStop(e, num) {
  const nm = T.names(e);
  card(e.opt?.image ? h("img.mc-img", { src: ctx.imgSrc(e.opt.image), alt: "" }) : h("span.mc-img.num", String(num)),
    h("div.mc-body",
      h("b", nm.main),
      h("small", [nm.sub, `${T.fmt(e.start, { weekday: "short", day: "numeric", month: "short" })} ${T.clock(e.start)}`, you ? `${T.dist(T.km(you, e.geo))} away` : ""].filter(Boolean).join(" · ")),
      e.item?.note ? h("small", T.ampm(e.item.note)) : null,
      h("div.mc-actions",
        h("a.mc-btn", { href: T.amapUrl(e.geo, nm.main, "bus"), target: "_blank", rel: "noopener" }, "Directions"),
        e.opt ? h("button.mc-btn.ghost", { onclick: () => ctx.openPlace(e.opt.id) }, "See in Vote") : h("a.mc-btn.ghost", { href: T.amapPin(e.geo, nm.main), target: "_blank", rel: "noopener" }, "Open in Amap"))));
  map.panInside(e.geo, { paddingBottomRight: [20, 170], paddingTopLeft: [20, 20] });
}

function showSpot(it, d) {
  const name = it.zh || it.text;
  card(h("span.mc-img.blank"),
    h("div.mc-body",
      h("b", name),
      h("small", [it.zh ? T.ampm(it.text) : "", `${T.fmt(T.at(d.date, "12:00"), { weekday: "short", day: "numeric", month: "short" })} ${T.ampm(it.time)}`, you ? `${T.dist(T.km(you, it.at))} away` : ""].filter(Boolean).join(" · ")),
      it.note ? h("small", T.ampm(it.note)) : null,
      h("div.mc-actions",
        h("a.mc-btn", { href: T.amapUrl(it.at, name, "bus"), target: "_blank", rel: "noopener" }, "Directions"),
        h("button.mc-btn.ghost", { onclick: () => { mode = "trip"; day = d.date; drawnKey = ""; hideCard(); draw(); } }, "That day's route"))));
  map.panInside(it.at, { paddingBottomRight: [20, 170], paddingTopLeft: [20, 20] });
}

function showHotel(x) {
  card(h("span.mc-img.hotel", icon("bed")),
    h("div.mc-body",
      h("b", x.zh || x.name),
      h("small", [x.zh ? x.name : "", x.from && x.to ? `${T.fmt(T.at(x.from, "12:00"), { day: "numeric", month: "short" })} – ${T.fmt(T.at(x.to, "12:00"), { day: "numeric", month: "short" })}` : "", you ? `${T.dist(T.km(you, x.at))} away` : ""].filter(Boolean).join(" · ")),
      h("div.mc-actions",
        h("a.mc-btn", { href: T.amapUrl(x.at, x.zh || x.name, "car"), target: "_blank", rel: "noopener" }, "Take me back"),
        h("a.mc-btn.ghost", { href: T.amapPin(x.at, x.zh || x.name), target: "_blank", rel: "noopener" }, "Open in Amap"))));
}

function card(...kids) {
  const c = els.card;
  const wasHidden = c.hidden;
  c.replaceChildren(h("button.mc-close", { "aria-label": "Close", onclick: hideCard, html: '<svg viewBox="0 0 20 20"><path d="M6 6l8 8M14 6l-8 8"/></svg>' }), ...kids);
  c.hidden = false;
  els.rail.classList.add("under");
  if (wasHidden) play(c, [{ transform: "translateY(12px)", opacity: 0 }, { transform: "none", opacity: 1 }], { response: 0.35 });
}
function hideCard() {
  const c = els?.card;
  if (!c || c.hidden) return;
  els.rail.classList.remove("under");
  const a = c.animate([{ opacity: 1 }, { opacity: 0, transform: "translateY(8px)" }], { duration: reduceMotion.matches ? 1 : 180, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
  a.onfinish = () => (c.hidden = true);
}

// ---------- helpers ----------
function pop(marker, i) {
  if (reduceMotion.matches) return;
  requestAnimationFrame(() => {
    const el = marker.getElement()?.firstElementChild;
    el?.animate([{ transform: "translateY(8px)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 360, delay: Math.min(i, 6) * 50, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "backwards" });
  });
}

// The city cluster, leaving out far-off day trips (Wulong is 130 km out); "Fit all" shows everything.
function core(pts) {
  if (pts.length < 3) return pts;
  const mid = (i) => pts.map((p) => p[i]).sort((a, b) => a - b)[pts.length >> 1];
  const c = [mid(0), mid(1)];
  const near = pts.filter((p) => T.km(c, p) < 35);
  return near.length >= 2 ? near : pts;
}

function fitTo(pts) {
  if (!pts?.length) return;
  const bottom = mode === "trip" ? RAIL_H + 16 : 28;
  if (pts.length === 1) map.setView(pts[0], 15, { animate: !reduceMotion.matches });
  else map.fitBounds(L.latLngBounds(pts), { paddingTopLeft: [28, 28], paddingBottomRight: [64, bottom], maxZoom: 15.5, animate: !reduceMotion.matches });
}

function locate() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition((p) => {
    you = T.wgs2gcj(p.coords.latitude, p.coords.longitude);
    youLayer.clearLayers();
    L.marker(you, { icon: L.divIcon({ className: "pin-wrap", html: '<span class="you-dot"></span>', iconSize: [20, 20], iconAnchor: [10, 10] }), zIndexOffset: 2000, interactive: false }).addTo(youLayer);
    if (mode === "trip") { drawnKey = ""; draw(); }
    map.flyTo(you, Math.max(map.getZoom(), 14), { duration: reduceMotion.matches ? 0 : 0.8 });
  }, () => {}, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
}
