// scripts/shot.js — spin up the server and screenshot key screens for visual QA.
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const { chromium } = require("@playwright/test");

const PORT = 3211;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = path.join(__dirname, "..", ".shot-data");
const OUT = path.join(__dirname, "..", ".shots");
fs.rmSync(DATA_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const PNG =
  "data:image/svg+xml;base64," +
  Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1024"><rect width="100%" height="100%" fill="#ffd4e6"/><circle cx="360" cy="420" r="180" fill="#ff9cc2"/><rect y="720" width="720" height="304" fill="#ffe1ee"/></svg>',
  ).toString("base64");

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitServer() {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(BASE + "/api/public/settings")).ok) return;
    } catch {}
    await wait(250);
  }
  throw new Error("server not up");
}

(async () => {
  const server = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR, JWT_SECRET: "shot-secret-1234567890", ADMIN_USERNAME: "neko", ADMIN_PASSWORD: "neko1234" },
    stdio: ["ignore", "ignore", "inherit"],
  });
  try {
    await waitServer();
    const login = await (await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "neko", password: "neko1234" }) })).json();
    const token = login.token;
    const authH = { "Content-Type": "application/json", Authorization: "Bearer " + token };
    // create categories so the sub-row shows
    for (const name of ["少女", "少年", "群像"]) {
      await fetch(BASE + "/api/admin/categories", { method: "POST", headers: authH, body: JSON.stringify({ name }) });
    }
    const cats = ["少女", "少年", "群像"];
    // seed a few works so cards are visible
    for (let i = 0; i < 6; i++) {
      await fetch(BASE + "/api/gallery", { method: "POST", headers: authH, body: JSON.stringify({ image: PNG, prompt: "1girl, sakura, masterpiece\nbest quality", params: { model: "NAI Diffusion V4.5 (Full)", version: "niji 7" }, source: i % 2 ? "nai" : "mj", category: [cats[i % 3]], tags: ["sakura"], rating: (i % 5) + 1, visibility: "public", promptPublic: true }) });
    }
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(BASE + "/");
    await page.evaluate((t) => localStorage.setItem("mj_token", t), token);
    await page.reload();
    await wait(1500);
    await page.screenshot({ path: path.join(OUT, "gallery.png") });
    // gallery theme (should now look distinct: dark purple)
    await fetch(BASE + "/api/admin/settings", { method: "POST", headers: authH, body: JSON.stringify({ theme: "gallery" }) });
    await page.reload();
    await wait(1500);
    await page.screenshot({ path: path.join(OUT, "gallery-theme.png") });
    // back to default + upload a site background
    await fetch(BASE + "/api/admin/settings", { method: "POST", headers: authH, body: JSON.stringify({ theme: "default" }) });
    const BG = "data:image/svg+xml;base64," + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="900"><rect width="100%" height="100%" fill="#ffd9ea"/><circle cx="1100" cy="200" r="260" fill="#ffc0dc"/><circle cx="300" cy="760" r="200" fill="#ffb3d4"/></svg>').toString("base64");
    await fetch(BASE + "/api/admin/site-asset", { method: "POST", headers: authH, body: JSON.stringify({ type: "background", image: BG }) });
    await page.reload();
    await wait(1500);
    await page.screenshot({ path: path.join(OUT, "gallery-bg.png") });
    await browser.close();
    console.log("shots saved to", OUT);
  } catch (e) {
    console.error("SHOT ERROR:", e);
  } finally {
    server.kill();
  }
})();
