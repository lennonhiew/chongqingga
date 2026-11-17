// The Map tab: every place on an Amap base map, or the trip day by day with travel times between stops.
// Leaflet loads only the first time the tab opens.
import { h, play, reduceMotion, yuan } from "./ui.js?v=12";
import * as T from "./trip.js?v=12";

const TILES = "https://wprd0{s}.is.autonavi.com/appmaptile?x={x}&y={y}&z={z}&lang=en&size=1&scl=1&style=7";
const AREAS = [
  { id: "cq", label: "Chongqing", poll: "p1", tone: "cq" },
  { id: "cd", label: "Chengdu", poll: "pe", tone: "cd" },
  { id: "po", label: "Day trips", poll: "po", tone: "trip" },
];

let L = null, map = null, layer = null, youLayer = null, loading = null;
let ctx = null, els = null;
let mode = "all", area = null, day = null, you = null, pending = null, drawnKey = "", lastPts = [];

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
  const segBtn = (m, label) => h("button.pressable", { role: "tab", "data-m": m, onclick: () => setMode(m) }, label);
  els = {
    seg: h("div.mseg", { role: "tablist", "aria-label": "Map view" }, pill, segBtn("all", "All places"), segBtn("trip", "Trip")),
    pill,
    box: h("div.map-el"),
    card: h("div.map-card.material", { hidden: true }),
    loading: h("div.map-loading", "Loading map…"),
    below: h("div.map-below"),
  };
  const fab = (title, svg, onclick) => h("button.map-fab.material.pressable", { title, "aria-label": title, onclick, html: `<svg viewBox="0 0 24 24">${svg}</svg>` });
  root.replaceChildren(
    h("div.map-head", h("h2.sec-title", "Map"), els.seg),
    h("div.map-wrap", els.box, els.loading,
      h("div.map-fabs",
        fab("Show me", '<path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2" class="fill"/>', locate),
        fab("Fit all", '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>', () => fitTo(lastPts))),
      els.card),
    els.below,
    h("p.foot", "Map © AutoNavi (Amap). Times are rough guesses; tap a time to open Amap for live directions."));
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
  map = L.map(els.box, { zoomControl: false, center: [29.56, 106.57], zoom: 13, zoomSnap: 0.25, tap: true, attributionControl: false });
  const tiles = L.tileLayer(TILES, { subdomains: "1234", maxZoom: 19, maxNativeZoom: 18, detectRetina: false });
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
  const to = `translateX(${b.offsetLeft - 3}px)`, from = els.pill.style.transform || to;
  els.pill.style.width = b.offsetWidth + "px";
  els.pill.style.transform = to;
  if (from !== to) play(els.pill, [{ transform: from }, { transform: to }], { damping: 0.82, response: 0.38 });
}

// ---------- data ----------
const plan = () => ctx.state.plan || {};
const myGroup = () => T.groupOf(plan(), ctx.me);
function places() {
  const geo = plan().geo || {};
  const fromItems = {};
  (plan().days || []).forEach((d) => (d.items || []).forEach((it) => { if (it.optionId && it.at) fromItems[it.optionId] = it.at; }));
  return ctx.state.options.map((o) => ({ o, geo: fromItems[o.id] || geo[o.id] })).filter((p) => p.geo);
}
const votes = (id) => ctx.state.votes.filter((v) => v.optionId === id).length;
const iPicked = (id) => !!ctx.me && ctx.state.votes.some((v) => v.optionId === id && v.memberId === ctx.me.id);
function tripDays() {
  const evs = T.timeline(plan(), ctx.state, myGroup()).filter((e) => e.geo && !e.range);
  const by = new Map();
  for (const e of evs) { const k = e.day.date; if (!by.has(k)) by.set(k, []); by.get(k).push(e); }
  return by;
}

// ---------- drawing ----------
function draw() {
  if (!map || !els) return;
  movePill();
  const key = JSON.stringify([mode, area, day, ctx.me?.id, plan().geo, plan().days, ctx.state.votes.length]);
  if (key === drawnKey) return;
  const firstDraw = !drawnKey;
  drawnKey = key;
  layer.clearLayers();
  if (mode === "all") drawAll(firstDraw); else drawTrip(firstDraw);
}

const pinIcon = (cls, inner, size = 34) => L.divIcon({ className: "pin-wrap", html: `<span class="pin ${cls}">${inner}</span>`, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });

