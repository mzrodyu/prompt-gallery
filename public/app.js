// ============================================
//  MJ Gallery - V2 (Refactored Frontend)
// ============================================

(function () {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => document.querySelectorAll(selector);

  // ============ State ============
  const PAGE_SIZE = 24;

  const TEXT = {
    login: "登录",
    register: "注册",
    username: "用户名",
    password: "密码",
    registerNow: "立即注册",
    goLogin: "去登录",
    guest: "以游客身份浏览",
    addWork: "添加作品",
    logout: "退出登录",
    admin: "管理",
    all: "全部",
    newest: "最新优先",
    oldest: "最早优先",
    worksUnit: "张作品",
    loadMore: "向下滚动加载更多",
    loading: "加载中...",
    allLoaded: "已加载全部作品",
    emptyTitle: "还没有收藏作品",
    emptyDesc: "点击“添加作品”或拖拽图片到此处开始上传",
    emptyAdd: "添加第一张作品",
    pendingTitle: "账号待审核",
    pendingDesc: "管理员审核通过后即可浏览内容",
    noMatch: "没有找到匹配的作品",
    loginFirst: "请先登录",
    inputCredential: "请输入用户名和密码",
    loginOk: "登录成功",
    registerOk: "注册成功",
    loginFail: "登录失败",
    registerFail: "注册失败",
    logoutOk: "已退出登录",
    selectImage: "请至少选择一张图片",
    saveFail: "保存失败",
    saveOk: "已保存 {count} 张作品",
    savePartial: "已保存 {ok}/{total} 张作品",
    copyOk: "提示词已复制",
    copyFail: "复制失败",
    downloadStart: "开始下载",
    deleteArtworkConfirm: "确定要删除这张作品吗？",
    deleteOk: "删除成功",
    deleteFail: "删除失败",
    settingsSaved: "设置已保存",
    settingsLoadFail: "加载设置失败",
    usersLoadFail: "加载用户失败",
    opFail: "操作失败",
    userApproved: "已批准",
    userRevoked: "已撤销",
    userDeleted: "用户已删除",
    deleteUserConfirm: "确定删除此用户？该用户所有作品也会被删除。",
  };

  let token = localStorage.getItem("mj_token") || null;
  let currentUser = null; // { id, username, role, approved }
  let galleryItems = []; // list without image data
  let currentFilter = "all";
  let currentSearch = "";
  let currentSort = "newest";
  let currentLightboxId = null;
  let pendingImages = [];
  let editingItemId = null;
  let disableDownload = false;
  let categories = [];
  let viewingUserId = null;
  let predefinedTags = [];
  const selectedCategories = new Set();

  let totalCount = 0;
  let hasMore = true;
  let isLoadingPage = false;
  let activeQueryKey = "";
  let requestSeq = 0;

  const imageCache = new Map();
  let dragCounter = 0;

  let cardImageObserver = null;
  let loadMoreObserver = null;

  // ============ Core Helpers ============
  function authHeaders() {
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  async function api(path, opts = {}) {
    const { returnResponse = false, ...fetchOpts } = opts;

    const res = await fetch(path, {
      ...fetchOpts,
      headers: { ...authHeaders(), ...fetchOpts.headers },
      body: fetchOpts.body ? JSON.stringify(fetchOpts.body) : undefined,
    });

    const data = await res.json();
    if (!res.ok) throw { status: res.status, ...data };

    if (returnResponse) return { data, response: res };
    return data;
  }

  async function fetchImageData(id) {
    if (imageCache.has(id)) return imageCache.get(id);

    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(`/api/gallery/${id}/image`, { headers });
    const data = await res.json();
    if (!res.ok) throw { status: res.status, ...data };

    if (!data.image) throw new Error("Missing image data");
    imageCache.set(id, data.image);
    return data.image;
  }

  function debounce(fn, wait = 120) {
    let timer = null;
    return (...args) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
  }

  function toast(message, type = "info") {
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.textContent = message;
    $("#toastContainer").appendChild(el);

    setTimeout(() => {
      el.classList.add("toast-exit");
      setTimeout(() => el.remove(), 300);
    }, 2500);
  }

  function escHtml(value) {
    if (!value) return "";
    const div = document.createElement("div");
    div.textContent = value;
    return div.innerHTML;
  }

  function parseTags(raw) {
    return (raw || "")
      .split(/[，,]/)
      .map((tag) => tag.trim())
      .filter(Boolean);
  }

  function formatText(template, vars = {}) {
    return template.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? ""));
  }

  function setText(selector, text) {
    const el = $(selector);
    if (el) el.textContent = text;
  }

  function setAttr(selector, attr, value) {
    const el = $(selector);
    if (el) el.setAttribute(attr, value);
  }

  function setButtonText(selector, text) {
    const btn = $(selector);
    if (!btn) return;

    for (const node of [...btn.childNodes]) {
      if (node.nodeType === Node.TEXT_NODE) btn.removeChild(node);
    }

    btn.append(document.createTextNode(text));
  }

  function applyChineseStaticText() {
    document.title = "MJ Gallery - Niji 图片收藏库";

    const desc = document.querySelector('meta[name="description"]');
    if (desc) {
      desc.setAttribute(
        "content",
        "存储和管理你的 MidJourney Niji 绘图作品，记录提示词与参数。",
      );
    }

    setText("#loginForm h2", TEXT.login);
    setText("#registerForm h2", TEXT.register);

    setText("#loginForm .form-group:nth-of-type(1) .form-label", TEXT.username);
    setText("#loginForm .form-group:nth-of-type(2) .form-label", TEXT.password);
    setAttr("#loginUsername", "placeholder", "输入用户名");
    setAttr("#loginPassword", "placeholder", "输入密码");

    setText(
      "#registerForm .form-group:nth-of-type(1) .form-label",
      TEXT.username,
    );
    setText(
      "#registerForm .form-group:nth-of-type(2) .form-label",
      TEXT.password,
    );
    setAttr("#regUsername", "placeholder", "2-20 字符");
    setAttr("#regPassword", "placeholder", "至少 4 位");

    setButtonText("#loginForm button[type='submit']", TEXT.login);
    setButtonText("#registerForm button[type='submit']", TEXT.register);
    setText("#showRegister", `没有账号？ ${TEXT.registerNow}`);
    setText("#showLogin", `已有账号？ ${TEXT.goLogin}`);
    setText("#guestLink span", TEXT.guest);

    setAttr("#searchInput", "placeholder", "搜索提示词、标签、备注...");
    setAttr("#searchClear", "title", "清除");
    setText(".stats-label", TEXT.worksUnit);

    setButtonText("#btnAdmin", TEXT.admin);
    setButtonText("#btnUpload", TEXT.addWork);
    setButtonText("#btnLogout", TEXT.logout);

    setText('.filter-tag[data-filter="all"]', TEXT.all);

    const newestOpt = document.querySelector(
      '#sortSelect option[value="newest"]',
    );
    const oldestOpt = document.querySelector(
      '#sortSelect option[value="oldest"]',
    );
    if (newestOpt) newestOpt.textContent = TEXT.newest;
    if (oldestOpt) oldestOpt.textContent = TEXT.oldest;

    setText("#emptyState h2", TEXT.emptyTitle);
    setText("#emptyState p", TEXT.emptyDesc);
    setButtonText("#btnEmptyUpload", TEXT.emptyAdd);
    setText("#pendingState h2", TEXT.pendingTitle);
    setText("#pendingState p", TEXT.pendingDesc);

    setText("#uploadModal .modal-header h2", TEXT.addWork);

    const uploadLabels = $$("#uploadModal .form-label");
    if (uploadLabels[0]) uploadLabels[0].textContent = "提示词 (Prompt)";
    if (uploadLabels[1]) uploadLabels[1].textContent = "Niji 参数";
    if (uploadLabels[2]) uploadLabels[2].textContent = "标签（逗号分隔）";
    if (uploadLabels[3]) uploadLabels[3].textContent = "备注";

    setButtonText("#uploadCancel", "取消");
    setButtonText("#uploadSave", "保存");

    setText(".lightbox-title", "作品详情");
    setButtonText("#lbCopyPrompt", "复制提示词");
    setButtonText("#lbDownload", "下载");
    setButtonText("#lbEdit", "编辑");
    setButtonText("#lbDelete", "删除");

    const adminTabs = $$(".admin-tab");
    if (adminTabs[0]) adminTabs[0].textContent = "站点设置";
    if (adminTabs[1]) adminTabs[1].textContent = "用户管理";
  }
  // ============ Auth Flow ============
  function isLoginPath() {
    return window.location.pathname === "/login";
  }

  async function checkAuth() {
    let publicSettings = { allowRegister: true, guestCanView: true };

    try {
      publicSettings = await api("/api/public/settings");
    } catch {
      // Keep defaults
    }

    disableDownload = !!publicSettings.disableDownload;

    // Apply theme
    document.documentElement.dataset.theme = publicSettings.theme || "default";

    // Apply site name
    const siteName = publicSettings.siteName || "MJ Gallery";
    $("#siteNameDisplay").textContent = siteName;
    document.title = siteName;

    // Load categories
    await loadCategories();

    if (!publicSettings.allowRegister) {
      $("#showRegister").style.display = "none";
      $("#registerForm").style.display = "none";
    } else {
      $("#showRegister").style.display = "";
    }

    $("#guestLink").style.display = publicSettings.guestCanView ? "" : "none";

    // If explicitly on /login, always show auth page
    if (isLoginPath() && !token) {
      showAuthPage();
      return;
    }

    if (!token) {
      if (publicSettings.guestCanView) showApp(null);
      else showAuthPage();
      return;
    }

    try {
      const data = await api("/api/auth/me");
      currentUser = data.user;
      showApp(currentUser);
    } catch {
      token = null;
      currentUser = null;
      localStorage.removeItem("mj_token");

      if (publicSettings.guestCanView) showApp(null);
      else showAuthPage();
    }
  }

  function showAuthPage() {
    $("#authPage").style.display = "";
    $("#authPage").classList.remove("hidden");
    $("#appWrapper").style.display = "none";
    if (window.location.pathname !== "/login") {
      history.pushState(null, "", "/login");
    }
  }

  function showApp(user) {
    $("#authPage").style.display = "none";
    $("#authPage").classList.add("hidden");
    $("#appWrapper").style.display = "";
    if (window.location.pathname === "/login") {
      history.pushState(null, "", "/");
    }

    currentUser = user;
    const btnLogin = $("#btnGuestLogin");

    if (user) {
      const avatarEl = $("#userAvatar");
      if (user.avatar) {
        avatarEl.innerHTML = `<img src="${user.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
      } else {
        avatarEl.innerHTML = `<span id="userInitial">${user.username[0]?.toUpperCase() || "?"}</span>`;
      }
      $("#dropdownUsername").textContent = user.username;
      $("#dropdownRole").textContent = user.role;
      $("#userMenu").style.display = "";
      $("#btnUpload").style.display = "";
      $("#btnAdmin").style.display = user.role === "admin" ? "" : "none";
      $("#btnBatchEdit").style.display = user.role === "admin" ? "" : "none";
      $("#btnEmptyUpload").style.display = "";
      if (btnLogin) btnLogin.style.display = "none";
    } else {
      $("#userMenu").style.display = "none";
      $("#btnUpload").style.display = "none";
      $("#btnAdmin").style.display = "none";
      $("#btnBatchEdit").style.display = "none";
      $("#btnEmptyUpload").style.display = "none";
      if (btnLogin) btnLogin.style.display = "";
    }

    loadGallery(true);
  }

  async function doLogin(event) {
    event.preventDefault();

    const username = $("#loginUsername").value.trim();
    const password = $("#loginPassword").value;

    if (!username || !password) {
      toast(TEXT.inputCredential, "error");
      return;
    }

    try {
      const data = await api("/api/auth/login", {
        method: "POST",
        body: { username, password },
      });

      token = data.token;
      currentUser = data.user;
      localStorage.setItem("mj_token", token);

      toast(`${TEXT.loginOk}，${data.user.username}`, "success");
      showApp(data.user);
    } catch (err) {
      toast(err.error || TEXT.loginFail, "error");
    }
  }

  async function doRegister(event) {
    event.preventDefault();

    const username = $("#regUsername").value.trim();
    const password = $("#regPassword").value;

    if (!username || !password) {
      toast(TEXT.inputCredential, "error");
      return;
    }

    try {
      const data = await api("/api/auth/register", {
        method: "POST",
        body: {
          username,
          password,
          referral: $("#regReferral").value,
          note: $("#regNote").value.trim(),
        },
      });

      token = data.token;
      currentUser = data.user;
      localStorage.setItem("mj_token", token);

      toast(`${TEXT.registerOk}，${data.user.username}`, "success");
      showApp(data.user);
    } catch (err) {
      toast(err.error || TEXT.registerFail, "error");
    }
  }

  function doLogout() {
    token = null;
    currentUser = null;
    localStorage.removeItem("mj_token");
    closeUserDropdown();
    toast(TEXT.logoutOk, "info");
    checkAuth();
  }

  // ============ Gallery Data ============
  function getLoadMoreHintEl() {
    let hint = $("#loadMoreHint");
    if (hint) return hint;

    hint = document.createElement("div");
    hint.id = "loadMoreHint";
    hint.style.padding = "22px 0 28px";
    hint.style.textAlign = "center";
    hint.style.fontSize = "12px";
    hint.style.color = "var(--text-muted)";

    const container = $("#galleryContainer");
    if (container) container.appendChild(hint);
    return hint;
  }

  function buildGalleryQuery(offset, limit) {
    const params = new URLSearchParams();
    params.set("offset", String(offset));
    params.set("limit", String(limit));
    params.set("sort", currentSort);

    if (currentSearch) params.set("q", currentSearch);
    if (currentFilter && currentFilter !== "all") {
      params.set("filter", currentFilter);
    }

    if (viewingUserId) params.set("userId", viewingUserId);

    return params.toString();
  }

  function currentQueryKey() {
    return `${currentSearch}__${currentFilter}__${currentSort}`;
  }

  function updateLoadMoreHint() {
    const hint = getLoadMoreHintEl();

    if (galleryItems.length === 0 && !isLoadingPage) {
      hint.style.display = "none";
      return;
    }

    hint.style.display = "";

    if (isLoadingPage) {
      hint.textContent = TEXT.loading;
      return;
    }

    if (hasMore) {
      hint.textContent = TEXT.loadMore;
      return;
    }

    hint.textContent = TEXT.allLoaded;
  }

  function setupLoadMoreObserver() {
    const hint = getLoadMoreHintEl();

    if (loadMoreObserver) loadMoreObserver.disconnect();

    loadMoreObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          if (!hasMore || isLoadingPage) continue;
          loadGallery(false);
        }
      },
      { root: null, rootMargin: "300px" },
    );

    loadMoreObserver.observe(hint);
  }

  async function loadGallery(reset = true) {
    const queryKey = currentQueryKey();

    if (reset || queryKey !== activeQueryKey) {
      activeQueryKey = queryKey;
      galleryItems = [];
      totalCount = 0;
      hasMore = true;
      imageCache.clear();
      renderGallery();
    }

    if (isLoadingPage || !hasMore) {
      updateLoadMoreHint();
      setupLoadMoreObserver();
      return;
    }

    isLoadingPage = true;
    updateLoadMoreHint();

    const reqId = ++requestSeq;

    try {
      const offset = galleryItems.length;
      const query = buildGalleryQuery(offset, PAGE_SIZE);

      const { data, response } = await api(`/api/gallery?${query}`, {
        returnResponse: true,
      });

      if (reqId !== requestSeq) return;

      const totalHeader = Number.parseInt(
        response.headers.get("x-total-count") || "",
        10,
      );
      totalCount = Number.isFinite(totalHeader)
        ? totalHeader
        : offset + data.length;

      const existing = new Set(galleryItems.map((item) => item.id));
      for (const item of data) {
        if (!existing.has(item.id)) galleryItems.push(item);
      }

      hasMore = galleryItems.length < totalCount && data.length > 0;
      if (data.length === 0) hasMore = false;

      const validIds = new Set(galleryItems.map((item) => item.id));
      for (const id of imageCache.keys()) {
        if (!validIds.has(id)) imageCache.delete(id);
      }

      renderGallery();
    } catch (err) {
      if (err.pendingApproval) {
        $("#emptyState").style.display = "none";
        $("#pendingState").style.display = "";
        $("#galleryGrid").classList.add("hidden");
        hasMore = false;
        loadPendingStatus();
      } else if (err.requireLogin) {
        showAuthPage();
      } else {
        if (galleryItems.length === 0) {
          toast(err.error || "加载画廊失败", "error");
        }
        hasMore = false;
      }
    } finally {
      isLoadingPage = false;
      updateLoadMoreHint();
    }
  }

  function renderGallery() {
    $("#pendingState").style.display = "none";
    $("#statsCount").textContent = String(totalCount || galleryItems.length);

    if (galleryItems.length === 0) {
      if (isLoadingPage) {
        $("#galleryGrid").classList.add("hidden");
        $("#emptyState").style.display = "none";
      } else {
        $("#emptyState").style.display = "";
        $("#galleryGrid").classList.add("hidden");
        $("#btnEmptyUpload").style.display = currentUser ? "" : "none";
      }
      updateLoadMoreHint();
      setupLoadMoreObserver();
      return;
    }

    $("#emptyState").style.display = "none";
    $("#galleryGrid").classList.remove("hidden");

    $("#galleryGrid").innerHTML = galleryItems
      .map((item, idx) => {
        const version = item.params?.version;
        const ar = item.params?.ar;
        const promptPreview = escHtml(
          (item.prompt || "").slice(0, 120) +
            ((item.prompt || "").length > 120 ? "..." : ""),
        );

        let tags = "";
        if (version)
          tags += `<span class="card-tag">${escHtml(version)}</span>`;
        if (ar) tags += `<span class="card-tag">${escHtml(ar)}</span>`;
        if (item.username) {
          tags += `<span class="card-tag card-tag-user" onclick="event.stopPropagation();app.viewUserProfile('${item.userId}')">@${escHtml(item.username)}</span>`;
        }

        const likeBadge =
          item.likeCount > 0
            ? `<div class="card-like-badge"><svg viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>${item.likeCount}</div>`
            : "";

        // Rarity based on manual rating (1-5)
        const rt = item.rating || 3;
        const rarity =
          rt >= 5
            ? "legendary"
            : rt >= 4
              ? "epic"
              : rt >= 3
                ? "rare"
                : rt >= 2
                  ? "uncommon"
                  : "common";
        const stars = "★".repeat(rt);

        return `
          <div class="gallery-card" data-id="${item.id}" data-rarity="${rarity}" onclick="app.openLightbox('${item.id}')">
            <img data-src="/api/gallery/${item.id}/image" alt="MJ Art" loading="lazy" />
            ${likeBadge}
            <div class="card-stars">${stars}</div>
            <div class="card-overlay">
              <div class="card-prompt">${promptPreview || TEXT.noMatch}</div>
              <div class="card-meta">${tags}</div>
            </div>
          </div>`;
      })
      .join("");

    lazyLoadImages();
    updateLoadMoreHint();
    setupLoadMoreObserver();
  }

  function lazyLoadImages() {
    const images = $$(".gallery-card img[data-src]");

    if (cardImageObserver) cardImageObserver.disconnect();

    cardImageObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;

          const img = entry.target;
          const url = img.dataset.src;
          loadCardImage(img, url);
          cardImageObserver.unobserve(img);
        }
      },
      { rootMargin: "200px" },
    );

    images.forEach((img) => cardImageObserver.observe(img));
  }

  async function loadCardImage(imgEl, url) {
    const id = url.split("/").slice(-2, -1)[0];

    try {
      if (id) {
        const image = await fetchImageData(id);
        imgEl.src = image;
        imgEl.removeAttribute("data-src");
        imgEl.style.opacity = "1";
        return;
      }

      const headers = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(url, { headers });
      const data = await res.json();
      if (data.image) {
        imgEl.src = data.image;
        imgEl.removeAttribute("data-src");
        imgEl.style.opacity = "1";
      }
    } catch {
      // Silent by design
    }
  }

  // ============ Smart Prompt Parser ============
  function parsePromptParams() {
    const textarea = $("#inputPrompt");
    let text = textarea.value;
    if (!text) return;

    // Extract MJ params from prompt
    const paramMap = {};

    // --ar X:Y
    const arMatch = text.match(/--ar\s+([\d.:]+)/i);
    if (arMatch) {
      paramMap.ar = arMatch[1];
      text = text.replace(arMatch[0], "");
    }

    // --niji X or --niji (defaults to latest)
    const nijiMatch = text.match(/--niji\s*(\d*)/i);
    if (nijiMatch) {
      const ver = nijiMatch[1] || "7";
      paramMap.version = `niji ${ver}`;
      text = text.replace(nijiMatch[0], "");
    }

    // --v X or --version X
    const vMatch = text.match(/--(?:v|version)\s+([\d.]+)/i);
    if (vMatch) {
      paramMap.version = vMatch[1];
      text = text.replace(vMatch[0], "");
    }

    // --s X or --stylize X
    const sMatch = text.match(/--(?:s|stylize)\s+(\d+)/i);
    if (sMatch) {
      paramMap.stylize = sMatch[1];
      text = text.replace(sMatch[0], "");
    }

    // --q X or --quality X
    const qMatch = text.match(/--(?:q|quality)\s+([\d.]+)/i);
    if (qMatch) {
      paramMap.quality = qMatch[1];
      text = text.replace(qMatch[0], "");
    }

    // --c X or --chaos X
    const cMatch = text.match(/--(?:c|chaos)\s+(\d+)/i);
    if (cMatch) {
      paramMap.chaos = cMatch[1];
      text = text.replace(cMatch[0], "");
    }

    // --seed X
    const seedMatch = text.match(/--seed\s+(\d+)/i);
    if (seedMatch) {
      paramMap.seed = seedMatch[1];
      text = text.replace(seedMatch[0], "");
    }

    // --raw (boolean flag)
    if (/--raw\b/i.test(text)) {
      text = text.replace(/--raw\b/i, "");
      paramMap.raw = true;
    }

    // --profile X or --p X
    const profileMatch = text.match(/--(?:profile|p)\s+(\S+)/i);
    if (profileMatch) {
      paramMap.profile = profileMatch[1];
      text = text.replace(profileMatch[0], "");
    }

    // --no X (negative prompt)
    const noMatch = text.match(/--no\s+(.+?)(?=\s--|$)/i);
    if (noMatch) {
      paramMap.no = noMatch[1].trim();
      text = text.replace(noMatch[0], "");
    }

    // Check if any params were found
    const hasParams =
      Object.keys(paramMap).length > 0 || /--raw\b/i.test(textarea.value);
    if (!hasParams) return;

    // Auto-set source to MJ if MJ params detected
    const sourceEl = $("#inputSource");
    if (!sourceEl.value) {
      sourceEl.value = "mj";
      toggleSourceParams("mj");
    }

    // Fill in fields
    if (paramMap.ar) $("#paramAr").value = paramMap.ar;
    if (paramMap.version) {
      // Try to match a select option
      const versionEl = $("#paramVersion");
      const opts = Array.from(versionEl.options).map((o) => o.value);
      if (opts.includes(paramMap.version)) {
        versionEl.value = paramMap.version;
      }
    }
    if (paramMap.stylize) $("#paramStylize").value = paramMap.stylize;
    if (paramMap.quality) $("#paramQuality").value = paramMap.quality;
    if (paramMap.chaos) $("#paramChaos").value = paramMap.chaos;
    if (paramMap.seed) $("#paramSeed").value = paramMap.seed;
    if (paramMap.profile) $("#paramProfile").value = paramMap.profile;

    // Clean up prompt text — remove extra spaces
    textarea.value = text.replace(/\s{2,}/g, " ").trim();

    let count = Object.keys(paramMap).length;
    if (count > 0) toast(`已识别 ${count} 个参数并自动填入`, "success");
  }

  // ============ Upload ============
  function resetUploadForm() {
    pendingImages = [];
    editingItemId = null;
    $("#uploadModalTitle").textContent = "添加作品";
    $("#uploadSave").innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12" /></svg> 保存';
    $("#uploadPreview").src = "";
    $("#uploadZone").classList.remove("has-image");
    $("#inputPrompt").value = "";
    $("#paramAr").value = "";
    $("#paramVersion").value = "";
    $("#paramStylize").value = "";
    $("#paramQuality").value = "";
    $("#paramChaos").value = "";
    $("#paramSeed").value = "";
    $("#paramSDModel").value = "";
    $("#paramSDSampler").value = "";
    $("#paramSDSteps").value = "";
    $("#paramSDCfg").value = "";
    $("#paramSDSeed").value = "";
    $("#paramSDSize").value = "";
    $("#paramNAIModel").value = "";
    $("#paramNAISampler").value = "";
    $("#paramNAISteps").value = "";
    $("#paramNAICfg").value = "";
    $("#paramNAISeed").value = "";
    $("#paramNAISize").value = "";
    $("#inputNote").value = "";
    $("#inputCategory").value = "";
    $("#inputSource").value = "";
    $("#inputVisibility").value = "public";
    $("#uploadFileInput").value = "";
    setSelectedTags([]);
    toggleSourceParams("");
  }

  function toggleSourceParams(source) {
    $("#paramsMJ").style.display = source === "mj" ? "" : "none";
    $("#paramsSD").style.display =
      source === "sd" || source === "comfyui" ? "" : "none";
    $("#paramsNAI").style.display = source === "nai" ? "" : "none";
  }

  async function openUploadModal() {
    if (!currentUser) {
      toast(TEXT.loginFirst, "error");
      return;
    }

    resetUploadForm();
    await loadTags();
    await loadCategories();
    $("#uploadModal").classList.add("active");
    document.body.style.overflow = "hidden";
  }

  function closeUploadModal() {
    $("#uploadModal").classList.remove("active");
    document.body.style.overflow = "";
  }

  function handleFiles(files) {
    if (!files || files.length === 0) return;

    pendingImages = [];
    let loaded = 0;
    const imageFiles = Array.from(files).filter((file) =>
      file.type.startsWith("image/"),
    );

    for (const file of imageFiles) {
      const reader = new FileReader();
      reader.onload = (event) => {
        pendingImages.push(event.target.result);
        loaded += 1;

        if (loaded === 1) {
          $("#uploadPreview").src = event.target.result;
          $("#uploadZone").classList.add("has-image");
        }

        if (loaded === imageFiles.length && imageFiles.length > 1) {
          toast(
            formatText("已选择 {count} 张图片", { count: imageFiles.length }),
            "info",
          );
        }
      };
      reader.readAsDataURL(file);
    }
  }

  async function saveUpload() {
    if (pendingImages.length === 0) {
      toast(TEXT.selectImage, "error");
      return;
    }

    const prompt = $("#inputPrompt").value.trim();
    const source = $("#inputSource").value;
    const params = {};

    if (source === "mj" || !source) {
      const ar = $("#paramAr").value.trim();
      const version = $("#paramVersion").value;
      const stylize = $("#paramStylize").value;
      const quality = $("#paramQuality").value;
      const chaos = $("#paramChaos").value;
      const seed = $("#paramSeed").value;
      const profile = $("#paramProfile").value.trim();
      if (ar) params.ar = ar;
      if (version) params.version = version;
      if (stylize) params.stylize = Number(stylize);
      if (quality) params.quality = quality;
      if (chaos) params.chaos = Number(chaos);
      if (seed) params.seed = Number(seed);
      if (profile) params.profile = profile;
    } else if (source === "sd" || source === "comfyui") {
      const m = $("#paramSDModel").value.trim();
      const s = $("#paramSDSampler").value.trim();
      const st = $("#paramSDSteps").value;
      const c = $("#paramSDCfg").value;
      const se = $("#paramSDSeed").value;
      const sz = $("#paramSDSize").value.trim();
      if (m) params.model = m;
      if (s) params.sampler = s;
      if (st) params.steps = Number(st);
      if (c) params.cfg = Number(c);
      if (se) params.seed = Number(se);
      if (sz) params.size = sz;
    } else if (source === "nai") {
      const m = $("#paramNAIModel").value.trim();
      const s = $("#paramNAISampler").value.trim();
      const st = $("#paramNAISteps").value;
      const c = $("#paramNAICfg").value;
      const se = $("#paramNAISeed").value;
      const sz = $("#paramNAISize").value.trim();
      if (m) params.model = m;
      if (s) params.sampler = s;
      if (st) params.steps = Number(st);
      if (c) params.guidance = Number(c);
      if (se) params.seed = Number(se);
      if (sz) params.size = sz;
    }

    const tags = getSelectedTags();
    const note = $("#inputNote").value.trim();
    const category = [...selectedCategories];
    const visibility = $("#inputVisibility").value;
    const promptPublic = $("#inputPromptPublic").checked;
    const rating = parseInt($("#inputRating").value) || 3;

    try {
      // Edit mode: update existing item via PUT
      if (editingItemId) {
        $("#uploadSave").disabled = true;
        $("#uploadSave").textContent = "保存中...";
        await api(`/api/gallery/${editingItemId}`, {
          method: "PUT",
          body: {
            prompt,
            params,
            tags,
            note,
            category,
            source,
            visibility,
            promptPublic,
            rating,
          },
        });
        toast("修改已保存", "success");
        editingItemId = null;
        closeUploadModal();
        loadGallery(true);
        return;
      }

      const total = pendingImages.length;
      let successCount = 0;
      let lastError = null;

      // Show progress bar
      $("#uploadProgress").style.display = "";
      $("#uploadTotal").textContent = total;
      $("#uploadCurrent").textContent = "0";
      $("#uploadProgressFill").style.width = "0%";
      $("#uploadSave").disabled = true;
      $("#uploadSave").textContent = "上传中...";

      for (let i = 0; i < total; i++) {
        try {
          await api("/api/gallery", {
            method: "POST",
            body: {
              image: pendingImages[i],
              prompt,
              params,
              tags,
              note,
              category,
              source,
              visibility,
              promptPublic,
              rating,
            },
          });
          successCount++;
        } catch (err) {
          lastError = err;
        }

        // Update progress
        $("#uploadCurrent").textContent = i + 1;
        $("#uploadProgressFill").style.width =
          Math.round(((i + 1) / total) * 100) + "%";
      }

      // Reset button
      $("#uploadSave").disabled = false;
      $("#uploadSave").innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12" /></svg> 保存';
      $("#uploadProgress").style.display = "none";

      if (successCount === 0) {
        throw lastError || { error: TEXT.saveFail };
      }

      if (successCount < total) {
        toast(
          formatText(TEXT.savePartial, {
            ok: successCount,
            total: total,
          }),
          "info",
        );
      } else {
        toast(formatText(TEXT.saveOk, { count: successCount }), "success");
      }

      closeUploadModal();
      loadGallery(true);
    } catch (err) {
      $("#uploadSave").disabled = false;
      $("#uploadSave").innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12" /></svg> 保存';
      $("#uploadProgress").style.display = "none";
      toast(err.error || TEXT.saveFail, "error");
    }
  }

  // ============ Lightbox ============
  function closeLightbox() {
    $("#lightboxModal").classList.remove("active");
    document.body.style.overflow = "";
    currentLightboxId = null;
  }

  function buildPromptWithParams(item) {
    let fullPrompt = item.prompt || "";
    const p = item.params || {};

    if (p.ar) fullPrompt += ` --ar ${p.ar}`;
    if (p.version) fullPrompt += ` --${p.version}`;
    if (p.stylize !== undefined) fullPrompt += ` --s ${p.stylize}`;
    if (p.quality) fullPrompt += ` --q ${p.quality}`;
    if (p.chaos !== undefined) fullPrompt += ` --c ${p.chaos}`;
    if (p.seed !== undefined) fullPrompt += ` --seed ${p.seed}`;
    if (p.profile) fullPrompt += ` --profile ${p.profile}`;

    return fullPrompt;
  }

  async function openLightbox(id) {
    const item = galleryItems.find((g) => g.id === id);
    if (!item) return;

    currentLightboxId = id;
    $("#lightboxImage").src = "";

    try {
      $("#lightboxImage").src = await fetchImageData(id);
    } catch {
      // Keep empty if failed
    }

    $("#lbPrompt").textContent = item.prompt || "提示词未公开";

    const p = item.params || {};
    let paramsHtml = "";

    // MJ params
    if (p.version)
      paramsHtml += `<span class="param-badge">--niji ${escHtml(String(p.version).replace("niji ", ""))}</span>`;
    if (p.ar)
      paramsHtml += `<span class="param-badge">--ar ${escHtml(p.ar)}</span>`;
    if (p.stylize !== undefined)
      paramsHtml += `<span class="param-badge">--s ${p.stylize}</span>`;
    if (p.quality)
      paramsHtml += `<span class="param-badge">--q ${p.quality}</span>`;
    if (p.chaos !== undefined)
      paramsHtml += `<span class="param-badge">--c ${p.chaos}</span>`;
    if (p.profile)
      paramsHtml += `<span class="param-badge">--profile ${escHtml(p.profile)}</span>`;
    // SD/NAI/shared params
    if (p.model)
      paramsHtml += `<span class="param-badge">Model: ${escHtml(p.model)}</span>`;
    if (p.sampler)
      paramsHtml += `<span class="param-badge">Sampler: ${escHtml(p.sampler)}</span>`;
    if (p.steps !== undefined)
      paramsHtml += `<span class="param-badge">Steps: ${p.steps}</span>`;
    if (p.cfg !== undefined)
      paramsHtml += `<span class="param-badge">CFG: ${p.cfg}</span>`;
    if (p.guidance !== undefined)
      paramsHtml += `<span class="param-badge">Guidance: ${p.guidance}</span>`;
    if (p.size)
      paramsHtml += `<span class="param-badge">Size: ${escHtml(p.size)}</span>`;
    if (p.seed !== undefined)
      paramsHtml += `<span class="param-badge">Seed: ${p.seed}</span>`;

    $("#lbParams").innerHTML =
      paramsHtml ||
      '<span style="color:var(--text-muted);font-size:12px;">无参数</span>';

    if (Array.isArray(item.tags) && item.tags.length > 0) {
      $("#lbTagsSection").style.display = "";
      $("#lbTags").innerHTML = item.tags
        .map((tag) => `<span class="info-tag">${escHtml(tag)}</span>`)
        .join("");
    } else {
      $("#lbTagsSection").style.display = "none";
    }

    if (item.note) {
      $("#lbNoteSection").style.display = "";
      $("#lbNote").textContent = item.note;
    } else {
      $("#lbNoteSection").style.display = "none";
    }

    $("#lbUser").textContent = item.username || "-";
    $("#lbTime").textContent = new Date(item.createdAt).toLocaleString("zh-CN");

    const canEdit =
      currentUser &&
      (currentUser.role === "admin" || currentUser.id === item.userId);

    $("#lbEdit").style.display = canEdit ? "" : "none";
    $("#lbDelete").style.display = canEdit ? "" : "none";
    $("#lbCopyPrompt").style.display = currentUser ? "" : "none";

    // Like state
    const lbLike = $("#lbLike");
    lbLike.style.display = currentUser ? "" : "none";
    $("#lbLikeCount").textContent = item.likeCount || 0;
    lbLike.classList.toggle("liked", !!item.liked);

    // Hide download if disableDownload is on and user is not admin
    const isAdmin = currentUser && currentUser.role === "admin";
    $("#lbDownload").style.display = disableDownload && !isAdmin ? "none" : "";

    $("#lightboxModal").classList.add("active");
    document.body.style.overflow = "hidden";
    loadComments(id);
  }

  function copyPrompt() {
    const item = galleryItems.find((g) => g.id === currentLightboxId);
    if (!item) return;

    const fullPrompt = buildPromptWithParams(item);
    navigator.clipboard
      .writeText(fullPrompt)
      .then(() => toast(TEXT.copyOk, "success"))
      .catch(() => toast(TEXT.copyFail, "error"));
  }

  async function toggleLike() {
    if (!currentLightboxId || !currentUser) return;

    try {
      const result = await api(`/api/gallery/${currentLightboxId}/like`, {
        method: "POST",
      });

      // Update local item data
      const item = galleryItems.find((g) => g.id === currentLightboxId);
      if (item) {
        item.liked = result.liked;
        item.likeCount = result.likeCount;
      }

      $("#lbLikeCount").textContent = result.likeCount;
      $("#lbLike").classList.toggle("liked", result.liked);
    } catch (err) {
      toast(err.error || TEXT.opFail, "error");
    }
  }

  async function loadComments(itemId) {
    try {
      const comments = await api(`/api/gallery/${itemId}/comments`);
      $("#commentCount").textContent = comments.length;
      $("#commentInput").style.display = currentUser ? "" : "none";
      $("#commentText").value = "";

      $("#commentsList").innerHTML =
        comments.length === 0
          ? '<div style="color:var(--text-dim);font-size:13px">暂无评论</div>'
          : comments
              .map((c) => {
                const canDel =
                  currentUser &&
                  (currentUser.id === c.userId || currentUser.role === "admin");
                const isAdmin = currentUser && currentUser.role === "admin";
                const isPending = c.approved === false;
                const time = new Date(c.createdAt).toLocaleString("zh-CN");
                return `<div class="comment-item${isPending ? " comment-pending" : ""}">
            <div class="comment-top">
              <span class="comment-user">@${escHtml(c.username)}${isPending ? ' <span style="color:#ffa502;font-size:11px">待审核</span>' : ""}</span>
              <span>
                <span class="comment-time">${time}</span>
                ${isPending && isAdmin ? `<button class="comment-delete" style="color:var(--accent)" onclick="app.approveComment('${c.id}')">通过</button>` : ""}
                ${canDel ? `<button class="comment-delete" onclick="app.deleteComment('${c.id}')">删除</button>` : ""}
              </span>
            </div>
            <div class="comment-content">${escHtml(c.content)}</div>
          </div>`;
              })
              .join("");
    } catch {
      $("#commentsList").innerHTML = "";
      $("#commentCount").textContent = "0";
    }
  }

  async function postComment() {
    if (!currentLightboxId || !currentUser) return;
    const input = $("#commentText");
    const content = input.value.trim();
    if (!content) return;

    try {
      await api(`/api/gallery/${currentLightboxId}/comments`, {
        method: "POST",
        body: { content },
      });
      input.value = "";
      await loadComments(currentLightboxId);
    } catch (err) {
      toast(err.error || TEXT.opFail, "error");
    }
  }

  async function deleteComment(commentId) {
    try {
      await api(`/api/comments/${commentId}`, { method: "DELETE" });
      if (currentLightboxId) await loadComments(currentLightboxId);
    } catch (err) {
      toast(err.error || TEXT.opFail, "error");
    }
  }

  async function approveComment(commentId) {
    try {
      await api(`/api/admin/comments/${commentId}/approve`, { method: "POST" });
      if (currentLightboxId) await loadComments(currentLightboxId);
    } catch (err) {
      toast(err.error || TEXT.opFail, "error");
    }
  }

  async function viewUserProfile(userId) {
    try {
      const profile = await api(`/api/users/${userId}/profile`);
      viewingUserId = userId;

      // Hide gallery, show profile page
      $("#topBar").style.display = "none";
      $("#galleryContainer").style.display = "none";
      $("#profilePage").style.display = "";

      // Fill profile header
      if (profile.avatar) {
        $("#profileAvatar").innerHTML =
          `<img src="${profile.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
      } else {
        $("#profileAvatar").textContent =
          profile.username[0]?.toUpperCase() || "?";
      }
      $("#profileName").textContent = profile.username;
      $("#profileBadge").textContent =
        profile.role === "admin" ? "ADMIN" : "USER";
      // Show title badge
      const titleEl = $("#profileTitle");
      if (titleEl) {
        if (profile.title) {
          titleEl.textContent = profile.title;
          titleEl.style.display = "";
        } else {
          titleEl.style.display = "none";
        }
      }
      $("#profileWorks").textContent = String(profile.workCount);
      $("#profileLikes").textContent = String(profile.totalLikes);
      $("#profileJoined").textContent = profile.createdAt
        ? new Date(profile.createdAt).toLocaleDateString("zh-CN")
        : "-";

      // Load user's works
      const data = await api(`/api/gallery?userId=${userId}&limit=200`);
      const items = data.items || data;

      if (items.length === 0) {
        $("#profileGrid").innerHTML = "";
        $("#profileEmpty").style.display = "";
      } else {
        $("#profileEmpty").style.display = "none";
        $("#profileGrid").innerHTML = items
          .map(
            (item) => `
          <div class="gallery-card" data-id="${item.id}" onclick="app.openLightbox('${item.id}')">
            <img data-src="/api/gallery/${item.id}/image" alt="MJ Art" loading="lazy" />
            ${
              item.likeCount > 0
                ? `<div class="card-like-badge"><svg viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>${item.likeCount}</div>`
                : ""
            }
            <div class="card-overlay">
              <div class="card-prompt">${escHtml((item.prompt || "").slice(0, 120))}</div>
            </div>
          </div>`,
          )
          .join("");

        // Lazy load profile images
        $$("#profileGrid img[data-src]").forEach((imgEl) => {
          loadCardImage(imgEl, imgEl.dataset.src);
        });
      }
    } catch (err) {
      toast(err.error || TEXT.opFail, "error");
    }
  }

  function clearUserProfile() {
    viewingUserId = null;
    $("#profilePage").style.display = "none";
    $("#topBar").style.display = "";
    $("#galleryContainer").style.display = "";
  }

  async function loadPendingStatus() {
    try {
      const data = await api("/api/auth/pending-status");
      $("#pendingPosition").textContent = data.position || "—";
    } catch {
      $("#pendingPosition").textContent = "—";
    }

    // Show reject reason if rejected
    if (currentUser && currentUser.rejectReason) {
      const titleEl = $("#pendingState h2");
      const badgeEl = $("#pendingState .pending-badge");
      if (titleEl) titleEl.textContent = "审核未通过";
      if (badgeEl) {
        badgeEl.textContent = "● REJECTED";
        badgeEl.style.background = "rgba(239, 68, 68, 0.15)";
        badgeEl.style.color = "#ef4444";
      }
      // Show reason
      let reasonEl = $("#pendingRejectReason");
      if (!reasonEl) {
        reasonEl = document.createElement("div");
        reasonEl.id = "pendingRejectReason";
        reasonEl.style.cssText =
          "margin-top:16px;padding:12px 16px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);border-radius:10px;color:#ef4444;font-size:13px;text-align:center";
        const card = $("#pendingState .pending-card");
        if (card) card.appendChild(reasonEl);
      }
      reasonEl.textContent = "拒绝原因：" + currentUser.rejectReason;

      // Show re-apply button if allowed
      const limit = currentUser.reapplyLimit || 0;
      const count = currentUser.reapplyCount || 0;
      const remaining = limit - count;
      let reapplyEl = $("#pendingReapply");
      if (!reapplyEl) {
        reapplyEl = document.createElement("div");
        reapplyEl.id = "pendingReapply";
        reapplyEl.style.cssText = "margin-top:16px;text-align:center";
        const card = $("#pendingState .pending-card");
        if (card) card.appendChild(reapplyEl);
      }
      if (remaining > 0) {
        reapplyEl.innerHTML = `
          <div style="font-size:12px;color:var(--text-dim);margin-bottom:8px">剩余 ${remaining} 次重新申请机会</div>
          <textarea id="reapplyReason" placeholder="请说明重新申请的理由..." style="width:100%;min-height:60px;padding:8px 12px;border-radius:8px;border:1px solid var(--border);background:var(--bg-tertiary);color:var(--text);font-size:13px;resize:vertical;margin-bottom:8px"></textarea>
          <button class="btn btn-primary btn-sm" id="btnReapply">提交重新申请</button>`;
        setTimeout(() => {
          const btn = $("#btnReapply");
          if (btn)
            btn.onclick = async () => {
              const reason = $("#reapplyReason")?.value?.trim();
              if (!reason) {
                toast("请填写申请理由", "error");
                return;
              }
              try {
                await api("/api/auth/reapply", {
                  method: "POST",
                  body: { reason },
                });
                toast("已重新申请，请等待审核", "success");
                // Refresh user state
                const res = await api("/api/auth/me");
                currentUser = res;
                loadPendingStatus();
              } catch (err) {
                toast(err.error || "申请失败", "error");
              }
            };
        }, 0);
      } else if (limit > 0) {
        reapplyEl.innerHTML =
          '<div style="font-size:12px;color:var(--text-dim)">重新申请次数已用完</div>';
      } else {
        reapplyEl.innerHTML =
          '<div style="font-size:12px;color:var(--text-dim)">管理员未开放重新申请</div>';
      }
    }
  }

  function downloadImage() {
    const img = $("#lightboxImage");
    if (!img.src) return;

    const a = document.createElement("a");
    a.href = img.src;
    a.download = `mj_${currentLightboxId}.png`;
    a.click();

    toast(TEXT.downloadStart, "info");
  }

  async function editItem() {
    const item = galleryItems.find((g) => g.id === currentLightboxId);
    if (!item) return;

    closeLightbox();
    await openUploadModal();

    // Set edit mode AFTER openUploadModal (which calls resetUploadForm)
    editingItemId = item.id;

    // Change modal title
    $("#uploadModalTitle").textContent = "编辑作品";

    // Show existing image via URL instead of downloading base64
    $("#uploadPreview").src = `/api/gallery/${item.id}/image`;
    $("#uploadZone").classList.add("has-image");
    pendingImages = ["__KEEP_EXISTING__"];

    // Fill prompt
    $("#inputPrompt").value = item.prompt || "";

    // Fill source and show corresponding params
    const source = item.source || "";
    $("#inputSource").value = source;
    toggleSourceParams(source);

    // Fill params based on source
    const p = item.params || {};
    if (source === "mj" || !source) {
      $("#paramAr").value = p.ar || "";
      $("#paramVersion").value = p.version || "";
      $("#paramStylize").value = p.stylize !== undefined ? p.stylize : "";
      $("#paramQuality").value = p.quality || "";
      $("#paramChaos").value = p.chaos !== undefined ? p.chaos : "";
      $("#paramSeed").value = p.seed !== undefined ? p.seed : "";
      $("#paramProfile").value = p.profile || "";
    } else if (source === "sd" || source === "comfyui") {
      $("#paramSDModel").value = p.model || "";
      $("#paramSDSampler").value = p.sampler || "";
      $("#paramSDSteps").value = p.steps !== undefined ? p.steps : "";
      $("#paramSDCfg").value = p.cfg !== undefined ? p.cfg : "";
      $("#paramSDSeed").value = p.seed !== undefined ? p.seed : "";
      $("#paramSDSize").value = p.size || "";
    } else if (source === "nai") {
      $("#paramNAIModel").value = p.model || "";
      $("#paramNAISampler").value = p.sampler || "";
      $("#paramNAISteps").value = p.steps !== undefined ? p.steps : "";
      $("#paramNAICfg").value = p.guidance !== undefined ? p.guidance : "";
      $("#paramNAISeed").value = p.seed !== undefined ? p.seed : "";
      $("#paramNAISize").value = p.size || "";
    }

    // Fill tags, category, note, visibility
    setSelectedTags(item.tags || []);
    $("#inputNote").value = item.note || "";
    // Populate category chips from array
    selectedCategories.clear();
    const cats = Array.isArray(item.category)
      ? item.category
      : item.category
        ? [item.category]
        : [];
    cats.forEach((c) => selectedCategories.add(c));
    renderCategoryChips();
    $("#inputVisibility").value = item.visibility || "users";
    $("#inputPromptPublic").checked = !!item.promptPublic;
    $("#inputRating").value = item.rating || 3;

    // Update button text
    $("#uploadSave").innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12" /></svg> 保存修改';
  }

  async function deleteItem() {
    if (!currentLightboxId) return;
    if (!confirm(TEXT.deleteArtworkConfirm)) return;

    try {
      await api(`/api/gallery/${currentLightboxId}`, { method: "DELETE" });
      imageCache.delete(currentLightboxId);
      toast(TEXT.deleteOk, "info");
      closeLightbox();
      loadGallery(true);
    } catch (err) {
      toast(err.error || TEXT.deleteFail, "error");
    }
  }

  // ============ Avatar ============
  async function uploadAvatar(file) {
    if (!file || !file.type.startsWith("image/")) return;
    if (file.size > 400 * 1024) {
      toast("头像文件过大（最大 400KB）", "error");
      return;
    }
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const res = await api("/api/user/avatar", {
          method: "POST",
          body: { avatar: e.target.result },
        });
        if (currentUser) currentUser.avatar = res.avatar;
        const avatarEl = $("#userAvatar");
        avatarEl.innerHTML = `<img src="${res.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
        toast("头像已更新", "info");
      } catch (err) {
        toast(err.error || "头像上传失败", "error");
      }
    };
    reader.readAsDataURL(file);
  }

  // ============ Admin ============
  const adminTitles = {
    adminDashboard: "仪表盘",
    adminSettings: "站点设置",
    adminUsers: "用户管理",
    adminCategories: "分类管理",
    adminTags: "标签管理",
  };

  async function openAdmin() {
    if (!currentUser || currentUser.role !== "admin") return;

    // Hide gallery, show admin dashboard
    $("#topBar").style.display = "none";
    $("#galleryContainer").style.display = "none";
    $("#adminModal").style.display = "flex";
    document.body.style.overflow = "hidden";

    // Load dashboard stats
    try {
      const stats = await api("/api/admin/stats");
      $("#dashUsers").textContent = String(stats.users || 0);
      $("#dashWorks").textContent = String(stats.works || 0);
      $("#dashLikes").textContent = String(stats.likes || 0);
      $("#dashTags").textContent = String(stats.tags || 0);
    } catch {}

    await loadAdminSettings();
    await loadAdminUsers();
    renderAdminCategories();
    await loadTags();
    renderAdminTags();
  }

  function closeAdmin() {
    $("#adminModal").style.display = "none";
    $("#topBar").style.display = "";
    $("#galleryContainer").style.display = "";
    document.body.style.overflow = "";
  }

  function switchAdminPanel(panelName) {
    $$(".admin-panel").forEach((p) => p.classList.remove("active"));
    $$(".admin-nav-item[data-panel]").forEach((b) =>
      b.classList.remove("active"),
    );
    const panel = $(`#panel-${panelName}`);
    if (panel) panel.classList.add("active");
    const navBtn = $(`.admin-nav-item[data-panel="${panelName}"]`);
    if (navBtn) navBtn.classList.add("active");
    const titleEl = $("#adminPageTitle");
    if (titleEl) titleEl.textContent = adminTitles[panelName] || panelName;
    // Close mobile nav
    const nav = $(".admin-nav");
    if (nav) nav.classList.remove("open");
  }

  async function loadAdminSettings() {
    try {
      const settings = await api("/api/admin/settings");
      $("#settingAllowRegister").checked = settings.allowRegister;
      $("#settingGuestCanView").checked = settings.guestCanView;
      $("#settingApprovedOnly").checked = settings.approvedOnly;
      $("#settingDisableDownload").checked = settings.disableDownload;
      $("#settingAllowUpload").checked =
        settings.allowUpload !== undefined ? settings.allowUpload : true;
      $("#settingEnableLikes").checked =
        settings.enableLikes !== undefined ? settings.enableLikes : true;
      $("#settingEnableComments").checked =
        settings.enableComments !== undefined ? settings.enableComments : true;
      $("#settingCommentModeration").checked =
        settings.commentModeration || false;
      $("#settingTheme").value = settings.theme || "default";
      $("#settingSiteName").value = settings.siteName || "MJ Gallery";
    } catch (err) {
      toast(err.error || TEXT.settingsLoadFail, "error");
    }
  }

  async function saveAdminSettings() {
    try {
      await api("/api/admin/settings", {
        method: "POST",
        body: {
          allowRegister: $("#settingAllowRegister").checked,
          guestCanView: $("#settingGuestCanView").checked,
          approvedOnly: $("#settingApprovedOnly").checked,
          disableDownload: $("#settingDisableDownload").checked,
          allowUpload: $("#settingAllowUpload").checked,
          enableLikes: $("#settingEnableLikes").checked,
          enableComments: $("#settingEnableComments").checked,
          commentModeration: $("#settingCommentModeration").checked,
          theme: $("#settingTheme").value,
          siteName: $("#settingSiteName").value.trim() || "MJ Gallery",
        },
      });

      disableDownload = $("#settingDisableDownload").checked;
      document.documentElement.dataset.theme = $("#settingTheme").value;
      const newName = $("#settingSiteName").value.trim() || "MJ Gallery";
      $("#siteNameDisplay").textContent = newName;
      document.title = newName;
      toast(TEXT.settingsSaved, "success");
    } catch (err) {
      toast(err.error || TEXT.saveFail, "error");
    }
  }

  async function loadAdminUsers() {
    try {
      const users = await api("/api/admin/users");
      $("#usersList").innerHTML = users
        .map((u) => {
          const approveBtn =
            u.role !== "admin" && !u.approved
              ? `<button class="btn btn-primary btn-sm" onclick="app.approveUser('${u.id}')">批准</button>`
              : "";

          const revokeBtn =
            u.role !== "admin" && u.approved
              ? `<button class="btn btn-ghost btn-sm" onclick="app.revokeUser('${u.id}')">撤销</button>`
              : "";

          const rejectBtn =
            u.role !== "admin" && !u.approved
              ? `<button class="btn btn-ghost btn-sm" style="color:#ef4444" onclick="app.rejectUser('${u.id}','${escHtml(u.username)}')">拒绝</button>`
              : "";

          const editTitleBtn = `<button class="btn btn-ghost btn-sm" onclick="app.editUserTitle('${u.id}','${escHtml(u.username)}','${escHtml(u.title || "")}')">编辑</button>`;

          const deleteBtn =
            u.role !== "admin"
              ? `<button class="btn btn-danger btn-sm" onclick="app.deleteUser('${u.id}')">删除</button>`
              : "";

          const titleBadge = u.title
            ? `<span class="user-title-badge">${escHtml(u.title)}</span>`
            : "";

          let statusClass, statusText;
          if (u.approved) {
            statusClass = "approved";
            statusText = "已批准";
          } else if (u.rejectReason) {
            statusClass = "rejected";
            statusText = "已拒绝";
          } else {
            statusClass = "pending";
            statusText = "待审核";
          }

          return `
          <div class="user-row" data-id="${u.id}">
            <div class="user-row-name">
              ${escHtml(u.username)}
              ${titleBadge}
              ${u.referral ? `<div style="font-size:11px;color:var(--text-dim);margin-top:2px">来源: ${escHtml(u.referral)}</div>` : ""}
              ${u.note ? `<div style="font-size:11px;color:var(--text-dim)">备注: ${escHtml(u.note)}</div>` : ""}
              ${u.rejectReason ? `<div style="font-size:11px;color:#ef4444">拒绝原因: ${escHtml(u.rejectReason)}</div>` : ""}
              ${u.reapplyReason ? `<div style="font-size:11px;color:#3b82f6">再申请(${u.reapplyCount || 0}/${u.reapplyLimit || 0}): ${escHtml(u.reapplyReason)}</div>` : ""}
            </div>
            <span class="user-row-role ${u.role}">${u.role}</span>
            <span class="user-row-status ${statusClass}">
              ${statusText}
            </span>
            <div class="user-row-actions">
              ${approveBtn}
              ${rejectBtn}
              ${revokeBtn}
              ${editTitleBtn}
              ${deleteBtn}
            </div>
          </div>`;
        })
        .join("");
    } catch (err) {
      toast(err.error || TEXT.usersLoadFail, "error");
    }
  }

  // ============ Categories ============
  async function loadCategories() {
    try {
      categories = await api("/api/categories");
    } catch {
      categories = [];
    }
    renderFilterTags();
    populateCategorySelect();
  }

  function renderFilterTags() {
    const container = $("#filterTags");
    if (!container) return;

    container
      .querySelectorAll(".filter-tag-dynamic")
      .forEach((el) => el.remove());

    for (const cat of categories) {
      const btn = document.createElement("button");
      btn.className = "filter-tag filter-tag-dynamic";
      btn.dataset.filter = cat.name.toLowerCase();
      btn.textContent = cat.name;
      if (currentFilter === cat.name.toLowerCase()) btn.classList.add("active");
      btn.addEventListener("click", () => {
        container
          .querySelectorAll(".filter-tag")
          .forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        currentFilter = btn.dataset.filter;
        loadGallery(true);
      });
      container.appendChild(btn);
    }
  }

  function populateCategorySelect() {
    const select = $("#inputCategory");
    if (!select) return;

    select.querySelectorAll("option.cat-option").forEach((el) => el.remove());

    for (const cat of categories) {
      const opt = document.createElement("option");
      opt.value = cat.name;
      opt.textContent = cat.name;
      opt.className = "cat-option";
      select.appendChild(opt);
    }
    // Clear selected on fresh load
    selectedCategories.clear();
    renderCategoryChips();
  }

  function renderCategoryChips() {
    const container = $("#inputCategoryChips");
    if (!container) return;
    container.innerHTML = [...selectedCategories]
      .map(
        (c) =>
          `<span style="display:inline-flex;align-items:center;gap:3px;padding:2px 8px;background:var(--accent);color:#fff;border-radius:12px;font-size:11px;white-space:nowrap">${escHtml(c)}<span style="cursor:pointer;margin-left:2px" onclick="app.removeCategoryChip('${escHtml(c)}')">✕</span></span>`,
      )
      .join("");
  }

  function removeCategoryChip(name) {
    selectedCategories.delete(name);
    renderCategoryChips();
  }

  function renderAdminCategories() {
    const list = $("#categoriesList");
    if (!list) return;

    if (categories.length === 0) {
      list.innerHTML = '<div class="category-row-empty">还没有创建分类</div>';
      return;
    }

    list.innerHTML = `<div class="jelly-grid">${categories
      .map(
        (cat, i) => `
      <div class="jelly-card">
        <div class="jelly-card-name">${escHtml(cat.name)}</div>
        <div class="jelly-card-count">${cat.count || 0}<span class="jelly-card-unit">个作品</span></div>
        <div class="jelly-card-bar">
          <button class="jelly-btn" onclick="app.moveCategory(${i},-1)" ${i === 0 ? "disabled" : ""}>▲</button>
          <button class="jelly-btn" onclick="app.moveCategory(${i},1)" ${i === categories.length - 1 ? "disabled" : ""}>▼</button>
          <button class="jelly-btn" onclick="app.renameCategory('${cat.id}','${escHtml(cat.name).replace(/'/g, "\\'")}')">✎</button>
          <button class="jelly-btn jelly-btn-del" onclick="app.deleteCategory('${cat.id}')">✕</button>
        </div>
      </div>`,
      )
      .join("")}</div>`;
  }

  async function moveCategory(index, direction) {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= categories.length) return;
    [categories[index], categories[newIndex]] = [
      categories[newIndex],
      categories[index],
    ];
    renderAdminCategories();
    try {
      await api("/api/admin/categories/reorder", {
        method: "PUT",
        body: { ids: categories.map((c) => c.id) },
      });
    } catch (err) {
      toast(err.error || "排序失败", "error");
    }
  }

  async function createCategory() {
    const input = $("#newCategoryName");
    const name = input.value.trim();
    if (!name) return;

    try {
      await api("/api/admin/categories", {
        method: "POST",
        body: { name },
      });
      input.value = "";
      await loadCategories();
      renderAdminCategories();
      toast("分类已创建", "success");
    } catch (err) {
      toast(err.error || "创建失败", "error");
    }
  }

  async function deleteCategory(id) {
    if (!confirm("确定删除这个分类吗？已归类的图片不会被删除。")) return;

    try {
      await api(`/api/admin/categories/${id}`, { method: "DELETE" });
      await loadCategories();
      renderAdminCategories();
      toast("分类已删除", "info");
    } catch (err) {
      toast(err.error || "删除失败", "error");
    }
  }

  // ============ Tags ============
  async function loadTags() {
    try {
      predefinedTags = await api("/api/tags");
    } catch {
      predefinedTags = [];
    }
    renderTagChips();
  }

  function renderTagChips(selected = []) {
    const container = $("#inputTagChips");
    if (!container) return;
    if (predefinedTags.length === 0) {
      container.innerHTML =
        '<span class="tag-chips-empty">\u7ba1\u7406\u5458\u672a\u521b\u5efa\u6807\u7b7e</span>';
      return;
    }
    container.innerHTML = predefinedTags
      .map((t) => {
        const isSelected = selected.includes(t.name);
        return `<span class="tag-chip${isSelected ? " selected" : ""}" data-tag="${escHtml(t.name)}">${escHtml(t.name)}</span>`;
      })
      .join("");

    container.querySelectorAll(".tag-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        chip.classList.toggle("selected");
      });
    });
  }

  function getSelectedTags() {
    const chips = $$("#inputTagChips .tag-chip.selected");
    return Array.from(chips).map((c) => c.dataset.tag);
  }

  function setSelectedTags(tags) {
    const arr = Array.isArray(tags) ? tags : [];
    renderTagChips(arr);
  }

  function renderAdminTags() {
    const container = $("#tagsList");
    if (!container) return;
    if (predefinedTags.length === 0) {
      container.innerHTML =
        '<div style="text-align:center;color:var(--text-dim);padding:16px">\u6682\u65e0\u6807\u7b7e</div>';
      return;
    }
    container.innerHTML = `<div class="jelly-grid">${predefinedTags
      .map(
        (t, i) => `
      <div class="jelly-card">
        <div class="jelly-card-name">${escHtml(t.name)}</div>
        <div class="jelly-card-count">${t.count || 0}<span class="jelly-card-unit">个作品</span></div>
        <div class="jelly-card-bar">
          <button class="jelly-btn" onclick="app.moveTag(${i},-1)" ${i === 0 ? "disabled" : ""}>▲</button>
          <button class="jelly-btn" onclick="app.moveTag(${i},1)" ${i === predefinedTags.length - 1 ? "disabled" : ""}>▼</button>
          <button class="jelly-btn" onclick="app.renameTag('${t.id}','${escHtml(t.name).replace(/'/g, "\\'")}')">✎</button>
          <button class="jelly-btn jelly-btn-del" onclick="app.deleteTag('${t.id}')">✕</button>
        </div>
      </div>`,
      )
      .join("")}</div>`;
  }

  async function moveTag(index, direction) {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= predefinedTags.length) return;
    [predefinedTags[index], predefinedTags[newIndex]] = [
      predefinedTags[newIndex],
      predefinedTags[index],
    ];
    renderAdminTags();
    try {
      await api("/api/admin/tags/reorder", {
        method: "PUT",
        body: { ids: predefinedTags.map((t) => t.id) },
      });
    } catch (err) {
      toast(err.error || "排序失败", "error");
    }
  }

  async function createTag() {
    const input = $("#newTagName");
    const name = input.value.trim();
    if (!name) return;

    try {
      await api("/api/admin/tags", { method: "POST", body: { name } });
      input.value = "";
      await loadTags();
      renderAdminTags();
      toast("\u6807\u7b7e\u5df2\u521b\u5efa", "success");
    } catch (err) {
      toast(err.error || "\u521b\u5efa\u5931\u8d25", "error");
    }
  }

  async function deleteTag(id) {
    if (!confirm("确定删除该标签？")) return;
    try {
      await api(`/api/admin/tags/${id}`, { method: "DELETE" });
      toast("标签已删除", "success");
      await loadTags();
      renderAdminTags();
    } catch (err) {
      toast(err.error || TEXT.opFail, "error");
    }
  }

  async function renameCategory(id, oldName) {
    const newName = prompt(`重命名分类「${oldName}」:`, oldName);
    if (!newName || newName === oldName) return;
    try {
      await api(`/api/admin/categories/${id}`, {
        method: "PATCH",
        body: { name: newName },
      });
      toast("分类已重命名", "success");
      await loadCategories();
      renderAdminCategories();
    } catch (err) {
      toast(err.error || TEXT.opFail, "error");
    }
  }

  async function renameTag(id, oldName) {
    const newName = prompt(`重命名标签「${oldName}」:`, oldName);
    if (!newName || newName === oldName) return;
    try {
      await api(`/api/admin/tags/${id}`, {
        method: "PATCH",
        body: { name: newName },
      });
      toast("标签已重命名", "success");
      await loadTags();
      renderAdminTags();
    } catch (err) {
      toast(err.error || TEXT.opFail, "error");
    }
  }

  // ============ Batch Edit ============
  let batchMode = false;
  const batchSelected = new Set();
  const batchTags = new Set();
  const batchCategories = new Set();

  function renderBatchTagChips() {
    const container = $("#batchTagChips");
    container.innerHTML = [...batchTags]
      .map(
        (t) =>
          `<span style="display:inline-flex;align-items:center;gap:3px;padding:2px 8px;background:var(--accent);color:#fff;border-radius:12px;font-size:11px;white-space:nowrap">${escHtml(t)}<span style="cursor:pointer;margin-left:2px" onclick="app.removeBatchTag('${escHtml(t)}')">✕</span></span>`,
      )
      .join("");
  }

  function removeBatchTag(name) {
    batchTags.delete(name);
    renderBatchTagChips();
  }

  function renderBatchCategoryChips() {
    const container = $("#batchCategoryChips");
    if (!container) return;
    container.innerHTML = [...batchCategories]
      .map(
        (c) =>
          `<span style="display:inline-flex;align-items:center;gap:3px;padding:2px 8px;background:var(--accent);color:#fff;border-radius:12px;font-size:11px;white-space:nowrap">${escHtml(c)}<span style="cursor:pointer;margin-left:2px" onclick="app.removeBatchCategoryChip('${escHtml(c)}')">✕</span></span>`,
      )
      .join("");
  }

  function removeBatchCategoryChip(name) {
    batchCategories.delete(name);
    renderBatchCategoryChips();
  }

  async function toggleBatchMode() {
    batchMode = !batchMode;
    batchSelected.clear();
    batchTags.clear();
    batchCategories.clear();
    document.body.classList.toggle("batch-mode", batchMode);
    $("#batchBar").style.display = batchMode ? "flex" : "none";
    $("#batchTagChips").innerHTML = "";
    $("#batchCategoryChips").innerHTML = "";
    updateBatchCount();
    if (batchMode) {
      // Ensure tags are loaded
      if (predefinedTags.length === 0) {
        try {
          predefinedTags = await api("/api/tags");
        } catch {
          predefinedTags = [];
        }
      }
      // Populate category dropdown
      const sel = $("#batchCategory");
      sel.innerHTML =
        '<option value="">设置分类...</option>' +
        categories
          .map(
            (c) =>
              `<option value="${escHtml(c.name)}">${escHtml(c.name)}</option>`,
          )
          .join("");
      // Populate tag dropdown
      const tagSel = $("#batchAddTag");
      tagSel.innerHTML =
        '<option value="">添加标签...</option>' +
        predefinedTags
          .map(
            (t) =>
              `<option value="${escHtml(t.name)}">${escHtml(t.name)}</option>`,
          )
          .join("");
    }
    // Remove selection highlights
    $$(".gallery-card.batch-selected").forEach((c) =>
      c.classList.remove("batch-selected"),
    );
  }

  function selectAllBatch() {
    const cards = $$(".gallery-card[data-id]");
    cards.forEach((card) => {
      const id = card.dataset.id;
      if (!batchSelected.has(id)) {
        batchSelected.add(id);
        card.classList.add("batch-selected");
      }
    });
    updateBatchCount();
  }

  function updateBatchCount() {
    $("#batchCount").textContent = `已选 ${batchSelected.size} 项`;
  }

  function handleBatchClick(event) {
    if (!batchMode) return;
    const card = event.target.closest(".gallery-card");
    if (!card) return;
    event.preventDefault();
    event.stopPropagation();
    const id = card.dataset.id;
    if (batchSelected.has(id)) {
      batchSelected.delete(id);
      card.classList.remove("batch-selected");
    } else {
      batchSelected.add(id);
      card.classList.add("batch-selected");
    }
    updateBatchCount();
  }

  async function applyBatchEdit() {
    if (batchSelected.size === 0) {
      toast("请先选择作品", "error");
      return;
    }
    const body = { ids: [...batchSelected] };
    const vis = $("#batchVisibility").value;
    const tags = [...batchTags];
    const cats = [...batchCategories];
    if (cats.length === 0 && tags.length === 0 && !vis) {
      toast("请选择要修改的属性", "error");
      return;
    }
    if (cats.length > 0) body.category = cats;
    if (tags.length > 0) body.addTags = tags;
    if (vis) body.visibility = vis;
    try {
      const res = await api("/api/admin/gallery/batch", {
        method: "PATCH",
        body,
      });
      toast(`已更新 ${res.updated} 个作品`, "success");
      toggleBatchMode();
      loadGallery(true);
    } catch (err) {
      toast(err.error || TEXT.opFail, "error");
    }
  }

  async function batchDelete() {
    if (batchSelected.size === 0) {
      toast("请先选择作品", "error");
      return;
    }
    if (
      !confirm(
        `确定要删除选中的 ${batchSelected.size} 个作品吗？此操作不可撤销！`,
      )
    )
      return;
    try {
      const res = await api("/api/admin/gallery/batch-delete", {
        method: "POST",
        body: { ids: [...batchSelected] },
      });
      toast(`已删除 ${res.deleted} 个作品`, "success");
      toggleBatchMode();
      loadGallery(true);
    } catch (err) {
      toast(err.error || TEXT.opFail, "error");
    }
  }

  async function approveUser(id) {
    try {
      await api(`/api/admin/users/${id}`, {
        method: "PATCH",
        body: { approved: true },
      });

      toast(TEXT.userApproved, "success");
      loadAdminUsers();
    } catch (err) {
      toast(err.error || TEXT.opFail, "error");
    }
  }

  async function revokeUser(id) {
    try {
      await api(`/api/admin/users/${id}`, {
        method: "PATCH",
        body: { approved: false },
      });

      toast(TEXT.userRevoked, "success");
      loadAdminUsers();
    } catch (err) {
      toast(err.error || TEXT.opFail, "error");
    }
  }

  async function rejectUser(id, username) {
    const reason = prompt(`拒绝「${username}」的原因（将告知用户）:`);
    if (reason === null) return;
    const limitStr = prompt("允许重新申请次数（输入 0 表示不允许）:", "1");
    if (limitStr === null) return;
    const reapplyLimit = Math.max(0, Math.min(10, parseInt(limitStr) || 0));
    try {
      await api(`/api/admin/users/${id}`, {
        method: "PATCH",
        body: {
          approved: false,
          rejectReason: reason || "未通过审核",
          reapplyLimit,
        },
      });
      toast(`已拒绝，允许重新申请 ${reapplyLimit} 次`, "success");
      loadAdminUsers();
    } catch (err) {
      toast(err.error || TEXT.opFail, "error");
    }
  }

  async function deleteUser(id) {
    if (!confirm(TEXT.deleteUserConfirm)) return;

    try {
      await api(`/api/admin/users/${id}`, { method: "DELETE" });
      toast(TEXT.userDeleted, "success");
      loadAdminUsers();
      loadGallery(true);
    } catch (err) {
      toast(err.error || TEXT.opFail, "error");
    }
  }

  async function editUserTitle(id, username, currentTitle) {
    const title = prompt(
      `设置「${username}」的头衔（留空清除，最长20字）:`,
      currentTitle || "",
    );
    if (title === null) return;
    try {
      await api(`/api/admin/users/${id}`, {
        method: "PATCH",
        body: { title },
      });
      toast("头衔已更新", "success");
      loadAdminUsers();
    } catch (err) {
      toast(err.error || TEXT.opFail, "error");
    }
  }

  // ============ User Sidebar ============
  function openSidebar() {
    if (!currentUser) return;
    const sidebarAvatarEl = $("#sidebarInitial");
    if (currentUser.avatar) {
      sidebarAvatarEl.innerHTML = `<img src="${currentUser.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
    } else {
      sidebarAvatarEl.textContent = currentUser.username
        .charAt(0)
        .toUpperCase();
    }
    $("#sidebarUsername").textContent = currentUser.username;
    $("#sidebarRole").textContent =
      currentUser.role === "admin" ? "ADMIN" : "USER";
    $("#userSidebar").classList.add("active");
    $("#sidebarBackdrop").classList.add("active");
    $("#sidebarAdmin").style.display =
      currentUser.role === "admin" ? "" : "none";
    loadUserSettings();
  }

  function closeSidebar() {
    $("#userSidebar").classList.remove("active");
    $("#sidebarBackdrop").classList.remove("active");
  }

  async function loadUserSettings() {
    try {
      const settings = await api("/api/user/settings");
      $("#settingProfileVisibility").value =
        settings.profileVisibility || "public";
    } catch {
      // ignore
    }
  }

  async function saveUserSettings() {
    try {
      await api("/api/user/settings", {
        method: "PUT",
        body: { profileVisibility: $("#settingProfileVisibility").value },
      });
      toast("设置已保存", "success");
    } catch (err) {
      toast(err.error || "保存失败", "error");
    }
  }

  function toggleUserDropdown() {
    openSidebar();
  }

  function closeUserDropdown() {
    // kept for backward compat
  }

  // ============ Drag & Paste ============
  function initDragDrop() {
    document.addEventListener("dragenter", (event) => {
      event.preventDefault();
      dragCounter += 1;
      if (dragCounter === 1 && currentUser) {
        $("#dropOverlay").classList.add("active");
      }
    });

    document.addEventListener("dragleave", (event) => {
      event.preventDefault();
      dragCounter -= 1;
      if (dragCounter <= 0) {
        dragCounter = 0;
        $("#dropOverlay").classList.remove("active");
      }
    });

    document.addEventListener("dragover", (event) => event.preventDefault());

    document.addEventListener("drop", (event) => {
      event.preventDefault();
      dragCounter = 0;
      $("#dropOverlay").classList.remove("active");

      if (!currentUser) return;

      const files = event.dataTransfer?.files;
      if (files && files.length > 0) {
        handleFiles(files);
        openUploadModal();
      }
    });
  }

  function initPaste() {
    document.addEventListener("paste", (event) => {
      if (!currentUser) return;

      const items = event.clipboardData?.items;
      if (!items) return;

      const imageFiles = [];
      for (const item of items) {
        if (item.type.startsWith("image/")) imageFiles.push(item.getAsFile());
      }

      if (imageFiles.length > 0) {
        handleFiles(imageFiles);
        if (!$("#uploadModal").classList.contains("active")) openUploadModal();
      }
    });
  }

  // ============ Init ============
  function init() {
    applyChineseStaticText();

    // Auth
    $("#loginForm").addEventListener("submit", doLogin);
    $("#registerForm").addEventListener("submit", doRegister);

    $("#showRegister").addEventListener("click", () => {
      $("#loginForm").style.display = "none";
      $("#registerForm").style.display = "";
    });

    $("#showLogin").addEventListener("click", () => {
      $("#registerForm").style.display = "none";
      $("#loginForm").style.display = "";
    });

    $("#guestLink").addEventListener("click", () => showApp(null));

    // Guest login button
    const btnGuestLogin = $("#btnGuestLogin");
    if (btnGuestLogin) {
      btnGuestLogin.addEventListener("click", () => showAuthPage());
    }

    // Handle browser back/forward
    window.addEventListener("popstate", () => checkAuth());

    // Upload
    $("#btnUpload").addEventListener("click", openUploadModal);
    $("#btnEmptyUpload").addEventListener("click", openUploadModal);
    $("#uploadClose").addEventListener("click", closeUploadModal);
    $("#uploadCancel").addEventListener("click", closeUploadModal);
    $("#uploadSave").addEventListener("click", saveUpload);

    $("#uploadZone").addEventListener("click", () =>
      $("#uploadFileInput").click(),
    );
    $("#uploadFileInput").addEventListener("change", (event) =>
      handleFiles(event.target.files),
    );

    $("#uploadModal").addEventListener("click", (event) => {
      if (event.target === $("#uploadModal")) closeUploadModal();
    });

    const uploadZone = $("#uploadZone");
    uploadZone.addEventListener("dragover", (event) => {
      event.preventDefault();
      event.stopPropagation();
      uploadZone.style.borderColor = "var(--accent)";
    });

    uploadZone.addEventListener("dragleave", (event) => {
      event.preventDefault();
      event.stopPropagation();
      uploadZone.style.borderColor = "";
    });

    uploadZone.addEventListener("drop", (event) => {
      event.preventDefault();
      event.stopPropagation();
      uploadZone.style.borderColor = "";
      handleFiles(event.dataTransfer.files);
    });

    // Lightbox
    $("#lightboxClose").addEventListener("click", closeLightbox);
    $("#lightboxModal").addEventListener("click", (event) => {
      if (event.target === $("#lightboxModal")) closeLightbox();
    });
    $("#lbCopyPrompt").addEventListener("click", copyPrompt);
    $("#lbDownload").addEventListener("click", downloadImage);
    $("#lbLike").addEventListener("click", toggleLike);
    $("#commentSend").addEventListener("click", postComment);
    $("#commentText").addEventListener("keydown", (e) => {
      if (e.key === "Enter") postComment();
    });
    $("#lbEdit").addEventListener("click", editItem);
    $("#lbDelete").addEventListener("click", deleteItem);

    // Pending state
    $("#pendingRefresh").addEventListener("click", () => {
      loadPendingStatus();
      checkAuth();
    });
    $("#pendingBack").addEventListener("click", () => {
      doLogout();
    });

    // User menu
    $("#userAvatar").addEventListener("click", (event) => {
      event.stopPropagation();
      toggleUserDropdown();
    });

    document.addEventListener("click", (event) => {
      if (!event.target.closest(".user-menu")) closeUserDropdown();
    });

    $("#btnLogout").addEventListener("click", doLogout);

    // Avatar upload
    $("#btnChangeAvatar").addEventListener("click", () => {
      $("#avatarInput").click();
    });
    $("#avatarInput").addEventListener("change", (e) => {
      if (e.target.files[0]) uploadAvatar(e.target.files[0]);
      e.target.value = "";
    });

    // Source selector toggles param sections
    $("#inputSource").addEventListener("change", (e) => {
      toggleSourceParams(e.target.value);
    });

    // Sidebar
    $("#profileBack").addEventListener("click", clearUserProfile);
    $("#sidebarClose").addEventListener("click", closeSidebar);
    $("#sidebarBackdrop").addEventListener("click", closeSidebar);
    $("#sidebarMyProfile").addEventListener("click", () => {
      closeSidebar();
      if (currentUser) viewUserProfile(currentUser.id);
    });
    $("#sidebarChangeAvatar").addEventListener("click", () => {
      closeSidebar();
      $("#avatarInput").click();
    });
    $("#btnSaveUserSettings").addEventListener("click", saveUserSettings);
    $("#sidebarAdmin").addEventListener("click", () => {
      closeSidebar();
      openAdmin();
    });
    $("#sidebarLogout").addEventListener("click", () => {
      closeSidebar();
      doLogout();
    });

    // Admin dashboard
    $("#btnAdmin").addEventListener("click", openAdmin);
    $("#btnBatchEdit").addEventListener("click", toggleBatchMode);
    $("#btnBatchSelectAll").addEventListener("click", selectAllBatch);
    $("#btnBatchApply").addEventListener("click", applyBatchEdit);
    $("#btnBatchDelete").addEventListener("click", batchDelete);
    $("#btnBatchCancel").addEventListener("click", toggleBatchMode);
    $("#batchAddTag").addEventListener("change", (e) => {
      const v = e.target.value;
      if (v && !batchTags.has(v)) {
        batchTags.add(v);
        renderBatchTagChips();
      }
      e.target.value = "";
    });
    $("#batchCategory").addEventListener("change", (e) => {
      const v = e.target.value;
      if (v && !batchCategories.has(v)) {
        batchCategories.add(v);
        renderBatchCategoryChips();
      }
      e.target.value = "";
    });
    $("#inputCategory").addEventListener("change", (e) => {
      const v = e.target.value;
      if (v && !selectedCategories.has(v)) {
        selectedCategories.add(v);
        renderCategoryChips();
      }
      e.target.value = "";
    });
    $("#galleryContainer").addEventListener("click", handleBatchClick, true);
    $("#adminClose").addEventListener("click", closeAdmin);
    $$(".admin-nav-item[data-panel]").forEach((btn) => {
      btn.addEventListener("click", () => switchAdminPanel(btn.dataset.panel));
    });
    const menuToggle = $("#adminMenuToggle");
    if (menuToggle)
      menuToggle.addEventListener("click", () => {
        $(".admin-nav").classList.toggle("open");
      });
    $("#saveAdminSettings").addEventListener("click", saveAdminSettings);

    // Admin categories
    $("#btnCreateCategory").addEventListener("click", createCategory);
    $("#newCategoryName").addEventListener("keydown", (event) => {
      if (event.key === "Enter") createCategory();
    });

    // Admin tags
    $("#btnCreateTag").addEventListener("click", createTag);
    $("#newTagName").addEventListener("keydown", (event) => {
      if (event.key === "Enter") createTag();
    });

    $$(".admin-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        $$(".admin-tab").forEach((t) => t.classList.remove("active"));
        $$(".admin-panel").forEach((panel) => panel.classList.remove("active"));

        tab.classList.add("active");
        $(`#panel-${tab.dataset.panel}`).classList.add("active");
      });
    });

    // Search
    const onSearchInput = debounce(() => {
      currentSearch = $("#searchInput").value.trim();
      $("#searchClear").classList.toggle("visible", currentSearch.length > 0);
      loadGallery(true);
    }, 180);

    $("#searchInput").addEventListener("input", onSearchInput);
    $("#searchClear").addEventListener("click", () => {
      $("#searchInput").value = "";
      currentSearch = "";
      $("#searchClear").classList.remove("visible");
      loadGallery(true);
    });

    // Filters
    $$(".filter-tag").forEach((btn) => {
      btn.addEventListener("click", () => {
        $$(".filter-tag").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        currentFilter = btn.dataset.filter;
        loadGallery(true);
      });
    });

    // Sort
    $("#sortSelect").addEventListener("change", () => {
      currentSort = $("#sortSelect").value;
      loadGallery(true);
    });

    // Keyboard
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;

      if ($("#userSidebar").classList.contains("active")) closeSidebar();
      else if ($("#lightboxModal").classList.contains("active"))
        closeLightbox();
      else if ($("#uploadModal").classList.contains("active"))
        closeUploadModal();
      else if ($("#adminModal").classList.contains("active")) closeAdmin();
    });

    setupLoadMoreObserver();
    initDragDrop();
    initPaste();

    // Image protection: disable right-click and drag on images
    document.addEventListener("contextmenu", (event) => {
      if (
        event.target.closest(".gallery-card") ||
        event.target.closest(".lightbox-image-area")
      ) {
        event.preventDefault();
      }
    });

    document.addEventListener("dragstart", (event) => {
      if (event.target.tagName === "IMG") {
        event.preventDefault();
      }
    });

    checkAuth();
  }

  // Expose minimal API for inline HTML handlers
  window.app = {
    openLightbox,
    approveUser,
    revokeUser,
    deleteUser,
    editUserTitle,
    rejectUser,
    removeBatchTag,
    removeBatchCategoryChip,
    removeCategoryChip,
    deleteCategory,
    renameCategory,
    deleteComment,
    approveComment,
    deleteTag,
    renameTag,
    viewUserProfile,
    clearUserProfile,
    moveCategory,
    moveTag,
    parsePromptParams,
  };

  document.addEventListener("DOMContentLoaded", init);
})();
