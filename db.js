// db.js — SQLite storage layer for MJ Gallery.
// Uses Node's built-in node:sqlite (no native compilation needed; requires Node >= 22.5).
// All SQL lives here so the driver is swappable (e.g. to better-sqlite3) in one place.
const { DatabaseSync } = require("node:sqlite");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

let db = null;
let DATA_DIR = null;
let IMAGES_DIR = null;

function createId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return crypto.randomBytes(16).toString("hex");
}

// node:sqlite cannot bind booleans/undefined — coerce.
const b2i = (v) => (v ? 1 : 0);
const orNull = (v) => (v === undefined ? null : v);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, username TEXT NOT NULL, role TEXT DEFAULT 'user',
  approved INTEGER DEFAULT 0, password TEXT, referral TEXT DEFAULT '',
  note TEXT DEFAULT '', title TEXT DEFAULT '', avatar TEXT,
  rejectReason TEXT DEFAULT '', reapplyLimit INTEGER DEFAULT 0,
  reapplyCount INTEGER DEFAULT 0, reapplyReason TEXT DEFAULT '',
  profileVisibility TEXT DEFAULT 'public', createdAt INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_name ON users(username COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS gallery (
  id TEXT PRIMARY KEY, userId TEXT, username TEXT, prompt TEXT DEFAULT '',
  params TEXT DEFAULT '{}', note TEXT DEFAULT '', source TEXT DEFAULT '',
  version TEXT DEFAULT '', promptPublic INTEGER DEFAULT 0, rating INTEGER DEFAULT 3,
  visibility TEXT DEFAULT 'users', likeCount INTEGER DEFAULT 0,
  tagsJson TEXT DEFAULT '[]', categoryJson TEXT DEFAULT '[]', createdAt INTEGER
);
CREATE INDEX IF NOT EXISTS idx_gallery_created ON gallery(createdAt);
CREATE INDEX IF NOT EXISTS idx_gallery_user ON gallery(userId, createdAt);
CREATE INDEX IF NOT EXISTS idx_gallery_source ON gallery(source);
CREATE INDEX IF NOT EXISTS idx_gallery_version ON gallery(version);
CREATE INDEX IF NOT EXISTS idx_gallery_likes ON gallery(likeCount);
CREATE INDEX IF NOT EXISTS idx_gallery_vis ON gallery(visibility);

CREATE TABLE IF NOT EXISTS likes (
  galleryId TEXT, userId TEXT, PRIMARY KEY(galleryId, userId)
);
CREATE INDEX IF NOT EXISTS idx_likes_gallery ON likes(galleryId);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY, itemId TEXT, userId TEXT, username TEXT,
  content TEXT, approved INTEGER DEFAULT 1, createdAt INTEGER
);
CREATE INDEX IF NOT EXISTS idx_comments_item ON comments(itemId, createdAt);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, sortOrder INTEGER DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cat_name ON categories(name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, sortOrder INTEGER DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tag_name ON tags(name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS gallery_categories (
  galleryId TEXT, category TEXT, PRIMARY KEY(galleryId, category)
);
CREATE INDEX IF NOT EXISTS idx_gc_cat ON gallery_categories(category);

CREATE TABLE IF NOT EXISTS gallery_tags (
  galleryId TEXT, tag TEXT, PRIMARY KEY(galleryId, tag)
);
CREATE INDEX IF NOT EXISTS idx_gt_tag ON gallery_tags(tag);

CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id = 1), json TEXT);
`;

function tx(fn) {
  db.exec("BEGIN");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

// ---- image files (data URL text stored 1 file per image) ----
const safeId = (id) => String(id).replace(/[^a-zA-Z0-9_-]/g, "");
function imagePath(id) {
  return path.join(IMAGES_DIR, safeId(id));
}
function writeImage(id, dataUrl) {
  fs.writeFileSync(imagePath(id), dataUrl, "utf-8");
}
function readImage(id) {
  try {
    return fs.readFileSync(imagePath(id), "utf-8");
  } catch {
    return null;
  }
}
function deleteImage(id) {
  try {
    fs.unlinkSync(imagePath(id));
  } catch {}
}

// ---- meta ----
function metaGet(key) {
  const r = db.prepare("SELECT value FROM meta WHERE key = ?").get(key);
  return r ? r.value : null;
}
function metaSet(key, value) {
  db.prepare(
    "INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, String(value));
}

// ---- settings (raw json blob; server merges over its defaults) ----
function readSettings() {
  const r = db.prepare("SELECT json FROM settings WHERE id = 1").get();
  if (!r) return {};
  try {
    return JSON.parse(r.json) || {};
  } catch {
    return {};
  }
}
function writeSettings(obj) {
  db.prepare(
    "INSERT INTO settings(id, json) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json",
  ).run(JSON.stringify(obj || {}));
}

// ---- users ----
function shapeUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    approved: !!row.approved,
    password: row.password,
    referral: row.referral || "",
    note: row.note || "",
    title: row.title || "",
    avatar: row.avatar || null,
    rejectReason: row.rejectReason || "",
    reapplyLimit: row.reapplyLimit || 0,
    reapplyCount: row.reapplyCount || 0,
    reapplyReason: row.reapplyReason || "",
    createdAt: row.createdAt,
    profileSettings: { profileVisibility: row.profileVisibility || "public" },
  };
}

function getUserById(id) {
  return shapeUser(db.prepare("SELECT * FROM users WHERE id = ?").get(id));
}
function getUserByName(name) {
  return shapeUser(
    db
      .prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE")
      .get(name),
  );
}
function countUsers() {
  return db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
}
function hasAdmin() {
  return !!db.prepare("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1").get();
}
function firstUser() {
  return shapeUser(
    db.prepare("SELECT * FROM users ORDER BY createdAt ASC LIMIT 1").get(),
  );
}
function listUsers() {
  return db
    .prepare("SELECT * FROM users ORDER BY createdAt ASC")
    .all()
    .map(shapeUser);
}
function pendingUsers() {
  return db
    .prepare(
      "SELECT * FROM users WHERE role != 'admin' AND approved = 0 ORDER BY createdAt ASC",
    )
    .all()
    .map(shapeUser);
}

function insertUser(u) {
  db.prepare(
    `INSERT INTO users (id, username, role, approved, password, referral, note,
       title, avatar, rejectReason, reapplyLimit, reapplyCount, reapplyReason,
       profileVisibility, createdAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    u.id,
    u.username,
    u.role || "user",
    b2i(u.approved),
    orNull(u.password),
    u.referral || "",
    u.note || "",
    u.title || "",
    orNull(u.avatar),
    u.rejectReason || "",
    u.reapplyLimit || 0,
    u.reapplyCount || 0,
    u.reapplyReason || "",
    (u.profileSettings && u.profileSettings.profileVisibility) || "public",
    u.createdAt || Date.now(),
  );
  return getUserById(u.id);
}

