// The one place that talks to the backend.
// Live: Supabase (friends use the public anon key; the admin app passes its service key in window.CQ_ADMIN).
// Preview: the local server (add ?local to the URL, or run without a config).
import { CONFIG } from "./config.js";

const ADMIN = window.CQ_ADMIN || null; // { url, serviceKey } — only set inside the admin app
const useLocal = !ADMIN && (new URLSearchParams(location.search).has("local") || !CONFIG.supabaseUrl || !window.supabase);
const sb = useLocal ? null : window.supabase.createClient(ADMIN?.url || CONFIG.supabaseUrl, ADMIN?.serviceKey || CONFIG.anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export const isLive = !useLocal;
export const friendsUrl = useLocal ? location.origin + "/?local" : CONFIG.siteUrl;
export const imgSrc = (image) => (!image ? "" : /^https?:/.test(image) ? image : (ADMIN || useLocal ? "/" : "") + image);

// ---------- Local preview server ----------
async function post(path, data) {
  const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "Couldn't reach the server.");
  return j;
}

// ---------- Supabase ----------
const ok = ({ data, error }) => {
  if (error) throw new Error(friendly(error.message));
  return data;
};
const friendly = (m) => (/fetch|network/i.test(m) ? "No connection. Check your internet and try again." : m);
const ts = (v) => (v ? Date.parse(v) : 0);

async function loadState() {
  const [settings, polls, options, members, votes] = await Promise.all([
    sb.from("cq_settings").select("data").eq("id", 1).maybeSingle().then(ok),
    sb.from("cq_polls").select("*").order("sort").then(ok),
    sb.from("cq_options").select("*").order("sort").then(ok),
    sb.from("cq_members").select("*").order("joined_at").then(ok),
    sb.from("cq_votes").select("*").order("at").then(ok),
  ]);
  return {
    settings: settings?.data || {},
    polls: polls.map((p) => ({ id: p.id, title: p.title, subtitle: p.subtitle, multi: p.multi, sort: p.sort })),
    options: options.map((o) => ({
      id: o.id, pollId: o.poll_id, emoji: o.emoji, name: o.name, zh: o.zh, when: o.when, priceCny: Number(o.price_cny),
      note: o.note, image: o.image, credit: o.credit, source: o.source, sort: o.sort,
    })),
    members: members.map((m) => ({ id: m.id, name: m.name, joinedAt: ts(m.joined_at), lastSeen: ts(m.last_seen) })),
    votes: votes.map((v) => ({ pollId: v.poll_id, optionId: v.option_id, memberId: v.member_id, at: ts(v.at) })),
  };
}

const memberOut = (m) => ({ id: m.id, name: m.name, joinedAt: ts(m.joined_at), lastSeen: ts(m.last_seen) });

// ---------- Public API (same for both backends) ----------
export const getState = () => (useLocal ? fetch("/api/state", { cache: "no-store" }).then((r) => r.json()) : loadState());

export async function join(name) {
  if (useLocal) return post("/api/join", { name });
  return memberOut(ok(await sb.rpc("cq_join", { p_name: name })));
}

export async function vote(optionId, memberId, on) {
  if (useLocal) return post("/api/vote", { optionId, memberId, on });
  ok(await sb.rpc("cq_vote", { p_option: optionId, p_member: memberId, p_on: on }));
}

// Calls onState with every new snapshot; keeps itself up to date.
export function subscribe(onState, onStatus = () => {}) {
  if (useLocal) {
    const es = new EventSource("/api/events");
    es.onopen = () => onStatus(true);
    es.onmessage = (e) => onState(JSON.parse(e.data));
    es.onerror = () => onStatus(false);
    return () => es.close();
  }
  let timer = null, busy = false, again = false;
  const refresh = async () => {
    if (busy) { again = true; return; }
    busy = true;
    try { onState(await loadState()); onStatus(true); } catch { onStatus(false); }
    busy = false;
    if (again) { again = false; refresh(); }
  };
  const soon = () => { clearTimeout(timer); timer = setTimeout(refresh, 120); };
  const ch = sb.channel("cq-" + Math.random().toString(36).slice(2));
  for (const table of ["cq_settings", "cq_polls", "cq_options", "cq_members", "cq_votes"]) {
    ch.on("postgres_changes", { event: "*", schema: "public", table }, soon);
  }
  ch.subscribe((status) => {
    if (status === "SUBSCRIBED") refresh();
    else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") onStatus(false);
  });
  refresh();
  const poll = setInterval(refresh, 30000); // safety net if live updates drop
  const onVis = () => document.visibilityState === "visible" && refresh();
  document.addEventListener("visibilitychange", onVis);
  return () => { clearInterval(poll); document.removeEventListener("visibilitychange", onVis); sb.removeChannel(ch); };
}

// ---------- Admin (only works with the service key, or on the local preview server) ----------
const newId = (p) => p + Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, "0")).join("");
const clean = (s, max = 200) => String(s ?? "").trim().slice(0, max);
const nextSort = async (table, col, val) => {
  let q = sb.from(table).select("sort").order("sort", { ascending: false }).limit(1);
  if (col) q = q.eq(col, val);
  const rows = ok(await q);
  return (rows[0]?.sort ?? -1) + 1;
};