function drawAll() {
  const ps = places();
  const tone = (o) => AREAS.find((a) => a.poll === o.pollId)?.tone || "trip";
  const shown = area ? ps.filter((p) => p.o.pollId === AREAS.find((a) => a.id === area).poll) : ps;
  lastPts = shown.map((p) => p.geo);
  shown.forEach((p, i) => {
    const m = L.marker(p.geo, { icon: pinIcon(`${tone(p.o)} ${iPicked(p.o.id) ? "picked" : ""}`, p.o.emoji || "📍"), riseOnHover: true, keyboard: true, title: p.o.name }).addTo(layer);
    m.on("click", (e) => { L.DomEvent.stopPropagation(e); showPlace(p); });
    pop(m, i);
  });
  // area chips
  const chip = (id, label, n) => h("button.chip.pressable", { "aria-pressed": String(area === id), onclick: () => { area = id; drawnKey = ""; hideCard(); draw(); } }, label, h("small", n));
  els.below.replaceChildren(
    h("div.chips", chip(null, "Everywhere", ps.length), AREAS.map((a) => chip(a.id, a.label, ps.filter((p) => p.o.pollId === a.poll).length))),
    h("p.map-key", h("i.k.cq"), "Chongqing", h("i.k.cd"), "Chengdu", h("i.k.trip"), "Day trip", ctx.me ? [h("i.k.picked"), "You picked"] : null));
  // Everywhere spans two cities 270 km apart: start on the city you're in (or Chongqing).
  const startArea = area || cityNow();
  fitTo(core((startArea ? ps.filter((p) => p.o.pollId === AREAS.find((a) => a.id === startArea).poll) : shown).map((p) => p.geo)));
}

function cityNow() {
  const st = T.status(plan(), ctx.state, myGroup());
  const e = st.now || st.next;
  const c = T.cityFor(e?.day.city || "");
  return c === "Chengdu" ? "cd" : "cq";
}

function drawTrip() {
  const days = tripDays();
  const dates = [...days.keys()];
  if (!dates.length) { els.below.replaceChildren(h("p.plan-empty", "No pinned stops yet.")); return; }
  const today = T.dateOf(T.now());
  if (!day || !days.has(day)) day = days.has(today) ? today : dates.find((d) => d >= today) || dates[0];
  const evs = days.get(day);
  lastPts = evs.map((e) => e.geo);
  const st = T.status(plan(), ctx.state, myGroup());
  const live = st.phase === "during" && day === today;
  const t = T.now();

  // route line, then numbered pins
  const line = L.polyline(evs.map((e) => e.geo), { className: "route-line", weight: 4, opacity: 0.9, dashArray: "1 9", lineCap: "round" }).addTo(layer);
  evs.forEach((e, i) => {
    const state = live ? (st.now?.key === e.key ? "now" : st.next?.key === e.key ? "next" : e.end <= t ? "past" : "") : "";
    const m = L.marker(e.geo, { icon: pinIcon(`num ${state}`, String(i + 1), 30), zIndexOffset: state === "now" ? 1000 : 0, title: e.title }).addTo(layer);
    m.on("click", (ev) => { L.DomEvent.stopPropagation(ev); showStop(e, i); });
    pop(m, i);
  });
  if (!reduceMotion.matches) line.getElement()?.animate([{ strokeDashoffset: 60, opacity: 0 }, { strokeDashoffset: 0, opacity: 0.9 }], { duration: 700, easing: "ease-out" });

  // day chips + legs
  const label = (d) => (d === today ? "Today" : T.fmt(T.at(d, "12:00"), { weekday: "short", day: "numeric", month: "short" }));
  const chips = h("div.chips.days-chips", dates.map((d) => h("button.chip.pressable", { "aria-pressed": String(d === day), onclick: () => { day = d; drawnKey = ""; hideCard(); draw(); } }, label(d), h("small", days.get(d).length))));
  const legs = [];
  if (you && live && st.next?.geo) legs.push(legRow("📍", "You", st.next, T.legs(you, st.next.geo), true, null));
  for (let i = 1; i < evs.length; i++) legs.push(legRow(`${i}→${i + 1}`, evs[i - 1].title, evs[i], T.legs(evs[i - 1].geo, evs[i].geo), live && st.next?.key === evs[i].key, evs[i - 1]));
  const d0 = evs[0].day;
  els.below.replaceChildren(chips,
    h("div.trip-day-head", h("span.city-chip", { class: `city-chip ${toneOf(d0.city)}` }, d0.city), h("b", d0.title)),
    legs.length ? h("ol.legs", legs) : h("p.plan-empty", "Just one pinned stop this day."));
  requestAnimationFrame(() => chips.querySelector('[aria-pressed="true"]')?.scrollIntoView({ inline: "center", block: "nearest", behavior: "auto" }));
  fitTo(evs.map((e) => e.geo));
}

const toneOf = (c = "") => (/chengdu/i.test(c) && !/chongqing/i.test(c) ? "cd" : /chongqing/i.test(c) ? "cq" : "camp");

function legRow(n, fromName, to, leg, hot, from) {
  const name = to.opt?.zh || to.title;
  const a = (mode, emoji, m) => h("a.mode", { class: `mode ${m == null ? "off" : ""}`, href: T.amapUrl(to.geo, name, mode), target: "_blank", rel: "noopener" }, emoji, " ", T.mins(m));
  return h("li.leg", { class: `leg ${hot ? "hot" : ""}` },
    h("span.leg-n", n),
    h("div.leg-body",
      h("b", fromName, " → ", to.title),
      h("small", from ? `${T.hhmm(from.start)} → ${T.hhmm(to.start)} · ` : `Next at ${T.hhmm(to.start)} · `, T.dist(leg.km)),
      h("div.nc-modes", a("walk", "🚶", leg.walk), a("bus", "🚇", leg.metro), a("car", "🚕", leg.car))));
}