const USER_COLS = {
  username: (v) => v,
  role: (v) => v,
  approved: (v) => b2i(v),
  password: (v) => v,
  referral: (v) => v,
  note: (v) => v,
  title: (v) => v,
  avatar: (v) => orNull(v),
  rejectReason: (v) => v,
  reapplyLimit: (v) => v,
  reapplyCount: (v) => v,
  reapplyReason: (v) => v,
  profileVisibility: (v) => v,
};
function updateUser(id, fields) {
  const sets = [];
  const vals = [];
  for (const [k, v] of Object.entries(fields || {})) {
    if (!(k in USER_COLS)) continue;
    sets.push(`${k} = ?`);
    vals.push(USER_COLS[k](v));
  }
  if (!sets.length) return getUserById(id);
  vals.push(id);
  db.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  return getUserById(id);
}

function promoteUser(id) {
  db.prepare("UPDATE users SET role = 'admin', approved = 1 WHERE id = ?").run(
    id,
  );
}

function deleteUser(id) {
  tx(() => {
    const ids = db
      .prepare("SELECT id FROM gallery WHERE userId = ?")
      .all(id)
      .map((r) => r.id);
    for (const gid of ids) removeGalleryRows(gid);
    db.prepare("DELETE FROM users WHERE id = ?").run(id);
  });
}

