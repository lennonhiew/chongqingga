import { getState, join, vote, subscribe, imgSrc, saveDoc, deleteDoc } from "./api.js?v=16";
import { h, $, play, avatar, WHEN, WHEN_ORDER, yuan, ringgit, rollNumber, openSheet, toast, reduceMotion } from "./ui.js?v=16";
import { renderPlan, renderItinerary } from "./plan.js?v=16";
import { renderInfo } from "./info.js?v=16";
import { renderMap, showMap } from "./map.js?v=16";

// ---------- Loading splash ----------
const splashShownAt = performance.now();
if (reduceMotion.matches) document.querySelector(".splash-icon")?.pauseAnimations?.();
function hideSplash() {
  const s = document.getElementById("splash");
  if (!s || s.classList.contains("out")) return;
  const wait = Math.max(0, 900 - (performance.now() - splashShownAt)); // long enough to see one flight
  setTimeout(() => { s.classList.add("out"); s.addEventListener("animationend", () => s.remove(), { once: true }); setTimeout(() => s.remove(), 800); }, wait);
}
setTimeout(hideSplash, 8000); // never get stuck behind it

const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

let state = null;
let me = store.get("cq-me");
let activePoll = store.get("cq-tab");
let structureKey = "";
let cards = new Map(); // optionId -> { el, stack, count }
let signInSheet = null;

const rate = () => state?.settings?.rmPerCny ?? 0.61;
const memberById = (id) => state.members.find((m) => m.id === id);
const votersOf = (optionId) => state.votes.filter((v) => v.optionId === optionId).map((v) => memberById(v.memberId)).filter(Boolean);
const iVoted = (optionId) => !!me && state.votes.some((v) => v.optionId === optionId && v.memberId === me.id);
const cityClass = (poll) => (/chongqing/i.test(poll.title) ? "city-cq" : /chengdu/i.test(poll.title) ? "city-cd" : "");

// ---------- Hero ----------
function renderHero() {
  const s = state.settings;
  $("#tripName").textContent = s.tripName;
  $("#barTitle").textContent = s.tripName;
  document.title = s.tripName;
  $("#tripDates").textContent = s.dates;
}

// ---------- Pages (bottom tab bar) ----------
const PAGES = ["plan", "itinerary", "map", "vote", "info"];
let page = PAGES.includes(location.hash.slice(1)) ? location.hash.slice(1) : "plan";
const scrollMemo = { plan: 0, vote: 0 };
let mapOpts = null;

function showPage(next, { animate = true } = {}) {
  const prev = page;
  if (next !== prev) scrollMemo[prev] = scrollY;
  page = next;
  history.replaceState(null, "", "#" + next);
  document.querySelectorAll(".page").forEach((p) => (p.hidden = p.dataset.page !== next));
  document.querySelectorAll("#tabbar .tab").forEach((t) => (t.dataset.page === next ? t.setAttribute("aria-current", "page") : t.removeAttribute("aria-current")));
  if (state) updateTray();
  if (next === "vote") requestAnimationFrame(() => movePill(false));
  if (next === "map") showMap(mapOpts), (mapOpts = null);
  if (next !== prev) {
    scrollTo(0, scrollMemo[next] || 0);
    if (animate) {
      const dir = Math.sign(PAGES.indexOf(next) - PAGES.indexOf(prev)) || 1;
      play($(`.page[data-page="${next}"]`), [{ opacity: 0, transform: `translateX(${dir * 24}px)` }, { opacity: 1, transform: "none" }], { damping: 0.9, response: 0.4 });
      const icon = $(`#tabbar .tab[data-page="${next}"] svg`);
      play(icon, [{ transform: "scale(.82)" }, { transform: "scale(1)" }], { damping: 0.5, response: 0.35 });
    }
  }
}
document.querySelectorAll("#tabbar .tab").forEach((t) => t.addEventListener("click", () => showPage(t.dataset.page)));

