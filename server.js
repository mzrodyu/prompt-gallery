const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, "data");
const JWT_SECRET_FILE = path.join(DATA_DIR, ".jwt_secret");

const MAX_IMAGE_DATA_URL_LENGTH = 10 * 1024 * 1024;
const MAX_PROMPT_LENGTH = 4000;
const MAX_NOTE_LENGTH = 1000;
const MAX_TAGS = 30;
const MAX_TAG_LENGTH = 64;
const MAX_PARAMS_JSON_LENGTH = 4096;

function defaultSettings() {
  return {
    allowRegister: true,
    guestCanView: true,
    approvedOnly: false,
    disableDownload: false,
    allowUpload: true,
    enableLikes: true,
    enableComments: true,
    commentModeration: false,
    theme: "default",
    siteName: "MJ Gallery",
  };
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadOrCreateJwtSecret() {
  const envSecret = process.env.JWT_SECRET && process.env.JWT_SECRET.trim();
  if (envSecret && envSecret.length >= 16) return envSecret;

  ensureDataDir();

  if (fs.existsSync(JWT_SECRET_FILE)) {
    const secret = fs.readFileSync(JWT_SECRET_FILE, "utf-8").trim();
    if (secret) return secret;
  }

  const secret = crypto.randomBytes(48).toString("hex");
  fs.writeFileSync(JWT_SECRET_FILE, secret, "utf-8");
  console.warn(
    "[security] JWT_SECRET 未设置，已自动生成并持久化到 data/.jwt_secret",
  );
  return secret;
}

const JWT_SECRET = loadOrCreateJwtSecret();

// settings: cached in memory (small, read-often), persisted to SQLite via db.js
let settingsCache = defaultSettings();

function loadSettings() {
  settingsCache = { ...defaultSettings(), ...(db.readSettings() || {}) };
}

function getSettings() {
  return settingsCache;
}

function saveSettings(settings) {
  settingsCache = { ...defaultSettings(), ...(settings || {}) };
  db.writeSettings(settingsCache);
}

// Ensure an admin exists: env-configured user, else promote the first user.
function ensureAdmin() {
  const envAdmin = (process.env.ADMIN_USERNAME || "").trim();
  const envPass = (process.env.ADMIN_PASSWORD || "").trim();

  if (envAdmin && envPass) {
    const existing = db.getUserByName(envAdmin);
    if (existing) {
      if (existing.role !== "admin") {
        db.updateUser(existing.id, { role: "admin", approved: true });
        console.log(`[启动] 环境变量配置: ${envAdmin} 已提升为管理员`);
      }
    } else {
      db.insertUser({
        id: createId(),
        username: envAdmin,
        password: bcrypt.hashSync(envPass, 10),
        role: "admin",
        approved: true,
        createdAt: Date.now(),
      });
      console.log(`[启动] 环境变量配置: 已创建管理员 ${envAdmin}`);
    }
  } else if (db.countUsers() > 0 && !db.hasAdmin()) {
    const first = db.firstUser();
    if (first) {
      db.promoteUser(first.id);
      console.log(`[启动] 已自动提升 ${first.username} 为管理员`);
    }
  }
}


function createId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return crypto.randomBytes(16).toString("hex");
}

function normalizeText(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];

  const deduped = [];
  const seen = new Set();

  for (const rawTag of tags) {
    const tag = normalizeText(rawTag, MAX_TAG_LENGTH);
    if (!tag) continue;

    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    deduped.push(tag);
    if (deduped.length >= MAX_TAGS) break;
  }

  return deduped;
}

