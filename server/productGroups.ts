import type { Express, Response, NextFunction } from "express";
import type Database from "better-sqlite3";

type Audit = (entityType: string, entityId: number, action: string, detail?: string, organizationId?: number) => void;

function requiredText(value: unknown, label: string, limit = 255): string {
  const text = String(value ?? "").trim();
  if (!text || text.length > limit) throw Object.assign(new Error(`Укажите «${label}» (до ${limit} символов).`), { status: 400 });
  return text;
}

function optionalText(value: unknown, label: string, limit = 2000): string {
  const text = String(value ?? "").trim();
  if (text.length > limit) throw Object.assign(new Error(`Поле «${label}» не должно превышать ${limit} символов.`), { status: 400 });
  return text;
}

function parseGroupId(value: unknown): number | null {
  if (value == null || value === "") return null;
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw Object.assign(new Error("Проверьте родительскую группу."), { status: 400 });
  return id;
}

function groupFields(body: Record<string, unknown>) {
  const name = requiredText(body.name, "Наименование группы");
  const parentId = parseGroupId(body.parentId ?? body.parent_id);
  const vatRate = optionalText(body.vatRate ?? body.vat_rate, "НДС", 16);
  if (vatRate && !/^\d{1,3}(?:[.,]\d{1,2})?%?$/.test(vatRate)) {
    throw Object.assign(new Error("Проверьте ставку НДС группы."), { status: 400 });
  }
  return {
    name,
    parent_id: parentId,
    description: optionalText(body.description, "Описание"),
    code: optionalText(body.code, "Код", 100),
    external_code: optionalText(body.externalCode ?? body.external_code, "Внешний код", 120),
    vat_rate: vatRate,
    tax_system: optionalText(body.taxSystem ?? body.tax_system, "Система налогообложения", 80),
  };
}

function ensureParent(db: Database.Database, organizationId: number, parentId: number | null, selfId?: number) {
  if (parentId == null) return;
  const parent = db.prepare("SELECT id FROM product_groups WHERE id = ? AND organization_id = ?").get(parentId, organizationId);
  if (!parent) throw Object.assign(new Error("Родительская группа не найдена."), { status: 400 });
  if (selfId != null) {
    const isDescendant = db.prepare(`WITH RECURSIVE descendants(id) AS (
        SELECT id FROM product_groups WHERE parent_id = ? AND organization_id = ?
        UNION ALL
        SELECT child.id FROM product_groups child JOIN descendants d ON child.parent_id = d.id
          WHERE child.organization_id = ?
      ) SELECT 1 AS found FROM descendants WHERE id = ? LIMIT 1`).get(selfId, organizationId, organizationId, parentId);
    if (parentId === selfId || isDescendant) throw Object.assign(new Error("Нельзя поместить группу внутрь неё самой или её дочерней группы."), { status: 400 });
  }
}

function syncProductGroupPaths(db: Database.Database, organizationId: number) {
  const groups = db.prepare("SELECT id, parent_id, name FROM product_groups WHERE organization_id = ?").all(organizationId) as Array<{ id: number; parent_id: number | null; name: string }>;
  const byId = new Map(groups.map((group) => [group.id, group]));
  const pathFor = (id: number, visited = new Set<number>()): string => {
    const group = byId.get(id);
    if (!group || visited.has(id)) return "";
    visited.add(id);
    const parentPath = group.parent_id == null ? "" : pathFor(group.parent_id, visited);
    return parentPath ? `${parentPath} / ${group.name}` : group.name;
  };
  const update = db.prepare("UPDATE products SET group_name = ? WHERE organization_id = ? AND group_id = ? AND group_name <> ?");
  for (const group of groups) {
    const groupPath = pathFor(group.id);
    update.run(groupPath, organizationId, group.id, groupPath);
  }
}

function handleError(error: unknown, res: Response, next: NextFunction) {
  const status = (error as { status?: number })?.status;
  if (status) return res.status(status).json({ error: (error as Error).message });
  const message = (error as Error)?.message ?? "Не удалось сохранить группу.";
  if (/UNIQUE constraint failed: index 'idx_product_groups_sibling_name'|UNIQUE constraint failed: product_groups\.organization_id, product_groups\.code/i.test(message)) {
    return res.status(409).json({ error: "Группа с таким названием или кодом уже существует в этом разделе." });
  }
  next(error);
}

