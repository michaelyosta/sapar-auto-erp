import type Database from "better-sqlite3";
import type { Express, Request, Response } from "express";

type SqliteDb = Database.Database;

export function registerAnalyticsRoutes(app: Express, db: SqliteDb): void {
  // 1. Sales Funnel for Auto Workshop
  app.get("/api/analytics/sales-funnel", (req: Request, res: Response) => {
    const orgId = req.auth?.organizationId ?? 1;
    const from = String(req.query.from ?? "");
    const to = String(req.query.to ?? "");

    let dateFilter = "";
    const params: unknown[] = [orgId];
    if (from) { dateFilter += " AND date >= ?"; params.push(from); }
    if (to) { dateFilter += " AND date <= ?"; params.push(to); }

    const stagesDef = [
      { key: "new", name: "1. Новая заявка / Оценка", statuses: ["draft", "Новый"] },
      { key: "in_progress", name: "2. Авто в ремзоне (В работе)", statuses: ["in_progress", "В работе"] },
      { key: "waiting_parts", name: "3. Ожидание запчастей / Согласование", statuses: ["waiting_parts", "Ожидание запчастей"] },
      { key: "completed", name: "4. Работы завершены / Контроль ОТК", statuses: ["completed", "Готов к выдаче"] },
      { key: "posted", name: "5. Заказ-наряд закрыт и оплачен", statuses: ["posted", "Закрыт"] },
    ];

    const allOrders = db.prepare(`
      SELECT id, status, status_name, total_tiyin
      FROM documents
      WHERE organization_id = ? AND kind IN ('work_order', 'customer_order')
        AND status <> 'deleted'
        ${dateFilter}
    `).all(...params) as Array<{ id: number; status: string; status_name: string; total_tiyin: number }>;

    let prevCount = allOrders.length;
    const stages = stagesDef.map((st, idx) => {
      const matching = allOrders.filter(
        (o) => st.statuses.includes(o.status) || st.statuses.includes(o.status_name)
      );
      const count = matching.length;
      const sumTiyin = matching.reduce((acc, o) => acc + Number(o.total_tiyin), 0);
      const avgCheckTiyin = count > 0 ? Math.round(sumTiyin / count) : 0;
      const conversion = prevCount > 0 ? Math.round((count / prevCount) * 100) : 0;
      if (idx === 0) prevCount = count || 1;

      return {
        key: st.key,
        name: st.name,
        count,
        total_tiyin: sumTiyin,
        avg_check_tiyin: avgCheckTiyin,
        conversion_percent: conversion,
      };
    });

    const totalOrdersCount = allOrders.length;
    const totalRevenueTiyin = allOrders.reduce((acc, o) => acc + Number(o.total_tiyin), 0);
    const overallAvgCheckTiyin = totalOrdersCount > 0 ? Math.round(totalRevenueTiyin / totalOrdersCount) : 0;

    res.json({
      total_orders: totalOrdersCount,
      total_revenue_tiyin: totalRevenueTiyin,
      avg_check_tiyin: overallAvgCheckTiyin,
      stages,
    });
  });

  // 2. Manager and Master Performance Rating
  app.get("/api/analytics/manager-performance", (req: Request, res: Response) => {
    const orgId = req.auth?.organizationId ?? 1;
    const from = String(req.query.from ?? "");
    const to = String(req.query.to ?? "");

    let dateFilter = "";
    const params: unknown[] = [orgId];
    if (from) { dateFilter += " AND d.date >= ?"; params.push(from); }
    if (to) { dateFilter += " AND d.date <= ?"; params.push(to); }

    const users = db.prepare("SELECT id, full_name, login, position, role FROM users WHERE organization_id = ? AND active = 1").all(orgId) as Array<{
      id: number;
      full_name: string;
      login: string;
      position: string;
      role: string;
    }>;

    const list = users.map((u) => {
      const orders = db.prepare(`
        SELECT d.id, d.total_tiyin
        FROM documents d
        WHERE d.organization_id = ? AND d.status = 'posted' AND d.kind = 'work_order'
          AND (d.master_id = ? OR d.master_id IS NULL)
          ${dateFilter}
      `).all(orgId, u.id, ...params.slice(1)) as Array<{ id: number; total_tiyin: number }>;

      let workRevenueTiyin = 0;
      let partsRevenueTiyin = 0;

      for (const o of orders) {
        const lines = db.prepare(`
          SELECT l.quantity_units, l.unit_price_tiyin, p.kind
          FROM document_lines l
          JOIN products p ON p.id = l.product_id
          WHERE l.document_id = ?
        `).all(o.id) as Array<{ quantity_units: number; unit_price_tiyin: number; kind: string }>;

        for (const l of lines) {
          const sum = Math.round((Number(l.quantity_units) * Number(l.unit_price_tiyin)) / 1000000);
          if (l.kind === "service") workRevenueTiyin += sum;
          else partsRevenueTiyin += sum;
        }
      }

      const totalRevenue = workRevenueTiyin + partsRevenueTiyin;
      const cogsTiyin = Math.round(partsRevenueTiyin * 0.65); // Est. 65% purchase cost for auto parts
      const grossProfit = totalRevenue - cogsTiyin;
      const margin = totalRevenue > 0 ? Math.round((grossProfit / totalRevenue) * 100) : 0;

      return {
        user_id: u.id,
        full_name: u.full_name,
        position: u.position || u.role,
        orders_count: orders.length,
        work_revenue_tiyin: workRevenueTiyin,
        parts_revenue_tiyin: partsRevenueTiyin,
        total_revenue_tiyin: totalRevenue,
        gross_profit_tiyin: grossProfit,
        margin_percent: margin,
      };
    });

    list.sort((a, b) => b.total_revenue_tiyin - a.total_revenue_tiyin);
    res.json(list);
  });
}