function normalizeParams(params) {
  if (!params || typeof params !== "object" || Array.isArray(params)) return {};

  const normalized = {};

  for (const [rawKey, rawValue] of Object.entries(params)) {
    const key = normalizeText(rawKey, 24);
    if (!key) continue;

    if (typeof rawValue === "string") {
      normalized[key] = normalizeText(rawValue, 80);
      continue;
    }

    if (typeof rawValue === "number") {
      if (Number.isFinite(rawValue)) normalized[key] = rawValue;
      continue;
    }

    if (typeof rawValue === "boolean" || rawValue === null) {
      normalized[key] = rawValue;
    }
  }

  if (JSON.stringify(normalized).length > MAX_PARAMS_JSON_LENGTH) return {};
  return normalized;
}

function parsePositiveInt(value, fallback, max) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(n, max);
}

function isValidImageDataUrl(value) {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > MAX_IMAGE_DATA_URL_LENGTH)
    return false;
  if (!value.startsWith("data:image/")) return false;
  return value.includes(";base64,");
}

function signToken(userId) {
  return jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: "30d" });
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    approved: user.approved,
    rejectReason: user.rejectReason || "",
    reapplyLimit: user.reapplyLimit || 0,
    reapplyCount: user.reapplyCount || 0,
    reapplyReason: user.reapplyReason || "",
    avatar: user.avatar || null,
    title: user.title || "",
    profileSettings: user.profileSettings || { profileVisibility: "public" },
  };
}

ensureDataDir();
db.init(DATA_DIR);
loadSettings();
ensureAdmin();

app.use(express.json({ limit: "50mb" }));

// Force no-cache on ALL responses
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});
app.use(
  express.static(path.join(__dirname, "public"), {
    maxAge: 0,
    etag: true,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith(".html")) {
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      }
    },
  }),
);

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    req.user = null;
    return next();
  }

  try {
    const decoded = jwt.verify(auth.slice(7), JWT_SECRET);
    req.user = db.getUserById(decoded.id) || null;
  } catch {
    req.user = null;
  }

  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "请先登录" });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "请先登录" });
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "需要管理员权限" });
  }
  next();
}

app.use(authMiddleware);

app.post("/api/auth/register", (req, res) => {
  const username = normalizeText(req.body?.username, 20);
  const password =
    typeof req.body?.password === "string" ? req.body.password : "";

  if (!username || !password) {
    return res.status(400).json({ error: "用户名和密码不能为空" });
  }
  if (username.length < 2 || username.length > 20) {
    return res.status(400).json({ error: "用户名长度需 2-20 个字符" });
  }
  if (password.length < 4) {
    return res.status(400).json({ error: "密码至少 4 位" });
  }

  const settings = getSettings();
  const isFirst = db.countUsers() === 0;

  if (!isFirst && !settings.allowRegister) {
    return res.status(403).json({ error: "管理员已关闭注册" });
  }

  if (db.getUserByName(username)) {
    return res.status(400).json({ error: "用户名已存在" });
  }

  const user = {
    id: createId(),
    username,
    password: bcrypt.hashSync(password, 10),
    role: isFirst ? "admin" : "user",
    approved: isFirst ? true : !settings.approvedOnly,
    referral: normalizeText(req.body?.referral, 50) || "",
    note: normalizeText(req.body?.note, 200) || "",
    createdAt: Date.now(),
  };

  db.insertUser(user);

  const token = signToken(user.id);
  console.log(`[注册] ${username} (${user.role})`);

  res.json({ token, user: publicUser(user) });
});

app.post("/api/auth/login", (req, res) => {
  const username = normalizeText(req.body?.username, 20);
  const password =
    typeof req.body?.password === "string" ? req.body.password : "";

  if (!username || !password) {
    return res.status(400).json({ error: "用户名和密码不能为空" });
  }

  const user = db.getUserByName(username);
  if (!user) {
    return res.status(401).json({ error: "用户名或密码错误" });
  }

  if (!bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: "用户名或密码错误" });
  }

  const token = signToken(user.id);
  console.log(`[登录] ${username}`);
  res.json({ token, user: publicUser(user) });
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