const planCtx = () => ({
  state, me, imgSrc, rate,
  openPlace(optionId) {
    const o = state.options.find((x) => x.id === optionId);
    if (!o) return;
    showPage("vote");
    if (activePoll !== o.pollId) selectPoll(o.pollId); else renderPoll(0);
    requestAnimationFrame(() => {
      const el = cards.get(optionId)?.el;
      if (!el) return;
      el.scrollIntoView({ block: "center", behavior: reduceMotion.matches ? "auto" : "smooth" });
      setTimeout(() => play(el, [{ transform: "scale(1)" }, { transform: "scale(1.03)" }, { transform: "scale(1)" }], { damping: 0.6, response: 0.5 }), 450);
    });
  },
  refresh: () => drawPlan(),
  openMap(opts) {
    mapOpts = opts;
    if (page === "map") showMap(mapOpts), (mapOpts = null); else showPage("map");
  },
  openPoll(pollId) {
    showPage("vote");
    if (activePoll !== pollId) selectPoll(pollId);
  },
});
const drawPlan = () => { const c = planCtx(); renderPlan($("#pagePlan"), c); renderItinerary($("#pageItinerary"), c); renderMap($("#pageMap"), c); drawInfo(); };
const drawInfo = () => state && renderInfo($("#pageInfo"), { state, me, api: { saveDoc, deleteDoc } });

// ---------- Tabs ----------
function renderTabs() {
  const seg = $("#seg");
  seg.querySelectorAll("button").forEach((b) => b.remove());
  for (const p of state.polls) {
    const b = h("button.pressable", { role: "tab", "data-id": p.id, "aria-selected": String(p.id === activePoll), onclick: () => selectPoll(p.id) },
      p.title, h("span.n"));
    seg.append(b);
  }
  requestAnimationFrame(() => movePill(false));
}

function movePill(animate = true) {
  const b = $(`#seg button[data-id="${activePoll}"]`), pill = $("#segPill");
  if (!b) return;
  // Tabs are equal width, so only translateX moves: stays on the GPU at the screen's full refresh rate.
  pill.style.width = b.offsetWidth + "px";
  const from = pill.style.transform || `translateX(${b.offsetLeft}px)`;
  const to = `translateX(${b.offsetLeft}px)`;
  pill.style.transform = to;
  if (animate && from !== to) play(pill, [{ transform: from }, { transform: to }], { damping: 0.82, response: 0.38 });
}
addEventListener("resize", () => movePill(false));

function selectPoll(id) {
  if (id === activePoll) return;
  const order = state.polls.map((p) => p.id);
  const dir = Math.sign(order.indexOf(id) - order.indexOf(activePoll)) || 1;
  activePoll = id;
  store.set("cq-tab", id);
  $("#seg").querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.id === id)));
  movePill();
  const top = $("#seg").getBoundingClientRect().top + scrollY - 70;
  if (scrollY > top) scrollTo({ top, behavior: reduceMotion.matches ? "auto" : "smooth" });
  renderPoll(dir);
}

// ---------- Poll ----------
function renderPoll(dir = 0) {
  const poll = state.polls.find((p) => p.id === activePoll);
  const box = $("#poll");
  cards = new Map();
  if (!poll) { box.replaceChildren(); return; }
  const options = state.options.filter((o) => o.pollId === poll.id);
  const list = h("ul.options", { class: `options ${cityClass(poll)} ${poll.multi ? "" : "single"} ${options.some((o) => o.image) ? "has-photos" : ""}` },
    options.map((o) => h("li", optionCard(o, poll))));
  box.replaceChildren(
    h("div.poll-head", h("h2", poll.title), h("p", poll.subtitle || (poll.multi ? "Pick as many as you like." : "Pick one."))),
    list);
  box.setAttribute("aria-label", poll.title);
  updateAll();
  if (dir) {
    play(box.querySelector(".poll-head"), [{ opacity: 0, transform: `translateX(${dir * 28}px)` }, { opacity: 1, transform: "none" }], { response: 0.42 });
    [...list.children].slice(0, 7).forEach((li, i) =>
      play(li, [{ opacity: 0, transform: `translateX(${dir * 36}px)` }, { opacity: 1, transform: "none" }], { response: 0.46, delay: 40 + i * 28 }));
  }
}

