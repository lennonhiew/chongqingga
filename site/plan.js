// The Plan page: who's where, your cost, flights & trains, day by day.
import { h, play, avatar, yuan, rollNumber, reduceMotion } from "./ui.js?v=12";
import { mountClock } from "./now.js?v=12";
import { weather, cityFor } from "./trip.js?v=12";

let imgSrc = (s) => s;

const KIND_ICON = { flight: "✈️", train: "🚄", hotel: "🛏️", food: "🍜", note: "📝", place: "📍", vote: "🗳️" };
const D = (s) => new Date(s + "T00:00:00");
const dayDiff = (a, b) => Math.round((D(b) - D(a)) / 86400000);
const fmt = (s, o) => D(s).toLocaleDateString("en-GB", o);
const rm = (n) => "RM " + Math.round(n).toLocaleString("en");
const cityTone = (c = "") => (/chongqing/i.test(c) && !/chengdu/i.test(c) ? "cq" : /chengdu/i.test(c) && !/chongqing/i.test(c) ? "cd" : /zhejiang|hangzhou|wenzhou|camp/i.test(c) ? "camp" : "mixed");

let firstRender = true;

export const renderPlan = (root, ctx) => build(root, ctx, "plan");
export const renderItinerary = (root, ctx) => build(root, ctx, "itin");

