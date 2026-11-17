// The live card at the top of Itinerary: a clock, a countdown to your flight,
// and during the trip "Now" and "Next" with travel times. Also marks the matching rows in the list.
import { h, play, reduceMotion } from "./ui.js?v=12";
import * as T from "./trip.js?v=12";

let timer = 0;
let cur = null; // { host, root, ctx, shape, refs }

export function mountClock(host, root, ctx) {
  clearInterval(timer);
  cur = { host, root, ctx, shape: "", refs: {} };
  tick();
  // Tick on the second boundary so the seconds change together with the phone's own clock.
  setTimeout(() => { tick(); timer = setInterval(tick, 1000); }, 1000 - (T.now() % 1000));
  T.weather().then(() => { if (cur?.host === host) { cur.shape = ""; tick(); } });
}

function tick() {
  if (!cur || !cur.host.isConnected) return;
  const { ctx } = cur;
  const plan = ctx.state.plan;
  const t = T.now();
  const me = T.groupOf(plan, ctx.me);
  const groups = me ? [me] : plan.groups || [];
  const sts = groups.map((g) => ({ g, st: T.status(plan, ctx.state, g, t) }));
  // Not signed in: follow whichever group is furthest along.
  const main = sts.find((x) => x.st.phase === "during") || sts.slice().sort((a, b) => (a.st.start || 0) - (b.st.start || 0))[0];
  if (!main) return;
  const st = main.st;
  const shape = [st.phase, st.now?.key, st.next?.key, st.idle, st.dayN, me?.id, sts.map((x) => x.st.phase).join()].join("|");
  if (shape !== cur.shape) {
    const first = !cur.shape;
    cur.shape = shape;
    cur.refs = {};
    const card = build(st, main.g, sts, me, t);
    cur.host.replaceChildren(card);
    if (!first) play(card, [{ opacity: 0.4, transform: "scale(.985)" }, { opacity: 1, transform: "none" }], { damping: 0.8, response: 0.45 });
    mark(st, t);
  }
  update(st, sts, t);
}

