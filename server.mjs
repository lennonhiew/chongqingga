// Local preview backend: serves the friends' site (/) and the admin page (/admin/),
// keeps everything in data/db.json and pushes live updates over Server-Sent Events.
// After upload, the site talks to Supabase instead; this file is only for trying it out.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { seed } from "./seed.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DB_FILE = path.join(process.env.CQ_DATA_DIR || path.join(ROOT, "data"), "db.json");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".json": "application/json", ".webmanifest": "application/manifest+json" };

let db;
try { db = JSON.parse(fs.readFileSync(DB_FILE, "utf8")); } catch { db = seed(); }
applyPhotos();
save();

// Starter photos matched to places by name (site/img/credits.json).
function applyPhotos(target = db) {
  let credits = {};
  try { credits = JSON.parse(fs.readFileSync(path.join(ROOT, "site", "img", "credits.json"), "utf8")); } catch {}
  for (const o of target.options) {
    const c = credits[o.name];
    if (c && o.image === undefined) Object.assign(o, { image: c.image, credit: c.credit, source: c.source });
  }
}

function save() {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

const clients = new Set();
function changed() {
  save();
  const msg = `data: ${JSON.stringify(db)}\n\n`;
  for (const res of clients) res.write(msg);
}

const newId = (p) => p + crypto.randomBytes(4).toString("hex");
const clean = (s, max = 200) => String(s ?? "").trim().slice(0, max);

function join(name) {
  name = clean(name, 40);
  if (!name) throw new Error("Type your name first.");
  let m = db.members.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (!m) { m = { id: newId("m"), name, joinedAt: Date.now(), lastSeen: 0 }; db.members.push(m); }
  m.lastSeen = Date.now();
  return m;
}

function vote({ optionId, memberId, on }) {
  const opt = db.options.find((o) => o.id === optionId);
  const member = db.members.find((m) => m.id === memberId);
  if (!opt || !member) throw new Error("That place or person no longer exists.");
  const poll = db.polls.find((p) => p.id === opt.pollId);
  db.votes = db.votes.filter((v) => !(v.memberId === memberId && (v.optionId === optionId || (!poll.multi && v.pollId === poll.id && on))));
  if (on) db.votes.push({ pollId: poll.id, optionId, memberId, at: Date.now() });
  member.lastSeen = Date.now();
}

const adminActions = {
  savePoll(p) {
    const fields = { title: clean(p.title, 60), subtitle: clean(p.subtitle), multi: !!p.multi };
    if (!fields.title) throw new Error("Give the poll a title.");
    const found = db.polls.find((x) => x.id === p.id);
    if (found) Object.assign(found, fields); else db.polls.push({ id: newId("p"), ...fields });
  },
  deletePoll({ id }) {
    db.polls = db.polls.filter((p) => p.id !== id);
    db.options = db.options.filter((o) => o.pollId !== id);
    db.votes = db.votes.filter((v) => v.pollId !== id);
  },
  saveOption(o) {
    const fields = {
      pollId: o.pollId, emoji: clean(o.emoji, 8) || "📍", name: clean(o.name, 60), zh: clean(o.zh, 40),
      when: clean(o.when, 12) || "day", priceCny: Math.max(0, Number(o.priceCny) || 0), note: clean(o.note, 240),
      image: /^img\/[\w.-]+$/.test(o.image || "") ? o.image : "", credit: clean(o.credit, 120), source: clean(o.source, 300),
    };
    if (!fields.name) throw new Error("Give the place a name.");
    if (!db.polls.some((p) => p.id === fields.pollId)) throw new Error("Pick which poll it goes in.");
    const found = db.options.find((x) => x.id === o.id);
    if (found) {
      if (found.pollId !== fields.pollId) db.votes = db.votes.filter((v) => v.optionId !== found.id);
      Object.assign(found, fields);
    } else db.options.push({ id: newId("o"), ...fields });
  },
  deleteOption({ id }) {
    db.options = db.options.filter((o) => o.id !== id);
    db.votes = db.votes.filter((v) => v.optionId !== id);
  },
  moveOption({ id, dir }) {
    const i = db.options.findIndex((o) => o.id === id);
    const pollId = db.options[i].pollId;
    let j = i + dir;
    while (j >= 0 && j < db.options.length && db.options[j].pollId !== pollId) j += dir;
    if (j < 0 || j >= db.options.length) return;
    [db.options[i], db.options[j]] = [db.options[j], db.options[i]];
  },
  addMember({ name }) { join(name); },
  removeMember({ id }) {
    db.members = db.members.filter((m) => m.id !== id);
    db.votes = db.votes.filter((v) => v.memberId !== id);
  },
  saveSettings(s) {
    db.settings.tripName = clean(s.tripName, 40) || db.settings.tripName;
    db.settings.dates = clean(s.dates, 60);
    const r = Number(s.rmPerCny);
    if (r > 0 && r < 10) db.settings.rmPerCny = r;
  },
  clearVotes() { db.votes = []; },
  resetAll() { db = seed(); applyPhotos(); },
  // Photo picked in the admin app, already resized there. Saved into site/img.
  uploadImage({ dataUrl }) {
    const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || "");
    if (!m) throw new Error("That file isn't a JPG, PNG or WebP photo.");
    const buf = Buffer.from(m[2], "base64");
    if (buf.length > 4e6) throw new Error("Photo is too big (max 4 MB).");
    const file = `u-${crypto.randomBytes(5).toString("hex")}.${m[1] === "jpeg" ? "jpg" : m[1]}`;
    fs.writeFileSync(path.join(ROOT, "site", "img", file), buf);
    return { image: `img/${file}`, quiet: true };
  },
};

