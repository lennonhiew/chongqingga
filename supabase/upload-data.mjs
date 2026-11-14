// One-off: copy the preview's places, photos, friends and settings into Supabase (no votes).
// usage: node supabase/upload-data.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8").replace(/^﻿/, ""));
const cfg = read("data/supabase-admin.json");
const s = read("data/db.json");
const sb = createClient(cfg.url, cfg.serviceKey, { auth: { persistSession: false } });
const ok = ({ error }) => { if (error) throw error; };

ok(await sb.from("cq_settings").upsert({ id: 1, data: s.settings }));
ok(await sb.from("cq_polls").upsert(s.polls.map((p, i) => ({ id: p.id, title: p.title, subtitle: p.subtitle || "", multi: !!p.multi, sort: i }))));
ok(await sb.from("cq_options").upsert(s.options.map((o, i) => ({
  id: o.id, poll_id: o.pollId, emoji: o.emoji || "📍", name: o.name, zh: o.zh || "", when: o.when || "day",
  price_cny: o.priceCny || 0, note: o.note || "", image: o.image || "", credit: o.credit || "", source: o.source || "", sort: i,
}))));
ok(await sb.from("cq_members").upsert(s.members.map((m) => ({ id: m.id, name: m.name }))));

for (const t of ["cq_polls", "cq_options", "cq_members", "cq_votes"]) {
  const { count } = await sb.from(t).select("*", { count: "exact", head: true });
  console.log(t, count);
}
