"use strict";

const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { DatabaseSync } = require("node:sqlite");

// ---------- 配置 ----------
const PORT = process.env.PORT || 8765;
const JWT_SECRET = process.env.JWT_SECRET || "zhiying-studio-dev-secret-change-in-production";
const JWT_EXPIRES = "7d";
const DB_PATH = path.join(__dirname, "data", "app.db");

// 确保 data 目录存在
fs.mkdirSync(path.join(__dirname, "data"), { recursive: true });

// ---------- 数据库（Node 内置 SQLite，无需原生编译） ----------
const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_login_at TEXT
  );

  CREATE TABLE IF NOT EXISTS user_data (
    user_id INTEGER NOT NULL,
    data_key TEXT NOT NULL,
    data_value TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, data_key),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

// 兼容旧数据库：补充新增列
const cols = db.prepare("PRAGMA table_info(users)").all();
const colNames = cols.map(c => c.name);
if (!colNames.includes("status")) {
  db.exec("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
}
if (!colNames.includes("last_login_at")) {
  db.exec("ALTER TABLE users ADD COLUMN last_login_at TEXT");
}

// ---------- 初始化管理员账号 ----------
function ensureAdmin() {
  const existing = db.prepare("SELECT id FROM users WHERE username = ?").get("admin");
  if (existing) return;
  const hash = bcrypt.hashSync("123456", 10);
  db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')").run("admin", hash);
  console.log("[init] 管理员账号已创建: admin / 123456");
}
ensureAdmin();

function ensureDemoUsers() {
  const demoUsers = [
    { username: "demo", password: "demo123", role: "user" },
    { username: "tester", password: "123456", role: "user" }
  ];
  for (const item of demoUsers) {
    const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(item.username);
    if (existing) continue;
    const hash = bcrypt.hashSync(item.password, 10);
    db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)").run(item.username, hash, item.role);
    console.log(`[init] 演示账号已创建: ${item.username} / ${item.password}`);
  }
}
ensureDemoUsers();

// ---------- 工具函数 ----------
function signToken(user) {
  return jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "未登录" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (_) {
    return res.status(401).json({ error: "登录已过期，请重新登录" });
  }
}

function safeUsername(name) {
  return typeof name === "string" && /^[a-zA-Z0-9_\u4e00-\u9fa5]{2,20}$/.test(name.trim());
}

// ---------- Express ----------
const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// 静态文件
app.use(express.static(__dirname, {
  index: "index.html",
  extensions: ["html"]
}));

// ---------- API 路由 ----------

// 注册
app.post("/api/register", (req, res) => {
  const { username, password } = req.body || {};
  if (!safeUsername(username)) {
    return res.status(400).json({ error: "用户名需为 2-20 位字母、数字、下划线或中文" });
  }
  if (!password || typeof password !== "string" || password.length < 6) {
    return res.status(400).json({ error: "密码至少 6 位" });
  }
  const name = username.trim();
  const exists = db.prepare("SELECT id FROM users WHERE username = ?").get(name);
  if (exists) return res.status(409).json({ error: "用户名已被注册" });

  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'user')").run(name, hash);
  const user = { id: Number(info.lastInsertRowid), username: name, role: "user" };
  const token = signToken(user);
  res.json({ token, user });
});

// 登录
app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "请输入用户名和密码" });
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(String(username).trim());
  if (!user) return res.status(401).json({ error: "用户名或密码错误" });
  if (user.status === "disabled") return res.status(403).json({ error: "账号已被管理员禁用，请联系管理员" });
  const ok = bcrypt.compareSync(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: "用户名或密码错误" });
  db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(user.id);
  const token = signToken(user);
  res.json({ token, user: { id: user.id, username: user.username, role: user.role, status: user.status } });
});

// 当前用户信息
app.get("/api/me", authMiddleware, (req, res) => {
  const user = db.prepare("SELECT id, username, role, created_at FROM users WHERE id = ?").get(req.user.id);
  if (!user) return res.status(404).json({ error: "用户不存在" });
  res.json({ user });
});

// 获取该用户全部数据
app.get("/api/data", authMiddleware, (req, res) => {
  const rows = db.prepare("SELECT data_key, data_value FROM user_data WHERE user_id = ?").all(req.user.id);
  const data = {};
  for (const row of rows) {
    try { data[row.data_key] = JSON.parse(row.data_value); } catch (_) { data[row.data_key] = row.data_value; }
  }
  res.json({ data });
});

// 保存/更新单个数据键
app.put("/api/data", authMiddleware, (req, res) => {
  const { key, value } = req.body || {};
  if (!key || typeof key !== "string") return res.status(400).json({ error: "缺少数据键" });
  const json = JSON.stringify(value === undefined ? null : value);
  db.prepare(`
    INSERT INTO user_data (user_id, data_key, data_value, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, data_key) DO UPDATE SET data_value = excluded.data_value, updated_at = datetime('now')
  `).run(req.user.id, key, json);
  res.json({ ok: true });
});