// ---------- pin cards ----------
function showPlace({ o, geo }) {
  const n = votes(o.id);
  card(o.image ? h("img.mc-img", { src: ctx.imgSrc(o.image), alt: "" }) : h("span.mc-emoji", o.emoji || "📍"),
    h("div.mc-body",
      h("b", o.name, o.zh ? h("span.opt-zh", o.zh) : null),
      h("small", n ? `${n} want${n === 1 ? "s" : ""} to go` : "No votes yet", o.priceCny ? ` · ${yuan(o.priceCny)}` : "", you ? ` · ${T.dist(T.km(you, geo))} away` : ""),
      h("div.mc-actions",
        h("a.mc-btn", { href: T.amapUrl(geo, o.zh || o.name, "bus"), target: "_blank", rel: "noopener" }, "Directions"),
        h("button.mc-btn.ghost", { onclick: () => ctx.openPlace(o.id) }, "See in Vote"))));
  map.panInside(geo, { paddingBottomRight: [20, 160], paddingTopLeft: [20, 20] });
}

function showStop(e, i) {
  card(e.opt?.image ? h("img.mc-img", { src: ctx.imgSrc(e.opt.image), alt: "" }) : h("span.mc-emoji.num", String(i + 1)),
    h("div.mc-body",
      h("b", e.title),
      h("small", `${T.fmt(e.start, { weekday: "short", day: "numeric", month: "short" })}, ${T.hhmm(e.start)}`, you ? ` · ${T.dist(T.km(you, e.geo))} away` : ""),
      h("div.mc-actions",
        h("a.mc-btn", { href: T.amapUrl(e.geo, e.opt?.zh || e.title, "bus"), target: "_blank", rel: "noopener" }, "Directions"),
        e.opt ? h("button.mc-btn.ghost", { onclick: () => ctx.openPlace(e.opt.id) }, "See in Vote") : h("a.mc-btn.ghost", { href: T.amapPin(e.geo, e.title), target: "_blank", rel: "noopener" }, "Open in Amap"))));
  map.panInside(e.geo, { paddingBottomRight: [20, 160], paddingTopLeft: [20, 20] });
}

function card(...kids) {
  const c = els.card;
  const wasHidden = c.hidden;
  c.replaceChildren(h("button.mc-close", { "aria-label": "Close", onclick: hideCard, html: '<svg viewBox="0 0 20 20"><path d="M6 6l8 8M14 6l-8 8"/></svg>' }), ...kids);
  c.hidden = false;
  play(c, wasHidden ? [{ transform: "translateY(110%)", opacity: 0 }, { transform: "none", opacity: 1 }] : [{ transform: "scale(.97)" }, { transform: "none" }], { damping: 0.86, response: 0.45 });
}
function hideCard() {
  const c = els?.card;
  if (!c || c.hidden) return;
  const a = c.animate([{ transform: "none", opacity: 1 }, { transform: "translateY(110%)", opacity: 0 }], { duration: reduceMotion.matches ? 1 : 220, easing: "ease-in" });
  a.onfinish = () => (c.hidden = true);
}

// ---------- helpers ----------
function pop(marker, i) {
  if (reduceMotion.matches) return;
  requestAnimationFrame(() => {
    const el = marker.getElement()?.firstElementChild;
    if (el) play(el, [{ transform: "scale(.2) translateY(12px)", opacity: 0 }, { transform: "none", opacity: 1 }], { damping: 0.6, response: 0.45, delay: Math.min(i, 14) * 35 });
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
  if (!pts.length) return;
  if (pts.length === 1) map.setView(pts[0], 15, { animate: !reduceMotion.matches });
  else map.fitBounds(L.latLngBounds(pts), { paddingTopLeft: [30, 30], paddingBottomRight: [64, 30], maxZoom: 15.5, animate: !reduceMotion.matches });
}

function locate() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition((p) => {
    you = T.wgs2gcj(p.coords.latitude, p.coords.longitude);
    youLayer.clearLayers();
    L.marker(you, { icon: L.divIcon({ className: "pin-wrap", html: '<span class="you-dot"></span>', iconSize: [22, 22], iconAnchor: [11, 11] }), zIndexOffset: 2000, interactive: false }).addTo(youLayer);
    map.flyTo(you, Math.max(map.getZoom(), 14), { duration: reduceMotion.matches ? 0 : 0.8 });
    if (mode === "trip") { drawnKey = ""; const z = map.getZoom(), c = map.getCenter(); draw(); map.setView(c, z); }
  }, () => {}, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
}