// ============ User Settings ============
app.get("/api/user/settings", requireAuth, (req, res) => {
  const user = db.getUserById(req.user.id);
  if (!user)
    return res.status(404).json({ error: "\u7528\u6237\u4e0d\u5b58\u5728" });
  res.json(user.profileSettings || { profileVisibility: "public" });
});

app.put("/api/user/settings", requireAuth, (req, res) => {
  const user = db.getUserById(req.user.id);
  if (!user)
    return res.status(404).json({ error: "\u7528\u6237\u4e0d\u5b58\u5728" });

  const b = req.body || {};
  let vis = (user.profileSettings || {}).profileVisibility || "public";

  const validVis = ["public", "users", "off"];
  if (
    typeof b.profileVisibility === "string" &&
    validVis.includes(b.profileVisibility)
  ) {
    vis = b.profileVisibility;
  }

  db.updateUser(user.id, { profileVisibility: vis });
  res.json({ profileVisibility: vis });
});

// Avatar upload (base64)
app.post("/api/user/avatar", requireAuth, (req, res) => {
  const user = db.getUserById(req.user.id);
  if (!user) return res.status(404).json({ error: "用户不存在" });

  const { avatar } = req.body || {};
  if (!avatar || typeof avatar !== "string") {
    return res.status(400).json({ error: "缺少头像数据" });
  }

  // Max 512KB base64
  if (avatar.length > 512 * 1024) {
    return res.status(400).json({ error: "头像文件过大（最大 512KB）" });
  }

  if (!/^data:image\/(png|jpe?g|gif|webp);base64,/.test(avatar)) {
    return res.status(400).json({ error: "不支持的图片格式" });
  }

  db.updateUser(user.id, { avatar });
  console.log(`[头像] ${user.username} 更新头像`);
  res.json({ avatar });
});

app.get("/api/users/:id/profile", (req, res) => {
  const user = db.getUserById(req.params.id);
  if (!user)
    return res.status(404).json({ error: "\u7528\u6237\u4e0d\u5b58\u5728" });

  const vis = (user.profileSettings || {}).profileVisibility || "public";
  const isSelf = req.user && req.user.id === user.id;
  const isAdmin = req.user && req.user.role === "admin";

  if (!isSelf && !isAdmin) {
    if (!user.approved)
      return res.status(403).json({ error: "该用户尚未通过审核" });
    if (vis === "off")
      return res
        .status(403)
        .json({ error: "\u8be5\u7528\u6237\u672a\u516c\u5f00\u4e3b\u9875" });
    if (vis === "users" && !req.user)
      return res
        .status(401)
        .json({ error: "\u8bf7\u767b\u5f55\u540e\u67e5\u770b" });
  }

  const stats = db.profileStats(user.id);

  res.json({
    id: user.id,
    username: user.username,
    role: user.role,
    avatar: user.avatar || null,
    title: user.title || "",
    createdAt: user.createdAt,
    workCount: stats.workCount,
    totalLikes: stats.totalLikes,
  });
});

app.get("/api/admin/stats", requireAdmin, (req, res) => {
  res.json(db.adminStats());
});

app.get("/api/admin/settings", requireAdmin, (req, res) => {
  res.json(getSettings());
});

app.post("/api/admin/settings", requireAdmin, (req, res) => {
  const settings = getSettings();
  const b = req.body || {};

  if (typeof b.allowRegister === "boolean")
    settings.allowRegister = b.allowRegister;
  if (typeof b.guestCanView === "boolean")
    settings.guestCanView = b.guestCanView;
  if (typeof b.approvedOnly === "boolean")
    settings.approvedOnly = b.approvedOnly;
  if (typeof b.disableDownload === "boolean")
    settings.disableDownload = b.disableDownload;
  if (typeof b.allowUpload === "boolean") settings.allowUpload = b.allowUpload;
  if (typeof b.enableLikes === "boolean") settings.enableLikes = b.enableLikes;
  if (typeof b.enableComments === "boolean")
    settings.enableComments = b.enableComments;
  if (typeof b.commentModeration === "boolean")
    settings.commentModeration = b.commentModeration;
  const validThemes = ["default", "gallery", "ios"];
  if (typeof b.theme === "string" && validThemes.includes(b.theme))
    settings.theme = b.theme;
  if (typeof b.siteName === "string")
    settings.siteName = b.siteName.trim().slice(0, 50) || "MJ Gallery";

  saveSettings(settings);
  console.log("[管理] 设置更新", settings);
  res.json(settings);
});

