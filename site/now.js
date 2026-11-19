// The live card at the top of Itinerary: a clock, a countdown to your flight,
// and during the trip "Now" and "Next" with travel times. Also marks the matching rows in the list.
import { h, play, reduceMotion } from "./ui.js?v=21";
import { icon } from "./icons.js?v=21";
import * as T from "./trip.js?v=21";

let timer = 0, starter = 0;
let cur = null; // { host, root, ctx, shape, refs }

export function mountClock(host, root, ctx) {
  clearInterval(timer);
  clearTimeout(starter);
  cur = { host, root, ctx, shape: "", refs: {} };
  tick();
  // Tick on the second boundary so the seconds change together with the phone's own clock.
  starter = setTimeout(() => { tick(); timer = setInterval(tick, 1000); }, 1000 - (T.now() % 1000));
  T.weather().then(() => { if (cur?.host === host) { cur.shape = ""; tick(); } });
}

// Shared with plan.js so the list and the card agree on whose day it is.
export function liveStatus(ctx, t = T.now()) {
  const plan = ctx.state.plan;
  const me = T.groupOf(plan, ctx.me);
  const groups = me ? [me] : plan.groups || [];
  const sts = groups.map((g) => ({ g, st: T.status(plan, ctx.state, g, t) }));
  // Not signed in: follow whichever group is furthest along.
  const main = sts.find((x) => x.st.phase === "during") || sts.slice().sort((a, b) => (a.st.start || 0) - (b.st.start || 0))[0];
  return { me, sts, main };
}