// ---------- building the card ----------
function build(st, g, sts, me, t) {
  const R = cur.refs;
  const plan = cur.ctx.state.plan;
  R.clock = h("span.nc-clock");
  const top = h("div.nc-top", h("span.live", h("i")), R.clock, h("span.nc-tz", "China / KL time"));
  const actions = h("div.nc-actions",
    h("button.nc-btn.pressable", { onclick: () => saveCalendar(g) }, icon("cal"), "Add to calendar"),
    h("button.nc-btn.pressable", { onclick: () => cur.ctx.openMap({ mode: "trip", date: st.phase === "during" ? T.dateOf(t) : null }) }, icon("map"), "Map"));

  if (st.phase === "before") {
    R.cds = [];
    const big = countdown(R);
    const others = sts.filter((x) => x.g !== g);
    const firstTrip = st.first;
    return h("section.now-card.before",
      top,
      h("p.nc-kicker", me ? "You fly in" : `${g.name} fly in`),
      big,
      h("p.nc-sub", firstTrip.kind === "train" ? "🚄 " : "✈️ ", `${firstTrip.fromCity || firstTrip.from} → ${firstTrip.toCity || firstTrip.to} · `,
        T.fmt(st.start, { weekday: "short", day: "numeric", month: "short" }), `, ${firstTrip.dep}`),
      others.length ? h("ul.nc-others", others.map((x) => {
        const el = h("b.nc-mini");
        R.cds.push({ el, st: x.st });
        return h("li", h("span", x.g.name), x.st.phase === "during" ? h("b.nc-mini.live-txt", "On the trip now") : el);
      })) : null,
      me ? otherGroupLine(plan, me, t) : null,
      h("p.nc-hint", "🧥 ", T.CLIMATE),
      actions);
  }

  if (st.phase === "after") {
    const places = st.events.filter((e) => e.kind === "place").length;
    return h("section.now-card.after", top,
      h("p.nc-kicker", "Welcome home"),
      h("h2.nc-title", `${st.days} days, ${places} stops.`),
      h("p.nc-sub", "That was the trip. Hope the hotpot was worth it."));
  }

  // During the trip
  const city = T.cityFor(st.now?.day.city || st.next?.day.city || st.prev?.day.city || "");
  R.wx = h("span.nc-wx");
  T.weather().then((data) => { const c = data?.[city]?.now; if (c) R.wx.textContent = `${c.icon} ${c.t}°`; });
  const day = h("div.nc-day", h("span", `Day ${st.dayN}`, h("small", ` of ${st.days}`)), R.wx);
  const nowE = st.now;
  R.bar = h("i");
  const nowBlock = h("div.nc-block.now",
    h("p.nc-kicker", h("span.pulse"), "Now"),
    nowE ? h("h2.nc-title", nowE.title) : h("h2.nc-title.idle", st.idle),
    nowE ? h("p.nc-sub", `${nowE.day.city} · since ${T.hhmm(nowE.start)}`) : st.prev ? h("p.nc-sub", `Last: ${st.prev.title}`) : null,
    nowE ? h("div.nc-progress", R.bar) : null);
  let nextBlock = null;
  if (st.next) {
    const n = st.next;
    R.inTxt = h("span");
    const from = (nowE || st.prev)?.geo;
    const leg = from && n.geo ? T.legs(from, n.geo) : null;
    nextBlock = h("div.nc-block.next",
      h("p.nc-kicker", "Next · ", T.hhmm(n.start), " · ", R.inTxt),
      h("h3.nc-next", n.title, n.day.date !== T.dateOf(t) ? h("small", " " + T.fmt(n.start, { weekday: "short", day: "numeric", month: "short" })) : null),
      leg && leg.km > 0.05 ? modes(leg, n) : n.geo ? h("div.nc-modes", h("a.mode", { href: T.amapUrl(n.geo, n.opt?.zh || n.title, "car"), target: "_blank", rel: "noopener" }, "Directions in Amap")) : null);
  }
  return h("section.now-card.during", top, day, nowBlock, nextBlock,
    h("div.nc-actions",
      h("button.nc-btn.pressable", { onclick: jumpToNow }, icon("now"), "Jump to now"),
      h("button.nc-btn.pressable", { onclick: () => cur.ctx.openMap({ mode: "trip", date: T.dateOf(t) }) }, icon("map"), "Today's map")));
}

function modes(leg, n) {
  const name = n.opt?.zh || n.title;
  const a = (mode, emoji, m) => h("a.mode", { class: `mode ${m == null ? "off" : ""}`, href: T.amapUrl(n.geo, name, mode), target: "_blank", rel: "noopener", title: "Open in Amap" }, emoji, " ", T.mins(m));
  return h("div.nc-modes", h("span.nc-km", T.dist(leg.km)), a("walk", "🚶", leg.walk), a("bus", "🚇", leg.metro), a("car", "🚕", leg.car));
}

function countdown(R) {
  const cell = (k, label) => { R[k] = h("b.cd-n"); return h("span.cd-cell", R[k], h("small", label)); };
  return h("div.cd", cell("d", "days"), cell("hr", "hrs"), cell("mn", "min"), cell("sc", "sec"));
}

// While the other group is already away, show where they are.
function otherGroupLine(plan, me, t) {
  const other = (plan.groups || []).find((g) => g.id !== me.id);
  if (!other) return null;
  const s = T.status(plan, cur.ctx.state, other, t);
  if (s.phase !== "during") return null;
  return h("p.nc-meanwhile", `Meanwhile, ${other.name} are on day ${s.dayN}: `, h("b", s.now?.title || s.idle));
}

