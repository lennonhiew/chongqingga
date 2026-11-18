// Admin: edit the trip plan friends see on the Plan tab. The whole plan is one document; every save replaces it.
import { h, openSheet, play, toast } from "/site/ui.js";

const clone = (x) => JSON.parse(JSON.stringify(x));
const uid = (p) => p + Math.random().toString(36).slice(2, 8);
const rm = (n) => "RM " + Math.round(Number(n) || 0).toLocaleString("en");
const fmt = (s, o = { weekday: "short", day: "numeric", month: "short" }) => (s ? new Date(s + "T00:00:00").toLocaleDateString("en-GB", o) : "");
const KINDS = { place: "📍 Place (from the poll)", spot: "📌 Spot (not in the poll)", vote: "🗳️ Poll winner", flight: "✈️ Flight", train: "🚄 Train", hotel: "🛏️ Hotel", food: "🍜 Food", note: "📝 Note" };
const COLORS = { cq: "Chongqing red", cd: "Chengdu green", camp: "Camp gold", mixed: "Purple" };

const label = (text, ...kids) => h("label", text, ...kids);
const input = (value, attrs = {}) => h("input.field", { value: value ?? "", ...attrs });
const select = (value, choices) => h("select.field", Object.entries(choices).map(([k, v]) => h("option", { value: k, selected: k === value }, v)));

