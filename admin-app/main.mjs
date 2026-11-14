// Chongqingga Admin: a desktop window around the admin page.
// Preview mode: it also runs the local server, so friends' page works at http://localhost:5178/.
import { app, BrowserWindow, nativeTheme, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
process.env.CQ_DATA_DIR ||= path.join(ROOT, "data");
app.setPath("userData", path.join(ROOT, "data", "electron")); // keep everything next to the app

if (!app.requestSingleInstanceLock()) app.quit();

let win;

// --make-icon: render site/icon.svg to admin-app/icon.png + icon.ico (PNG-in-ICO)
async function makeIcon() {
  const fs = await import("node:fs");
  const w = new BrowserWindow({ width: 256, height: 256, show: false, frame: false, transparent: true, useContentSize: true, webPreferences: { offscreen: true } });
  const svg = fs.readFileSync(path.join(ROOT, "site", "icon.svg"), "utf8");
  await w.loadURL("data:text/html," + encodeURIComponent(`<body style="margin:0;background:transparent">${svg.replace("<svg ", '<svg width="256" height="256" ')}</body>`));
  await new Promise((r) => setTimeout(r, 400));
  const png = (await w.webContents.capturePage({ x: 0, y: 0, width: 256, height: 256 })).resize({ width: 256, height: 256 }).toPNG();
  fs.writeFileSync(path.join(ROOT, "admin-app", "icon.png"), png);
  const head = Buffer.alloc(22);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4);
  head.writeUInt8(0, 6); head.writeUInt8(0, 7); head.writeUInt16LE(1, 10); head.writeUInt16LE(32, 12);
  head.writeUInt32LE(png.length, 14); head.writeUInt32LE(22, 18);
  fs.writeFileSync(path.join(ROOT, "admin-app", "icon.ico"), Buffer.concat([head, png]));
  app.quit();
}

async function start() {
  if (process.argv.includes("--make-icon")) return makeIcon();
  const { ready, PORT } = await import("../server.mjs");
  await ready.catch(() => {}); // already running elsewhere is fine
  const dark = nativeTheme.shouldUseDarkColors;
  const shot = process.argv.find((a) => a.startsWith("--shot="));
  win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    title: "Chongqingga Admin",
    icon: path.join(ROOT, "admin-app", "icon.png"),
    backgroundColor: dark ? "#000000" : "#f5f5f7",
    titleBarStyle: "hidden",
    titleBarOverlay: { color: "#00000000", symbolColor: dark ? "#f5f5f7" : "#1d1d1f", height: 40 },
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, offscreen: !!shot },
  });
  // --shot=file.png self-test renders offscreen (no window, no focus), saves a PNG and quits
  if (!shot) win.once("ready-to-show", () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
  nativeTheme.on("updated", () => win.setTitleBarOverlay({ color: "#00000000", symbolColor: nativeTheme.shouldUseDarkColors ? "#f5f5f7" : "#1d1d1f", height: 40 }));
  await win.loadURL(`http://127.0.0.1:${PORT}/admin/`).catch((e) => console.error(e));

  if (shot) {
    await new Promise((r) => setTimeout(r, 2500));
    const img = await win.webContents.capturePage();
    (await import("node:fs")).writeFileSync(shot.slice(7), img.toPNG());
    app.quit();
  }
}

app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(start);
app.on("window-all-closed", () => app.quit());