// ---- gallery ----
function toArr(v) {
  if (Array.isArray(v)) return v.filter((x) => typeof x === "string");
  return [];
}
// category may be a scalar string in legacy data — coerce to array
function coerceList(v) {
  if (Array.isArray(v)) return v.filter((x) => typeof x === "string");
  if (typeof v === "string" && v) return [v];
  return [];
}
function jparse(s, fallback) {
  try {
    const v = JSON.parse(s);
    return v == null ? fallback : v;
  } catch {
    return fallback;
  }
}
function shapeGallery(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.userId,
    username: row.username,
    prompt: row.prompt || "",
    params: jparse(row.params, {}),
    note: row.note || "",
    source: row.source || "",
    version: row.version || "",
    promptPublic: !!row.promptPublic,
    rating: row.rating || 3,
    visibility: row.visibility || "public",
    likeCount: row.likeCount || 0,
    tags: jparse(row.tagsJson, []),
    category: jparse(row.categoryJson, []),
    createdAt: row.createdAt,
  };
}

function setJunctions(galleryId, tags, category) {
  db.prepare("DELETE FROM gallery_tags WHERE galleryId = ?").run(galleryId);
  db.prepare("DELETE FROM gallery_categories WHERE galleryId = ?").run(
    galleryId,
  );
  const it = db.prepare(
    "INSERT OR IGNORE INTO gallery_tags(galleryId, tag) VALUES(?, ?)",
  );
  for (const t of tags) it.run(galleryId, t);
  const ic = db.prepare(
    "INSERT OR IGNORE INTO gallery_categories(galleryId, category) VALUES(?, ?)",
  );
  for (const c of category) ic.run(galleryId, c);
}

function removeGalleryRows(id) {
  deleteImage(id);
  db.prepare("DELETE FROM gallery WHERE id = ?").run(id);
  db.prepare("DELETE FROM gallery_tags WHERE galleryId = ?").run(id);
  db.prepare("DELETE FROM gallery_categories WHERE galleryId = ?").run(id);
  db.prepare("DELETE FROM likes WHERE galleryId = ?").run(id);
  db.prepare("DELETE FROM comments WHERE itemId = ?").run(id);
}

function galleryExists(id) {
  return !!db.prepare("SELECT 1 FROM gallery WHERE id = ?").get(id);
}
function getGalleryItem(id) {
  return shapeGallery(db.prepare("SELECT * FROM gallery WHERE id = ?").get(id));
}

