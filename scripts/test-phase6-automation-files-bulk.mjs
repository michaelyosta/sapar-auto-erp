import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import express from "express";
import http from "node:http";
import { initializeAutomationSchema, registerAutomationRoutes, executeAutomationRules } from "../server/automation.js";
import { initializeFilesSchema, registerFilesRoutes } from "../server/files.js";

test("Phase 6 - Automation Scenarios, Files Storage & Bulk Operations", async () => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE organizations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, currency TEXT NOT NULL DEFAULT 'KZT');
    INSERT INTO organizations (id, name) VALUES (1, 'Автокомплекс ТОО "Сапар"');

    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      login TEXT NOT NULL UNIQUE,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'employee'
    );
    INSERT INTO users (id, organization_id, login, full_name, role) VALUES (1, 1, 'admin', 'Администратор', 'owner');

    CREATE TABLE counterparties (
      id INTEGER PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      name TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'customer'
    );
    INSERT INTO counterparties (id, organization_id, name, phone) VALUES (1, 1, 'ИП Аскаров', '+77017778899');

    CREATE TABLE vehicles (
      id INTEGER PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      counterparty_id INTEGER NOT NULL REFERENCES counterparties(id),
      plate TEXT NOT NULL,
      make TEXT NOT NULL,
      model TEXT NOT NULL,
      current_mileage INTEGER NOT NULL DEFAULT 50000
    );
    INSERT INTO vehicles (id, organization_id, counterparty_id, plate, make, model) VALUES
      (1, 1, 1, '010AAA01', 'Toyota', 'Camry');

    CREATE TABLE warehouses (
      id INTEGER PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      name TEXT NOT NULL
    );
    INSERT INTO warehouses (id, organization_id, name) VALUES (1, 1, 'Центральный склад');

    CREATE TABLE products (
      id INTEGER PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      unit TEXT NOT NULL DEFAULT 'шт'
    );
    INSERT INTO products (id, organization_id, code, name) VALUES (1, 1, 'OIL-5W40', 'Моторное масло 5W-40');

    CREATE TABLE documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      number TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      status_name TEXT NOT NULL DEFAULT 'Новый',
      date TEXT NOT NULL,
      counterparty_id INTEGER REFERENCES counterparties(id),
      vehicle_id INTEGER REFERENCES vehicles(id),
      warehouse_id INTEGER REFERENCES warehouses(id),
      total_tiyin INTEGER NOT NULL DEFAULT 0,
      next_service_km INTEGER,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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

  initializeAutomationSchema(db);
  initializeFilesSchema(db);

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.auth = {
      userId: 1,
      organizationId: 1,
      login: "admin",
      fullName: "Администратор",
      role: "owner"
    };
    next();
  });

  const recordAuditMock = (entityType, entityId, action, detail, orgId = 1) => {
    db.prepare("INSERT INTO audit_log (organization_id, entity_type, entity_id, action, detail) VALUES (?, ?, ?, ?, ?)")
      .run(orgId, entityType, entityId, action, detail || "");
  };

  registerAutomationRoutes(app, db, recordAuditMock);
  registerFilesRoutes(app, db, recordAuditMock);

  // Bulk status endpoint
  app.post("/api/documents/bulk-status", (req, res) => {
    const { ids, statusName, action } = req.body;
    let modified = 0;
    db.transaction(() => {
      for (const id of ids) {
        if (action === "post") {
          db.prepare("UPDATE documents SET status = 'posted' WHERE id = ?").run(id);
          executeAutomationRules(db, { orgId: 1, triggerType: "doc_status_change", docId: id });
          modified++;
        } else if (action === "unpost") {
          db.prepare("UPDATE documents SET status = 'draft' WHERE id = ?").run(id);
          modified++;
        } else if (statusName) {
          db.prepare("UPDATE documents SET status_name = ? WHERE id = ?").run(statusName, id);
          executeAutomationRules(db, { orgId: 1, triggerType: "doc_status_change", docId: id });
          modified++;
        }
      }
    })();
    res.json({ ok: true, count: modified });
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Verify default seed automation rules
    const rulesRes = await fetch(`${baseUrl}/api/automation/rules`);
    assert.equal(rulesRes.status, 200);
    const rules = await rulesRes.json();
    assert.ok(rules.length >= 3, "Expected at least 3 seed automation rules");
    assert.ok(rules.some(r => r.name.includes("SMS-оповещение")));

    // 2. Insert test work orders
    const docId1 = db.prepare(`
      INSERT INTO documents (organization_id, number, kind, status, status_name, date, counterparty_id, vehicle_id, warehouse_id, total_tiyin, next_service_km)
      VALUES (1, 'ЗН-101', 'work_order', 'draft', 'Новый', '2026-10-31', 1, 1, 1, 2500000, 60000)
    `).run().lastInsertRowid;

    const docId2 = db.prepare(`
      INSERT INTO documents (organization_id, number, kind, status, status_name, date, counterparty_id, vehicle_id, warehouse_id, total_tiyin, next_service_km)
      VALUES (1, 'ЗН-102', 'work_order', 'draft', 'Новый', '2026-10-31', 1, 1, 1, 4800000, 65000)
    `).run().lastInsertRowid;

    // 3. Test bulk status change to 'Готов' and verify automation trigger fires
    const bulkRes = await fetch(`${baseUrl}/api/documents/bulk-status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ids: [Number(docId1), Number(docId2)],
        statusName: "Готов"
      })
    });
    assert.equal(bulkRes.status, 200);
    const bulkData = await bulkRes.json();
    assert.equal(bulkData.count, 2);

    // Verify automation execution logs
    const logsRes = await fetch(`${baseUrl}/api/automation/logs`);
    assert.equal(logsRes.status, 200);
    const logs = await logsRes.json();
    assert.ok(logs.length >= 2, "Expected automation logs for the 2 work orders");
    assert.ok(logs.some(l => l.action_summary.includes("SMS отправлено")));

    // 4. Test manual trigger / test run on a rule
    const testRunRes = await fetch(`${baseUrl}/api/automation/rules/${rules[0].id}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documentId: Number(docId1) })
    });
    assert.equal(testRunRes.status, 200);
    const testRunData = await testRunRes.json();
    assert.ok(testRunData.ok);

    // 5. Test Files Module
    const filesRes = await fetch(`${baseUrl}/api/files`);
    assert.equal(filesRes.status, 200);
    const filesData = await filesRes.json();
    assert.ok(filesData.files.length >= 4, "Expected seed files");
    assert.ok(filesData.quota.totalBytesUsed > 0);

    // Upload a new file
    const uploadRes = await fetch(`${baseUrl}/api/files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Диагностическая_карта_ТО.pdf",
        category: "act",
        mimeType: "application/pdf",
        base64Data: Buffer.from("DIAGNOSTIC_CARD_SAMPLE").toString("base64"),
        entityType: "document",
        entityId: Number(docId1)
      })
    });
    assert.equal(uploadRes.status, 201);
    const uploadedFile = await uploadRes.json();
    assert.equal(uploadedFile.name, "Диагностическая_карта_ТО.pdf");

    // Download file
    const downloadRes = await fetch(`${baseUrl}/api/files/${uploadedFile.id}/download`);
    assert.equal(downloadRes.status, 200);
    const downloadedText = await downloadRes.text();
    assert.equal(downloadedText, "DIAGNOSTIC_CARD_SAMPLE");

    // Delete file
    const deleteFileRes = await fetch(`${baseUrl}/api/files/${uploadedFile.id}`, { method: "DELETE" });
    assert.equal(deleteFileRes.status, 200);

    // 6. Database Integrity Check
    const pragmaCheck = db.prepare("PRAGMA integrity_check").get();
    assert.equal(pragmaCheck.integrity_check, "ok");

    console.log("✔ Phase 6 All Tests Passed Successfully!");
  } finally {
    server.close();
  }
});
