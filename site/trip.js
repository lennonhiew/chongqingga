// Trip clock + geography: turns the plan into a timeline per group, finds "now" and "next",
// estimates travel between stops and builds Amap links. All plan times are China time (UTC+8, same as KL).
export const TZ = "Asia/Shanghai";
const OFFSET = 8 * 3600e3;

// ?now=2026-12-30T18:10 previews the site at that moment (the clock keeps running from there).
const fake = new URLSearchParams(location.search).get("now");
const skew = fake && !isNaN(Date.parse(fake + "+08:00")) ? Date.parse(fake.length <= 16 ? fake + ":00+08:00" : fake + "+08:00") - Date.now() : 0;
export const now = () => Date.now() + skew;

export const at = (date, hhmm = "00:00") => Date.parse(`${date}T${hhmm}:00+08:00`);
export const dateOf = (ms) => new Date(ms + OFFSET).toISOString().slice(0, 10);
export const addDays = (date, n) => dateOf(at(date) + n * 86400e3);
const two = (n) => String(n).padStart(2, "0");
export const hhmm = (ms) => { const d = new Date(ms + OFFSET); return `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`; };

const fmtCache = {};
export function fmt(ms, opts) {
  const k = JSON.stringify(opts);
  return (fmtCache[k] ||= new Intl.DateTimeFormat("en-GB", { timeZone: TZ, ...opts })).format(ms);
}

// "Morning" etc. still work if someone types a word instead of a time.
const WORDS = { breakfast: "08:00", "all day": "08:00", morning: "09:00", lunch: "12:30", afternoon: "14:00", sunset: "17:30", evening: "18:30", dinner: "19:00", night: "20:00", "late night": "22:30" };
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
export function startOf(time = "", date) {
  const t = time.trim().toLowerCase();
  let m = t.match(/^(\d{1,2})[:.](\d{2})/);
  if (m) return at(date, `${two(+m[1])}:${m[2]}`);
  m = t.match(/^(\d{1,2})\s+([a-z]{3})/); // "23 Dec" inside a several-day block
  if (m && MONTHS.includes(m[2])) {
    let y = +date.slice(0, 4);
    if (MONTHS.indexOf(m[2]) + 1 < +date.slice(5, 7)) y++;
    return at(`${y}-${two(MONTHS.indexOf(m[2]) + 1)}-${two(+m[1])}`, "09:00");
  }
  if (WORDS[t]) return at(date, WORDS[t]);
  return null;
}

export const forGroup = (gs, g) => !g || !gs || !gs.length || gs.includes("all") || gs.includes(g.id);
export const groupOf = (plan, me) => (me ? (plan?.groups || []).find((g) => g.members.some((n) => n.toLowerCase() === me.name.toLowerCase())) : null) || null;

// Everything a group does, in order, with start/end times and a map pin when known.
export function timeline(plan, state, g) {
  const out = [];
  const days = (plan?.days || []).slice().sort((a, b) => a.date.localeCompare(b.date));
  for (const d of days) {
    if (!forGroup(d.groups, g)) continue;
    let last = at(d.date, "08:00");
    (d.items || []).forEach((it, i) => {
      if (!forGroup(it.groups, g)) return;
      const opt = it.optionId ? state.options.find((o) => o.id === it.optionId) : null;
      const start = startOf(it.time, d.date) ?? last + 60e3;
      last = start;
      out.push({
        key: `${d.date}#${i}`, day: d, item: it, start, end: null, opt, kind: it.kind, range: !!d.endDate,
        title: it.text || opt?.name || "",
        zh: opt?.zh || it.zh || "",
        geo: it.at || (it.optionId && plan.geo?.[it.optionId]) || null,
        exit: it.exit || null, // where a ride (cable car) drops you; the next leg starts here
      });
    });
  }
  out.sort((a, b) => a.start - b.start);
  const trips = plan?.trips || [];
  out.forEach((e, i) => {
    const next = out[i + 1]?.start ?? Infinity;
    if (e.kind === "flight" || e.kind === "train") {
      const t = trips.find((t) => t.kind === e.kind && t.date === e.day.date && forGroup(t.groups, g) && t.dep === hhmm(e.start));
      if (t?.arr) { e.trip = t; e.end = at(addDays(t.date, t.plusDays || 0), t.arr); return; }
    }
    // A thing lasts until the next thing, but at most 3 hours (several-day blocks: until the next thing).
    e.end = Math.min(next, e.range ? next : e.start + 3 * 3600e3);
    if (!isFinite(e.end)) e.end = e.start + 3 * 3600e3;
  });
  return out;
}