function insertGalleryItemCore(item) {
  const tags = toArr(item.tags);
  const category = coerceList(item.category);
  const params = item.params && typeof item.params === "object" ? item.params : {};
  if (typeof item.image === "string" && item.image) {
    writeImage(item.id, item.image);
  }
  db.prepare(
    `INSERT INTO gallery (id, userId, username, prompt, params, note, source,
       version, promptPublic, rating, visibility, likeCount, tagsJson,
       categoryJson, createdAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    item.id,
    item.userId,
    item.username,
    item.prompt || "",
    JSON.stringify(params),
    item.note || "",
    item.source || "",
    String(params.version || ""),
    b2i(item.promptPublic),
    item.rating || 3,
    item.visibility || "users",
    Array.isArray(item.likes) ? item.likes.length : item.likeCount || 0,
    JSON.stringify(tags),
    JSON.stringify(category),
    item.createdAt || Date.now(),
  );
  setJunctions(item.id, tags, category);
  if (Array.isArray(item.likes)) {
    const il = db.prepare(
      "INSERT OR IGNORE INTO likes(galleryId, userId) VALUES(?, ?)",
    );
    for (const uid of item.likes) if (uid) il.run(item.id, uid);
  }
}
function insertGalleryItem(item) {
  tx(() => insertGalleryItemCore(item));
}

function updateGalleryItem(id, fields) {
  tx(() => {
    const sets = [];
    const vals = [];
    const push = (col, val) => {
      sets.push(`${col} = ?`);
      vals.push(val);
    };
    if ("prompt" in fields) push("prompt", fields.prompt || "");
    if ("params" in fields) {
      const p = fields.params && typeof fields.params === "object" ? fields.params : {};
      push("params", JSON.stringify(p));
      push("version", String(p.version || ""));
    }
    if ("note" in fields) push("note", fields.note || "");
    if ("promptPublic" in fields) push("promptPublic", b2i(fields.promptPublic));
    if ("rating" in fields) push("rating", fields.rating || 3);
    if ("source" in fields) push("source", fields.source || "");
    if ("visibility" in fields) push("visibility", fields.visibility);
    if ("tags" in fields) {
      const tags = toArr(fields.tags);
      push("tagsJson", JSON.stringify(tags));
      db.prepare("DELETE FROM gallery_tags WHERE galleryId = ?").run(id);
      const it = db.prepare(
        "INSERT OR IGNORE INTO gallery_tags(galleryId, tag) VALUES(?, ?)",
      );
      for (const t of tags) it.run(id, t);
    }
    if ("category" in fields) {
      const cats = coerceList(fields.category);
      push("categoryJson", JSON.stringify(cats));
      db.prepare("DELETE FROM gallery_categories WHERE galleryId = ?").run(id);
      const ic = db.prepare(
        "INSERT OR IGNORE INTO gallery_categories(galleryId, category) VALUES(?, ?)",
      );
      for (const c of cats) ic.run(id, c);
    }
    if (sets.length) {
      vals.push(id);
      db.prepare(`UPDATE gallery SET ${sets.join(", ")} WHERE id = ?`).run(
        ...vals,
      );
    }
  });
}

function deleteGalleryItem(id) {
  tx(() => removeGalleryRows(id));
}

function batchUpdateGallery(ids, opts) {
  let updated = 0;
  tx(() => {
    for (const id of ids) {
      const row = db.prepare("SELECT * FROM gallery WHERE id = ?").get(id);
      if (!row) continue;
      const fields = {};
      if (opts.category !== undefined) {
        if (Array.isArray(opts.category))
          fields.category = opts.category.filter(Boolean);
        else if (typeof opts.category === "string" && opts.category)
          fields.category = [opts.category];
      }
      let tags = jparse(row.tagsJson, []);
      let touchedTags = false;
      if (Array.isArray(opts.tags)) {
        tags = toArr(opts.tags);
        touchedTags = true;
      }
      if (Array.isArray(opts.addTags)) {
        for (const t of opts.addTags) if (t && !tags.includes(t)) tags.push(t);
        touchedTags = true;
      }
      if (Array.isArray(opts.removeTags)) {
        tags = tags.filter((t) => !opts.removeTags.includes(t));
        touchedTags = true;
      }
      if (touchedTags) fields.tags = tags;
      if (
        typeof opts.visibility === "string" &&
        ["public", "users", "private"].includes(opts.visibility)
      ) {
        fields.visibility = opts.visibility;
      }
      applyGalleryFieldsInTx(id, fields);
      updated++;
    }
  });
  return updated;
}

// same as updateGalleryItem body but assumes an open transaction
function applyGalleryFieldsInTx(id, fields) {
  const sets = [];
  const vals = [];
  if ("visibility" in fields) {
    sets.push("visibility = ?");
    vals.push(fields.visibility);
  }
  if ("tags" in fields) {
    const tags = toArr(fields.tags);
    sets.push("tagsJson = ?");
    vals.push(JSON.stringify(tags));
    db.prepare("DELETE FROM gallery_tags WHERE galleryId = ?").run(id);
    const it = db.prepare(
      "INSERT OR IGNORE INTO gallery_tags(galleryId, tag) VALUES(?, ?)",
    );
    for (const t of tags) it.run(id, t);
  }
  if ("category" in fields) {
    const cats = coerceList(fields.category);
    sets.push("categoryJson = ?");
    vals.push(JSON.stringify(cats));
    db.prepare("DELETE FROM gallery_categories WHERE galleryId = ?").run(id);
    const ic = db.prepare(
      "INSERT OR IGNORE INTO gallery_categories(galleryId, category) VALUES(?, ?)",
    );
    for (const c of cats) ic.run(id, c);
  }
  if (sets.length) {
    vals.push(id);
    db.prepare(`UPDATE gallery SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  }
}

