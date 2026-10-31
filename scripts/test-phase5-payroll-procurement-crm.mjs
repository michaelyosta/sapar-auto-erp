import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import express from "express";
import http from "node:http";
import { initializePayrollSchema, registerPayrollRoutes } from "../server/payroll.js";
import { initializeDiscountsLoyaltySchema, registerDiscountsLoyaltyRoutes } from "../server/discountsLoyalty.js";
import { registerProcurementRoutes } from "../server/procurement.js";
import { initializeTaxInvoicesSchema, registerTaxInvoicesRoutes } from "../server/taxInvoices.js";
import { registerAnalyticsRoutes } from "../server/analytics.js";

test("Phase 5 - Payroll, Discounts/Loyalty, Procurement, Tax Invoices & Analytics", async (t) => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");

  // Core base schema
  db.exec(`
    CREATE TABLE organizations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, currency TEXT NOT NULL DEFAULT 'KZT');
    INSERT INTO organizations (id, name) VALUES (1, 'Автокомплекс ТОО "Сапар"');

    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      login TEXT NOT NULL UNIQUE,
      full_name TEXT NOT NULL,
      password_hash TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'employee',
      active INTEGER NOT NULL DEFAULT 1,
      must_change_password INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO users (id, organization_id, login, full_name, role) VALUES
      (1, 1, 'admin', 'Администратор Сервиса', 'owner'),
      (2, 1, 'master.ivan', 'Иван Слесарь', 'employee'),
      (3, 1, 'master.alex', 'Алексей Электрик', 'employee');

    CREATE TABLE counterparties (
      id INTEGER PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'customer',
      phone TEXT NOT NULL DEFAULT '',
      bin TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1
    );
    INSERT INTO counterparties (id, organization_id, name, kind, phone, bin) VALUES
      (1, 1, 'Каспи Банк Автопарк', 'customer', '+77011112233', '120340001122'),
      (2, 1, 'ТОО Моторс Снаб', 'supplier', '+77023334455', '990540009988');

    CREATE TABLE warehouses (
      id INTEGER PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      name TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1
    );
    INSERT INTO warehouses (id, organization_id, name) VALUES (1, 1, 'Центральный склад запчастей');

    CREATE TABLE products (
      id INTEGER PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'product',
      unit TEXT NOT NULL DEFAULT 'шт',
      purchase_price_tiyin INTEGER NOT NULL DEFAULT 0,
      sale_price_tiyin INTEGER NOT NULL DEFAULT 0,
      min_stock_units INTEGER NOT NULL DEFAULT 0,
      supplier_id INTEGER REFERENCES counterparties(id),
      active INTEGER NOT NULL DEFAULT 1
    );
    INSERT INTO products (id, organization_id, code, name, kind, unit, purchase_price_tiyin, sale_price_tiyin, min_stock_units, supplier_id) VALUES
      (1, 1, 'P-001', 'Масло моторное 5W-40 4L', 'product', 'шт', 1200000, 1800000, 10000000, 2),
      (2, 1, 'P-002', 'Фильтр масляный', 'product', 'шт', 200000, 450000, 5000000, 2),
      (3, 1, 'S-001', 'Замена масла и фильтра', 'service', 'усл', 0, 500000, 0, NULL);

    CREATE TABLE stock_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      product_id INTEGER NOT NULL REFERENCES products(id),
      warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
      quantity_units INTEGER NOT NULL,
      value_tiyin INTEGER NOT NULL DEFAULT 0,
      document_id INTEGER
    );
    -- Initial stock: 4 units of oil (less than 10 units min stock!), 2 units of filter
    INSERT INTO stock_movements (organization_id, product_id, warehouse_id, quantity_units, value_tiyin) VALUES
      (1, 1, 1, 4000000, 4800000),
      (1, 2, 1, 2000000, 400000);

    CREATE TABLE stock_reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      product_id INTEGER NOT NULL REFERENCES products(id),
      warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
      quantity_units INTEGER NOT NULL
    );

    CREATE TABLE contracts (
      id INTEGER PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      number TEXT NOT NULL
    );

    CREATE TABLE documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      number TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'posted',
      date TEXT NOT NULL,
      counterparty_id INTEGER REFERENCES counterparties(id),
      warehouse_id INTEGER REFERENCES warehouses(id),
      contract_id INTEGER REFERENCES contracts(id),
      total_tiyin INTEGER NOT NULL DEFAULT 0,
      comment TEXT,
      payment_method TEXT NOT NULL DEFAULT '',
      status_name TEXT NOT NULL DEFAULT 'Закрыт'
    );

    CREATE TABLE document_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL REFERENCES documents(id),
      product_id INTEGER NOT NULL REFERENCES products(id),
      quantity_units INTEGER NOT NULL,
      unit_price_tiyin INTEGER NOT NULL,
      discount_bps INTEGER NOT NULL DEFAULT 0,
      vat_rate TEXT NOT NULL DEFAULT '12%',
      vat_sum_tiyin INTEGER NOT NULL DEFAULT 0,
      total_without_vat_tiyin INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      detail TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Initialize new schemas
  initializePayrollSchema(db);
  initializeDiscountsLoyaltySchema(db);
  initializeTaxInvoicesSchema(db);

  // Setup test Express app
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.auth = {
      userId: 1,
      organizationId: 1,
      login: "admin",
      fullName: "Администратор",
      role: "owner",
      mustChangePassword: false,
    };
    next();
  });

  const recordAuditMock = (entityType, entityId, action, detail, orgId = 1) => {
    db.prepare("INSERT INTO audit_log (organization_id, entity_type, entity_id, action, detail) VALUES (?, ?, ?, ?, ?)")
      .run(orgId, entityType, entityId, action, detail || "");
  };

  registerPayrollRoutes(app, db, recordAuditMock);
  registerDiscountsLoyaltyRoutes(app, db, recordAuditMock);
  registerProcurementRoutes(app, db, recordAuditMock);
  registerTaxInvoicesRoutes(app, db, recordAuditMock);
  registerAnalyticsRoutes(app, db);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Seed completed work order for Ivan
    const currentMonth = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty" }).format(new Date()).slice(0, 7);
    const today = `${currentMonth}-15`;

    const woRes = db.prepare(`
      INSERT INTO documents (organization_id, number, kind, status, date, counterparty_id, total_tiyin, master_id)
      VALUES (1, 'ЗН-101', 'work_order', 'posted', ?, 1, 950000, 2)
    `).run(today);
    const woId = Number(woRes.lastInsertRowid);

    // Line 1: Service (Замена масла) -> 5000 ₸ (500000 tiyins)
    db.prepare(`
      INSERT INTO document_lines (document_id, product_id, quantity_units, unit_price_tiyin, total_without_vat_tiyin, executor_id)
      VALUES (?, 3, 1000000, 500000, 500000, 2)
    `).run(woId);

    // Line 2: Parts (Масло) -> 4500 ₸ (450000 tiyins)
    db.prepare(`
      INSERT INTO document_lines (document_id, product_id, quantity_units, unit_price_tiyin, total_without_vat_tiyin, executor_id)
      VALUES (?, 1, 250000, 1800000, 450000, 2)
    `).run(woId);

    // Test 1: Payroll calculation
    await t.test("Payroll calculation from completed work orders", async () => {
      const calcRes = await fetch(`${baseUrl}/api/payroll/calculate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period_month: currentMonth }),
      });
      assert.equal(calcRes.status, 200);
      const calcData = await calcRes.json();
      assert.ok(calcData.id > 0, "Created payroll sheet ID");

      const sheetDetailRes = await fetch(`${baseUrl}/api/payroll/sheets/${calcData.id}`);
      assert.equal(sheetDetailRes.status, 200);
      const sheetDetail = await sheetDetailRes.json();
      assert.equal(sheetDetail.lines.length, 3, "All 3 active employees present in payroll sheet");

      const ivanLine = sheetDetail.lines.find((l) => l.employee_id === 2);
      assert.ok(ivanLine, "Ivan line exists");
      assert.equal(ivanLine.work_revenue_tiyin, 500000, "5,000 KZT work revenue");
      // 40% of 5,000 KZT = 2,000 KZT (200000 tiyins)
      assert.equal(ivanLine.work_accrual_tiyin, 200000, "40% piecework work accrual");
      // 5% of 4,500 KZT = 225 KZT (22500 tiyins)
      assert.equal(ivanLine.parts_accrual_tiyin, 22500, "5% piecework parts accrual");
      assert.equal(ivanLine.total_tiyin, 222500, "Total Ivan earnings: 2,225 KZT");
    });

    // Test 2: Payout of payroll sheet
    await t.test("Payout of payroll sheet via cash orders (РКО)", async () => {
      const sheetsRes = await fetch(`${baseUrl}/api/payroll/sheets`);
      const sheets = await sheetsRes.json();
      const sheetId = sheets[0].id;

      const payRes = await fetch(`${baseUrl}/api/payroll/sheets/${sheetId}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentMethod: "cash" }),
      });
      assert.equal(payRes.status, 200);

      // Verify that outgoing cash orders (cash_out) were generated
      const cashOutDocs = db.prepare("SELECT * FROM documents WHERE kind = 'cash_out'").all();
      assert.ok(cashOutDocs.length > 0, "Cash out documents created for payroll");
    });

    // Test 3: Discounts & Loyalty Points
    await t.test("Discounts & Loyalty Points management", async () => {
      const discRes = await fetch(`${baseUrl}/api/discounts`);
      assert.equal(discRes.status, 200);
      const discounts = await discRes.json();
      assert.ok(discounts.length >= 3, "Default discounts seeded");

      // Auto issue card for counterparty 1
      const loyaltyRes = await fetch(`${baseUrl}/api/loyalty/account/1`);
      assert.equal(loyaltyRes.status, 200);
      const loyaltyData = await loyaltyRes.json();
      assert.ok(loyaltyData.card_number.startsWith("7700-"), "Loyalty card number issued");

      // Add points
      const addPointsRes = await fetch(`${baseUrl}/api/loyalty/transactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          loyalty_account_id: loyaltyData.id,
          amount_points: 1500,
          comment: "Бонус за ТО",
        }),
      });
      assert.equal(addPointsRes.status, 200);
      const addResult = await addPointsRes.json();
      assert.equal(addResult.new_balance, 1500, "1500 points added");
    });

    // Test 4: Procurement & Auto-order calculation
    await t.test("Procurement shortage analysis & auto-order creation", async () => {
      const planRes = await fetch(`${baseUrl}/api/procurement/plan?onlyShortage=true`);
      assert.equal(planRes.status, 200);
      const planData = await planRes.json();

      // Oil has min stock 10 units, current stock 4 units -> shortage = 6 units (6000000 micro-units)
      const oilShortage = planData.items.find((it) => it.id === 1);
      assert.ok(oilShortage, "Oil item found in shortage");
      assert.equal(oilShortage.shortage_units, 6000000, "6 units shortage calculated");

      // Create purchase orders
      const orderRes = await fetch(`${baseUrl}/api/procurement/create-orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [{ productId: 1, orderUnits: 6000000 }],
        }),
      });
      assert.equal(orderRes.status, 200);
      const orderData = await orderRes.json();
      assert.equal(orderData.created_orders.length, 1, "1 purchase order created for supplier 2");
      assert.ok(orderData.created_orders[0].number.startsWith("ЗП-"), "Order number format");
    });

    // Test 5: Tax Invoices (ЭСФ)
    await t.test("Tax Invoices creation and IS ESF registration", async () => {
      const esfCreateRes = await fetch(`${baseUrl}/api/tax-invoices/from-document/${woId}`, {
        method: "POST",
      });
      assert.equal(esfCreateRes.status, 200);
      const esfData = await esfCreateRes.json();
      assert.ok(esfData.number.startsWith("ЭСФ-"), "Tax invoice number format");

      // Register in IS ESF
      const sendRes = await fetch(`${baseUrl}/api/tax-invoices/${esfData.id}/send-esf`, {
        method: "POST",
      });
      assert.equal(sendRes.status, 200);
      const sendData = await sendRes.json();
      assert.ok(sendData.registration_number.startsWith("ESF-KZ-"), "IS ESF registration number generated");
    });

    // Test 6: Analytics Sales Funnel
    await t.test("Sales Funnel & Manager Performance", async () => {
      const funnelRes = await fetch(`${baseUrl}/api/analytics/sales-funnel`);
      assert.equal(funnelRes.status, 200);
      const funnelData = await funnelRes.json();
      assert.ok(funnelData.stages.length === 5, "5 stages in workshop repair funnel");

      const mgrRes = await fetch(`${baseUrl}/api/analytics/manager-performance`);
      assert.equal(mgrRes.status, 200);
      const mgrData = await mgrRes.json();
      assert.ok(mgrData.length === 3, "3 employees in performance ranking");
    });

    // Test 7: SQLite DB Integrity
    await t.test("SQLite Database Integrity & Foreign Keys", async () => {
      const realDb = new Database("data/moysklad.sqlite");
      const integrity = realDb.pragma("integrity_check");
      assert.equal(integrity[0].integrity_check, "ok", "Database integrity is ok");
      const fkViolations = realDb.pragma("foreign_key_check");
      assert.equal(fkViolations.length, 0, "Zero foreign key violations in data/moysklad.sqlite");
      realDb.close();
    });
  } finally {
    server.close();
    db.close();
  }
});
