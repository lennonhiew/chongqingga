// Shared UI helpers: springs, DOM building, avatars, money, sheets.

export const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");

// A spring as a CSS linear() easing + duration. damping 1 = no overshoot,
// response = seconds to (roughly) reach the target, like SwiftUI's .spring(response:dampingFraction:).
const springCache = new Map();
export function spring(damping = 1, response = 0.4) {
  const key = `${damping}/${response}`;
  if (springCache.has(key)) return springCache.get(key);
  const w = (2 * Math.PI) / response;
  const x = (t) => {
    if (damping < 1) {
      const wd = w * Math.sqrt(1 - damping * damping);
      return 1 - Math.exp(-damping * w * t) * (Math.cos(wd * t) + ((damping * w) / wd) * Math.sin(wd * t));
    }
    return 1 - Math.exp(-w * t) * (1 + w * t);
  };
  let settle = 0.1;
  for (let t = 0; t < 4; t += 1 / 240) if (Math.abs(1 - x(t)) > 0.002) settle = t;
  const n = 48, pts = [];
  for (let i = 0; i <= n; i++) pts.push(+x((settle * i) / n).toFixed(4));
  pts[n] = 1;
  const s = { easing: `linear(${pts.join(", ")})`, duration: Math.round(settle * 1000) };
  springCache.set(key, s);
  return s;
}
document.documentElement.style.setProperty("--spring", spring(1, 0.45).easing);
document.documentElement.style.setProperty("--spring-bouncy", spring(0.72, 0.5).easing);

// Animate with a spring. Under reduced motion: a short cross-fade only.
export function play(el, keyframes, { damping = 1, response = 0.4, delay = 0 } = {}) {
  if (!el?.animate) return null;
  if (reduceMotion.matches) {
    const fade = keyframes.map((k) => ({ opacity: k.opacity ?? 1 }));
    return el.animate(fade, { duration: 200, easing: "ease", fill: "backwards" });
  }
  const s = spring(damping, response);
  return el.animate(keyframes, { duration: s.duration, easing: s.easing, delay, fill: "backwards" });
}

// h("div.card#x", {onclick}, child, "text")
export function h(sel, attrs, ...kids) {
  const [, tag = "div", rest = ""] = sel.match(/^([a-z0-9]*)(.*)$/i);
  const el = document.createElement(tag || "div");
  rest.replace(/([.#])([\w-]+)/g, (_, k, v) => (k === "." ? el.classList.add(v) : (el.id = v)));
  if (attrs != null && (typeof attrs !== "object" || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "style" && typeof v === "object") for (const [p, val] of Object.entries(v)) p.startsWith("--") ? el.style.setProperty(p, val) : (el.style[p] = val);
    else if (k === "html") el.innerHTML = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  return el;
}
export const $ = (s, root = document) => root.querySelector(s);

// Avatars: initials on a colour picked from the name, so everyone keeps their colour.
export function hue(name) {
  let x = 0;
  for (const c of name) x = (x * 31 + c.codePointAt(0)) >>> 0;
  return [211, 4, 145, 28, 262, 330, 190, 44, 98, 352][x % 10];
}
export function initials(name) {
  const parts = name.trim().split(/\s+/);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase();
}
export function avatar(member, size) {
  const a = h("span.avatar", { title: member.name, "data-id": member.id, "aria-label": member.name }, initials(member.name));
  a.style.setProperty("--h", hue(member.name));
  if (size) a.style.setProperty("--size", size + "px");
  return a;
}

export const WHEN = {
  morning: { label: "Morning", icon: "🌤️" },
  day: { label: "Day", icon: "☀️" },
  sunset: { label: "Sunset", icon: "🌅" },
  night: { label: "Night", icon: "🌙" },
  latenight: { label: "Late night", icon: "🌌" },
  fullday: { label: "Full day", icon: "🗓️" },
};
export const WHEN_ORDER = Object.keys(WHEN);

export const yuan = (n) => (n ? `¥${Math.round(n).toLocaleString("en")}` : "Free");
export const ringgit = (n, rate) => `RM${Math.round(n * rate).toLocaleString("en")}`;

// Counts a number up or down to its new value.
export function rollNumber(el, to, fmt) {
  const from = Number(el.dataset.v ?? to);
  el.dataset.v = to;
  if (from === to || reduceMotion.matches) { el.textContent = fmt(to); return; }
  const t0 = performance.now(), dur = 520;
  const step = (now) => {
    const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
    el.textContent = fmt(from + (to - from) * e);
    if (p < 1 && el.dataset.v == to) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Bottom sheet (centred card on wide screens). Returns { el, close }.
export function openSheet(content, { dismissable = true, onClose } = {}) {
  const scrim = h("div.scrim");
  const sheet = h("div.sheet", { role: "dialog", "aria-modal": "true" }, h("div.grabber"), content);
  document.body.append(scrim, sheet);
  document.body.classList.add("sheet-open");
  play(scrim, [{ opacity: 0 }, { opacity: 1 }], { response: 0.35 });
  play(sheet, [{ transform: "translateY(105%)" }, { transform: "translateY(0)" }], { damping: 0.88, response: 0.42 });
  let closed = false;
  const close = () => {
    if (closed) return; closed = true;
    document.removeEventListener("keydown", onKey);
    document.body.classList.remove("sheet-open");
    const a = sheet.animate([{ transform: "translateY(0)" }, { transform: "translateY(105%)" }], { duration: reduceMotion.matches ? 1 : 260, easing: "cubic-bezier(.4,0,1,1)", fill: "forwards" });
    scrim.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, fill: "forwards" });
    a.onfinish = () => { scrim.remove(); sheet.remove(); onClose?.(); };
  };
  const onKey = (e) => e.key === "Escape" && dismissable && close();
  if (dismissable) { scrim.onclick = close; document.addEventListener("keydown", onKey); }
  setTimeout(() => sheet.querySelector("[autofocus]")?.focus(), 350);
  return { el: sheet, close };
}

export function toast(text) {
  const t = h("div.toast", { role: "status" }, text);
  document.body.append(t);
  play(t, [{ opacity: 0, transform: "translate(-50%, 16px) scale(.96)" }, { opacity: 1, transform: "translate(-50%, 0) scale(1)" }], { damping: 0.8, response: 0.4 });
  setTimeout(() => t.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, fill: "forwards" }).onfinish = () => t.remove(), 2400);
}

export function ago(ts) {
  if (!ts) return "Not opened yet";
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return "Just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}
