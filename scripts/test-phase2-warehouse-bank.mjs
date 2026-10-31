import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { scryptSync, randomBytes } from "node:crypto";
import Database from "better-sqlite3";

const testDir = path.resolve(".tmp-warehouse-bank-test");
fs.rmSync(testDir, { recursive: true, force: true });
fs.mkdirSync(testDir, { recursive: true });

const testDbPath = path.join(testDir, "test.sqlite");
const origDbPath = path.resolve("data/moysklad.sqlite");
if (fs.existsSync(origDbPath)) {
  fs.copyFileSync(origDbPath, testDbPath);
}

// Seed test owner into test database directly
const dbInit = new Database(testDbPath);
const scryptOptions = { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const salt = randomBytes(16);
const hash = scryptSync("Password123456!", salt, 64, scryptOptions);
const passwordHash = `scrypt$${scryptOptions.N}$${scryptOptions.r}$${scryptOptions.p}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
dbInit.prepare(`
  INSERT INTO users (organization_id, login, full_name, role, active, must_change_password, password_hash)
  VALUES (1, 'test.owner', 'Test Owner', 'owner', 1, 0, ?)
  ON CONFLICT(organization_id, login) DO UPDATE SET password_hash = excluded.password_hash, active = 1, must_change_password = 0
`).run(passwordHash);
dbInit.close();

const testPort = 4325;
const testSetupToken = "test-token-warehouse-bank-2026";

console.log("Starting server on port", testPort, "with DB_PATH", testDbPath);

const serverProcess = spawn(
  process.execPath,
  ["node_modules/tsx/dist/cli.mjs", "server/index.ts"],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(testPort),
      API_PORT: String(testPort),
      SETUP_TOKEN: testSetupToken,
      DB_PATH: testDbPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  }
);

let serverOutput = "";
serverProcess.stdout.on("data", (chunk) => {
  serverOutput += chunk.toString();
});
serverProcess.stderr.on("data", (chunk) => {
  serverOutput += chunk.toString();
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForServer() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${testPort}/api/health`);
      if (res.ok) {
        console.log("Server is ready!");
        return true;
      }
    } catch {}
    await sleep(250);
  }
  console.error("Server output:\n", serverOutput);
  throw new Error("Server failed to start");
}

let sessionCookie = "";

async function api(endpoint, options = {}) {
  const url = `http://127.0.0.1:${testPort}${endpoint}`;
  const headers = {
    "content-type": "application/json",
    ...(options.headers || {}),
  };
  if (sessionCookie) {
    headers["cookie"] = sessionCookie;
  }
  const res = await fetch(url, { ...options, headers });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  if (res.headers.has("set-cookie")) {
    sessionCookie = res.headers.get("set-cookie").split(";")[0];
  }
  return { status: res.status, ok: res.ok, json, text };
}

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