// ---------- every second ----------
function update(st, sts, t) {
  const R = cur.refs;
  if (R.clock) R.clock.textContent = T.fmt(t, { weekday: "short", day: "numeric", month: "short" }) + " · " + T.fmt(t, { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  if (st.phase === "before" && R.d) {
    const s = Math.max(0, Math.floor(st.left / 1000));
    roll(R.d, String(Math.floor(s / 86400)));
    roll(R.hr, pad(Math.floor(s / 3600) % 24));
    roll(R.mn, pad(Math.floor(s / 60) % 60));
    roll(R.sc, pad(s % 60));
    for (const c of R.cds || []) if (c.st.phase === "before") {
      const left = Math.max(0, Math.floor((c.st.start - t) / 1000));
      c.el.textContent = `${Math.floor(left / 86400)}d ${pad(Math.floor(left / 3600) % 24)}:${pad(Math.floor(left / 60) % 60)}:${pad(left % 60)}`;
    }
  }
  if (st.phase === "during") {
    if (R.bar && st.now) R.bar.style.transform = `scaleX(${Math.min(1, Math.max(0, (t - st.now.start) / (st.now.end - st.now.start))).toFixed(4)})`;
    if (R.inTxt && st.next) R.inTxt.textContent = "in " + until(st.next.start - t);
  }
}
const pad = (n) => String(n).padStart(2, "0");
const until = (ms) => { const m = Math.ceil(ms / 60000); return m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.floor(m / 1440)} d ${Math.floor((m % 1440) / 60)} h`; };

// Digits roll in from above when they change.
function roll(el, str) {
  if (el.dataset.v === str) return;
  el.dataset.v = str;
  if (el.children.length !== str.length) { el.replaceChildren(...[...str].map((c) => h("span.dg", c))); return; }
  [...str].forEach((c, i) => {
    const s = el.children[i];
    if (s.textContent === c) return;
    s.textContent = c;
    if (!reduceMotion.matches) play(s, [{ transform: "translateY(-60%)", opacity: 0 }, { transform: "none", opacity: 1 }], { damping: 0.75, response: 0.42 });
  });
}

// ---------- marking the list ----------
function mark(st, t) {
  const root = cur.root;
  const live = st.phase === "during";
  const evs = new Map((st.events || []).map((e) => [e.key, e]));
  const today = T.dateOf(t);
  root.querySelectorAll(".item[data-k]").forEach((row) => {
    const e = evs.get(row.dataset.k);
    row.classList.toggle("is-now", live && !!st.now && st.now.key === row.dataset.k);
    row.classList.toggle("is-next", live && !!st.next && st.next.key === row.dataset.k);
    row.classList.toggle("is-past", live && !!e && e.end <= t && st.now?.key !== row.dataset.k);
  });
  root.querySelectorAll(".day[data-date]").forEach((d) => d.classList.toggle("is-today", live && d.dataset.date <= today && today <= (d.dataset.end || d.dataset.date)));
}

function jumpToNow() {
  const el = cur.root.querySelector(".item.is-now, .item.is-next, .day.is-today");
  el?.scrollIntoView({ block: "center", behavior: reduceMotion.matches ? "auto" : "smooth" });
  if (el) setTimeout(() => play(el, [{ transform: "scale(1)" }, { transform: "scale(1.03)" }, { transform: "scale(1)" }], { damping: 0.6, response: 0.5 }), 400);
}

function saveCalendar(g) {
  const plan = cur.ctx.state.plan;
  const events = T.timeline(plan, cur.ctx.state, g);
  const blob = new Blob([T.ics(events, cur.ctx.state.settings.tripName || "Trip")], { type: "text/calendar" });
  const a = h("a", { href: URL.createObjectURL(blob), download: `${(cur.ctx.state.settings.tripName || "trip").toLowerCase()}${g ? "-" + g.id : ""}.ics` });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

const ICONS = {
  cal: '<rect x="3.5" y="5" width="17" height="15.5" rx="3.5"/><path d="M3.5 10h17M8 3v4M16 3v4M12 13.5v4M10 15.5h4"/>',
  map: '<path d="M9 4.5 3.5 6.6v12.9L9 17.4l6 2.1 5.5-2.1V4.5L15 6.6z"/><path d="M9 4.5v12.9M15 6.6v12.9"/>',
  now: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
};
const icon = (k) => h("span.nc-ic", { html: `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[k]}</svg>` });