export function initializeProductGroupsSchema(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS product_groups (
    id INTEGER PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id),
    parent_id INTEGER REFERENCES product_groups(id),
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    code TEXT NOT NULL DEFAULT '',
    external_code TEXT NOT NULL DEFAULT '',
    vat_rate TEXT NOT NULL DEFAULT '',
    tax_system TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_product_groups_parent ON product_groups(organization_id, parent_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_product_groups_sibling_name
    ON product_groups(organization_id, IFNULL(parent_id, 0), name COLLATE NOCASE);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_product_groups_code
    ON product_groups(organization_id, code COLLATE NOCASE) WHERE TRIM(code) <> '';`);

  const productColumns = db.pragma("table_info(products)") as Array<{ name: string }>;
  if (!productColumns.some((column) => column.name === "group_id")) {
    db.exec("ALTER TABLE products ADD COLUMN group_id INTEGER REFERENCES product_groups(id)");
  }
  db.exec(`INSERT OR IGNORE INTO product_groups (organization_id, name)
    SELECT DISTINCT organization_id, TRIM(group_name) FROM products
    WHERE group_id IS NULL AND TRIM(group_name) <> '';
    UPDATE products SET group_id = (
      SELECT pg.id FROM product_groups pg
      WHERE pg.organization_id = products.organization_id AND pg.parent_id IS NULL
        AND pg.name = TRIM(products.group_name) COLLATE NOCASE ORDER BY pg.id LIMIT 1
    ) WHERE group_id IS NULL AND TRIM(group_name) <> '';`);
  const organizations = db.prepare("SELECT id FROM organizations").all() as Array<{ id: number }>;
  for (const organization of organizations) syncProductGroupPaths(db, organization.id);
}

export function registerProductGroupRoutes(app: Express, db: Database.Database, recordAudit: Audit) {
  app.get("/api/product-groups", (req, res) => {
    const organizationId = req.auth!.organizationId;
    const rows = db.prepare(`SELECT g.*,
        (SELECT COUNT(*) FROM products p WHERE p.organization_id = g.organization_id AND p.group_id = g.id) AS product_count,
        (SELECT COUNT(*) FROM product_groups child WHERE child.organization_id = g.organization_id AND child.parent_id = g.id) AS child_count
      FROM product_groups g WHERE g.organization_id = ? ORDER BY g.name COLLATE NOCASE, g.id`).all(organizationId);
    res.json(rows);
  });

  app.post("/api/product-groups", (req, res, next) => {
    try {
      const organizationId = req.auth!.organizationId;
      const fields = groupFields(req.body as Record<string, unknown>);
      const create = db.transaction(() => {
        ensureParent(db, organizationId, fields.parent_id);
        const result = db.prepare(`INSERT INTO product_groups
          (organization_id, parent_id, name, description, code, external_code, vat_rate, tax_system)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(organizationId, fields.parent_id, fields.name,
          fields.description, fields.code, fields.external_code, fields.vat_rate, fields.tax_system);
        const id = Number(result.lastInsertRowid);
        recordAudit("product_group", id, "create", fields.name, organizationId);
        return id;
      });
      const id = create();
      res.status(201).json(db.prepare("SELECT * FROM product_groups WHERE id = ? AND organization_id = ?").get(id, organizationId));
    } catch (error) { handleError(error, res, next); }
  });

  app.patch("/api/product-groups/:id", (req, res, next) => {
    try {
      const organizationId = req.auth!.organizationId;
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: "Проверьте номер группы." });
      const fields = groupFields(req.body as Record<string, unknown>);
      const update = db.transaction(() => {
        const existing = db.prepare("SELECT id FROM product_groups WHERE id = ? AND organization_id = ?").get(id, organizationId);
        if (!existing) return false;
        ensureParent(db, organizationId, fields.parent_id, id);
        db.prepare(`UPDATE product_groups SET parent_id = ?, name = ?, description = ?, code = ?,
          external_code = ?, vat_rate = ?, tax_system = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND organization_id = ?`).run(fields.parent_id, fields.name, fields.description,
          fields.code, fields.external_code, fields.vat_rate, fields.tax_system, id, organizationId);
        syncProductGroupPaths(db, organizationId);
        recordAudit("product_group", id, "update", fields.name, organizationId);
        return true;
      });
      if (!update()) return res.status(404).json({ error: "Группа не найдена." });
      res.json(db.prepare("SELECT * FROM product_groups WHERE id = ? AND organization_id = ?").get(id, organizationId));
    } catch (error) { handleError(error, res, next); }
  });

  app.delete("/api/product-groups/:id", (req, res, next) => {
    try {
      const organizationId = req.auth!.organizationId;
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: "Проверьте номер группы." });
      const remove = db.transaction(() => {
        const group = db.prepare(`SELECT g.id, g.name,
            (SELECT COUNT(*) FROM product_groups child WHERE child.parent_id = g.id AND child.organization_id = g.organization_id) AS children,
            (SELECT COUNT(*) FROM products p WHERE p.group_id = g.id AND p.organization_id = g.organization_id) AS products
          FROM product_groups g WHERE g.id = ? AND g.organization_id = ?`).get(id, organizationId) as { id: number; name: string; children: number; products: number } | undefined;
        if (!group) return "missing";
        if (group.children || group.products) return "used";
        db.prepare("DELETE FROM product_groups WHERE id = ? AND organization_id = ?").run(id, organizationId);
        recordAudit("product_group", id, "delete", group.name, organizationId);
        return "deleted";
      });
      const result = remove();
      if (result === "missing") return res.status(404).json({ error: "Группа не найдена." });
      if (result === "used") return res.status(409).json({ error: "Нельзя удалить группу, пока в ней есть товары или вложенные группы." });
      res.status(204).end();
    } catch (error) { handleError(error, res, next); }
  });
}
