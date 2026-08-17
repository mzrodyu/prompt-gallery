// scripts/bench.js — rough before/after perf check for the storage refactor.
// Seeds N gallery items, then measures the hot paths (a single "like", a list
// query) on SQLite vs. the old "rewrite the whole JSON file on every mutation".
const path = require("path");
const fs = require("fs");
const db = require(path.join(__dirname, "..", "db.js"));

const N = parseInt(process.argv[2] || "5000", 10);
const DATA_DIR = path.join(__dirname, "..", ".bench-data");
fs.rmSync(DATA_DIR, { recursive: true, force: true });

// ~50KB fake image data URL to approximate a real upload
const IMG = "data:image/png;base64," + "A".repeat(50 * 1024);

function ms(fn) {
  const t = process.hrtime.bigint();
  fn();
  return Number(process.hrtime.bigint() - t) / 1e6;
}

console.log(`Seeding ${N} items (~50KB image each)...`);
db.init(DATA_DIR);
const seedMs = ms(() => {
  for (let i = 0; i < N; i++) {
    db.insertGalleryItem({
      id: "bench" + i,
      userId: "u" + (i % 50),
      username: "user" + (i % 50),
      image: IMG,
      prompt: "prompt number " + i + " --niji 7",
      params: { version: i % 2 ? "niji 7" : "niji 6" },
      tags: ["tag" + (i % 20), "common"],
      category: ["cat" + (i % 10)],
      source: ["mj", "nai", "sd", "comfyui"][i % 4],
      rating: (i % 5) + 1,
      visibility: "public",
      createdAt: Date.now() + i,
    });
  }
});
console.log(`  seeded in ${seedMs.toFixed(0)} ms\n`);

// --- NEW: SQLite single-row like ---
const likeMs =
  ms(() => {
    for (let i = 0; i < 200; i++) db.toggleLike("bench" + i, "liker" + i);
  }) / 200;

// --- NEW: list query (filter + sort + paginate) ---
const listMs = ms(() => {
  for (let i = 0; i < 50; i++)
    db.listGallery({
      filter: "niji7",
      sort: "popular",
      q: "prompt",
      offset: i * 24,
      limit: 24,
      viewerRole: "admin",
    });
}) / 50;

// --- OLD: cost of ONE mutation under the old design (rewrite whole gallery.json
//     with all base64 images, pretty-printed) — this ran on every like/comment ---
const fakeGallery = [];
for (let i = 0; i < N; i++)
  fakeGallery.push({ id: "x" + i, image: IMG, prompt: "p" + i, likes: [] });
const oldFile = path.join(DATA_DIR, "old-gallery.json");
const oldSaveMs = ms(() => {
  fs.writeFileSync(oldFile, JSON.stringify(fakeGallery, null, 2), "utf-8");
});

const dbSize = fs.statSync(path.join(DATA_DIR, "gallery.db")).size;
const oldSize = fs.statSync(oldFile).size;

console.log("RESULTS (" + N + " items):");
console.log("  NEW  like (1 row, SQLite tx) : " + likeMs.toFixed(3) + " ms");
console.log("  NEW  gallery list query      : " + listMs.toFixed(3) + " ms");
console.log(
  "  OLD  one like = full rewrite : " +
    oldSaveMs.toFixed(1) +
    " ms  (blocks the event loop, every time)",
);
console.log(
  "  speedup on a single like     : ~" +
    (oldSaveMs / likeMs).toFixed(0) +
    "x",
);
console.log(
  "  db file: " +
    (dbSize / 1048576).toFixed(1) +
    " MB   old single JSON (metadata+images): " +
    (oldSize / 1048576).toFixed(1) +
    " MB",
);

fs.rmSync(DATA_DIR, { recursive: true, force: true });
