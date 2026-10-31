import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { randomBytes, scryptSync } from "node:crypto";
import Database from "better-sqlite3";

const testDir = path.resolve(`.tmp-department-scope-${process.pid}-${Date.now()}`);
fs.mkdirSync(testDir, { recursive: true });
const testDbPath = path.join(testDir, "test.sqlite");
const source = new Database(path.resolve("data/moysklad.sqlite"), { readonly: true });
await source.backup(testDbPath);
source.close();

const password = "DepartmentScope!2026";
const options = { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const salt = randomBytes(16);
const hash = scryptSync(password, salt, 64, options);
const passwordHash = `scrypt$${options.N}$${options.r}$${options.p}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
const seed = new Database(testDbPath);
seed.prepare(`INSERT INTO users (organization_id, login, full_name, role, active, must_change_password, password_hash)
  VALUES (1, 'qa.scope.owner', 'Department Scope QA', 'owner', 1, 0, ?)
  ON CONFLICT(organization_id, login) DO UPDATE SET password_hash = excluded.password_hash, active = 1, must_change_password = 0`).run(passwordHash);
seed.prepare(`INSERT INTO users (organization_id, login, full_name, role, active, must_change_password, password_hash)
  VALUES (1, 'qa.scope.legacy', 'Legacy Employee', 'employee', 1, 0, ?)
  ON CONFLICT(organization_id, login) DO UPDATE SET password_hash = excluded.password_hash, active = 1, must_change_password = 0`).run(passwordHash);
seed.prepare(`INSERT INTO users (organization_id, login, full_name, role, active, must_change_password, password_hash)
  VALUES (1, 'qa.scope.inactive', 'Inactive Legacy Employee', 'employee', 0, 0, ?)
  ON CONFLICT(organization_id, login) DO UPDATE SET password_hash = excluded.password_hash, active = 0, must_change_password = 0`).run(passwordHash);
seed.close();

const port = await new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", () => {
    const address = probe.address();
    probe.close(() => resolve(address.port));
  });
});

let serverOutput = "";
const server = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "server/index.ts"], {
  cwd: process.cwd(),
  env: { ...process.env, API_PORT: String(port), DB_PATH: testDbPath, SETUP_TOKEN: "qa-scope-token" },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", (chunk) => { serverOutput += chunk.toString(); });
server.stderr.on("data", (chunk) => { serverOutput += chunk.toString(); });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (condition, message) => {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`✓ ${message}`);
};
const api = async (cookie, route, options = {}) => {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    ...options,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...(options.headers ?? {}) },
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch {}
  return { status: response.status, body, setCookie: response.headers.get("set-cookie"), text };
};
const json = (value) => JSON.stringify(value);

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return; } catch {}
    await sleep(200);
  }
  throw new Error(`Server failed to start:\n${serverOutput}`);
}

async function login(loginName, loginPassword = password) {
  const result = await api("", "/api/auth/login", { method: "POST", body: json({ login: loginName, password: loginPassword }) });
  assert(result.status === 200 && result.setCookie, `logs in ${loginName}`);
  return result.setCookie.split(";")[0];
}

try {
  await waitForServer();
  const owner = await login("qa.scope.owner");

  const departments = await api(owner, "/api/departments");
  assert(departments.status === 200 && departments.body.length >= 1, "startup creates and lists the default salon");
  const departmentA = departments.body.find((item) => item.name === "Основной салон") ?? departments.body[0];
  const usersBefore = await api(owner, "/api/auth/users");
  const migratedEmployee = usersBefore.body.find((user) => user.login === "qa.scope.legacy");
  assert(migratedEmployee?.department_ids?.includes(departmentA.id), "existing employees are mapped to the sole initial salon during migration");
  const inactiveLegacy = usersBefore.body.find((user) => user.login === "qa.scope.inactive");
  const reactivateUnassigned = await api(owner, `/api/auth/users/${inactiveLegacy.id}`, { method: "PATCH", body: json({ active: 1 }) });
  assert(inactiveLegacy?.department_ids?.length === 0 && reactivateUnassigned.status === 400, "inactive legacy employee gets no automatic salon and cannot reactivate without an assignment");
  const departmentB = await api(owner, "/api/departments", { method: "POST", body: json({ name: `QA Салон ${Date.now()}` }) });
  assert(departmentB.status === 201, "owner can create a second salon");

  const adminUser = await api(owner, "/api/auth/users", { method: "POST", body: json({
    login: `qa.scope.admin.${Date.now()}`, fullName: "QA Admin", role: "admin", temporaryPassword: password,
  }) });
  assert(adminUser.status === 201, "owner can create an administrator without a salon restriction");
  const preparedAdmin = await api(owner, `/api/auth/users/${adminUser.body.id}`, { method: "PATCH", body: json({ departmentIds: [departmentA.id] }) });
  const downgradedAdmin = await api(owner, `/api/auth/users/${adminUser.body.id}`, { method: "PATCH", body: json({ role: "manager" }) });
  assert(preparedAdmin.status === 200 && downgradedAdmin.status === 200 && downgradedAdmin.body.department_ids.includes(departmentA.id), "owner can prepare department access and then safely downgrade an administrator");

  const warehouses = await api(owner, "/api/warehouses");
  assert(warehouses.status === 200 && warehouses.body.length > 0, "legacy warehouse is mapped into the default salon");
  const warehouseA = warehouses.body.find((item) => item.department_id === departmentA.id) ?? warehouses.body[0];
  const warehouseB = await api(owner, "/api/warehouses", { method: "POST", body: json({ name: "QA склад салона B", code: `QAS-${Date.now()}`, departmentId: departmentB.body.id }) });
  assert(warehouseB.status === 201 && warehouseB.body.department_id === departmentB.body.id, "new warehouse is assigned to its salon");
  const lastWarehouseArchive = await api(owner, `/api/warehouses/${warehouseB.body.id}`, { method: "PATCH", body: json({ active: false }) });
  assert(lastWarehouseArchive.status === 400 && lastWarehouseArchive.body.error.includes("последний активный склад этого подразделения"), "cannot archive the last active warehouse of a salon");
  const userA = await api(owner, "/api/auth/users", { method: "POST", body: json({
    login: `qa.scope.a.${Date.now()}`, fullName: "QA Salon A", role: "employee", temporaryPassword: password, departmentIds: [departmentA.id],
  }) });
  assert(userA.status === 201 && userA.body.department_ids.includes(departmentA.id), "employee creation stores an explicit salon assignment");
  const userB = await api(owner, "/api/auth/users", { method: "POST", body: json({
    login: `qa.scope.b.${Date.now()}`, fullName: "QA Salon B", role: "employee", temporaryPassword: password, departmentIds: [departmentB.body.id],
  }) });
  assert(userB.status === 201, "second employee is assigned to another salon");
  const managerA = await api(owner, "/api/auth/users", { method: "POST", body: json({
    login: `qa.scope.manager.${Date.now()}`, fullName: "QA Salon Manager", role: "manager", temporaryPassword: password, departmentIds: [departmentA.id],
  }) });
  assert(managerA.status === 201, "manager is assigned to one salon");
  const managerB = await api(owner, "/api/auth/users", { method: "POST", body: json({
    login: `qa.scope.manager.b.${Date.now()}`, fullName: "QA Salon B Manager", role: "manager", temporaryPassword: password, departmentIds: [departmentB.body.id],
  }) });
  assert(managerB.status === 201, "second salon manager is assigned to salon B");
  const soleAssignedArchive = await api(owner, `/api/departments/${departmentB.body.id}`, { method: "PATCH", body: json({ active: false }) });
  assert(soleAssignedArchive.status === 400 && soleAssignedArchive.body.error.includes("назначьте сотрудников"), "cannot archive a salon while an employee would lose all active salon access");
  let managerCookie = "";
  let managerBCookie = "";
  for (const user of [userA.body, userB.body, managerA.body, managerB.body]) {
    const temporarySession = await login(user.login);
    const changePassword = await api(temporarySession, "/api/auth/password", { method: "POST", body: json({ currentPassword: password, newPassword: "DepartmentScope!2027" }) });
    assert(changePassword.status === 200 && changePassword.body.loginRequired, `${user.login} is required to replace the temporary password`);
    if (user.id === managerA.body.id) managerCookie = await login(user.login, "DepartmentScope!2027");
    if (user.id === managerB.body.id) managerBCookie = await login(user.login, "DepartmentScope!2027");
  }

  const product = await api(owner, "/api/products", { method: "POST", body: json({
    name: `QA Oil ${Date.now()}`, code: `QAO-${Date.now()}`, kind: "product", unit: "л", purchasePrice: "100.00", salePrice: "150.00",
  }) });
  assert(product.status === 201, "creates a shared catalog item for the scope check");
  const minimaSetup = await api(owner, `/api/products/${product.body.id}`, { method: "PATCH", body: json({
    minStockMode: "per_warehouse", warehouseMinima: [
      { warehouseId: warehouseA.id, minStock: "5" }, { warehouseId: warehouseB.body.id, minStock: "7" },
    ],
  }) });
  assert(minimaSetup.status === 200, "owner configures separate stock thresholds for both salons");
  const remoteMinimumWrite = await api(managerCookie, `/api/products/${product.body.id}`, { method: "PATCH", body: json({
    warehouseMinima: [{ warehouseId: warehouseB.body.id, minStock: "9" }],
  }) });
  assert(remoteMinimumWrite.status === 400, "manager cannot change a stock threshold in another salon");
  const localMinimumWrite = await api(managerCookie, `/api/products/${product.body.id}`, { method: "PATCH", body: json({
    warehouseMinima: [{ warehouseId: warehouseA.id, minStock: "6" }],
  }) });
  const minimaAfterManager = await api(owner, `/api/products/${product.body.id}`);
  const minimumA = minimaAfterManager.body.warehouses.find((item) => item.warehouse_id === warehouseA.id)?.min_stock_units;
  const minimumB = minimaAfterManager.body.warehouses.find((item) => item.warehouse_id === warehouseB.body.id)?.min_stock_units;
  assert(localMinimumWrite.status === 200 && minimumA === 6_000_000 && minimumB === 7_000_000, "salon manager can update local threshold while preserving other salons' settings");
  const warehouseA2 = await api(owner, "/api/warehouses", { method: "POST", body: json({ name: "QA второй склад салона A", code: `QAS2-${Date.now()}`, departmentId: departmentA.id }) });
  const stockDocA2 = await api(owner, "/api/documents", { method: "POST", body: json({ kind: "enter", warehouseId: warehouseA2.body.id, date: "2026-10-31", lines: [{ productId: product.body.id, quantity: "1", price: "100.00" }] }) });
  const postStockA2 = stockDocA2.status === 201 ? await api(owner, `/api/documents/${stockDocA2.body.id}/post`, { method: "POST" }) : { status: 0 };
  assert(warehouseA2.status === 201 && stockDocA2.status === 201 && postStockA2.status === 200, "second salon A warehouse receives inventory");
  const archiveWarehouseWithStock = await api(owner, `/api/warehouses/${warehouseA2.body.id}`, { method: "PATCH", body: json({ active: false }) });
  assert(archiveWarehouseWithStock.status === 400 && archiveWarehouseWithStock.body.error.includes("остатки"), "warehouse with nonzero stock cannot be archived");

  const stockDocA = await api(owner, "/api/documents", { method: "POST", body: json({ kind: "enter", warehouseId: warehouseA.id, date: "2026-10-31", lines: [{ productId: product.body.id, quantity: "2", price: "100.00" }] }) });
  const stockDocB = await api(owner, "/api/documents", { method: "POST", body: json({ kind: "enter", warehouseId: warehouseB.body.id, date: "2026-10-31", lines: [{ productId: product.body.id, quantity: "7", price: "100.00" }] }) });
  assert(stockDocA.status === 201 && stockDocB.status === 201, "creates stock documents for both salons");
  assert((await api(owner, `/api/documents/${stockDocA.body.id}/post`, { method: "POST" })).status === 200, "posts salon A stock receipt");
  assert((await api(owner, `/api/documents/${stockDocB.body.id}/post`, { method: "POST" })).status === 200, "posts salon B stock receipt");

  const customer = await api(owner, "/api/counterparties", { method: "POST", body: json({ name: `QA Customer ${Date.now()}`, kind: "customer" }) });
  const contract = await api(owner, `/api/counterparties/${customer.body.id}/contracts`, { method: "POST", body: json({ number: `QA-${Date.now()}`, date: "2026-10-31", sum: "100.00" }) });
  const bankAccount = await api(owner, `/api/counterparties/${customer.body.id}/bank-accounts`, { method: "POST", body: json({ accountNumber: `KZQA${Date.now()}`, bankName: "QA Bank" }) });
  const vehicle = await api(owner, "/api/vehicles", { method: "POST", body: json({ counterpartyId: customer.body.id, plate: `QA${Date.now()}`.slice(-8), make: "QA", model: "Car", currentMileage: 1000 }) });
  assert(customer.status === 201 && contract.status === 201 && bankAccount.status === 201 && vehicle.status === 201, "creates test customer, vehicle, contract, and bank details");
  const orderA = await api(owner, "/api/documents", { method: "POST", body: json({
    kind: "work_order", warehouseId: warehouseA.id, counterpartyId: customer.body.id, vehicleId: vehicle.body.id,
    date: "2026-10-31", odometerKm: 1000, lines: [{ productId: product.body.id, quantity: "1", price: "150.00" }],
  }) });
  const orderB = await api(owner, "/api/documents", { method: "POST", body: json({
    kind: "work_order", warehouseId: warehouseB.body.id, counterpartyId: customer.body.id, vehicleId: vehicle.body.id,
    date: "2026-10-31", odometerKm: 1000, lines: [{ productId: product.body.id, quantity: "1", price: "150.00" }],
  }) });
  assert(orderA.status === 201 && orderB.status === 201, "creates work orders for both salons");
  const parentOrderA = await api(owner, "/api/documents", { method: "POST", body: json({
    kind: "customer_order", warehouseId: warehouseA.id, counterpartyId: customer.body.id, contractId: contract.body.id, bankAccountId: bankAccount.body.id,
    date: "2026-10-31", lines: [{ productId: product.body.id, quantity: "2", price: "150.00" }],
  }) });
  const shipmentB = await api(owner, `/api/documents/${parentOrderA.body.id}/create-child`, { method: "POST", body: json({
    kind: "shipment", warehouseId: warehouseB.body.id, lines: [{ productId: product.body.id, quantity: "1", price: "150.00" }],
  }) });
  const postShipmentB = shipmentB.status === 201 ? await api(owner, `/api/documents/${shipmentB.body.id}/post`, { method: "POST" }) : { status: 0 };
  assert(parentOrderA.status === 201 && shipmentB.status === 201 && postShipmentB.status === 200, "shipment from salon B is linked to an order in salon A");
  const warehouseA3 = await api(owner, "/api/warehouses", { method: "POST", body: json({ name: "QA склад без остатка", code: `QAS3-${Date.now()}`, departmentId: departmentA.id }) });
  const draftAtA3 = await api(owner, "/api/documents", { method: "POST", body: json({
    kind: "work_order", warehouseId: warehouseA3.body.id, counterpartyId: customer.body.id, vehicleId: vehicle.body.id,
    date: "2026-10-31", odometerKm: 1000, lines: [{ productId: product.body.id, quantity: "1", price: "150.00" }],
  }) });
  const archiveEmptyWarehouse = await api(owner, `/api/warehouses/${warehouseA3.body.id}`, { method: "PATCH", body: json({ active: false }) });
  const editArchivedWarehouseDoc = await api(managerCookie, `/api/documents/${draftAtA3.body.id}`, { method: "PATCH", body: json({ comment: "Изменение после архивации" }) });
  assert(warehouseA3.status === 201 && draftAtA3.status === 201 && archiveEmptyWarehouse.status === 200 && editArchivedWarehouseDoc.status === 400 && editArchivedWarehouseDoc.body.error.includes("архивном складе"),
    "archived zero-stock warehouse preserves drafts but blocks further document changes until restored");
  const localChain = await api(owner, `/api/documents/${orderA.body.id}/chain`);
  assert(localChain.status === 200 && localChain.body.chain.every((item) => item.id === orderA.body.id), "owner can read a local document chain");
  const crossBranchChild = await api(owner, `/api/documents/${orderA.body.id}/create-child`, { method: "POST", body: json({ kind: "cash_in", warehouseId: warehouseB.body.id, amount: "1.00" }) });
  assert(crossBranchChild.status === 201, "owner can create a related document assigned to another salon");
  const crossSalonTransfer = await api(owner, "/api/documents", { method: "POST", body: json({
    kind: "transfer", warehouseId: warehouseA.id, destinationWarehouseId: warehouseB.body.id, date: "2026-10-31",
    lines: [{ productId: product.body.id, quantity: "1", price: "100.00" }],
  }) });
  assert(crossSalonTransfer.status === 201, "owner can prepare a transfer between salons");
  const moveUsedWarehouse = await api(owner, `/api/warehouses/${warehouseB.body.id}`, { method: "PATCH", body: json({ departmentId: departmentA.id }) });
  const warehouseAfterMoveAttempt = await api(owner, "/api/warehouses?includeArchived=1");
  assert(moveUsedWarehouse.status === 400 && warehouseAfterMoveAttempt.body.find((item) => item.id === warehouseB.body.id)?.department_id === departmentB.body.id,
    "warehouse with linked operations cannot be reassigned to another salon");
  const managerOrderA = await api(managerCookie, "/api/documents?kind=customer_order");
  const managerAParentInList = managerOrderA.body.find((item) => item.id === parentOrderA.body.id);
  const managerAParentDetail = await api(managerCookie, `/api/documents/${parentOrderA.body.id}`);
  assert(managerAParentInList?.shipped_percent === 0 && managerAParentInList.contract_id === undefined && managerAParentInList.contract_number == null && managerAParentDetail.body.progress.shipped_percent === 0,
    "salon A progress excludes shipments from salon B and hides contract details");
  const managerBShipment = await api(managerBCookie, `/api/documents/${shipmentB.body.id}`);
  const managerBDocuments = await api(managerBCookie, "/api/documents?kind=shipment");
  const managerBShipmentInList = managerBDocuments.body.find((item) => item.id === shipmentB.body.id);
  assert(managerBShipment.status === 200 && managerBShipment.body.parent_document_id == null && managerBShipment.body.parent_document_number == null && managerBShipment.body.contract_id === undefined && managerBShipment.body.contract_number === undefined
    && managerBShipmentInList && managerBShipmentInList.parent_document_id == null && managerBShipmentInList.parent_document_number == null && managerBShipmentInList.contract_id === undefined,
    "salon B shipment does not reveal its parent order ID, number, or contract");

  const cookieA = await login(userA.body.login, "DepartmentScope!2027");
  const warehouseListA = await api(cookieA, "/api/warehouses");
  assert(warehouseListA.status === 200 && warehouseListA.body.some((item) => item.id === warehouseA.id) && warehouseListA.body.some((item) => item.id === warehouseA2.body.id) && !warehouseListA.body.some((item) => item.id === warehouseB.body.id), "salon A employee only sees assigned warehouses");
  const stockA = await api(cookieA, "/api/stock");
  assert(stockA.status === 200 && stockA.body.every((item) => [warehouseA.id, warehouseA2.body.id].includes(item.warehouse_id)), "stock list hides other salons");
  const productA = await api(cookieA, `/api/products/${product.body.id}`);
  assert(productA.status === 200 && Number(productA.body.stock_units) === 3_000_000 && productA.body.warehouses.every((item) => [warehouseA.id, warehouseA2.body.id].includes(item.warehouse_id)) && productA.body.movements.every((item) => item.warehouse_name !== "QA склад салона B"), `product card aggregates stock only within assigned salons (${JSON.stringify({ status: productA.status, stock: productA.body?.stock_units, warehouses: productA.body?.warehouses, movements: productA.body?.movements })})`);
  const docsA = await api(cookieA, "/api/documents?kind=work_order");
  assert(docsA.status === 200 && docsA.body.some((item) => item.id === orderA.body.id) && !docsA.body.some((item) => item.id === orderB.body.id), "work order list is filtered by salon");
  const detailA = await api(cookieA, `/api/documents/${orderA.body.id}`);
  assert(detailA.status === 200 && detailA.body.id === orderA.body.id && detailA.body.contract === null && detailA.body.bankAccount === null, "assigned work order opens without exposing global contract or bank details");
  const counterpartyA = await api(cookieA, `/api/counterparties/${customer.body.id}`);
  assert(counterpartyA.status === 200 && counterpartyA.body.contracts.length === 0 && counterpartyA.body.bankAccounts.length === 0, "counterparty card hides network-wide contracts and bank details from salon employees");
  assert((await api(cookieA, `/api/documents/${orderA.body.id}/chain`)).status === 404, "document chain is hidden when it contains a related document from another salon");
  assert((await api(cookieA, `/api/documents/${orderB.body.id}`)).status === 404, "other salon work order cannot be opened by ID");
  assert((await api(cookieA, `/api/documents/${crossSalonTransfer.body.id}`)).status === 404, "transfer between salons is hidden when user has access to only one side");
  assert((await api(cookieA, `/api/documents/${stockDocB.body.id}/post`, { method: "POST" })).status === 404, "other salon document cannot be posted by ID");
  assert((await api(cookieA, "/api/documents/bulk-status", { method: "POST", body: json({ ids: [orderA.body.id], action: "post" }) })).status === 400, "bulk status cannot bypass individual posting and stock validation");
  assert((await api(cookieA, "/api/documents/bulk-status", { method: "POST", body: json({ ids: [stockDocA.body.id], statusName: "Чужой тип" }) })).status === 403, "employee bulk actions cannot affect non-work-order documents");
  assert((await api(cookieA, "/api/dashboard")).status === 403, "network-wide dashboard stays closed until scoped reporting exists");
  assert((await api(cookieA, `/api/counterparties/${customer.body.id}/contracts`)).status === 403, "nested contract list is blocked for salon employees");
  assert((await api(cookieA, `/api/counterparties/${customer.body.id}/bank-accounts`)).status === 403, "nested counterparty bank accounts are blocked for salon employees");
  assert((await api(cookieA, "/api/price-lists")).status === 403, "unscoped price-list operations stay closed for salon employees");

  const cookieB = await login(userB.body.login, "DepartmentScope!2027");
  const stockB = await api(cookieB, "/api/stock");
  assert(stockB.status === 200 && stockB.body.every((item) => item.warehouse_id === warehouseB.body.id) && stockB.body.some((item) => item.product_id === product.body.id && item.stock_units === 6_000_000), "salon B employee only sees assigned stock after the posted shipment");
  const docsB = await api(cookieB, "/api/documents?kind=work_order");
  assert(docsB.status === 200 && docsB.body.some((item) => item.id === orderB.body.id) && !docsB.body.some((item) => item.id === orderA.body.id), "salon B work order list excludes salon A");
  assert((await api(cookieB, `/api/documents/${crossSalonTransfer.body.id}`)).status === 404, "salon B user cannot open a transfer from salon A");

  const prepareSalonClosure = await api(owner, `/api/auth/users/${userB.body.id}`, { method: "PATCH", body: json({ departmentIds: [departmentA.id, departmentB.body.id] }) });
  assert(prepareSalonClosure.status === 200, "owner can give branch employee a replacement salon before closure");
  const closeSalon = await api(owner, `/api/departments/${departmentB.body.id}`, { method: "PATCH", body: json({ active: false }) });
  const retainedWarehouses = await api(owner, "/api/warehouses?includeArchived=1");
  const retainedOrder = await api(owner, `/api/documents/${orderB.body.id}`);
  const closedBranchList = await api(cookieB, "/api/warehouses");
  const closedBranchOrder = await api(cookieB, `/api/documents/${orderB.body.id}`);
  const lastSalonArchive = await api(owner, `/api/departments/${departmentA.id}`, { method: "PATCH", body: json({ active: false }) });
  assert(closeSalon.status === 200 && closeSalon.body.active === 0 && retainedWarehouses.body.some((item) => item.id === warehouseB.body.id && item.active === 1) && retainedOrder.status === 200,
    "salon can be archived with its active warehouses and historical documents preserved");
  assert(!closedBranchList.body.some((item) => item.id === warehouseB.body.id) && closedBranchOrder.status === 404 && !closeSalon.body.active && lastSalonArchive.status === 400,
    "archived salon access is revoked and the last active salon cannot be archived");

  console.log(`Department scope QA passed. Isolated database: ${testDbPath}`);
} catch (error) {
  console.error(error);
  console.error(serverOutput);
  process.exitCode = 1;
} finally {
  if (server.exitCode === null) {
    server.kill("SIGTERM");
    await new Promise((resolve) => server.once("exit", resolve));
  }
}