function build(root, ctx, which) {
  const { state, me } = ctx;
  imgSrc = ctx.imgSrc;
  const plan = state.plan;
  if (!plan) { root.replaceChildren(h("p.plan-empty", "The plan is on its way.")); return; }

  const groups = plan.groups || [];
  const memberByName = (n) => state.members.find((m) => m.name.toLowerCase() === n.toLowerCase());
  const myGroup = me ? groups.find((g) => g.members.some((n) => n.toLowerCase() === me.name.toLowerCase())) : null;
  const forGroup = (gs, g) => !gs || !gs.length || gs.includes("all") || (g && gs.includes(g.id));
  const groupLabel = (gs) => (!gs || !gs.length || gs.includes("all") ? "Everyone" : gs.map((id) => groups.find((g) => g.id === id)?.name || id).join(" + "));
  const groupPeople = (gs) => (!gs || !gs.length || gs.includes("all") ? groups.flatMap((g) => g.members) : gs.flatMap((id) => groups.find((g) => g.id === id)?.members || []));
  const votesFor = (oid) => state.votes.filter((v) => v.optionId === oid);
  const faces = (names, max = 6) => h("span.faces", names.slice(0, max).map((n) => avatar(memberByName(n) || { id: n, name: n })));

  const sections = [];

  if (which === "plan") {
  // ---------- Who's where ----------
  // Bars cover the days the groups are travelling together; anything before (the camp) becomes a note.
  const stays = groups.flatMap((g) => g.stays || []);
  const shared = stays.filter((s) => s.color !== "camp");
  if (shared.length) {
    const start = shared.map((s) => s.from).sort()[0];
    const end = shared.map((s) => s.to).sort().slice(-1)[0];
    const total = dayDiff(start, end) + 1;
    const short = (s) => fmt(s, { day: "numeric", month: "short" });
    const axisDays = Array.from({ length: total }, (_, i) => { const d = D(start); d.setDate(d.getDate() + i); return d; });
    sections.push(h("section.plan-sec",
      h("h2.sec-title", "Who's where"),
      h("div.where", groups.map((g) => {
        const before = (g.stays || []).filter((s) => s.color === "camp" || s.to < start);
        return h("div.where-row", { class: `where-row ${myGroup?.id === g.id ? "mine" : ""}` },
          h("div.where-who", faces(g.members, 4), h("span", g.name), myGroup?.id === g.id ? h("span.you", "You") : null),
          before.length ? h("p.where-before", before.map((s) => `Before: ${s.place}, ${short(s.from)} – ${short(s.to)}`).join(". ")) : null,
          h("div.where-track", { style: { "--days": total } }, (g.stays || []).filter((s) => !before.includes(s)).map((s) => {
            const from = s.from < start ? start : s.from;
            const days = dayDiff(from, s.to) + 1;
            const left = (dayDiff(start, from) / total) * 100, width = (days / total) * 100;
            return h("span.seg-bar", { class: `seg-bar ${s.color || cityTone(s.place)}`, style: { left: left + "%", width: width + "%" }, title: `${s.place}: ${short(from)} – ${short(s.to)}` },
              days >= 2 ? h("span", s.place) : h("span.sr-only", s.place));
          })));
      }),
        h("div.where-axis", { style: { "--days": total } }, axisDays.map((d, i) => h("span", { class: d.getDate() === 1 || i === 0 ? "m" : "" },
          h("b", d.getDate()), d.getDate() === 1 || i === 0 ? h("small", d.toLocaleDateString("en-GB", { month: "short" })) : null))),
        h("p.where-key", h("i.k.cq"), "Chongqing", h("i.k.cd"), "Chengdu"))));
  }

  // ---------- Your cost ----------
  const tripCost = (g) => (plan.trips || []).filter((t) => forGroup(t.groups, g)).reduce((s, t) => s + (Number(t.rmEach) || 0), 0);
  const myTickets = me ? state.votes.filter((v) => v.memberId === me.id).map((v) => state.options.find((o) => o.id === v.optionId)).filter(Boolean).reduce((s, o) => s + (o.priceCny || 0), 0) * ctx.rate() : 0;
  if (myGroup) {
    const rows = [
      ["Flights & trains", tripCost(myGroup), "Your legs below, tax included"],
      ["Hotels", myGroup.nights * plan.rmPerNight, `${myGroup.nights} nights × ${rm(plan.rmPerNight)}`],
      ["Food & getting around", myGroup.days * plan.foodRmPerDay, `${myGroup.days} days × ${rm(plan.foodRmPerDay)}`],
      ["Your tickets", myTickets, "From the places you voted for"],
    ];
    const totalEl = h("b.cost-total");
    const sum = rows.reduce((s, r) => s + r[1], 0);
    sections.push(h("section.plan-sec",
      h("h2.sec-title", "Your trip, roughly"),
      h("div.cost-card",
        h("div.cost-head", h("span", "Budget for ", me.name), totalEl),
        h("ul.cost-rows", rows.map(([k, v, sub]) => h("li", h("span", k, h("small", sub)), h("span.v", rm(v))))),
        myGroup.note ? h("p.cost-note", myGroup.note) : null)));
    rollNumber(totalEl, Math.round(sum), (v) => rm(v));
  } else {
    sections.push(h("section.plan-sec",
      h("h2.sec-title", "Cost per person"),
      h("div.cost-card", h("ul.cost-rows", groups.map((g) => h("li",
        h("span", g.name, h("small", `Flights & trains, ${g.nights} hotel nights, ${g.days} days of food`)),
        h("span.v", rm(tripCost(g) + g.nights * plan.rmPerNight + g.days * plan.foodRmPerDay))))),
        h("p.cost-note", me ? "Ask Leon to add you to a group to see your own budget." : "Sign in to see your own budget, including the tickets you voted for."))));
  }

  // ---------- Flights & trains ----------
  const trips = [...(plan.trips || [])].sort((a, b) => (a.date + a.dep).localeCompare(b.date + b.dep));
  sections.push(h("section.plan-sec",
    h("h2.sec-title", "Flights & trains"),
    h("div.trips", trips.map((t, i) => tripCard(t, i, { mine: forGroup(t.groups, myGroup) && !!myGroup, label: groupLabel(t.groups), people: groupPeople(t.groups), faces })))));
  }

  // ---------- Itinerary (its own tab) ----------
  const clockHost = h("div.clock-host");
  if (which === "itin") sections.push(clockHost, h("section.plan-sec",
    h("h2.sec-title", "Itinerary"),
    h("div.days", (plan.days || []).slice().sort((a, b) => a.date.localeCompare(b.date)).map((d) => {
      const dayForMe = forGroup(d.groups, myGroup) || !myGroup;
      const range = d.endDate && d.endDate !== d.date;
      return h("article.day", { class: `day ${dayForMe ? "" : "not-mine"}`, "data-date": d.date, "data-end": d.endDate || null, "data-city": d.city },
        h("div.day-date",
          h("span.dow", range ? fmt(d.date, { weekday: "short" }) + "–" + fmt(d.endDate, { weekday: "short" }) : fmt(d.date, { weekday: "short" })),
          h("span.dnum", range ? `${D(d.date).getDate()}–${D(d.endDate).getDate()}` : D(d.date).getDate()),
          h("span.mon", fmt(d.date, { month: "short" }))),
        h("div.day-card",
          h("div.day-head",
            h("span.city-chip", { class: `city-chip ${cityTone(d.city)}` }, d.city),
            d.groups?.length && !d.groups.includes("all") ? h("span.who-tag", groupLabel(d.groups)) : null),
          h("h3", d.title),
          h("ul.items", (d.items || []).map((it, i) => itemRow(it, { key: `${d.date}#${i}`, mine: forGroup(it.groups, myGroup) || !myGroup, label: groupLabel(it.groups), state, votesFor, ctx })))));
    }))));

  sections.push(h("p.foot", which === "plan"
    ? "Leon keeps this plan up to date, and it updates live. Flight prices checked on Trip.com, Airpaz and Agoda on 18 Nov, tax included."
    : "Leon keeps the itinerary up to date, and it updates live. Tap a place to see it in Vote."));

  root.replaceChildren(...sections);
  if (which === "itin") {
    mountClock(clockHost, root, ctx);
    weather().then((w) => root.querySelectorAll(".day[data-date]").forEach((el) => {
      const f = w?.[cityFor(el.dataset.city)]?.days?.[el.dataset.date];
      if (f && !el.querySelector(".wx")) el.querySelector(".day-head").append(h("span.wx", `${f.icon} ${f.lo}–${f.hi}°`));
    }));
    return;
  }
  if (which !== "plan") return;

  if (firstRender && !reduceMotion.matches) {
    // One orchestrated moment: the stay bars grow in, row by row.
    root.querySelectorAll(".where-row").forEach((row, r) =>
      row.querySelectorAll(".seg-bar").forEach((b, i) =>
        play(b, [{ transform: "scaleX(0)", opacity: 0 }, { transform: "scaleX(1)", opacity: 1 }], { damping: 0.9, response: 0.6, delay: 150 + r * 120 + i * 70 })));
  }
  firstRender = false;
}