app.get("/api/admin/users", requireAdmin, (req, res) => {
  const users = db.listUsers().map((u) => ({
    id: u.id,
    username: u.username,
    role: u.role,
    approved: u.approved,
    referral: u.referral || "",
    note: u.note || "",
    title: u.title || "",
    rejectReason: u.rejectReason || "",
    reapplyLimit: u.reapplyLimit || 0,
    reapplyCount: u.reapplyCount || 0,
    reapplyReason: u.reapplyReason || "",
    createdAt: u.createdAt,
  }));

  res.json(users);
});

app.patch("/api/admin/users/:id", requireAdmin, (req, res) => {
  const user = db.getUserById(req.params.id);

  if (!user) return res.status(404).json({ error: "用户不存在" });

  const isSelf = user.id === req.user.id;
  const { approved, role, title } = req.body || {};
  const fields = {};
  let approvedNow = user.approved;

  // Block self-modification of role/approval (security), but allow title
  if (!isSelf) {
    if (typeof approved === "boolean") {
      fields.approved = approved;
      approvedNow = approved;
      if (approved) fields.rejectReason = "";
    }
    if (role === "admin" || role === "user") fields.role = role;
  }
  if (typeof title === "string") fields.title = title.trim().slice(0, 20);

  // Reject reason
  const { rejectReason, reapplyLimit } = req.body || {};
  if (!isSelf && typeof rejectReason === "string") {
    fields.rejectReason = rejectReason.trim().slice(0, 200);
    if (rejectReason && approvedNow) {
      fields.approved = false;
      approvedNow = false;
    }
  }
  if (!isSelf && typeof reapplyLimit === "number") {
    fields.reapplyLimit = Math.max(0, Math.min(10, Math.floor(reapplyLimit)));
  }

  const updated = db.updateUser(user.id, fields);
  console.log(
    `[管理] 更新用户 ${updated.username}: approved=${updated.approved}, role=${updated.role}`,
  );

  res.json(publicUser(updated));
});

app.delete("/api/admin/users/:id", requireAdmin, (req, res) => {
  const user = db.getUserById(req.params.id);

  if (!user) return res.status(404).json({ error: "用户不存在" });
  if (user.id === req.user.id) {
    return res.status(400).json({ error: "不能删除自己" });
  }

  db.deleteUser(user.id);

  console.log(`[管理] 删除用户 ${user.username}`);
  res.json({ ok: true });
});

app.get("/api/auth/pending-status", requireAuth, (req, res) => {
  const pending = db.pendingUsers();
  const position = pending.findIndex((u) => u.id === req.user.id);

  res.json({
    position: position === -1 ? 0 : position + 1,
    total: pending.length,
  });
});

// Re-apply after rejection
app.post("/api/auth/reapply", requireAuth, (req, res) => {
  const user = db.getUserById(req.user.id);
  if (!user) return res.status(404).json({ error: "用户不存在" });

  if (user.approved) return res.status(400).json({ error: "账号已通过审核" });
  if (!user.rejectReason)
    return res.status(400).json({ error: "账号待审核中，无需重新申请" });

  const limit = user.reapplyLimit || 0;
  const count = user.reapplyCount || 0;
  if (limit <= 0)
    return res.status(403).json({ error: "管理员未允许重新申请" });
  if (count >= limit)
    return res
      .status(403)
      .json({ error: `已达到最大重新申请次数(${limit}次)` });

  const reason = (req.body?.reason || "").trim().slice(0, 500);
  if (!reason) return res.status(400).json({ error: "请填写重新申请理由" });

  db.updateUser(user.id, {
    reapplyCount: count + 1,
    reapplyReason: reason,
    rejectReason: "",
  });

  console.log(
    `[审核] ${user.username} 重新申请 (${count + 1}/${limit}): ${reason}`,
  );
  res.json({ ok: true, remaining: limit - (count + 1) });
});