function batchDeleteGallery(ids) {
  let deleted = 0;
  tx(() => {
    for (const id of ids) {
      if (!db.prepare("SELECT 1 FROM gallery WHERE id = ?").get(id)) continue;
      removeGalleryRows(id);
      deleted++;
    }
  });
  return deleted;
}

// ---- gallery list (filter / search / sort / paginate) ----
function listGallery(o) {
  const where = [];
  const params = [];
  if (o.userId) {
    where.push("g.userId = ?");
    params.push(o.userId);
  }
  // visibility
  if (o.viewerRole === "admin") {
    // admin sees everything
  } else if (o.viewerId) {
    where.push(
      "(g.visibility IN ('public','users') OR (g.visibility = 'private' AND g.userId = ?))",
    );
    params.push(o.viewerId);
  } else {
    where.push("g.visibility = 'public'");
  }
  // filter
  const f = o.filter;
  if (f && f !== "all") {
    if (f === "niji7") {
      where.push("(lower(g.version) LIKE '%niji 7%' OR lower(g.version) LIKE '%niji7%')");
    } else if (f === "niji6") {
      where.push("(lower(g.version) LIKE '%niji 6%' OR lower(g.version) LIKE '%niji6%')");
    } else if (["mj", "nai", "comfyui", "sd"].includes(f)) {
      where.push("lower(g.source) = ?");
      params.push(f);
    } else {
      where.push(
        "g.id IN (SELECT galleryId FROM gallery_categories WHERE category = ? COLLATE NOCASE)",
      );
      params.push(f);
    }
  }
  // search
  if (o.q) {
    where.push(
      "(lower(g.prompt) LIKE ? OR lower(g.note) LIKE ? OR lower(g.tagsJson) LIKE ?)",
    );
    const like = "%" + o.q + "%";
    params.push(like, like, like);
  }
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";
  const total = db
    .prepare(`SELECT COUNT(*) AS n FROM gallery g ${whereSql}`)
    .get(...params).n;

  let orderBy = "g.createdAt DESC";
  if (o.sort === "oldest") orderBy = "g.createdAt ASC";
  else if (o.sort === "popular") orderBy = "g.likeCount DESC, g.createdAt DESC";

  const limit = o.limit == null ? -1 : o.limit;
  const rows = db
    .prepare(
      `SELECT * FROM gallery g ${whereSql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, o.offset || 0)
    .map(shapeGallery);
  return { rows, total };
}

// ---- likes ----
function likedSet(userId, ids) {
  if (!userId || !ids || !ids.length) return new Set();
  const ph = ids.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT galleryId FROM likes WHERE userId = ? AND galleryId IN (${ph})`,
    )
    .all(userId, ...ids);
  return new Set(rows.map((r) => r.galleryId));
}