export function viewPlan({ state, admin, confirmSheet, iconBtn }) {
  const plan = state.plan;
  if (!plan) return h("section.view", h("div.view-head", h("div", h("h1", "Plan"), h("p", "No plan yet."))));

  const save = async (next, msg = "Saved") => {
    try { await admin("savePlan", next); toast(msg); return true; } catch (e) { toast(e.message); return false; }
  };
  const groupName = (gs) => (!gs?.length || gs.includes("all") ? "Everyone" : gs.map((id) => plan.groups.find((g) => g.id === id)?.name || id).join(" + "));
  const groupChecks = (current) => {
    const boxes = [["all", "Everyone"], ...plan.groups.map((g) => [g.id, g.name])].map(([id, name]) =>
      h("label.check-row", h("input", { type: "checkbox", value: id, checked: (current?.length ? current : ["all"]).includes(id) }), name));
    const wrap = h("div.checks", boxes);
    wrap.read = () => { const v = [...wrap.querySelectorAll("input:checked")].map((c) => c.value); return v.includes("all") || !v.length ? ["all"] : v; };
    return wrap;
  };

  // ---------- Budget ----------
  const night = input(plan.rmPerNight, { type: "number", min: 0, step: 5 });
  const food = input(plan.foodRmPerDay, { type: "number", min: 0, step: 5 });
  const budget = h("div.panel",
    h("div.panel-head", h("h2", "Budget per person")),
    h("div.form.row-inline",
      label("Hotel, RM per night", night),
      label("Food & transport, RM per day", food),
      h("button.btn.pressable", { onclick: () => { const p = clone(plan); p.rmPerNight = Number(night.value) || 0; p.foodRmPerDay = Number(food.value) || 0; save(p, "Budget saved"); } }, "Save")));

  // ---------- Groups ----------
  const inGroup = new Set(plan.groups.flatMap((g) => g.members.map((n) => n.toLowerCase())));
  const loose = state.members.filter((m) => !inGroup.has(m.name.toLowerCase()));
  const groups = h("div.panel",
    h("div.panel-head", h("h2", "Groups"), h("button.btn.plain", { onclick: () => editGroup() }, "Add group")),
    h("ul.rows", plan.groups.map((g) => h("li.grow",
      h("span.nm", g.name, h("p", g.members.join(", "))),
      h("span.meta", `${g.nights} nights, ${g.days} days`),
      h("span.tools", iconBtn("edit", "Edit group", () => editGroup(g)),
        iconBtn("del", "Delete group", () => confirmSheet(`Delete ${g.name}?`, "Flights and days for this group stay, but they'll show for nobody until you change them.", "Delete", () => { const p = clone(plan); p.groups = p.groups.filter((x) => x.id !== g.id); return save(p, "Group deleted"); })))))),
    loose.length ? h("p.warn", `Not in any group yet: ${loose.map((m) => m.name).join(", ")}. They won't see their own budget until you add them.`) : null);

  // ---------- Trips ----------
  const trips = [...plan.trips].sort((a, b) => (a.date + a.dep).localeCompare(b.date + b.dep));
  const tripsPanel = h("div.panel",
    h("div.panel-head", h("h2", "Flights & trains"), h("button.btn.plain", { onclick: () => editTrip() }, "Add")),
    h("ul.rows", trips.map((t) => h("li.trow",
      h("span.e", t.kind === "train" ? "🚄" : "✈️"),
      h("span.nm", `${t.fromCity || t.from} → ${t.toCity || t.to}`, h("small", `${fmt(t.date)}, ${t.dep}`), h("p", `${[t.carrier, t.no].filter(Boolean).join(" ")} · ${groupName(t.groups)}`)),
      h("span.pr", rm(t.rmEach)),
      h("button.status-btn", {
        class: `status-btn ${t.status === "booked" ? "booked" : ""}`, title: "Click to switch",
        onclick: () => { const p = clone(plan); const x = p.trips.find((y) => y.id === t.id); x.status = x.status === "booked" ? "planned" : "booked"; save(p, x.status === "booked" ? "Marked booked" : "Marked not booked"); },
      }, t.status === "booked" ? "Booked" : "Not booked"),
      h("span.tools", iconBtn("edit", "Edit", () => editTrip(t)),
        iconBtn("del", "Delete", () => confirmSheet("Delete this trip?", `${t.fromCity} → ${t.toCity} on ${fmt(t.date)}.`, "Delete", () => { const p = clone(plan); p.trips = p.trips.filter((x) => x.id !== t.id); return save(p, "Deleted"); })))))));

  // ---------- Days ----------
  const days = [...plan.days].sort((a, b) => a.date.localeCompare(b.date));
  const daysPanel = h("div.panel",
    h("div.panel-head", h("h2", "Day by day"), h("button.btn.plain", { onclick: () => editDay() }, "Add day")),
    h("ul.rows", days.map((d) => h("li.drow",
      h("span.dd", fmt(d.date, { day: "numeric", month: "short" }), d.endDate && d.endDate !== d.date ? h("small", "to " + fmt(d.endDate, { day: "numeric", month: "short" })) : null),
      h("span.nm", d.title, h("p", `${d.city} · ${groupName(d.groups)} · ${d.items.length} item${d.items.length === 1 ? "" : "s"}`)),
      h("span.tools", iconBtn("edit", "Edit day", () => editDay(d)),
        iconBtn("del", "Delete day", () => confirmSheet(`Delete ${fmt(d.date)}?`, `"${d.title}" and its ${d.items.length} items.`, "Delete", () => { const p = clone(plan); p.days = p.days.filter((x) => x.id !== d.id); return save(p, "Day deleted"); })))))));

  return h("section.view",
    h("div.view-head",
      h("div", h("h1", "Plan"), h("p", "What friends see on the Plan tab. Every save shows on their phones straight away.")),
      h("div.actions", h("button.btn.secondary.pressable", { onclick: () => editTrip() }, "Add flight or train"), h("button.btn.pressable", { onclick: () => editDay() }, "Add day"))),
    budget, groups, tripsPanel, daysPanel);

  // ---------- Sheets ----------
  function editTrip(t = {}) {
    const isNew = !t.id;
    const f = {
      kind: select(t.kind || "flight", { flight: "✈️ Flight", train: "🚄 Train" }),
      date: input(t.date, { type: "date" }),
      carrier: input(t.carrier, { placeholder: "AirAsia X" }), no: input(t.no, { placeholder: "D7 306" }),
      from: input(t.from, { placeholder: "KUL", maxlength: 4 }), fromCity: input(t.fromCity, { placeholder: "Kuala Lumpur" }),
      to: input(t.to, { placeholder: "TFU", maxlength: 4 }), toCity: input(t.toCity, { placeholder: "Chengdu" }),
      dep: input(t.dep, { type: "time" }), arr: input(t.arr, { type: "time" }),
      plus: select(String(t.plusDays || 0), { 0: "Same day", 1: "Next day (+1)", 2: "+2 days" }),
      price: input(t.rmEach, { type: "number", min: 0, step: 1 }),
      bag: input(t.bag, { placeholder: "20 kg each" }),
      status: select(t.status || "planned", { planned: "Not booked yet", booked: "Booked" }),
      note: h("textarea.field", { placeholder: "Booking tips, terminal…" }, t.note || ""),
    };
    const who = groupChecks(t.groups);
    const err = h("p.form-err");
    const sheet = openSheet(h("div",
      h("h2", isNew ? "Add flight or train" : "Edit trip"),
      h("div.form",
        h("div.row3", label("Type", f.kind), label("Date", f.date), label("Status", f.status)),
        h("div.row2", label("Airline or train", f.carrier), label("Flight number", f.no)),
        h("div.row4", label("From", f.from), label("City", f.fromCity), label("To", f.to), label("City", f.toCity)),
        h("div.row3", label("Leaves", f.dep), label("Arrives", f.arr), label("Arrival day", f.plus)),
        h("div.row2", label("Price per person (RM, tax incl.)", f.price), label("Baggage", f.bag)),
        h("div.flabel", "Who's on it", who),
        label("Note", f.note),
        err,
        h("div.form-actions", h("button.btn.secondary", { onclick: () => sheet.close() }, "Cancel"),
          h("button.btn", { onclick: async () => {
            if (!f.date.value || !f.fromCity.value || !f.toCity.value) { err.textContent = "Add the date and both cities."; return; }
            const p = clone(plan);
            const row = { id: t.id || uid("t"), kind: f.kind.value, groups: who.read(), date: f.date.value, carrier: f.carrier.value.trim(), no: f.no.value.trim(),
              from: f.from.value.trim().toUpperCase(), fromCity: f.fromCity.value.trim(), to: f.to.value.trim().toUpperCase(), toCity: f.toCity.value.trim(),
              dep: f.dep.value, arr: f.arr.value, plusDays: Number(f.plus.value), rmEach: Number(f.price.value) || 0, bag: f.bag.value.trim(), status: f.status.value, note: f.note.value.trim() };
            if (isNew) p.trips.push(row); else p.trips[p.trips.findIndex((x) => x.id === t.id)] = row;
            if (await save(p, isNew ? "Trip added" : "Saved")) sheet.close();
          } }, isNew ? "Add" : "Save")))));
  }

  function editGroup(g = { members: [], stays: [], nights: 0, days: 0 }) {
    const isNew = !g.id;
    const name = input(g.name, { placeholder: "Leon & YJ" });
    const nights = input(g.nights, { type: "number", min: 0 }), daysIn = input(g.days, { type: "number", min: 0 });
    const note = input(g.note, { placeholder: "e.g. The camp covers 20–27 Dec" });
    const members = h("div.checks", state.members.map((m) => h("label.check-row", h("input", { type: "checkbox", value: m.name, checked: g.members.some((n) => n.toLowerCase() === m.name.toLowerCase()) }), m.name)));
    const staysBox = h("div.stays");
    const stayRow = (s = {}) => h("div.stay",
      input(s.from, { type: "date", "aria-label": "From" }), input(s.to, { type: "date", "aria-label": "To" }),
      input(s.place, { placeholder: "Chongqing", "aria-label": "Place" }), select(s.color || "cq", COLORS),
      h("button.icon-btn.del", { type: "button", title: "Remove", html: '<svg viewBox="0 0 20 20"><path d="M5 5l10 10M15 5L5 15"/></svg>', onclick: (e) => e.currentTarget.parentElement.remove() }));
    (g.stays || []).forEach((s) => staysBox.append(stayRow(s)));
    const err = h("p.form-err");
    const sheet = openSheet(h("div",
      h("h2", isNew ? "Add group" : `Edit ${g.name}`),
      h("div.form",
        label("Name", name),
        h("div.flabel", "People", members),
        h("div.row2", label("Hotel nights", nights), label("Days of food & transport", daysIn)),
        label("Note under their budget", note),
        h("div.flabel", "Where they are (bars on Who's where)", staysBox, h("button.btn.secondary", { type: "button", onclick: () => staysBox.append(stayRow()) }, "Add stay")),
        err,
        h("div.form-actions", h("button.btn.secondary", { onclick: () => sheet.close() }, "Cancel"),
          h("button.btn", { onclick: async () => {
            if (!name.value.trim()) { err.textContent = "Give the group a name."; return; }
            const p = clone(plan);
            const row = { ...g, id: g.id || uid("g"), name: name.value.trim(), nights: Number(nights.value) || 0, days: Number(daysIn.value) || 0, note: note.value.trim(),
              members: [...members.querySelectorAll("input:checked")].map((c) => c.value),
              stays: [...staysBox.children].map((r) => { const [a, b, c, d] = r.querySelectorAll("input,select"); return { from: a.value, to: b.value || a.value, place: c.value.trim(), color: d.value }; }).filter((s) => s.from && s.place) };
            // one person, one group
            p.groups.forEach((x) => { if (x.id !== row.id) x.members = x.members.filter((n) => !row.members.includes(n)); });
            if (isNew) p.groups.push(row); else p.groups[p.groups.findIndex((x) => x.id === g.id)] = row;
            if (await save(p, isNew ? "Group added" : "Saved")) sheet.close();
          } }, isNew ? "Add" : "Save")))));
  }

  function editDay(d = { items: [] }) {
    const isNew = !d.id;
    const date = input(d.date, { type: "date" }), endDate = input(d.endDate, { type: "date" });
    const city = input(d.city, { placeholder: "Chongqing" }), title = input(d.title, { placeholder: "Everyone together" });
    const who = groupChecks(d.groups);
    const placeChoices = { "": "Pick a place…" };
    state.polls.forEach((p) => state.options.filter((o) => o.pollId === p.id).forEach((o) => (placeChoices[o.id] = `${p.title}: ${o.name}`)));
    const pollChoices = Object.fromEntries(state.polls.map((p) => [p.id, p.title]));
    const whoChoices = { all: "Everyone", ...Object.fromEntries(plan.groups.map((g) => [g.id, g.name + " only"])) };
    const list = h("div.item-rows");
    const itemRow = (it = { kind: "place" }) => {
      const time = input(it.time, { placeholder: "09:00", "aria-label": "Time (24 h, China time)" });
      const zh = input(it.zh || "", { placeholder: "Chinese name (optional)", "aria-label": "Chinese name" });
      const note = input(it.note || "", { placeholder: "Tip, e.g. take the lift down (optional)", "aria-label": "Tip" });
      const pin = input(it.at ? it.at.join(", ") : "", { placeholder: "Map pin: lat, lng from Amap (optional)", "aria-label": "Map pin" });
      const kind = select(it.kind || "place", KINDS);
      const text = input(it.text, { placeholder: "What happens", "aria-label": "Text" });
      const place = select(it.optionId || "", placeChoices);
      const poll = select(it.pollId || state.polls[0]?.id, pollChoices);
      const whoSel = select(it.groups?.length && !it.groups.includes("all") ? it.groups[0] : "all", whoChoices);
      const sync = () => {
        zh.hidden = kind.value === "place" || kind.value === "vote";
        place.hidden = kind.value !== "place"; poll.hidden = kind.value !== "vote";
        text.placeholder = kind.value === "place" ? "Name (leave empty to use the place's)" : "What happens";
        const auto = kind.value === "place" && plan.geo?.[place.value];
        pin.placeholder = auto ? `Map pin: ${auto.join(", ")} (from the place)` : "Map pin: lat, lng from Amap (optional)";
      };
      place.addEventListener("change", sync);
      kind.addEventListener("change", sync);
      place.addEventListener("change", () => { if (!text.value) text.value = state.options.find((o) => o.id === place.value)?.name || ""; });
      const row = h("div.irow", time, kind, h("div.icol", text, zh, place, poll, note, pin), whoSel,
        h("span.tools",
          h("button.icon-btn", { type: "button", title: "Up", html: '<svg viewBox="0 0 20 20"><path d="M5 12l5-5 5 5"/></svg>', onclick: () => row.previousElementSibling?.before(row) }),
          h("button.icon-btn", { type: "button", title: "Down", html: '<svg viewBox="0 0 20 20"><path d="M5 8l5 5 5-5"/></svg>', onclick: () => row.nextElementSibling?.after(row) }),
          h("button.icon-btn.del", { type: "button", title: "Remove", html: '<svg viewBox="0 0 20 20"><path d="M5 5l10 10M15 5L5 15"/></svg>', onclick: () => row.remove() })));
      row.read = () => {
        const k = kind.value;
        const out = { id: it.id || uid("i"), time: time.value.trim(), kind: k, text: text.value.trim() };
        if (k === "place") out.optionId = place.value;
        if (k === "vote") out.pollId = poll.value;
        if (whoSel.value !== "all") out.groups = [whoSel.value];
        if (zh.value.trim()) out.zh = zh.value.trim();
        if (note.value.trim()) out.note = note.value.trim();
        if (it.exit) out.exit = it.exit; // cable car drop-off, set from code
        const ll = pin.value.match(/(-?\d+(?:\.\d+)?)\s*[,，\s]\s*(-?\d+(?:\.\d+)?)/);
        if (ll) { let [a, b] = [+ll[1], +ll[2]]; if (a > 90) [a, b] = [b, a]; out.at = [a, b]; } // Amap copies "lng,lat"; flip if needed
        return out;
      };
      sync();
      return row;
    };
    d.items.forEach((it) => list.append(itemRow(it)));
    const err = h("p.form-err");
    const sheet = openSheet(h("div",
      h("h2", isNew ? "Add day" : `Edit ${fmt(d.date)}`),
      h("div.form",
        h("div.row2", label("Date", date), label("Until (for several days)", endDate)),
        h("div.row2", label("City", city), label("Title", title)),
        h("div.flabel", "Who this day is for", who),
        h("div.flabel", "What happens", list, h("button.btn.secondary", { type: "button", onclick: () => { const r = itemRow(); list.append(r); play(r, [{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], { response: 0.35 }); } }, "Add item")),
        err,
        h("div.form-actions", h("button.btn.secondary", { onclick: () => sheet.close() }, "Cancel"),
          h("button.btn", { onclick: async () => {
            if (!date.value || !title.value.trim()) { err.textContent = "Add a date and a title."; return; }
            const items = [...list.children].map((r) => r.read()).filter((i) => i.text || i.optionId || i.pollId);
            if (items.some((i) => i.kind === "place" && !i.optionId)) { err.textContent = "Pick a place for every 📍 item, or change its type."; return; }
            const p = clone(plan);
            const row = { id: d.id || uid("d"), date: date.value, city: city.value.trim(), title: title.value.trim(), groups: who.read(), items };
            if (endDate.value && endDate.value > date.value) row.endDate = endDate.value;
            if (isNew) p.days.push(row); else p.days[p.days.findIndex((x) => x.id === d.id)] = row;
            if (await save(p, isNew ? "Day added" : "Saved")) sheet.close();
          } }, isNew ? "Add day" : "Save")))));
    sheet.el.classList.add("wide");
  }
}