function tripCard(t, i, { mine, label, people, faces }) {
  const plane = t.kind === "flight";
  const path = plane ? "M6 32 Q100 -4 194 32" : "M6 22 L194 22";
  const glyph = plane
    ? '<path d="M-7 -1.6 L4 -1.6 L8 0 L4 1.6 L-7 1.6 Z M-1 -1.5 L-4 -7 L-1.5 -7 L3 -1.5 Z M-1 1.5 L-4 7 L-1.5 7 L3 1.5 Z M-7 -1.4 L-8.5 -4.5 L-6.5 -4.5 L-4.5 -1.4 Z M-7 1.4 L-8.5 4.5 L-6.5 4.5 L-4.5 1.4 Z"/>'
    : '<rect x="-8" y="-4" width="16" height="8" rx="4"/>';
  const svg = `<svg class="route" viewBox="0 0 200 38" preserveAspectRatio="none" aria-hidden="true">
      <path id="tarc${i}" class="arc" d="${path}"/>
      <circle class="dot" cx="6" cy="${plane ? 32 : 22}" r="3"/><circle class="dot" cx="194" cy="${plane ? 32 : 22}" r="3"/>
      <g class="plane">${glyph}
        <animateMotion dur="1.6s" begin="${reduceMotion.matches ? "0s" : 0.2 + i * 0.12 + "s"}" fill="freeze" rotate="auto"
          keyPoints="${reduceMotion.matches ? "0.5;0.5" : "0;0.5"}" keyTimes="0;1" calcMode="spline" keySplines="0.25 0.1 0.25 1"><mpath href="#tarc${i}"/></animateMotion></g></svg>`;
  const booked = t.status === "booked";
  return h("div.flight.trip", { class: `flight trip ${mine ? "mine" : ""}` },
    h("div.flight-top",
      h("span", fmt(t.date, { weekday: "short", day: "numeric", month: "short" }), " · ", [t.carrier, t.no].filter(Boolean).join(" ")),
      h("span.status", { class: `status ${booked ? "booked" : ""}` }, booked ? "Booked" : "Not booked yet")),
    h("div.flight-row",
      h("div.flight-end", h("div.flight-time", t.dep), h("div.flight-code", t.fromCity || t.from)),
      h("div", { html: svg }),
      h("div.flight-end.right", h("div.flight-time", t.arr, t.plusDays ? h("sup", "+" + t.plusDays) : null), h("div.flight-code", t.toCity || t.to))),
    h("div.trip-foot",
      h("span.trip-who", faces(people, 6), h("span", label)),
      h("span.trip-price", t.rmEach ? rm(t.rmEach) : "", t.rmEach ? h("small", " each") : null)),
    t.bag || t.note ? h("p.trip-note", [t.bag ? "🧳 " + t.bag : "", t.note].filter(Boolean).join(". ")) : null);
}