function optionCard(o, poll) {
  const when = WHEN[o.when] || WHEN.day;
  const stack = h("span.stack");
  const count = h("span.vcount");
  const check = h("span.check", { html: '<svg viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7"/></svg>' });
  let photo = null;
  if (o.image) {
    const img = h("img", { src: imgSrc(o.image), alt: "", loading: "lazy", decoding: "async", draggable: "false" });
    img.addEventListener("load", () => img.classList.add("loaded"));
    if (img.complete) img.classList.add("loaded");
    photo = h("span.photo", img, o.credit ? h("span.credit", o.credit) : null, check);
  }
  const el = h("button.opt", {
    class: `opt ${photo ? "has-photo" : ""}`,
    "aria-pressed": "false",
    onclick: () => toggle(o, poll, el, check),
  },
    photo || h("span.emoji", { "aria-hidden": "true" }, o.emoji || "📍"),
    h("span.opt-body",
      h("span.opt-name", photo && o.emoji ? h("span.opt-emoji", { "aria-hidden": "true" }, o.emoji) : null, o.zh || o.name, o.zh ? h("span.opt-zh", o.name) : null),
      h("span.opt-meta",
        h("span.when", { class: `when ${o.when}` }, when.icon, " ", when.label),
        h("span.price", { class: o.priceCny ? "price" : "price free" }, yuan(o.priceCny), o.priceCny ? h("span.rm", "≈ " + ringgit(o.priceCny, rate())) : null)),
      o.note ? h("span.opt-note", o.note) : null,
      h("span.voters", stack, count)),
    photo ? null : check);
  el.addEventListener("pointerdown", () => el.style.setProperty("transform", "scale(.97)"));
  ["pointerup", "pointerleave", "pointercancel"].forEach((e) => el.addEventListener(e, () => el.style.removeProperty("transform")));
  cards.set(o.id, { el, stack, count, check });
  return el;
}

