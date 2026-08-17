// scripts/smoke.js — end-to-end API contract check against a live server.
// Spawns server.js on a throwaway DATA_DIR, exercises the full request surface,
// asserts response shapes match the frontend contract, then exits non-zero on failure.
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const PORT = 3199;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = path.join(__dirname, "..", ".smoke-data");

fs.rmSync(DATA_DIR, { recursive: true, force: true });

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) {
    pass++;
    console.log("  ✓ " + msg);
  } else {
    fail++;
    console.log("  ✗ " + msg);
  }
}

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

async function req(method, url, { token, body, raw } = {}) {
  const headers = {};
  if (token) headers.Authorization = "Bearer " + token;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(BASE + url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (raw) return res;
  let data = null;
  try {
    data = await res.json();
  } catch {}
  return { status: res.status, data, headers: res.headers };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(BASE + "/api/public/settings");
      if (r.ok) return true;
    } catch {}
    await wait(250);
  }
  throw new Error("server did not start");
}

// __APPEND_MARKER__

async function run() {
  // register first user -> becomes admin
  let r = await req("POST", "/api/auth/register", {
    body: { username: "smokeadmin", password: "pass123" },
  });
  ok(r.status === 200 && typeof r.data.token === "string", "register returns token");
  ok(r.data.user && r.data.user.role === "admin", "first user is admin");
  const token = r.data.token;

  // upload 2 images
  const ids = [];
  for (let i = 0; i < 2; i++) {
    r = await req("POST", "/api/gallery", {
      token,
      body: {
        image: PNG,
        prompt: `smoke prompt ${i} --niji 7`,
        params: { version: "niji 7", ar: "16:9" },
        tags: ["smoke", "t" + i],
        source: "mj",
        category: ["测试分类"],
        promptPublic: true,
        rating: 5,
        visibility: "public",
      },
    });
    ok(r.status === 200 && r.data.id, `upload #${i} ok`);
    ids.push(r.data.id);
  }

  // list + X-Total-Count
  r = await req("GET", "/api/gallery?limit=24&offset=0&sort=newest", { token });
  ok(Array.isArray(r.data), "gallery list is an array");
  ok(r.headers.get("x-total-count") === "2", "X-Total-Count = 2");
  ok(r.data.length === 2, "list returns 2 items");
  ok(r.data[0].hasImage === true, "item has hasImage flag");

  // image endpoint returns { image }
  r = await req("GET", `/api/gallery/${ids[0]}/image`, { token });
  ok(r.status === 200 && r.data.image === PNG, "image endpoint returns { image } data URL");

  // like
  r = await req("POST", `/api/gallery/${ids[0]}/like`, { token });
  ok(r.status === 200 && r.data.liked === true && r.data.likeCount === 1, "like toggles on");
  r = await req("GET", "/api/gallery?limit=24&offset=0", { token });
  const liked = r.data.find((x) => x.id === ids[0]);
  ok(liked && liked.liked === true && liked.likeCount === 1, "list reflects liked state");

  // filters
  r = await req("GET", "/api/gallery?filter=niji7&limit=24", { token });
  ok(r.data.length === 2, "filter niji7 -> 2");
  r = await req("GET", "/api/gallery?filter=nai&limit=24", { token });
  ok(r.data.length === 0, "filter nai -> 0");
  r = await req("GET", "/api/gallery?filter=测试分类&limit=24", { token });
  ok(r.data.length === 2, "filter by custom category -> 2");
  r = await req("GET", "/api/gallery?q=smoke&limit=24", { token });
  ok(r.data.length === 2, "search q=smoke -> 2");

  // comment
  r = await req("POST", `/api/gallery/${ids[0]}/comments`, { token, body: { content: "nice work" } });
  ok(r.status === 200 && r.data.id, "post comment ok");
  r = await req("GET", `/api/gallery/${ids[0]}/comments`, { token });
  ok(Array.isArray(r.data) && r.data.length === 1 && r.data[0].content === "nice work", "list comments ok");

  // categories / tags
  r = await req("POST", "/api/admin/categories", { token, body: { name: "风景" } });
  ok(r.status === 200 && r.data.id, "create category ok");
  // registering the category name used on uploads should then report its usage count
  r = await req("POST", "/api/admin/categories", { token, body: { name: "测试分类" } });
  ok(r.status === 200, "create used category ok");
  r = await req("GET", "/api/categories", { token });
  ok(
    Array.isArray(r.data) && r.data.some((c) => c.name === "测试分类" && c.count === 2),
    "category count reflects gallery",
  );
  r = await req("POST", "/api/admin/tags", { token, body: { name: "smoke" } });
  ok(r.status === 200, "create tag ok");
  r = await req("GET", "/api/tags", { token });
  ok(r.data.some((t) => t.name === "smoke" && t.count === 2), "tag count reflects gallery");

  // edit
  r = await req("PUT", `/api/gallery/${ids[1]}`, { token, body: { prompt: "edited", rating: 2 } });
  ok(r.status === 200 && r.data.ok, "edit item ok");

  // admin stats (likes must be real, not 0)
  r = await req("GET", "/api/admin/stats", { token });
  ok(r.data.users === 1 && r.data.works === 2 && r.data.likes === 1, "admin stats correct (likes != 0)");

  // delete + image file removed
  r = await req("DELETE", `/api/gallery/${ids[0]}`, { token });
  ok(r.status === 200 && r.data.ok, "delete item ok");
  const imgFile = path.join(DATA_DIR, "images", ids[0]);
  ok(!fs.existsSync(imgFile), "image file removed on delete");
  r = await req("GET", "/api/gallery?limit=24", { token });
  ok(r.data.length === 1, "gallery has 1 after delete");
  ok(fs.existsSync(path.join(DATA_DIR, "gallery.db")), "SQLite db file exists");
}

(async () => {
  const server = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR, JWT_SECRET: "smoke-secret-please-change-123456" },
    stdio: ["ignore", "ignore", "inherit"],
  });
  let code = 0;
  try {
    await waitForServer();
    await run();
  } catch (e) {
    console.error("SMOKE ERROR:", e);
    fail++;
  } finally {
    server.kill();
  }
  console.log(`\nSMOKE RESULT: ${pass} passed, ${fail} failed`);
  code = fail === 0 ? 0 : 1;
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  process.exit(code);
})();