function itemRow(it, { key, mine, label, state, votesFor, ctx }) {
  let lead = h("span.ic", KIND_ICON[it.kind] || "•");
  let main = h("span.tx", it.text);
  let action = null;
  if (it.kind === "place" && it.optionId) {
    const o = state.options.find((x) => x.id === it.optionId);
    if (o) {
      const n = votesFor(o.id).length;
      lead = o.image ? h("img.thumb", { src: imgSrc(o.image), alt: "", loading: "lazy" }) : h("span.ic", o.emoji || "📍");
      main = h("span.tx", it.text || o.name, h("small", n ? `${n} vote${n === 1 ? "" : "s"}` : "No votes yet", o.priceCny ? `, ${yuan(o.priceCny)}` : ""));
      action = () => ctx.openPlace(o.id);
    }
  } else if (it.kind === "vote" && it.pollId) {
    const opts = state.options.filter((o) => o.pollId === it.pollId).map((o) => ({ o, n: votesFor(o.id).length })).sort((a, b) => b.n - a.n);
    const top = opts[0];
    if (top && top.n > 0) {
      lead = top.o.image ? h("img.thumb", { src: imgSrc(top.o.image), alt: "", loading: "lazy" }) : h("span.ic", top.o.emoji);
      main = h("span.tx", top.o.name, h("small", `Winning the vote with ${top.n}. Tap to vote.`));
    } else main = h("span.tx", it.text, h("small", "No votes yet. Tap to vote."));
    action = () => ctx.openPoll(it.pollId);
  }
  if (!mine || (it.groups?.length && !it.groups.includes("all"))) main.append(h("span.who-tag.sm", label));
  const row = h(action ? "li.item.tap" : "li.item", { class: `item ${action ? "tap" : ""} ${mine ? "" : "not-mine"} kind-${it.kind}` },
    h("span.t", it.time || ""), lead, main);
  row.dataset.k = key;
  if (action) {
    row.setAttribute("role", "button");
    row.tabIndex = 0;
    row.addEventListener("click", action);
    row.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), action()));
  }
  return row;
}