app.get("/api/gallery", (req, res) => {
  const settings = getSettings();

  if (!req.user) {
    if (!settings.guestCanView) {
      return res
        .status(401)
        .json({ error: "请登录后查看", requireLogin: true });
    }
  } else if (req.user.role !== "admin" && !req.user.approved) {
    return res
      .status(403)
      .json({ error: "账号待审核，请联系管理员", pendingApproval: true });
  }

  const q = normalizeText(req.query.q, 100).toLowerCase();
  const filter = normalizeText(req.query.filter, 20).toLowerCase();
  const sort =
    req.query.sort === "oldest"
      ? "oldest"
      : req.query.sort === "popular"
        ? "popular"
        : "newest";
  const offset = parsePositiveInt(req.query.offset, 0, 1_000_000);
  const limit = parsePositiveInt(req.query.limit, null, 1000);

  const userId = normalizeText(req.query.userId, 100);
  const { rows, total } = db.listGallery({
    q,
    filter,
    sort,
    offset,
    limit,
    userId: userId || null,
    viewerId: req.user ? req.user.id : null,
    viewerRole: req.user ? req.user.role : null,
  });

  const currentUserId = req.user ? req.user.id : null;
  const likes = db.likedSet(
    currentUserId,
    rows.map((g) => g.id),
  );

  const list = rows.map((g) => ({
    id: g.id,
    userId: g.userId,
    username: g.username,
    prompt:
      g.promptPublic ||
      (req.user && (req.user.id === g.userId || req.user.role === "admin"))
        ? g.prompt || ""
        : "",
    promptPublic: !!g.promptPublic,
    params:
      g.promptPublic ||
      (req.user && (req.user.id === g.userId || req.user.role === "admin"))
        ? g.params || {}
        : {},
    tags: g.tags,
    note: g.note,
    category: g.category,
    source: g.source || "",
    likeCount: g.likeCount,
    liked: currentUserId ? likes.has(g.id) : false,
    rating: g.rating || 3,
    visibility: g.visibility || "public",
    createdAt: g.createdAt,
    hasImage: true,
  }));

  res.set("X-Total-Count", String(total));
  res.json(list);
});

app.get("/api/gallery/:id/image", (req, res) => {
  const settings = getSettings();

  if (!req.user && !settings.guestCanView) {
    return res.status(401).json({ error: "请登录" });
  }

  if (req.user && req.user.role !== "admin" && !req.user.approved) {
    return res.status(403).json({ error: "账号待审核" });
  }

  const image = db.readImage(req.params.id);
  if (image === null) return res.status(404).json({ error: "图片不存在" });

  res.set("Cache-Control", "private, max-age=60");
  res.json({ image });
});

app.post("/api/gallery/:id/like", requireAuth, (req, res) => {
  const settings = getSettings();
  if (!settings.enableLikes) {
    return res.status(403).json({ error: "点赞功能已关闭" });
  }

  if (!db.galleryExists(req.params.id))
    return res.status(404).json({ error: "作品不存在" });

  const r = db.toggleLike(req.params.id, req.user.id);
  res.json({ liked: r.liked, likeCount: r.likeCount });
});