function updateAll() {
  for (const [id, c] of cards) {
    const on = iVoted(id);
    c.el.setAttribute("aria-pressed", String(on));
    const voters = votersOf(id);
    // diff avatars so new voters pop in and leavers shrink out
    const have = new Map([...c.stack.children].filter((a) => !a.dataset.leaving).map((a) => [a.dataset.id, a]));
    const want = new Set(voters.map((m) => m.id));
    for (const [mid, a] of have) if (!want.has(mid)) {
      a.dataset.leaving = "1";
      a.animate([{ transform: "scale(1)", opacity: 1 }, { transform: "scale(.2)", opacity: 0 }], { duration: 180, easing: "ease-in", fill: "forwards" }).onfinish = () => a.remove();
    }
    for (const m of voters) if (!have.has(m.id)) {
      const a = avatar(m);
      c.stack.append(a);
      if (c.el.isConnected && c.stack.dataset.ready) play(a, [{ transform: "scale(.2)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }], { damping: 0.58, response: 0.42 });
    }
    c.stack.dataset.ready = "1";
    const n = voters.length;
    c.count.textContent = n ? `${n} want${n === 1 ? "s" : ""} to go` : "No votes yet";
    c.el.setAttribute("aria-label", `${c.el.querySelector(".opt-name").textContent}. ${c.count.textContent}. ${on ? "You picked this." : ""}`);
  }
  // tab badges: how many I picked in each poll
  $("#seg").querySelectorAll("button").forEach((b) => {
    const n = me ? state.votes.filter((v) => v.pollId === b.dataset.id && v.memberId === me.id).length : 0;
    b.querySelector(".n").textContent = n ? n : "";
  });
  updateTray();
}

function myPicks() {
  if (!me) return [];
  const ids = new Set(state.votes.filter((v) => v.memberId === me.id).map((v) => v.optionId));
  return state.options.filter((o) => ids.has(o.id));
}

function updateTray() {
  const tray = $("#tray");
  const picks = myPicks();
  const total = picks.reduce((s, o) => s + (o.priceCny || 0), 0);
  const wasHidden = tray.hidden;
  tray.hidden = !me || page !== "vote";
  $("#voteDot").hidden = !me || state.votes.some((v) => v.memberId === me.id);
  if (wasHidden && !tray.hidden) play(tray, [{ transform: "translateY(140%)" }, { transform: "none" }], { damping: 0.85, response: 0.5, delay: 150 });
  $("#trayCount").textContent = `${picks.length} place${picks.length === 1 ? "" : "s"}`;
  rollNumber($("#trayCny"), total, (v) => (v < 0.5 ? "Free" : yuan(v)));
  rollNumber($("#trayRm"), total, (v) => "≈ " + ringgit(v, rate()));
}

async function toggle(o, poll, el, check) {
  if (!me) return askWho(false);
  const on = !iVoted(o.id);
  const before = state.votes;
  state.votes = state.votes.filter((v) => !(v.memberId === me.id && (v.optionId === o.id || (!poll.multi && on && v.pollId === poll.id))));
  if (on) state.votes = [...state.votes, { pollId: poll.id, optionId: o.id, memberId: me.id, at: Date.now() }];
  updateAll();
  if (on) {
    play(check, [{ transform: "scale(.55)" }, { transform: "scale(1)" }], { damping: 0.5, response: 0.4 });
    navigator.vibrate?.(8);
  }
  try {
    await vote(o.id, me.id, on);
  } catch (e) {
    state.votes = before;
    updateAll();
    toast(e.message);
  }
}

// ---------- Who are you ----------
function askWho(dismissable) {
  if (signInSheet) return;
  const err = h("p.err");
  const input = h("input.field", { placeholder: "Your name", maxlength: 40, autocomplete: "given-name", enterkeyhint: "go", "aria-label": "Your name" });
  const go = async (name) => {
    try {
      const m = await join(name);
      setMe(m);
      sheet.close();
    } catch (e) { err.textContent = e.message; }
  };
  input.addEventListener("keydown", (e) => e.key === "Enter" && go(input.value));
  const chips = state.members.map((m) =>
    h("button.who-chip.pressable", { class: `who-chip pressable ${me?.id === m.id ? "me-now" : ""}`, onclick: () => go(m.name) }, avatar(m), m.name));
  const sheet = openSheet(h("div",
    h("h2", me ? "Switch person" : "Hey! Who's this?"),
    h("p.lede", "Tap your name so everyone can see what you voted for. No password needed."),
    h("div.who", chips),
    h("div.or", "not on the list?"),
    h("div.new-name", input, h("button.btn", { onclick: () => go(input.value) }, "Join")),
    err), { dismissable, onClose: () => (signInSheet = null) });
  signInSheet = sheet;
  chips.forEach((c, i) => play(c, [{ opacity: 0, transform: "translateY(10px) scale(.96)" }, { opacity: 1, transform: "none" }], { response: 0.45, delay: 120 + i * 35 }));
}

function setMe(m) {
  me = { id: m.id, name: m.name };
  store.set("cq-me", me);
  renderMe();
  updateAll();
  drawPlan();
  toast(page === "plan" ? `Hi ${m.name}! Here's your plan.` : `Hi ${m.name}! Tap places to vote.`);
}

function renderMe() {
  const b = $("#meBtn");
  b.hidden = !me;
  if (me) b.replaceChildren(avatar(me), me.name);
}

// ---------- Your plan ----------
function showPlan() {
  const picks = myPicks();
  const groups = state.polls.map((p) => ({ p, items: picks.filter((o) => o.pollId === p.id).sort((a, b) => WHEN_ORDER.indexOf(a.when) - WHEN_ORDER.indexOf(b.when)) })).filter((g) => g.items.length);
  const total = picks.reduce((s, o) => s + (o.priceCny || 0), 0);
  const content = h("div",
    h("h2", "Your picks"),
    h("p.lede", "Everything you voted for, sorted by time of day. Food and hotel not included."),
    groups.length ? groups.map(({ p, items }) => h("section.plan-group",
      h("h3", p.title, h("small", yuan(items.reduce((s, o) => s + o.priceCny, 0)))),
      h("ul.plan-list", items.map((o) => h("li",
        o.image ? h("img.thumb", { src: imgSrc(o.image), alt: "", loading: "lazy" }) : h("span.e", o.emoji),
        h("span.n", o.zh || o.name, h("small", [o.zh ? o.name : "", `${WHEN[o.when]?.icon || ""} ${WHEN[o.when]?.label || ""}`].filter(Boolean).join(" · "))),
        h("span.p", yuan(o.priceCny))))))) : h("p.plan-empty", "Nothing yet. Tap the places you want to go and they'll show up here."),
    groups.length ? h("div.plan-total", h("span", "Tickets total"), h("span", h("b", yuan(total)), "  ", ringgit(total, rate()))) : null);
  openSheet(content);
}

function showCredits() {
  const withPhoto = state.options.filter((o) => o.image && o.credit);
  openSheet(h("div",
    h("h2", "Photo credits"),
    h("p.lede", "Photos from Wikimedia Commons, used under their free licences. Tap one to see the original."),
    h("ul.plan-list", { style: { marginTop: "18px" } }, withPhoto.map((o) => h("li",
      h("img.thumb", { src: imgSrc(o.image), alt: "", loading: "lazy" }),
      h("span.n", o.name, h("small", o.credit)),
      o.source ? h("a.src", { href: o.source, target: "_blank", rel: "noopener" }, "Open") : h("span"))))));
}

// ---------- Wiring ----------
$("#tray").addEventListener("click", showPlan);
$("#creditsBtn").addEventListener("click", showCredits);
$("#meBtn").addEventListener("click", () => askWho(true));

new IntersectionObserver(([e]) => $("#bar").classList.toggle("scrolled", !e.isIntersecting), { rootMargin: "-52px 0px 0px 0px" })
  .observe($("#tripName"));

function apply(next) {
  const first = !state;
  state = next;
  if (me && !state.members.some((m) => m.id === me.id)) { me = null; store.set("cq-me", null); }
  if (!state.polls.some((p) => p.id === activePoll)) activePoll = state.polls[0]?.id;
  const key = JSON.stringify([state.settings, state.polls, state.options.map((o) => [o.id, o.name, o.image, o.priceCny, o.when, o.note, o.emoji, o.zh, o.credit])]);
  if (key !== structureKey) {
    structureKey = key;
    renderHero();
    renderTabs();
    renderPoll(0);
  } else updateAll();
  drawPlan();
  renderMe();
  if (first) {
    hideSplash();
    showPage(page, { animate: false });
    play($(".hero h1"), [{ opacity: 0, transform: "translateY(14px)" }, { opacity: 1, transform: "none" }], { response: 0.6 });
    play($("#tripDates"), [{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }], { response: 0.6, delay: 70 });
    if (!me) setTimeout(() => askWho(false), 650);
  }
}

// ?fps shows a live frame-rate meter (checks the phone is really drawing at 120 Hz)
if (new URLSearchParams(location.search).has("fps")) {
  const meter = h("div.fps", "– fps");
  document.body.append(meter);
  let frames = 0, t0 = performance.now(), best = 0, worst = 0, last = t0;
  const tick = (now) => {
    frames++;
    worst = Math.max(worst, now - last); last = now;
    if (now - t0 >= 500) {
      const fps = Math.round((frames * 1000) / (now - t0));
      best = Math.max(best, fps);
      meter.textContent = `${fps} fps  (max ${best}, slowest frame ${worst.toFixed(1)} ms)`;
      frames = 0; t0 = now; worst = 0;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

subscribe(apply, (ok) => ($("#offline").hidden = ok || !state));
getState().then((s) => !state && apply(s)).catch(() => {});
