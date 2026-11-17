import { admin, getState, subscribe, imgSrc, friendsUrl, isLive } from "/site/api.js";
import { h, $, play, avatar, WHEN, yuan, ringgit, openSheet, toast, ago } from "/site/ui.js";
import { viewPlan } from "./plan-admin.js";

let state = null;
let view = localStorage.getItem("cq-admin-view") || "results";
let resultsMode = "places";

const rate = () => state.settings.rmPerCny;
const pollClass = (p) => (/chongqing/i.test(p.title) ? "cq" : /chengdu/i.test(p.title) ? "cd" : "");
const votesFor = (oid) => state.votes.filter((v) => v.optionId === oid);
const member = (id) => state.members.find((m) => m.id === id);
const pollVoters = (pid) => new Set(state.votes.filter((v) => v.pollId === pid).map((v) => v.memberId));

async function act(action, payload, msg) {
  try { await admin(action, payload); if (msg) toast(msg); return true; }
  catch (e) { toast(e.message); return false; }
}

const icon = {
  edit: '<svg viewBox="0 0 20 20"><path d="M13.5 3.5l3 3L7 16H4v-3z"/></svg>',
  del: '<svg viewBox="0 0 20 20"><path d="M4 6h12M8 6V4h4v2M6 6l1 10h6l1-10"/></svg>',
  up: '<svg viewBox="0 0 20 20"><path d="M5 12l5-5 5 5"/></svg>',
  down: '<svg viewBox="0 0 20 20"><path d="M5 8l5 5 5-5"/></svg>',
};
const pic = (o) => (o.image ? h("img.thumb", { src: imgSrc(o.image), alt: "", loading: "lazy" }) : h("span.e", o.emoji));

// Shrink a picked photo to max 1280px wide JPEG before uploading.
function shrink(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1280 / img.naturalWidth);
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => reject(new Error("Couldn't read that photo."));
    img.src = URL.createObjectURL(file);
  });
}

const iconBtn = (name, label, onclick) => h("button.icon-btn", { class: `icon-btn ${name === "del" ? "del" : ""}`, title: label, "aria-label": label, html: icon[name], onclick });

