import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { scryptSync, randomBytes } from "node:crypto";
import Database from "better-sqlite3";

const testDir = path.resolve(`.tmp-product-groups-gauntlet-${process.pid}-${Date.now()}`);
fs.mkdirSync(testDir, { recursive: true });
const testDbPath = path.join(testDir, "test.sqlite");
fs.copyFileSync(path.resolve("data/moysklad.sqlite"), testDbPath);

const options = { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const salt = randomBytes(16);
const hash = scryptSync("ProductGroups!2026", salt, 64, options);
const passwordHash = `scrypt$${options.N}$${options.r}$${options.p}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
const seed = new Database(testDbPath);
seed.prepare(`INSERT INTO users (organization_id, login, full_name, role, active, must_change_password, password_hash)
  VALUES (1, 'qa.groups', 'Product Group QA', 'owner', 1, 0, ?)
  ON CONFLICT(organization_id, login) DO UPDATE SET password_hash = excluded.password_hash, active = 1, must_change_password = 0`).run(passwordHash);
seed.prepare(`INSERT INTO users (organization_id, login, full_name, role, active, must_change_password, password_hash)
  VALUES (1, 'qa.employee', 'Product Group Employee', 'employee', 1, 0, ?)
  ON CONFLICT(organization_id, login) DO UPDATE SET password_hash = excluded.password_hash, active = 1, must_change_password = 0`).run(passwordHash);
seed.close();

const port = 4326;
let serverOutput = "";
function launchServer() {
  const child = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "server/index.ts"], {
    cwd: process.cwd(), env: { ...process.env, API_PORT: String(port), DB_PATH: testDbPath, SETUP_TOKEN: "product-groups-gauntlet" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => { serverOutput += chunk.toString(); });
  child.stderr.on("data", (chunk) => { serverOutput += chunk.toString(); });
  return child;
}
let server = launchServer();
let cookie = "";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function api(route, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    ...options,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...(options.headers ?? {}) },
  });
  const bodyText = await response.text();
  let body = null;
  try { body = bodyText ? JSON.parse(bodyText) : null; } catch {}
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  return { status: response.status, ok: response.ok, body, text: bodyText };
}

function assert(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`✓ ${message}`);
}

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return; } catch {}
    await sleep(200);
  }
  throw new Error(`Server failed to start:\n${serverOutput}`);
}

async function run() {
  try {
    await waitForServer();
    const login = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ login: "qa.groups", password: "ProductGroups!2026" }) });
    assert(login.ok, "isolated QA owner can log in");

    const productsBefore = await api("/api/products");
    assert(productsBefore.ok && productsBefore.body.every((product) => !product.group_name || product.group_id), "legacy product group names are migrated to group IDs");

    const suffix = String(Date.now());
    const root = await api("/api/product-groups", { method: "POST", body: JSON.stringify({ name: `QA Oils ${suffix}`, code: `QG-${suffix}`, vatRate: "12" }) });
    assert(root.status === 201 && root.body.vat_rate === "12", `creates a top-level group with VAT metadata (HTTP ${root.status}: ${JSON.stringify(root.body)})`);
    const child = await api("/api/product-groups", { method: "POST", body: JSON.stringify({ name: `QA Filters ${suffix}`, parentId: root.body.id }) });
    assert(child.status === 201 && child.body.parent_id === root.body.id, "creates a nested group");

    const duplicate = await api("/api/product-groups", { method: "POST", body: JSON.stringify({ name: child.body.name, parentId: root.body.id }) });
    assert(duplicate.status === 409, "rejects a duplicate sibling name");
    const cycle = await api(`/api/product-groups/${root.body.id}`, { method: "PATCH", body: JSON.stringify({ name: root.body.name, parentId: child.body.id }) });
    assert(cycle.status === 400, "rejects a parent cycle");

    const product = await api("/api/products", { method: "POST", body: JSON.stringify({ name: `QA Oil ${suffix}`, code: `QP-${suffix}`, kind: "product", unit: "л", groupId: child.body.id, vatRate: "" }) });
    assert(product.status === 201 && product.body.group_id === child.body.id && product.body.group_name === `${root.body.name} / ${child.body.name}`, "assigns a product to the selected group and stores its full path for legacy filters");
    const invalidAssignment = await api(`/api/products/${product.body.id}`, { method: "PATCH", body: JSON.stringify({ groupId: 999999999 }) });
    const unchangedProduct = await api(`/api/products/${product.body.id}`);
    assert(invalidAssignment.status === 400 && unchangedProduct.body.group_id === child.body.id, "rejects an unknown group ID without changing the product");

    const enter = await api("/api/documents", { method: "POST", body: JSON.stringify({ kind: "enter", date: "2026-10-31", lines: [{ productId: product.body.id, quantity: "1", price: "100" }] }) });
    assert(enter.status === 201, "creates a draft document using a grouped product");
    const document = await api(`/api/documents/${enter.body.id}`);
    assert(document.ok && document.body.lines[0].vat_rate === "12", "uses the nearest ancestor group's VAT rate in the document line");

    const renamed = `QA Oil Filters ${suffix}`;
    const rename = await api(`/api/product-groups/${child.body.id}`, { method: "PATCH", body: JSON.stringify({ name: renamed, parentId: root.body.id, code: "", vatRate: "" }) });
    assert(rename.ok, "renames a group");
    const updatedProduct = await api(`/api/products/${product.body.id}`);
    assert(updatedProduct.ok && updatedProduct.body.group_name === `${root.body.name} / ${renamed}`, "keeps legacy group paths synchronized after rename");

    const deleteUsed = await api(`/api/product-groups/${child.body.id}`, { method: "DELETE" });
    assert(deleteUsed.status === 409, "prevents deleting a group that contains a product");
    const empty = await api("/api/product-groups", { method: "POST", body: JSON.stringify({ name: `QA Empty ${suffix}` }) });
    assert(empty.status === 201, "creates an empty group for deletion coverage");
    const deleteEmpty = await api(`/api/product-groups/${empty.body.id}`, { method: "DELETE" });
    assert(deleteEmpty.status === 204, "deletes an empty group");

    server.kill("SIGTERM");
    await sleep(600);
    server = launchServer();
    await waitForServer();
    const groupsAfterRestart = await api("/api/product-groups");
    assert(groupsAfterRestart.ok && !groupsAfterRestart.body.some((group) => group.name === `${root.body.name} / ${renamed}`), "restarting the server does not create a duplicate root from a nested product path");

    await api("/api/auth/logout", { method: "POST" });
    const employeeLogin = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ login: "qa.employee", password: "ProductGroups!2026" }) });
    const employeeWrite = await api("/api/product-groups", { method: "POST", body: JSON.stringify({ name: `Employee Group ${suffix}` }) });
    assert(employeeLogin.ok && employeeWrite.status === 403, "employee can’t create product groups");

    server.kill("SIGTERM");
    await sleep(350);
    const db = new Database(testDbPath);
    assert(db.pragma("integrity_check")[0]?.integrity_check === "ok", "isolated database integrity check passes");
    assert(db.pragma("foreign_key_check").length === 0, "isolated database foreign-key check passes");
    db.close();
    console.log("Product group Gauntlet passed.");
  } finally {
    server.kill("SIGTERM");
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
