import type Database from "better-sqlite3";
import type { Express, Request, Response } from "express";

type SqliteDb = Database.Database;

export function initializePayrollSchema(db: SqliteDb): void {
  // Users table rate columns
  const userColumns = db.pragma("table_info(users)") as Array<{ name: string }>;
  const userMigrations: Array<[string, string]> = [
    ["position", "TEXT NOT NULL DEFAULT 'Специалист'"],
    ["labor_rate_percent", "REAL NOT NULL DEFAULT 40.0"],
    ["parts_rate_percent", "REAL NOT NULL DEFAULT 5.0"],
    ["base_salary_tiyin", "INTEGER NOT NULL DEFAULT 0"],
    ["phone", "TEXT NOT NULL DEFAULT ''"],
  ];
  for (const [name, declaration] of userMigrations) {
    if (!userColumns.some((col) => col.name === name)) {
      db.exec(`ALTER TABLE users ADD COLUMN ${name} ${declaration}`);
    }
  }

  // Documents table master_id
  const docColumns = db.pragma("table_info(documents)") as Array<{ name: string }>;
  if (!docColumns.some((col) => col.name === "master_id")) {
    db.exec("ALTER TABLE documents ADD COLUMN master_id INTEGER REFERENCES users(id)");
  }

  // Document lines table executor_id
  const lineColumns = db.pragma("table_info(document_lines)") as Array<{ name: string }>;
  if (!lineColumns.some((col) => col.name === "executor_id")) {
    db.exec("ALTER TABLE document_lines ADD COLUMN executor_id INTEGER REFERENCES users(id)");
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS payroll_sheets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      number TEXT NOT NULL,
      period_month TEXT NOT NULL,
      date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      total_accrued_tiyin INTEGER NOT NULL DEFAULT 0,
      total_paid_tiyin INTEGER NOT NULL DEFAULT 0,
      comment TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_payroll_sheets_org ON payroll_sheets(organization_id, period_month);

    CREATE TABLE IF NOT EXISTS payroll_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sheet_id INTEGER NOT NULL REFERENCES payroll_sheets(id) ON DELETE CASCADE,
      employee_id INTEGER NOT NULL REFERENCES users(id),
      base_salary_tiyin INTEGER NOT NULL DEFAULT 0,
      work_orders_count INTEGER NOT NULL DEFAULT 0,
      work_revenue_tiyin INTEGER NOT NULL DEFAULT 0,
      work_accrual_tiyin INTEGER NOT NULL DEFAULT 0,
      parts_revenue_tiyin INTEGER NOT NULL DEFAULT 0,
      parts_accrual_tiyin INTEGER NOT NULL DEFAULT 0,
      bonus_tiyin INTEGER NOT NULL DEFAULT 0,
      deduction_tiyin INTEGER NOT NULL DEFAULT 0,
      total_tiyin INTEGER NOT NULL DEFAULT 0,
      paid_tiyin INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'calculated'
    );
    CREATE INDEX IF NOT EXISTS idx_payroll_lines_sheet ON payroll_lines(sheet_id);
  `);
}

export function registerPayrollRoutes(
  app: Express,
  db: SqliteDb,
  recordAudit: (entityType: string, entityId: number, action: string, detail?: string, orgId?: number) => void
): void {
  // 1. Get employees with their compensation rates
  app.get("/api/payroll/employees", (req: Request, res: Response) => {
    const orgId = req.auth?.organizationId ?? 1;
    const employees = db.prepare(`
      SELECT id, login, full_name, role, active, position,
        labor_rate_percent, parts_rate_percent, base_salary_tiyin, phone
      FROM users
      WHERE organization_id = ? AND active = 1
      ORDER BY full_name ASC
    `).all(orgId);
    res.json(employees);
  });

  // 2. Update employee rates
  app.patch("/api/payroll/employees/:id/rates", (req: Request, res: Response) => {
    const orgId = req.auth?.organizationId ?? 1;
    const empId = Number(req.params.id);
    const { position, labor_rate_percent, parts_rate_percent, base_salary_tiyin, phone } = req.body;

    db.prepare(`
      UPDATE users
      SET position = COALESCE(?, position),
          labor_rate_percent = COALESCE(?, labor_rate_percent),
          parts_rate_percent = COALESCE(?, parts_rate_percent),
          base_salary_tiyin = COALESCE(?, base_salary_tiyin),
          phone = COALESCE(?, phone)
      WHERE id = ? AND organization_id = ?
    `).run(
      position !== undefined ? String(position) : null,
      labor_rate_percent !== undefined ? Number(labor_rate_percent) : null,
      parts_rate_percent !== undefined ? Number(parts_rate_percent) : null,
      base_salary_tiyin !== undefined ? Number(base_salary_tiyin) : null,
      phone !== undefined ? String(phone) : null,
      empId,
      orgId
    );

    recordAudit("user", empId, "rates_update", `Обновлены ставки оплаты сотрудника #${empId}`, orgId);
    res.json({ ok: true });
  });

  // 3. Employee performance detail for period
  app.get("/api/payroll/employees/:id/performance", (req: Request, res: Response) => {
    const orgId = req.auth?.organizationId ?? 1;
    const empId = Number(req.params.id);
    const period = String(req.query.period ?? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty" }).format(new Date()).slice(0, 7));

    const emp = db.prepare("SELECT * FROM users WHERE id = ? AND organization_id = ?").get(empId, orgId) as Record<string, unknown> | undefined;
    if (!emp) return res.status(404).json({ error: "Сотрудник не найден" });

    // Find all posted work orders in this month where master_id = empId OR lines have executor_id = empId
    const workOrders = db.prepare(`
      SELECT DISTINCT d.id, d.number, d.date, d.total_tiyin, d.comment,
        c.name AS counterparty_name, v.plate AS vehicle_plate, v.make, v.model
      FROM documents d
      LEFT JOIN counterparties c ON c.id = d.counterparty_id
      LEFT JOIN vehicles v ON v.id = d.vehicle_id
      LEFT JOIN document_lines l ON l.document_id = d.id
      WHERE d.organization_id = ? AND d.status = 'posted' AND d.kind = 'work_order'
        AND substr(d.date, 1, 7) = ?
        AND (d.master_id = ? OR l.executor_id = ? OR d.master_id IS NULL)
      ORDER BY d.date DESC, d.id DESC
    `).all(orgId, period, empId, empId) as Array<Record<string, unknown>>;

    let totalWorkRevenueTiyin = 0;
    let totalPartsRevenueTiyin = 0;

    const ordersWithLines = workOrders.map((wo) => {
      const lines = db.prepare(`
        SELECT l.*, p.name AS product_name, p.code AS product_code, p.kind AS product_kind, p.unit
        FROM document_lines l
        JOIN products p ON p.id = l.product_id
        WHERE l.document_id = ?
      `).all(wo.id) as Array<Record<string, unknown>>;

      let orderWorkTiyin = 0;
      let orderPartsTiyin = 0;

      for (const line of lines) {
        const lineTotal = Math.round((Number(line.quantity_units) * Number(line.unit_price_tiyin)) / 1000000);
        if (line.product_kind === "service") {
          orderWorkTiyin += lineTotal;
          totalWorkRevenueTiyin += lineTotal;
        } else {
          orderPartsTiyin += lineTotal;
          totalPartsRevenueTiyin += lineTotal;
        }
      }

      return {
        ...wo,
        work_revenue_tiyin: orderWorkTiyin,
        parts_revenue_tiyin: orderPartsTiyin,
        lines_count: lines.length,
      };
    });

    const laborRate = Number(emp.labor_rate_percent ?? 40);
    const partsRate = Number(emp.parts_rate_percent ?? 5);
    const baseSalary = Number(emp.base_salary_tiyin ?? 0);

    const workAccrual = Math.round((totalWorkRevenueTiyin * laborRate) / 100);
    const partsAccrual = Math.round((totalPartsRevenueTiyin * partsRate) / 100);
    const totalEarnings = baseSalary + workAccrual + partsAccrual;

    res.json({
      employee: emp,
      period,
      orders_count: ordersWithLines.length,
      total_work_revenue_tiyin: totalWorkRevenueTiyin,
      total_parts_revenue_tiyin: totalPartsRevenueTiyin,
      work_accrual_tiyin: workAccrual,
      parts_accrual_tiyin: partsAccrual,
      base_salary_tiyin: baseSalary,
      total_earnings_tiyin: totalEarnings,
      orders: ordersWithLines,
    });
  });

  // 4. List payroll sheets
  app.get("/api/payroll/sheets", (req: Request, res: Response) => {
    const orgId = req.auth?.organizationId ?? 1;
    const sheets = db.prepare(`
      SELECT s.*,
        COUNT(l.id) AS employees_count
      FROM payroll_sheets s
      LEFT JOIN payroll_lines l ON l.sheet_id = s.id
      WHERE s.organization_id = ? AND s.status <> 'deleted'
      GROUP BY s.id
      ORDER BY s.period_month DESC, s.id DESC
    `).all(orgId);
    res.json(sheets);
  });

  // 5. Get payroll sheet detail with employee rows
  app.get("/api/payroll/sheets/:id", (req: Request, res: Response) => {
    const orgId = req.auth?.organizationId ?? 1;
    const sheetId = Number(req.params.id);

    const sheet = db.prepare("SELECT * FROM payroll_sheets WHERE id = ? AND organization_id = ?").get(sheetId, orgId);
    if (!sheet) return res.status(404).json({ error: "Ведомость не найдена" });

    const lines = db.prepare(`
      SELECT l.*, u.full_name AS employee_name, u.login AS employee_login, u.position AS employee_position,
        u.labor_rate_percent, u.parts_rate_percent
      FROM payroll_lines l
      JOIN users u ON u.id = l.employee_id
      WHERE l.sheet_id = ?
      ORDER BY u.full_name ASC
    `).all(sheetId);

    res.json({ ...sheet as object, lines });
  });

  // 6. Calculate & create payroll sheet for a month
  app.post("/api/payroll/calculate", (req: Request, res: Response) => {
    const orgId = req.auth?.organizationId ?? 1;
    const period = String(req.body.period_month ?? "").trim();
    if (!period || !/^\d{4}-\d{2}$/.test(period)) {
      return res.status(400).json({ error: "Укажите период начисления в формате ГГГГ-ММ" });
    }

    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty" }).format(new Date());

    // Check existing
    const existing = db.prepare("SELECT id FROM payroll_sheets WHERE organization_id = ? AND period_month = ? AND status <> 'deleted'").get(orgId, period) as { id: number } | undefined;
    if (existing) {
      return res.status(400).json({ error: `Ведомость за период ${period} уже создана (№ ${existing.id}). Откройте ее для редактирования или перерасчета.` });
    }

    const nextNum = "ЗП-" + period.replace("-", "") + "-" + String(Math.floor(Math.random() * 900) + 100);

    const employees = db.prepare(`
      SELECT id, full_name, position, labor_rate_percent, parts_rate_percent, base_salary_tiyin
      FROM users
      WHERE organization_id = ? AND active = 1
    `).all(orgId) as Array<Record<string, unknown>>;

    const insertSheet = db.prepare(`
      INSERT INTO payroll_sheets (organization_id, number, period_month, date, status, total_accrued_tiyin, total_paid_tiyin, comment)
      VALUES (?, ?, ?, ?, 'calculated', 0, 0, ?)
    `);

    const insertLine = db.prepare(`
      INSERT INTO payroll_lines (
        sheet_id, employee_id, base_salary_tiyin, work_orders_count,
        work_revenue_tiyin, work_accrual_tiyin, parts_revenue_tiyin, parts_accrual_tiyin,
        bonus_tiyin, deduction_tiyin, total_tiyin, paid_tiyin, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, 0, 'calculated')
    `);

    let totalAccruedAll = 0;

    const tx = db.transaction(() => {
      const sheetRes = insertSheet.run(orgId, nextNum, period, today, `Расчетная ведомость за ${period}`);
      const sheetId = Number(sheetRes.lastInsertRowid);

      for (const emp of employees) {
        const empId = Number(emp.id);
        const baseSalary = Number(emp.base_salary_tiyin ?? 0);
        const laborRate = Number(emp.labor_rate_percent ?? 40);
        const partsRate = Number(emp.parts_rate_percent ?? 5);

        // Calculate work orders closed by this employee in the period
        const orders = db.prepare(`
          SELECT DISTINCT d.id
          FROM documents d
          LEFT JOIN document_lines l ON l.document_id = d.id
          WHERE d.organization_id = ? AND d.status = 'posted' AND d.kind = 'work_order'
            AND substr(d.date, 1, 7) = ?
            AND (d.master_id = ? OR l.executor_id = ? OR d.master_id IS NULL)
        `).all(orgId, period, empId, empId) as Array<{ id: number }>;

        let empWorkRev = 0;
        let empPartsRev = 0;

        for (const o of orders) {
          const lines = db.prepare(`
            SELECT l.quantity_units, l.unit_price_tiyin, p.kind AS product_kind
            FROM document_lines l
            JOIN products p ON p.id = l.product_id
            WHERE l.document_id = ?
          `).all(o.id) as Array<{ quantity_units: number; unit_price_tiyin: number; product_kind: string }>;

          for (const l of lines) {
            const sum = Math.round((Number(l.quantity_units) * Number(l.unit_price_tiyin)) / 1000000);
            if (l.product_kind === "service") empWorkRev += sum;
            else empPartsRev += sum;
          }
        }

        const workAccrual = Math.round((empWorkRev * laborRate) / 100);
        const partsAccrual = Math.round((empPartsRev * partsRate) / 100);
        const totalEmp = baseSalary + workAccrual + partsAccrual;
        totalAccruedAll += totalEmp;

        insertLine.run(
          sheetId,
          empId,
          baseSalary,
          orders.length,
          empWorkRev,
          workAccrual,
          empPartsRev,
          partsAccrual,
          totalEmp
        );
      }

      db.prepare("UPDATE payroll_sheets SET total_accrued_tiyin = ? WHERE id = ?").run(totalAccruedAll, sheetId);
      return sheetId;
    });

    const newId = tx();
    recordAudit("payroll", newId, "calculate", `Рассчитана ведомость зарплаты за ${period} на сумму ${(totalAccruedAll / 100).toFixed(2)} ₸`, orgId);
    res.json({ id: newId, number: nextNum, total_accrued_tiyin: totalAccruedAll });
  });

  // 7. Pay payroll sheet (auto-creates cash/bank payment documents)
  app.post("/api/payroll/sheets/:id/pay", (req: Request, res: Response) => {
    const orgId = req.auth?.organizationId ?? 1;
    const sheetId = Number(req.params.id);
    const paymentMethod = String(req.body.paymentMethod ?? "cash"); // "cash" | "bank"

    const sheet = db.prepare("SELECT * FROM payroll_sheets WHERE id = ? AND organization_id = ?").get(sheetId, orgId) as Record<string, unknown> | undefined;
    if (!sheet) return res.status(404).json({ error: "Ведомость не найдена" });
    if (sheet.status === "paid") return res.status(400).json({ error: "Ведомость уже выплачена" });

    const lines = db.prepare("SELECT * FROM payroll_lines WHERE sheet_id = ?").all(sheetId) as Array<Record<string, unknown>>;
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty" }).format(new Date());

    const tx = db.transaction(() => {
      let totalPaid = 0;
      for (const line of lines) {
        const amount = Number(line.total_tiyin);
        if (amount <= 0) continue;

        const docKind = paymentMethod === "cash" ? "cash_out" : "payment";
        const docNum = `РКО-ЗП-${line.id}-${Date.now().toString().slice(-4)}`;

        // Create outgoing payment document in main documents registry
        db.prepare(`
          INSERT INTO documents (
            organization_id, number, kind, status, date, total_tiyin,
            comment, payment_method
          ) VALUES (?, ?, ?, 'posted', ?, ?, ?, ?)
        `).run(
          orgId,
          docNum,
          docKind,
          today,
          amount,
          `Выплата зарплаты по ведомости ${sheet.number} (Сотрудник #${line.employee_id})`,
          paymentMethod
        );

        db.prepare("UPDATE payroll_lines SET paid_tiyin = total_tiyin, status = 'paid' WHERE id = ?").run(line.id);
        totalPaid += amount;
      }

      db.prepare(`
        UPDATE payroll_sheets
        SET status = 'paid', total_paid_tiyin = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(totalPaid, sheetId);
    });

    tx();
    recordAudit("payroll", sheetId, "pay", `Выплачена ведомость ${sheet.number} (${paymentMethod === "cash" ? "Наличными через РКО" : "Безналично"})`, orgId);
    res.json({ ok: true, message: "Зарплата успешно выплачена, платежные документы проведены" });
  });
}