// ---------- Navigation ----------
function go(v, animate = true) {
  view = v;
  localStorage.setItem("cq-admin-view", v);
  const btns = [...document.querySelectorAll("#nav button")];
  btns.forEach((b) => (b.dataset.view === v ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current")));
  const b = btns.find((x) => x.dataset.view === v), pill = $("#navPill");
  const from = pill.style.transform || `translateY(${b.offsetTop}px)`;
  pill.style.transform = `translateY(${b.offsetTop}px)`;
  if (animate) play(pill, [{ transform: from }, { transform: pill.style.transform }], { damping: 0.85, response: 0.35 });
  render(true);
}
document.querySelectorAll("#nav button").forEach((b) => b.addEventListener("click", () => go(b.dataset.view)));

function render(entering = false) {
  if (!state) return;
  $("#brandName").textContent = state.settings.tripName;
  const content = $("#content");
  const keepScroll = content.scrollTop;
  const el = { results: viewResults, plan: () => viewPlan({ state, admin, confirmSheet, iconBtn }), places: viewPlaces, friends: viewFriends, settings: viewSettings }[view]();
  // keep old bar widths so they animate to the new values
  const oldBars = new Map([...content.querySelectorAll(".bar-fill[data-k]")].map((b) => [b.dataset.k, b.style.transform]));
  content.replaceChildren(el);
  if (entering) {
    content.scrollTop = 0;
    play(el, [{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { response: 0.4 });
  } else content.scrollTop = keepScroll;
  el.querySelectorAll(".bar-fill[data-k]").forEach((b) => {
    const target = b.dataset.w;
    b.style.transform = oldBars.get(b.dataset.k) || "scaleX(0)";
    requestAnimationFrame(() => requestAnimationFrame(() => (b.style.transform = target)));
  });
  el.querySelectorAll(".ring .val").forEach((c) => {
    const target = c.dataset.off;
    requestAnimationFrame(() => requestAnimationFrame(() => (c.style.strokeDashoffset = target)));
  });
}

// ---------- Results ----------
function viewResults() {
  const n = state.members.length;
  const voted = new Set(state.votes.map((v) => v.memberId));
  const C = 2 * Math.PI * 40;
  const frac = n ? voted.size / n : 0;
  const ring = h("div", { html: `<svg class="ring" viewBox="0 0 96 96"><circle class="track" cx="48" cy="48" r="40"/><circle class="val" cx="48" cy="48" r="40" stroke-dasharray="${C}" style="stroke-dashoffset:${C}" data-off="${C * (1 - frac)}"/><text x="48" y="48">${voted.size}/${n}</text></svg>` }).firstChild;

  const turnout = h("div.panel.turnout", ring, h("div",
    h("h2", voted.size === n && n ? "Everyone has voted" : `${voted.size} of ${n} friends have voted`),
    h("p", { style: { color: "var(--text-2)", marginTop: "2px" } }, `${state.votes.length} votes in total. Updates live as they tap.`),
    h("div.people", state.members.map((m) => h("span.person", { class: `person ${voted.has(m.id) ? "" : "waiting"}`, title: voted.has(m.id) ? `Last active ${ago(m.lastSeen)}` : "Hasn't voted yet" }, avatar(m), m.name)))));

  const toggle = h("div.seg-sm", { role: "group", "aria-label": "Show results" },
    h("button", { "aria-pressed": String(resultsMode === "places"), onclick: () => { resultsMode = "places"; render(); } }, "By place"),
    h("button", { "aria-pressed": String(resultsMode === "people"), onclick: () => { resultsMode = "people"; render(); } }, "By person"));

  const body = resultsMode === "places" ? state.polls.map(pollResults) : [peopleResults()];
  return h("section.view",
    h("div.view-head", h("div", h("h1", "Results"), h("p", "Who wants to go where, ranked by votes.")), h("div.actions", toggle)),
    turnout, body);
}

function pollResults(p) {
  const opts = state.options.filter((o) => o.pollId === p.id)
    .map((o) => ({ o, votes: votesFor(o.id) }))
    .sort((a, b) => b.votes.length - a.votes.length);
  const max = Math.max(1, state.members.length);
  const voters = pollVoters(p.id);
  const waiting = state.members.filter((m) => !voters.has(m.id));
  const top = opts[0]?.votes.length || 0;
  return h("div.panel",
    h("div.panel-head", h("h2", p.title, h("span.tag", p.multi ? "Pick many" : "Pick one")), h("span.muted", `${voters.size} of ${state.members.length} voted`)),
    h("ol.rank", { class: `rank ${pollClass(p)}` }, opts.map(({ o, votes }, i) => {
      const names = votes.map((v) => member(v.memberId)).filter(Boolean);
      return h("li", { class: top && votes.length === top ? "top" : "" },
        h("span.pos", i + 1),
        pic(o),
        h("span.nm", o.name, h("small", `${WHEN[o.when]?.label || ""}, ${yuan(o.priceCny)}`)),
        h("div.bar", { title: names.map((m) => m.name).join(", ") || "No votes" },
          h("div.bar-fill", { "data-k": o.id, "data-w": `scaleX(${votes.length / max})` }),
          h("div.bar-who", names.map((m) => avatar(m)), names.length ? h("span.bar-names", names.map((m) => m.name).join(", ")) : null)),
        h("span.cnt", votes.length, h("small", votes.length === 1 ? "vote" : "votes")));
    })),
    waiting.length ? h("p.waiting-line", "Waiting on: " + waiting.map((m) => m.name).join(", ")) : null);
}

function peopleResults() {
  return h("div.grid-people", state.members.map((m) => {
    const mine = state.votes.filter((v) => v.memberId === m.id).map((v) => state.options.find((o) => o.id === v.optionId)).filter(Boolean);
    const total = mine.reduce((s, o) => s + o.priceCny, 0);
    return h("div.panel.pcard",
      h("h3", avatar(m), m.name, h("small", mine.length ? `${yuan(total)}  ${ringgit(total, rate())}` : "")),
      h("p.seen", m.lastSeen ? `Active ${ago(m.lastSeen).toLowerCase()}` : "Hasn't opened the link yet"),
      mine.length ? state.polls.map((p) => {
        const items = mine.filter((o) => o.pollId === p.id);
        return items.length ? [h("h4", p.title), h("ul", items.map((o) => h("li", h("span", `${o.emoji} ${o.name}`), h("span", yuan(o.priceCny)))))] : null;
      }) : h("p.none", "No picks yet."));
  }));
}

// ---------- Places ----------
function viewPlaces() {
  return h("section.view",
    h("div.view-head",
      h("div", h("h1", "Places"), h("p", "Add, edit or reorder what friends can vote on. Changes show on their phones instantly.")),
      h("div.actions", h("button.btn.secondary.pressable", { onclick: () => editPoll() }, "New poll"), h("button.btn.pressable", { onclick: () => editOption({ pollId: state.polls[0]?.id }) }, "Add place"))),
    state.polls.length ? state.polls.map((p) => {
      const opts = state.options.filter((o) => o.pollId === p.id);
      return h("div.panel",
        h("div.panel-head",
          h("h2", p.title, h("span.tag", p.multi ? "Pick many" : "Pick one")),
          h("div", { style: { display: "flex", gap: "4px", alignItems: "center" } },
            h("button.btn.plain", { onclick: () => editOption({ pollId: p.id }) }, "Add place"),
            iconBtn("edit", "Edit poll", () => editPoll(p)),
            iconBtn("del", "Delete poll", () => confirmSheet(`Delete "${p.title}"?`, `This removes the poll, its ${opts.length} places and everyone's votes on it.`, "Delete poll", () => act("deletePoll", { id: p.id }, "Poll deleted"))))),
        opts.length ? h("ul.rows", opts.map((o, i) => h("li",
          pic(o),
          h("span.nm", o.name, o.zh ? h("small", o.zh) : null, h("p", o.note || "")),
          h("span", { class: `when ${o.when}` }, WHEN[o.when]?.icon, " ", WHEN[o.when]?.label),
          h("span.pr", yuan(o.priceCny)),
          h("span.tools",
            iconBtn("up", "Move up", () => i > 0 && act("moveOption", { id: o.id, dir: -1 })),
            iconBtn("down", "Move down", () => i < opts.length - 1 && act("moveOption", { id: o.id, dir: 1 })),
            iconBtn("edit", "Edit", () => editOption(o)),
            iconBtn("del", "Delete", () => confirmSheet(`Delete ${o.name}?`, `${votesFor(o.id).length} vote(s) on it will be removed too.`, "Delete", () => act("deleteOption", { id: o.id }, "Place deleted"))))))) : h("p.empty", "No places yet."));
    }) : h("div.panel", h("p.empty", "No polls yet. Make one with New poll.")));
}

function editOption(o = {}) {
  const isNew = !o.id;
  let when = o.when || "day";
  const f = {
    emoji: h("input.field.emoji-field", { value: o.emoji || "📍", maxlength: 8, "aria-label": "Emoji" }),
    name: h("input.field", { value: o.name || "", placeholder: "Hongyadong", autofocus: true }),
    zh: h("input.field", { value: o.zh || "", placeholder: "洪崖洞" }),
    poll: h("select.field", state.polls.map((p) => h("option", { value: p.id, selected: p.id === o.pollId }, p.title))),
    price: h("input.field", { type: "number", min: 0, step: 1, value: o.priceCny ?? 0 }),
    note: h("textarea.field", { placeholder: "Why go, best time, booking tips…", maxlength: 240 }, o.note || ""),
  };
  // Photo: preview + choose / remove. Uploads straight away, saved with the place.
  let image = o.image || "", credit = o.credit || "", source = o.source || "";
  const preview = h("div.photo-preview");
  const creditIn = h("input.field", { value: credit, placeholder: "Who took it (optional)", maxlength: 120 });
  const fileIn = h("input", { type: "file", accept: "image/jpeg,image/png,image/webp", hidden: true });
  const removeBtn = h("button.btn.secondary", { type: "button" }, "Remove");
  const showPhoto = () => {
    preview.replaceChildren(image ? h("img", { src: imgSrc(image), alt: "" }) : h("span", "No photo. Friends see the emoji instead."));
    removeBtn.hidden = !image;
  };
  fileIn.addEventListener("change", async () => {
    const file = fileIn.files[0];
    if (!file) return;
    preview.replaceChildren(h("span", "Uploading…"));
    try {
      const r = await admin("uploadImage", { dataUrl: await shrink(file) });
      image = r.image; source = ""; creditIn.value = "";
      showPhoto();
      play(preview.firstChild, [{ opacity: 0, transform: "scale(.96)" }, { opacity: 1, transform: "none" }], { response: 0.4 });
    } catch (e) { err.textContent = e.message; showPhoto(); }
    fileIn.value = "";
  });
  removeBtn.addEventListener("click", () => { image = ""; source = ""; creditIn.value = ""; showPhoto(); });
  showPhoto();
  const photoField = h("div.flabel", "Photo",
    h("div.photo-field", preview, h("div.photo-actions",
      h("button.btn.secondary", { type: "button", onclick: () => fileIn.click() }, "Choose photo…"), removeBtn, fileIn, creditIn)));

  const hint = h("span.price-hint");
  const updHint = () => (hint.textContent = Number(f.price.value) ? `≈ ${ringgit(Number(f.price.value), rate())} per person` : "Free");
  f.price.addEventListener("input", updHint); updHint();
  const whens = h("div.whens", Object.entries(WHEN).map(([k, w]) => h("button", { type: "button", "aria-pressed": String(k === when), onclick: (e) => { when = k; whens.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === e.currentTarget))); } }, `${w.icon} ${w.label}`)));
  const err = h("p.form-err");
  const save = async () => {
    try {
      await admin("saveOption", { id: o.id, pollId: f.poll.value, emoji: f.emoji.value, name: f.name.value, zh: f.zh.value, when, priceCny: f.price.value, note: f.note.value, image, credit: creditIn.value, source });
      sheet.close(); toast(isNew ? "Place added" : "Saved");
    } catch (e) { err.textContent = e.message; }
  };
  const sheet = openSheet(h("div",
    h("h2", isNew ? "Add a place" : `Edit ${o.name}`),
    h("div.form",
      h("div.row", h("label", "Emoji", f.emoji), h("label", "Name", f.name), h("label", "Chinese name", f.zh)),
      h("div.row2", h("label", "Poll", f.poll), h("label", "Price per person (¥)", f.price, hint)),
      h("div.flabel", "Best time", whens),
      photoField,
      h("label", "Note", f.note),
      err,
      h("div.form-actions", h("button.btn.secondary", { onclick: () => sheet.close() }, "Cancel"), h("button.btn", { onclick: save }, isNew ? "Add place" : "Save")))));
}

function editPoll(p = {}) {
  const title = h("input.field", { value: p.title || "", placeholder: "Food", autofocus: true });
  const sub = h("input.field", { value: p.subtitle || "", placeholder: "What should we eat? Pick as many as you like." });
  const multi = h("input", { type: "checkbox", checked: p.multi ?? true });
  const err = h("p.form-err");
  const sheet = openSheet(h("div",
    h("h2", p.id ? "Edit poll" : "New poll"),
    h("div.form",
      h("label", "Title (shows as a tab)", title),
      h("label", "Description", sub),
      h("label.check-row", multi, "Friends can pick more than one"),
      err,
      h("div.form-actions", h("button.btn.secondary", { onclick: () => sheet.close() }, "Cancel"),
        h("button.btn", { onclick: async () => { try { await admin("savePoll", { id: p.id, title: title.value, subtitle: sub.value, multi: multi.checked }); sheet.close(); toast(p.id ? "Saved" : "Poll created"); } catch (e) { err.textContent = e.message; } } }, p.id ? "Save" : "Create poll")))));
}

function confirmSheet(title, text, label, onYes) {
  const sheet = openSheet(h("div",
    h("h2", title), h("p.lede", text),
    h("div.form-actions", { style: { marginTop: "22px" } },
      h("button.btn.secondary", { onclick: () => sheet.close(), autofocus: true }, "Cancel"),
      h("button.btn.danger", { onclick: async () => { sheet.close(); await onYes(); } }, label))));
}

// ---------- Friends ----------
function viewFriends() {
  const input = h("input.field", { placeholder: "Add a friend's name", maxlength: 40 });
  const add = async () => { if (await act("addMember", { name: input.value }, `${input.value.trim()} added`)) input.value = ""; };
  input.addEventListener("keydown", (e) => e.key === "Enter" && add());
  return h("section.view",
    h("div.view-head", h("div", h("h1", "Friends"), h("p", "Names show up on the sign-in screen. Friends can also add themselves."))),
    h("div.panel",
      h("div.add-friend", input, h("button.btn.pressable", { onclick: add }, "Add")),
      h("ul.rows.flist", state.members.map((m) => {
        const n = state.votes.filter((v) => v.memberId === m.id).length;
        return h("li", avatar(m), h("span.nm", m.name), h("span.meta", `${n} vote${n === 1 ? "" : "s"}`), h("span.meta", m.lastSeen ? `Active ${ago(m.lastSeen).toLowerCase()}` : "Not opened yet"),
          h("span.tools", iconBtn("del", `Remove ${m.name}`, () => confirmSheet(`Remove ${m.name}?`, "Their votes are deleted too. They can join again from the link.", "Remove", () => act("removeMember", { id: m.id }, `${m.name} removed`)))));
      }))));
}

// ---------- Settings ----------
// Group code for the Info tab. Only a check value is stored; the code itself never leaves this PC.
function codePanel() {
  const isSet = !!state.vault;
  const saved = (state.docs || []).length;
  const code = h("input.field", { type: "text", placeholder: "e.g. hotpot-panda-2026", autocomplete: "off", spellcheck: "false" });
  const again = h("input.field", { type: "text", placeholder: "Type it again", autocomplete: "off", spellcheck: "false" });
  const err = h("p.form-err");
  const apply = async () => {
    err.textContent = "";
    const c = code.value.trim();
    if (c.length < 8) { err.textContent = "Use at least 8 characters. Three short words with dashes works well."; return; }
    if (c.toLowerCase() !== again.value.trim().toLowerCase()) { err.textContent = "The two codes don't match."; return; }
    const { makeVault } = await import("/site/crypto.js");
    const vault = await makeVault(c);
    if (await act("setVault", vault, isSet ? "New code set. Everyone needs to re-add their details." : "Travel info is on. Share the code in Telegram.")) { code.value = ""; again.value = ""; }
  };
  const go = () => (isSet && saved
    ? confirmSheet("Change the group code?", `The ${saved} saved ${saved === 1 ? "person's details" : "people's details"} can't be opened with a new code, so they'll be deleted and everyone adds them again.`, "Change code", apply)
    : apply());
  return h("div.panel",
    h("div.panel-head", h("h2", "Travel info code"), h("span.tag", isSet ? `On, ${saved} added` : "Off")),
    h("p", { style: { color: "var(--text-2)", fontSize: "14px", marginBottom: "12px", lineHeight: 1.45 } },
      "Friends type this code on the Info tab to see passport and IC details. Details are encrypted on each phone with it, so nobody without the code (not even Supabase) can read them. The code is never stored, so write it down and share it in the Telegram group."),
    h("div.form.settings", h("div.row2", h("label", isSet ? "New code" : "Code", code), h("label", "Confirm", again)), err,
      h("div.form-actions", { style: { justifyContent: "flex-start" } }, h("button.btn.pressable", { onclick: go }, isSet ? "Change code" : "Turn on travel info"))));
}

function viewSettings() {
  const s = state.settings;
  const name = h("input.field", { value: s.tripName });
  const dates = h("input.field", { value: s.dates });
  const rateIn = h("input.field", { type: "number", step: 0.001, min: 0.01, value: s.rmPerCny });
  return h("section.view",
    h("div.view-head", h("div", h("h1", "Settings"), h("p", "Trip details shown at the top of the friends' page."))),
    h("div.panel",
      h("div.form.settings",
        h("label", "Trip name", name),
        h("label", "Dates", dates),
        h("label", "Ringgit per ¥1 (for the RM prices)", rateIn),
        h("div.form-actions", { style: { justifyContent: "flex-start" } }, h("button.btn.pressable", { onclick: () => act("saveSettings", { tripName: name.value, dates: dates.value, rmPerCny: rateIn.value }, "Settings saved") }, "Save")))),
    codePanel(),
    h("div.panel.danger-zone",
      h("h2", { style: { fontSize: "18px" } }, "Start over"),
      h("p", "Clear votes keeps the places and friends. Reset puts back the starter places from the itinerary."),
      h("div", { style: { display: "flex", gap: "8px" } },
        h("button.btn.danger", { onclick: () => confirmSheet("Clear all votes?", "Everyone's picks are removed. Places and friends stay.", "Clear votes", () => act("clearVotes", {}, "Votes cleared")) }, "Clear votes"),
        h("button.btn.danger", { onclick: () => confirmSheet("Reset everything?", "All polls, places, friends and votes go back to the starter set.", "Reset", () => act("resetAll", {}, "Reset done")) }, "Reset to starter"))));
}

// ---------- Live ----------
$("#shareUrl").textContent = friendsUrl.replace(/^https?:\/\//, "");
$("#shareBtn").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(friendsUrl); toast("Link copied"); } catch { toast(friendsUrl); }
});

let firstPaint = true;
subscribe((s) => {
  const prev = state;
  state = s;
  if (prev) {
    // a new vote from a friend? say who
    const old = new Set(prev.votes.map((v) => v.memberId + v.optionId));
    const fresh = s.votes.filter((v) => !old.has(v.memberId + v.optionId));
    if (fresh.length === 1) {
      const m = member(fresh[0].memberId), o = s.options.find((x) => x.id === fresh[0].optionId);
      if (m && o) toast(`${m.name} voted ${o.emoji} ${o.name}`);
    }
  }
  if (firstPaint) { firstPaint = false; go(view, false); } else render();
}, (ok) => {
  $("#live").classList.toggle("on", ok);
  $("#liveText").textContent = ok ? "Live" : "Reconnecting…";
});
getState().then((s) => { if (!state) { state = s; go(view, false); } }).catch(() => {});