function toggleLike(galleryId, userId) {
  return tx(() => {
    const existing = db
      .prepare("SELECT 1 FROM likes WHERE galleryId = ? AND userId = ?")
      .get(galleryId, userId);
    if (existing) {
      db.prepare("DELETE FROM likes WHERE galleryId = ? AND userId = ?").run(
        galleryId,
        userId,
      );
      db.prepare(
        "UPDATE gallery SET likeCount = MAX(0, likeCount - 1) WHERE id = ?",
      ).run(galleryId);
    } else {
      db.prepare(
        "INSERT OR IGNORE INTO likes(galleryId, userId) VALUES(?, ?)",
      ).run(galleryId, userId);
      db.prepare("UPDATE gallery SET likeCount = likeCount + 1 WHERE id = ?").run(
        galleryId,
      );
    }
    const row = db
      .prepare("SELECT likeCount FROM gallery WHERE id = ?")
      .get(galleryId);
    return { liked: !existing, likeCount: row ? row.likeCount : 0 };
  });
}

// ---- stats / profile ----
function adminStats() {
  return {
    users: db.prepare("SELECT COUNT(*) AS n FROM users").get().n,
    works: db.prepare("SELECT COUNT(*) AS n FROM gallery").get().n,
    likes: db.prepare("SELECT COUNT(*) AS n FROM likes").get().n,
    tags: db.prepare("SELECT COUNT(*) AS n FROM tags").get().n,
  };
}
function profileStats(userId) {
  const r = db
    .prepare(
      "SELECT COUNT(*) AS works, COALESCE(SUM(likeCount),0) AS likes FROM gallery WHERE userId = ?",
    )
    .get(userId);
  return { workCount: r.works, totalLikes: r.likes };
}

// ---- comments ----
function shapeComment(row) {
  if (!row) return null;
  return {
    id: row.id,
    itemId: row.itemId,
    userId: row.userId,
    username: row.username,
    content: row.content,
    approved: !!row.approved,
    createdAt: row.createdAt,
  };
}
function listComments(itemId) {
  return db
    .prepare("SELECT * FROM comments WHERE itemId = ? ORDER BY createdAt ASC")
    .all(itemId)
    .map(shapeComment);
}
function getComment(id) {
  return shapeComment(
    db.prepare("SELECT * FROM comments WHERE id = ?").get(id),
  );
}
function insertComment(c) {
  db.prepare(
    `INSERT INTO comments(id, itemId, userId, username, content, approved, createdAt)
     VALUES (?,?,?,?,?,?,?)`,
  ).run(
    c.id,
    c.itemId,
    c.userId,
    c.username,
    c.content,
    b2i(c.approved),
    c.createdAt || Date.now(),
  );
  return getComment(c.id);
}
function deleteComment(id) {
  db.prepare("DELETE FROM comments WHERE id = ?").run(id);
}
function approveComment(id) {
  db.prepare("UPDATE comments SET approved = 1 WHERE id = ?").run(id);
}

