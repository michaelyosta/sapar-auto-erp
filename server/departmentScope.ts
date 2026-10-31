import type Database from "better-sqlite3";
import type { Express, Request } from "express";
import type { AuthContext } from "./auth.js";

type SqliteDb = Database.Database;

export type Department = { id: number; organization_id: number; name: string; active: number };

export function initializeDepartmentScopeSchema(db: SqliteDb): void {
  db.exec(`CREATE TABLE IF NOT EXISTS department_scope_migrations (
    organization_id INTEGER PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
    initial_user_backfill_done INTEGER NOT NULL DEFAULT 0 CHECK (initial_user_backfill_done IN (0,1))
  )`);
  const columns = db.pragma("table_info(warehouses)") as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "department_id")) {
    db.exec("ALTER TABLE warehouses ADD COLUMN department_id INTEGER REFERENCES departments(id)");
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_warehouses_org_department ON warehouses (organization_id, department_id, active)");

  const organizations = db.prepare("SELECT id FROM organizations ORDER BY id").all() as Array<{ id: number }>;
  const seed = db.transaction(() => {
    for (const organization of organizations) {
      const activeDepartments = db.prepare("SELECT id FROM departments WHERE organization_id = ? AND active = 1 ORDER BY id").all(organization.id) as Array<{ id: number }>;
      const departmentCount = Number((db.prepare("SELECT COUNT(*) AS count FROM departments WHERE organization_id = ?").get(organization.id) as { count: number }).count);
      let departmentId = activeDepartments.length === 1 ? activeDepartments[0].id : undefined;
      if (!activeDepartments.length && departmentCount === 0) {
        const result = db.prepare("INSERT INTO departments (organization_id, name) VALUES (?, ?)").run(organization.id, "Основной салон");
        departmentId = Number(result.lastInsertRowid);
      }
      if (departmentId) {
        db.prepare("UPDATE warehouses SET department_id = ? WHERE organization_id = ? AND department_id IS NULL")
          .run(departmentId, organization.id);
      }

      const backfill = db.prepare("SELECT initial_user_backfill_done FROM department_scope_migrations WHERE organization_id = ?")
        .get(organization.id) as { initial_user_backfill_done: number } | undefined;
      if (!backfill) {
        const activeDepartmentCount = Number((db.prepare("SELECT COUNT(*) AS count FROM departments WHERE organization_id = ? AND active = 1")
          .get(organization.id) as { count: number }).count);
        if (departmentId && activeDepartmentCount === 1) {
          db.prepare(`INSERT OR IGNORE INTO user_departments (user_id, organization_id, department_id)
            SELECT u.id, u.organization_id, ? FROM users u
            WHERE u.organization_id = ? AND u.active = 1 AND u.role IN ('manager','employee')
              AND NOT EXISTS (SELECT 1 FROM user_departments ud JOIN departments d ON d.id = ud.department_id
                WHERE ud.user_id = u.id AND ud.organization_id = u.organization_id AND d.active = 1)`)
            .run(departmentId, organization.id);
        }
        db.prepare("INSERT INTO department_scope_migrations (organization_id, initial_user_backfill_done) VALUES (?, 1)")
          .run(organization.id);
      }
    }
  });
  seed();
}

