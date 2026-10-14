"use strict";

/**
 * 智影工坊 - 账号登录与云端数据同步模块
 * 依赖后端 /api/* 接口（server.js）
 */
window.Auth = (function () {
  const TOKEN_KEY = "zhiying.auth.token";
  const USER_KEY = "zhiying.auth.user";

  // 需要同步到云端的 localStorage 键
  const SYNC_KEYS = [
    "brandflow.workspace.v1",
    "brandflow.settings",
    "brandflow.advisor.conversation.v1"
  ];

  let token = localStorage.getItem(TOKEN_KEY) || null;
  let user = null;
  try {
    user = JSON.parse(localStorage.getItem(USER_KEY) || "null");
  } catch (_) {
    user = null;
  }

  let syncTimer = null;
  let readyCallbacks = [];
  let isReady = false;
  let overlayEl = null;
  let mode = "login"; // login | register
  let serverAvailable = false;
  let userMenuEl = null;
  let userMenuOpen = false;

  // ---------- API ----------
  async function api(path, options) {
    options = options || {};
    const headers = Object.assign({ "Content-Type": "application/json" }, options.headers || {});
    if (token) headers["Authorization"] = "Bearer " + token;
    const res = await fetch(path, Object.assign({}, options, { headers }));
    let data = {};
    try { data = await res.json(); } catch (_) { /* ignore */ }
    if (!res.ok) throw new Error(data.error || "请求失败（" + res.status + "）");
    return data;
  }

  // ---------- 数据同步 ----------
  async function pullData() {
    const result = await api("/api/data");
    const data = result.data || {};
    for (const key of Object.keys(data)) {
      const val = data[key];
      localStorage.setItem(key, typeof val === "string" ? val : JSON.stringify(val));
    }
    return data;
  }

  async function pushData(key) {
    if (!token) return;
    const raw = localStorage.getItem(key);
    let value;
    try {
      value = raw === null ? null : JSON.parse(raw);
    } catch (_) {
      value = raw;
    }
    await api("/api/data", {
      method: "PUT",
      body: JSON.stringify({ key, value })
    });
  }

  function scheduleSync(key) {
    if (!token) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(function () {
      pushData(key).catch(function (e) { console.warn("数据同步失败:", e.message); });
    }, 800);
  }

  // ---------- 登录 / 注册 / 登出 ----------
  async function login(username, password) {
    const data = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ username, password })
    });
    token = data.token;
    user = data.user;
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    await pullData();
    enterApp();
  }

  async function register(username, password) {
    const data = await api("/api/register", {
      method: "POST",
      body: JSON.stringify({ username, password })
    });
    token = data.token;
    user = data.user;
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    await pullData();
    enterApp();
  }

  function logout() {
    token = null;
    user = null;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    SYNC_KEYS.forEach(function (k) { localStorage.removeItem(k); });
    isReady = false;
    closeUserMenu();
    showOverlay();
    setMode("login");
    updateHeaderUser();
    setTimeout(function () { location.reload(); }, 300);
  }

  function switchAccount() {
    // 退出当前账号但保留登录页，方便切换
    token = null;
    user = null;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    SYNC_KEYS.forEach(function (k) { localStorage.removeItem(k); });
    isReady = false;
    closeUserMenu();
    showOverlay();
    setMode("login");
    updateHeaderUser();
    setTimeout(function () { location.reload(); }, 300);
  }

  async function verify() {
    if (!token) return false;
    try {
      const result = await api("/api/me");
      user = result.user;
      localStorage.setItem(USER_KEY, JSON.stringify(user));
      return true;
    } catch (_) {
      token = null;
      user = null;
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      return false;
    }
  }

  // ---------- 登录界面 ----------
  function buildOverlay() {
    overlayEl = document.createElement("div");
    overlayEl.id = "authOverlay";
    overlayEl.className = "auth-overlay";
    overlayEl.innerHTML =
      '<div class="auth-card">' +
        '<div class="auth-brand">' +
          '<div class="auth-logo" aria-hidden="true">' +
            '<svg viewBox="0 0 32 32" fill="none"><rect x="3" y="5" width="26" height="22" rx="5" fill="#101828"/><path d="M12.5 13.5 20 16l-7.5 2.5L10 26V6l2.5 7.5Z" fill="#2dd4bf"/><circle cx="24" cy="10" r="2.4" fill="#f59e0b"/></svg>' +
          '</div>' +
          '<h1>智影工坊</h1>' +
          '<p>AI 品牌宣传视频智能体</p>' +
        '</div>' +
        '<div class="auth-tabs">' +
          '<button type="button" class="auth-tab active" data-auth-tab="login">登录</button>' +
          '<button type="button" class="auth-tab" data-auth-tab="register">注册</button>' +
        '</div>' +
        '<form class="auth-form" id="authForm" autocomplete="on">' +
          '<label class="auth-field">' +
            '<span>用户名</span>' +
            '<input id="authUsername" name="username" type="text" required maxlength="20" autocomplete="username" placeholder="2-20 位字母、数字、下划线或中文">' +
          '</label>' +
          '<label class="auth-field">' +
            '<span>密码</span>' +
            '<input id="authPassword" name="password" type="password" required minlength="6" autocomplete="current-password" placeholder="至少 6 位">' +
          '</label>' +
          '<div class="auth-error" id="authError" hidden></div>' +
          '<button type="submit" class="auth-submit" id="authSubmit">登录</button>' +
        '</form>' +
        '<div class="auth-hint" id="authHint">登录后数据自动云端保存，换电脑登录可继续</div>' +
        '<button type="button" class="auth-offline" id="authOfflineBtn" hidden>服务器未连接，进入本地离线模式</button>' +
      '</div>';
    document.body.appendChild(overlayEl);

    overlayEl.querySelectorAll(".auth-tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        setMode(tab.dataset.authTab);
      });
    });

    overlayEl.querySelector("#authForm").addEventListener("submit", function (e) {
      e.preventDefault();
      handleSubmit();
    });

    overlayEl.querySelector("#authOfflineBtn").addEventListener("click", function () {
      enterOfflineMode();
    });
  }

  function setMode(m) {
    mode = m;
    overlayEl.querySelectorAll(".auth-tab").forEach(function (tab) {
      tab.classList.toggle("active", tab.dataset.authTab === m);
    });
    overlayEl.querySelector("#authSubmit").textContent = m === "login" ? "登录" : "注册并登录";
    overlayEl.querySelector("#authPassword").setAttribute("autocomplete", m === "login" ? "current-password" : "new-password");
    hideError();
  }

  function showError(msg) {
    const el = overlayEl.querySelector("#authError");
    el.textContent = msg;
    el.hidden = false;
  }

  function hideError() {
    overlayEl.querySelector("#authError").hidden = true;
  }

  async function handleSubmit() {
    const username = overlayEl.querySelector("#authUsername").value.trim();
    const password = overlayEl.querySelector("#authPassword").value;
    const btn = overlayEl.querySelector("#authSubmit");
    btn.disabled = true;
    btn.textContent = mode === "login" ? "登录中…" : "注册中…";
    hideError();
    try {
      if (mode === "login") await login(username, password);
      else await register(username, password);
    } catch (err) {
      showError(err.message);
      btn.disabled = false;
      btn.textContent = mode === "login" ? "登录" : "注册并登录";
    }
  }

  function showOverlay() {
    if (overlayEl) overlayEl.classList.add("show");
    document.body.classList.add("auth-locked");
  }

  function hideOverlay() {
    if (overlayEl) overlayEl.classList.remove("show");
    document.body.classList.remove("auth-locked");
  }

  function enterApp() {
    hideOverlay();
    markReady();
  }

  function markReady() {
    isReady = true;
    const cbs = readyCallbacks;
    readyCallbacks = [];
    cbs.forEach(function (cb) { try { cb(user); } catch (e) { console.error(e); } });
    updateHeaderUser();
  }

  function onReady(cb) {
    if (isReady) cb(user);
    else readyCallbacks.push(cb);
  }

  // ---------- 顶栏用户菜单 ----------
  function updateHeaderUser() {
    let wrap = document.getElementById("authUserWrap");
    if (!wrap) {
      const actions = document.querySelector(".header-actions");
      if (!actions) return;
      wrap = document.createElement("div");
      wrap.id = "authUserWrap";
      wrap.className = "auth-user-wrap";
      wrap.innerHTML =
        '<button type="button" class="status-pill auth-user-pill" id="authUserButton" title="账号菜单">' +
          '<span class="status-dot"></span>' +
          '<span class="auth-user-name"></span>' +
          '<svg class="auth-user-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m6 9 6 6 6-6"/></svg>' +
        '</button>' +
        '<div class="auth-user-menu" id="authUserMenu" hidden>' +
          '<div class="auth-user-menu-header">' +
            '<div class="auth-user-avatar" id="authUserAvatar"></div>' +
            '<div>' +
              '<div class="auth-user-menu-name" id="authMenuName"></div>' +
              '<div class="auth-user-menu-role" id="authMenuRole"></div>' +
            '</div>' +
          '</div>' +
          '<div class="auth-user-menu-divider"></div>' +
          '<button type="button" class="auth-user-menu-item" id="authAdminBtn" hidden>' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>' +
            '账号管理' +
          '</button>' +
          '<button type="button" class="auth-user-menu-item" id="authSwitchBtn">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3l4 4-4 4"/><path d="M21 7H9"/><path d="M7 21l-4-4 4-4"/><path d="M3 17h12"/></svg>' +
            '切换账号' +
          '</button>' +
          '<button type="button" class="auth-user-menu-item auth-user-menu-danger" id="authLogoutBtn">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/></svg>' +
            '退出登录' +
          '</button>' +
        '</div>';
      actions.insertBefore(wrap, actions.firstChild);

      wrap.querySelector("#authUserButton").addEventListener("click", function (e) {
        e.stopPropagation();
        toggleUserMenu();
      });
      wrap.querySelector("#authAdminBtn").addEventListener("click", function () {
        closeUserMenu();
        openAdminPanel();
      });
      wrap.querySelector("#authSwitchBtn").addEventListener("click", function () {
        switchAccount();
      });
      wrap.querySelector("#authLogoutBtn").addEventListener("click", function () {
        logout();
      });
      document.addEventListener("click", function (e) {
        if (!wrap.contains(e.target)) closeUserMenu();
      });
    }

    const btn = wrap.querySelector("#authUserButton");
    const menu = wrap.querySelector("#authUserMenu");
    if (user) {
      wrap.querySelector(".auth-user-name").textContent = user.username + (user.role === "admin" ? "（管理员）" : "");
      wrap.querySelector("#authMenuName").textContent = user.username;
      wrap.querySelector("#authMenuRole").textContent = user.role === "admin" ? "管理员" : "普通用户";
      wrap.querySelector("#authUserAvatar").textContent = user.username.charAt(0).toUpperCase();
      wrap.querySelector("#authAdminBtn").hidden = user.role !== "admin";
      btn.hidden = false;
    } else {
      btn.hidden = true;
      menu.hidden = true;
    }
  }

  function toggleUserMenu() {
    const menu = document.getElementById("authUserMenu");
    if (!menu) return;
    if (userMenuOpen) {
      closeUserMenu();
    } else {
      menu.hidden = false;
      userMenuOpen = true;
    }
  }

  function closeUserMenu() {
    const menu = document.getElementById("authUserMenu");
    if (menu) menu.hidden = true;
    userMenuOpen = false;
  }

  // ---------- 管理员账号管理面板 ----------
  let adminPanelEl = null;
  let adminEditingId = null;

  function buildAdminPanel() {
    adminPanelEl = document.createElement("div");
    adminPanelEl.id = "adminPanel";
    adminPanelEl.className = "admin-overlay";
    adminPanelEl.innerHTML =
      '<div class="admin-dialog">' +
        '<div class="admin-header">' +
          '<div>' +
            '<p class="eyebrow">ADMIN</p>' +
            '<h2>账号管理</h2>' +
          '</div>' +
          '<button type="button" class="icon-button" id="adminCloseBtn" aria-label="关闭">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12"/><path d="m18 6-12 12"/></svg>' +
          '</button>' +
        '</div>' +
        '<div class="admin-toolbar">' +
          '<input type="text" id="adminSearch" placeholder="搜索用户名…" class="admin-search">' +
          '<select id="adminFilter" class="admin-filter">' +
            '<option value="all">全部状态</option>' +
            '<option value="active">正常</option>' +
            '<option value="disabled">已禁用</option>' +
          '</select>' +
          '<button type="button" class="primary-button admin-add-btn" id="adminAddBtn">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14"/><path d="M5 12h14"/></svg>' +
            '新增账号' +
          '</button>' +
        '</div>' +
        '<div class="admin-table-wrap">' +
          '<table class="admin-table">' +
            '<thead>' +
              '<tr>' +
                '<th>ID</th><th>用户名</th><th>角色</th><th>状态</th>' +
                '<th>注册时间</th><th>最后登录</th><th>数据量</th><th>操作</th>' +
              '</tr>' +
            '</thead>' +
            '<tbody id="adminTableBody"></tbody>' +
          '</table>' +
        '</div>' +
        '<div class="admin-empty" id="adminEmpty" hidden>没有找到匹配的账号</div>' +
      '</div>' +
      // 编辑/新增弹窗
      '<div class="admin-edit-overlay" id="adminEditOverlay" hidden>' +
        '<div class="admin-edit-dialog">' +
          '<h3 id="adminEditTitle">新增账号</h3>' +
          '<div class="admin-edit-form">' +
            '<label class="field"><span>用户名</span><input id="editUsername" maxlength="20"></label>' +
            '<label class="field"><span>密码' +
              '<small id="editPwdHint">（留空则不修改）</small>' +
            '</span><input id="editPassword" type="password" placeholder="至少 6 位"></label>' +
            '<label class="field"><span>角色</span>' +
              '<select id="editRole"><option value="user">普通用户</option><option value="admin">管理员</option></select>' +
            '</label>' +
            '<label class="field"><span>状态</span>' +
              '<select id="editStatus"><option value="active">正常</option><option value="disabled">禁用</option></select>' +
            '</label>' +
            '<div class="admin-edit-error" id="adminEditError" hidden></div>' +
          '</div>' +
          '<div class="admin-edit-actions">' +
            '<button type="button" class="secondary-button" id="adminEditCancel">取消</button>' +
            '<button type="button" class="primary-button" id="adminEditSave">保存</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(adminPanelEl);

    adminPanelEl.querySelector("#adminCloseBtn").addEventListener("click", closeAdminPanel);
    adminPanelEl.addEventListener("click", function (e) {
      if (e.target === adminPanelEl) closeAdminPanel();
    });
    adminPanelEl.querySelector("#adminAddBtn").addEventListener("click", function () {
      openEditDialog(null);
    });
    adminPanelEl.querySelector("#adminSearch").addEventListener("input", renderAdminTable);
    adminPanelEl.querySelector("#adminFilter").addEventListener("change", renderAdminTable);
    adminPanelEl.querySelector("#adminEditCancel").addEventListener("click", closeEditDialog);
    adminPanelEl.querySelector("#adminEditSave").addEventListener("click", saveEditDialog);
  }

  async function openAdminPanel() {
    if (!adminPanelEl) buildAdminPanel();
    adminPanelEl.classList.add("show");
    document.body.classList.add("auth-locked");
    await loadAdminUsers();
  }

  function closeAdminPanel() {
    if (adminPanelEl) adminPanelEl.classList.remove("show");
    document.body.classList.remove("auth-locked");
  }

  let adminUsersCache = [];

  async function loadAdminUsers() {
    try {
      const result = await api("/api/admin/users");
      adminUsersCache = result.users || [];
      renderAdminTable();
    } catch (err) {
      alert("加载用户列表失败：" + err.message);
    }
  }

  function renderAdminTable() {
    const tbody = adminPanelEl.querySelector("#adminTableBody");
    const empty = adminPanelEl.querySelector("#adminEmpty");
    const search = adminPanelEl.querySelector("#adminSearch").value.trim().toLowerCase();
    const filter = adminPanelEl.querySelector("#adminFilter").value;

    let list = adminUsersCache.filter(function (u) {
      if (search && u.username.toLowerCase().indexOf(search) === -1) return false;
      if (filter !== "all" && u.status !== filter) return false;
      return true;
    });

    if (list.length === 0) {
      tbody.innerHTML = "";
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    tbody.innerHTML = list.map(function (u) {
      const isSelf = u.id === user.id;
      const roleBadge = u.role === "admin"
        ? '<span class="badge badge-admin">管理员</span>'
        : '<span class="badge badge-user">普通用户</span>';
      const statusBadge = u.status === "disabled"
        ? '<span class="badge badge-disabled">已禁用</span>'
        : '<span class="badge badge-active">正常</span>';
      return '<tr>' +
        '<td>' + u.id + '</td>' +
        '<td><strong>' + escapeHtml(u.username) + '</strong>' + (isSelf ? ' <span class="badge badge-self">当前</span>' : '') + '</td>' +
        '<td>' + roleBadge + '</td>' +
        '<td>' + statusBadge + '</td>' +
        '<td class="admin-time">' + (u.created_at || '-') + '</td>' +
        '<td class="admin-time">' + (u.last_login_at || '从未登录') + '</td>' +
        '<td>' + (u.data_count || 0) + ' 项</td>' +
        '<td class="admin-actions">' +
          '<button class="text-button" data-action="edit" data-id="' + u.id + '">编辑</button>' +
          '<button class="text-button text-danger" data-action="delete" data-id="' + u.id + '"' + (isSelf ? ' disabled' : '') + '>删除</button>' +
        '</td>' +
      '</tr>';
    }).join("");

    tbody.querySelectorAll("button[data-action]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        const id = Number(btn.dataset.id);
        if (btn.dataset.action === "edit") openEditDialog(id);
        else if (btn.dataset.action === "delete") deleteUser(id);
      });
    });
  }

  function openEditDialog(id) {
    adminEditingId = id;
    const overlay = adminPanelEl.querySelector("#adminEditOverlay");
    const title = adminPanelEl.querySelector("#adminEditTitle");
    const usernameInput = adminPanelEl.querySelector("#editUsername");
    const passwordInput = adminPanelEl.querySelector("#editPassword");
    const roleSelect = adminPanelEl.querySelector("#editRole");
    const statusSelect = adminPanelEl.querySelector("#editStatus");
    const pwdHint = adminPanelEl.querySelector("#editPwdHint");
    const errorEl = adminPanelEl.querySelector("#adminEditError");

    errorEl.hidden = true;
    passwordInput.value = "";

    if (id === null) {
      title.textContent = "新增账号";
      usernameInput.value = "";
      roleSelect.value = "user";
      statusSelect.value = "active";
      pwdHint.textContent = "（必填）";
    } else {
      const u = adminUsersCache.find(function (x) { return x.id === id; });
      if (!u) return;
      title.textContent = "编辑账号：" + u.username;
      usernameInput.value = u.username;
      roleSelect.value = u.role;
      statusSelect.value = u.status;
      pwdHint.textContent = "（留空则不修改）";
    }
    overlay.hidden = false;
  }

  function closeEditDialog() {
    adminPanelEl.querySelector("#adminEditOverlay").hidden = true;
    adminEditingId = null;
  }

  async function saveEditDialog() {
    const username = adminPanelEl.querySelector("#editUsername").value.trim();
    const password = adminPanelEl.querySelector("#editPassword").value;
    const role = adminPanelEl.querySelector("#editRole").value;
    const status = adminPanelEl.querySelector("#editStatus").value;
    const errorEl = adminPanelEl.querySelector("#adminEditError");
    const saveBtn = adminPanelEl.querySelector("#adminEditSave");

    errorEl.hidden = true;

    if (!username || username.length < 2) {
      errorEl.textContent = "用户名至少 2 位";
      errorEl.hidden = false;
      return;
    }
    if (adminEditingId === null && (!password || password.length < 6)) {
      errorEl.textContent = "新增账号密码至少 6 位";
      errorEl.hidden = false;
      return;
    }
    if (password && password.length < 6) {
      errorEl.textContent = "密码至少 6 位";
      errorEl.hidden = false;
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = "保存中…";
    try {
      if (adminEditingId === null) {
        await api("/api/admin/users", {
          method: "POST",
          body: JSON.stringify({ username, password, role, status })
        });
      } else {
        const body = { username, role, status };
        if (password) body.password = password;
        await api("/api/admin/users/" + adminEditingId, {
          method: "PUT",
          body: JSON.stringify(body)
        });
      }
      closeEditDialog();
      await loadAdminUsers();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = "保存";
    }
  }

  async function deleteUser(id) {
    const u = adminUsersCache.find(function (x) { return x.id === id; });
    if (!u) return;
    if (!confirm("确定要删除账号「" + u.username + "」吗？该账号的所有云端数据将被永久删除，不可恢复。")) return;
    try {
      await api("/api/admin/users/" + id, { method: "DELETE" });
      await loadAdminUsers();
    } catch (err) {
      alert("删除失败：" + err.message);
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // ---------- 离线模式 ----------
  async function checkServer() {
    if (location.protocol === "file:") return false;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(function () { ctrl.abort(); }, 3000);
      const res = await fetch("/api/health", { signal: ctrl.signal });
      clearTimeout(timer);
      return res.ok;
    } catch (_) {
      return false;
    }
  }

  function enterOfflineMode() {
    token = null;
    user = null;
    hideOverlay();
    markReady();
  }

  // ---------- 初始化 ----------
  async function init() {
    buildOverlay();
    serverAvailable = await checkServer();

    if (!serverAvailable) {
      overlayEl.querySelector("#authOfflineBtn").hidden = false;
      overlayEl.querySelector("#authHint").textContent =
        location.protocol === "file:"
          ? "检测到直接打开 HTML 文件，请双击 start.bat 启动服务后访问 http://127.0.0.1:8765"
          : "未检测到后端服务，数据将仅保存在本浏览器";
      showOverlay();
      return;
    }

    const ok = await verify();
    if (ok) {
      await pullData();
      enterApp();
    } else {
      showOverlay();
    }
  }

  // DOM 加载后自动初始化
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  return {
    init,
    login,
    register,
    logout,
    switchAccount,
    onReady,
    scheduleSync,
    pushData,
    pullData,
    get user() { return user; },
    get token() { return token; },
    get isLoggedIn() { return Boolean(token); }
  };
})();