async function runTests() {
  try {
    await waitForServer();

    // 1. Login as seeded owner
    console.log("\n--- Auth Login ---");
    const loginRes = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        login: "test.owner",
        password: "Password123456!",
      }),
    });
    assert(loginRes.ok, "Logged in as owner");

    // 2. Prepare master data: counterparty and warehouses
    console.log("\n--- Master Data Setup ---");
    const cpRes = await api("/api/counterparties", {
      method: "POST",
      body: JSON.stringify({
        name: "ТОО Тестовый Контрагент",
        kind: "both",
        phone: "+77010001122",
      }),
    });
    assert(cpRes.status === 201, "Created counterparty");
    const cpId = cpRes.json.id;

    // Create a secondary warehouse
    const whRes = await api("/api/warehouses", {
      method: "POST",
      body: JSON.stringify({
        name: "Склад №2 (Запасной)",
        code: `WH-2-${Date.now()}`,
      }),
    });
    assert(whRes.status === 201 || whRes.status === 200, "Created secondary warehouse");
    const wh2Id = whRes.json.id;

    // Create a product
    const prodRes = await api("/api/products", {
      method: "POST",
      body: JSON.stringify({
        name: "Масло моторное 5W-40 4л",
        code: `OIL-${Date.now()}`,
        kind: "product",
        unit: "шт",
        purchasePrice: "10000.00",
        salePrice: "15000.00",
      }),
    });
    assert(prodRes.status === 201, "Created product");
    const prodId = prodRes.json.id;

    // 3. Bank Accounts Tests
    console.log("\n--- Bank Accounts Tests ---");
    // Organization Bank Account
    const orgBa1 = await api("/api/organization/bank-accounts", {
      method: "POST",
      body: JSON.stringify({
        accountNumber: "KZ111111111111111111",
        bik: "KZKOKZ22",
        bankName: "Kaspi Bank",
        isDefault: true,
      }),
    });
    assert(orgBa1.status === 201 && orgBa1.json.is_default === 1, "Created default org bank account");
    const orgBa1Id = orgBa1.json.id;

    const orgBa2 = await api("/api/organization/bank-accounts", {
      method: "POST",
      body: JSON.stringify({
        accountNumber: "KZ222222222222222222",
        bik: "HABAKZ22",
        bankName: "Halyk Bank",
        isDefault: false,
      }),
    });
    assert(orgBa2.status === 201 && orgBa2.json.is_default === 0, "Created second non-default org bank account");
    const orgBa2Id = orgBa2.json.id;

    const orgBaList = await api("/api/organization/bank-accounts");
    assert(orgBaList.ok && orgBaList.json.length >= 2, "Fetched org bank accounts list");
    assert(orgBaList.json[0].id === orgBa1Id && orgBaList.json[0].is_default === 1, "Default org account is first");

    // Counterparty Bank Accounts
    const cpBa1 = await api(`/api/counterparties/${cpId}/bank-accounts`, {
      method: "POST",
      body: JSON.stringify({
        accountNumber: "KZ333333333333333333",
        bik: "BCCKZK22",
        bankName: "Банк ЦентрКредит",
        isDefault: true,
      }),
    });
    assert(cpBa1.status === 201 && cpBa1.json.is_default === 1, "Created default counterparty bank account");
    const cpBa1Id = cpBa1.json.id;

    const cpBa2 = await api(`/api/counterparties/${cpId}/bank-accounts`, {
      method: "POST",
      body: JSON.stringify({
        accountNumber: "KZ444444444444444444",
        bik: "FORTEKZ22",
        bankName: "ForteBank",
        isDefault: true, // Should set this to default and unset cpBa1
      }),
    });
    assert(cpBa2.status === 201 && cpBa2.json.is_default === 1, "Created second counterparty bank account as default");
    const cpBa2Id = cpBa2.json.id;

    // Verify cpBa1 is no longer default
    const cpBa1Refetched = await api(`/api/bank-accounts/${cpBa1Id}`);
    assert(cpBa1Refetched.json.is_default === 0, "Previous counterparty bank account is no longer default");

    // Patch bank account
    const patchBa = await api(`/api/bank-accounts/${cpBa1Id}`, {
      method: "PATCH",
      body: JSON.stringify({
        bankName: "Банк ЦентрКредит Обновлен",
        isDefault: true,
      }),
    });
    assert(patchBa.json.bank_name === "Банк ЦентрКредит Обновлен" && patchBa.json.is_default === 1, "Patched bank account default switch");

    // Check counterparty GET includes bankAccounts
    const cpDetails = await api(`/api/counterparties/${cpId}`);
    assert(Array.isArray(cpDetails.json.bankAccounts) && cpDetails.json.bankAccounts.length === 2, "GET /api/counterparties/:id returns bankAccounts array");

    // Delete unreferenced bank account
    const delBa = await api(`/api/bank-accounts/${orgBa2Id}`, { method: "DELETE" });
    assert(delBa.json.ok === true, "Deleted unreferenced bank account");

    // 4. Warehouse Documents: Enter (Surplus / Stock-in)
    console.log("\n--- Warehouse: Enter (Surplus / Stock In) ---");
    const enterDoc = await api("/api/documents", {
      method: "POST",
      body: JSON.stringify({
        kind: "enter",
        warehouseId: 1,
        comment: "Первоначальное оприходование излишков",
        bankAccountId: orgBa1Id,
        lines: [
          {
            productId: prodId,
            quantity: "10.000",
            price: "10000.00",
          },
        ],
      }),
    });
    assert(enterDoc.status === 201 && enterDoc.json.kind === "enter", "Created enter (surplus) document");
    const enterId = enterDoc.json.id;

    // Post enter doc
    const postEnter = await api(`/api/documents/${enterId}/post`, { method: "POST" });
    assert(postEnter.ok && postEnter.json.status === "posted", "Posted enter document");

    // Verify stock at warehouse 1 has increased
    const stock1 = await api(`/api/stock?warehouseId=1`);
    const stockRow1 = stock1.json.find((s) => s.product_id === prodId && s.warehouse_id === 1);
    assert(stockRow1 && stockRow1.stock_units >= 10_000_000, "Warehouse 1 stock increased with enter document");

    // 5. Warehouse Documents: Transfer (Move)
    console.log("\n--- Warehouse: Transfer (Move) ---");
    const transferDoc = await api("/api/documents", {
      method: "POST",
      body: JSON.stringify({
        kind: "move", // testing alias
        warehouseId: 1,
        destinationWarehouseId: wh2Id,
        comment: "Перемещение 3 шт на склад №2",
        lines: [
          {
            productId: prodId,
            quantity: "3.000",
            price: "10000.00",
          },
        ],
      }),
    });
    assert(transferDoc.status === 201 && transferDoc.json.kind === "transfer", "Created transfer document via 'move' alias");
    const transferId = transferDoc.json.id;

    // Post transfer
    const postTransfer = await api(`/api/documents/${transferId}/post`, { method: "POST" });
    assert(postTransfer.ok && postTransfer.json.status === "posted", "Posted transfer document");

    // Verify stock balances
    const stockAfterTransfer = await api(`/api/stock`);
    const wh2Row = stockAfterTransfer.json.find((s) => s.product_id === prodId && s.warehouse_id === wh2Id);
    assert(wh2Row && wh2Row.stock_units === 3_000_000, "Receiver warehouse stock increased to 3 units");

    // 6. Warehouse Documents: Write-off (Loss)
    console.log("\n--- Warehouse: Writeoff (Loss) ---");
    const writeoffDoc = await api("/api/documents", {
      method: "POST",
      body: JSON.stringify({
        kind: "loss", // testing alias
        warehouseId: 1,
        lossReason: "Повреждение при погрузке",
        comment: "Списание брака",
        lines: [
          {
            productId: prodId,
            quantity: "2.000",
            price: "10000.00",
          },
        ],
      }),
    });
    assert(writeoffDoc.status === 201 && writeoffDoc.json.kind === "writeoff", "Created writeoff document via 'loss' alias");
    const writeoffId = writeoffDoc.json.id;

    // Verify loss_reason persisted
    const writeoffGet = await api(`/api/documents/${writeoffId}`);
    assert(writeoffGet.json.loss_reason === "Повреждение при погрузке", "loss_reason persisted in documents table");

    // Post writeoff
    const postWriteoff = await api(`/api/documents/${writeoffId}/post`, { method: "POST" });
    assert(postWriteoff.ok && postWriteoff.json.status === "posted", "Posted writeoff document");

    // Verify total_tiyin recorded into financial loss
    const writeoffPosted = await api(`/api/documents/${writeoffId}`);
    assert(writeoffPosted.json.total_tiyin === 2000000, "Financial loss total_tiyin recorded correctly (20 000 KZT)");

    // 7. Warehouse Documents: Inventory (Stocktake)
    console.log("\n--- Warehouse: Stocktake (Inventory) ---");
    // Product 2
    const prod2Res = await api("/api/products", {
      method: "POST",
      body: JSON.stringify({
        name: "Фильтр масляный",
        code: `FLT-${Date.now()}`,
        kind: "product",
        unit: "шт",
        purchasePrice: "3000.00",
        salePrice: "5000.00",
      }),
    });
    const prod2Id = prod2Res.json.id;

    // Enter 4 filters first
    const enterFilters = await api("/api/documents", {
      method: "POST",
      body: JSON.stringify({
        kind: "enter",
        warehouseId: 1,
        lines: [{ productId: prod2Id, quantity: "4.000", price: "3000.00" }],
      }),
    });
    await api(`/api/documents/${enterFilters.json.id}/post`, { method: "POST" });

    // Fetch current balance of prodId on warehouse 1
    const currentStockWh1 = await api(`/api/stock?warehouseId=1`);
    const currentOilStock = currentStockWh1.json.find((s) => s.product_id === prodId && s.warehouse_id === 1)?.stock_units ?? 0;

    // Create stocktake with:
    // - prodId: actual is current + 2 units (surplus: +2)
    // - prod2Id: actual is 1 unit (deficit: -3)
    // Notice we do NOT supply accounting_quantity: server should auto-detect from stock balance!
    const stocktakeDoc = await api("/api/documents", {
      method: "POST",
      body: JSON.stringify({
        kind: "inventory", // testing alias
        warehouseId: 1,
        comment: "Плановая инвентаризация склада №1",
        lines: [
          {
            productId: prodId,
            actualQuantity: String((currentOilStock + 2_000_000) / 1_000_000),
            cost: "10000.00",
          },
          {
            productId: prod2Id,
            actualQuantity: "1.000",
            cost: "3000.00",
          },
        ],
      }),
    });
    assert(stocktakeDoc.status === 201 && stocktakeDoc.json.kind === "stocktake", "Created stocktake document via 'inventory' alias");
    const stocktakeId = stocktakeDoc.json.id;

    // Check lines of stocktake
    const stocktakeGet = await api(`/api/documents/${stocktakeId}`);
    const lineOil = stocktakeGet.json.lines.find((l) => l.product_id === prodId);
    const lineFilter = stocktakeGet.json.lines.find((l) => l.product_id === prod2Id);

    assert(lineOil && lineOil.accounting_quantity === currentOilStock, "Oil accounting quantity auto-populated from stock");
    assert(lineOil && lineOil.difference_quantity === 2_000_000, "Oil difference quantity is +2 units (surplus)");

    assert(lineFilter && lineFilter.accounting_quantity === 4_000_000, "Filter accounting quantity auto-populated to 4 units");
    assert(lineFilter && lineFilter.actual_quantity === 1_000_000, "Filter actual quantity is 1 unit");
    assert(lineFilter && lineFilter.difference_quantity === -3_000_000, "Filter difference quantity is -3 units (deficit)");

    // 8. Child Document Creation from Stocktake:
    console.log("\n--- Stocktake: Child Document Creation (Enter & Writeoff) ---");
    // A) Create Enter (surplus) child document
    const childEnter = await api(`/api/documents/${stocktakeId}/create-child`, {
      method: "POST",
      body: JSON.stringify({ kind: "enter" }),
    });
    assert(childEnter.status === 201 && childEnter.json.kind === "enter", "Generated surplus enter document from stocktake");
    assert(childEnter.json.relationType === "stocktake_to_enter", "Relation type is stocktake_to_enter");

    const childEnterDetails = await api(`/api/documents/${childEnter.json.id}`);
    assert(childEnterDetails.json.lines.length === 1, "Enter has exactly 1 surplus position");
    assert(childEnterDetails.json.lines[0].product_id === prodId && childEnterDetails.json.lines[0].quantity_units === 2_000_000, "Enter has 2 units of surplus Oil");

    // B) Create Writeoff (deficit) child document
    const childWriteoff = await api(`/api/documents/${stocktakeId}/create-child`, {
      method: "POST",
      body: JSON.stringify({ kind: "writeoff" }),
    });
    assert(childWriteoff.status === 201 && childWriteoff.json.kind === "writeoff", "Generated deficit writeoff document from stocktake");
    assert(childWriteoff.json.relationType === "stocktake_to_writeoff", "Relation type is stocktake_to_writeoff");

    const childWriteoffDetails = await api(`/api/documents/${childWriteoff.json.id}`);
    assert(childWriteoffDetails.json.lines.length === 1, "Writeoff has exactly 1 deficit position");
    assert(childWriteoffDetails.json.lines[0].product_id === prod2Id && childWriteoffDetails.json.lines[0].quantity_units === 3_000_000, "Writeoff has 3 units of deficit Filter");
    assert(childWriteoffDetails.json.loss_reason === "Недостача при инвентаризации", "Writeoff automatically got loss_reason 'Недостача при инвентаризации'");

    // C) Verify document chain includes stocktake and its children
    const chainRes = await api(`/api/documents/${stocktakeId}/chain`);
    assert(chainRes.ok && chainRes.json.chain.length >= 3, "Connected chain includes stocktake, child enter, and child writeoff");

    // Post child documents to bring warehouse to counted physical state
    const postChildEnter = await api(`/api/documents/${childEnter.json.id}/post`, { method: "POST" });
    assert(postChildEnter.ok, "Posted child enter document");
    const postChildWriteoff = await api(`/api/documents/${childWriteoff.json.id}/post`, { method: "POST" });
    assert(postChildWriteoff.ok, "Posted child writeoff document");

    // Verify final warehouse stock matches counted actual quantities:
    const finalStock = await api(`/api/stock?warehouseId=1`);
    const finalOil = finalStock.json.find((s) => s.product_id === prodId && s.warehouse_id === 1);
    const finalFilter = finalStock.json.find((s) => s.product_id === prod2Id && s.warehouse_id === 1);
    assert(finalOil && finalOil.stock_units === currentOilStock + 2_000_000, "Final Oil stock on warehouse 1 matches counted actual quantity");
    assert(finalFilter && finalFilter.stock_units === 1_000_000, "Final Filter stock on warehouse 1 is exactly 1 unit (counted)");

    // 9. Database Integrity
    console.log("\n--- Database Integrity & Migrations Check ---");
    serverProcess.kill("SIGTERM");
    await sleep(500);

    const db = new Database(testDbPath);
    const integrity = db.pragma("integrity_check");
    assert(integrity[0]?.integrity_check === "ok", "PRAGMA integrity_check is ok");

    const fkCheck = db.pragma("foreign_key_check");
    assert(fkCheck.length === 0, "PRAGMA foreign_key_check has 0 violations");
    db.close();

    console.log(`\n========================================`);
    console.log(`TOTAL: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
    console.log(`========================================\n`);

    if (failed > 0) {
      process.exit(1);
    }
  } finally {
    try {
      serverProcess.kill("SIGTERM");
    } catch {}
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {}
  }
}

runTests().catch((err) => {
  console.error("Test error:", err);
  serverProcess.kill("SIGTERM");
  process.exit(1);
});