app.post("/api/gallery", requireAuth, (req, res) => {
  if (req.user.role !== "admin" && !req.user.approved) {
    return res.status(403).json({ error: "账号待审核" });
  }

  const settings = getSettings();
  if (!settings.allowUpload && req.user.role !== "admin") {
    return res.status(403).json({ error: "管理员已关闭上传功能" });
  }

  const image = req.body?.image;
  if (!isValidImageDataUrl(image)) {
    return res.status(400).json({ error: "图片数据无效或过大" });
  }

  const item = {
    id: createId(),
    userId: req.user.id,
    username: req.user.username,
    image,
    prompt: normalizeText(req.body?.prompt, MAX_PROMPT_LENGTH),
    params: normalizeParams(req.body?.params),
    tags: normalizeTags(req.body?.tags),
    note: normalizeText(req.body?.note, MAX_NOTE_LENGTH),
    category: Array.isArray(req.body?.category)
      ? req.body.category.map((c) => normalizeText(c, 100)).filter(Boolean)
      : normalizeText(req.body?.category, 100)
        ? [normalizeText(req.body?.category, 100)]
        : [],
    source: normalizeText(req.body?.source, 50) || "",
    promptPublic: !!req.body?.promptPublic,
    rating: Math.max(1, Math.min(5, parseInt(req.body?.rating) || 3)),
    visibility: ["public", "users", "private"].includes(req.body?.visibility)
      ? req.body.visibility
      : "users",
    createdAt: Date.now(),
  };

  db.insertGalleryItem(item);

  console.log(`[上传] ${req.user.username} 上传了作品 ${item.id}`);

  res.json({
    id: item.id,
    username: item.username,
    prompt: item.prompt,
    params: item.params,
    tags: item.tags,
    note: item.note,
    category: item.category,
    source: item.source,
    createdAt: item.createdAt,
  });
});

app.put("/api/gallery/:id", requireAuth, (req, res) => {
  const item = db.getGalleryItem(req.params.id);

  if (!item) return res.status(404).json({ error: "作品不存在" });
  if (item.userId !== req.user.id && req.user.role !== "admin") {
    return res.status(403).json({ error: "无权限" });
  }

  const body = req.body || {};
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
  const fields = {};

  if (has("prompt")) fields.prompt = normalizeText(body.prompt, MAX_PROMPT_LENGTH);
  if (has("params")) fields.params = normalizeParams(body.params);
  if (has("tags")) fields.tags = normalizeTags(body.tags);
  if (has("note")) fields.note = normalizeText(body.note, MAX_NOTE_LENGTH);
  if (has("promptPublic")) fields.promptPublic = !!body.promptPublic;
  if (has("rating"))
    fields.rating = Math.max(1, Math.min(5, parseInt(body.rating) || 3));
  if (has("category")) {
    const rawCat = body.category;
    fields.category = Array.isArray(rawCat)
      ? rawCat.map((c) => normalizeText(c, 100)).filter(Boolean)
      : normalizeText(rawCat, 100)
        ? [normalizeText(rawCat, 100)]
        : [];
  }
  if (has("source")) fields.source = normalizeText(body.source, 50) || "";
  if (has("visibility")) {
    fields.visibility = ["public", "users", "private"].includes(
      body.visibility,
    )
      ? body.visibility
      : "public";
  }

  db.updateGalleryItem(req.params.id, fields);
  res.json({ ok: true });
});

// Batch update
app.patch("/api/admin/gallery/batch", requireAdmin, (req, res) => {
  const { ids, category, tags, addTags, removeTags, visibility } =
    req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: "请选择要修改的作品" });
  }
  if (ids.length > 500) {
    return res.status(400).json({ error: "单次最多修改500个" });
  }

  const opts = {};
  if (category !== undefined) {
    if (Array.isArray(category))
      opts.category = category.map((c) => normalizeText(c, 100)).filter(Boolean);
    else if (typeof category === "string" && category)
      opts.category = [normalizeText(category, 100)];
  }
  if (Array.isArray(tags)) opts.tags = normalizeTags(tags);
  if (Array.isArray(addTags))
    opts.addTags = addTags.map((t) => normalizeText(t, 50)).filter(Boolean);
  if (Array.isArray(removeTags)) opts.removeTags = removeTags;
  if (typeof visibility === "string") opts.visibility = visibility;

  const updated = db.batchUpdateGallery(ids, opts);
  console.log(`[管理] 批量更新 ${updated} 个作品`);
  res.json({ ok: true, updated });
});