function body(req) {
  return new Promise((resolve, reject) => {
    let s = "";
    req.on("data", (c) => { s += c; if (s.length > 6e6) req.destroy(); });
    req.on("end", () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } });
  });
}

function send(res, code, obj) {
  res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(obj));
}

function isLocal(req) {
  const a = req.socket.remoteAddress || "";
  return a === "127.0.0.1" || a === "::1" || a === "::ffff:127.0.0.1";
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  try {
    if (url.pathname === "/api/state") return send(res, 200, db);
    // Admin app only: the Supabase service key lives in data/supabase-admin.json on this PC.
    if (url.pathname === "/api/admin-config.js") {
      let cfg = null;
      if (isLocal(req)) try { const c = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "supabase-admin.json"), "utf8").replace(/^﻿/, "")); cfg = { url: c.url, serviceKey: c.serviceKey }; } catch {}
      res.writeHead(200, { "content-type": "text/javascript", "cache-control": "no-store" });
      return res.end(`window.CQ_ADMIN = ${JSON.stringify(cfg)};`);
    }
    if (url.pathname === "/api/starter") { const s = seed(); applyPhotos(s); return send(res, 200, s); }
    if (url.pathname === "/api/events") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
      res.write(`data: ${JSON.stringify(db)}\n\n`);
      clients.add(res);
      const ping = setInterval(() => res.write(": ping\n\n"), 25000);
      req.on("close", () => { clients.delete(res); clearInterval(ping); });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/join") {
      const m = join((await body(req)).name); changed(); return send(res, 200, m);
    }
    if (req.method === "POST" && url.pathname === "/api/vote") {
      vote(await body(req)); changed(); return send(res, 200, { ok: true });
    }
    if (req.method === "POST" && url.pathname === "/api/admin") {
      if (!isLocal(req)) return send(res, 403, { error: "Admin only works on this PC." });
      const { action, payload } = await body(req);
      if (!adminActions[action]) return send(res, 400, { error: "Unknown action" });
      const result = adminActions[action](payload || {}) || {};
      if (!result.quiet) changed();
      return send(res, 200, { ok: true, ...result });
    }

    // Static files: / -> site, /admin/ -> admin
    let rel = url.pathname === "/" ? "/site/index.html" : url.pathname;
    if (rel === "/admin" || rel === "/admin/") rel = "/admin/index.html";
    if (!rel.startsWith("/site/") && !rel.startsWith("/admin/")) rel = "/site" + rel;
    const file = path.join(ROOT, path.normalize(rel));
    if (!file.startsWith(path.join(ROOT, "site")) && !file.startsWith(path.join(ROOT, "admin"))) return send(res, 404, {});
    fs.readFile(file, (err, data) => {
      if (err) return send(res, 404, { error: "Not found" });
      res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream", "cache-control": "no-store" });
      res.end(data);
    });
  } catch (e) {
    send(res, 400, { error: e.message || "Something went wrong." });
  }
});

export const PORT = Number(process.env.PORT) || 5197;
export const ready = new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(PORT, process.env.HOST || "127.0.0.1", () => { console.log(`Chongqingga preview on http://localhost:${PORT}  (admin: /admin/)`); resolve(PORT); });
});