function tick() {
  if (!cur || !cur.host.isConnected) return;
  const t = T.now();
  const { me, sts, main } = liveStatus(cur.ctx, t);
  if (!main) return;
  const st = main.st;
  // A new trip day (or the trip starting) re-lays out the whole list, not just the card.
  const pd = st.phase + st.dayN;
  if (cur.pd && cur.pd !== pd && cur.ctx.refresh) { cur.pd = pd; cur.ctx.refresh(); return; }
  cur.pd = pd;
  const shape = [st.phase, st.now?.key, st.next?.key, st.idle, st.dayN, me?.id, sts.map((x) => x.st.phase).join()].join("|");
  if (shape !== cur.shape) {
    const first = !cur.shape;
    cur.shape = shape;
    cur.refs = {};
    const card = build(st, main.g, sts, me, t);
    cur.host.replaceChildren(card);
    if (!first) play(card, [{ opacity: 0.4, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], { response: 0.4 });
    mark(st, t);
  }
  update(st, t);
}

// ---------- building the card ----------
function build(st, g, sts, me, t) {
  const R = cur.refs;
  const plan = cur.ctx.state.plan;
  R.clock = h("span.nc-clock");
  const top = h("div.nc-top", h("span.live"), R.clock, h("span.nc-tz", "China and KL time"));
  const btn = (ic, label, onclick) => h("button.nc-btn.pressable", { onclick }, icon(ic), h("span", label));

  if (st.phase === "before") {
    R.cds = [];
    const firstTrip = st.first;
    const others = sts.filter((x) => x.g !== g);
    return h("section.now-card.before",
      top,
      h("p.nc-kicker", me ? "You fly in" : `${g.name} fly in`),
      countdown(R),
      h("p.nc-route", icon(firstTrip.kind === "train" ? "metro" : "plane"),
        h("span", `${firstTrip.fromCity || firstTrip.from} → ${firstTrip.toCity || firstTrip.to}`),
        h("span.nc-when", T.fmt(st.start, { weekday: "short", day: "numeric", month: "short" }) + ", " + T.ampm(firstTrip.dep))),
      others.length ? h("ul.nc-others", others.map((x) => {
        const el = h("span.nc-mini");
        R.cds.push({ el, st: x.st });
        return h("li", h("span", x.g.name), x.st.phase === "during" ? h("span.nc-mini.live-txt", "On the trip now") : el);
      })) : null,
      me ? otherGroupLine(plan, me, t) : null,
      h("p.nc-hint", icon("shirt"), h("span", T.CLIMATE)),
      h("div.nc-actions",
        btn("cal", "Add to calendar", () => saveCalendar(g)),
        btn("map", "Map", () => cur.ctx.openMap({ mode: "all" }))));
  }

  if (st.phase === "after") {
    const places = st.events.filter((e) => e.kind === "place").length;
    return h("section.now-card.after", top,
      h("p.nc-kicker", "Home again"),
      h("h2.nc-title", `${st.days} days, ${places} stops`),
      h("p.nc-sub", "That was the trip. Hope the hotpot was worth it."));
  }

  // During the trip
  const city = T.cityFor(st.now?.day.city || st.next?.day.city || st.prev?.day.city || "");
  R.wx = h("span.nc-wx");
  T.weather().then((data) => {
    const c = data?.[city]?.now;
    if (c) R.wx.replaceChildren(icon(c.icon), h("span", `${c.t}°C ${city}`));
  });
  const nowE = st.now;
  const nm = nowE ? T.names(nowE) : null;
  R.bar = h("i");
  const nowBlock = h("div.nc-block.now",
    h("p.nc-kicker", h("span.dot"), "Now"),
    nowE ? h("h2.nc-title", nm.main) : h("h2.nc-title.idle", st.idle),
    nowE ? h("p.nc-sub", [nm.sub, `since ${T.clock(nowE.start)}`].filter(Boolean).join(" · ")) : st.prev ? h("p.nc-sub", `Last: ${T.names(st.prev).main}`) : null,
    nowE ? h("div.nc-progress", R.bar) : null);

  let nextBlock = null;
  if (st.next) {
    const n = st.next, nn = T.names(n);
    R.inTxt = h("span");
    const from = (nowE || st.prev)?.exit || (nowE || st.prev)?.geo;
    const leg = from && n.geo ? T.legs(from, n.geo) : null;
    nextBlock = h("div.nc-block.next",
      h("p.nc-kicker", "Next at ", T.clock(n.start), h("span.nc-in", R.inTxt)),
      h("h3.nc-next", nn.main, n.day.date !== T.dateOf(t) ? h("small", " " + T.fmt(n.start, { weekday: "short", day: "numeric", month: "short" })) : null),
      nn.sub ? h("p.nc-en", nn.sub) : null,
      n.item?.note ? h("p.nc-tip", T.ampm(n.item.note)) : null,
      leg && leg.km > 0.05 ? transport(leg, n) : n.geo ? h("a.nc-link", { href: T.amapUrl(n.geo, nn.main, "car"), target: "_blank", rel: "noopener" }, "Directions in Amap") : null);
  }
  return h("section.now-card.during", top,
    h("div.nc-day", h("span", `Day ${st.dayN}`, h("small", ` of ${st.days}`)), R.wx),
    nowBlock, nextBlock,
    h("div.nc-actions",
      btn("now", "Jump to now", jumpToNow),
      btn("map", "Today's map", () => cur.ctx.openMap({ mode: "trip", date: T.dateOf(t) }))));
}

// Three equal cells: walk, metro, taxi. The fastest one is marked; each opens Amap with that mode.
export function transport(leg, e) {
  const name = e.zh || e.title;
  const best = T.fastest(leg);
  const cell = (key, mode, ic, label) => leg[key] == null
    ? h("span.mv.off", icon(ic), h("b", "—"), h("small", label))
    : h("a.mv", { class: `mv ${best === key ? "best" : ""}`, href: T.amapUrl(e.geo, name, mode), target: "_blank", rel: "noopener", title: `${label} in Amap` },
      icon(ic), h("b", T.mins(leg[key])), h("small", label));
  return h("div.mv-wrap",
    h("div.mv3", cell("walk", "walk", "walk", "Walk"), cell("metro", "bus", "metro", "Metro"), cell("car", "car", "car", "Taxi")),
    h("p.mv-note", `${T.dist(leg.km)} apart · rough times, tap for live ones in Amap`));
}

function countdown(R) {
  const cell = (k, label) => { R[k] = h("span.cd-n"); return h("span.cd-cell", R[k], h("small", label)); };
  return h("div.cd", cell("d", "days"), cell("hr", "hours"), cell("mn", "min"), cell("sc", "sec"));
}

// While the other group is already away, show where they are.
function otherGroupLine(plan, me, t) {
  const other = (plan.groups || []).find((g) => g.id !== me.id);
  if (!other) return null;
  const s = T.status(plan, cur.ctx.state, other, t);
  if (s.phase !== "during") return null;
  return h("p.nc-meanwhile", `${other.name}, day ${s.dayN}: `, h("b", s.now ? T.names(s.now).main : s.idle));
}

// ---------- every second ----------
function update(st, t) {
  const R = cur.refs;
  if (R.clock) R.clock.textContent = T.fmt(t, { weekday: "short", day: "numeric", month: "short" }) + "  " + T.fmt(t, { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
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
    if (!reduceMotion.matches) s.animate([{ transform: "translateY(-40%)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 320, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
  });
}

// ---------- marking the list ----------
function mark(st, t) {
  const root = cur.root;
  const live = st.phase === "during";
  const evs = new Map((st.events || []).map((e) => [e.key, e]));
  root.querySelectorAll(".item[data-k]").forEach((row) => {
    const e = evs.get(row.dataset.k);
    const isNow = live && !!st.now && st.now.key === row.dataset.k;
    if (isNow && !row.classList.contains("is-now")) play(row, [{ transform: "scale(.96)", opacity: 0.6 }, { transform: "none", opacity: 1 }], { response: 0.45 });
    row.classList.toggle("is-now", isNow);
    row.classList.toggle("is-next", live && !!st.next && st.next.key === row.dataset.k);
    row.classList.toggle("is-past", live && !!e && e.end <= t && st.now?.key !== row.dataset.k);
  });
}

function jumpToNow() {
  const el = cur.root.querySelector(".item.is-now, .item.is-next, .day.is-today");
  el?.scrollIntoView({ block: "center", behavior: reduceMotion.matches ? "auto" : "smooth" });
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
