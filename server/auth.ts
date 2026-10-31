import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type Database from "better-sqlite3";
import type { Express, NextFunction, Request, RequestHandler, Response } from "express";

type SqliteDb = Database.Database;

export type UserRole = "owner" | "admin" | "manager" | "employee";
export type AuthPermission =
  | "users:manage"
  | "organization:manage"
  | "catalog:read"
  | "catalog:write"
  | "documents:read"
  | "documents:create"
  | "documents:post"
  | "reports:read";

export type AuthContext = {
  userId: number;
  organizationId: number;
  login: string;
  fullName: string;
  role: UserRole;
  mustChangePassword: boolean;
};

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export type AuthOptions = {
  setupToken?: string;
  cookieName?: string;
  sessionTtlMs?: number;
  maxFailedLogins?: number;
  loginWindowMs?: number;
  lockoutMs?: number;
  now?: () => number;
};

type ResolvedOptions = Required<AuthOptions>;
type AuthUserRow = {
  id: number;
  organization_id: number;
  login: string;
  full_name: string;
  role: UserRole;
  active: number;
  must_change_password: number;
  password_hash: string;
  created_at: string;
  last_login_at: string | null;
  department_ids: string;
};

const defaults: ResolvedOptions = {
  setupToken: "",
  cookieName: "autoworkshop_session",
  sessionTtlMs: 12 * 60 * 60 * 1000,
  maxFailedLogins: 8,
  loginWindowMs: 15 * 60 * 1000,
  lockoutMs: 15 * 60 * 1000,
  now: Date.now,
};