// Where a group is in the trip at time t.
export function status(plan, state, g, t = now()) {
  const trips = (plan?.trips || []).filter((x) => forGroup(x.groups, g)).sort((a, b) => (a.date + a.dep).localeCompare(b.date + b.dep));
  if (!trips.length) return { phase: "none" };
  const first = trips[0], last = trips[trips.length - 1];
  const start = at(first.date, first.dep);
  const end = at(addDays(last.date, last.plusDays || 0), last.arr || "23:59");
  const events = timeline(plan, state, g);
  const base = { start, end, first, last, events, days: Math.round((at(dateOf(end)) - at(first.date)) / 86400e3) + 1 };
  if (t < start) return { ...base, phase: "before", left: start - t };
  if (t >= end) return { ...base, phase: "after" };
  const dayN = Math.round((at(dateOf(t)) - at(first.date)) / 86400e3) + 1;
  let cur = null, next = null;
  for (const e of events) {
    if (e.start <= t) cur = e;
    else { next = e; break; }
  }
  const nowE = cur && t < cur.end ? cur : null;
  const hour = +hhmm(t).slice(0, 2);
  return { ...base, phase: "during", dayN, now: nowE, prev: cur, next, idle: nowE ? null : hour < 7 ? "Sleeping, probably" : "Free time" };
}

// ---------- Distances and travel estimates ----------
export function km([la1, lo1], [la2, lo2]) {
  const r = Math.PI / 180, dLa = (la2 - la1) * r, dLo = (lo2 - lo1) * r;
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(dLo / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}
const round5 = (m) => Math.max(5, Math.round(m / 5) * 5);
// Rough door-to-door guesses for hilly Chongqing / flat Chengdu. Amap has the real ones.
// Metro = walk to the station + wait + ride; short hops still get a number so every option shows.
export function legs(a, b) {
  const d = km(a, b), road = d * 1.4;
  return {
    km: d,
    walk: road <= 12 ? round5((road / 4.5) * 60) : null,
    metro: d <= 60 ? round5(12 + (road / 30) * 60) : null,
    car: round5(5 + (road / (d > 20 ? 60 : 22)) * 60),
  };
}
export const fastest = (l) => ["walk", "metro", "car"].filter((k) => l[k] != null).sort((x, y) => l[x] - l[y])[0];

// Chinese first: 洪崖洞 big, Hongyadong small.
export const names = (e) => (e.zh ? { main: e.zh, sub: e.title } : { main: e.title, sub: "" });

// ---------- Hotels: plan.hotels = [{ name, zh, at: [lat, lng], from, to, groups }] (from = check-in, to = check-out) ----------
export const hotels = (plan, g) => (plan?.hotels || []).filter((x) => x.at && forGroup(x.groups, g));
// Where you sleep on the night of `date`, and where you woke up that morning.
export const hotelNight = (plan, g, date) => hotels(plan, g).find((x) => x.from <= date && date < x.to) || null;
export const hotelMorning = (plan, g, date) => hotels(plan, g).find((x) => x.from < date && date <= x.to) || null;
export const mins = (m) => (m == null ? "–" : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? " " + (m % 60) : ""}`);
export const dist = (d) => (d < 1 ? `${Math.round(d * 100) * 10} m` : `${d < 10 ? d.toFixed(1) : Math.round(d)} km`);

// Opens the Amap app (or amap.com) with directions from wherever you are. Pins are in Amap's own coordinates.
export const amapUrl = (geo, name, mode = "car") =>
  `https://uri.amap.com/navigation?to=${geo[1]},${geo[0]},${encodeURIComponent(name)}&mode=${mode}&coordinate=gaode&callnative=1&src=chongqingga`;
export const amapPin = (geo, name) => `https://uri.amap.com/marker?position=${geo[1]},${geo[0]}&name=${encodeURIComponent(name)}&coordinate=gaode&callnative=1&src=chongqingga`;

// Phones give GPS (WGS-84) positions; Amap's map is shifted (GCJ-02). Same published transform Amap uses.
export function wgs2gcj(lat, lng) {
  const A = 6378245.0, EE = 0.00669342162296594323, x = lng - 105, y = lat - 35;
  const s = (v) => Math.sin(v * Math.PI);
  let dLat = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x)) + ((20 * s(6 * x) + 20 * s(2 * x)) * 2) / 3 + ((20 * s(y) + 40 * s(y / 3)) * 2) / 3 + ((160 * s(y / 12) + 320 * s(y / 30)) * 2) / 3;
  let dLng = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x)) + ((20 * s(6 * x) + 20 * s(2 * x)) * 2) / 3 + ((20 * s(x) + 40 * s(x / 3)) * 2) / 3 + ((150 * s(x / 12) + 300 * s(x / 30)) * 2) / 3;
  const rad = (lat / 180) * Math.PI, m = 1 - EE * Math.sin(rad) ** 2, sm = Math.sqrt(m);
  dLat = (dLat * 180) / (((A * (1 - EE)) / (m * sm)) * Math.PI);
  dLng = (dLng * 180) / ((A / sm) * Math.cos(rad) * Math.PI);
  return [lat + dLat, lng + dLng];
}