const adminActions = {
  async savePoll(p) {
    const row = { title: clean(p.title, 60), subtitle: clean(p.subtitle), multi: !!p.multi };
    if (!row.title) throw new Error("Give the poll a title.");
    if (p.id) ok(await sb.from("cq_polls").update(row).eq("id", p.id));
    else ok(await sb.from("cq_polls").insert({ id: newId("p"), sort: await nextSort("cq_polls"), ...row }));
  },
  async deletePoll({ id }) { ok(await sb.from("cq_polls").delete().eq("id", id)); },
  async saveOption(o) {
    const row = {
      poll_id: o.pollId, emoji: clean(o.emoji, 8) || "📍", name: clean(o.name, 60), zh: clean(o.zh, 40),
      when: clean(o.when, 12) || "day", price_cny: Math.max(0, Number(o.priceCny) || 0), note: clean(o.note, 240),
      image: clean(o.image, 400), credit: clean(o.credit, 120), source: clean(o.source, 300),
    };
    if (!row.name) throw new Error("Give the place a name.");
    if (!row.poll_id) throw new Error("Pick which poll it goes in.");
    if (o.id) {
      const before = ok(await sb.from("cq_options").select("poll_id").eq("id", o.id).maybeSingle());
      if (before && before.poll_id !== row.poll_id) {
        ok(await sb.from("cq_votes").delete().eq("option_id", o.id));
        row.sort = await nextSort("cq_options", "poll_id", row.poll_id);
      }
      ok(await sb.from("cq_options").update(row).eq("id", o.id));
    } else {
      ok(await sb.from("cq_options").insert({ id: newId("o"), sort: await nextSort("cq_options", "poll_id", row.poll_id), ...row }));
    }
  },
  async deleteOption({ id }) { ok(await sb.from("cq_options").delete().eq("id", id)); },
  async moveOption({ id, dir }) {
    const me = ok(await sb.from("cq_options").select("id,poll_id,sort").eq("id", id).single());
    const list = ok(await sb.from("cq_options").select("id,sort").eq("poll_id", me.poll_id).order("sort"));
    const i = list.findIndex((x) => x.id === id), j = i + dir;
    if (j < 0 || j >= list.length) return;
    // renumber so swaps always work even if sorts collide
    [list[i], list[j]] = [list[j], list[i]];
    await Promise.all(list.map((x, k) => sb.from("cq_options").update({ sort: k }).eq("id", x.id).then(ok)));
  },
  async addMember({ name }) {
    const n = clean(name, 40);
    if (!n) throw new Error("Type a name first.");
    const exists = ok(await sb.from("cq_members").select("id").ilike("name", n.replace(/[%_]/g, "\\$&")));
    if (exists.length) throw new Error(`${n} is already on the list.`);
    ok(await sb.from("cq_members").insert({ id: newId("m"), name: n }));
  },
  async removeMember({ id }) { ok(await sb.from("cq_members").delete().eq("id", id)); },
  async saveSettings(s) {
    const cur = ok(await sb.from("cq_settings").select("data").eq("id", 1).maybeSingle())?.data || {};
    const r = Number(s.rmPerCny);
    const data = { ...cur, tripName: clean(s.tripName, 40) || cur.tripName, dates: clean(s.dates, 60), rmPerCny: r > 0 && r < 10 ? r : cur.rmPerCny };
    ok(await sb.from("cq_settings").upsert({ id: 1, data }));
  },
  async clearVotes() { ok(await sb.from("cq_votes").delete().neq("option_id", "")); },
  async resetAll() {
    const start = await (await fetch("/api/starter")).json();
    ok(await sb.from("cq_votes").delete().neq("option_id", ""));
    ok(await sb.from("cq_options").delete().neq("id", ""));
    ok(await sb.from("cq_polls").delete().neq("id", ""));
    ok(await sb.from("cq_members").delete().neq("id", ""));
    await importState(start);
  },
  async uploadImage({ dataUrl }) {
    const m = /^data:(image\/(jpeg|png|webp));base64,(.+)$/.exec(dataUrl || "");
    if (!m) throw new Error("That file isn't a JPG, PNG or WebP photo.");
    const bytes = Uint8Array.from(atob(m[3]), (c) => c.charCodeAt(0));
    const path = `${newId("u")}.${m[2] === "jpeg" ? "jpg" : m[2]}`;
    ok(await sb.storage.from("cq-photos").upload(path, bytes, { contentType: m[1], cacheControl: "31536000" }));
    return { image: sb.storage.from("cq-photos").getPublicUrl(path).data.publicUrl };
  },
};

// Writes a whole state snapshot (settings, polls, places, friends) into Supabase.
export async function importState(s) {
  ok(await sb.from("cq_settings").upsert({ id: 1, data: s.settings }));
  ok(await sb.from("cq_polls").upsert(s.polls.map((p, i) => ({ id: p.id, title: p.title, subtitle: p.subtitle || "", multi: !!p.multi, sort: i }))));
  ok(await sb.from("cq_options").upsert(s.options.map((o, i) => ({
    id: o.id, poll_id: o.pollId, emoji: o.emoji || "📍", name: o.name, zh: o.zh || "", when: o.when || "day",
    price_cny: o.priceCny || 0, note: o.note || "", image: o.image || "", credit: o.credit || "", source: o.source || "", sort: i,
  }))));
  ok(await sb.from("cq_members").upsert(s.members.map((m) => ({ id: m.id, name: m.name }))));
}

export async function admin(action, payload) {
  if (useLocal) return post("/api/admin", { action, payload });
  if (!adminActions[action]) throw new Error("Unknown action");
  return (await adminActions[action](payload || {})) || {};
}