// ---- categories ----
function getCategory(id) {
  return db.prepare("SELECT * FROM categories WHERE id = ?").get(id) || null;
}
function categoryByName(name) {
  return (
    db
      .prepare("SELECT * FROM categories WHERE name = ? COLLATE NOCASE")
      .get(name) || null
  );
}
function countCategories() {
  return db.prepare("SELECT COUNT(*) AS n FROM categories").get().n;
}
function listCategoriesWithCount() {
  const cats = db
    .prepare("SELECT * FROM categories ORDER BY sortOrder ASC, rowid ASC")
    .all();
  const cnt = db.prepare(
    "SELECT COUNT(*) AS n FROM gallery_categories WHERE category = ?",
  );
  return cats.map((c) => ({ id: c.id, name: c.name, count: cnt.get(c.name).n }));
}
function insertCategory(name) {
  const id = createId();
  const n = countCategories();
  db.prepare(
    "INSERT INTO categories(id, name, sortOrder) VALUES(?, ?, ?)",
  ).run(id, name, n);
  return { id, name };
}
function deleteCategory(id) {
  db.prepare("DELETE FROM categories WHERE id = ?").run(id);
}
function renameCategory(id, newName) {
  return tx(() => {
    const cur = getCategory(id);
    if (!cur) return { updated: 0 };
    const oldName = cur.name;
    db.prepare("UPDATE categories SET name = ? WHERE id = ?").run(newName, id);
    const gids = db
      .prepare("SELECT galleryId FROM gallery_categories WHERE category = ?")
      .all(oldName)
      .map((r) => r.galleryId);
    db.prepare(
      "UPDATE OR REPLACE gallery_categories SET category = ? WHERE category = ?",
    ).run(newName, oldName);
    for (const gid of gids) rebuildCategoryJson(gid);
    return { updated: gids.length };
  });
}
function rebuildCategoryJson(gid) {
  const cats = db
    .prepare("SELECT category FROM gallery_categories WHERE galleryId = ?")
    .all(gid)
    .map((r) => r.category);
  db.prepare("UPDATE gallery SET categoryJson = ? WHERE id = ?").run(
    JSON.stringify(cats),
    gid,
  );
}
function reorderCategories(ids) {
  const all = db
    .prepare("SELECT id FROM categories")
    .all()
    .map((r) => r.id);
  if (ids.length !== all.length || !all.every((id) => ids.includes(id)))
    return false;
  tx(() => {
    ids.forEach((id, i) =>
      db.prepare("UPDATE categories SET sortOrder = ? WHERE id = ?").run(i, id),
    );
  });
  return true;
}

// ---- tags ----
function getTag(id) {
  return db.prepare("SELECT * FROM tags WHERE id = ?").get(id) || null;
}
function tagByName(name) {
  return (
    db.prepare("SELECT * FROM tags WHERE name = ? COLLATE NOCASE").get(name) ||
    null
  );
}
function countTags() {
  return db.prepare("SELECT COUNT(*) AS n FROM tags").get().n;
}
function listTagsWithCount() {
  const tags = db
    .prepare("SELECT * FROM tags ORDER BY sortOrder ASC, rowid ASC")
    .all();
  const cnt = db.prepare(
    "SELECT COUNT(*) AS n FROM gallery_tags WHERE tag = ?",
  );
  return tags.map((t) => ({ id: t.id, name: t.name, count: cnt.get(t.name).n }));
}
function insertTag(name) {
  const id = createId();
  const n = countTags();
  db.prepare("INSERT INTO tags(id, name, sortOrder) VALUES(?, ?, ?)").run(
    id,
    name,
    n,
  );
  return { id, name };
}
function deleteTag(id) {
  db.prepare("DELETE FROM tags WHERE id = ?").run(id);
}
function renameTag(id, newName) {
  return tx(() => {
    const cur = getTag(id);
    if (!cur) return { updated: 0 };
    const oldName = cur.name;
    db.prepare("UPDATE tags SET name = ? WHERE id = ?").run(newName, id);
    const gids = db
      .prepare("SELECT galleryId FROM gallery_tags WHERE tag = ?")
      .all(oldName)
      .map((r) => r.galleryId);
    db.prepare(
      "UPDATE OR REPLACE gallery_tags SET tag = ? WHERE tag = ?",
    ).run(newName, oldName);
    for (const gid of gids) rebuildTagsJson(gid);
    return { updated: gids.length };
  });
}
function rebuildTagsJson(gid) {
  const tags = db
    .prepare("SELECT tag FROM gallery_tags WHERE galleryId = ?")
    .all(gid)
    .map((r) => r.tag);
  db.prepare("UPDATE gallery SET tagsJson = ? WHERE id = ?").run(
    JSON.stringify(tags),
    gid,
  );
}
function reorderTags(ids) {
  const all = db
    .prepare("SELECT id FROM tags")
    .all()
    .map((r) => r.id);
  if (ids.length !== all.length || !all.every((id) => ids.includes(id)))
    return false;
  tx(() => {
    ids.forEach((id, i) =>
      db.prepare("UPDATE tags SET sortOrder = ? WHERE id = ?").run(i, id),
    );
  });
  return true;
}