// ---------- Weather (Open-Meteo, no key) ----------
const CITIES = { Chongqing: [29.56, 106.55], Chengdu: [30.66, 104.07], Hangzhou: [30.27, 120.15], Wenzhou: [28.0, 120.67] };
export const CLIMATE = "Late December is cold and damp: Chongqing 6–11°C, Chengdu 3–10°C, Zhejiang 3–11°C. Bring layers";
export const cityFor = (s = "") => (/chengdu/i.test(s) && !/^chongqing/i.test(s) ? "Chengdu" : /chongqing/i.test(s) ? "Chongqing" : /wenzhou/i.test(s) ? "Wenzhou" : /hangzhou|zhejiang|camp|yiwu/i.test(s) ? "Hangzhou" : null);
// Weather code -> icon name in icons.js
const ICON = (c) => (c === 0 ? "sun" : c <= 2 ? "partly" : c === 3 ? "cloud" : c <= 48 ? "fog" : c <= 67 || (c >= 80 && c <= 82) ? "rain" : c <= 77 || (c >= 85 && c <= 86) ? "snow" : "storm");
let weatherP = null;
export function weather() {
  if (weatherP) return weatherP;
  const KEY = "cq-weather2";
  try { const c = JSON.parse(localStorage.getItem(KEY)); if (c && Date.now() - c.at < 3 * 3600e3) return (weatherP = Promise.resolve(c.data)); } catch {}
  const cities = Object.keys(CITIES);
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${cities.map((n) => CITIES[n][0]).join(",")}&longitude=${cities.map((n) => CITIES[n][1]).join(",")}&daily=weather_code,temperature_2m_max,temperature_2m_min&current=temperature_2m,weather_code&timezone=Asia%2FShanghai&forecast_days=16`;
  weatherP = fetch(url).then((r) => r.json()).then((j) => {
    const data = {};
    [].concat(j).forEach((c, i) => {
      const days = {};
      c.daily.time.forEach((d, k) => (days[d] = { icon: ICON(c.daily.weather_code[k]), hi: Math.round(c.daily.temperature_2m_max[k]), lo: Math.round(c.daily.temperature_2m_min[k]) }));
      data[cities[i]] = { days, now: { icon: ICON(c.current.weather_code), t: Math.round(c.current.temperature_2m) } };
    });
    try { localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), data })); } catch {}
    return data;
  }).catch(() => (weatherP = null, {}));
  return weatherP;
}

// ---------- Calendar file ----------
const icsTime = (ms) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
const esc = (s = "") => String(s).replace(/[\\;,]/g, (c) => "\\" + c).replace(/\n/g, "\\n");
export function ics(events, tripName) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Chongqingga//Trip//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${esc(tripName)}`];
  for (const e of events) {
    if (e.range) continue;
    lines.push("BEGIN:VEVENT", `UID:${e.key.replace("#", "-")}@chongqingga`, `DTSTAMP:${icsTime(Date.now())}`, `DTSTART:${icsTime(e.start)}`, `DTEND:${icsTime(Math.max(e.end, e.start + 30 * 60e3))}`,
      `SUMMARY:${esc(e.zh ? `${e.zh} ${e.title}` : e.title)}`, `DESCRIPTION:${esc(`${e.day.city}. ${e.day.title}`)}`);
    if (e.geo) lines.push(`LOCATION:${esc(e.opt?.zh || e.title)}`);
    lines.push("BEGIN:VALARM", "TRIGGER:-PT30M", "ACTION:DISPLAY", `DESCRIPTION:${esc(e.title)}`, "END:VALARM", "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}