export function registerDepartmentScopeRoutes(app: Express, db: SqliteDb): void {
  app.get("/api/departments", (req, res) => {
    const organizationId = req.auth!.organizationId;
    const unrestricted = isUnrestricted(req.auth!);
    const rows = unrestricted
      ? db.prepare(`SELECT id, organization_id, name, active FROM departments WHERE organization_id = ? ORDER BY active DESC, name COLLATE NOCASE, id`).all(organizationId)
      : db.prepare(`SELECT d.id, d.organization_id, d.name, d.active FROM departments d
          JOIN user_departments ud ON ud.department_id = d.id AND ud.organization_id = d.organization_id AND ud.user_id = ?
          WHERE d.organization_id = ? AND d.active = 1 ORDER BY d.name COLLATE NOCASE, d.id`).all(req.auth!.userId, organizationId);
    res.json(rows);
  });

  app.post("/api/departments", (req, res, next) => {
    try {
      if (!isUnrestricted(req.auth!)) return res.status(403).json({ error: "Управлять подразделениями может владелец или администратор." });
      const name = parseDepartmentName(req.body?.name);
      const result = db.prepare("INSERT INTO departments (organization_id, name) VALUES (?, ?)")
        .run(req.auth!.organizationId, name);
      res.status(201).json(db.prepare("SELECT id, organization_id, name, active FROM departments WHERE id = ?").get(result.lastInsertRowid));
    } catch (error) { next(error); }
  });

  app.patch("/api/departments/:id", (req, res, next) => {
    try {
      if (!isUnrestricted(req.auth!)) return res.status(403).json({ error: "Управлять подразделениями может владелец или администратор." });
      const id = parseId(req.params.id);
      const existing = db.prepare("SELECT id, organization_id, name, active FROM departments WHERE id = ? AND organization_id = ?")
        .get(id, req.auth!.organizationId) as Department | undefined;
      if (!existing) return res.status(404).json({ error: "Подразделение не найдено." });
      const name = req.body?.name === undefined ? existing.name : parseDepartmentName(req.body.name);
      const active = req.body?.active === undefined ? existing.active : parseActive(req.body.active);
      db.transaction(() => {
        if (existing.active === 1 && active === 0) {
          const activeCount = Number((db.prepare("SELECT COUNT(*) AS count FROM departments WHERE organization_id = ? AND active = 1")
            .get(req.auth!.organizationId) as { count: number }).count);
          if (activeCount <= 1) throw new Error("Нельзя архивировать последнее активное подразделение.");
          const soleAssignedUser = db.prepare(`SELECT 1 FROM user_departments ud
            JOIN users u ON u.id = ud.user_id AND u.organization_id = ud.organization_id
            WHERE ud.organization_id = ? AND ud.department_id = ? AND u.active = 1 AND u.role IN ('manager','employee')
              AND NOT EXISTS (SELECT 1 FROM user_departments other
                JOIN departments active_department ON active_department.id = other.department_id AND active_department.organization_id = other.organization_id AND active_department.active = 1
                WHERE other.user_id = ud.user_id AND other.organization_id = ud.organization_id AND other.department_id <> ud.department_id)
            LIMIT 1`).get(req.auth!.organizationId, id);
          if (soleAssignedUser) throw new Error("Сначала назначьте сотрудников этого подразделения в другие активные подразделения.");
          db.prepare("DELETE FROM user_departments WHERE organization_id = ? AND department_id = ?").run(req.auth!.organizationId, id);
        }
        db.prepare("UPDATE departments SET name = ?, active = ? WHERE id = ? AND organization_id = ?")
          .run(name, active, id, req.auth!.organizationId);
      })();
      res.json(db.prepare("SELECT id, organization_id, name, active FROM departments WHERE id = ?").get(id));
    } catch (error) { next(error); }
  });
}

export function isUnrestricted(auth: AuthContext): boolean {
  return auth.role === "owner" || auth.role === "admin";
}

export function getAccessibleWarehouseIds(db: SqliteDb, auth: AuthContext): number[] | null {
  if (isUnrestricted(auth)) return null;
  return (db.prepare(`SELECT w.id FROM warehouses w
      JOIN departments d ON d.id = w.department_id AND d.organization_id = w.organization_id AND d.active = 1
      JOIN user_departments ud ON ud.department_id = d.id AND ud.organization_id = d.organization_id AND ud.user_id = ?
      WHERE w.organization_id = ? ORDER BY w.id`)
    .all(auth.userId, auth.organizationId) as Array<{ id: number }>).map((row) => Number(row.id));
}

export function getAccessibleActiveWarehouseIds(db: SqliteDb, auth: AuthContext): number[] | null {
  if (isUnrestricted(auth)) return null;
  return (db.prepare(`SELECT w.id FROM warehouses w
      JOIN departments d ON d.id = w.department_id AND d.organization_id = w.organization_id AND d.active = 1
      JOIN user_departments ud ON ud.department_id = d.id AND ud.organization_id = d.organization_id AND ud.user_id = ?
      WHERE w.organization_id = ? AND w.active = 1 ORDER BY w.id`)
    .all(auth.userId, auth.organizationId) as Array<{ id: number }>).map((row) => Number(row.id));
}

export function canAccessWarehouse(db: SqliteDb, auth: AuthContext, warehouseId: number | null | undefined): boolean {
  if (isUnrestricted(auth)) return true;
  if (!Number.isSafeInteger(warehouseId) || Number(warehouseId) <= 0) return false;
  return Boolean(db.prepare(`SELECT 1 FROM warehouses w
    JOIN departments d ON d.id = w.department_id AND d.organization_id = w.organization_id AND d.active = 1
    JOIN user_departments ud ON ud.department_id = d.id AND ud.organization_id = d.organization_id AND ud.user_id = ?
    WHERE w.id = ? AND w.organization_id = ? LIMIT 1`)
    .get(auth.userId, warehouseId, auth.organizationId));
}