// ---- one-time migration from legacy JSON files ----
function migrateFromLegacy() {
  if (metaGet("migrated")) return;

  const legacy = (name) => {
    const p = path.join(DATA_DIR, name);
    if (!fs.existsSync(p)) return null;
    try {
      return JSON.parse(fs.readFileSync(p, "utf-8"));
    } catch {
      return null;
    }
  };

  const users = legacy("users.json");
  const gallery = legacy("gallery.json");
  const settings = legacy("settings.json");
  const categories = legacy("categories.json");
  const comments = legacy("comments.json");
  const tags = legacy("tags.json");

  let imported = 0;
  tx(() => {
    if (Array.isArray(users)) for (const u of users) insertUser(u);
    if (Array.isArray(gallery))
      for (const g of gallery) {
        insertGalleryItemCore({ ...g, id: g.id || createId() });
        imported++;
      }
    if (Array.isArray(categories))
      categories.forEach((c, i) =>
        db
          .prepare(
            "INSERT OR IGNORE INTO categories(id, name, sortOrder) VALUES(?, ?, ?)",
          )
          .run(c.id || createId(), c.name, typeof c.order === "number" ? c.order : i),
      );
    if (Array.isArray(tags))
      tags.forEach((t, i) =>
        db
          .prepare("INSERT OR IGNORE INTO tags(id, name, sortOrder) VALUES(?, ?, ?)")
          .run(t.id || createId(), t.name, i),
      );
    if (Array.isArray(comments))
      for (const c of comments)
        insertComment({ ...c, id: c.id || createId(), itemId: c.itemId });
    if (settings && typeof settings === "object" && !Array.isArray(settings))
      writeSettings(settings);
    metaSet("schema_version", "1");
    metaSet("migrated", "1");
  });

  // archive legacy files so they aren't mistaken for the source of truth
  for (const name of [
    "users.json",
    "gallery.json",
    "settings.json",
    "categories.json",
    "comments.json",
    "tags.json",
  ]) {
    const p = path.join(DATA_DIR, name);
    if (fs.existsSync(p)) {
      try {
        fs.renameSync(p, p + ".bak");
      } catch {}
    }
  }
  if (imported) console.log(`[迁移] 已导入 ${imported} 条作品到 SQLite`);
}

function init(dataDir) {
  DATA_DIR = dataDir;
  IMAGES_DIR = path.join(dataDir, "images");
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
  db = new DatabaseSync(path.join(dataDir, "gallery.db"));
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  db.exec(SCHEMA);
  migrateFromLegacy();
  return db;
}

module.exports = {
  init,
  createId,
  // users
  getUserById,
  getUserByName,
  listUsers,
  countUsers,
  hasAdmin,
  firstUser,
  pendingUsers,
  insertUser,
  updateUser,
  promoteUser,
  deleteUser,
  // gallery
  galleryExists,
  getGalleryItem,
  listGallery,
  insertGalleryItem,
  updateGalleryItem,
  deleteGalleryItem,
  batchUpdateGallery,
  batchDeleteGallery,
  toggleLike,
  likedSet,
  profileStats,
  adminStats,
  // comments
  listComments,
  getComment,
  insertComment,
  deleteComment,
  approveComment,
  // categories
  getCategory,
  categoryByName,
  countCategories,
  listCategoriesWithCount,
  insertCategory,
  deleteCategory,
  renameCategory,
  reorderCategories,
  // tags
  getTag,
  tagByName,
  countTags,
  listTagsWithCount,
  insertTag,
  deleteTag,
  renameTag,
  reorderTags,
  // settings
  readSettings,
  writeSettings,
  // images
  readImage,
  writeImage,
  deleteImage,
};
