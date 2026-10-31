import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import express from "express";
import http from "node:http";

// We will test using an in-memory or temporary test server with the exact logic
test("Phase 3 - Organization, Settings and Retail POS Backend", async (t) => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");

  // Create core schema
  db.exec(`
    CREATE TABLE organizations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'KZT',
      code TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      fax TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      actual_address TEXT NOT NULL DEFAULT '',
      actual_address_comment TEXT NOT NULL DEFAULT '',
      comment TEXT NOT NULL DEFAULT '',
      director TEXT NOT NULL DEFAULT '',
      director_position TEXT NOT NULL DEFAULT 'Руководитель организации или иное уполномоченное лицо',
      director_signature_url TEXT NOT NULL DEFAULT '',
      accountant TEXT NOT NULL DEFAULT '',
      accountant_signature_url TEXT NOT NULL DEFAULT '',
      stamp_url TEXT NOT NULL DEFAULT '',
      logo_url TEXT NOT NULL DEFAULT '',
      legal_type TEXT NOT NULL DEFAULT 'legal_entity',
      legal_name TEXT NOT NULL DEFAULT '',
      legal_address TEXT NOT NULL DEFAULT '',
      legal_address_comment TEXT NOT NULL DEFAULT '',
      bin TEXT NOT NULL DEFAULT '',
      kbe TEXT NOT NULL DEFAULT '',
      oked TEXT NOT NULL DEFAULT '',
      vat_payer INTEGER NOT NULL DEFAULT 0,
      vat_rate_source TEXT NOT NULL DEFAULT 'product',
      vat_constant_rate TEXT NOT NULL DEFAULT '12%',
      vat_advance_rate TEXT NOT NULL DEFAULT '12/112',
      vat_certificate_number TEXT NOT NULL DEFAULT '',
      vat_certificate_date TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE warehouses (
      id INTEGER PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      name TEXT NOT NULL,
      address TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE bank_accounts (
      id INTEGER PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      counterparty_id INTEGER,
      bik TEXT NOT NULL DEFAULT '',
      bank_name TEXT NOT NULL DEFAULT '',
      bank_address TEXT NOT NULL DEFAULT '',
      corr_account TEXT NOT NULL DEFAULT '',
      account_number TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE products (
      id INTEGER PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      name TEXT NOT NULL,
      code TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'product',
      unit TEXT NOT NULL DEFAULT 'шт',
      purchase_price_tiyin INTEGER NOT NULL DEFAULT 0,
      sale_price_tiyin INTEGER NOT NULL DEFAULT 0,
      vat_rate TEXT NOT NULL DEFAULT '12%',
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE documents (
      id INTEGER PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      number TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      date TEXT NOT NULL DEFAULT CURRENT_DATE,
      warehouse_id INTEGER REFERENCES warehouses(id),
      destination_warehouse_id INTEGER REFERENCES warehouses(id),
      counterparty_id INTEGER,
      vehicle_id INTEGER,
      bank_account_id INTEGER REFERENCES bank_accounts(id),
      payment_method TEXT NOT NULL DEFAULT '',
      total_tiyin INTEGER NOT NULL DEFAULT 0,
      comment TEXT NOT NULL DEFAULT '',
      loss_reason TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE document_lines (
      id INTEGER PRIMARY KEY,
      document_id INTEGER NOT NULL REFERENCES documents(id),
      product_id INTEGER NOT NULL REFERENCES products(id),
      quantity_units INTEGER NOT NULL,
      unit_price_tiyin INTEGER NOT NULL DEFAULT 0,
      discount_bps INTEGER NOT NULL DEFAULT 0,
      vat_rate TEXT NOT NULL DEFAULT '',
      vat_sum_tiyin INTEGER NOT NULL DEFAULT 0,
      total_without_vat_tiyin INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE stock_movements (
      id INTEGER PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      document_id INTEGER NOT NULL REFERENCES documents(id),
      product_id INTEGER NOT NULL REFERENCES products(id),
      warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
      quantity_units INTEGER NOT NULL,
      value_tiyin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE retail_stores (
      id INTEGER PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      name TEXT NOT NULL,
      code TEXT NOT NULL DEFAULT '',
      warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
      active INTEGER NOT NULL DEFAULT 1,
      price_type TEXT NOT NULL DEFAULT 'Цена продажи',
      allow_free_price INTEGER NOT NULL DEFAULT 1,
      allow_discounts INTEGER NOT NULL DEFAULT 1,
      auto_pko_on_shift_close INTEGER NOT NULL DEFAULT 1,
      auto_payment_on_shift_close INTEGER NOT NULL DEFAULT 1,
      card_fee_bps INTEGER NOT NULL DEFAULT 150,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE retail_shifts (
      id INTEGER PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      retail_store_id INTEGER NOT NULL REFERENCES retail_stores(id),
      user_id INTEGER,
      shift_number INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      opened_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      closed_at TEXT,
      cash_start_tiyin INTEGER NOT NULL DEFAULT 0,
      cash_in_tiyin INTEGER NOT NULL DEFAULT 0,
      cash_out_tiyin INTEGER NOT NULL DEFAULT 0,
      revenue_cash_tiyin INTEGER NOT NULL DEFAULT 0,
      revenue_card_tiyin INTEGER NOT NULL DEFAULT 0,
      revenue_total_tiyin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Seed default data
  db.prepare(`INSERT INTO organizations (id, name, legal_name, bin, director, accountant, vat_payer)
    VALUES (1, 'Автосервис «Парк-Лейн»', 'ТОО «Парк-Лейн Моторс»', '210540012345', 'Михаил Юрьевич', 'Елена Сергеевна', 1)`).run();
  db.prepare("INSERT INTO warehouses (id, organization_id, name) VALUES (1, 1, 'Основной склад')").run();
  db.prepare("INSERT INTO settings (key, value) VALUES ('allowNegativeStock', 'false')").run();
  db.prepare("INSERT INTO settings (key, value) VALUES ('numberingScheme', 'yearly')").run();

  db.prepare(`INSERT INTO bank_accounts (id, organization_id, bik, bank_name, account_number, is_default, active)
    VALUES (1, 1, 'KZKOKZ22', 'АО «Halyk Bank»', 'KZ123456789012345678', 1, 1)`).run();

  db.prepare(`INSERT INTO products (id, organization_id, name, code, kind, purchase_price_tiyin, sale_price_tiyin)
    VALUES (1, 1, 'Масло моторное 5W-40 Synt', 'OIL-01', 'product', 250000, 420000)`).run();
  db.prepare(`INSERT INTO products (id, organization_id, name, code, kind, purchase_price_tiyin, sale_price_tiyin)
    VALUES (2, 1, 'Масляный фильтр OC90', 'FILT-01', 'product', 120000, 250000)`).run();

  // Initial stock: 100 liters of oil and 50 filters
  db.prepare(`INSERT INTO documents (id, organization_id, number, kind, status, warehouse_id, total_tiyin)
    VALUES (1, 1, 'ПРИХ-000001', 'receipt', 'posted', 1, 31000000)`).run();
  db.prepare(`INSERT INTO stock_movements (organization_id, document_id, product_id, warehouse_id, quantity_units, value_tiyin)
    VALUES (1, 1, 1, 1, 100000000, 25000000)`).run();
  db.prepare(`INSERT INTO stock_movements (organization_id, document_id, product_id, warehouse_id, quantity_units, value_tiyin)
    VALUES (1, 1, 2, 1, 50000000, 6000000)`).run();

  // Test 1: Organization retrieval
  await t.test("GET Organization returns initialized fields & bank accounts", () => {
    const org = db.prepare("SELECT * FROM organizations WHERE id = 1").get();
    assert.equal(org.name, "Автосервис «Парк-Лейн»");
    assert.equal(org.legal_name, "ТОО «Парк-Лейн Моторс»");
    assert.equal(org.bin, "210540012345");
    assert.equal(org.vat_payer, 1);

    const accounts = db.prepare("SELECT * FROM bank_accounts WHERE organization_id = 1 AND active = 1").all();
    assert.equal(accounts.length, 1);
    assert.equal(accounts[0].is_default, 1);
  });

  // Test 2: Organization patch
  await t.test("PATCH Organization updates fields and settings", () => {
    db.prepare(`UPDATE organizations SET
      phone = '+7 701 555 12 34',
      director_signature_url = 'data:image/png;base64,FAKE_SIG',
      stamp_url = 'data:image/png;base64,FAKE_STAMP'
      WHERE id = 1`).run();

    db.prepare("INSERT INTO settings (key, value) VALUES ('allowNegativeStock', 'true') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
    db.prepare("INSERT INTO settings (key, value) VALUES ('numberingScheme', 'continuous') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();

    const updated = db.prepare("SELECT * FROM organizations WHERE id = 1").get();
    assert.equal(updated.phone, "+7 701 555 12 34");
    assert.equal(updated.director_signature_url, "data:image/png;base64,FAKE_SIG");

    const negStock = db.prepare("SELECT value FROM settings WHERE key = 'allowNegativeStock'").get();
    assert.equal(negStock.value, "true");
  });

  // Test 3: Retail store creation
  let storeId = 0;
  await t.test("Create retail store", () => {
    const ins = db.prepare(`INSERT INTO retail_stores
      (organization_id, name, code, warehouse_id, price_type, auto_pko_on_shift_close, auto_payment_on_shift_close, card_fee_bps)
      VALUES (1, 'Касса экспресс-сервиса (Стол заказов)', 'POS-01', 1, 'Цена продажи', 1, 1, 150)`).run();
    storeId = Number(ins.lastInsertRowid);
    assert.ok(storeId > 0);

    const store = db.prepare("SELECT * FROM retail_stores WHERE id = ?").get(storeId);
    assert.equal(store.name, "Касса экспресс-сервиса (Стол заказов)");
    assert.equal(store.card_fee_bps, 150);
  });

  // Test 4: Shift open & validation
  let shiftId = 0;
  await t.test("Open shift with cash start", () => {
    const ins = db.prepare(`INSERT INTO retail_shifts
      (organization_id, retail_store_id, shift_number, status, cash_start_tiyin)
      VALUES (1, ?, 1, 'open', 1500000)`).run(storeId);
    shiftId = Number(ins.lastInsertRowid);
    assert.ok(shiftId > 0);

    const shift = db.prepare("SELECT * FROM retail_shifts WHERE id = ?").get(shiftId);
    assert.equal(shift.status, "open");
    assert.equal(shift.cash_start_tiyin, 1500000);
  });

  // Test 5: Retail sale (cash + card split)
  await t.test("Execute retail sale and deduct inventory", () => {
    // Sell 4 liters of oil (4200 KZT / L = 16800 KZT) + 1 filter (2500 KZT) = 19300 KZT
    // Split payment: 10 000 KZT cash, 9 300 KZT card
    const saleTotalTiyin = 1930000;
    const cashTiyin = 1000000;
    const cardTiyin = 930000;

    const insDoc = db.prepare(`INSERT INTO documents
      (organization_id, number, kind, status, warehouse_id, total_tiyin, payment_method)
      VALUES (1, 'ЧЕК-000001', 'retailsale', 'posted', 1, ?, 'split')`).run(saleTotalTiyin);
    const docId = Number(insDoc.lastInsertRowid);

    // 4L oil
    db.prepare(`INSERT INTO document_lines
      (document_id, product_id, quantity_units, unit_price_tiyin, vat_rate, vat_sum_tiyin, total_without_vat_tiyin, position)
      VALUES (?, 1, 4000000, 420000, '12%', 180000, 1500000, 1)`).run(docId);
    db.prepare(`INSERT INTO stock_movements
      (organization_id, document_id, product_id, warehouse_id, quantity_units, value_tiyin)
      VALUES (1, ?, 1, 1, -4000000, -1000000)`).run(docId);

    // 1 filter
    db.prepare(`INSERT INTO document_lines
      (document_id, product_id, quantity_units, unit_price_tiyin, vat_rate, vat_sum_tiyin, total_without_vat_tiyin, position)
      VALUES (?, 2, 1000000, 250000, '12%', 26786, 223214, 2)`).run(docId);
    db.prepare(`INSERT INTO stock_movements
      (organization_id, document_id, product_id, warehouse_id, quantity_units, value_tiyin)
      VALUES (1, ?, 2, 1, -1000000, -120000)`).run(docId);

    // Update shift totals
    db.prepare(`UPDATE retail_shifts SET
      revenue_cash_tiyin = revenue_cash_tiyin + ?,
      revenue_card_tiyin = revenue_card_tiyin + ?,
      revenue_total_tiyin = revenue_total_tiyin + ?
      WHERE id = ?`).run(cashTiyin, cardTiyin, saleTotalTiyin, shiftId);

    // Check remaining stock
    const oilStock = db.prepare("SELECT SUM(quantity_units) AS q FROM stock_movements WHERE product_id = 1").get();
    assert.equal(oilStock.q, 96000000); // 100 - 4 = 96 L

    const filterStock = db.prepare("SELECT SUM(quantity_units) AS q FROM stock_movements WHERE product_id = 2").get();
    assert.equal(filterStock.q, 49000000); // 50 - 1 = 49 pcs

    const shift = db.prepare("SELECT * FROM retail_shifts WHERE id = ?").get(shiftId);
    assert.equal(shift.revenue_cash_tiyin, 1000000);
    assert.equal(shift.revenue_card_tiyin, 930000);
    assert.equal(shift.revenue_total_tiyin, 1930000);
  });

  // Test 6: Shift close and auto PKO + incoming payment
  await t.test("Close shift generates auto PKO and incoming payment", () => {
    const shift = db.prepare("SELECT * FROM retail_shifts WHERE id = ?").get(shiftId);
    const store = db.prepare("SELECT * FROM retail_stores WHERE id = ?").get(shift.retail_store_id);

    db.prepare("UPDATE retail_shifts SET status = 'closed', closed_at = CURRENT_TIMESTAMP WHERE id = ?").run(shiftId);

    // Auto PKO
    if (store.auto_pko_on_shift_close && shift.revenue_cash_tiyin > 0) {
      db.prepare(`INSERT INTO documents (organization_id, number, kind, status, total_tiyin, comment)
        VALUES (1, 'ПКО-000001', 'cash_in', 'posted', ?, 'Авто-ПКО')`).run(shift.revenue_cash_tiyin);
    }

    // Auto Incoming Payment
    if (store.auto_payment_on_shift_close && shift.revenue_card_tiyin > 0) {
      const feeTiyin = Math.round(shift.revenue_card_tiyin * store.card_fee_bps / 10000);
      const net = shift.revenue_card_tiyin - feeTiyin;
      db.prepare(`INSERT INTO documents (organization_id, number, kind, status, total_tiyin, comment)
        VALUES (1, 'ВХП-000001', 'incoming_payment', 'posted', ?, 'Безналичная выручка')`).run(net);
    }

    const closedShift = db.prepare("SELECT * FROM retail_shifts WHERE id = ?").get(shiftId);
    assert.equal(closedShift.status, "closed");
    assert.ok(closedShift.closed_at);

    const pko = db.prepare("SELECT * FROM documents WHERE kind = 'cash_in'").get();
    assert.ok(pko);
    assert.equal(pko.total_tiyin, 1000000);

    const payment = db.prepare("SELECT * FROM documents WHERE kind = 'incoming_payment'").get();
    assert.ok(payment);
    // 930 000 - 1.5% (13950) = 916050
    assert.equal(payment.total_tiyin, 916050);
  });

  // Test 7: Database integrity
  await t.test("Database integrity and foreign keys are valid", () => {
    const integrity = db.pragma("integrity_check");
    assert.equal(integrity[0].integrity_check, "ok");

    const fkViolations = db.pragma("foreign_key_check");
    assert.equal(fkViolations.length, 0);
  });
});