const passwordLength = { min: 12, max: 256 };
const sessionTokenBytes = 32;
const scryptOptions = { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const passwordKeyLength = 64;
const dummySalt = Buffer.from("d3d9a4e2d581f08f0fb8f2e74f93618b", "hex");
const dummyHash = scryptSync("not-a-real-user-password", dummySalt, passwordKeyLength, scryptOptions);

const rolePermissions: Record<UserRole, readonly AuthPermission[]> = {
  owner: ["users:manage", "organization:manage", "catalog:read", "catalog:write", "documents:read", "documents:create", "documents:post", "reports:read"],
  admin: ["users:manage", "organization:manage", "catalog:read", "catalog:write", "documents:read", "documents:create", "documents:post", "reports:read"],
  manager: ["catalog:read", "catalog:write", "documents:read", "documents:create", "documents:post", "reports:read"],
  employee: ["catalog:read", "documents:read", "documents:create", "documents:post"],
};

export const ROLE_PERMISSIONS = rolePermissions;

export function initializeAuthSchema(db: SqliteDb): void {
  const organizationTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'organizations'").get();
  if (!organizationTable) throw new Error("Сначала создайте таблицу организаций.");
  db.exec(`
    CREATE TABLE IF NOT EXISTS departments (
      id INTEGER PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL COLLATE NOCASE,
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (organization_id, name),
      UNIQUE (id, organization_id)
    );
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      login TEXT NOT NULL COLLATE NOCASE,
      full_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('owner','admin','manager','employee')),
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
      must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0,1)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_login_at TEXT,
      UNIQUE (organization_id, login),
      UNIQUE (id, organization_id)
    );
    CREATE INDEX IF NOT EXISTS idx_users_org_active ON users (organization_id, active, full_name COLLATE NOCASE);
    CREATE TABLE IF NOT EXISTS auth_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions (user_id, expires_at);
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry ON auth_sessions (expires_at);
    CREATE TABLE IF NOT EXISTS auth_login_limits (
      ip_hash TEXT PRIMARY KEY,
      window_started_at INTEGER NOT NULL,
      failure_count INTEGER NOT NULL,
      blocked_until INTEGER NOT NULL DEFAULT 0
    );
  `);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_departments_id_organization ON departments (id, organization_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_id_organization ON users (id, organization_id);`);
  ensureUserDepartmentsSchema(db);
}

function ensureUserDepartmentsSchema(db: SqliteDb): void {
  const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'user_departments'").get();
  if (table) {
    const columns = db.pragma("table_info(user_departments)") as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "organization_id")) {
      db.transaction(() => {
        db.exec("ALTER TABLE user_departments RENAME TO user_departments_legacy_scope");
        createUserDepartmentsTable(db);
        db.exec(`INSERT OR IGNORE INTO user_departments (user_id, organization_id, department_id)
          SELECT ud.user_id, u.organization_id, ud.department_id
          FROM user_departments_legacy_scope ud
          JOIN users u ON u.id = ud.user_id
          JOIN departments d ON d.id = ud.department_id AND d.organization_id = u.organization_id`);
        db.exec("DROP TABLE user_departments_legacy_scope");
      })();
    }
  } else {
    createUserDepartmentsTable(db);
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_user_departments_department ON user_departments (organization_id, department_id, user_id)");
}

function createUserDepartmentsTable(db: SqliteDb): void {
  db.exec(`CREATE TABLE user_departments (
    user_id INTEGER NOT NULL,
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    department_id INTEGER NOT NULL,
    PRIMARY KEY (user_id, department_id),
    FOREIGN KEY (user_id, organization_id) REFERENCES users (id, organization_id) ON DELETE CASCADE,
    FOREIGN KEY (department_id, organization_id) REFERENCES departments (id, organization_id) ON DELETE CASCADE
  )`);
}

export function hasRole(context: AuthContext | undefined, ...roles: UserRole[]): boolean {
  return Boolean(context && roles.includes(context.role));
}

export function hasPermission(context: AuthContext | undefined, permission: AuthPermission): boolean {
  return Boolean(context && rolePermissions[context.role]?.includes(permission));
}

export const requireAuth: RequestHandler = (req, res, next) => {
  if (!req.auth) return res.status(401).json({ error: "Требуется войти в систему." });
  next();
};

export const requirePasswordUpdated: RequestHandler = (req, res, next) => {
  if (req.auth?.mustChangePassword) return res.status(403).json({ error: "Смените временный пароль перед продолжением." });
  next();
};

export function requireRole(...roles: UserRole[]): RequestHandler {
  return (req, res, next) => {
    if (!req.auth) return res.status(401).json({ error: "Требуется войти в систему." });
    if (!hasRole(req.auth, ...roles)) return res.status(403).json({ error: "Недостаточно прав." });
    next();
  };
}

export function requirePermission(permission: AuthPermission): RequestHandler {
  return (req, res, next) => {
    if (!req.auth) return res.status(401).json({ error: "Требуется войти в систему." });
    if (!hasPermission(req.auth, permission)) return res.status(403).json({ error: "Недостаточно прав." });
    next();
  };
}

export function authMiddleware(db: SqliteDb, options?: AuthOptions): RequestHandler {
  const config = resolveOptions(options);
  return (req, res, next) => {
    const token = readCookie(req, config.cookieName);
    if (!token) return next();
    const tokenHash = sha256(token);
    const now = config.now();
    const row = db.prepare(`SELECT u.id, u.organization_id, u.login, u.full_name, u.role, u.active,
        u.must_change_password, s.expires_at
      FROM auth_sessions s JOIN users u ON u.id = s.user_id AND u.organization_id = s.organization_id
      WHERE s.token_hash = ?`).get(tokenHash) as
      | (Omit<AuthUserRow, "password_hash" | "created_at" | "last_login_at"> & { expires_at: number })
      | undefined;
    if (!row || row.active !== 1 || row.expires_at <= now) {
      db.prepare("DELETE FROM auth_sessions WHERE token_hash = ?").run(tokenHash);
      clearSessionCookie(res, req, config);
      return next();
    }
    req.auth = toAuthContext(row);
    next();
  };
}

export function registerAuthRoutes(app: Express, db: SqliteDb, options?: AuthOptions): void {
  initializeAuthSchema(db);
  const config = resolveOptions(options);
  app.use("/api/auth", authMiddleware(db, config));

  app.get("/api/auth/setup-status", (_req, res) => {
    const count = Number((db.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number }).count);
    res.json({ needsSetup: count === 0, setupTokenConfigured: Boolean(config.setupToken || process.env.SETUP_TOKEN) });
  });

  app.post("/api/auth/setup", (req, res, next) => {
    try {
      if (!isSecureRequestAllowed(req, res)) return;
      const now = config.now();
      const setupIpHash = sha256(`setup:${String(req.ip || req.socket.remoteAddress || "unknown")}`);
      if (isLoginBlocked(db, setupIpHash, now)) return res.status(429).json({ error: "Не удалось выполнить первоначальную настройку." });
      const expectedToken = config.setupToken || process.env.SETUP_TOKEN || "";
      const suppliedToken = String(req.get("x-setup-token") ?? "");
      if (!expectedToken || !constantTimeTextEqual(expectedToken, suppliedToken)) {
        if (expectedToken) recordLoginFailure(db, setupIpHash, now, config);
        return res.status(403).json({ error: "Не удалось выполнить первоначальную настройку." });
      }
      db.prepare("DELETE FROM auth_login_limits WHERE ip_hash = ?").run(setupIpHash);
      const login = normalizeLogin(req.body?.login);
      const fullName = requiredText(req.body?.fullName, "Имя сотрудника", 120);
      const password = validatePassword(req.body?.password);
      if (!login) throw new AuthError(400, "Укажите логин длиной от 3 до 120 символов.");
      const passwordHash = hashPassword(password);
      const setup = db.transaction(() => {
        if (Number((db.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number }).count) > 0) {
          throw new AuthError(409, "Первоначальная настройка уже выполнена.");
        }
        const organizations = db.prepare("SELECT id FROM organizations ORDER BY id LIMIT 2").all() as Array<{ id: number }>;
        if (organizations.length !== 1) throw new AuthError(409, "Для настройки должна существовать ровно одна организация.");
        const organizationId = Number(organizations[0].id);
        const result = db.prepare(`INSERT INTO users (organization_id, login, full_name, password_hash, role, active, must_change_password)
          VALUES (?, ?, ?, ?, 'owner', 1, 0)`).run(organizationId, login, fullName, passwordHash);
        const userId = Number(result.lastInsertRowid);
        db.prepare("UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?").run(userId, organizationId);
        const user = getUser(db, userId, organizationId);
        if (!user) throw new AuthError(500, "Не удалось создать учётную запись.");
        const token = createSession(db, userId, organizationId, now, config);
        return { user, token };
      });
      const result = setup();
      setSessionCookie(res, result.token, req, config);
      res.status(201).json({ authenticated: true, user: publicUser(result.user) });
    } catch (error) { handleAuthError(error, res, next); }
  });

  app.post("/api/auth/login", (req, res, next) => {
    try {
      if (!isSecureRequestAllowed(req, res)) return;
      const now = config.now();
      const ipHash = sha256(String(req.ip || req.socket.remoteAddress || "unknown"));
      if (isLoginBlocked(db, ipHash, now)) return res.status(429).json({ error: "Неверный логин или пароль." });

      const login = normalizeLogin(req.body?.login);
      const password = typeof req.body?.password === "string" ? req.body.password : "";
      const safePassword = password.length <= passwordLength.max ? password : "";
      const row = login ? db.prepare(`SELECT id, organization_id, login, full_name, role, active,
          must_change_password, password_hash, created_at, last_login_at
        FROM users WHERE login = ? COLLATE NOCASE LIMIT 1`).get(login) as AuthUserRow | undefined : undefined;
      const verified = verifyPassword(safePassword, row?.password_hash ?? null);
      if (!row || row.active !== 1 || password.length > passwordLength.max || !verified) {
        const blocked = recordLoginFailure(db, ipHash, now, config);
        return res.status(blocked ? 429 : 401).json({ error: "Неверный логин или пароль." });
      }

      db.prepare("DELETE FROM auth_login_limits WHERE ip_hash = ?").run(ipHash);
      db.prepare("UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?")
        .run(row.id, row.organization_id);
      const sessionToken = createSession(db, row.id, row.organization_id, now, config);
      const updated = getUser(db, row.id, row.organization_id);
      if (!updated) throw new AuthError(500, "Не удалось войти в систему.");
      setSessionCookie(res, sessionToken, req, config);
      res.json({ authenticated: true, user: publicUser(updated) });
    } catch (error) { handleAuthError(error, res, next); }
  });

  app.get("/api/auth/me", (req, res) => {
    if (!req.auth) return res.json({ authenticated: false, user: null });
    const user = getUser(db, req.auth.userId, req.auth.organizationId);
    if (!user || user.active !== 1) return res.json({ authenticated: false, user: null });
    res.json({ authenticated: true, user: publicUser(user) });
  });

  app.post("/api/auth/logout", (req, res) => {
    const token = readCookie(req, config.cookieName);
    if (token) db.prepare("DELETE FROM auth_sessions WHERE token_hash = ?").run(sha256(token));
    clearSessionCookie(res, req, config);
    res.json({ ok: true });
  });

  app.post("/api/auth/password", requireAuth, (req, res, next) => {
    try {
      if (!isSecureRequestAllowed(req, res)) return;
      const context = req.auth!;
      const user = db.prepare(`SELECT id, organization_id, login, full_name, role, active,
          must_change_password, password_hash, created_at, last_login_at
        FROM users WHERE id = ? AND organization_id = ?`).get(context.userId, context.organizationId) as AuthUserRow | undefined;
      const currentPassword = typeof req.body?.currentPassword === "string" ? req.body.currentPassword : "";
      if (!user || user.active !== 1 || !verifyPassword(currentPassword, user.password_hash)) {
        return res.status(400).json({ error: "Текущий пароль не подходит." });
      }
      const newPassword = validatePassword(req.body?.newPassword);
      db.transaction(() => {
        db.prepare("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ? AND organization_id = ?")
          .run(hashPassword(newPassword), user.id, user.organization_id);
        db.prepare("DELETE FROM auth_sessions WHERE user_id = ?").run(user.id);
      })();
      clearSessionCookie(res, req, config);
      res.json({ ok: true, loginRequired: true });
    } catch (error) { handleAuthError(error, res, next); }
  });

  app.get("/api/auth/users", requirePermission("users:manage"), requirePasswordUpdated, (req, res) => {
    const rows = db.prepare(`SELECT id, organization_id, login, full_name, role, active,
        must_change_password, created_at, last_login_at,
        COALESCE((SELECT group_concat(ud.department_id, ',') FROM user_departments ud WHERE ud.user_id = users.id), '') AS department_ids
      FROM users WHERE organization_id = ? ORDER BY full_name COLLATE NOCASE, id`)
      .all(req.auth!.organizationId) as AuthUserRow[];
    res.json(rows.map(publicUser));
  });

  app.post("/api/auth/users", requirePermission("users:manage"), requirePasswordUpdated, (req, res, next) => {
    try {
      if (!isSecureRequestAllowed(req, res)) return;
      const actor = req.auth!;
      const login = normalizeLogin(req.body?.login);
      const fullName = requiredText(req.body?.fullName, "Имя сотрудника", 120);
      const temporaryPassword = validatePassword(req.body?.temporaryPassword);
      const role = parseCreatableRole(req.body?.role ?? "employee", actor.role);
      const departmentIds = parseDepartmentIds(db, req.body?.departmentIds, role, actor.organizationId);
      if (!login) throw new AuthError(400, "Укажите логин длиной от 3 до 120 символов.");
      const result = db.transaction(() => {
      const inserted = db.prepare(`INSERT INTO users (organization_id, login, full_name, password_hash, role, active, must_change_password)
          VALUES (?, ?, ?, ?, ?, 1, 1)`).run(actor.organizationId, login, fullName, hashPassword(temporaryPassword), role);
        const userId = Number(inserted.lastInsertRowid);
        saveUserDepartments(db, userId, actor.organizationId, departmentIds);
        const user = getUser(db, userId, actor.organizationId);
        if (!user) throw new AuthError(500, "Не удалось создать учётную запись сотрудника.");
        return user;
      });
      res.status(201).json(publicUser(result()));
    } catch (error) { handleAuthError(error, res, next); }
  });

  app.patch("/api/auth/users/:id", requirePermission("users:manage"), requirePasswordUpdated, (req, res, next) => {
    try {
      if (!isSecureRequestAllowed(req, res)) return;
      const actor = req.auth!;
      const userId = parseId(req.params.id);
      if (!userId) throw new AuthError(400, "Проверьте номер сотрудника.");
      const existing = getUser(db, userId, actor.organizationId);
      if (!existing) throw new AuthError(404, "Сотрудник не найден.");
      const body = req.body as Record<string, unknown>;
      if (!body || typeof body !== "object" || Array.isArray(body) || !Object.keys(body).length) {
        throw new AuthError(400, "Укажите, что нужно изменить.");
      }
      const allowedFields = new Set(["fullName", "role", "active", "departmentIds"]);
      if (Object.keys(body).some((key) => !allowedFields.has(key))) throw new AuthError(400, "Проверьте поля сотрудника.");
      const self = userId === actor.userId;
      if (self && (body.role !== undefined || body.active !== undefined)) {
        throw new AuthError(400, "Нельзя изменить собственную роль или отключить свой доступ.");
      }
      if (existing.role === "owner") throw new AuthError(400, "Учётную запись владельца нельзя изменить здесь.");
      if (actor.role === "admin" && existing.role === "admin") throw new AuthError(403, "Только владелец может изменить администратора.");

      const fullName = body.fullName === undefined ? existing.full_name : requiredText(body.fullName, "Имя сотрудника", 120);
      const role = body.role === undefined ? existing.role : parseCreatableRole(body.role, actor.role);
      const active = body.active === undefined ? existing.active : parseActive(body.active);
      if (actor.role === "admin" && role === "admin") throw new AuthError(403, "Только владелец может назначить администратора.");
      const currentDepartmentIds = parseSavedDepartmentIds(existing.department_ids);
      const isScopedRole = role === "manager" || role === "employee";
      const requiresActiveAssignment = existing.active === 0 && active === 1 && isScopedRole;
      const departmentIds = body.departmentIds === undefined && role === existing.role && !requiresActiveAssignment
        ? currentDepartmentIds
        : parseDepartmentIds(db, body.departmentIds === undefined ? currentDepartmentIds : body.departmentIds, role, actor.organizationId);
      const credentialsChanged = role !== existing.role || (existing.active === 1 && active === 0);
      db.transaction(() => {
        db.prepare(`UPDATE users SET full_name = ?, role = ?, active = ? WHERE id = ? AND organization_id = ?`)
          .run(fullName, role, active, userId, actor.organizationId);
        if (body.departmentIds !== undefined || role !== existing.role) saveUserDepartments(db, userId, actor.organizationId, departmentIds);
        if (credentialsChanged) db.prepare("DELETE FROM auth_sessions WHERE user_id = ?").run(userId);
      })();
      const updated = getUser(db, userId, actor.organizationId);
      if (!updated) throw new AuthError(404, "Сотрудник не найден.");
      res.json(publicUser(updated));
    } catch (error) { handleAuthError(error, res, next); }
  });

  app.post("/api/auth/users/:id/reset-password", requirePermission("users:manage"), requirePasswordUpdated, (req, res, next) => {
    try {
      if (!isSecureRequestAllowed(req, res)) return;
      const actor = req.auth!;
      const userId = parseId(req.params.id);
      if (!userId) throw new AuthError(400, "Проверьте номер сотрудника.");
      if (userId === actor.userId) throw new AuthError(400, "Для смены собственного пароля используйте смену пароля в профиле.");
      const target = getUser(db, userId, actor.organizationId);
      if (!target) throw new AuthError(404, "Сотрудник не найден.");
      if (target.role === "owner" || (actor.role === "admin" && target.role === "admin")) {
        throw new AuthError(403, "Недостаточно прав для сброса пароля этого сотрудника.");
      }
      const temporaryPassword = validatePassword(req.body?.temporaryPassword);
      db.transaction(() => {
        db.prepare(`UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ? AND organization_id = ?`)
          .run(hashPassword(temporaryPassword), userId, actor.organizationId);
        db.prepare("DELETE FROM auth_sessions WHERE user_id = ?").run(userId);
      })();
      res.json({ ok: true, mustChangePassword: true });
    } catch (error) { handleAuthError(error, res, next); }
  });
}

function resolveOptions(options?: AuthOptions): ResolvedOptions {
  const result = { ...defaults, ...options };
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(result.cookieName)) throw new Error("Недопустимое имя cookie сессии.");
  if (!Number.isSafeInteger(result.sessionTtlMs) || result.sessionTtlMs < 60_000 || result.sessionTtlMs > 30 * 24 * 60 * 60 * 1000) {
    throw new Error("Срок сессии должен быть от минуты до 30 дней.");
  }
  if (!Number.isSafeInteger(result.maxFailedLogins) || result.maxFailedLogins < 1 || result.maxFailedLogins > 100) {
    throw new Error("Проверьте лимит попыток входа.");
  }
  if (!Number.isSafeInteger(result.loginWindowMs) || result.loginWindowMs < 60_000 || result.loginWindowMs > 24 * 60 * 60 * 1000) {
    throw new Error("Проверьте окно ограничения попыток входа.");
  }
  if (!Number.isSafeInteger(result.lockoutMs) || result.lockoutMs < 60_000 || result.lockoutMs > 24 * 60 * 60 * 1000) {
    throw new Error("Проверьте срок ограничения попыток входа.");
  }
  return result;
}

function readCookie(req: Request, name: string): string | null {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;
  for (const pair of cookieHeader.split(";")) {
    const separator = pair.indexOf("=");
    if (separator < 0 || pair.slice(0, separator).trim() !== name) continue;
    try { return decodeURIComponent(pair.slice(separator + 1).trim()) || null; }
    catch { return null; }
  }
  return null;
}

function createSession(db: SqliteDb, userId: number, organizationId: number, now: number, config: ResolvedOptions): string {
  const token = randomBytes(sessionTokenBytes).toString("base64url");
  db.prepare("DELETE FROM auth_sessions WHERE expires_at <= ?").run(now);
  db.prepare(`INSERT INTO auth_sessions (token_hash, user_id, organization_id, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?)`).run(sha256(token), userId, organizationId, now, now + config.sessionTtlMs);
  return token;
}

function setSessionCookie(res: Response, token: string, req: Request, config: ResolvedOptions): void {
  const secure = process.env.NODE_ENV === "production" || req.secure;
  const maxAge = Math.floor(config.sessionTtlMs / 1000);
  res.append("Set-Cookie", `${config.cookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`);
}

function clearSessionCookie(res: Response, req: Request, config: ResolvedOptions): void {
  const secure = process.env.NODE_ENV === "production" || req.secure;
  res.append("Set-Cookie", `${config.cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure ? "; Secure" : ""}`);
}

function isSecureRequestAllowed(req: Request, res: Response): boolean {
  if (process.env.NODE_ENV !== "production" || req.secure) return true;
  res.status(400).json({ error: "Для входа и настройки требуется HTTPS." });
  return false;
}

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, passwordKeyLength, scryptOptions);
  return `scrypt$${scryptOptions.N}$${scryptOptions.r}$${scryptOptions.p}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

function verifyPassword(password: string, encoded: string | null): boolean {
  const parts = encoded?.split("$");
  if (!parts || parts.length !== 6 || parts[0] !== "scrypt" || Number(parts[1]) !== scryptOptions.N
      || Number(parts[2]) !== scryptOptions.r || Number(parts[3]) !== scryptOptions.p) {
    const dummyCandidate = scryptSync(password || "invalid", dummySalt, passwordKeyLength, scryptOptions);
    timingSafeEqual(dummyCandidate, dummyHash);
    return false;
  }
  try {
    const salt = Buffer.from(parts[4], "base64url");
    const expected = Buffer.from(parts[5], "base64url");
    if (salt.length !== 16 || expected.length !== passwordKeyLength) return false;
    const candidate = scryptSync(password || "invalid", salt, passwordKeyLength, scryptOptions);
    return timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}

function validatePassword(value: unknown): string {
  if (typeof value !== "string" || value.length < passwordLength.min || value.length > passwordLength.max) {
    throw new AuthError(400, `Пароль должен содержать от ${passwordLength.min} до ${passwordLength.max} символов.`);
  }
  return value;
}

function normalizeLogin(value: unknown): string {
  if (typeof value !== "string") return "";
  const login = value.trim().normalize("NFKC").toLocaleLowerCase("ru-RU");
  if (login.length < 3 || login.length > 120 || /[\u0000-\u001f\u007f]/.test(login)) return "";
  return login;
}

function requiredText(value: unknown, label: string, maxLength: number): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > maxLength) throw new AuthError(400, `Проверьте поле «${label}».`);
  return text;
}

function parseCreatableRole(value: unknown, actorRole: UserRole): Exclude<UserRole, "owner"> {
  if (value !== "admin" && value !== "manager" && value !== "employee") throw new AuthError(400, "Проверьте роль сотрудника.");
  if (value === "admin" && actorRole !== "owner") throw new AuthError(403, "Только владелец может назначить администратора.");
  return value;
}

function parseActive(value: unknown): number {
  if (value === true || value === 1 || value === "1") return 1;
  if (value === false || value === 0 || value === "0") return 0;
  throw new AuthError(400, "Проверьте статус сотрудника.");
}

function parseId(value: unknown): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function isLoginBlocked(db: SqliteDb, ipHash: string, now: number): boolean {
  const row = db.prepare("SELECT blocked_until FROM auth_login_limits WHERE ip_hash = ?").get(ipHash) as { blocked_until: number } | undefined;
  return Boolean(row && row.blocked_until > now);
}

function recordLoginFailure(db: SqliteDb, ipHash: string, now: number, config: ResolvedOptions): boolean {
  return db.transaction(() => {
    const existing = db.prepare("SELECT window_started_at, failure_count, blocked_until FROM auth_login_limits WHERE ip_hash = ?")
      .get(ipHash) as { window_started_at: number; failure_count: number; blocked_until: number } | undefined;
    if (existing && existing.blocked_until > now) return true;
    const inWindow = existing && now - existing.window_started_at < config.loginWindowMs;
    const windowStartedAt = inWindow ? existing.window_started_at : now;
    const failureCount = inWindow ? existing.failure_count + 1 : 1;
    const blockedUntil = failureCount >= config.maxFailedLogins ? now + config.lockoutMs : 0;
    db.prepare(`INSERT INTO auth_login_limits (ip_hash, window_started_at, failure_count, blocked_until)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(ip_hash) DO UPDATE SET window_started_at = excluded.window_started_at,
        failure_count = excluded.failure_count, blocked_until = excluded.blocked_until`)
      .run(ipHash, windowStartedAt, failureCount, blockedUntil);
    return blockedUntil > now;
  })();
}

function getUser(db: SqliteDb, userId: number, organizationId: number): AuthUserRow | undefined {
  return db.prepare(`SELECT id, organization_id, login, full_name, role, active, must_change_password,
      password_hash, created_at, last_login_at,
      COALESCE((SELECT group_concat(ud.department_id, ',') FROM user_departments ud WHERE ud.user_id = users.id), '') AS department_ids
    FROM users WHERE id = ? AND organization_id = ?`).get(userId, organizationId) as AuthUserRow | undefined;
}

function publicUser(user: AuthUserRow) {
  return {
    id: user.id,
    organization_id: user.organization_id,
    login: user.login,
    full_name: user.full_name,
    role: user.role,
    active: user.active,
    must_change_password: user.must_change_password,
    created_at: user.created_at,
    last_login_at: user.last_login_at,
    department_ids: parseSavedDepartmentIds(user.department_ids),
  };
}

function parseSavedDepartmentIds(value: string | undefined): number[] {
  if (!value) return [];
  return value.split(",").map(Number).filter((id) => Number.isSafeInteger(id) && id > 0);
}

function parseDepartmentIds(db: SqliteDb, value: unknown, role: UserRole, organizationId: number): number[] {
  if (value === undefined) value = [];
  if (!Array.isArray(value)) throw new AuthError(400, "Выберите подразделения для сотрудника.");
  const ids = value.map((item) => Number(item));
  if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0) || new Set(ids).size !== ids.length) {
    throw new AuthError(400, "Проверьте список подразделений сотрудника.");
  }
  for (const id of ids) {
    if (!db.prepare("SELECT 1 FROM departments WHERE id = ? AND organization_id = ? AND active = 1").get(id, organizationId)) {
      throw new AuthError(400, "Выбрано неактивное подразделение или подразделение другой организации.");
    }
  }
  if ((role === "manager" || role === "employee") && ids.length === 0) {
    throw new AuthError(400, "Назначьте сотруднику хотя бы одно активное подразделение.");
  }
  return ids;
}

function saveUserDepartments(db: SqliteDb, userId: number, organizationId: number, departmentIds: number[]): void {
  db.prepare("DELETE FROM user_departments WHERE user_id = ? AND organization_id = ?").run(userId, organizationId);
  const insert = db.prepare("INSERT INTO user_departments (user_id, organization_id, department_id) VALUES (?, ?, ?)");
  for (const departmentId of departmentIds) insert.run(userId, organizationId, departmentId);
}

function toAuthContext(row: Pick<AuthUserRow, "id" | "organization_id" | "login" | "full_name" | "role" | "must_change_password">): AuthContext {
  return {
    userId: row.id,
    organizationId: row.organization_id,
    login: row.login,
    fullName: row.full_name,
    role: row.role,
    mustChangePassword: row.must_change_password === 1,
  };
}

function constantTimeTextEqual(expected: string, supplied: string): boolean {
  return timingSafeEqual(sha256Buffer(expected), sha256Buffer(supplied));
}

function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function sha256Buffer(value: string): Buffer { return createHash("sha256").update(value).digest(); }

function handleAuthError(error: unknown, res: Response, next: NextFunction): void {
  if (error instanceof AuthError) { res.status(error.status).json({ error: error.message }); return; }
  if (isUniqueLoginError(error)) { res.status(409).json({ error: "Этот логин уже используется в организации." }); return; }
  next(error);
}

function isUniqueLoginError(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed: users\.organization_id, users\.login/i.test(error.message);
}

class AuthError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
