// The Info tab: everyone's passport and IC details, locked with the group code.
// Details are encrypted on the phone (crypto.js) before they're saved; the server never sees them.
import { h, play, avatar, openSheet, toast, reduceMotion } from "./ui.js?v=16";
import { unlock, seal, unseal } from "./crypto.js?v=16";

const CODE_KEY = "cq-code";
const TRIP_END = "2027-01-05";
const FIELDS = [
  ["fullName", "Name (as in passport)"],
  ["passportNo", "Passport number"],
  ["passportExpiry", "Passport expires"],
  ["ic", "IC number"],
  ["dob", "Date of birth"],
];

let key = null;          // AES key once unlocked
let keyFor = null;       // the vault it unlocks
let opened = new Map();  // memberId -> { sig, data }
let shown = new Set();   // memberIds with numbers revealed
let ctxRef = null;

const store = {
  get: () => { try { return localStorage.getItem(CODE_KEY); } catch { return null; } },
  set: (v) => { try { v ? localStorage.setItem(CODE_KEY, v) : localStorage.removeItem(CODE_KEY); } catch {} },
};

const D = (s) => new Date(s + "T00:00:00");
const pretty = (s) => (s ? D(s).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");
const slash = (s) => (s ? s.split("-").reverse().join("/") : "");
const mask = (s = "", keep = 2) => (s.length <= keep + 1 ? "•".repeat(s.length) : s.slice(0, 1) + "•".repeat(Math.max(3, s.length - 1 - keep)) + s.slice(-keep));
const maskIc = (s = "") => (/^\d{6}-?\d{2}-?\d{4}$/.test(s) ? s.replace(/^(\d{6})-?(\d{2})-?(\d{4})$/, "$1-••-••••") : mask(s));

export async function renderInfo(root, ctx) {
  ctxRef = ctx;
  const { state } = ctx;
  if (!state.vault) {
    root.replaceChildren(lockedCard("Not set up yet", "Leon will turn this on soon. You'll get a group code in the Telegram chat.", null));
    return;
  }
  if (!key || keyFor !== state.vault.check) {
    key = null;
    const saved = store.get();
    if (saved) key = await unlock(saved, state.vault);
    if (key) keyFor = state.vault.check; else { store.set(null); root.replaceChildren(unlockForm(root)); return; }
  }
  // decrypt anything new or changed
  for (const d of state.docs) {
    const sig = d.cipher.slice(0, 32) + d.iv;
    if (opened.get(d.memberId)?.sig === sig) continue;
    try { opened.set(d.memberId, { sig, data: await unseal(key, d.cipher, d.iv) }); } catch { opened.set(d.memberId, { sig, data: null }); }
  }
  for (const id of [...opened.keys()]) if (!state.docs.some((d) => d.memberId === id)) opened.delete(id);
  draw(root);
}

function lockedCard(title, text, extra) {
  const lock = h("div.lock-icon", { html: '<svg viewBox="0 0 48 48"><rect x="10" y="21" width="28" height="21" rx="6"/><path class="shackle" d="M16 21v-6a8 8 0 0 1 16 0v6"/><circle cx="24" cy="31.5" r="2.6"/></svg>' });
  return h("section.info-lock",
    lock,
    h("h2", title),
    h("p.lede", text),
    extra);
}

function unlockForm(root) {
  const input = h("input.field", { type: "password", placeholder: "Group code", autocomplete: "off", autocapitalize: "none", spellcheck: "false", enterkeyhint: "go", "aria-label": "Group code" });
  const err = h("p.err");
  const btn = h("button.btn.wide.pressable", "Unlock");
  const go = async () => {
    err.textContent = "";
    btn.disabled = true; btn.textContent = "Checking…";
    const k = await unlock(input.value, ctxRef.state.vault);
    btn.disabled = false; btn.textContent = "Unlock";
    if (!k) {
      err.textContent = "That code isn't right. Check the Telegram group.";
      play(card.querySelector(".field"), [{ transform: "translateX(0)" }, { transform: "translateX(-10px)" }, { transform: "translateX(8px)" }, { transform: "translateX(-5px)" }, { transform: "translateX(0)" }], { damping: 0.5, response: 0.35 });
      navigator.vibrate?.([10, 40, 10]);
      return;
    }
    key = k; keyFor = ctxRef.state.vault.check; store.set(input.value);
    const shackle = card.querySelector(".shackle");
    if (shackle && !reduceMotion.matches) await play(shackle, [{ transform: "none" }, { transform: "translateY(-5px) rotate(-18deg)" }], { damping: 0.6, response: 0.4 })?.finished;
    renderInfo(root, ctxRef);
  };
  input.addEventListener("keydown", (e) => e.key === "Enter" && go());
  btn.addEventListener("click", go);
  const card = lockedCard("Travel info is locked",
    "Passport and IC details for bookings. Enter the group code from the Telegram chat to see them. Details are encrypted on your phone, so nobody without the code can read them.",
    h("div.unlock", input, err, btn));
  setTimeout(() => input.focus({ preventScroll: true }), 300);
  return card;
}

function draw(root) {
  const { state, me } = ctxRef;
  const members = [...state.members].sort((a, b) => (a.id === me?.id ? -1 : b.id === me?.id ? 1 : 0));
  const have = members.filter((m) => opened.get(m.id)?.data);
  const missing = members.filter((m) => !opened.get(m.id)?.data);
  const mine = me && opened.get(me.id)?.data;

  root.replaceChildren(...[
    h("div.info-head",
      h("div", h("h2.sec-title", "Travel info"), h("p.info-sub", `${have.length} of ${members.length} added. Tap any copy button to paste into a booking form.`)),
      h("button.btn.secondary.pressable.lock-btn", { onclick: () => { key = null; store.set(null); opened.clear(); shown.clear(); renderInfo(root, ctxRef); toast("Locked on this phone"); } }, "Lock")),
    me && !mine ? h("button.add-mine.pressable", { onclick: () => editDoc(me) },
      h("span.plus", "+"), h("span", h("b", "Add your details"), h("small", "Takes a minute. Have your passport and IC ready."))) : null,
    h("div.docs", have.map((m) => docCard(m, opened.get(m.id).data))),
    missing.length ? h("section.missing",
      h("h3", "Still to add"),
      h("div.missing-list", missing.map((m) => h("button.missing-chip.pressable", { onclick: () => editDoc(m), title: `Add ${m.name}'s details` }, avatar(m), m.name, h("span.plus-sm", "+"))))) : null,
    h("p.foot", "Encrypted with the group code before it leaves your phone. Leon can change the code any time, which clears everything."),
  ].filter(Boolean));
}

function docCard(m, data) {
  const isShown = shown.has(m.id);
  const warn = expiryWarning(data.passportExpiry);
  const rows = FIELDS.filter(([k]) => data[k]).map(([k, label]) => {
    const raw = data[k];
    let display = raw, copy = raw;
    if (k === "passportExpiry" || k === "dob") { display = pretty(raw); copy = slash(raw); }
    if (!isShown && k === "passportNo") display = mask(raw);
    if (!isShown && k === "ic") display = maskIc(raw);
    return h("li",
      h("span.k", label),
      h("span.v", { class: `v ${k === "passportExpiry" && warn ? "bad" : ""}` }, display),
      copyBtn(copy, `${m.name}'s ${label.toLowerCase()}`));
  });
  const all = [
    `Name: ${data.fullName || m.name}`,
    data.passportNo ? `Passport: ${data.passportNo}${data.passportExpiry ? ` (expires ${slash(data.passportExpiry)})` : ""}` : "",
    data.ic ? `IC: ${data.ic}` : "",
    data.dob ? `Date of birth: ${slash(data.dob)}` : "",
  ].filter(Boolean).join("\n");
  return h("article.doc",
    h("div.doc-head",
      avatar(m, 34),
      h("span.doc-name", m.name, ctxRef.me?.id === m.id ? h("span.you", "You") : null),
      h("button.icon-pill.pressable", { "aria-pressed": String(isShown), title: isShown ? "Hide numbers" : "Show numbers", onclick: () => { isShown ? shown.delete(m.id) : shown.add(m.id); draw(document.getElementById("pageInfo")); } },
        h("span", { html: isShown ? '<svg viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.1A9.7 9.7 0 0 1 12 5c5 0 9 4.5 10 7-0.4 1-1.2 2.3-2.4 3.5M6.3 6.3C4.3 7.6 2.8 9.6 2 12c1 2.5 5 7 10 7 1.6 0 3.1-.4 4.4-1.1"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M2 12c1-2.5 5-7 10-7s9 4.5 10 7c-1 2.5-5 7-10 7S3 14.5 2 12z"/><circle cx="12" cy="12" r="3"/></svg>' }),
        isShown ? "Hide" : "Show"),
      h("button.icon-pill.pressable", { title: "Edit", onclick: () => editDoc(m, data) }, "Edit")),
    warn ? h("p.doc-warn", warn) : null,
    h("ul.doc-rows", rows),
    h("button.copy-all.pressable", { onclick: (e) => copy(all, `${m.name}'s details`, e.currentTarget) }, h("span", { html: COPY_SVG }), "Copy all"));
}

const COPY_SVG = '<svg viewBox="0 0 24 24"><rect x="8.5" y="8.5" width="11" height="11" rx="2.5"/><path d="M15.5 8.5V6a2.5 2.5 0 0 0-2.5-2.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5"/></svg>';
const DONE_SVG = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

function copyBtn(text, what) {
  return h("button.copy.pressable", { "aria-label": `Copy ${what}`, html: COPY_SVG, onclick: (e) => copy(text, what, e.currentTarget) });
}

async function copy(text, what, btn) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const t = h("textarea", { style: { position: "fixed", opacity: "0" } }, text);
    document.body.append(t); t.select(); document.execCommand("copy"); t.remove();
  }
  navigator.vibrate?.(8);
  toast(`Copied ${what}`);
  const icon = btn.querySelector("span") || btn;
  const before = icon.innerHTML;
  icon.innerHTML = DONE_SVG;
  btn.classList.add("done");
  play(icon.firstChild, [{ transform: "scale(.4)" }, { transform: "scale(1)" }], { damping: 0.5, response: 0.35 });
  setTimeout(() => { icon.innerHTML = before; btn.classList.remove("done"); }, 1400);
}