// Batch delete
app.post("/api/admin/gallery/batch-delete", requireAdmin, (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: "请选择要删除的作品" });
  }
  if (ids.length > 500) {
    return res.status(400).json({ error: "单次最多删除500个" });
  }

  const deleted = db.batchDeleteGallery(ids);

  console.log(`[管理] 批量删除 ${deleted} 个作品`);
  res.json({ ok: true, deleted });
});

app.delete("/api/gallery/:id", requireAuth, (req, res) => {
  const item = db.getGalleryItem(req.params.id);

  if (!item) return res.status(404).json({ error: "作品不存在" });
  if (item.userId !== req.user.id && req.user.role !== "admin") {
    return res.status(403).json({ error: "无权限" });
  }

  db.deleteGalleryItem(req.params.id);

  console.log(`[删除] ${req.user.username} 删除了作品 ${req.params.id}`);
  res.json({ ok: true });
});

// ============ Comments ============
app.get("/api/gallery/:id/comments", (req, res) => {
  const isAdmin = req.user && req.user.role === "admin";
  const comments = db.listComments(req.params.id).filter((c) => {
    if (c.approved) return true;
    if (isAdmin) return true;
    if (req.user && req.user.id === c.userId) return true;
    return false;
  });
  res.json(comments);
});

app.post("/api/gallery/:id/comments", requireAuth, (req, res) => {
  const settings = getSettings();
  if (!settings.enableComments) {
    return res.status(403).json({ error: "评论功能已关闭" });
  }

  const content = normalizeText(req.body?.content, 500);
  if (!content) return res.status(400).json({ error: "评论不能为空" });

  if (!db.galleryExists(req.params.id))
    return res.status(404).json({ error: "作品不存在" });

  const comment = {
    id: createId(),
    itemId: req.params.id,
    userId: req.user.id,
    username: req.user.username,
    content,
    approved: settings.commentModeration ? req.user.role === "admin" : true,
    createdAt: Date.now(),
  };

  db.insertComment(comment);

  res.json(comment);
});

app.delete("/api/comments/:id", requireAuth, (req, res) => {
  const comment = db.getComment(req.params.id);

  if (!comment) return res.status(404).json({ error: "评论不存在" });
  if (comment.userId !== req.user.id && req.user.role !== "admin") {
    return res.status(403).json({ error: "无权限" });
  }

  db.deleteComment(req.params.id);
  res.json({ ok: true });
});

app.post(
  "/api/admin/comments/:id/approve",
  requireAuth,
  requireAdmin,
  (req, res) => {
    const comment = db.getComment(req.params.id);
    if (!comment) return res.status(404).json({ error: "评论不存在" });

    db.approveComment(req.params.id);
    res.json({ ok: true });
  },
);

// ============ Categories ============
app.get("/api/categories", (req, res) => {
  res.json(db.listCategoriesWithCount());
});

app.post("/api/admin/categories", requireAdmin, (req, res) => {
  const name = normalizeText(req.body?.name, 50);
  if (!name) return res.status(400).json({ error: "分类名称不能为空" });

  if (db.categoryByName(name)) {
    return res.status(400).json({ error: "分类已存在" });
  }

  const category = db.insertCategory(name);
  console.log(`[管理] 创建分类: ${name}`);
  res.json(category);
});

app.delete("/api/admin/categories/:id", requireAdmin, (req, res) => {
  const target = db.getCategory(req.params.id);
  if (!target) return res.status(404).json({ error: "分类不存在" });

  db.deleteCategory(req.params.id);
  console.log(`[管理] 删除分类: ${target.name}`);
  res.json({ ok: true });
});