// 批量保存数据
app.post("/api/data/batch", authMiddleware, (req, res) => {
  const { data } = req.body || {};
  if (!data || typeof data !== "object") return res.status(400).json({ error: "数据格式错误" });
  const upsert = db.prepare(`
    INSERT INTO user_data (user_id, data_key, data_value, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, data_key) DO UPDATE SET data_value = excluded.data_value, updated_at = datetime('now')
  `);
  db.exec("BEGIN");
  try {
    for (const [key, value] of Object.entries(data)) {
      upsert.run(req.user.id, key, JSON.stringify(value === undefined ? null : value));
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    return res.status(500).json({ error: "保存失败" });
  }
  res.json({ ok: true });
});

// 管理员：用户列表（含数据量统计）
app.get("/api/admin/users", authMiddleware, (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "需要管理员权限" });
  const users = db.prepare(`
    SELECT u.id, u.username, u.role, u.status, u.created_at, u.last_login_at,
           (SELECT COUNT(*) FROM user_data d WHERE d.user_id = u.id) AS data_count
    FROM users u
    ORDER BY u.id
  `).all();
  res.json({ users });
});

// 管理员：创建用户
app.post("/api/admin/users", authMiddleware, (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "需要管理员权限" });
  const { username, password, role } = req.body || {};
  if (!safeUsername(username)) return res.status(400).json({ error: "用户名需为 2-20 位字母、数字、下划线或中文" });
  if (!password || typeof password !== "string" || password.length < 6) return res.status(400).json({ error: "密码至少 6 位" });
  const name = username.trim();
  const userRole = role === "admin" ? "admin" : "user";
  const exists = db.prepare("SELECT id FROM users WHERE username = ?").get(name);
  if (exists) return res.status(409).json({ error: "用户名已存在" });
  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)").run(name, hash, userRole);
  res.json({ ok: true, id: Number(info.lastInsertRowid) });
});

// 管理员：更新用户
app.put("/api/admin/users/:id", authMiddleware, (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "需要管理员权限" });
  const targetId = Number(req.params.id);
  const target = db.prepare("SELECT * FROM users WHERE id = ?").get(targetId);
  if (!target) return res.status(404).json({ error: "用户不存在" });

  const { username, password, role, status } = req.body || {};
  const updates = [];
  const params = [];

  if (username !== undefined) {
    if (!safeUsername(username)) return res.status(400).json({ error: "用户名需为 2-20 位字母、数字、下划线或中文" });
    const name = username.trim();
    const dup = db.prepare("SELECT id FROM users WHERE username = ? AND id != ?").get(name, targetId);
    if (dup) return res.status(409).json({ error: "用户名已被占用" });
    updates.push("username = ?");
    params.push(name);
  }
  if (password !== undefined && password !== "") {
    if (typeof password !== "string" || password.length < 6) return res.status(400).json({ error: "密码至少 6 位" });
    updates.push("password_hash = ?");
    params.push(bcrypt.hashSync(password, 10));
  }
  if (role !== undefined) {
    // 不能把最后一个管理员降级
    if (role !== "admin" && target.role === "admin") {
      const adminCount = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'").get().c;
      if (adminCount <= 1) return res.status(400).json({ error: "至少需要保留一个管理员账号" });
    }
    updates.push("role = ?");
    params.push(role === "admin" ? "admin" : "user");
  }
  if (status !== undefined) {
    if (!["active", "disabled"].includes(status)) return res.status(400).json({ error: "状态值无效" });
    // 不能禁用自己
    if (targetId === req.user.id && status === "disabled") return res.status(400).json({ error: "不能禁用当前登录的管理员账号" });
    updates.push("status = ?");
    params.push(status);
  }

  if (updates.length === 0) return res.status(400).json({ error: "没有需要更新的字段" });
  params.push(targetId);
  db.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).run(...params);
  res.json({ ok: true });
});

// 管理员：删除用户
app.delete("/api/admin/users/:id", authMiddleware, (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "需要管理员权限" });
  const targetId = Number(req.params.id);
  if (targetId === req.user.id) return res.status(400).json({ error: "不能删除当前登录的管理员账号" });
  const target = db.prepare("SELECT * FROM users WHERE id = ?").get(targetId);
  if (!target) return res.status(404).json({ error: "用户不存在" });
  if (target.role === "admin") {
    const adminCount = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'").get().c;
    if (adminCount <= 1) return res.status(400).json({ error: "至少需要保留一个管理员账号" });
  }
  db.prepare("DELETE FROM user_data WHERE user_id = ?").run(targetId);
  db.prepare("DELETE FROM users WHERE id = ?").run(targetId);
  res.json({ ok: true });
});

// 健康检查
app.get("/api/health", (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// SPA 回退
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("");
  console.log("  智影工坊已启动: http://127.0.0.1:" + PORT);
  console.log("  管理员账号: admin / 123456");
  console.log("  数据库文件: " + DB_PATH);
  console.log("");
});