function expiryWarning(exp) {
  if (!exp) return "";
  const need = D(TRIP_END); need.setMonth(need.getMonth() + 6);
  if (D(exp) < D(TRIP_END)) return "This passport expires before the trip ends. Renew it now.";
  if (D(exp) < need) return `Expires less than 6 months after the trip. China entry and airlines usually need 6 months left (valid until at least ${need.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}). Renew it before booking.`;
  return "";
}

// IC 010203-14-5678 → 2001-02-03
function dobFromIc(ic) {
  const m = /^(\d{2})(\d{2})(\d{2})/.exec(ic.replace(/\D/g, ""));
  if (!m) return "";
  const yy = Number(m[1]), year = (yy > Number(String(new Date().getFullYear()).slice(2)) ? 1900 : 2000) + yy;
  const s = `${year}-${m[2]}-${m[3]}`;
  return isNaN(D(s)) || D(s).getMonth() + 1 !== Number(m[2]) ? "" : s;
}

function editDoc(m, data = {}) {
  const { saveDoc, deleteDoc } = ctxRef.api;
  const f = {
    fullName: h("input.field", { value: data.fullName || "", placeholder: "As printed in the passport", autocomplete: "off", autocapitalize: "characters" }),
    passportNo: h("input.field", { value: data.passportNo || "", placeholder: "A12345678", autocomplete: "off", autocapitalize: "characters", spellcheck: "false" }),
    passportExpiry: h("input.field", { type: "date", value: data.passportExpiry || "" }),
    ic: h("input.field", { value: data.ic || "", placeholder: "010203-14-5678", inputmode: "numeric", autocomplete: "off" }),
    dob: h("input.field", { type: "date", value: data.dob || "" }),
  };
  const err = h("p.err");
  f.ic.addEventListener("input", () => {
    const digits = f.ic.value.replace(/\D/g, "").slice(0, 12);
    f.ic.value = digits.length > 8 ? `${digits.slice(0, 6)}-${digits.slice(6, 8)}-${digits.slice(8)}` : digits.length > 6 ? `${digits.slice(0, 6)}-${digits.slice(6)}` : digits;
    if (!f.dob.value && digits.length >= 6) f.dob.value = dobFromIc(digits);
  });
  const warnEl = h("p.doc-warn", { hidden: true });
  f.passportExpiry.addEventListener("change", () => { const w = expiryWarning(f.passportExpiry.value); warnEl.textContent = w; warnEl.hidden = !w; });
  const saveBtn = h("button.btn", data.fullName ? "Save" : "Add details");
  saveBtn.addEventListener("click", async () => {
    const out = {
      fullName: f.fullName.value.trim().toUpperCase().replace(/\s+/g, " "),
      passportNo: f.passportNo.value.trim().toUpperCase().replace(/\s+/g, ""),
      passportExpiry: f.passportExpiry.value,
      ic: f.ic.value.trim(),
      dob: f.dob.value,
    };
    if (!out.fullName || !out.passportNo) { err.textContent = "Add at least the name and passport number."; return; }
    if (!/^[A-Z0-9]{6,12}$/.test(out.passportNo)) { err.textContent = "Passport numbers are 6–12 letters and digits, no spaces."; return; }
    saveBtn.disabled = true; saveBtn.textContent = "Encrypting…";
    try {
      const sealed = await seal(key, out);
      await saveDoc(m.id, sealed.cipher, sealed.iv);
      opened.set(m.id, { sig: sealed.cipher.slice(0, 32) + sealed.iv, data: out });
      sheet.close();
      toast(`Saved ${m.id === ctxRef.me?.id ? "your" : m.name + "'s"} details`);
      draw(document.getElementById("pageInfo"));
    } catch (e) { err.textContent = e.message; saveBtn.disabled = false; saveBtn.textContent = "Save"; }
  });
  const sheet = openSheet(h("div",
    h("h2", m.id === ctxRef.me?.id ? "Your details" : `${m.name}'s details`),
    h("p.lede", "Encrypted on this phone before saving. Only people with the group code can read it."),
    h("div.doc-form",
      h("label", "Name (as in passport)", f.fullName),
      h("div.two", h("label", "Passport number", f.passportNo), h("label", "Expires", f.passportExpiry)),
      warnEl,
      h("div.two", h("label", "IC number", f.ic), h("label", "Date of birth", f.dob)),
      err,
      h("div.sheet-actions",
        data.fullName ? h("button.btn.danger", { onclick: async () => { try { await deleteDoc(m.id); opened.delete(m.id); sheet.close(); toast("Deleted"); draw(document.getElementById("pageInfo")); } catch (e) { err.textContent = e.message; } } }, "Delete") : h("span"),
        saveBtn))));
  setTimeout(() => f.fullName.focus({ preventScroll: true }), 350);
}