export function canAccessDepartment(db: SqliteDb, auth: AuthContext, departmentId: number | null | undefined): boolean {
  if (isUnrestricted(auth)) return true;
  if (!Number.isSafeInteger(departmentId) || Number(departmentId) <= 0) return false;
  return Boolean(db.prepare(`SELECT 1 FROM departments d JOIN user_departments ud
    ON ud.department_id = d.id AND ud.organization_id = d.organization_id AND ud.user_id = ?
    WHERE d.id = ? AND d.organization_id = ? AND d.active = 1 LIMIT 1`)
    .get(auth.userId, departmentId, auth.organizationId));
}

export function canAccessDocument(db: SqliteDb, auth: AuthContext, documentId: number): boolean {
  if (isUnrestricted(auth)) return true;
  const document = db.prepare("SELECT warehouse_id, destination_warehouse_id FROM documents WHERE id = ? AND organization_id = ?")
    .get(documentId, auth.organizationId) as { warehouse_id: number | null; destination_warehouse_id: number | null } | undefined;
  if (!document || document.warehouse_id == null || !canAccessWarehouse(db, auth, Number(document.warehouse_id))) return false;
  return document.destination_warehouse_id == null || canAccessWarehouse(db, auth, Number(document.destination_warehouse_id));
}

export function scopedWarehouseFilter(db: SqliteDb, auth: AuthContext, alias: string): { sql: string; params: number[] } {
  const ids = getAccessibleWarehouseIds(db, auth);
  if (ids === null) return { sql: "", params: [] };
  if (!ids.length) return { sql: " AND 1 = 0", params: [] };
  return { sql: ` AND ${alias}.id IN (${ids.map(() => "?").join(",")})`, params: ids };
}

export function scopedDocumentFilter(db: SqliteDb, auth: AuthContext, alias: string): { sql: string; params: number[] } {
  const ids = getAccessibleWarehouseIds(db, auth);
  if (ids === null) return { sql: "", params: [] };
  if (!ids.length) return { sql: " AND 1 = 0", params: [] };
  const marks = ids.map(() => "?").join(",");
  return {
    sql: ` AND ${alias}.warehouse_id IN (${marks}) AND (${alias}.destination_warehouse_id IS NULL OR ${alias}.destination_warehouse_id IN (${marks}))`,
    params: [...ids, ...ids],
  };
}

export function scopedDocumentFilterLiteral(db: SqliteDb, auth: AuthContext, alias: string): string {
  const ids = getAccessibleWarehouseIds(db, auth);
  if (ids === null) return "";
  if (!ids.length) return " AND 1 = 0";
  const values = ids.join(",");
  return ` AND ${alias}.warehouse_id IN (${values}) AND (${alias}.destination_warehouse_id IS NULL OR ${alias}.destination_warehouse_id IN (${values}))`;
}

export function assertRequestWarehouseAccess(db: SqliteDb, req: Request, warehouseId: number | null | undefined): void {
  if (!req.auth) return;
  if (!canAccessWarehouse(db, req.auth, warehouseId)) throw new Error("Нет доступа к складу этого подразделения.");
  const active = db.prepare("SELECT active FROM warehouses WHERE id = ? AND organization_id = ?")
    .get(warehouseId, req.auth.organizationId) as { active: number } | undefined;
  if (!active || active.active !== 1) throw new Error("Нельзя создавать или изменять документы на архивном складе. Сначала восстановите склад.");
}

export function assertRequestDocumentAccess(db: SqliteDb, req: Request, documentId: number): boolean {
  return !req.auth || canAccessDocument(db, req.auth, documentId);
}

function parseDepartmentName(value: unknown): string {
  const name = String(value ?? "").trim();
  if (!name || name.length > 120) throw new Error("Укажите название подразделения длиной до 120 символов.");
  return name;
}

function parseActive(value: unknown): number {
  if (value === true || value === 1 || value === "1") return 1;
  if (value === false || value === 0 || value === "0") return 0;
  throw new Error("Проверьте статус подразделения.");
}

function parseId(value: unknown): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Проверьте номер подразделения.");
  return id;
}
