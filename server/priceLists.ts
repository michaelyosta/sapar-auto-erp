import type Database from "better-sqlite3";
import type { Express } from "express";

type SqliteDb = Database.Database;
type ColumnInput = { id?: unknown; name?: unknown; applyAdjustment?: unknown; adjustmentPercent?: unknown };
type ItemInput = { productId?: unknown; prices?: unknown };
type PriceListInput = {
  name?: unknown;
  priceType?: unknown;
  active?: unknown;
  columns?: unknown;
  items?: unknown;
};

const ORGANIZATION_ID = 1;
const BUILTIN_PRICE_TYPES = ["Закупочные", "Цена продажи"];

export function initializePriceListSchema(db: SqliteDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS price_lists (
      id INTEGER PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      name TEXT NOT NULL,
      price_type TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_price_lists_org_active_name
      ON price_lists (organization_id, active, name COLLATE NOCASE);

    CREATE TABLE IF NOT EXISTS price_list_columns (
      id INTEGER PRIMARY KEY,
      price_list_id INTEGER NOT NULL REFERENCES price_lists(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      position INTEGER NOT NULL,
      apply_adjustment INTEGER NOT NULL DEFAULT 0 CHECK (apply_adjustment IN (0, 1)),
      adjustment_percent_bps INTEGER NOT NULL DEFAULT 0,
      UNIQUE (price_list_id, position)
    );

    CREATE TABLE IF NOT EXISTS price_list_positions (
      id INTEGER PRIMARY KEY,
      price_list_id INTEGER NOT NULL REFERENCES price_lists(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      position INTEGER NOT NULL,
      UNIQUE (price_list_id, product_id),
      UNIQUE (price_list_id, position)
    );
    CREATE INDEX IF NOT EXISTS idx_price_list_positions_list
      ON price_list_positions (price_list_id, position);

    CREATE TABLE IF NOT EXISTS price_list_position_prices (
      position_id INTEGER NOT NULL REFERENCES price_list_positions(id) ON DELETE CASCADE,
      column_id INTEGER NOT NULL REFERENCES price_list_columns(id) ON DELETE CASCADE,
      price_tiyin INTEGER,
      PRIMARY KEY (position_id, column_id)
    );
  `);
}

export function registerPriceListRoutes(app: Express, db: SqliteDb, recordAudit: (entityType: string, entityId: number, action: string, detail?: string) => void): void {
  app.get("/api/price-lists/metadata", (_req, res) => {
    const priceTypes = new Set(BUILTIN_PRICE_TYPES);
    for (const row of db.prepare(`SELECT DISTINCT prices.name FROM product_prices prices
      JOIN products p ON p.id = prices.product_id
      WHERE p.organization_id = ? AND TRIM(prices.name) <> '' ORDER BY prices.name COLLATE NOCASE`).all(ORGANIZATION_ID) as Array<{ name: string }>) {
      priceTypes.add(row.name);
    }
    const groupRows = db.prepare(`SELECT id, parent_id, name FROM product_groups
      WHERE organization_id = ? ORDER BY name COLLATE NOCASE, id`).all(ORGANIZATION_ID) as ProductGroupRow[];
    const paths = getProductGroupPaths(groupRows);
    const groups = groupRows.map((group) => ({ id: group.id, path: paths.get(group.id) ?? group.name }));
    res.json({ price_types: [...priceTypes], groups });
  });

  app.get("/api/price-lists", (req, res) => {
    const query = String(req.query.q ?? "").trim();
    const includeArchived = req.query.archived === "true" || req.query.archived === "1";
    const rows = db.prepare(`SELECT pl.id, pl.name, pl.price_type, pl.active, pl.created_at, pl.updated_at,
        COUNT(DISTINCT pp.id) AS position_count
      FROM price_lists pl
      LEFT JOIN price_list_positions pp ON pp.price_list_id = pl.id
      WHERE pl.organization_id = ? AND (? = 1 OR pl.active = 1)
        AND (? = '' OR pl.name LIKE '%' || ? || '%' OR pl.price_type LIKE '%' || ? || '%'
          OR EXISTS (
            SELECT 1 FROM price_list_positions search_pos
            JOIN products search_product ON search_product.id = search_pos.product_id
            WHERE search_pos.price_list_id = pl.id
              AND (search_product.name LIKE '%' || ? || '%' OR search_product.code LIKE '%' || ? || '%')
          ))
      GROUP BY pl.id ORDER BY pl.updated_at DESC, pl.name COLLATE NOCASE`).all(
      ORGANIZATION_ID, includeArchived ? 1 : 0, query, query, query, query, query,
    );
    res.json(rows);
  });

  app.post("/api/price-lists", (req, res, next) => {
    try {
      const input = req.body as PriceListInput;
      const name = requiredText(input.name, "Название прайс-листа", 200);
      const priceType = requiredText(input.priceType, "Тип цен", 120);
      const columns = normalizeColumns(input.columns);
      const items = normalizeItems(input.items, columns.length);
      const create = db.transaction(() => {
        const result = db.prepare(`INSERT INTO price_lists (organization_id, name, price_type)
          VALUES (?, ?, ?)`).run(ORGANIZATION_ID, name, priceType);
        const listId = Number(result.lastInsertRowid);
        const columnIds = insertColumns(db, listId, columns);
        if (input.items !== undefined) replacePositions(db, listId, items, columnIds);
        recordAudit("price_list", listId, "create", name);
        return getPriceList(db, listId);
      });
      res.status(201).json(create());
    } catch (error) { next(error); }
  });

  app.get("/api/price-lists/:id", (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Проверьте номер прайс-листа." });
    const list = getPriceList(db, id);
    if (!list) return res.status(404).json({ error: "Прайс-лист не найден." });
    res.json(list);
  });

  app.patch("/api/price-lists/:id", (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      if (!id) return res.status(400).json({ error: "Проверьте номер прайс-листа." });
      const existing = db.prepare("SELECT id, name, price_type, active FROM price_lists WHERE id = ? AND organization_id = ?")
        .get(id, ORGANIZATION_ID) as { id: number; name: string; price_type: string; active: number } | undefined;
      if (!existing) return res.status(404).json({ error: "Прайс-лист не найден." });

      const input = req.body as PriceListInput;
      const name = input.name === undefined ? existing.name : requiredText(input.name, "Название прайс-листа", 200);
      const priceType = input.priceType === undefined ? existing.price_type : requiredText(input.priceType, "Тип цен", 120);
      const active = input.active === undefined ? existing.active : parseActive(input.active);
      const update = db.transaction(() => {
        db.prepare(`UPDATE price_lists SET name = ?, price_type = ?, active = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND organization_id = ?`).run(name, priceType, active, id, ORGANIZATION_ID);

        let columnIds = getColumns(db, id).map((column) => column.id);
        if (input.columns !== undefined) {
          const columns = normalizeColumns(input.columns);
          columnIds = replaceColumns(db, id, columns);
        }
        if (input.items !== undefined) {
          const items = normalizeItems(input.items, columnIds.length);
          replacePositions(db, id, items, columnIds);
        }
        const action = existing.active === active ? "update" : active ? "restore" : "archive";
        recordAudit("price_list", id, action, name);
        return getPriceList(db, id);
      });
      const result = update();
      if (!result) return res.status(404).json({ error: "Прайс-лист не найден." });
      res.json(result);
    } catch (error) { next(error); }
  });

  app.post("/api/price-lists/:id/fill", (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      if (!id) return res.status(400).json({ error: "Проверьте номер прайс-листа." });
      const list = db.prepare("SELECT id, price_type FROM price_lists WHERE id = ? AND organization_id = ?")
        .get(id, ORGANIZATION_ID) as { id: number; price_type: string } | undefined;
      if (!list) return res.status(404).json({ error: "Прайс-лист не найден." });

      const source = String(req.body?.source ?? "");
      const groupId = req.body?.groupId == null || req.body.groupId === "" ? null : parseId(req.body.groupId);
      const groupName = String(req.body?.groupName ?? "").trim();
      if (!(["catalog", "stock", "group"] as string[]).includes(source)) {
        return res.status(400).json({ error: "Выберите способ дополнения прайс-листа." });
      }
      if (source === "group" && !groupId && !groupName) return res.status(400).json({ error: "Выберите группу номенклатуры." });
      if (source === "group" && req.body?.groupId != null && req.body.groupId !== "" && !groupId) {
        return res.status(400).json({ error: "Проверьте выбранную группу номенклатуры." });
      }

      const fill = db.transaction(() => {
        let candidates: ProductCandidate[];
        if (source === "stock") {
          candidates = db.prepare(`SELECT p.id, p.code, p.article, p.name, p.kind, p.unit, p.group_name, p.active,
              p.purchase_price_tiyin, p.sale_price_tiyin
            FROM products p
            JOIN (
              SELECT sm.product_id, SUM(sm.quantity_units) AS quantity_units
              FROM stock_movements sm JOIN warehouses w ON w.id = sm.warehouse_id
              WHERE sm.organization_id = ? AND w.organization_id = ? AND w.active = 1
              GROUP BY sm.product_id HAVING SUM(sm.quantity_units) > 0
            ) stock ON stock.product_id = p.id
            WHERE p.organization_id = ? AND p.active = 1 AND p.kind = 'product'
            ORDER BY p.name COLLATE NOCASE`).all(ORGANIZATION_ID, ORGANIZATION_ID, ORGANIZATION_ID) as ProductCandidate[];
        } else if (source === "group") {
          if (groupId) {
            candidates = getProductsInGroup(db, groupId, ORGANIZATION_ID);
          } else {
            candidates = db.prepare(`SELECT id, code, article, name, kind, unit, group_name, active, purchase_price_tiyin, sale_price_tiyin
              FROM products WHERE organization_id = ? AND active = 1 AND group_name = ? COLLATE NOCASE
              ORDER BY name COLLATE NOCASE`).all(ORGANIZATION_ID, groupName) as ProductCandidate[];
          }
        } else {
          candidates = db.prepare(`SELECT id, code, article, name, kind, unit, group_name, active, purchase_price_tiyin, sale_price_tiyin
            FROM products WHERE organization_id = ? AND active = 1
            ORDER BY name COLLATE NOCASE`).all(ORGANIZATION_ID) as ProductCandidate[];
        }
        const columns = getColumns(db, id);
        const existingIds = new Set((db.prepare("SELECT product_id FROM price_list_positions WHERE price_list_id = ?")
          .all(id) as Array<{ product_id: number }>).map((row) => row.product_id));
        const insertPosition = db.prepare("INSERT INTO price_list_positions (price_list_id, product_id, position) VALUES (?, ?, ?)");
        const insertPrice = db.prepare(`INSERT INTO price_list_position_prices (position_id, column_id, price_tiyin)
          VALUES (?, ?, ?)`);
        let nextPosition = Number((db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS position FROM price_list_positions WHERE price_list_id = ?")
          .get(id) as { position: number }).position);
        let added = 0;
        let skipped = 0;
        for (const product of candidates) {
          if (existingIds.has(product.id)) { skipped += 1; continue; }
          const position = Number(insertPosition.run(id, product.id, nextPosition++).lastInsertRowid);
          for (const column of columns) {
            const base = column.apply_adjustment ? getProductPrice(db, product.id, list.price_type) : null;
            const price = base == null ? null : applyAdjustment(base, column.adjustment_percent_bps);
            insertPrice.run(position, column.id, price);
          }
          added += 1;
        }
        db.prepare("UPDATE price_lists SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
        recordAudit("price_list", id, "fill", `${source}; добавлено ${added}, пропущено ${skipped}`);
        return { added, skipped, list: getPriceList(db, id) };
      });
      res.json(fill());
    } catch (error) { next(error); }
  });

  app.post("/api/price-lists/preview-fill", (req, res, next) => {
    try {
      const source = String(req.body?.source ?? "");
      const groupId = req.body?.groupId == null || req.body.groupId === "" ? null : parseId(req.body.groupId);
      const groupName = String(req.body?.groupName ?? "").trim();
      const priceType = requiredText(req.body?.priceType, "Тип цен", 120);
      if (!( ["catalog", "stock", "group"] as string[]).includes(source)) throw new Error("Выберите способ дополнения прайс-листа.");
      if (source === "group" && !groupId && !groupName) throw new Error("Выберите группу номенклатуры.");
      if (source === "group" && req.body?.groupId != null && req.body.groupId !== "" && !groupId) {
        throw new Error("Проверьте выбранную группу номенклатуры.");
      }
      const columns = normalizeColumns(req.body?.columns);
      const excludedIds = new Set<number>();
      if (req.body?.excludeProductIds !== undefined) {
        if (!Array.isArray(req.body.excludeProductIds)) throw new Error("Проверьте исключаемые позиции прайс-листа.");
        for (const value of req.body.excludeProductIds) {
          const id = parseId(value);
          if (!id) throw new Error("Проверьте исключаемые позиции прайс-листа.");
          excludedIds.add(id);
        }
      }
      let includedIds: Set<number> | null = null;
      if (req.body?.productIds !== undefined) {
        if (!Array.isArray(req.body.productIds) || req.body.productIds.length === 0) throw new Error("Выберите хотя бы одну позицию.");
        includedIds = new Set<number>();
        for (const value of req.body.productIds) {
          const id = parseId(value);
          if (!id || includedIds.has(id)) throw new Error("Проверьте выбранные позиции.");
          includedIds.add(id);
        }
      }
      let candidates: ProductCandidate[];
      if (source === "stock") {
        candidates = db.prepare(`SELECT p.id, p.code, p.article, p.name, p.kind, p.unit, p.group_name, p.active,
            p.purchase_price_tiyin, p.sale_price_tiyin
          FROM products p JOIN (
            SELECT sm.product_id, SUM(sm.quantity_units) AS quantity_units
            FROM stock_movements sm JOIN warehouses w ON w.id = sm.warehouse_id
            WHERE sm.organization_id = ? AND w.organization_id = ? AND w.active = 1
            GROUP BY sm.product_id HAVING SUM(sm.quantity_units) > 0
          ) stock ON stock.product_id = p.id
          WHERE p.organization_id = ? AND p.active = 1 AND p.kind = 'product'
          ORDER BY p.name COLLATE NOCASE`).all(ORGANIZATION_ID, ORGANIZATION_ID, ORGANIZATION_ID) as ProductCandidate[];
      } else if (source === "group") {
        if (groupId) {
          candidates = getProductsInGroup(db, groupId, ORGANIZATION_ID);
        } else {
          candidates = db.prepare(`SELECT id, code, article, name, kind, unit, group_name, active, purchase_price_tiyin, sale_price_tiyin
            FROM products WHERE organization_id = ? AND active = 1 AND group_name = ? COLLATE NOCASE
            ORDER BY name COLLATE NOCASE`).all(ORGANIZATION_ID, groupName) as ProductCandidate[];
        }
      } else {
        candidates = db.prepare(`SELECT id, code, article, name, kind, unit, group_name, active, purchase_price_tiyin, sale_price_tiyin
          FROM products WHERE organization_id = ? AND active = 1
          ORDER BY name COLLATE NOCASE`).all(ORGANIZATION_ID) as ProductCandidate[];
      }
      candidates = candidates.filter((product) => !excludedIds.has(product.id) && (includedIds == null || includedIds.has(product.id)));
      if (includedIds && candidates.length !== includedIds.size) throw new Error("Одна из выбранных позиций недоступна для этого способа заполнения.");
      const items = candidates.map((product) => ({
        product_id: product.id,
        code: product.code,
        article: product.article,
        name: product.name,
        kind: product.kind,
        unit: product.unit,
        group_name: product.group_name,
        active: product.active,
        prices: columns.map((column) => {
          const base = column.apply_adjustment ? getProductPrice(db, product.id, priceType) : null;
          return base == null ? null : applyAdjustment(base, column.adjustment_percent_bps);
        }),
      }));
      res.json({ items });
    } catch (error) { next(error); }
  });
}

type NormalizedColumn = { id?: number; name: string; apply_adjustment: number; adjustment_percent_bps: number };
type ProductCandidate = {
  id: number; code: string; article: string; name: string; kind: string; unit: string; group_name: string; active: number;
  purchase_price_tiyin: number; sale_price_tiyin: number;
};
type PriceListColumn = NormalizedColumn & { id: number; position: number };
type ProductGroupRow = { id: number; parent_id: number | null; name: string };

function getProductGroupPaths(groups: ProductGroupRow[]): Map<number, string> {
  const byId = new Map(groups.map((group) => [group.id, group]));
  const paths = new Map<number, string>();
  const pathFor = (id: number, visiting = new Set<number>()): string => {
    const cached = paths.get(id);
    if (cached) return cached;
    const group = byId.get(id);
    if (!group || visiting.has(id)) return group?.name ?? "";
    visiting.add(id);
    const parentPath = group.parent_id == null ? "" : pathFor(group.parent_id, visiting);
    visiting.delete(id);
    const path = parentPath ? `${parentPath} / ${group.name}` : group.name;
    paths.set(id, path);
    return path;
  };
  for (const group of groups) pathFor(group.id);
  return paths;
}

function getProductsInGroup(db: SqliteDb, groupId: number, organizationId: number): ProductCandidate[] {
  const exists = db.prepare("SELECT 1 AS found FROM product_groups WHERE id = ? AND organization_id = ?")
    .get(groupId, organizationId);
  if (!exists) throw new Error("Выбранная группа номенклатуры не найдена.");
  return db.prepare(`WITH RECURSIVE descendants(id) AS (
      SELECT id FROM product_groups WHERE id = ? AND organization_id = ?
      UNION ALL
      SELECT child.id FROM product_groups child JOIN descendants parent ON child.parent_id = parent.id
        WHERE child.organization_id = ?
    )
    SELECT p.id, p.code, p.article, p.name, p.kind, p.unit, p.group_name, p.active,
      p.purchase_price_tiyin, p.sale_price_tiyin
    FROM products p WHERE p.organization_id = ? AND p.active = 1 AND p.group_id IN (SELECT id FROM descendants)
    ORDER BY p.name COLLATE NOCASE`).all(groupId, organizationId, organizationId, organizationId) as ProductCandidate[];
}

function requiredText(value: unknown, label: string, maxLength: number): string {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`Заполните поле «${label}».`);
  if (text.length > maxLength) throw new Error(`Поле «${label}» не должно быть длиннее ${maxLength} символов.`);
  return text;
}

function parseId(value: unknown): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function parseActive(value: unknown): number {
  if (value === true || value === 1 || value === "1") return 1;
  if (value === false || value === 0 || value === "0") return 0;
  throw new Error("Проверьте статус прайс-листа.");
}

function normalizeColumns(value: unknown): NormalizedColumn[] {
  if (value === undefined) return [{ name: "Колонка 1", apply_adjustment: 0, adjustment_percent_bps: 0 }];
  if (!Array.isArray(value) || value.length === 0) throw new Error("Добавьте хотя бы одну колонку прайс-листа.");
  const seenIds = new Set<number>();
  return value.map((raw, position) => {
    const column = raw as ColumnInput;
    const name = requiredText(column.name, `Название колонки ${position + 1}`, 100);
    const apply_adjustment = parseBoolean(column.applyAdjustment, "Расчёт скидки или наценки");
    const adjustment_percent_bps = parseAdjustmentPercent(column.adjustmentPercent ?? 0);
    const id = column.id == null || column.id === "" ? undefined : parseId(column.id);
    if (column.id != null && column.id !== "" && !id) throw new Error("Проверьте колонку прайс-листа.");
    if (id && seenIds.has(id)) throw new Error("Колонка прайс-листа указана несколько раз.");
    if (id) seenIds.add(id);
    return { ...(id ? { id } : {}), name, apply_adjustment, adjustment_percent_bps };
  });
}

function parseBoolean(value: unknown, label: string): number {
  if (value === true || value === 1 || value === "1") return 1;
  if (value === false || value === 0 || value === "0" || value == null) return 0;
  throw new Error(`Проверьте поле «${label}».`);
}

function parseAdjustmentPercent(value: unknown): number {
  let text = String(value ?? "0").trim().replace(",", ".");
  if (text.length > 32) throw new Error("Проверьте процент скидки или наценки.");
  const scientific = /^([+-]?)(\d+)(?:\.(\d*))?[eE]([+-]?\d+)$/.exec(text);
  if (scientific) {
    const exponent = Number(scientific[4]);
    const digits = scientific[2] + (scientific[3] ?? "");
    if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 32) {
      throw new Error("Проверьте процент скидки или наценки.");
    }
    if (/^0+$/.test(digits)) {
      text = "0";
    } else {
      const decimalPosition = scientific[2].length + exponent;
      if (decimalPosition <= 0) text = `${scientific[1]}0.${"0".repeat(-decimalPosition)}${digits}`;
      else if (decimalPosition >= digits.length) text = `${scientific[1]}${digits}${"0".repeat(decimalPosition - digits.length)}`;
      else text = `${scientific[1]}${digits.slice(0, decimalPosition)}.${digits.slice(decimalPosition)}`;
    }
    if (text.length > 32) throw new Error("Проверьте процент скидки или наценки.");
  }
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) throw new Error("Проверьте процент скидки или наценки.");
  const negative = match[1] === "-";
  const whole = BigInt(match[2]);
  const fraction = match[3] ?? "";
  const hasFraction = /[1-9]/.test(fraction);
  if (whole > 1_000_000n || (whole === 1_000_000n && hasFraction)) {
    throw new Error("Проверьте процент скидки или наценки.");
  }
  if (negative && (whole > 100n || (whole === 100n && hasFraction))) {
    throw new Error("Скидка не может превышать 100%.");
  }
  let basisPoints = whole * 100n + BigInt((fraction + "00").slice(0, 2));
  if (fraction[2] != null && fraction[2] >= "5") basisPoints += 1n;
  if (negative) basisPoints = -basisPoints;
  return Number(basisPoints);
}

function normalizeItems(value: unknown, columnCount: number): Array<{ productId: number; prices: Array<number | null> }> {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("Проверьте позиции прайс-листа.");
  const seen = new Set<number>();
  return value.map((raw) => {
    const item = raw as ItemInput;
    const productId = parseId(item.productId);
    if (!productId) throw new Error("Проверьте товар в прайс-листе.");
    if (seen.has(productId)) throw new Error("Один товар не может повторяться в прайс-листе.");
    seen.add(productId);
    if (item.prices !== undefined && !Array.isArray(item.prices)) throw new Error("Проверьте цены позиции прайс-листа.");
    const prices = item.prices === undefined ? [] : item.prices as unknown[];
    if (prices.length > columnCount) throw new Error("Для позиции указано больше цен, чем колонок.");
    return { productId, prices: Array.from({ length: columnCount }, (_, index) => parseOptionalPrice(prices[index])) };
  });
}

function parseOptionalPrice(value: unknown): number | null {
  if (value == null || String(value).trim() === "") return null;
  const input = String(value).trim().replace(/\s/g, "").replace(",", ".");
  const match = /^(\d+)(?:\.(\d+))?$/.exec(input);
  if (!match) throw new Error("Проверьте цену в прайс-листе.");
  const wholeText = match[1].replace(/^0+(?=\d)/, "");
  if (wholeText.length > 13) throw new Error("Проверьте цену в прайс-листе.");
  const fraction = match[2] ?? "";
  let tiyin = BigInt(wholeText) * 100n + BigInt((fraction + "00").slice(0, 2));
  if (fraction[2] != null && fraction[2] >= "5") tiyin += 1n;
  if (tiyin > 900_000_000_000_000n) throw new Error("Проверьте цену в прайс-листе.");
  return Number(tiyin);
}

function insertColumns(db: SqliteDb, listId: number, columns: NormalizedColumn[]): number[] {
  const insert = db.prepare(`INSERT INTO price_list_columns
    (price_list_id, name, position, apply_adjustment, adjustment_percent_bps) VALUES (?, ?, ?, ?, ?)`);
  return columns.map((column, position) => Number(insert.run(
    listId, column.name, position, column.apply_adjustment, column.adjustment_percent_bps,
  ).lastInsertRowid));
}

function replaceColumns(db: SqliteDb, listId: number, columns: NormalizedColumn[]): number[] {
  const existing = new Set((db.prepare("SELECT id FROM price_list_columns WHERE price_list_id = ?")
    .all(listId) as Array<{ id: number }>).map((row) => row.id));
  db.prepare("UPDATE price_list_columns SET position = position + 1000000 WHERE price_list_id = ?").run(listId);
  const kept = new Set<number>();
  const ids = columns.map((column, position) => {
    if (column.id && existing.has(column.id)) {
      db.prepare(`UPDATE price_list_columns SET name = ?, position = ?, apply_adjustment = ?, adjustment_percent_bps = ?
        WHERE id = ? AND price_list_id = ?`).run(
        column.name, position, column.apply_adjustment, column.adjustment_percent_bps, column.id, listId,
      );
      kept.add(column.id);
      return column.id;
    }
    const inserted = Number(db.prepare(`INSERT INTO price_list_columns
      (price_list_id, name, position, apply_adjustment, adjustment_percent_bps) VALUES (?, ?, ?, ?, ?)`)
      .run(listId, column.name, position, column.apply_adjustment, column.adjustment_percent_bps).lastInsertRowid);
    kept.add(inserted);
    return inserted;
  });
  const removed = [...existing].filter((id) => !kept.has(id));
  if (removed.length) {
    const placeholders = removed.map(() => "?").join(",");
    db.prepare(`DELETE FROM price_list_columns WHERE price_list_id = ? AND id IN (${placeholders})`).run(listId, ...removed);
  }
  return ids;
}

function replacePositions(db: SqliteDb, listId: number, items: Array<{ productId: number; prices: Array<number | null> }>, columnIds: number[]): void {
  const productIds = items.map((item) => item.productId);
  if (productIds.length) {
    const placeholders = productIds.map(() => "?").join(",");
    const found = db.prepare(`SELECT id FROM products WHERE organization_id = ? AND id IN (${placeholders})`)
      .all(ORGANIZATION_ID, ...productIds) as Array<{ id: number }>;
    if (found.length !== productIds.length) throw new Error("Один из товаров прайс-листа не найден.");
  }
  db.prepare("DELETE FROM price_list_positions WHERE price_list_id = ?").run(listId);
  const insertPosition = db.prepare("INSERT INTO price_list_positions (price_list_id, product_id, position) VALUES (?, ?, ?)");
  const insertPrice = db.prepare(`INSERT INTO price_list_position_prices (position_id, column_id, price_tiyin)
    VALUES (?, ?, ?)`);
  items.forEach((item, position) => {
    const positionId = Number(insertPosition.run(listId, item.productId, position).lastInsertRowid);
    columnIds.forEach((columnId, index) => insertPrice.run(positionId, columnId, item.prices[index]));
  });
}

function getColumns(db: SqliteDb, listId: number): PriceListColumn[] {
  return db.prepare(`SELECT id, name, position, apply_adjustment, adjustment_percent_bps
    FROM price_list_columns WHERE price_list_id = ? ORDER BY position, id`).all(listId) as PriceListColumn[];
}

function getPriceList(db: SqliteDb, listId: number) {
  const header = db.prepare(`SELECT id, name, price_type, active, created_at, updated_at
    FROM price_lists WHERE id = ? AND organization_id = ?`).get(listId, ORGANIZATION_ID) as
    { id: number; name: string; price_type: string; active: number; created_at: string; updated_at: string } | undefined;
  if (!header) return null;
  const columns = getColumns(db, listId);
  const positions = db.prepare(`SELECT pp.id, pp.product_id, pp.position, p.code, p.article, p.name,
      p.kind, p.unit, p.group_name, p.active
    FROM price_list_positions pp JOIN products p ON p.id = pp.product_id
    WHERE pp.price_list_id = ? ORDER BY pp.position, pp.id`).all(listId) as Array<{
      id: number; product_id: number; position: number; code: string; article: string; name: string;
      kind: string; unit: string; group_name: string; active: number;
    }>;
  const prices = db.prepare(`SELECT ppp.position_id, ppp.column_id, ppp.price_tiyin
    FROM price_list_position_prices ppp JOIN price_list_positions pp ON pp.id = ppp.position_id
    WHERE pp.price_list_id = ?`).all(listId) as Array<{ position_id: number; column_id: number; price_tiyin: number | null }>;
  const priceMap = new Map<string, number | null>();
  for (const row of prices) priceMap.set(`${row.position_id}:${row.column_id}`, row.price_tiyin);
  return {
    ...header,
    position_count: positions.length,
    columns: columns.map((column) => ({
      id: column.id, name: column.name, position: column.position,
      apply_adjustment: column.apply_adjustment,
      adjustment_percent: column.adjustment_percent_bps / 100,
    })),
    items: positions.map((position) => ({
      ...position,
      prices: columns.map((column) => priceMap.get(`${position.id}:${column.id}`) ?? null),
    })),
  };
}

function getProductPrice(db: SqliteDb, productId: number, priceType: string): number | null {
  const normalized = priceType.normalize("NFKC").trim().toLocaleLowerCase("ru-RU");
  if (["закупочные", "закупочная цена", "закупка", "purchase"].includes(normalized)) {
    const row = db.prepare("SELECT purchase_price_tiyin AS price FROM products WHERE id = ? AND organization_id = ?")
      .get(productId, ORGANIZATION_ID) as { price: number } | undefined;
    return row?.price ?? null;
  }
  if (["цена продажи", "продажные", "sale"].includes(normalized)) {
    const row = db.prepare("SELECT sale_price_tiyin AS price FROM products WHERE id = ? AND organization_id = ?")
      .get(productId, ORGANIZATION_ID) as { price: number } | undefined;
    return row?.price ?? null;
  }
  const row = db.prepare(`SELECT price_tiyin AS price FROM product_prices
    WHERE product_id = ? AND name = ? COLLATE NOCASE LIMIT 1`).get(productId, priceType) as { price: number } | undefined;
  return row?.price ?? null;
}

function applyAdjustment(basePrice: number, adjustmentPercentBps: number): number {
  if (!Number.isSafeInteger(basePrice) || basePrice < 0) throw new Error("Не удалось рассчитать цену прайс-листа.");
  const numerator = BigInt(basePrice) * BigInt(10_000 + adjustmentPercentBps);
  const adjusted = (numerator + 5_000n) / 10_000n;
  const result = Number(adjusted);
  if (!Number.isSafeInteger(result)) throw new Error("Рассчитанная цена слишком велика.");
  return result;
}
