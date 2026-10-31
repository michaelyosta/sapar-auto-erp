import type Database from "better-sqlite3";
import type { Express, Request, Response } from "express";

type SqliteDb = Database.Database;

export function registerProcurementRoutes(
  app: Express,
  db: SqliteDb,
  recordAudit: (entityType: string, entityId: number, action: string, detail?: string, orgId?: number) => void
): void {
  // 1. Calculate procurement needs & shortage
  app.get("/api/procurement/plan", (req: Request, res: Response) => {
    const orgId = req.auth?.organizationId ?? 1;
    const warehouseId = req.query.warehouseId ? Number(req.query.warehouseId) : null;
    const onlyShortage = req.query.onlyShortage === "true";

    const products = db.prepare(`
      SELECT p.id, p.code, p.name, p.unit, p.min_stock_units, p.purchase_price_tiyin,
        p.supplier_id, c.name AS supplier_name,
        COALESCE(s.stock_units, 0) AS stock_units,
        COALESCE(r.reserved_units, 0) AS reserved_units
      FROM products p
      LEFT JOIN counterparties c ON c.id = p.supplier_id
      LEFT JOIN (
        SELECT product_id, SUM(quantity_units) AS stock_units
        FROM stock_movements
        ${warehouseId ? "WHERE warehouse_id = " + warehouseId : ""}
        GROUP BY product_id
      ) s ON s.product_id = p.id
      LEFT JOIN (
        SELECT product_id, SUM(quantity_units) AS reserved_units
        FROM stock_reservations
        ${warehouseId ? "WHERE warehouse_id = " + warehouseId : ""}
        GROUP BY product_id
      ) r ON r.product_id = p.id
      WHERE p.organization_id = ? AND p.active = 1 AND p.kind = 'product'
      ORDER BY p.name ASC
    `).all(orgId) as Array<Record<string, unknown>>;

    const items = products.map((p) => {
      const stock = Number(p.stock_units);
      const reserved = Number(p.reserved_units);
      const minStock = Number(p.min_stock_units);
      const available = stock - reserved;

      let shortageUnits = 0;
      if (minStock > 0 && available < minStock) {
        shortageUnits = minStock - available;
      } else if (available < 0) {
        shortageUnits = Math.abs(available);
      }

      const purchasePrice = Number(p.purchase_price_tiyin);
      const estimatedCostTiyin = Math.round((shortageUnits * purchasePrice) / 1000000);

      return {
        id: p.id,
        code: p.code,
        name: p.name,
        unit: p.unit,
        stock_units: stock,
        reserved_units: reserved,
        available_units: available,
        min_stock_units: minStock,
        shortage_units: shortageUnits,
        recommended_order_units: shortageUnits > 0 ? shortageUnits : 0,
        purchase_price_tiyin: purchasePrice,
        estimated_cost_tiyin: estimatedCostTiyin,
        supplier_id: p.supplier_id,
        supplier_name: p.supplier_name || "Не указан",
      };
    });

    const filtered = onlyShortage ? items.filter((it) => it.shortage_units > 0) : items;

    const totalEstimatedCostTiyin = filtered.reduce((acc, it) => acc + it.estimated_cost_tiyin, 0);
    const shortageCount = items.filter((it) => it.shortage_units > 0).length;

    res.json({
      items: filtered,
      shortage_count: shortageCount,
      total_items: items.length,
      total_estimated_cost_tiyin: totalEstimatedCostTiyin,
    });
  });

  // 2. Bulk create Purchase Orders (Заказы поставщикам) from shortage list
  app.post("/api/procurement/create-orders", (req: Request, res: Response) => {
    const orgId = req.auth?.organizationId ?? 1;
    const { items } = req.body as {
      items: Array<{ productId: number; orderUnits: number; supplierId?: number }>;
    };

    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: "Список товаров для заказа пуст" });
    }

    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty" }).format(new Date());

    // Group by supplier
    const grouped = new Map<number, Array<{ productId: number; orderUnits: number }>>();

    // Fallback default supplier if none assigned
    const defaultSupplier = (db.prepare("SELECT id FROM counterparties WHERE organization_id = ? AND kind = 'supplier' LIMIT 1").get(orgId) as { id: number } | undefined)?.id ?? 1;

    for (const item of items) {
      if (item.orderUnits <= 0) continue;
      const product = db.prepare("SELECT supplier_id FROM products WHERE id = ?").get(item.productId) as { supplier_id?: number } | undefined;
      const supplierId = item.supplierId || product?.supplier_id || defaultSupplier;

      const group = grouped.get(supplierId) ?? [];
      group.push(item);
      grouped.set(supplierId, group);
    }

    const createdOrders: Array<{ id: number; number: string; supplier_id: number; total_tiyin: number }> = [];

    const tx = db.transaction(() => {
      for (const [supplierId, orderItems] of grouped.entries()) {
        const orderNum = "ЗП-" + String(Math.floor(Math.random() * 90000) + 10000);

        const insertDoc = db.prepare(`
          INSERT INTO documents (
            organization_id, number, kind, status, date, counterparty_id,
            warehouse_id, comment, total_tiyin, status_name
          ) VALUES (?, ?, 'supplier_order', 'draft', ?, ?, 1, ?, 0, 'Новый')
        `).run(orgId, orderNum, today, supplierId, "Автоматический заказ по неснижаемому остатку и дефициту");

        const docId = Number(insertDoc.lastInsertRowid);
        let orderTotalTiyin = 0;

        for (let idx = 0; idx < orderItems.length; idx++) {
          const item = orderItems[idx];
          const prod = db.prepare("SELECT name, code, unit, purchase_price_tiyin FROM products WHERE id = ?").get(item.productId) as {
            name: string;
            code: string;
            unit: string;
            purchase_price_tiyin: number;
          };

          const price = Number(prod.purchase_price_tiyin || 0);
          const lineTotal = Math.round((item.orderUnits * price) / 1000000);
          orderTotalTiyin += lineTotal;

          db.prepare(`
            INSERT INTO document_lines (
              document_id, product_id, quantity_units, unit_price_tiyin,
              discount_bps, vat_rate, vat_sum_tiyin, total_without_vat_tiyin, position
            ) VALUES (?, ?, ?, ?, 0, '12%', 0, ?, ?)
          `).run(docId, item.productId, item.orderUnits, price, lineTotal, idx + 1);
        }

        db.prepare("UPDATE documents SET total_tiyin = ? WHERE id = ?").run(orderTotalTiyin, docId);

        createdOrders.push({
          id: docId,
          number: orderNum,
          supplier_id: supplierId,
          total_tiyin: orderTotalTiyin,
        });

        recordAudit("document", docId, "create", `Сформирован заказ поставщику ${orderNum} на сумму ${(orderTotalTiyin / 100).toFixed(2)} ₸`, orgId);
      }
    });

    tx();
    res.json({ ok: true, created_orders: createdOrders });
  });
}