app.patch("/api/admin/categories/:id", requireAdmin, (req, res) => {
  const newName = normalizeText(req.body?.name, 50);
  if (!newName) return res.status(400).json({ error: "分类名称不能为空" });

  const target = db.getCategory(req.params.id);
  if (!target) return res.status(404).json({ error: "分类不存在" });

  const dup = db.categoryByName(newName);
  if (dup && dup.id !== target.id) {
    return res.status(400).json({ error: "分类名称已存在" });
  }

  const oldName = target.name;
  const { updated } = db.renameCategory(target.id, newName);

  console.log(
    `[管理] 重命名分类: ${oldName} → ${newName} (${updated}个作品已更新)`,
  );
  res.json({ id: target.id, name: newName });
});

// ============ Tags ============
app.get("/api/tags", (req, res) => {
  res.json(db.listTagsWithCount());
});

app.post("/api/admin/tags", requireAdmin, (req, res) => {
  const name = normalizeText(req.body?.name, 50);
  if (!name) return res.status(400).json({ error: "标签名称不能为空" });

  if (db.tagByName(name)) {
    return res.status(400).json({ error: "标签已存在" });
  }

  const tag = db.insertTag(name);
  console.log(`[管理] 创建标签: ${name}`);
  res.json(tag);
});

app.delete("/api/admin/tags/:id", requireAdmin, (req, res) => {
  const target = db.getTag(req.params.id);
  if (!target) return res.status(404).json({ error: "标签不存在" });

  db.deleteTag(req.params.id);
  console.log(`[管理] 删除标签: ${target.name}`);
  res.json({ ok: true });
});

app.patch("/api/admin/tags/:id", requireAdmin, (req, res) => {
  const newName = normalizeText(req.body?.name, 50);
  if (!newName) return res.status(400).json({ error: "标签名称不能为空" });

  const target = db.getTag(req.params.id);
  if (!target) return res.status(404).json({ error: "标签不存在" });

  const dup = db.tagByName(newName);
  if (dup && dup.id !== target.id) {
    return res.status(400).json({ error: "标签名称已存在" });
  }

  const oldName = target.name;
  const { updated } = db.renameTag(target.id, newName);

  console.log(
    `[管理] 重命名标签: ${oldName} → ${newName} (${updated}个作品已更新)`,
  );
  res.json({ id: target.id, name: newName });
});

// Reorder categories
app.put("/api/admin/categories/reorder", requireAdmin, (req, res) => {
  const ids = req.body?.ids;
  if (!Array.isArray(ids))
    return res.status(400).json({ error: "需要 ids 数组" });
  if (!db.reorderCategories(ids))
    return res.status(400).json({ error: "ID 不匹配" });
  res.json({ ok: true });
});

// Reorder tags
app.put("/api/admin/tags/reorder", requireAdmin, (req, res) => {
  const ids = req.body?.ids;
  if (!Array.isArray(ids))
    return res.status(400).json({ error: "需要 ids 数组" });
  if (!db.reorderTags(ids))
    return res.status(400).json({ error: "ID 不匹配" });
  res.json({ ok: true });
});

app.get("/api/public/settings", (req, res) => {
  const settings = getSettings();

  // Auto-promote: if no admin exists, promote the first user
  if (!db.hasAdmin() && db.countUsers() > 0) {
    const first = db.firstUser();
    if (first) {
      db.promoteUser(first.id);
      console.log(`[自动提升] ${first.username} 已成为管理员`);
    }
  }

  res.json({
    allowRegister: settings.allowRegister,
    guestCanView: settings.guestCanView,
    disableDownload: settings.disableDownload,
    allowUpload: settings.allowUpload,
    enableLikes: settings.enableLikes,
    enableComments: settings.enableComments,
    theme: settings.theme || "default",
    siteName: settings.siteName || "MJ Gallery",
  });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`\n🎨 MJ Gallery 已启动`);
  console.log(`📍 地址: http://localhost:${PORT}`);
  console.log(`⏳ 等待用户连接...\n`);
});
