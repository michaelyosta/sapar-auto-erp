import express, { type NextFunction, type Request, type Response } from "express";
import Database from "better-sqlite3";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { authMiddleware, requireAuth, requirePasswordUpdated, requirePermission, registerAuthRoutes, type AuthContext, type AuthPermission } from "./auth.js";
import { initializePriceListSchema, registerPriceListRoutes } from "./priceLists.js";
import { initializePayrollSchema, registerPayrollRoutes } from "./payroll.js";
import { initializeDiscountsLoyaltySchema, registerDiscountsLoyaltyRoutes } from "./discountsLoyalty.js";
import { registerProcurementRoutes } from "./procurement.js";
import { initializeTaxInvoicesSchema, registerTaxInvoicesRoutes } from "./taxInvoices.js";
import { registerAnalyticsRoutes } from "./analytics.js";
import { initializeAutomationSchema, registerAutomationRoutes, executeAutomationRules } from "./automation.js";
import { initializeFilesSchema, registerFilesRoutes } from "./files.js";
import { initializeProductGroupsSchema, registerProductGroupRoutes } from "./productGroups.js";
import { assertRequestDocumentAccess, assertRequestWarehouseAccess, canAccessDepartment, canAccessWarehouse,
  getAccessibleActiveWarehouseIds, initializeDepartmentScopeSchema, isUnrestricted, registerDepartmentScopeRoutes, scopedDocumentFilter,
  scopedDocumentFilterLiteral, scopedWarehouseFilter } from "./departmentScope.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDirectory = path.resolve(__dirname, "../data");
const databasePath = path.resolve(process.env.DB_PATH || path.join(dataDirectory, "moysklad.sqlite"));
mkdirSync(path.dirname(databasePath), { recursive: true });

const db = new Database(databasePath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(`
  CREATE TABLE IF NOT EXISTS organizations (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'KZT',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS warehouses (
    id INTEGER PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id),
    name TEXT NOT NULL,
    address TEXT NOT NULL DEFAULT '',
    address_comment TEXT NOT NULL DEFAULT '',
    comment TEXT NOT NULL DEFAULT '',
    code TEXT NOT NULL DEFAULT '',
    external_code TEXT NOT NULL DEFAULT '',
    parent_id INTEGER REFERENCES warehouses(id),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id),
    code TEXT NOT NULL DEFAULT '',
    article TEXT NOT NULL DEFAULT '',
    external_code TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'product' CHECK (kind IN ('product','service')),
    description TEXT NOT NULL DEFAULT '',
    group_name TEXT NOT NULL DEFAULT '',
    country TEXT NOT NULL DEFAULT '',
    supplier_id INTEGER REFERENCES counterparties(id),
    unit TEXT NOT NULL DEFAULT 'шт',
    weight_milli INTEGER NOT NULL DEFAULT 0,
    volume_milli INTEGER NOT NULL DEFAULT 0,
    vat_rate TEXT NOT NULL DEFAULT '',
    purchase_price_tiyin INTEGER NOT NULL DEFAULT 0,
    sale_price_tiyin INTEGER NOT NULL DEFAULT 0,
    minimum_price_tiyin INTEGER NOT NULL DEFAULT 0,
    retail_discount_allowed INTEGER NOT NULL DEFAULT 1,
    min_stock_units INTEGER NOT NULL DEFAULT 0,
    min_stock_mode TEXT NOT NULL DEFAULT 'total',
    packaging_unit TEXT NOT NULL DEFAULT '',
    accounting_type TEXT NOT NULL DEFAULT '',
    ntin TEXT NOT NULL DEFAULT '',
    traceable INTEGER NOT NULL DEFAULT 0,
    marking TEXT NOT NULL DEFAULT '',
    product_type TEXT NOT NULL DEFAULT '',
    tax_system TEXT NOT NULL DEFAULT '',
    calculation_subject TEXT NOT NULL DEFAULT 'Товар',
    access_employee TEXT NOT NULL DEFAULT '',
    access_department TEXT NOT NULL DEFAULT '',
    shared_access INTEGER NOT NULL DEFAULT 1,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS counterparties (
    id INTEGER PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id),
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'customer' CHECK (kind IN ('customer','supplier','both')),
    phone TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    comment TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS product_barcodes (
    id INTEGER PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id),
    barcode_type TEXT NOT NULL DEFAULT 'EAN13',
    barcode TEXT NOT NULL,
    UNIQUE(product_id, barcode_type, barcode)
  );
  CREATE TABLE IF NOT EXISTS product_packaging (
    id INTEGER PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id),
    name TEXT NOT NULL DEFAULT '',
    quantity_units INTEGER NOT NULL CHECK (quantity_units > 0),
    unit TEXT NOT NULL DEFAULT '',
    code_type TEXT NOT NULL DEFAULT '',
    barcode TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS product_relations (
    id INTEGER PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id),
    related_product_id INTEGER NOT NULL REFERENCES products(id),
    relation_type TEXT NOT NULL CHECK (relation_type IN ('analogue','modification')),
    UNIQUE(product_id, related_product_id, relation_type),
    CHECK(product_id <> related_product_id)
  );
  CREATE TABLE IF NOT EXISTS product_warehouse_minima (
    product_id INTEGER NOT NULL REFERENCES products(id),
    warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
    min_stock_units INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(product_id, warehouse_id)
  );
  CREATE TABLE IF NOT EXISTS product_prices (
    id INTEGER PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id),
    name TEXT NOT NULL,
    price_tiyin INTEGER NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'KZT',
    position INTEGER NOT NULL DEFAULT 0,
    UNIQUE(product_id, name)
  );
  CREATE TABLE IF NOT EXISTS product_files (
    id INTEGER PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id),
    file_kind TEXT NOT NULL CHECK(file_kind IN ('image','file')),
    file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    data BLOB NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS vehicles (
    id INTEGER PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id),
    counterparty_id INTEGER REFERENCES counterparties(id),
    plate TEXT NOT NULL DEFAULT '',
    make TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    year INTEGER,
    vin TEXT NOT NULL DEFAULT '',
    initial_mileage INTEGER NOT NULL DEFAULT 0,
    current_mileage INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS bank_accounts (
    id INTEGER PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id),
    counterparty_id INTEGER REFERENCES counterparties(id),
    bik TEXT NOT NULL DEFAULT '',
    bank_name TEXT NOT NULL DEFAULT '',
    bank_address TEXT NOT NULL DEFAULT '',
    corr_account TEXT NOT NULL DEFAULT '',
    account_number TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_bank_accounts_org_cp ON bank_accounts(organization_id, counterparty_id);
  CREATE INDEX IF NOT EXISTS idx_bank_accounts_active ON bank_accounts(organization_id, active);
  CREATE TABLE IF NOT EXISTS contracts (
    id INTEGER PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id),
    counterparty_id INTEGER NOT NULL REFERENCES counterparties(id),
    number TEXT NOT NULL,
    date TEXT NOT NULL,
    due_date TEXT,
    currency TEXT NOT NULL DEFAULT 'KZT',
    sum_tiyin INTEGER NOT NULL DEFAULT 0,
    comment TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_contracts_counterparty ON contracts(counterparty_id);
  CREATE INDEX IF NOT EXISTS idx_contracts_org_number ON contracts(organization_id, number);
  CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id),
    number TEXT NOT NULL,
    kind TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','cancelled','deleted')),
    status_name TEXT NOT NULL DEFAULT 'Новый',
    state TEXT NOT NULL DEFAULT 'Новый',
    date TEXT NOT NULL,
    due_date TEXT,
    counterparty_id INTEGER REFERENCES counterparties(id),
    contract_id INTEGER REFERENCES contracts(id),
    bank_account_id INTEGER REFERENCES bank_accounts(id),
    loss_reason TEXT NOT NULL DEFAULT '',
    vehicle_id INTEGER REFERENCES vehicles(id),
    odometer_km INTEGER,
    next_service_km INTEGER,
    warehouse_id INTEGER REFERENCES warehouses(id),
    destination_warehouse_id INTEGER REFERENCES warehouses(id),
    parent_document_id INTEGER REFERENCES documents(id),
    delivery_address TEXT NOT NULL DEFAULT '',
    delivery_planned_moment TEXT,
    overhead_cost_tiyin INTEGER NOT NULL DEFAULT 0,
    is_vat_included INTEGER NOT NULL DEFAULT 1,
    discount_tiyin INTEGER NOT NULL DEFAULT 0,
    payment_method TEXT NOT NULL DEFAULT '',
    comment TEXT NOT NULL DEFAULT '',
    total_tiyin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (organization_id, number)
  );
  CREATE TABLE IF NOT EXISTS document_lines (
    id INTEGER PRIMARY KEY,
    document_id INTEGER NOT NULL REFERENCES documents(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    quantity_units INTEGER NOT NULL CHECK (quantity_units >= 0),
    unit_price_tiyin INTEGER NOT NULL DEFAULT 0,
    discount_bps INTEGER NOT NULL DEFAULT 0,
    vat_rate TEXT NOT NULL DEFAULT '',
    vat_sum_tiyin INTEGER NOT NULL DEFAULT 0,
    total_without_vat_tiyin INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0,
    accounting_quantity INTEGER NOT NULL DEFAULT 0,
    actual_quantity INTEGER NOT NULL DEFAULT 0,
    difference_quantity INTEGER NOT NULL DEFAULT 0,
    cost_tiyin INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_document_lines_doc ON document_lines(document_id);
  CREATE TABLE IF NOT EXISTS document_relations (
    id INTEGER PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id),
    parent_document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    child_document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    relation_type TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (parent_document_id, child_document_id, relation_type)
  );
  CREATE INDEX IF NOT EXISTS idx_doc_relations_parent ON document_relations(parent_document_id);
  CREATE INDEX IF NOT EXISTS idx_doc_relations_child ON document_relations(child_document_id);
  CREATE TABLE IF NOT EXISTS document_statuses (
    id INTEGER PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id),
    document_kind TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#3b82f6',
    is_default INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0,
    UNIQUE (organization_id, document_kind, name)
  );
  CREATE TABLE IF NOT EXISTS payment_allocations (
    id INTEGER PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id),
    payment_document_id INTEGER NOT NULL REFERENCES documents(id),
    target_document_id INTEGER NOT NULL REFERENCES documents(id),
    amount_tiyin INTEGER NOT NULL CHECK (amount_tiyin > 0),
    UNIQUE (payment_document_id, target_document_id),
    CHECK (payment_document_id <> target_document_id)
  );
  CREATE INDEX IF NOT EXISTS idx_payment_allocations_target ON payment_allocations(target_document_id, payment_document_id);
  CREATE TABLE IF NOT EXISTS stock_movements (
    id INTEGER PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id),
    document_id INTEGER NOT NULL REFERENCES documents(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
    quantity_units INTEGER NOT NULL,
    value_tiyin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_stock_product_warehouse ON stock_movements(product_id, warehouse_id);
  CREATE TABLE IF NOT EXISTS stock_reservations (
    id INTEGER PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id),
    document_id INTEGER NOT NULL REFERENCES documents(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
    quantity_units INTEGER NOT NULL CHECK (quantity_units > 0),
    UNIQUE (document_id, product_id, warehouse_id)
  );
  CREATE TABLE IF NOT EXISTS reservation_consumptions (
    id INTEGER PRIMARY KEY,
    shipment_document_id INTEGER NOT NULL REFERENCES documents(id),
    order_document_id INTEGER NOT NULL REFERENCES documents(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
    quantity_units INTEGER NOT NULL CHECK (quantity_units > 0)
  );
  CREATE INDEX IF NOT EXISTS idx_documents_date_kind ON documents(kind, date, status);
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id),
    entity_type TEXT NOT NULL,
    entity_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

const warehouseColumns = db.pragma("table_info(warehouses)") as Array<{ name: string }>;
const counterpartyColumns = db.pragma("table_info(counterparties)") as Array<{ name: string }>;
const counterpartyColumnMigrations: Array<[string, string]> = [
  ["status", "TEXT NOT NULL DEFAULT 'Новый'"], ["group_name", "TEXT NOT NULL DEFAULT ''"],
  ["fax", "TEXT NOT NULL DEFAULT ''"], ["actual_address", "TEXT NOT NULL DEFAULT ''"],
  ["address_comment", "TEXT NOT NULL DEFAULT ''"], ["code", "TEXT NOT NULL DEFAULT ''"],
  ["external_code", "TEXT NOT NULL DEFAULT ''"], ["legal_type", "TEXT NOT NULL DEFAULT 'legal_entity'"],
  ["bin", "TEXT NOT NULL DEFAULT ''"], ["legal_name", "TEXT NOT NULL DEFAULT ''"],
  ["legal_address", "TEXT NOT NULL DEFAULT ''"], ["legal_address_comment", "TEXT NOT NULL DEFAULT ''"],
  ["oked", "TEXT NOT NULL DEFAULT ''"], ["kbe", "TEXT NOT NULL DEFAULT ''"],
  ["vat_certificate_number", "TEXT NOT NULL DEFAULT ''"], ["vat_certificate_date", "TEXT NOT NULL DEFAULT ''"],
  ["price_type", "TEXT NOT NULL DEFAULT ''"], ["discount_card", "TEXT NOT NULL DEFAULT ''"],
  ["revision", "INTEGER NOT NULL DEFAULT 0"],
];
for (const [name, declaration] of counterpartyColumnMigrations) {
  if (!counterpartyColumns.some((column) => column.name === name)) db.exec(`ALTER TABLE counterparties ADD COLUMN ${name} ${declaration}`);
}
db.exec(`CREATE TABLE IF NOT EXISTS counterparty_contacts (
  id INTEGER PRIMARY KEY,
  counterparty_id INTEGER NOT NULL REFERENCES counterparties(id),
  full_name TEXT NOT NULL,
  position TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  comment TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_counterparty_contacts_counterparty ON counterparty_contacts(counterparty_id);`);
const warehouseColumnMigrations: Array<[string, string]> = [
  ["address_comment", "TEXT NOT NULL DEFAULT ''"], ["comment", "TEXT NOT NULL DEFAULT ''"],
  ["code", "TEXT NOT NULL DEFAULT ''"], ["external_code", "TEXT NOT NULL DEFAULT ''"],
  ["parent_id", "INTEGER REFERENCES warehouses(id)"],
];
for (const [name, declaration] of warehouseColumnMigrations) {
  if (!warehouseColumns.some((column) => column.name === name)) db.exec(`ALTER TABLE warehouses ADD COLUMN ${name} ${declaration}`);
}
const duplicateWarehouseCodes = db.prepare(`SELECT organization_id, code, COUNT(*) AS count FROM warehouses
  WHERE TRIM(code) <> '' GROUP BY organization_id, code COLLATE NOCASE HAVING COUNT(*) > 1`).all();
if (!duplicateWarehouseCodes.length) {
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_warehouses_organization_code ON warehouses (organization_id, code COLLATE NOCASE) WHERE TRIM(code) <> ''");
} else {
  console.warn("Duplicate warehouse codes exist; the unique-code index was not created. Resolve duplicate codes before deployment.");
}
db.exec(`CREATE TRIGGER IF NOT EXISTS trg_warehouses_unique_code_insert
  BEFORE INSERT ON warehouses
  WHEN TRIM(NEW.code) <> '' AND EXISTS (
    SELECT 1 FROM warehouses WHERE organization_id = NEW.organization_id AND code = NEW.code COLLATE NOCASE
  )
  BEGIN SELECT RAISE(ABORT, 'Код склада уже используется.'); END;
  CREATE TRIGGER IF NOT EXISTS trg_warehouses_unique_code_update
  BEFORE UPDATE OF organization_id, code ON warehouses
  WHEN TRIM(NEW.code) <> '' AND EXISTS (
    SELECT 1 FROM warehouses WHERE organization_id = NEW.organization_id AND code = NEW.code COLLATE NOCASE AND id <> OLD.id
  )
  BEGIN SELECT RAISE(ABORT, 'Код склада уже используется.'); END;`);

const productColumns = db.pragma("table_info(products)") as Array<{ name: string }>;
const productColumnMigrations: Array<[string, string]> = [
  ["article", "TEXT NOT NULL DEFAULT ''"], ["external_code", "TEXT NOT NULL DEFAULT ''"],
  ["description", "TEXT NOT NULL DEFAULT ''"], ["group_name", "TEXT NOT NULL DEFAULT ''"],
  ["country", "TEXT NOT NULL DEFAULT ''"], ["supplier_id", "INTEGER REFERENCES counterparties(id)"],
  ["weight_milli", "INTEGER NOT NULL DEFAULT 0"], ["volume_milli", "INTEGER NOT NULL DEFAULT 0"],
  ["vat_rate", "TEXT NOT NULL DEFAULT ''"], ["minimum_price_tiyin", "INTEGER NOT NULL DEFAULT 0"],
  ["retail_discount_allowed", "INTEGER NOT NULL DEFAULT 1"], ["min_stock_mode", "TEXT NOT NULL DEFAULT 'total'"],
  ["packaging_unit", "TEXT NOT NULL DEFAULT ''"], ["accounting_type", "TEXT NOT NULL DEFAULT ''"],
  ["ntin", "TEXT NOT NULL DEFAULT ''"], ["traceable", "INTEGER NOT NULL DEFAULT 0"],
  ["marking", "TEXT NOT NULL DEFAULT ''"], ["product_type", "TEXT NOT NULL DEFAULT ''"],
  ["tax_system", "TEXT NOT NULL DEFAULT ''"], ["calculation_subject", "TEXT NOT NULL DEFAULT 'Товар'"],
  ["access_employee", "TEXT NOT NULL DEFAULT ''"], ["access_department", "TEXT NOT NULL DEFAULT ''"],
  ["shared_access", "INTEGER NOT NULL DEFAULT 1"],
];
for (const [name, declaration] of productColumnMigrations) {
  if (!productColumns.some((column) => column.name === name)) db.exec(`ALTER TABLE products ADD COLUMN ${name} ${declaration}`);
}
initializeProductGroupsSchema(db);
const duplicateProductCodes = db.prepare(`SELECT organization_id, code, COUNT(*) AS count FROM products
  WHERE TRIM(code) <> '' GROUP BY organization_id, code COLLATE NOCASE HAVING COUNT(*) > 1`).all();
if (!duplicateProductCodes.length) {
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_products_organization_code ON products (organization_id, code COLLATE NOCASE) WHERE TRIM(code) <> ''");
} else {
  console.warn("Duplicate product codes exist; the unique-code index was not created. Resolve duplicate codes before deployment.");
}

const seedOrganization = db.prepare("INSERT OR IGNORE INTO organizations (id, name) VALUES (1, 'Моя компания')");
seedOrganization.run();
db.prepare("INSERT OR IGNORE INTO warehouses (id, organization_id, name) VALUES (1, 1, 'Основной склад')").run();
db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('allowNegativeStock', 'false')").run();
db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('numberingScheme', 'yearly')").run();
db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('emailSender', 'employee')").run();
db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('trashRetentionDays', '7')").run();

const organizationColumns = db.pragma("table_info(organizations)") as Array<{ name: string }>;
const organizationColumnMigrations: Array<[string, string]> = [
  ["code", "TEXT NOT NULL DEFAULT ''"],
  ["phone", "TEXT NOT NULL DEFAULT ''"],
  ["fax", "TEXT NOT NULL DEFAULT ''"],
  ["email", "TEXT NOT NULL DEFAULT ''"],
  ["actual_address", "TEXT NOT NULL DEFAULT ''"],
  ["actual_address_comment", "TEXT NOT NULL DEFAULT ''"],
  ["comment", "TEXT NOT NULL DEFAULT ''"],
  ["director", "TEXT NOT NULL DEFAULT ''"],
  ["director_position", "TEXT NOT NULL DEFAULT 'Руководитель организации или иное уполномоченное лицо'"],
  ["director_signature_url", "TEXT NOT NULL DEFAULT ''"],
  ["accountant", "TEXT NOT NULL DEFAULT ''"],
  ["accountant_signature_url", "TEXT NOT NULL DEFAULT ''"],
  ["stamp_url", "TEXT NOT NULL DEFAULT ''"],
  ["logo_url", "TEXT NOT NULL DEFAULT ''"],
  ["legal_type", "TEXT NOT NULL DEFAULT 'legal_entity'"],
  ["legal_name", "TEXT NOT NULL DEFAULT ''"],
  ["legal_address", "TEXT NOT NULL DEFAULT ''"],
  ["legal_address_comment", "TEXT NOT NULL DEFAULT ''"],
  ["bin", "TEXT NOT NULL DEFAULT ''"],
  ["kbe", "TEXT NOT NULL DEFAULT ''"],
  ["oked", "TEXT NOT NULL DEFAULT ''"],
  ["vat_payer", "INTEGER NOT NULL DEFAULT 0"],
  ["vat_rate_source", "TEXT NOT NULL DEFAULT 'product'"],
  ["vat_constant_rate", "TEXT NOT NULL DEFAULT '12%'"],
  ["vat_advance_rate", "TEXT NOT NULL DEFAULT '12/112'"],
  ["vat_certificate_number", "TEXT NOT NULL DEFAULT ''"],
  ["vat_certificate_date", "TEXT NOT NULL DEFAULT ''"],
];
for (const [name, declaration] of organizationColumnMigrations) {
  if (!organizationColumns.some((column) => column.name === name)) {
    db.exec(`ALTER TABLE organizations ADD COLUMN ${name} ${declaration}`);
  }
}

db.prepare(`UPDATE organizations SET
  name = CASE WHEN name = '' OR name = 'Моя компания' THEN 'Автосервис «Парк-Лейн»' ELSE name END,
  legal_name = CASE WHEN legal_name = '' THEN 'ТОО «Парк-Лейн Моторс»' ELSE legal_name END,
  bin = CASE WHEN bin = '' THEN '210540012345' ELSE bin END,
  director = CASE WHEN director = '' THEN 'Михаил Юрьевич' ELSE director END,
  director_position = CASE WHEN director_position = '' THEN 'Генеральный директор' ELSE director_position END,
  accountant = CASE WHEN accountant = '' THEN 'Елена Сергеевна' ELSE accountant END,
  legal_address = CASE WHEN legal_address = '' THEN 'г. Алматы, пр. Райымбека, д. 212' ELSE legal_address END,
  actual_address = CASE WHEN actual_address = '' THEN 'г. Алматы, ул. Толе би, д. 187' ELSE actual_address END,
  phone = CASE WHEN phone = '' THEN '+7 (727) 312-44-55' ELSE phone END,
  email = CASE WHEN email = '' THEN 'info@park-lane.kz' ELSE email END,
  vat_payer = 1,
  vat_constant_rate = '12%'
WHERE id = 1`).run();

db.exec(`
  CREATE TABLE IF NOT EXISTS retail_stores (
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
  CREATE INDEX IF NOT EXISTS idx_retail_stores_org ON retail_stores(organization_id, active);

  CREATE TABLE IF NOT EXISTS retail_shifts (
    id INTEGER PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id),
    retail_store_id INTEGER NOT NULL REFERENCES retail_stores(id),
    user_id INTEGER REFERENCES users(id),
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
  CREATE INDEX IF NOT EXISTS idx_retail_shifts_store ON retail_shifts(retail_store_id, status);
`);

const initialStoreCount = (db.prepare("SELECT COUNT(*) AS c FROM retail_stores WHERE organization_id = 1").get() as { c: number }).c;
if (initialStoreCount === 0) {
  db.prepare(`INSERT INTO retail_stores (organization_id, name, code, warehouse_id, active)
    VALUES (1, 'Касса экспресс-сервиса (Стол заказов)', 'POS-01', 1, 1)`).run();
}
const contractColumns = db.pragma("table_info(contracts)") as Array<{ name: string }>;
const contractColumnMigrations: Array<[string, string]> = [
  ["due_date", "TEXT"],
  ["currency", "TEXT NOT NULL DEFAULT 'KZT'"],
  ["sum_tiyin", "INTEGER NOT NULL DEFAULT 0"],
  ["comment", "TEXT NOT NULL DEFAULT ''"],
  ["active", "INTEGER NOT NULL DEFAULT 1"],
];
for (const [name, declaration] of contractColumnMigrations) {
  if (!contractColumns.some((column) => column.name === name)) {
    db.exec(`ALTER TABLE contracts ADD COLUMN ${name} ${declaration}`);
  }
}

const bankAccountColumns = db.pragma("table_info(bank_accounts)") as Array<{ name: string }>;
const bankAccountColumnMigrations: Array<[string, string]> = [
  ["bik", "TEXT NOT NULL DEFAULT ''"],
  ["bank_name", "TEXT NOT NULL DEFAULT ''"],
  ["bank_address", "TEXT NOT NULL DEFAULT ''"],
  ["corr_account", "TEXT NOT NULL DEFAULT ''"],
  ["is_default", "INTEGER NOT NULL DEFAULT 0"],
  ["active", "INTEGER NOT NULL DEFAULT 1"],
  ["updated_at", "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP"],
];
for (const [name, declaration] of bankAccountColumnMigrations) {
  if (!bankAccountColumns.some((column) => column.name === name)) {
    db.exec(`ALTER TABLE bank_accounts ADD COLUMN ${name} ${declaration}`);
  }
}

const documentColumns = db.pragma("table_info(documents)") as Array<{ name: string }>;
const documentColumnMigrations: Array<[string, string]> = [
  ["parent_document_id", "INTEGER REFERENCES documents(id)"],
  ["payment_method", "TEXT NOT NULL DEFAULT ''"],
  ["due_date", "TEXT"],
  ["odometer_km", "INTEGER"],
  ["next_service_km", "INTEGER"],
  ["contract_id", "INTEGER REFERENCES contracts(id)"],
  ["bank_account_id", "INTEGER REFERENCES bank_accounts(id)"],
  ["loss_reason", "TEXT NOT NULL DEFAULT ''"],
  ["status_name", "TEXT NOT NULL DEFAULT 'Новый'"],
  ["state", "TEXT NOT NULL DEFAULT 'Новый'"],
  ["delivery_address", "TEXT NOT NULL DEFAULT ''"],
  ["delivery_planned_moment", "TEXT"],
  ["overhead_cost_tiyin", "INTEGER NOT NULL DEFAULT 0"],
  ["is_vat_included", "INTEGER NOT NULL DEFAULT 1"],
  ["discount_tiyin", "INTEGER NOT NULL DEFAULT 0"],
];
for (const [name, declaration] of documentColumnMigrations) {
  if (!documentColumns.some((column) => column.name === name)) {
    db.exec(`ALTER TABLE documents ADD COLUMN ${name} ${declaration}`);
  }
}

const lineTableSql = (db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'document_lines'").get() as { sql: string } | undefined)?.sql ?? "";
if (lineTableSql.includes("quantity_units > 0")) {
  db.exec(`
    PRAGMA foreign_keys = OFF;
    CREATE TABLE document_lines_migration_tmp (
      id INTEGER PRIMARY KEY,
      document_id INTEGER NOT NULL REFERENCES documents(id),
      product_id INTEGER NOT NULL REFERENCES products(id),
      quantity_units INTEGER NOT NULL CHECK (quantity_units >= 0),
      unit_price_tiyin INTEGER NOT NULL DEFAULT 0,
      discount_bps INTEGER NOT NULL DEFAULT 0,
      vat_rate TEXT NOT NULL DEFAULT '',
      vat_sum_tiyin INTEGER NOT NULL DEFAULT 0,
      total_without_vat_tiyin INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL DEFAULT 0,
      accounting_quantity INTEGER NOT NULL DEFAULT 0,
      actual_quantity INTEGER NOT NULL DEFAULT 0,
      difference_quantity INTEGER NOT NULL DEFAULT 0,
      cost_tiyin INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO document_lines_migration_tmp (id, document_id, product_id, quantity_units, unit_price_tiyin, discount_bps, vat_rate, vat_sum_tiyin, total_without_vat_tiyin, position)
    SELECT id, document_id, product_id, quantity_units, unit_price_tiyin,
      COALESCE(discount_bps, 0), COALESCE(vat_rate, ''), COALESCE(vat_sum_tiyin, 0), COALESCE(total_without_vat_tiyin, 0), position
    FROM document_lines;
    DROP TABLE document_lines;
    ALTER TABLE document_lines_migration_tmp RENAME TO document_lines;
    CREATE INDEX IF NOT EXISTS idx_document_lines_doc ON document_lines(document_id);
    PRAGMA foreign_keys = ON;
  `);
}

const documentLineColumns = db.pragma("table_info(document_lines)") as Array<{ name: string }>;
const documentLineColumnMigrations: Array<[string, string]> = [
  ["vat_rate", "TEXT NOT NULL DEFAULT ''"],
  ["discount_bps", "INTEGER NOT NULL DEFAULT 0"],
  ["vat_sum_tiyin", "INTEGER NOT NULL DEFAULT 0"],
  ["total_without_vat_tiyin", "INTEGER NOT NULL DEFAULT 0"],
  ["accounting_quantity", "INTEGER NOT NULL DEFAULT 0"],
  ["actual_quantity", "INTEGER NOT NULL DEFAULT 0"],
  ["difference_quantity", "INTEGER NOT NULL DEFAULT 0"],
  ["cost_tiyin", "INTEGER NOT NULL DEFAULT 0"],
];
for (const [name, declaration] of documentLineColumnMigrations) {
  if (!documentLineColumns.some((column) => column.name === name)) {
    db.exec(`ALTER TABLE document_lines ADD COLUMN ${name} ${declaration}`);
  }
}

const defaultDocumentStatuses = [
  { name: "Новый", color: "#64748b", is_default: 1, position: 10 },
  { name: "Подтвержден", color: "#3b82f6", is_default: 0, position: 20 },
  { name: "Собран", color: "#8b5cf6", is_default: 0, position: 30 },
  { name: "Отгружен", color: "#06b6d4", is_default: 0, position: 40 },
  { name: "Доставлен", color: "#10b981", is_default: 0, position: 50 },
  { name: "Оплачен", color: "#22c55e", is_default: 0, position: 60 },
  { name: "Отменен", color: "#ef4444", is_default: 0, position: 70 },
];
const insertStatusStmt = db.prepare(`
  INSERT OR IGNORE INTO document_statuses (organization_id, document_kind, name, color, is_default, position)
  VALUES (1, '', ?, ?, ?, ?)
`);
for (const s of defaultDocumentStatuses) {
  insertStatusStmt.run(s.name, s.color, s.is_default, s.position);
}

db.exec(`
  UPDATE document_lines
  SET total_without_vat_tiyin = ROUND(quantity_units * unit_price_tiyin / 1000000)
  WHERE total_without_vat_tiyin = 0 AND unit_price_tiyin > 0;

  INSERT OR IGNORE INTO document_relations (organization_id, parent_document_id, child_document_id, relation_type)
  SELECT d.organization_id, d.parent_document_id, d.id,
    CASE
      WHEN p.kind = 'customer_order' AND d.kind = 'shipment' THEN 'order_to_shipment'
      WHEN p.kind = 'customer_order' AND d.kind = 'customer_invoice' THEN 'order_to_invoice'
      WHEN p.kind = 'supplier_order' AND d.kind = 'receipt' THEN 'order_to_receipt'
      WHEN p.kind = 'supplier_order' AND d.kind = 'supplier_invoice' THEN 'order_to_invoice'
      WHEN p.kind = 'customer_order' AND d.kind = 'incoming_payment' THEN 'order_to_payment'
      WHEN p.kind = 'supplier_order' AND d.kind = 'payment' THEN 'order_to_payment'
      WHEN p.kind = 'customer_invoice' AND d.kind = 'incoming_payment' THEN 'invoice_to_payment'
      WHEN p.kind = 'work_order' AND d.kind = 'incoming_payment' THEN 'order_to_payment'
      ELSE p.kind || '_to_' || d.kind
    END
  FROM documents d
  JOIN documents p ON p.id = d.parent_document_id
  WHERE d.parent_document_id IS NOT NULL;

  INSERT OR IGNORE INTO document_relations (organization_id, parent_document_id, child_document_id, relation_type)
  SELECT pa.organization_id, pa.target_document_id, pa.payment_document_id,
    CASE
      WHEN d.kind = 'customer_order' THEN 'order_to_payment'
      WHEN d.kind = 'customer_invoice' THEN 'invoice_to_payment'
      WHEN d.kind = 'work_order' THEN 'order_to_payment'
      ELSE d.kind || '_to_payment'
    END
  FROM payment_allocations pa
  JOIN documents d ON d.id = pa.target_document_id;
`);
const vehicleColumns = db.pragma("table_info(vehicles)") as Array<{ name: string }>;
if (!vehicleColumns.some((column) => column.name === "current_mileage")) db.exec("ALTER TABLE vehicles ADD COLUMN current_mileage INTEGER NOT NULL DEFAULT 0");
if (!vehicleColumns.some((column) => column.name === "initial_mileage")) {
  db.exec("ALTER TABLE vehicles ADD COLUMN initial_mileage INTEGER NOT NULL DEFAULT 0");
  db.exec("UPDATE vehicles SET initial_mileage = current_mileage");
}

const app = express();
const trustProxy = process.env.TRUST_PROXY?.trim();
if (trustProxy && trustProxy.toLowerCase() !== "false") app.set("trust proxy", trustProxy);
app.use(express.json({ limit: "12mb" }));
const setupToken = process.env.SETUP_TOKEN || (process.env.NODE_ENV === "production" ? "" : randomBytes(24).toString("base64url"));
if (setupToken && !process.env.SETUP_TOKEN) console.warn(`Первичная настройка владельца (одноразовый токен): ${setupToken}`);
registerAuthRoutes(app, db, { setupToken });
initializeDepartmentScopeSchema(db);
app.get("/api/health", (_req, res) => res.json({ ok: true, database: "sqlite" }));
app.use("/api", authMiddleware(db), requireAuth, requirePasswordUpdated, requireApiPermission);
registerDepartmentScopeRoutes(app, db);
registerProductGroupRoutes(app, db, recordAudit);
initializePriceListSchema(db);
registerPriceListRoutes(app, db, recordAudit);

initializePayrollSchema(db);
registerPayrollRoutes(app, db, recordAudit);

initializeDiscountsLoyaltySchema(db);
registerDiscountsLoyaltyRoutes(app, db, recordAudit);

registerProcurementRoutes(app, db, recordAudit);

initializeTaxInvoicesSchema(db);
registerTaxInvoicesRoutes(app, db, recordAudit);

registerAnalyticsRoutes(app, db);

initializeAutomationSchema(db);
registerAutomationRoutes(app, db, recordAudit);

initializeFilesSchema(db);
registerFilesRoutes(app, db, recordAudit);

function requireApiPermission(req: Request, res: Response, next: NextFunction) {
  const route = req.path;
  const method = req.method.toUpperCase();
  let permission: AuthPermission | undefined;

  if (route.startsWith("/auth/")) return next();
  const scopedUser = req.auth && !isUnrestricted(req.auth);
  const unscopedModules = ["/dashboard", "/reports", "/analytics", "/audit", "/payroll", "/retail", "/procurement", "/tax-invoices", "/automation", "/trash", "/files", "/organization", "/bank-accounts", "/contracts", "/price-lists"];
  if (scopedUser && unscopedModules.some((prefix) => route === prefix || route.startsWith(`${prefix}/`))) {
    return res.status(403).json({ error: "Этот раздел пока не учитывает доступ по подразделениям." });
  }
  if (scopedUser && /^\/counterparties\/\d+\/(contracts|bank-accounts)(\/|$)/.test(route)) {
    return res.status(403).json({ error: "Доступ к договорам и банковским счетам не настроен для подразделений." });
  }
  const documentRouteMatch = /^\/documents\/(\d+)(?:\/|$)/.exec(route);
  if (scopedUser && documentRouteMatch && !assertRequestDocumentAccess(db, req, Number(documentRouteMatch[1]))) {
    return res.status(404).json({ error: "Документ не найден." });
  }
  if (route.startsWith("/departments")) permission = method === "GET" ? "catalog:read" : "organization:manage";
  else if (route === "/dashboard" || route.startsWith("/reports/") || route.startsWith("/analytics/") || route.startsWith("/audit")) permission = "reports:read";
  else if (route.startsWith("/payroll")) {
    permission = method === "GET" ? "reports:read" : "organization:manage";
  } else if (route.startsWith("/discounts") || route.startsWith("/loyalty")) {
    permission = method === "GET" ? "catalog:read" : "catalog:write";
  } else if (route.startsWith("/procurement")) {
    permission = method === "GET" ? "reports:read" : "documents:create";
  } else if (route.startsWith("/tax-invoices")) {
    permission = method === "GET" ? "documents:read" : "documents:create";
  } else if (route.startsWith("/automation")) {
    permission = "organization:manage";
  } else if (route.startsWith("/files")) {
    permission = method === "GET" ? "catalog:read" : "catalog:write";
  } else if (route.startsWith("/trash")) {
    permission = method === "GET" ? "documents:read" : "organization:manage";
  } else if (route.startsWith("/retail")) {
    permission = method === "GET" ? "documents:read" : "documents:create";
  } else if (route === "/documents" || route.startsWith("/documents/")) {
    if (method === "GET") {
      permission = "documents:read";
      if (req.auth?.role === "employee") {
        const detailMatch = /^\/documents\/(\d+)($|\/)/.exec(route);
        const documentKind = detailMatch
          ? (db.prepare("SELECT kind FROM documents WHERE id = ? AND organization_id = 1").get(Number(detailMatch[1])) as { kind: string } | undefined)?.kind
          : String(req.query.kind ?? "");
        if (documentKind !== "work_order") return res.status(403).json({ error: "Сотрудник может открывать только заказ-наряды." });
      }
    } else if (/^\/documents\/(\d+)\/(post|unpost)$/.test(route)) {
      permission = "documents:post";
      if (req.auth?.role === "employee") {
        const documentId = Number(route.match(/^\/documents\/(\d+)\//)?.[1]);
        const document = db.prepare("SELECT kind FROM documents WHERE id = ? AND organization_id = 1").get(documentId) as { kind: string } | undefined;
        if (document?.kind !== "work_order") return res.status(403).json({ error: "Сотрудник может проводить только заказ-наряды." });
      }
    } else {
      permission = "documents:create";
      if (req.auth?.role === "employee" && method === "POST" && route === "/documents/bulk-status") {
        if (!Array.isArray(req.body?.ids) || !req.body.ids.length) return res.status(400).json({ error: "Не выбраны документы." });
        for (const value of req.body.ids) {
          const id = Number(value);
          const document = db.prepare("SELECT kind FROM documents WHERE id = ? AND organization_id = ?").get(id, req.auth.organizationId) as { kind: string } | undefined;
          if (document?.kind !== "work_order") return res.status(403).json({ error: "Сотрудник может выполнять массовые действия только с заказ-нарядами." });
        }
      }
      if (req.auth?.role === "employee" && (route.includes("/create-child") || (method === "POST" && route === "/documents" && req.body?.kind !== "work_order"))) {
        return res.status(403).json({ error: "Сотрудник может создавать только заказ-наряды." });
      }
      if (req.auth?.role === "employee" && ["PATCH", "DELETE"].includes(method)) {
        const detailMatch = /^\/documents\/(\d+)($|\/)/.exec(route);
        const documentKind = detailMatch
          ? (db.prepare("SELECT kind FROM documents WHERE id = ? AND organization_id = 1").get(Number(detailMatch[1])) as { kind: string } | undefined)?.kind
          : "";
        if (documentKind !== "work_order") return res.status(403).json({ error: "Сотрудник может изменять только заказ-наряды." });
      }
    }
  } else if (/^\/(products|product-groups|price-lists|counterparties|contracts|bank-accounts|organization|document-statuses|vehicles|warehouses|stock)(\/|$)/.test(route)) {
    if (method === "GET") permission = "catalog:read";
    else if (req.auth?.role === "employee" && method === "POST" && ["/counterparties", "/vehicles"].includes(route)) permission = "documents:create";
    else permission = "catalog:write";
    if (req.auth?.role === "employee" && method === "POST" && route === "/counterparties" && req.body?.kind !== undefined && req.body.kind !== "customer") {
      return res.status(403).json({ error: "Сотрудник может создавать только карточки клиентов." });
    }
    if (req.auth?.role === "employee" && method === "POST" && route === "/vehicles") {
      const customerId = Number(req.body?.counterpartyId);
      const customer = db.prepare("SELECT kind FROM counterparties WHERE id = ? AND organization_id = 1 AND active = 1").get(customerId) as { kind: string } | undefined;
      if (!customer || !["customer", "both"].includes(customer.kind)) return res.status(403).json({ error: "Автомобиль сотрудника должен быть привязан к клиенту." });
    }
  }

  if (!permission) return res.status(403).json({ error: "Маршрут API не настроен для доступа." });
  return requirePermission(permission)(req, res, next);
}

function parseUnits(value: unknown): number {
  const input = String(value ?? "0").trim().replace(",", ".");
  if (!/^\d+(\.\d{1,6})?$/.test(input)) throw new Error("Количество должно быть положительным числом до 6 знаков после запятой.");
  const [whole, fraction = ""] = input.split(".");
  const units = Number(BigInt(whole) * 1_000_000n + BigInt((fraction + "000000").slice(0, 6)));
  if (!Number.isSafeInteger(units) || units <= 0) throw new Error("Количество должно быть больше нуля.");
  return units;
}

function parseOptionalUnits(value: unknown, label: string): number {
  if (value == null || String(value).trim() === "") return 0;
  const input = String(value).trim().replace(",", ".");
  if (!/^\d+(\.\d{1,6})?$/.test(input)) throw new Error(`Проверьте поле «${label}».`);
  const [whole, fraction = ""] = input.split(".");
  const units = Number(BigInt(whole) * 1_000_000n + BigInt((fraction + "000000").slice(0, 6)));
  if (!Number.isSafeInteger(units)) throw new Error(`Проверьте поле «${label}».`);
  return units;
}

function parseSignedUnits(value: unknown, label = "Количество"): number {
  if (value == null || String(value).trim() === "") return 0;
  const raw = String(value).trim().replace(",", ".");
  const isNegative = raw.startsWith("-");
  const input = isNegative ? raw.slice(1).trim() : raw;
  if (!/^\d+(\.\d{1,6})?$/.test(input)) throw new Error(`Проверьте поле «${label}».`);
  const [whole, fraction = ""] = input.split(".");
  const units = Number(BigInt(whole) * 1_000_000n + BigInt((fraction + "000000").slice(0, 6)));
  if (!Number.isSafeInteger(units)) throw new Error(`Проверьте поле «${label}».`);
  return isNegative ? -units : units;
}

function parseMilli(value: unknown, label: string): number {
  const input = String(value ?? "0").trim().replace(",", ".");
  if (!/^\d+(\.\d{1,3})?$/.test(input)) throw new Error(`Проверьте поле «${label}».`);
  const milli = Math.round(Number(input) * 1000);
  if (!Number.isSafeInteger(milli)) throw new Error(`Проверьте поле «${label}».`);
  return milli;
}

function productGroupPath(groupId: number, organizationId = 1): string {
  const parts: string[] = [];
  const visited = new Set<number>();
  let currentId: number | null = groupId;
  while (currentId != null && !visited.has(currentId)) {
    visited.add(currentId);
    const group = db.prepare("SELECT parent_id, name FROM product_groups WHERE id = ? AND organization_id = ?")
      .get(currentId, organizationId) as { parent_id: number | null; name: string } | undefined;
    if (!group) break;
    parts.unshift(group.name);
    currentId = group.parent_id;
  }
  return parts.join(" / ");
}

function productFields(body: Record<string, unknown>, existing?: Record<string, unknown>) {
  const aliases: Record<string, string> = {
    externalCode: "external_code", groupName: "group_name", groupId: "group_id", supplierId: "supplier_id", weight: "weight_milli",
    volume: "volume_milli", vatRate: "vat_rate", purchasePrice: "purchase_price_tiyin", salePrice: "sale_price_tiyin",
    minimumPrice: "minimum_price_tiyin", retailDiscountAllowed: "retail_discount_allowed", minStock: "min_stock_units",
    minStockMode: "min_stock_mode", packagingUnit: "packaging_unit", accountingType: "accounting_type",
    traceable: "traceable", productType: "product_type", taxSystem: "tax_system",
    calculationSubject: "calculation_subject", accessEmployee: "access_employee", accessDepartment: "access_department",
    sharedAccess: "shared_access",
  };
  const value = (key: string, fallback: unknown = "") => body[key] == null ? (existing?.[aliases[key] ?? key] ?? fallback) : body[key];
  const price = (bodyKey: string, existingKey: string) => body[bodyKey] == null
    ? Number(existing?.[existingKey] ?? 0) : parseTiyin(body[bodyKey]);
  const decimal = (bodyKey: string, existingKey: string, scale: number) => body[bodyKey] == null
    ? Number(existing?.[existingKey] ?? 0) / scale : parseMilli(body[bodyKey], bodyKey === "weight" ? "Вес" : "Объём");
  const units = body.minStock == null
    ? Number(existing?.min_stock_units ?? 0) : parseOptionalUnits(body.minStock, "Неснижаемый остаток");
  const kind = value("kind", "product") === "service" ? "service" : "product";
  const minStockMode = String(value("minStockMode", "total"));
  if (!["total", "same", "per_warehouse"].includes(minStockMode)) throw new Error("Выберите способ расчёта неснижаемого остатка.");
  const groupIdValue = value("groupId", null);
  const groupId = groupIdValue === "" || groupIdValue == null ? null : Number(groupIdValue);
  if (groupId != null && (!Number.isSafeInteger(groupId) || !db.prepare("SELECT id FROM product_groups WHERE id = ? AND organization_id = 1").get(groupId))) {
    throw new Error("Выберите группу из списка.");
  }
  const supplierIdValue = value("supplierId", null);
  const supplierId = supplierIdValue === "" || supplierIdValue == null ? null : Number(supplierIdValue);
  if (supplierId != null && !db.prepare("SELECT id FROM counterparties WHERE id = ? AND organization_id = 1 AND active = 1 AND kind IN ('supplier','both')").get(supplierId)) {
    throw new Error("Выберите активного поставщика.");
  }
  return {
    code: String(value("code", "")).trim(), article: String(value("article")).trim(), external_code: String(value("externalCode")).trim(),
    name: assertText(value("name"), "Наименование"), kind, description: String(value("description")).trim(),
    group_id: groupId, group_name: body.groupId != null ? (groupId == null ? "" : productGroupPath(groupId)) : String(value("groupName")).trim(),
    country: String(value("country")).trim(), supplier_id: supplierId,
    unit: assertText(value("unit", "шт"), "Единица измерения"), weight_milli: decimal("weight", "weight_milli", 1000),
    volume_milli: decimal("volume", "volume_milli", 1000), vat_rate: String(value("vatRate")).trim(),
    purchase_price_tiyin: price("purchasePrice", "purchase_price_tiyin"), sale_price_tiyin: price("salePrice", "sale_price_tiyin"),
    minimum_price_tiyin: price("minimumPrice", "minimum_price_tiyin"), retail_discount_allowed: value("retailDiscountAllowed", 1) ? 1 : 0,
    min_stock_units: units, min_stock_mode: minStockMode,
    packaging_unit: String(value("packagingUnit")).trim(), accounting_type: String(value("accountingType")).trim(),
    ntin: String(value("ntin")).trim(), traceable: value("traceable", 0) ? 1 : 0, marking: String(value("marking")).trim(),
    product_type: String(value("productType")).trim(), tax_system: String(value("taxSystem")).trim(),
    calculation_subject: String(value("calculationSubject", "Товар")).trim(),
    access_employee: String(value("accessEmployee")).trim(), access_department: String(value("accessDepartment")).trim(),
    shared_access: value("sharedAccess", 1) ? 1 : 0,
  };
}

function effectiveProductVatRate(productId: number, organizationId = 1): string {
  const product = db.prepare("SELECT vat_rate, group_id FROM products WHERE id = ? AND organization_id = ?")
    .get(productId, organizationId) as { vat_rate: string; group_id: number | null } | undefined;
  if (!product) return "";
  if (String(product.vat_rate ?? "").trim()) return String(product.vat_rate).trim();
  const visited = new Set<number>();
  let groupId = product.group_id;
  while (groupId != null && !visited.has(groupId)) {
    visited.add(groupId);
    const group = db.prepare("SELECT parent_id, vat_rate FROM product_groups WHERE id = ? AND organization_id = ?")
      .get(groupId, organizationId) as { parent_id: number | null; vat_rate: string } | undefined;
    if (!group) break;
    if (String(group.vat_rate ?? "").trim()) return String(group.vat_rate).trim();
    groupId = group.parent_id;
  }
  return "";
}

function validateBarcode(barcodeType: string, barcode: string) {
  const valid = barcodeType === "EAN13" ? /^\d{13}$/.test(barcode)
    : barcodeType === "EAN8" ? /^\d{8}$/.test(barcode)
      : barcodeType === "UPC" ? /^\d{12}$/.test(barcode)
        : barcodeType === "CODE128" ? /^[\x20-\x7E]{1,80}$/.test(barcode)
          : false;
  if (!valid) throw new Error(`Штрихкод не соответствует типу ${barcodeType}.`);
}

function saveProductChildren(productId: number, body: Record<string, unknown>, auth?: AuthContext) {
  const barcodes = Array.isArray(body.barcodes) ? body.barcodes as Array<Record<string, unknown>> : [];
  const packaging = Array.isArray(body.packaging) ? body.packaging as Array<Record<string, unknown>> : [];
  const relations = Array.isArray(body.relations) ? body.relations as Array<Record<string, unknown>> : [];
  const minima = Array.isArray(body.warehouseMinima) ? body.warehouseMinima as Array<Record<string, unknown>> : [];
  const prices = Array.isArray(body.priceTiers) ? body.priceTiers as Array<Record<string, unknown>> : [];
  if (Array.isArray(body.barcodes)) {
    db.prepare("DELETE FROM product_barcodes WHERE product_id = ?").run(productId);
    const insertBarcode = db.prepare("INSERT INTO product_barcodes (product_id, barcode_type, barcode) VALUES (?, ?, ?)");
    for (const row of barcodes) {
      const barcode = String(row.barcode ?? "").trim();
      if (!barcode) continue;
      const barcodeType = String(row.barcodeType ?? "EAN13");
      validateBarcode(barcodeType, barcode);
      insertBarcode.run(productId, barcodeType, barcode);
    }
  }
  if (Array.isArray(body.packaging)) {
    db.prepare("DELETE FROM product_packaging WHERE product_id = ?").run(productId);
    const insertPackaging = db.prepare(`INSERT INTO product_packaging
      (product_id, name, quantity_units, unit, code_type, barcode) VALUES (?, ?, ?, ?, ?, ?)`);
    for (const row of packaging) {
      const name = String(row.name ?? "").trim();
      const quantity = parseOptionalUnits(row.quantity, "Количество в упаковке");
      if (!name && !quantity) continue;
      if (!name || !quantity) throw new Error("Заполните наименование и количество упаковки.");
      const codeType = String(row.codeType ?? "").trim(); const barcode = String(row.barcode ?? "").trim();
      if (barcode) validateBarcode(codeType, barcode);
      insertPackaging.run(productId, name, quantity, String(row.unit ?? "").trim(), codeType, barcode);
    }
  }
  if (Array.isArray(body.relations)) {
    db.prepare("DELETE FROM product_relations WHERE product_id = ?").run(productId);
    const insertRelation = db.prepare("INSERT INTO product_relations (product_id, related_product_id, relation_type) VALUES (?, ?, ?)");
    for (const row of relations) {
      const relatedId = Number(row.relatedProductId);
      const relationType = String(row.relationType ?? "");
      if (!relatedId) continue;
      if (!["analogue", "modification"].includes(relationType)) throw new Error("Проверьте тип связи товара.");
      if (!db.prepare("SELECT id FROM products WHERE id = ? AND organization_id = 1 AND id <> ?").get(relatedId, productId)) throw new Error("Связанный товар не найден.");
      insertRelation.run(productId, relatedId, relationType);
    }
  }
  if (Array.isArray(body.priceTiers)) {
    const seenPriceNames = new Set<string>();
    for (const row of prices) {
      const name = String(row.name ?? "").trim();
      if (!name) continue;
      const key = name.normalize("NFKC").toLocaleLowerCase("ru");
      if (seenPriceNames.has(key)) throw new Error(`Название типа цены «${name}» уже используется.`);
      seenPriceNames.add(key);
    }
    db.prepare("DELETE FROM product_prices WHERE product_id = ?").run(productId);
    const insertPrice = db.prepare("INSERT INTO product_prices (product_id, name, price_tiyin, currency, position) VALUES (?, ?, ?, ?, ?)");
    prices.forEach((row, position) => {
      const name = String(row.name ?? "").trim();
      if (!name) return;
      insertPrice.run(productId, name, parseTiyin(row.price), String(row.currency ?? "KZT"), position);
    });
  }
  if (Array.isArray(body.warehouseMinima) || "minStockMode" in body || "minStock" in body) {
    const productMinimum = db.prepare("SELECT min_stock_mode, min_stock_units FROM products WHERE id = ?").get(productId) as { min_stock_mode: string; min_stock_units: number };
    const restricted = auth != null && !isUnrestricted(auth);
    const allowedWarehouseIds = auth ? getAccessibleActiveWarehouseIds(db, auth) : null;
    if (restricted && productMinimum.min_stock_mode === "per_warehouse") {
      const accessible = allowedWarehouseIds ?? [];
      if (accessible.length) db.prepare(`DELETE FROM product_warehouse_minima WHERE product_id = ? AND warehouse_id IN (${accessible.map(() => "?").join(",")})`)
        .run(productId, ...accessible);
      const insertMinimum = db.prepare("INSERT INTO product_warehouse_minima (product_id, warehouse_id, min_stock_units) VALUES (?, ?, ?)");
      for (const row of minima) {
        const warehouseId = Number(row.warehouseId);
        const minimum = parseOptionalUnits(row.minStock, "Минимум на складе");
        if (!warehouseId || !minimum) continue;
        if (!accessible.includes(warehouseId)) throw new Error("Можно менять минимальный остаток только для складов назначенных подразделений.");
        insertMinimum.run(productId, warehouseId, minimum);
      }
    } else if (!restricted && productMinimum.min_stock_mode === "same" && productMinimum.min_stock_units > 0) {
      db.prepare("DELETE FROM product_warehouse_minima WHERE product_id = ?").run(productId);
      const insertMinimum = db.prepare("INSERT INTO product_warehouse_minima (product_id, warehouse_id, min_stock_units) VALUES (?, ?, ?)");
      for (const warehouse of db.prepare("SELECT id FROM warehouses WHERE organization_id = 1 AND active = 1").all() as Array<{ id: number }>) {
        insertMinimum.run(productId, warehouse.id, productMinimum.min_stock_units);
      }
    } else if (!restricted && productMinimum.min_stock_mode === "per_warehouse") {
      db.prepare("DELETE FROM product_warehouse_minima WHERE product_id = ?").run(productId);
      const insertMinimum = db.prepare("INSERT INTO product_warehouse_minima (product_id, warehouse_id, min_stock_units) VALUES (?, ?, ?)");
      for (const row of minima) {
        const warehouseId = Number(row.warehouseId);
        const minimum = parseOptionalUnits(row.minStock, "Минимум на складе");
        if (!warehouseId || !minimum) continue;
        if (!db.prepare("SELECT id FROM warehouses WHERE id = ? AND organization_id = 1 AND active = 1").get(warehouseId)) throw new Error("Склад не найден.");
        insertMinimum.run(productId, warehouseId, minimum);
      }
    } else if (!restricted) {
      db.prepare("DELETE FROM product_warehouse_minima WHERE product_id = ?").run(productId);
    }
  }
}

function parseTiyin(value: unknown): number {
  const input = String(value ?? "0").trim().replace(/\s/g, "").replace(",", ".");
  const match = /^(\d+)(?:\.(\d+))?$/.exec(input);
  if (!match) throw new Error("Проверьте цену.");
  const wholeText = match[1].replace(/^0+(?=\d)/, "");
  if (wholeText.length > 13) throw new Error("Проверьте цену.");
  const fraction = match[2] ?? "";
  let amountTiyin = BigInt(wholeText) * 100n + BigInt((fraction + "00").slice(0, 2));
  if (fraction[2] != null && fraction[2] >= "5") amountTiyin += 1n;
  if (amountTiyin > 900_000_000_000_000n) throw new Error("Проверьте цену.");
  return Number(amountTiyin);
}

type PaymentAllocation = { documentId: number; amountTiyin: number };

function normalizeIncomingPaymentAllocations(values: unknown, amountTiyin: number, counterpartyId: number | null, excludePaymentId = 0): PaymentAllocation[] {
  if (!counterpartyId) throw new Error("Для входящего платежа выберите клиента.");
  if (!Array.isArray(values) || !values.length) throw new Error("Привяжите платёж хотя бы к одному документу.");
  const allocations: PaymentAllocation[] = [];
  const seen = new Set<number>();
  let totalAllocated = 0;
  for (const value of values) {
    const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
    const documentId = Number(row.documentId ?? row.document_id);
    const allocationAmount = Number(row.amountTiyin ?? row.amount_tiyin);
    if (!Number.isSafeInteger(documentId) || documentId <= 0 || !Number.isSafeInteger(allocationAmount) || allocationAmount <= 0) {
      throw new Error("Укажите корректный документ и сумму оплаты.");
    }
    if (seen.has(documentId)) throw new Error("Документ можно указать в распределении только один раз.");
    seen.add(documentId);
    const order = db.prepare(`SELECT total_tiyin, counterparty_id, kind, status FROM documents
      WHERE id = ? AND organization_id = 1`).get(documentId) as { total_tiyin: number; counterparty_id: number | null; kind: string; status: string } | undefined;
    const validKinds = new Set(["work_order", "customer_order", "customer_invoice", "supplier_order", "supplier_invoice", "shipment"]);
    if (!order || !validKinds.has(order.kind) || order.status !== "posted") throw new Error("Оплату можно привязать только к проведённому документу.");
    if (order.counterparty_id && counterpartyId && order.counterparty_id !== counterpartyId) throw new Error("Клиент платежа должен совпадать с контрагентом документа.");
    const paid = db.prepare(`SELECT COALESCE(SUM(pa.amount_tiyin), 0) AS total FROM payment_allocations pa
      JOIN documents payment ON payment.id = pa.payment_document_id
      WHERE pa.target_document_id = ? AND payment.kind IN ('incoming_payment', 'payment') AND payment.status = 'posted'
        AND payment.id <> ?`).get(documentId, excludePaymentId) as { total: number };
    if (Number(paid.total) + allocationAmount > Number(order.total_tiyin)) throw new Error("Сумма оплаты превышает остаток по документу.");
    totalAllocated += allocationAmount;
    allocations.push({ documentId, amountTiyin: allocationAmount });
  }
  if (!Number.isSafeInteger(totalAllocated) || totalAllocated !== amountTiyin) {
    throw new Error("Сумма распределения должна совпадать с суммой входящего платежа.");
  }
  return allocations;
}

function parseDiscountBps(value: unknown): number {
  if (value == null || value === "") return 0;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return 0;
    return Math.max(0, Math.min(10000, Math.round(value)));
  }
  const str = String(value).trim().replace("%", "").replace(",", ".");
  const num = Number(str);
  if (!Number.isFinite(num) || num <= 0) return 0;
  if (String(value).includes("%") || num <= 100) {
    return Math.max(0, Math.min(10000, Math.round(num * 100)));
  }
  return Math.max(0, Math.min(10000, Math.round(num)));
}

function parseVatRateNumber(vatRate: unknown): number {
  if (vatRate == null) return 0;
  const str = String(vatRate).trim();
  if (str === "" || str === "без НДС" || str === "NO_VAT" || str === "0") return 0;
  const match = str.match(/(\d+(\.\d+)?)/);
  if (!match) return 0;
  const rate = Number(match[1]);
  return Number.isFinite(rate) && rate > 0 ? rate : 0;
}

function calculateLineFinancials(
  quantityUnits: number,
  unitPriceTiyin: number,
  discountBps: number,
  vatRate: string,
  isVatIncluded = true
) {
  const baseTotalTiyin = Math.round((quantityUnits * unitPriceTiyin) / 1_000_000);
  const discountTiyin = Math.round((baseTotalTiyin * discountBps) / 10000);
  const effectiveTotalTiyin = Math.max(0, baseTotalTiyin - discountTiyin);
  const rateNum = parseVatRateNumber(vatRate);

  let vatSumTiyin = 0;
  let totalWithoutVatTiyin = effectiveTotalTiyin;
  let lineTotalTiyin = effectiveTotalTiyin;

  if (rateNum > 0) {
    if (isVatIncluded) {
      totalWithoutVatTiyin = Math.round((effectiveTotalTiyin * 100) / (100 + rateNum));
      vatSumTiyin = effectiveTotalTiyin - totalWithoutVatTiyin;
      lineTotalTiyin = effectiveTotalTiyin;
    } else {
      totalWithoutVatTiyin = effectiveTotalTiyin;
      vatSumTiyin = Math.round((effectiveTotalTiyin * rateNum) / 100);
      lineTotalTiyin = effectiveTotalTiyin + vatSumTiyin;
    }
  }

  return {
    baseTotalTiyin,
    discountTiyin,
    effectiveTotalTiyin,
    vatSumTiyin,
    totalWithoutVatTiyin,
    lineTotalTiyin,
  };
}

function determineRelationType(parentKind: string, childKind: string): string {
  if (parentKind === "stocktake" && childKind === "enter") return "stocktake_to_enter";
  if (parentKind === "stocktake" && childKind === "writeoff") return "stocktake_to_writeoff";
  if (parentKind === "customer_order" && childKind === "shipment") return "order_to_shipment";
  if (parentKind === "customer_order" && childKind === "customer_invoice") return "order_to_invoice";
  if (parentKind === "customer_order" && (childKind === "incoming_payment" || childKind === "payment")) return "order_to_payment";
  if (parentKind === "supplier_order" && childKind === "receipt") return "order_to_receipt";
  if (parentKind === "supplier_order" && childKind === "supplier_invoice") return "order_to_invoice";
  if (parentKind === "supplier_order" && (childKind === "payment" || childKind === "incoming_payment")) return "order_to_payment";
  if (parentKind === "customer_invoice" && (childKind === "incoming_payment" || childKind === "payment")) return "invoice_to_payment";
  if (parentKind === "customer_invoice" && childKind === "shipment") return "invoice_to_shipment";
  if (parentKind === "supplier_invoice" && (childKind === "payment" || childKind === "incoming_payment")) return "invoice_to_payment";
  if (parentKind === "supplier_invoice" && childKind === "receipt") return "invoice_to_receipt";
  if (parentKind === "work_order" && (childKind === "incoming_payment" || childKind === "payment")) return "order_to_payment";
  if (parentKind === "work_order" && childKind === "customer_invoice") return "order_to_invoice";
  if (parentKind === "shipment" && (childKind === "incoming_payment" || childKind === "payment")) return "shipment_to_payment";
  if (parentKind === "receipt" && (childKind === "payment" || childKind === "incoming_payment")) return "receipt_to_payment";
  return `${parentKind}_to_${childKind}`;
}

function calculateDocumentProgress(documentId: number, organizationId = 1, auth?: Request["auth"]) {
  const doc = db.prepare("SELECT * FROM documents WHERE id = ? AND organization_id = ?").get(documentId, organizationId) as Record<string, unknown> | undefined;
  if (!doc) {
    return { shipped_percent: 0, paid_percent: 0, total_quantity_units: 0, shipped_quantity_units: 0, total_tiyin: 0, paid_tiyin: 0, outstanding_tiyin: 0 };
  }

  const lines = db.prepare("SELECT quantity_units, unit_price_tiyin FROM document_lines WHERE document_id = ?").all(documentId) as Array<{ quantity_units: number; unit_price_tiyin: number }>;
  const totalQuantityUnits = lines.reduce((sum, l) => sum + Number(l.quantity_units), 0);

  let shippedQuantityUnits = 0;
  const relationScope = auth ? scopedDocumentFilterLiteral(db, auth, "child") : "";
  const directShipmentScope = auth ? scopedDocumentFilterLiteral(db, auth, "d") : "";
  const paymentScope = auth ? scopedDocumentFilterLiteral(db, auth, "payment") : "";
  if (doc.status === "posted" && (doc.kind === "work_order" || doc.kind === "shipment" || doc.kind === "receipt")) {
    shippedQuantityUnits = totalQuantityUnits;
  } else {
    const shippedRows = db.prepare(`
      SELECT COALESCE(SUM(child_lines.quantity_units), 0) AS shipped
      FROM document_relations dr
      JOIN documents child ON child.id = dr.child_document_id
      JOIN document_lines child_lines ON child_lines.document_id = child.id
      WHERE dr.parent_document_id = ?
        AND child.status = 'posted'
        AND dr.relation_type IN ('order_to_shipment', 'order_to_receipt', 'invoice_to_shipment') ${relationScope}
    `).get(documentId) as { shipped: number };

    const directShippedRows = db.prepare(`
      SELECT COALESCE(SUM(l.quantity_units), 0) AS shipped
      FROM documents d
      JOIN document_lines l ON l.document_id = d.id
      WHERE d.parent_document_id = ?
        AND d.status = 'posted'
        AND d.kind IN ('shipment', 'receipt')
        AND d.id NOT IN (SELECT child_document_id FROM document_relations WHERE parent_document_id = ?)
        ${directShipmentScope}
    `).get(documentId, documentId) as { shipped: number };

    shippedQuantityUnits = Number(shippedRows.shipped) + Number(directShippedRows.shipped);
  }

  const shipped_percent = totalQuantityUnits > 0
    ? Math.min(100, Math.round((shippedQuantityUnits / totalQuantityUnits) * 100))
    : (shippedQuantityUnits > 0 || (doc.status === "posted" && ["shipment", "receipt", "work_order"].includes(String(doc.kind))) ? 100 : 0);

  const paidRow = db.prepare(`
    SELECT COALESCE(SUM(pa.amount_tiyin), 0) AS paid
    FROM payment_allocations pa
    JOIN documents payment ON payment.id = pa.payment_document_id
    WHERE pa.target_document_id = ? AND payment.status = 'posted' ${paymentScope}
  `).get(documentId) as { paid: number };

  const paid_tiyin = Number(paidRow.paid);
  const total_tiyin = Number(doc.total_tiyin);
  const outstanding_tiyin = Math.max(0, total_tiyin - paid_tiyin);
  const paid_percent = total_tiyin > 0
    ? Math.min(100, Math.round((paid_tiyin / total_tiyin) * 100))
    : (paid_tiyin > 0 ? 100 : 0);

  return {
    shipped_percent,
    paid_percent,
    total_quantity_units: totalQuantityUnits,
    shipped_quantity_units: shippedQuantityUnits,
    total_tiyin,
    paid_tiyin,
    outstanding_tiyin,
  };
}

function getConnectedDocumentChain(documentId: number, organizationId = 1) {
  const visited = new Set<number>([documentId]);
  const queue = [documentId];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const rels = db.prepare(`
      SELECT parent_document_id, child_document_id
      FROM document_relations
      WHERE (parent_document_id = ? OR child_document_id = ?) AND organization_id = ?
    `).all(currentId, currentId, organizationId) as Array<{ parent_document_id: number; child_document_id: number }>;

    for (const r of rels) {
      if (!visited.has(r.parent_document_id)) {
        visited.add(r.parent_document_id);
        queue.push(r.parent_document_id);
      }
      if (!visited.has(r.child_document_id)) {
        visited.add(r.child_document_id);
        queue.push(r.child_document_id);
      }
    }

    const currentDoc = db.prepare("SELECT parent_document_id FROM documents WHERE id = ? AND organization_id = ?").get(currentId, organizationId) as { parent_document_id: number | null } | undefined;
    if (currentDoc?.parent_document_id && !visited.has(currentDoc.parent_document_id)) {
      visited.add(currentDoc.parent_document_id);
      queue.push(currentDoc.parent_document_id);
    }

    const children = db.prepare("SELECT id FROM documents WHERE parent_document_id = ? AND organization_id = ?").all(currentId, organizationId) as Array<{ id: number }>;
    for (const ch of children) {
      if (!visited.has(ch.id)) {
        visited.add(ch.id);
        queue.push(ch.id);
      }
    }

    const allocTargets = db.prepare("SELECT target_document_id FROM payment_allocations WHERE payment_document_id = ? AND organization_id = ?").all(currentId, organizationId) as Array<{ target_document_id: number }>;
    for (const t of allocTargets) {
      if (!visited.has(t.target_document_id)) {
        visited.add(t.target_document_id);
        queue.push(t.target_document_id);
      }
    }

    const allocPayments = db.prepare("SELECT payment_document_id FROM payment_allocations WHERE target_document_id = ? AND organization_id = ?").all(currentId, organizationId) as Array<{ payment_document_id: number }>;
    for (const p of allocPayments) {
      if (!visited.has(p.payment_document_id)) {
        visited.add(p.payment_document_id);
        queue.push(p.payment_document_id);
      }
    }
  }

  const ids = Array.from(visited);
  if (!ids.length) return { document: null, root: null, chain: [], relations: [], progress: null };

  const placeholders = ids.map(() => "?").join(",");
  const documents = db.prepare(`
    SELECT d.id, d.number, d.kind, d.status, d.status_name, d.state, d.date, d.total_tiyin, d.parent_document_id, d.contract_id,
      c.name AS counterparty_name, con.number AS contract_number,
      (SELECT COALESCE(SUM(pa.amount_tiyin), 0) FROM payment_allocations pa
       JOIN documents payment ON payment.id = pa.payment_document_id
       WHERE pa.target_document_id = d.id AND payment.status = 'posted') AS paid_tiyin
    FROM documents d
    LEFT JOIN counterparties c ON c.id = d.counterparty_id
    LEFT JOIN contracts con ON con.id = d.contract_id
    WHERE d.id IN (${placeholders}) AND d.organization_id = ? AND d.status <> 'deleted'
    ORDER BY d.date ASC, d.id ASC
  `).all(...ids, organizationId) as Array<Record<string, unknown>>;

  const relations = db.prepare(`
    SELECT dr.id, dr.parent_document_id, dr.child_document_id, dr.relation_type,
      p.number AS parent_number, p.kind AS parent_kind,
      c.number AS child_number, c.kind AS child_kind
    FROM document_relations dr
    JOIN documents p ON p.id = dr.parent_document_id
    JOIN documents c ON c.id = dr.child_document_id
    WHERE dr.parent_document_id IN (${placeholders}) AND dr.child_document_id IN (${placeholders})
    ORDER BY dr.id
  `).all(...ids, ...ids) as Array<Record<string, unknown>>;

  const targetDoc = documents.find((d) => d.id === documentId) ?? documents[0];
  const rootOrder = documents.find((d) => ["customer_order", "supplier_order", "work_order"].includes(String(d.kind))) ?? targetDoc;
  const progress = rootOrder ? calculateDocumentProgress(Number(rootOrder.id), organizationId) : null;

  return {
    currentDocumentId: documentId,
    document: targetDoc,
    root: rootOrder,
    chain: documents,
    relations,
    progress,
  };
}

function assertText(value: unknown, label: string): string {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`Заполните поле «${label}».`);
  return text;
}

const counterpartyTextFields: Array<[string, string, number]> = [
  ["name", "name", 255], ["phone", "phone", 100], ["email", "email", 254], ["comment", "comment", 4000],
  ["status", "status", 120], ["groupName", "group_name", 255], ["fax", "fax", 100],
  ["actualAddress", "actual_address", 1000], ["addressComment", "address_comment", 1000],
  ["code", "code", 120], ["externalCode", "external_code", 120], ["bin", "bin", 50],
  ["legalName", "legal_name", 1000], ["legalAddress", "legal_address", 1000],
  ["legalAddressComment", "legal_address_comment", 1000], ["oked", "oked", 50], ["kbe", "kbe", 50],
  ["vatCertificateNumber", "vat_certificate_number", 100], ["vatCertificateDate", "vat_certificate_date", 10],
  ["priceType", "price_type", 120], ["discountCard", "discount_card", 120],
];

function counterpartyFields(body: Record<string, unknown>, existing?: Record<string, unknown>) {
  const fields: Record<string, string> = {};
  for (const [input, column, maxLength] of counterpartyTextFields) {
    const raw = body[input] === undefined ? (existing?.[column] ?? (input === "status" ? "Новый" : "")) : body[input];
    if (typeof raw !== "string") throw new Error(`Проверьте поле «${input}».`);
    const text = raw.trim();
    if (text.length > maxLength || (input === "name" && !text)) throw new Error(`Проверьте поле «${input}».`);
    fields[column] = text;
  }
  const kind = String(body.kind ?? existing?.kind ?? "customer");
  if (!["customer", "supplier", "both"].includes(kind)) throw new Error("Выберите тип контрагента.");
  fields.kind = kind;
  const legalType = String(body.legalType ?? existing?.legal_type ?? "legal_entity");
  if (!["legal_entity", "entrepreneur", "individual", "legal_entity_ru", "entrepreneur_ru", "individual_ru"].includes(legalType)) throw new Error("Выберите юридический тип контрагента.");
  fields.legal_type = legalType;
  if (fields.vat_certificate_date) {
    const date = fields.vat_certificate_date;
    const parsed = new Date(`${date}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new Error("Проверьте дату свидетельства НДС.");
  }
  return fields;
}

class CounterpartyRevisionConflict extends Error {
  constructor() { super("Контрагент был изменён в другой сессии. Обновите карточку и повторите изменение."); }
}

function saveCounterpartyContacts(counterpartyId: number, values: unknown) {
  if (!Array.isArray(values) || values.length > 200) throw new Error("Проверьте список контактных лиц.");
  const existing = db.prepare("SELECT id FROM counterparty_contacts WHERE counterparty_id = ?").all(counterpartyId) as Array<{ id: number }>;
  const ownedIds = new Set(existing.map((row) => row.id));
  const retained = new Set<number>();
  const insert = db.prepare("INSERT INTO counterparty_contacts (counterparty_id, full_name, position, phone, email, comment) VALUES (?, ?, ?, ?, ?, ?)");
  const update = db.prepare("UPDATE counterparty_contacts SET full_name = ?, position = ?, phone = ?, email = ?, comment = ? WHERE id = ? AND counterparty_id = ?");
  for (const value of values) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Проверьте контактное лицо.");
    const row = value as Record<string, unknown>;
    const fields = ["fullName", "position", "phone", "email", "comment"].map((key) => {
      const raw = row[key] ?? "";
      if (typeof raw !== "string" || raw.trim().length > (key === "comment" ? 4000 : 255)) throw new Error("Проверьте контактное лицо.");
      return raw.trim();
    });
    if (!fields[0]) throw new Error("Укажите ФИО контактного лица.");
    if (row.id != null) {
      const id = Number(row.id);
      if (!Number.isSafeInteger(id) || !ownedIds.has(id) || retained.has(id)) throw new Error("Контактное лицо не найдено или указано повторно.");
      retained.add(id);
      update.run(...fields, id, counterpartyId);
    } else insert.run(counterpartyId, ...fields);
  }
  for (const row of existing) if (!retained.has(row.id)) db.prepare("DELETE FROM counterparty_contacts WHERE id = ? AND counterparty_id = ?").run(row.id, counterpartyId);
}

function optionalWarehouseText(value: unknown, label: string, maxLength: number): string {
  const text = String(value ?? "").trim();
  if (text.length > maxLength) throw new Error(`Поле «${label}» не должно быть длиннее ${maxLength} символов.`);
  return text;
}

function assertUniqueWarehouseCode(code: string, excludeId?: number) {
  if (!code) return;
  const duplicate = db.prepare(`SELECT id FROM warehouses WHERE organization_id = 1 AND code = ? COLLATE NOCASE
    AND (? IS NULL OR id <> ?) LIMIT 1`).get(code, excludeId ?? null, excludeId ?? null);
  if (duplicate) throw new Error(`Код склада «${code}» уже используется.`);
}

function warehouseHasOperationalReferences(warehouseId: number, organizationId: number): boolean {
  const row = db.prepare(`SELECT
      EXISTS(SELECT 1 FROM documents WHERE organization_id = ? AND (warehouse_id = ? OR destination_warehouse_id = ?))
      OR EXISTS(SELECT 1 FROM stock_movements WHERE warehouse_id = ?)
      OR EXISTS(SELECT 1 FROM stock_reservations WHERE warehouse_id = ?)
      OR EXISTS(SELECT 1 FROM reservation_consumptions WHERE warehouse_id = ?)
      OR EXISTS(SELECT 1 FROM product_warehouse_minima WHERE warehouse_id = ?)
      OR EXISTS(SELECT 1 FROM retail_stores WHERE organization_id = ? AND warehouse_id = ?)
      OR EXISTS(SELECT 1 FROM warehouses WHERE organization_id = ? AND parent_id = ?) AS used`)
    .get(organizationId, warehouseId, warehouseId, warehouseId, warehouseId, warehouseId, warehouseId, organizationId, warehouseId, organizationId, warehouseId) as { used: number };
  return Number(row.used) === 1;
}

function warehouseHasLiveInventory(warehouseId: number): boolean {
  const row = db.prepare(`SELECT
      EXISTS(SELECT 1 FROM stock_movements WHERE warehouse_id = ? GROUP BY product_id HAVING SUM(quantity_units) <> 0)
      OR EXISTS(SELECT 1 FROM stock_reservations WHERE warehouse_id = ?) AS has_inventory`)
    .get(warehouseId, warehouseId) as { has_inventory: number };
  return Number(row.has_inventory) === 1;
}

function assertWarehouseCanBeArchived(warehouseId: number): void {
  if (warehouseHasLiveInventory(warehouseId)) throw new Error("Перед архивацией перенесите остатки и снимите резервы на этом складе.");
  if (db.prepare("SELECT 1 FROM retail_stores WHERE warehouse_id = ? AND active = 1 LIMIT 1").get(warehouseId)) {
    throw new Error("Перед архивацией перенесите активную кассу на другой склад.");
  }
}

function validateWarehouseParent(parentId: number | null, warehouseId?: number) {
  if (parentId == null) return;
  const visited = new Set<number>();
  let cursor: number | null = parentId;
  while (cursor != null) {
    if (cursor === warehouseId) throw new Error("Нельзя включить склад в самого себя или его потомка.");
    if (visited.has(cursor)) throw new Error("В иерархии складов обнаружен цикл.");
    visited.add(cursor);
    const parent = db.prepare("SELECT id, parent_id FROM warehouses WHERE id = ? AND organization_id = 1 AND active = 1")
      .get(cursor) as { id: number; parent_id: number | null } | undefined;
    if (!parent) throw new Error("Выберите активный родительский склад.");
    cursor = parent.parent_id == null ? null : Number(parent.parent_id);
  }
}

function parseWarehouseFields(input: Record<string, unknown>, existing?: Record<string, unknown>, warehouseId?: number) {
  const value = (camel: string, snake: string) => input[camel] !== undefined ? input[camel] : input[snake] !== undefined ? input[snake] : existing?.[snake];
  const name = optionalWarehouseText(value("name", "name"), "Наименование", 200);
  if (!name) throw new Error("Заполните поле «Наименование»." );
  const address = optionalWarehouseText(value("address", "address"), "Адрес", 500);
  const addressComment = optionalWarehouseText(value("addressComment", "address_comment"), "Комментарий к адресу", 500);
  const comment = optionalWarehouseText(value("comment", "comment"), "Комментарий", 2000);
  const code = optionalWarehouseText(value("code", "code"), "Код", 100);
  const externalCode = optionalWarehouseText(value("externalCode", "external_code"), "Внешний код", 150);
  const rawParentId = value("parentId", "parent_id");
  const parentId = rawParentId == null || String(rawParentId).trim() === "" ? null : Number(rawParentId);
  if (parentId != null && (!Number.isSafeInteger(parentId) || parentId <= 0)) throw new Error("Проверьте родительский склад.");
  const rawDepartmentId = value("departmentId", "department_id");
  const departmentId = rawDepartmentId == null || String(rawDepartmentId).trim() === "" ? null : Number(rawDepartmentId);
  if (departmentId == null || !Number.isSafeInteger(departmentId) || departmentId <= 0) throw new Error("Назначьте склад подразделению.");
  if (!db.prepare("SELECT 1 FROM departments WHERE id = ? AND organization_id = 1 AND active = 1").get(departmentId)) throw new Error("Выберите активное подразделение этой организации.");
  validateWarehouseParent(parentId, warehouseId);
  return { name, address, address_comment: addressComment, comment, code, external_code: externalCode, parent_id: parentId, department_id: departmentId };
}

function assertUniqueProductCode(code: string, excludeId?: number) {
  if (!code) return;
  const duplicate = db.prepare(`SELECT id FROM products WHERE organization_id = 1 AND code = ? COLLATE NOCASE
    AND (? IS NULL OR id <> ?) LIMIT 1`).get(code, excludeId ?? null, excludeId ?? null);
  if (duplicate) throw new Error(`Код «${code}» уже используется. Укажите другой код.`);
}

function nextProductCode(organizationId = 1): string {
  const row = db.prepare("SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM products WHERE organization_id = ?").get(organizationId) as { next_id: number };
  let nextId = row.next_id;
  let code = String(nextId).padStart(5, "0");
  while (db.prepare("SELECT 1 FROM products WHERE organization_id = ? AND code = ? COLLATE NOCASE LIMIT 1").get(organizationId, code)) {
    code = String(++nextId).padStart(5, "0");
  }
  return code;
}

function parseMileage(value: unknown, label: string, required = false): number | null {
  if ((value == null || String(value).trim() === "") && !required) return null;
  const mileage = Number(value);
  if (!Number.isSafeInteger(mileage) || mileage < 0 || mileage > 10_000_000) throw new Error(`Проверьте поле «${label}».`);
  return mileage;
}

function recordAudit(entityType: string, entityId: number, action: string, detail = "", organizationId = 1) {
  db.prepare(`INSERT INTO audit_log (organization_id, entity_type, entity_id, action, detail)
    VALUES (?, ?, ?, ?, ?)`)
    .run(organizationId, entityType, entityId, action, detail);
}

app.get("/api/dashboard", (req, res) => {
  const today = String(req.query.today ?? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty" }).format(new Date()));
  const from = String(req.query.from ?? today);
  const to = String(req.query.to ?? today);
  const period = String(req.query.period ?? "week");
  const bucket = period === "year" ? "substr(date, 1, 7)" : "date";
  const stock = db.prepare(`SELECT COUNT(DISTINCT p.id) AS products,
      COALESCE(SUM(CASE
        WHEN p.min_stock_mode = 'total' AND p.min_stock_units > 0 AND COALESCE(s.quantity_units, 0) <= p.min_stock_units THEN 1
        WHEN p.min_stock_mode = 'same' AND p.min_stock_units > 0 AND EXISTS (
          SELECT 1 FROM warehouses w LEFT JOIN stock_movements sm ON sm.warehouse_id = w.id AND sm.product_id = p.id
          WHERE w.organization_id = p.organization_id AND w.active = 1 GROUP BY w.id HAVING COALESCE(SUM(sm.quantity_units), 0) <= p.min_stock_units
        ) THEN 1
        WHEN p.min_stock_mode = 'per_warehouse' AND EXISTS (
          SELECT 1 FROM product_warehouse_minima m LEFT JOIN stock_movements sm ON sm.warehouse_id = m.warehouse_id AND sm.product_id = m.product_id
          WHERE m.product_id = p.id GROUP BY m.warehouse_id HAVING m.min_stock_units > 0 AND COALESCE(SUM(sm.quantity_units), 0) <= m.min_stock_units
        ) THEN 1 ELSE 0 END), 0) AS low_stock
    FROM products p LEFT JOIN (
      SELECT product_id, SUM(quantity_units) AS quantity_units FROM stock_movements GROUP BY product_id
    ) s ON s.product_id = p.id WHERE p.active = 1 AND p.kind = 'product'`).get() as { products: number; low_stock: number | null };
  const salesToday = db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(total_tiyin), 0) AS total
    FROM documents WHERE kind IN ('shipment','sale','retail_sale','work_order') AND status = 'posted' AND date = ?`).get(today);
  const sales = db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(total_tiyin), 0) AS total
    FROM documents WHERE kind IN ('shipment','sale','retail_sale','work_order') AND status = 'posted' AND date BETWEEN ? AND ?`).get(from, to);
  const salesSeries = db.prepare(`SELECT ${bucket} AS bucket, COALESCE(SUM(total_tiyin),0) AS total, COUNT(*) AS count
    FROM documents WHERE kind IN ('shipment','sale','retail_sale','work_order') AND status = 'posted' AND date BETWEEN ? AND ?
    GROUP BY bucket ORDER BY bucket`).all(from, to);
  const cash = db.prepare(`SELECT COALESCE(SUM(CASE WHEN kind IN ('cash_in','cash_correction','incoming_payment') THEN total_tiyin
    WHEN kind IN ('cash_out','payment') THEN -total_tiyin ELSE 0 END), 0) AS total
    FROM documents WHERE status = 'posted' AND kind IN ('cash_in','cash_out','payment','cash_correction','incoming_payment')`).get();
  const recent = db.prepare(`SELECT d.id, d.number, d.kind, d.status, d.date, d.updated_at, d.total_tiyin,
      c.name AS counterparty_name FROM documents d LEFT JOIN counterparties c ON c.id = d.counterparty_id
    WHERE d.status <> 'deleted' ORDER BY d.updated_at DESC, d.id DESC LIMIT 8`).all();
  const overdueOrders = db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(total_tiyin),0) AS total FROM documents
    WHERE status <> 'deleted' AND kind = 'customer_order' AND due_date < ?`).get(today);
  const overdueInvoices = db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(total_tiyin),0) AS total FROM documents
    WHERE status <> 'deleted' AND kind = 'customer_invoice' AND due_date < ?`).get(today);
  const serviceDue = db.prepare(`SELECT COUNT(*) AS count FROM vehicles v WHERE v.organization_id = 1
    AND (SELECT d.next_service_km FROM documents d WHERE d.vehicle_id = v.id AND d.kind = 'work_order'
      AND d.status = 'posted' ORDER BY d.date DESC, d.id DESC LIMIT 1) IS NOT NULL
    AND v.current_mileage >= (SELECT d.next_service_km FROM documents d WHERE d.vehicle_id = v.id
      AND d.kind = 'work_order' AND d.status = 'posted' ORDER BY d.date DESC, d.id DESC LIMIT 1)`).get();
  res.json({ stock, salesToday, sales, salesSeries, cash, recent, overdueOrders, overdueInvoices, serviceDue });
});

app.get("/api/products", (req, res) => {
  const query = String(req.query.q ?? "").trim();
  const showArchived = req.query.archived === "true";
  const kind = String(req.query.kind ?? "all");
  const warehouseIds = getAccessibleActiveWarehouseIds(db, req.auth!);
  const inventoryScope = warehouseIds === null ? "" : warehouseIds.length
    ? ` WHERE warehouse_id IN (${warehouseIds.join(",")})` : " WHERE 1 = 0";
  const warehouseScope = warehouseIds === null ? "" : warehouseIds.length
    ? ` AND w.id IN (${warehouseIds.join(",")})` : " AND 1 = 0";
  const minimumScope = warehouseIds === null ? "" : warehouseIds.length
    ? ` AND m.warehouse_id IN (${warehouseIds.join(",")})` : " AND 1 = 0";
  const rows = db.prepare(`SELECT p.*,
      COALESCE(s.quantity_units, 0) AS stock_units,
      COALESCE(s.value_tiyin, 0) AS stock_value_tiyin,
      COALESCE(r.quantity_units, 0) AS reserved_units,
      COALESCE(s.quantity_units, 0) - COALESCE(r.quantity_units, 0) AS available_units,
      CASE
        WHEN p.min_stock_mode = 'total' AND p.min_stock_units > 0 AND COALESCE(s.quantity_units, 0) <= p.min_stock_units THEN 1
        WHEN p.min_stock_mode = 'same' AND p.min_stock_units > 0 AND EXISTS (
          SELECT 1 FROM warehouses w LEFT JOIN stock_movements sm ON sm.warehouse_id = w.id AND sm.product_id = p.id
          WHERE w.organization_id = p.organization_id AND w.active = 1 ${warehouseScope} GROUP BY w.id HAVING COALESCE(SUM(sm.quantity_units), 0) <= p.min_stock_units
        ) THEN 1
        WHEN p.min_stock_mode = 'per_warehouse' AND EXISTS (
          SELECT 1 FROM product_warehouse_minima m LEFT JOIN stock_movements sm ON sm.warehouse_id = m.warehouse_id AND sm.product_id = m.product_id
          WHERE m.product_id = p.id ${minimumScope} GROUP BY m.warehouse_id HAVING m.min_stock_units > 0 AND COALESCE(SUM(sm.quantity_units), 0) <= m.min_stock_units
        ) THEN 1 ELSE 0 END AS is_low_stock
    FROM products p LEFT JOIN (
      SELECT product_id, SUM(quantity_units) AS quantity_units, SUM(value_tiyin) AS value_tiyin
      FROM stock_movements${inventoryScope} GROUP BY product_id
    ) s ON s.product_id = p.id LEFT JOIN (
      SELECT product_id, SUM(quantity_units) AS quantity_units FROM stock_reservations${inventoryScope} GROUP BY product_id
    ) r ON r.product_id = p.id
    WHERE p.organization_id = 1 AND (? = '' OR p.name LIKE '%' || ? || '%' OR p.code LIKE '%' || ? || '%')
      AND (? = 'all' OR p.kind = ?)
      AND p.active = ? ORDER BY p.name COLLATE NOCASE`).all(query, query, query, kind, kind, showArchived ? 0 : 1);
  res.json(rows);
});

app.get("/api/products/next-code", (_req, res) => {
  res.json({ code: nextProductCode() });
});

app.get("/api/products/metadata", (_req, res) => {
  const groups = db.prepare("SELECT DISTINCT group_name FROM products WHERE organization_id = 1 AND active = 1 AND TRIM(group_name) <> '' ORDER BY group_name COLLATE NOCASE")
    .all().map((row) => (row as { group_name: string }).group_name);
  const countries = db.prepare("SELECT DISTINCT country FROM products WHERE organization_id = 1 AND active = 1 AND TRIM(country) <> '' ORDER BY country COLLATE NOCASE")
    .all().map((row) => (row as { country: string }).country);
  res.json({ groups, countries });
});

app.get("/api/products/:id", (req, res) => {
  const id = Number(req.params.id);
  const warehouseIds = getAccessibleActiveWarehouseIds(db, req.auth!);
  const inventoryScope = warehouseIds === null ? "" : warehouseIds.length
    ? ` WHERE warehouse_id IN (${warehouseIds.join(",")})` : " WHERE 1 = 0";
  const warehouseScope = warehouseIds === null ? "" : warehouseIds.length
    ? ` AND w.id IN (${warehouseIds.join(",")})` : " AND 1 = 0";
  const movementScope = warehouseIds === null ? "" : warehouseIds.length
    ? ` AND sm.warehouse_id IN (${warehouseIds.join(",")})` : " AND 1 = 0";
  const product = db.prepare(`SELECT p.*,
      COALESCE(s.quantity_units, 0) AS stock_units, COALESCE(s.value_tiyin, 0) AS stock_value_tiyin,
      COALESCE(r.quantity_units, 0) AS reserved_units,
      c.name AS supplier_name
    FROM products p LEFT JOIN counterparties c ON c.id = p.supplier_id
    LEFT JOIN (SELECT product_id, SUM(quantity_units) AS quantity_units, SUM(value_tiyin) AS value_tiyin FROM stock_movements${inventoryScope} GROUP BY product_id) s ON s.product_id = p.id
    LEFT JOIN (SELECT product_id, SUM(quantity_units) AS quantity_units FROM stock_reservations${inventoryScope} GROUP BY product_id) r ON r.product_id = p.id
    WHERE p.id = ? AND p.organization_id = 1`).get(id);
  if (!product) return res.status(404).json({ error: "Товар не найден." });
  const warehouses = db.prepare(`SELECT w.id AS warehouse_id, w.name AS warehouse_name,
      COALESCE(s.quantity_units, 0) AS stock_units, COALESCE(r.quantity_units, 0) AS reserved_units,
      COALESCE(s.quantity_units, 0) - COALESCE(r.quantity_units, 0) AS available_units,
      COALESCE(m.min_stock_units, 0) AS min_stock_units
    FROM warehouses w LEFT JOIN (SELECT product_id, warehouse_id, SUM(quantity_units) AS quantity_units FROM stock_movements GROUP BY product_id, warehouse_id) s ON s.warehouse_id = w.id AND s.product_id = ?
    LEFT JOIN (SELECT product_id, warehouse_id, SUM(quantity_units) AS quantity_units FROM stock_reservations GROUP BY product_id, warehouse_id) r ON r.warehouse_id = w.id AND r.product_id = ?
    LEFT JOIN product_warehouse_minima m ON m.warehouse_id = w.id AND m.product_id = ?
    WHERE w.organization_id = 1 AND w.active = 1 ${warehouseScope} ORDER BY w.id`).all(id, id, id);
  const history = db.prepare(`SELECT a.id, a.action, a.detail, a.created_at FROM audit_log a
    WHERE a.entity_type = 'product' AND a.entity_id = ? ORDER BY a.created_at DESC, a.id DESC LIMIT 30`).all(id);
  const movements = db.prepare(`SELECT sm.id, sm.quantity_units, sm.value_tiyin, sm.created_at, d.number, d.kind, d.status, w.name AS warehouse_name
    FROM stock_movements sm JOIN documents d ON d.id = sm.document_id JOIN warehouses w ON w.id = sm.warehouse_id
    WHERE sm.product_id = ? ${movementScope} ORDER BY sm.created_at DESC, sm.id DESC LIMIT 50`).all(id);
  res.json({ ...product as object, barcodes: db.prepare("SELECT id, barcode_type AS barcodeType, barcode FROM product_barcodes WHERE product_id = ? ORDER BY id").all(id),
    packaging: db.prepare("SELECT id, name, quantity_units AS quantity, unit, code_type AS codeType, barcode FROM product_packaging WHERE product_id = ? ORDER BY id").all(id),
    priceTiers: db.prepare("SELECT id, name, price_tiyin AS priceTiyin, currency FROM product_prices WHERE product_id = ? ORDER BY position, id").all(id),
    files: db.prepare("SELECT id, file_kind AS fileKind, file_name AS fileName, mime_type AS mimeType, length(data) AS size, created_at AS createdAt FROM product_files WHERE product_id = ? AND active = 1 ORDER BY created_at DESC, id DESC").all(id),
    relations: db.prepare("SELECT pr.relation_type AS relationType, p.id AS relatedProductId, p.name AS relatedProductName, p.code AS relatedProductCode FROM product_relations pr JOIN products p ON p.id = pr.related_product_id WHERE pr.product_id = ? ORDER BY pr.id").all(id),
    warehouses, history, movements });
});

app.post("/api/products/:id/files", (req, res, next) => {
  try {
    const productId = Number(req.params.id);
    if (!db.prepare("SELECT id FROM products WHERE id = ? AND organization_id = 1").get(productId)) return res.status(404).json({ error: "Товар не найден." });
    const fileName = assertText(req.body.fileName, "Имя файла").replace(/[\/\\\u0000-\u001f]/g, "_").slice(0, 240);
    const fileKind = req.body.fileKind === "image" ? "image" : "file";
    const mimeType = String(req.body.mimeType ?? "application/octet-stream").trim().toLowerCase();
    if (mimeType.length > 120 || !/^[a-z0-9!#$&^_.+-]{1,64}\/[a-z0-9!#$&^_.+-]{1,64}$/.test(mimeType)) {
      throw new Error("Формат файла указан некорректно.");
    }
    if (fileKind === "image" && !["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif"].includes(mimeType)) {
      throw new Error("Поддерживаются изображения JPEG, PNG, GIF, WebP и AVIF.");
    }
    const encoded = String(req.body.dataBase64 ?? "");
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || !encoded) throw new Error("Файл не содержит данных.");
    const data = Buffer.from(encoded, "base64");
    if (!data.length || data.length > 8 * 1024 * 1024) throw new Error("Размер файла должен быть не больше 8 МБ.");
    const save = db.transaction(() => {
      const result = db.prepare(`INSERT INTO product_files (product_id, file_kind, file_name, mime_type, data)
        VALUES (?, ?, ?, ?, ?)`).run(productId, fileKind, fileName, mimeType, data);
      recordAudit("product", productId, "attach_file", fileName);
      return db.prepare(`SELECT id, file_kind AS fileKind, file_name AS fileName, mime_type AS mimeType,
        length(data) AS size, created_at AS createdAt FROM product_files WHERE id = ?`).get(result.lastInsertRowid);
    });
    res.status(201).json(save());
  } catch (error) { next(error); }
});

app.get("/api/products/:id/files/:fileId", (req, res) => {
  const productId = Number(req.params.id); const fileId = Number(req.params.fileId);
  const file = db.prepare(`SELECT f.file_name, f.mime_type, f.data, f.file_kind FROM product_files f
    JOIN products p ON p.id = f.product_id WHERE f.id = ? AND f.product_id = ? AND f.active = 1 AND p.organization_id = 1`).get(fileId, productId) as
    { file_name: string; mime_type: string; data: Buffer; file_kind: string } | undefined;
  if (!file) return res.status(404).json({ error: "Файл не найден." });
  const inline = req.query.inline === "true" && file.file_kind === "image";
  res.setHeader("Content-Type", file.mime_type);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.file_name)}`);
  res.setHeader("Content-Length", file.data.length);
  res.send(file.data);
});

app.patch("/api/products/:id/files/:fileId", (req, res, next) => {
  try {
    const productId = Number(req.params.id); const fileId = Number(req.params.fileId);
    if (!db.prepare("SELECT id FROM products WHERE id = ? AND organization_id = 1").get(productId)) return res.status(404).json({ error: "Товар не найден." });
    const update = db.transaction(() => {
      const file = db.prepare("SELECT file_name FROM product_files WHERE id = ? AND product_id = ?").get(fileId, productId) as { file_name: string } | undefined;
      if (!file) throw new Error("Файл не найден.");
      const active = req.body.active === true || req.body.active === 1 || req.body.active === "1" ? 1 : 0;
      db.prepare("UPDATE product_files SET active = ? WHERE id = ? AND product_id = ?").run(active, fileId, productId);
      recordAudit("product", productId, active ? "restore_file" : "archive_file", file.file_name);
      return { id: fileId, active };
    });
    res.json(update());
  } catch (error) { next(error); }
});

app.post("/api/products", (req, res, next) => {
  try {
    const fields = productFields(req.body);
    if (!isUnrestricted(req.auth!) && (fields.min_stock_mode !== "total" || fields.min_stock_units !== 0)) {
      throw new Error("Общие настройки неснижаемого остатка может менять только владелец или администратор.");
    }
    const create = db.transaction(() => {
      if (!fields.code) fields.code = nextProductCode();
      assertUniqueProductCode(fields.code);
      const columns = Object.keys(fields);
      const result = db.prepare(`INSERT INTO products (organization_id, ${columns.join(", ")}) VALUES (1, ${columns.map(() => "?").join(", ")})`)
        .run(...Object.values(fields));
      const id = Number(result.lastInsertRowid);
      saveProductChildren(id, req.body, req.auth);
      recordAudit("product", id, "create", String(fields.name));
      return id;
    });
    const id = create();
    res.status(201).json(db.prepare("SELECT * FROM products WHERE id = ?").get(id));
  } catch (error) { next(error); }
});

app.patch("/api/products/:id", (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = db.prepare("SELECT * FROM products WHERE id = ? AND organization_id = 1").get(id) as Record<string, unknown> | undefined;
    if (!existing) return res.status(404).json({ error: "Товар не найден." });
    const fields = productFields(req.body, existing);
    if (!isUnrestricted(req.auth!) && (fields.min_stock_mode !== existing.min_stock_mode || fields.min_stock_units !== existing.min_stock_units)) {
      throw new Error("Общий режим неснижаемого остатка и минимум по сети может менять только владелец или администратор.");
    }
    const active = req.body.active == null ? Number(existing.active) : req.body.active ? 1 : 0;
    const update = db.transaction(() => {
      assertUniqueProductCode(fields.code, id);
      if (existing.kind === "product" && fields.kind === "service") {
        const inventory = db.prepare(`SELECT
          (SELECT COALESCE(SUM(sm.quantity_units), 0) FROM stock_movements sm JOIN documents d ON d.id = sm.document_id
            WHERE sm.product_id = ? AND d.status = 'posted') AS stock_units,
          (SELECT COALESCE(SUM(sr.quantity_units), 0) FROM stock_reservations sr JOIN documents d ON d.id = sr.document_id
            WHERE sr.product_id = ? AND d.status = 'posted') AS reserved_units`).get(id, id) as { stock_units: number; reserved_units: number };
        if (inventory.stock_units !== 0 || inventory.reserved_units !== 0) {
          throw new Error("Нельзя изменить тип товара: у него есть проведённые складские движения или резерв.");
        }
      }
      const assignments = Object.keys(fields).map((key) => `${key} = ?`).join(", ");
      db.prepare(`UPDATE products SET ${assignments}, active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = 1`)
        .run(...Object.values(fields), active, id);
      if ("barcodes" in req.body || "packaging" in req.body || "relations" in req.body || "warehouseMinima" in req.body || "priceTiers" in req.body || "minStockMode" in req.body || "minStock" in req.body) {
        saveProductChildren(id, req.body, req.auth);
      }
      recordAudit("product", id, active ? "update" : "archive", String(fields.name));
    });
    update();
    res.json(db.prepare("SELECT * FROM products WHERE id = ?").get(id));
  } catch (error) { next(error); }
});

app.get("/api/counterparties", (req, res) => {
  const query = String(req.query.q ?? "").trim();
  const customersOnly = req.auth?.role === "employee";
  res.json(db.prepare(`SELECT * FROM counterparties WHERE organization_id = ? AND active = 1 AND
    (? = 0 OR kind IN ('customer','both')) AND
    (? = '' OR name LIKE '%' || ? || '%' OR phone LIKE '%' || ? || '%') ORDER BY name COLLATE NOCASE`)
    .all(req.auth!.organizationId, customersOnly ? 1 : 0, query, query, query));
});

app.get("/api/counterparties/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(404).json({ error: "Контрагент не найден." });
  const employee = req.auth!.role === "employee";
  const documentScope = scopedDocumentFilterLiteral(db, req.auth!, "d");
  const result = db.transaction(() => {
    const counterparty = db.prepare(`SELECT * FROM counterparties WHERE id = ? AND organization_id = ?
      AND (? = 0 OR (active = 1 AND kind IN ('customer','both')))`).get(id, req.auth!.organizationId, employee ? 1 : 0);
    if (!counterparty) return null;
    const contacts = db.prepare(`SELECT id, full_name AS fullName, position, phone, email, comment
      FROM counterparty_contacts WHERE counterparty_id = ? ORDER BY id`).all(id);
    const documents = db.prepare(`SELECT d.id, d.number, d.kind, d.status, d.date, d.total_tiyin,
        v.plate AS vehicle_plate, w.name AS warehouse_name
      FROM documents d LEFT JOIN vehicles v ON v.id = d.vehicle_id LEFT JOIN warehouses w ON w.id = d.warehouse_id
      WHERE d.organization_id = ? AND d.counterparty_id = ? AND d.status <> 'deleted'
        AND (? = 0 OR d.kind = 'work_order') ${documentScope} ORDER BY d.date DESC, d.id DESC`).all(req.auth!.organizationId, id, employee ? 1 : 0);
    const vehicles = db.prepare(`SELECT id, plate, make, model, year, vin, current_mileage
      FROM vehicles WHERE organization_id = ? AND counterparty_id = ? ORDER BY plate COLLATE NOCASE, id`).all(req.auth!.organizationId, id);
    const contracts = isUnrestricted(req.auth!)
      ? db.prepare(`SELECT * FROM contracts WHERE organization_id = ? AND counterparty_id = ? AND active = 1 ORDER BY date DESC, id DESC`).all(req.auth!.organizationId, id)
      : [];
    const bankAccounts = isUnrestricted(req.auth!) ? db.prepare(`SELECT * FROM bank_accounts WHERE organization_id = ? AND counterparty_id = ? AND active = 1 ORDER BY is_default DESC, id ASC`).all(req.auth!.organizationId, id) : [];
    return { ...counterparty as object, contacts, documents, vehicles, contracts, bankAccounts };
  })();
  if (!result) return res.status(404).json({ error: "Контрагент не найден." });
  res.json(result);
});

app.patch("/api/counterparties/:id", (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(404).json({ error: "Контрагент не найден." });
    const organizationId = req.auth!.organizationId;
    const body = req.body as Record<string, unknown>;
    if (!body || typeof body !== "object" || Array.isArray(body) || !Object.keys(body).length) throw new Error("Укажите изменения контрагента.");
    const allowed = new Set([...counterpartyTextFields.map(([input]) => input), "kind", "legalType", "contacts", "bankAccounts", "expectedRevision"]);
    if (Object.keys(body).some((key) => !allowed.has(key))) throw new Error("Проверьте поля контрагента.");
    if (typeof body.expectedRevision !== "number" || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0) throw new Error("Для изменения контрагента укажите актуальную версию карточки.");
    if (!db.prepare("SELECT 1 FROM counterparties WHERE id = ? AND organization_id = ?").get(id, organizationId)) return res.status(404).json({ error: "Контрагент не найден." });
    const result = db.transaction(() => {
      const existing = db.prepare("SELECT * FROM counterparties WHERE id = ? AND organization_id = ?").get(id, organizationId) as Record<string, unknown> | undefined;
      if (!existing) throw new CounterpartyRevisionConflict();
      const revision = Number(existing.revision);
      if (body.expectedRevision !== revision) throw new CounterpartyRevisionConflict();
      const fields = counterpartyFields(body, existing);
      if (fields.kind === "supplier" && existing.kind !== "supplier") {
        if (db.prepare("SELECT 1 FROM vehicles WHERE organization_id = ? AND counterparty_id = ? LIMIT 1").get(organizationId, id)
          || db.prepare(`SELECT 1 FROM documents WHERE organization_id = ? AND counterparty_id = ? AND status <> 'deleted'
            AND kind IN ('work_order','customer_order','customer_invoice','shipment','customer_return','incoming_payment') LIMIT 1`).get(organizationId, id)) {
          throw new Error("Нельзя убрать тип покупателя: у контрагента есть автомобили или связанные документы покупателя.");
        }
      }
      if (fields.kind === "customer" && existing.kind !== "customer" && (db.prepare("SELECT 1 FROM products WHERE organization_id = ? AND supplier_id = ? LIMIT 1").get(organizationId, id)
        || db.prepare(`SELECT 1 FROM documents WHERE organization_id = ? AND counterparty_id = ? AND status <> 'deleted'
          AND kind IN ('supplier_order','supplier_invoice','receipt','supplier_return') LIMIT 1`).get(organizationId, id))) {
        throw new Error("Нельзя убрать тип поставщика: он указан в товарах или связанных документах поставщика.");
      }
      const assignments = Object.keys(fields).map((key) => `${key} = ?`).join(", ");
      const update = db.prepare(`UPDATE counterparties SET ${assignments}, revision = revision + 1 WHERE id = ? AND organization_id = ? AND revision = ?`)
        .run(...Object.values(fields), id, organizationId, revision);
      if (update.changes !== 1) throw new CounterpartyRevisionConflict();
      if (body.contacts !== undefined) saveCounterpartyContacts(id, body.contacts);
      recordAudit("counterparty", id, "update", fields.name, organizationId);
      return db.prepare("SELECT * FROM counterparties WHERE id = ? AND organization_id = ?").get(id, organizationId);
    })();
    res.json(result);
  } catch (error) { if (error instanceof CounterpartyRevisionConflict) return res.status(409).json({ error: error.message }); next(error); }
});

app.get("/api/vehicles", (req, res) => {
  const query = String(req.query.q ?? "").trim();
  const customerId = req.query.counterpartyId ? Number(req.query.counterpartyId) : 0;
  const customersOnly = req.auth?.role === "employee";
  const serviceScope = scopedDocumentFilterLiteral(db, req.auth!, "d");
  res.json(db.prepare(`SELECT v.*, c.name AS counterparty_name, c.phone AS counterparty_phone,
      (SELECT d.next_service_km FROM documents d WHERE d.vehicle_id = v.id AND d.kind = 'work_order'
        AND d.status = 'posted' ${serviceScope} ORDER BY d.date DESC, d.id DESC LIMIT 1) AS next_service_km
    FROM vehicles v LEFT JOIN counterparties c ON c.id = v.counterparty_id
    WHERE v.organization_id = 1 AND (? = '' OR v.plate LIKE '%' || ? || '%' OR v.vin LIKE '%' || ? || '%'
      OR v.make LIKE '%' || ? || '%' OR v.model LIKE '%' || ? || '%' OR c.name LIKE '%' || ? || '%')
      AND (? = 0 OR v.counterparty_id = ?)
      AND (? = 0 OR c.kind IN ('customer','both'))
    ORDER BY v.plate COLLATE NOCASE, v.id`).all(query, query, query, query, query, query, customerId, customerId, customersOnly ? 1 : 0));
});

app.get("/api/vehicles/:id", (req, res) => {
  const id = Number(req.params.id);
  const customersOnly = req.auth?.role === "employee";
  const serviceScope = scopedDocumentFilterLiteral(db, req.auth!, "d");
  const historyScope = scopedDocumentFilterLiteral(db, req.auth!, "d");
  const vehicle = db.prepare(`SELECT v.*, c.name AS counterparty_name, c.phone AS counterparty_phone,
      (SELECT d.next_service_km FROM documents d WHERE d.vehicle_id = v.id AND d.kind = 'work_order'
        AND d.status = 'posted' ${serviceScope} ORDER BY d.date DESC, d.id DESC LIMIT 1) AS next_service_km
    FROM vehicles v LEFT JOIN counterparties c ON c.id = v.counterparty_id
    WHERE v.id = ? AND v.organization_id = 1 AND (? = 0 OR c.kind IN ('customer','both'))`)
    .get(id, customersOnly ? 1 : 0) as (Record<string, unknown> & { id: number; counterparty_phone: string; initial_mileage: number }) | undefined;
  if (!vehicle) return res.status(404).json({ error: "Автомобиль не найден." });

  const serviceHistory = db.prepare(`SELECT d.id, d.number, d.status, d.date, d.odometer_km, d.next_service_km,
      d.total_tiyin, d.comment, w.name AS warehouse_name
    FROM documents d LEFT JOIN warehouses w ON w.id = d.warehouse_id
    WHERE d.organization_id = 1 AND d.vehicle_id = ? AND d.kind = 'work_order' AND d.status <> 'deleted' ${historyScope}
    ORDER BY d.date DESC, d.id DESC`).all(id) as Array<Record<string, unknown>>;
  const historyWithLines = serviceHistory.map((order) => ({
    ...order,
    lines: db.prepare(`SELECT l.id, p.name AS product_name, p.code AS product_code, p.unit,
        l.quantity_units, l.unit_price_tiyin
      FROM document_lines l JOIN products p ON p.id = l.product_id
      WHERE l.document_id = ? ORDER BY l.position`).all(Number(order.id)),
  }));
  res.json({ ...vehicle, service_history: historyWithLines });
});

app.post("/api/vehicles", (req, res, next) => {
  try {
    const counterpartyId = Number(req.body.counterpartyId);
    const customer = db.prepare("SELECT kind FROM counterparties WHERE id = ? AND organization_id = 1 AND active = 1").get(counterpartyId) as { kind: string } | undefined;
    if (!customer || !["customer", "both"].includes(customer.kind)) throw new Error("Выберите активного клиента.");
    const plate = assertText(req.body.plate, "Госномер").toUpperCase();
    const make = assertText(req.body.make, "Марка");
    const model = assertText(req.body.model, "Модель");
    const mileage = parseMileage(req.body.currentMileage ?? 0, "Пробег", true) ?? 0;
    const result = db.prepare(`INSERT INTO vehicles
      (organization_id, counterparty_id, plate, make, model, year, vin, initial_mileage, current_mileage)
      VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(counterpartyId, plate, make, model, req.body.year ? Number(req.body.year) : null,
        String(req.body.vin ?? "").trim().toUpperCase(), mileage, mileage);
    recordAudit("vehicle", Number(result.lastInsertRowid), "create", `${plate}; ${make} ${model}`);
    res.status(201).json(db.prepare(`SELECT v.*, c.name AS counterparty_name FROM vehicles v
      LEFT JOIN counterparties c ON c.id = v.counterparty_id WHERE v.id = ?`).get(result.lastInsertRowid));
  } catch (error) { next(error); }
});

app.get("/api/warehouses", (req, res) => {
  const query = String(req.query.q ?? "").trim();
  const includeArchived = ["1", "true"].includes(String(req.query.includeArchived ?? "").toLowerCase());
  const scope = scopedWarehouseFilter(db, req.auth!, "w");
  res.json(db.prepare(`SELECT w.*, parent.name AS parent_name, d.name AS department_name
    FROM warehouses w LEFT JOIN warehouses parent ON parent.id = w.parent_id
    LEFT JOIN departments d ON d.id = w.department_id
    WHERE w.organization_id = 1 AND (? = 1 OR w.active = 1)
      AND (? = '' OR w.name LIKE '%' || ? || '%' OR w.code LIKE '%' || ? || '%'
        OR w.external_code LIKE '%' || ? || '%' OR w.address LIKE '%' || ? || '%') ${scope.sql}
    ORDER BY COALESCE(w.parent_id, w.id), w.name COLLATE NOCASE, w.id`)
    .all(includeArchived ? 1 : 0, query, query, query, query, query, ...scope.params));
});

app.post("/api/warehouses", (req, res, next) => {
  try {
    const fields = parseWarehouseFields(req.body);
    if (!canAccessDepartment(db, req.auth!, fields.department_id)) throw new Error("Нет доступа к выбранному подразделению.");
    if (fields.parent_id != null) {
      const parent = db.prepare("SELECT department_id FROM warehouses WHERE id = ? AND organization_id = 1 AND active = 1").get(fields.parent_id) as { department_id: number | null } | undefined;
      if (!parent || Number(parent.department_id) !== Number(fields.department_id)) throw new Error("Родительский склад должен относиться к тому же подразделению.");
    }
    assertUniqueWarehouseCode(fields.code);
    const create = db.transaction(() => {
      const result = db.prepare(`INSERT INTO warehouses
        (organization_id, name, address, address_comment, comment, code, external_code, parent_id, department_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(req.auth!.organizationId, fields.name, fields.address, fields.address_comment, fields.comment, fields.code, fields.external_code, fields.parent_id, fields.department_id);
      const id = Number(result.lastInsertRowid);
      recordAudit("warehouse", id, "create", fields.name);
      return id;
    });
    const id = create();
    res.status(201).json(db.prepare(`SELECT w.*, parent.name AS parent_name, d.name AS department_name FROM warehouses w
      LEFT JOIN warehouses parent ON parent.id = w.parent_id LEFT JOIN departments d ON d.id = w.department_id WHERE w.id = ?`).get(id));
  } catch (error) { next(error); }
});

app.patch("/api/warehouses/:id", (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(404).json({ error: "Склад не найден." });
    const existing = db.prepare("SELECT * FROM warehouses WHERE id = ? AND organization_id = ?").get(id, req.auth!.organizationId) as Record<string, unknown> | undefined;
    if (!existing) return res.status(404).json({ error: "Склад не найден." });
    if (!canAccessWarehouse(db, req.auth!, id)) return res.status(404).json({ error: "Склад не найден." });
    const fields = parseWarehouseFields(req.body, existing, id);
    if (!canAccessDepartment(db, req.auth!, fields.department_id)) throw new Error("Нет доступа к выбранному подразделению.");
    if (!isUnrestricted(req.auth!) && Number(fields.department_id) !== Number(existing.department_id)) throw new Error("Изменять подразделение склада может только владелец или администратор.");
    if (fields.parent_id != null) {
      const parent = db.prepare("SELECT department_id FROM warehouses WHERE id = ? AND organization_id = 1 AND active = 1").get(fields.parent_id) as { department_id: number | null } | undefined;
      if (!parent || Number(parent.department_id) !== Number(fields.department_id)) throw new Error("Родительский склад должен относиться к тому же подразделению.");
    }
    const active = req.body.active === undefined ? Number(existing.active) : req.body.active === true || req.body.active === 1 ? 1 : 0;
    if (active && fields.parent_id != null) validateWarehouseParent(fields.parent_id, id);
    const save = db.transaction(() => {
      assertUniqueWarehouseCode(fields.code, id);
      if (Number(fields.department_id) !== Number(existing.department_id) && warehouseHasOperationalReferences(id, req.auth!.organizationId)) {
        throw new Error("Нельзя менять салон склада после появления операций, остатков, минимальных запасов или кассы. Создайте новый склад в нужном салоне.");
      }
      if (!active && Number(existing.active)) {
        const activeCount = db.prepare("SELECT COUNT(*) AS count FROM warehouses WHERE organization_id = 1 AND active = 1").get() as { count: number };
        if (activeCount.count <= 1) throw new Error("Нельзя архивировать последний активный склад.");
        const departmentWarehouseCount = db.prepare("SELECT COUNT(*) AS count FROM warehouses WHERE organization_id = 1 AND department_id = ? AND active = 1")
          .get(Number(existing.department_id)) as { count: number };
        if (departmentWarehouseCount.count <= 1) throw new Error("Нельзя архивировать последний активный склад этого подразделения.");
        if (db.prepare("SELECT 1 FROM warehouses WHERE organization_id = 1 AND parent_id = ? AND active = 1 LIMIT 1").get(id)) {
          throw new Error("Сначала перенесите активные дочерние склады.");
        }
        assertWarehouseCanBeArchived(id);
      }
      db.prepare(`UPDATE warehouses SET name = ?, address = ?, address_comment = ?, comment = ?, code = ?, external_code = ?,
        parent_id = ?, department_id = ?, active = ? WHERE id = ? AND organization_id = 1`)
        .run(fields.name, fields.address, fields.address_comment, fields.comment, fields.code, fields.external_code, fields.parent_id, fields.department_id, active, id);
      const action = Number(existing.active) === active ? "update" : active ? "restore" : "archive";
      recordAudit("warehouse", id, action, fields.name);
    });
    save();
    res.json(db.prepare(`SELECT w.*, parent.name AS parent_name, d.name AS department_name FROM warehouses w
      LEFT JOIN warehouses parent ON parent.id = w.parent_id LEFT JOIN departments d ON d.id = w.department_id WHERE w.id = ?`).get(id));
  } catch (error) { next(error); }
});

app.delete("/api/warehouses/:id", (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(404).json({ error: "Склад не найден." });
    if (!canAccessWarehouse(db, req.auth!, id)) return res.status(404).json({ error: "Склад не найден." });
    const archive = db.transaction(() => {
      const warehouse = db.prepare("SELECT id, name, active, department_id FROM warehouses WHERE id = ? AND organization_id = 1").get(id) as { id: number; name: string; active: number; department_id: number } | undefined;
      if (!warehouse) throw new Error("Склад не найден.");
      if (!warehouse.active) return { id, active: 0 };
      const activeCount = db.prepare("SELECT COUNT(*) AS count FROM warehouses WHERE organization_id = 1 AND active = 1").get() as { count: number };
      if (activeCount.count <= 1) throw new Error("Нельзя архивировать последний активный склад.");
      const departmentWarehouseCount = db.prepare("SELECT COUNT(*) AS count FROM warehouses WHERE organization_id = 1 AND department_id = ? AND active = 1")
        .get(warehouse.department_id) as { count: number };
      if (departmentWarehouseCount.count <= 1) throw new Error("Нельзя архивировать последний активный склад этого подразделения.");
      if (db.prepare("SELECT 1 FROM warehouses WHERE organization_id = 1 AND parent_id = ? AND active = 1 LIMIT 1").get(id)) {
        throw new Error("Сначала перенесите активные дочерние склады.");
      }
      assertWarehouseCanBeArchived(id);
      db.prepare("UPDATE warehouses SET active = 0 WHERE id = ? AND organization_id = 1").run(id);
      recordAudit("warehouse", id, "archive", warehouse.name);
      return { id, active: 0 };
    });
    res.json(archive());
  } catch (error) { next(error); }
});

app.get("/api/stock", (req, res) => {
  const query = String(req.query.q ?? "").trim();
  const scope = scopedWarehouseFilter(db, req.auth!, "w");
  res.json(db.prepare(`SELECT p.id AS product_id, p.code, p.name AS product_name, p.unit,
      w.id AS warehouse_id, w.name AS warehouse_name,
      COALESCE(s.quantity_units, 0) AS stock_units,
      COALESCE(r.quantity_units, 0) AS reserved_units,
      COALESCE(s.quantity_units, 0) - COALESCE(r.quantity_units, 0) AS available_units,
      COALESCE(s.value_tiyin, 0) AS stock_value_tiyin
    FROM products p CROSS JOIN warehouses w
    LEFT JOIN (SELECT product_id, warehouse_id, SUM(quantity_units) AS quantity_units, SUM(value_tiyin) AS value_tiyin
      FROM stock_movements GROUP BY product_id, warehouse_id) s ON s.product_id = p.id AND s.warehouse_id = w.id
    LEFT JOIN (SELECT product_id, warehouse_id, SUM(quantity_units) AS quantity_units
      FROM stock_reservations GROUP BY product_id, warehouse_id) r ON r.product_id = p.id AND r.warehouse_id = w.id
    WHERE p.organization_id = 1 AND p.active = 1 AND p.kind = 'product' AND w.organization_id = 1 AND w.active = 1
      AND (? = '' OR p.name LIKE '%' || ? || '%' OR p.code LIKE '%' || ? || '%') ${scope.sql}
    ORDER BY w.id, p.name COLLATE NOCASE`).all(query, query, query, ...scope.params));
});

app.post("/api/counterparties", (req, res, next) => {
  try {
    const organizationId = req.auth!.organizationId;
    const body = req.body as Record<string, unknown>;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Проверьте поля контрагента.");
    const allowed = new Set([...counterpartyTextFields.map(([input]) => input), "kind", "legalType", "contacts", "bankAccounts"]);
    if (Object.keys(body).some((key) => !allowed.has(key))) throw new Error("Проверьте поля контрагента.");
    const fields = counterpartyFields(body);
    const result = db.transaction(() => {
      const columns = Object.keys(fields);
      const inserted = db.prepare(`INSERT INTO counterparties (organization_id, ${columns.join(", ")})
        VALUES (?, ${columns.map(() => "?").join(", ")})`).run(organizationId, ...Object.values(fields));
      const id = Number(inserted.lastInsertRowid);
      if (body.contacts !== undefined) saveCounterpartyContacts(id, body.contacts);
      recordAudit("counterparty", id, "create", fields.name, organizationId);
      return db.prepare("SELECT * FROM counterparties WHERE id = ? AND organization_id = ?").get(id, organizationId);
    })();
    res.status(201).json(result);
  } catch (error) { next(error); }
});

function handleCreateContract(req: Request, res: Response, next: NextFunction) {
  try {
    const orgId = req.auth!.organizationId;
    const counterpartyId = Number(req.body.counterpartyId ?? req.body.counterparty_id);
    if (!Number.isSafeInteger(counterpartyId) || counterpartyId <= 0) throw new Error("Выберите контрагента для договора.");
    const cp = db.prepare("SELECT id, name FROM counterparties WHERE id = ? AND organization_id = ? AND active = 1").get(counterpartyId, orgId) as { id: number; name: string } | undefined;
    if (!cp) throw new Error("Контрагент не найден или находится в архиве.");

    let number = String(req.body.number ?? "").trim();
    if (!number) {
      const count = (db.prepare("SELECT COUNT(*) AS c FROM contracts WHERE organization_id = ?").get(orgId) as { c: number }).c + 1;
      number = `ДОГ-${String(count).padStart(6, "0")}`;
    }
    const date = String(req.body.date ?? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty" }).format(new Date()));
    const dueDate = req.body.dueDate ? String(req.body.dueDate) : (req.body.due_date ? String(req.body.due_date) : null);
    const currency = String(req.body.currency ?? "KZT").trim() || "KZT";
    const sumTiyin = req.body.sum !== undefined ? parseTiyin(req.body.sum) : (req.body.sumTiyin !== undefined ? Number(req.body.sumTiyin) : (req.body.sum_tiyin !== undefined ? Number(req.body.sum_tiyin) : 0));
    const comment = String(req.body.comment ?? "").trim();
    const active = req.body.active !== undefined ? (req.body.active ? 1 : 0) : 1;

    const result = db.transaction(() => {
      const insert = db.prepare(`
        INSERT INTO contracts (organization_id, counterparty_id, number, date, due_date, currency, sum_tiyin, comment, active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(orgId, counterpartyId, number, date, dueDate, currency, sumTiyin, comment, active);
      const contractId = Number(insert.lastInsertRowid);
      recordAudit("contract", contractId, "create", `${number}; ${cp.name}`, orgId);
      return db.prepare(`SELECT c.*, cp.name AS counterparty_name FROM contracts c JOIN counterparties cp ON cp.id = c.counterparty_id WHERE c.id = ?`).get(contractId);
    })();
    res.status(201).json(result);
  } catch (err) { next(err); }
}

app.get("/api/contracts", (req, res) => {
  const counterpartyId = req.query.counterpartyId ? Number(req.query.counterpartyId) : (req.query.counterparty_id ? Number(req.query.counterparty_id) : 0);
  const active = String(req.query.active ?? "all");
  const query = String(req.query.q ?? "").trim();
  const contracts = db.prepare(`
    SELECT c.*, cp.name AS counterparty_name,
      (SELECT COUNT(*) FROM documents d WHERE d.contract_id = c.id AND d.status <> 'deleted') AS document_count,
      (SELECT COALESCE(SUM(d.total_tiyin), 0) FROM documents d WHERE d.contract_id = c.id AND d.status = 'posted') AS documents_sum_tiyin
    FROM contracts c
    JOIN counterparties cp ON cp.id = c.counterparty_id
    WHERE c.organization_id = ?
      AND (? = 0 OR c.counterparty_id = ?)
      AND (? = 'all' OR c.active = ?)
      AND (? = '' OR c.number LIKE '%' || ? || '%' OR c.comment LIKE '%' || ? || '%' OR cp.name LIKE '%' || ? || '%')
    ORDER BY c.date DESC, c.id DESC
  `).all(req.auth!.organizationId, counterpartyId, counterpartyId, active, active === "1" ? 1 : 0, query, query, query, query);
  res.json(contracts);
});

app.get("/api/contracts/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(404).json({ error: "Договор не найден." });
  const contract = db.prepare(`
    SELECT c.*, cp.name AS counterparty_name
    FROM contracts c
    JOIN counterparties cp ON cp.id = c.counterparty_id
    WHERE c.id = ? AND c.organization_id = ?
  `).get(id, req.auth!.organizationId) as Record<string, unknown> | undefined;
  if (!contract) return res.status(404).json({ error: "Договор не найден." });
  const documents = db.prepare(`
    SELECT id, number, kind, status, status_name, state, date, total_tiyin
    FROM documents
    WHERE contract_id = ? AND organization_id = ? AND status <> 'deleted'
    ORDER BY date DESC, id DESC
  `).all(id, req.auth!.organizationId);
  res.json({ ...contract, documents });
});

app.post("/api/contracts", handleCreateContract);

app.patch("/api/contracts/:id", (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(404).json({ error: "Договор не найден." });
    const orgId = req.auth!.organizationId;
    const existing = db.prepare("SELECT * FROM contracts WHERE id = ? AND organization_id = ?").get(id, orgId) as Record<string, unknown> | undefined;
    if (!existing) return res.status(404).json({ error: "Договор не найден." });

    let counterpartyId = Number(existing.counterparty_id);
    if (req.body.counterpartyId !== undefined || req.body.counterparty_id !== undefined) {
      counterpartyId = Number(req.body.counterpartyId ?? req.body.counterparty_id);
      const cp = db.prepare("SELECT id FROM counterparties WHERE id = ? AND organization_id = ? AND active = 1").get(counterpartyId, orgId);
      if (!cp) throw new Error("Контрагент не найден или находится в архиве.");
    }

    const number = req.body.number !== undefined ? String(req.body.number).trim() : String(existing.number);
    if (!number) throw new Error("Номер договора не может быть пустым.");
    const date = req.body.date !== undefined ? String(req.body.date) : String(existing.date);
    const dueDate = req.body.dueDate !== undefined ? (req.body.dueDate ? String(req.body.dueDate) : null) : (req.body.due_date !== undefined ? (req.body.due_date ? String(req.body.due_date) : null) : (existing.due_date as string | null));
    const currency = req.body.currency !== undefined ? String(req.body.currency).trim() : String(existing.currency);
    const sumTiyin = req.body.sum !== undefined ? parseTiyin(req.body.sum) : (req.body.sumTiyin !== undefined ? Number(req.body.sumTiyin) : (req.body.sum_tiyin !== undefined ? Number(req.body.sum_tiyin) : Number(existing.sum_tiyin)));
    const comment = req.body.comment !== undefined ? String(req.body.comment).trim() : String(existing.comment);
    const active = req.body.active !== undefined ? (req.body.active ? 1 : 0) : Number(existing.active);

    const result = db.transaction(() => {
      db.prepare(`
        UPDATE contracts SET counterparty_id = ?, number = ?, date = ?, due_date = ?, currency = ?, sum_tiyin = ?, comment = ?, active = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND organization_id = ?
      `).run(counterpartyId, number, date, dueDate, currency, sumTiyin, comment, active, id, orgId);
      recordAudit("contract", id, "update", number, orgId);
      return db.prepare(`SELECT c.*, cp.name AS counterparty_name FROM contracts c JOIN counterparties cp ON cp.id = c.counterparty_id WHERE c.id = ?`).get(id);
    })();
    res.json(result);
  } catch (err) { next(err); }
});

app.delete("/api/contracts/:id", (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(404).json({ error: "Договор не найден." });
    const orgId = req.auth!.organizationId;
    const contract = db.prepare("SELECT * FROM contracts WHERE id = ? AND organization_id = ?").get(id, orgId) as { number: string } | undefined;
    if (!contract) return res.status(404).json({ error: "Договор не найден." });

    const docCount = (db.prepare("SELECT COUNT(*) AS c FROM documents WHERE contract_id = ? AND status <> 'deleted'").get(id) as { c: number }).c;
    if (docCount > 0) throw new Error("Нельзя удалить договор, к которому привязаны документы. Архивируйте его.");

    db.prepare("DELETE FROM contracts WHERE id = ? AND organization_id = ?").run(id, orgId);
    recordAudit("contract", id, "delete", contract.number, orgId);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

app.get("/api/counterparties/:id/contracts", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(404).json({ error: "Контрагент не найден." });
  const cp = db.prepare("SELECT id FROM counterparties WHERE id = ? AND organization_id = ?").get(id, req.auth!.organizationId);
  if (!cp) return res.status(404).json({ error: "Контрагент не найден." });
  const contracts = db.prepare(`
    SELECT c.*, cp.name AS counterparty_name,
      (SELECT COUNT(*) FROM documents d WHERE d.contract_id = c.id AND d.status <> 'deleted') AS document_count
    FROM contracts c
    JOIN counterparties cp ON cp.id = c.counterparty_id
    WHERE c.counterparty_id = ? AND c.organization_id = ?
    ORDER BY c.date DESC, c.id DESC
  `).all(id, req.auth!.organizationId);
  res.json(contracts);
});

app.post("/api/counterparties/:id/contracts", (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(404).json({ error: "Контрагент не найден." });
  req.body.counterpartyId = id;
  return handleCreateContract(req, res, next);
});

app.get("/api/counterparties/:id/bank-accounts", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(404).json({ error: "Контрагент не найден." });
  const orgId = req.auth!.organizationId;
  const cp = db.prepare("SELECT id FROM counterparties WHERE id = ? AND organization_id = ?").get(id, orgId);
  if (!cp) return res.status(404).json({ error: "Контрагент не найден." });

  const accounts = db.prepare(`SELECT * FROM bank_accounts WHERE organization_id = ? AND counterparty_id = ? AND active = 1 ORDER BY is_default DESC, id ASC`).all(orgId, id);
  res.json(accounts);
});

app.post("/api/counterparties/:id/bank-accounts", (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(404).json({ error: "Контрагент не найден." });
    const orgId = req.auth!.organizationId;
    const cp = db.prepare("SELECT id, name FROM counterparties WHERE id = ? AND organization_id = ? AND active = 1").get(id, orgId) as { id: number; name: string } | undefined;
    if (!cp) throw new Error("Контрагент не найден или находится в архиве.");

    const accountNumber = String(req.body.accountNumber ?? req.body.account_number ?? "").trim();
    if (!accountNumber) throw new Error("Укажите номер расчетного счета (IBAN).");
    const bik = String(req.body.bik ?? "").trim();
    const bankName = String(req.body.bankName ?? req.body.bank_name ?? "").trim();
    const bankAddress = String(req.body.bankAddress ?? req.body.bank_address ?? "").trim();
    const corrAccount = String(req.body.corrAccount ?? req.body.corr_account ?? "").trim();

    const existingCount = (db.prepare("SELECT COUNT(*) AS c FROM bank_accounts WHERE organization_id = ? AND counterparty_id = ? AND active = 1").get(orgId, id) as { c: number }).c;
    const isDefault = req.body.isDefault !== undefined || req.body.is_default !== undefined
      ? (req.body.isDefault || req.body.is_default ? 1 : 0)
      : (existingCount === 0 ? 1 : 0);

    const result = db.transaction(() => {
      if (isDefault) {
        db.prepare("UPDATE bank_accounts SET is_default = 0 WHERE organization_id = ? AND counterparty_id = ?").run(orgId, id);
      }
      const insert = db.prepare(`INSERT INTO bank_accounts
        (organization_id, counterparty_id, bik, bank_name, bank_address, corr_account, account_number, is_default, active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`).run(orgId, id, bik, bankName, bankAddress, corrAccount, accountNumber, isDefault);
      const accountId = Number(insert.lastInsertRowid);
      recordAudit("bank_account", accountId, "create", `${accountNumber}; ${cp.name}`, orgId);
      return db.prepare("SELECT * FROM bank_accounts WHERE id = ?").get(accountId);
    })();
    res.status(201).json(result);
  } catch (err) { next(err); }
});

app.get("/api/organization", (req, res) => {
  const orgId = req.auth?.organizationId ?? 1;
  const org = db.prepare("SELECT * FROM organizations WHERE id = ?").get(orgId) as Record<string, unknown> | undefined;
  if (!org) return res.status(404).json({ error: "Организация не найдена." });

  const bankAccounts = db.prepare(
    "SELECT * FROM bank_accounts WHERE organization_id = ? AND counterparty_id IS NULL AND active = 1 ORDER BY is_default DESC, id ASC"
  ).all(orgId);

  const rawSettings = db.prepare("SELECT key, value FROM settings").all() as Array<{ key: string; value: string }>;
  const settings: Record<string, unknown> = {};
  for (const s of rawSettings) {
    if (s.key === "allowNegativeStock") settings[s.key] = s.value === "true";
    else if (s.key === "trashRetentionDays") settings[s.key] = Number(s.value) || 7;
    else settings[s.key] = s.value;
  }

  const cashStats = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN kind IN ('cash_in', 'cashin') AND status = 'posted' THEN total_tiyin
                        WHEN kind IN ('cash_out', 'cashout') AND status = 'posted' THEN -total_tiyin
                        ELSE 0 END), 0) AS cash_balance_tiyin
    FROM documents WHERE organization_id = ?
  `).get(orgId) as { cash_balance_tiyin: number };

  res.json({
    ...org,
    cash_balance_tiyin: cashStats?.cash_balance_tiyin ?? 0,
    bankAccounts,
    settings,
  });
});

app.patch("/api/organization", (req, res, next) => {
  try {
    if (req.auth?.role === "employee") {
      return res.status(403).json({ error: "Недостаточно прав для изменения настроек организации." });
    }
    const orgId = req.auth?.organizationId ?? 1;
    const existing = db.prepare("SELECT * FROM organizations WHERE id = ?").get(orgId) as Record<string, unknown> | undefined;
    if (!existing) return res.status(404).json({ error: "Организация не найдена." });

    const b = req.body;
    const name = b.name !== undefined ? String(b.name).trim() : String(existing.name);
    if (!name) throw new Error("Краткое наименование не может быть пустым.");

    const code = b.code !== undefined ? String(b.code).trim() : String(existing.code ?? "");
    const phone = b.phone !== undefined ? String(b.phone).trim() : String(existing.phone ?? "");
    const fax = b.fax !== undefined ? String(b.fax).trim() : String(existing.fax ?? "");
    const email = b.email !== undefined ? String(b.email).trim() : String(existing.email ?? "");
    const actualAddress = b.actual_address !== undefined || b.actualAddress !== undefined
      ? String(b.actual_address ?? b.actualAddress).trim() : String(existing.actual_address ?? "");
    const actualAddressComment = b.actual_address_comment !== undefined || b.actualAddressComment !== undefined
      ? String(b.actual_address_comment ?? b.actualAddressComment).trim() : String(existing.actual_address_comment ?? "");
    const comment = b.comment !== undefined ? String(b.comment).trim() : String(existing.comment ?? "");
    const director = b.director !== undefined ? String(b.director).trim() : String(existing.director ?? "");
    const directorPosition = b.director_position !== undefined || b.directorPosition !== undefined
      ? String(b.director_position ?? b.directorPosition).trim() : String(existing.director_position ?? "");
    const directorSignatureUrl = b.director_signature_url !== undefined || b.directorSignatureUrl !== undefined
      ? String(b.director_signature_url ?? b.directorSignatureUrl).trim() : String(existing.director_signature_url ?? "");
    const accountant = b.accountant !== undefined ? String(b.accountant).trim() : String(existing.accountant ?? "");
    const accountantSignatureUrl = b.accountant_signature_url !== undefined || b.accountantSignatureUrl !== undefined
      ? String(b.accountant_signature_url ?? b.accountantSignatureUrl).trim() : String(existing.accountant_signature_url ?? "");
    const stampUrl = b.stamp_url !== undefined || b.stampUrl !== undefined
      ? String(b.stamp_url ?? b.stampUrl).trim() : String(existing.stamp_url ?? "");
    const logoUrl = b.logo_url !== undefined || b.logoUrl !== undefined
      ? String(b.logo_url ?? b.logoUrl).trim() : String(existing.logo_url ?? "");
    const legalType = b.legal_type !== undefined || b.legalType !== undefined
      ? String(b.legal_type ?? b.legalType).trim() : String(existing.legal_type ?? "legal_entity");
    const legalName = b.legal_name !== undefined || b.legalName !== undefined
      ? String(b.legal_name ?? b.legalName).trim() : String(existing.legal_name ?? "");
    const legalAddress = b.legal_address !== undefined || b.legalAddress !== undefined
      ? String(b.legal_address ?? b.legalAddress).trim() : String(existing.legal_address ?? "");
    const legalAddressComment = b.legal_address_comment !== undefined || b.legalAddressComment !== undefined
      ? String(b.legal_address_comment ?? b.legalAddressComment).trim() : String(existing.legal_address_comment ?? "");
    const bin = b.bin !== undefined ? String(b.bin).trim() : String(existing.bin ?? "");
    const kbe = b.kbe !== undefined ? String(b.kbe).trim() : String(existing.kbe ?? "");
    const oked = b.oked !== undefined ? String(b.oked).trim() : String(existing.oked ?? "");
    const vatPayer = b.vat_payer !== undefined || b.vatPayer !== undefined
      ? (b.vat_payer || b.vatPayer ? 1 : 0) : Number(existing.vat_payer ?? 0);
    const vatRateSource = b.vat_rate_source !== undefined || b.vatRateSource !== undefined
      ? String(b.vat_rate_source ?? b.vatRateSource).trim() : String(existing.vat_rate_source ?? "product");
    const vatConstantRate = b.vat_constant_rate !== undefined || b.vatConstantRate !== undefined
      ? String(b.vat_constant_rate ?? b.vatConstantRate).trim() : String(existing.vat_constant_rate ?? "12%");
    const vatAdvanceRate = b.vat_advance_rate !== undefined || b.vatAdvanceRate !== undefined
      ? String(b.vat_advance_rate ?? b.vatAdvanceRate).trim() : String(existing.vat_advance_rate ?? "12/112");
    const vatCertNum = b.vat_certificate_number !== undefined || b.vatCertificateNumber !== undefined
      ? String(b.vat_certificate_number ?? b.vatCertificateNumber).trim() : String(existing.vat_certificate_number ?? "");
    const vatCertDate = b.vat_certificate_date !== undefined || b.vatCertificateDate !== undefined
      ? String(b.vat_certificate_date ?? b.vatCertificateDate).trim() : String(existing.vat_certificate_date ?? "");

    db.transaction(() => {
      db.prepare(`UPDATE organizations SET
        name = ?, code = ?, phone = ?, fax = ?, email = ?,
        actual_address = ?, actual_address_comment = ?, comment = ?,
        director = ?, director_position = ?, director_signature_url = ?,
        accountant = ?, accountant_signature_url = ?, stamp_url = ?, logo_url = ?,
        legal_type = ?, legal_name = ?, legal_address = ?, legal_address_comment = ?,
        bin = ?, kbe = ?, oked = ?,
        vat_payer = ?, vat_rate_source = ?, vat_constant_rate = ?, vat_advance_rate = ?,
        vat_certificate_number = ?, vat_certificate_date = ?
        WHERE id = ?`).run(
          name, code, phone, fax, email,
          actualAddress, actualAddressComment, comment,
          director, directorPosition, directorSignatureUrl,
          accountant, accountantSignatureUrl, stampUrl, logoUrl,
          legalType, legalName, legalAddress, legalAddressComment,
          bin, kbe, oked,
          vatPayer, vatRateSource, vatConstantRate, vatAdvanceRate,
          vatCertNum, vatCertDate,
          orgId
        );

      if (b.settings && typeof b.settings === "object") {
        if (b.settings.allowNegativeStock !== undefined) {
          const val = b.settings.allowNegativeStock ? "true" : "false";
          db.prepare("INSERT INTO settings (key, value) VALUES ('allowNegativeStock', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(val);
        }
        if (b.settings.numberingScheme !== undefined) {
          db.prepare("INSERT INTO settings (key, value) VALUES ('numberingScheme', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(b.settings.numberingScheme));
        }
        if (b.settings.emailSender !== undefined) {
          db.prepare("INSERT INTO settings (key, value) VALUES ('emailSender', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(b.settings.emailSender));
        }
        if (b.settings.trashRetentionDays !== undefined) {
          db.prepare("INSERT INTO settings (key, value) VALUES ('trashRetentionDays', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(b.settings.trashRetentionDays));
        }
      }
      recordAudit("organization", orgId, "update", `Обновлены реквизиты: ${name}`, orgId);
    })();

    const updated = db.prepare("SELECT * FROM organizations WHERE id = ?").get(orgId) as Record<string, unknown>;
    const bankAccounts = db.prepare("SELECT * FROM bank_accounts WHERE organization_id = ? AND counterparty_id IS NULL AND active = 1 ORDER BY is_default DESC, id ASC").all(orgId);
    const rawSettings = db.prepare("SELECT key, value FROM settings").all() as Array<{ key: string; value: string }>;
    const settings: Record<string, unknown> = {};
    for (const s of rawSettings) {
      if (s.key === "allowNegativeStock") settings[s.key] = s.value === "true";
      else if (s.key === "trashRetentionDays") settings[s.key] = Number(s.value) || 7;
      else settings[s.key] = s.value;
    }
    res.json({ ...updated, bankAccounts, settings });
  } catch (err) { next(err); }
});

app.get("/api/retail/stores", (req, res) => {
  const orgId = req.auth?.organizationId ?? 1;
  const stores = db.prepare(`
    SELECT s.*, w.name AS warehouse_name,
      (SELECT id FROM retail_shifts WHERE retail_store_id = s.id AND status = 'open' LIMIT 1) AS active_shift_id,
      (SELECT shift_number FROM retail_shifts WHERE retail_store_id = s.id AND status = 'open' LIMIT 1) AS active_shift_number,
      (SELECT opened_at FROM retail_shifts WHERE retail_store_id = s.id AND status = 'open' LIMIT 1) AS active_shift_opened_at
    FROM retail_stores s
    LEFT JOIN warehouses w ON w.id = s.warehouse_id
    WHERE s.organization_id = ?
    ORDER BY s.id ASC
  `).all(orgId);
  res.json(stores);
});

app.post("/api/retail/stores", (req, res, next) => {
  try {
    if (req.auth?.role === "employee") return res.status(403).json({ error: "Недостаточно прав." });
    const orgId = req.auth?.organizationId ?? 1;
    const name = String(req.body.name ?? "").trim();
    if (!name) throw new Error("Укажите наименование точки продаж.");
    const code = String(req.body.code ?? "").trim();
    const warehouseId = Number(req.body.warehouse_id ?? req.body.warehouseId ?? 1);
    const priceType = String(req.body.price_type ?? req.body.priceType ?? "Цена продажи").trim();
    const allowFreePrice = req.body.allow_free_price ?? req.body.allowFreePrice ? 1 : 0;
    const allowDiscounts = req.body.allow_discounts ?? req.body.allowDiscounts ? 1 : 0;
    const autoPko = req.body.auto_pko_on_shift_close ?? req.body.autoPkoOnShiftClose !== false ? 1 : 0;
    const autoPayment = req.body.auto_payment_on_shift_close ?? req.body.autoPaymentOnShiftClose !== false ? 1 : 0;
    const cardFeeBps = Number(req.body.card_fee_bps ?? req.body.cardFeeBps ?? 150);

    const result = db.transaction(() => {
      const ins = db.prepare(`INSERT INTO retail_stores
        (organization_id, name, code, warehouse_id, price_type, allow_free_price, allow_discounts, auto_pko_on_shift_close, auto_payment_on_shift_close, card_fee_bps, active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`).run(orgId, name, code, warehouseId, priceType, allowFreePrice, allowDiscounts, autoPko, autoPayment, cardFeeBps);
      const id = Number(ins.lastInsertRowid);
      recordAudit("retail_store", id, "create", name, orgId);
      return db.prepare("SELECT * FROM retail_stores WHERE id = ?").get(id);
    })();
    res.status(201).json(result);
  } catch (err) { next(err); }
});

app.patch("/api/retail/stores/:id", (req, res, next) => {
  try {
    if (req.auth?.role === "employee") return res.status(403).json({ error: "Недостаточно прав." });
    const id = Number(req.params.id);
    const orgId = req.auth?.organizationId ?? 1;
    const existing = db.prepare("SELECT * FROM retail_stores WHERE id = ? AND organization_id = ?").get(id, orgId) as Record<string, unknown> | undefined;
    if (!existing) return res.status(404).json({ error: "Точка продаж не найдена." });

    const b = req.body;
    const name = b.name !== undefined ? String(b.name).trim() : String(existing.name);
    if (!name) throw new Error("Наименование не может быть пустым.");
    const code = b.code !== undefined ? String(b.code).trim() : String(existing.code);
    const warehouseId = b.warehouse_id !== undefined || b.warehouseId !== undefined ? Number(b.warehouse_id ?? b.warehouseId) : Number(existing.warehouse_id);
    const active = b.active !== undefined ? (b.active ? 1 : 0) : Number(existing.active);

    db.prepare(`UPDATE retail_stores SET name = ?, code = ?, warehouse_id = ?, active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?`)
      .run(name, code, warehouseId, active, id, orgId);
    recordAudit("retail_store", id, "update", name, orgId);
    res.json(db.prepare("SELECT * FROM retail_stores WHERE id = ?").get(id));
  } catch (err) { next(err); }
});

app.get("/api/retail/shifts", (req, res) => {
  const orgId = req.auth?.organizationId ?? 1;
  const storeId = req.query.storeId ? Number(req.query.storeId) : null;
  const status = req.query.status ? String(req.query.status) : null;

  let query = `
    SELECT sh.*, st.name AS store_name, u.full_name AS cashier_name
    FROM retail_shifts sh
    JOIN retail_stores st ON st.id = sh.retail_store_id
    LEFT JOIN users u ON u.id = sh.user_id
    WHERE sh.organization_id = ?
  `;
  const params: unknown[] = [orgId];
  if (storeId) { query += " AND sh.retail_store_id = ?"; params.push(storeId); }
  if (status) { query += " AND sh.status = ?"; params.push(status); }
  query += " ORDER BY sh.id DESC LIMIT 100";

  const shifts = db.prepare(query).all(...params);
  res.json(shifts);
});

app.post("/api/retail/shifts/open", (req, res, next) => {
  try {
    const orgId = req.auth?.organizationId ?? 1;
    const storeId = Number(req.body.store_id ?? req.body.storeId);
    if (!storeId) throw new Error("Укажите точку продаж.");
    const store = db.prepare("SELECT * FROM retail_stores WHERE id = ? AND organization_id = ? AND active = 1").get(storeId, orgId);
    if (!store) throw new Error("Точка продаж не найдена или отключена.");

    const existingOpen = db.prepare("SELECT id FROM retail_shifts WHERE retail_store_id = ? AND status = 'open'").get(storeId);
    if (existingOpen) throw new Error("На этой точке продаж уже есть открытая смена.");

    const lastShift = db.prepare("SELECT MAX(shift_number) AS max_num FROM retail_shifts WHERE retail_store_id = ?").get(storeId) as { max_num: number | null };
    const nextShiftNumber = (lastShift?.max_num ?? 0) + 1;
    const cashStartTiyin = Math.round(Number(req.body.cash_start ?? req.body.cashStart ?? 0) * 100);

    const result = db.transaction(() => {
      const ins = db.prepare(`INSERT INTO retail_shifts
        (organization_id, retail_store_id, user_id, shift_number, status, cash_start_tiyin, opened_at)
        VALUES (?, ?, ?, ?, 'open', ?, CURRENT_TIMESTAMP)`).run(orgId, storeId, req.auth?.userId ?? null, nextShiftNumber, cashStartTiyin);
      const shiftId = Number(ins.lastInsertRowid);
      recordAudit("retail_shift", shiftId, "open", `Открыта смена №${nextShiftNumber}`, orgId);
      return db.prepare("SELECT * FROM retail_shifts WHERE id = ?").get(shiftId);
    })();
    res.status(201).json(result);
  } catch (err) { next(err); }
});

app.post("/api/retail/shifts/:id/close", (req, res, next) => {
  try {
    const shiftId = Number(req.params.id);
    const orgId = req.auth?.organizationId ?? 1;
    const shift = db.prepare("SELECT * FROM retail_shifts WHERE id = ? AND organization_id = ?").get(shiftId, orgId) as Record<string, unknown> | undefined;
    if (!shift) return res.status(404).json({ error: "Смена не найдена." });
    if (shift.status === "closed") throw new Error("Смена уже закрыта.");

    const store = db.prepare("SELECT * FROM retail_stores WHERE id = ?").get(Number(shift.retail_store_id)) as Record<string, unknown>;

    const result = db.transaction(() => {
      db.prepare(`UPDATE retail_shifts SET
        status = 'closed',
        closed_at = CURRENT_TIMESTAMP
        WHERE id = ?`).run(shiftId);

      const cashRevenue = Number(shift.revenue_cash_tiyin ?? 0);
      const cardRevenue = Number(shift.revenue_card_tiyin ?? 0);

      // Auto PKO for cash
      if (store.auto_pko_on_shift_close && cashRevenue > 0) {
        const docCount = (db.prepare("SELECT COUNT(*) AS c FROM documents WHERE organization_id = ? AND kind = 'cash_in'").get(orgId) as { c: number }).c;
        const pkoNumber = `ПКО-${String(docCount + 1).padStart(6, "0")}`;
        const pkoIns = db.prepare(`INSERT INTO documents
          (organization_id, number, kind, status, date, warehouse_id, total_tiyin, comment)
          VALUES (?, ?, 'cash_in', 'posted', CURRENT_DATE, ?, ?, ?)`).run(orgId, pkoNumber, Number(store.warehouse_id), cashRevenue, `Авто-ПКО при закрытии смены №${shift.shift_number}`);
        const pkoId = Number(pkoIns.lastInsertRowid);
        recordAudit("document", pkoId, "create", `ПКО закрытия смены: ${pkoNumber}`, orgId);
      }

      // Auto incoming payment for card
      if (store.auto_payment_on_shift_close && cardRevenue > 0) {
        const defaultBank = db.prepare("SELECT id FROM bank_accounts WHERE organization_id = ? AND counterparty_id IS NULL AND active = 1 ORDER BY is_default DESC LIMIT 1").get(orgId) as { id: number } | undefined;
        const docCount = (db.prepare("SELECT COUNT(*) AS c FROM documents WHERE organization_id = ? AND kind = 'incoming_payment'").get(orgId) as { c: number }).c;
        const payNumber = `ВХП-${String(docCount + 1).padStart(6, "0")}`;
        const feeBps = Number(store.card_fee_bps ?? 150);
        const feeTiyin = Math.round(cardRevenue * feeBps / 10000);
        const netCardRevenue = cardRevenue - feeTiyin;

        const payIns = db.prepare(`INSERT INTO documents
          (organization_id, number, kind, status, date, warehouse_id, bank_account_id, payment_method, total_tiyin, comment)
          VALUES (?, ?, 'incoming_payment', 'posted', CURRENT_DATE, ?, ?, 'bank', ?, ?)`).run(
            orgId, payNumber, Number(store.warehouse_id), defaultBank?.id ?? null, netCardRevenue,
            `Эквайринг смены №${shift.shift_number} (Выручка: ${cardRevenue / 100} ₸, комиссия банка: ${feeTiyin / 100} ₸)`
          );
        const payId = Number(payIns.lastInsertRowid);
        recordAudit("document", payId, "create", `Безналичная выручка смены: ${payNumber}`, orgId);
      }

      recordAudit("retail_shift", shiftId, "close", `Закрыта смена №${shift.shift_number} (Z-отчет)`, orgId);
      return db.prepare("SELECT * FROM retail_shifts WHERE id = ?").get(shiftId);
    })();
    res.json(result);
  } catch (err) { next(err); }
});

app.get("/api/retail/sales", (req, res) => {
  const orgId = req.auth?.organizationId ?? 1;
  const sales = db.prepare(`
    SELECT d.*, c.name AS counterparty_name, w.name AS warehouse_name,
      (SELECT COUNT(*) FROM document_lines WHERE document_id = d.id) AS line_count
    FROM documents d
    LEFT JOIN counterparties c ON c.id = d.counterparty_id
    LEFT JOIN warehouses w ON w.id = d.warehouse_id
    WHERE d.organization_id = ? AND d.kind IN ('retailsale', 'retaildemand', 'retailsalesreturn', 'retailreturn')
      AND d.status <> 'deleted'
    ORDER BY d.id DESC LIMIT 100
  `).all(orgId);
  res.json(sales);
});

app.post("/api/retail/sales", (req, res, next) => {
  try {
    const orgId = req.auth?.organizationId ?? 1;
    const storeId = Number(req.body.store_id ?? req.body.storeId ?? 1);
    const store = db.prepare("SELECT * FROM retail_stores WHERE id = ? AND organization_id = ?").get(storeId, orgId) as Record<string, unknown> | undefined;
    if (!store) throw new Error("Точка продаж не найдена.");

    let openShift = db.prepare("SELECT * FROM retail_shifts WHERE retail_store_id = ? AND status = 'open'").get(storeId) as Record<string, unknown> | undefined;
    if (!openShift) {
      const lastShift = db.prepare("SELECT MAX(shift_number) AS max_num FROM retail_shifts WHERE retail_store_id = ?").get(storeId) as { max_num: number | null };
      const nextShiftNumber = (lastShift?.max_num ?? 0) + 1;
      const insShift = db.prepare(`INSERT INTO retail_shifts
        (organization_id, retail_store_id, user_id, shift_number, status, cash_start_tiyin, opened_at)
        VALUES (?, ?, ?, ?, 'open', 0, CURRENT_TIMESTAMP)`).run(orgId, storeId, req.auth?.userId ?? null, nextShiftNumber);
      openShift = db.prepare("SELECT * FROM retail_shifts WHERE id = ?").get(Number(insShift.lastInsertRowid)) as Record<string, unknown>;
    }

    const items = Array.isArray(req.body.items) ? req.body.items as Array<Record<string, unknown>> : [];
    if (!items.length) throw new Error("Чек должен содержать хотя бы один товар или услугу.");

    const cashTiyin = Math.round(Number(req.body.cash_amount ?? req.body.cashAmount ?? 0) * 100);
    const cardTiyin = Math.round(Number(req.body.card_amount ?? req.body.cardAmount ?? 0) * 100);
    const advanceTiyin = Math.round(Number(req.body.advance_amount ?? req.body.advanceAmount ?? 0) * 100);
    const warehouseId = Number(store.warehouse_id);
    const counterpartyId = req.body.counterparty_id ? Number(req.body.counterparty_id) : null;
    const vehicleId = req.body.vehicle_id ? Number(req.body.vehicle_id) : null;
    const odometerKm = req.body.odometer_km ? Number(req.body.odometer_km) : null;

    let computedTotalTiyin = 0;
    const linesToInsert: Array<{
      productId: number;
      quantityUnits: number;
      unitPriceTiyin: number;
      discountBps: number;
      vatRate: string;
      vatSumTiyin: number;
      totalWithoutVatTiyin: number;
      totalTiyin: number;
    }> = [];

    for (const it of items) {
      const pid = Number(it.productId ?? it.product_id);
      const p = db.prepare("SELECT id, name, kind, sale_price_tiyin, vat_rate FROM products WHERE id = ?").get(pid) as Record<string, unknown> | undefined;
      if (!p) throw new Error(`Товар с ID ${pid} не найден.`);

      const qtyUnits = Math.round(Number(it.quantity ?? 1) * 1_000_000);
      const unitPriceTiyin = it.price !== undefined ? Math.round(Number(it.price) * 100) : Number(p.sale_price_tiyin);
      const discountBps = Math.round(Number(it.discountPercent ?? 0) * 100);
      const vatRate = effectiveProductVatRate(pid) || "12%";
      const financials = calculateLineFinancials(qtyUnits, unitPriceTiyin, discountBps, vatRate, true);
      computedTotalTiyin += financials.lineTotalTiyin;

      linesToInsert.push({
        productId: pid,
        quantityUnits: qtyUnits,
        unitPriceTiyin,
        discountBps,
        vatRate,
        vatSumTiyin: financials.vatSumTiyin,
        totalWithoutVatTiyin: financials.totalWithoutVatTiyin,
        totalTiyin: financials.lineTotalTiyin,
      });
    }

    const totalPaidTiyin = cashTiyin + cardTiyin + advanceTiyin;
    if (totalPaidTiyin < computedTotalTiyin) {
      throw new Error(`Недостаточно оплаты: сумма чека ${computedTotalTiyin / 100} ₸, внесено ${totalPaidTiyin / 100} ₸.`);
    }

    const result = db.transaction(() => {
      const salesCount = (db.prepare("SELECT COUNT(*) AS c FROM documents WHERE organization_id = ? AND kind = 'retailsale'").get(orgId) as { c: number }).c;
      const saleNumber = `ЧЕК-${String(salesCount + 1).padStart(6, "0")}`;

      const insDoc = db.prepare(`INSERT INTO documents
        (organization_id, number, kind, status, date, warehouse_id, counterparty_id, vehicle_id, odometer_km, total_tiyin, comment, payment_method)
        VALUES (?, ?, 'retailsale', 'posted', CURRENT_DATE, ?, ?, ?, ?, ?, ?, ?)`).run(
          orgId, saleNumber, warehouseId, counterpartyId, vehicleId, odometerKm, computedTotalTiyin,
          `Розничная продажа (Нал: ${cashTiyin / 100} ₸, Карта: ${cardTiyin / 100} ₸)`,
          cashTiyin > 0 && cardTiyin > 0 ? 'split' : cardTiyin > 0 ? 'card' : 'cash'
        );
      const docId = Number(insDoc.lastInsertRowid);

      const insLine = db.prepare(`INSERT INTO document_lines
        (document_id, product_id, quantity_units, unit_price_tiyin, discount_bps, vat_rate, vat_sum_tiyin, total_without_vat_tiyin, position)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);

      const insMovement = db.prepare(`INSERT INTO stock_movements
        (organization_id, document_id, product_id, warehouse_id, quantity_units, value_tiyin)
        VALUES (?, ?, ?, ?, ?, ?)`);

      let pos = 1;
      for (const line of linesToInsert) {
        insLine.run(docId, line.productId, line.quantityUnits, line.unitPriceTiyin, line.discountBps, line.vatRate, line.vatSumTiyin, line.totalWithoutVatTiyin, pos++);

        const prod = db.prepare("SELECT kind FROM products WHERE id = ?").get(line.productId) as { kind: string };
        if (prod.kind === "product") {
          const cost = averageCostTiyin(line.productId, warehouseId);
          const movementValue = Math.round(line.quantityUnits * cost / 1_000_000);
          insMovement.run(orgId, docId, line.productId, warehouseId, -line.quantityUnits, -movementValue);
        }
      }

      db.prepare(`UPDATE retail_shifts SET
        revenue_cash_tiyin = revenue_cash_tiyin + ?,
        revenue_card_tiyin = revenue_card_tiyin + ?,
        revenue_total_tiyin = revenue_total_tiyin + ?
        WHERE id = ?`).run(cashTiyin, cardTiyin, computedTotalTiyin, openShift!.id);

      recordAudit("document", docId, "create", `Чек продажи ${saleNumber}: ${computedTotalTiyin / 100} ₸`, orgId);
      return db.prepare("SELECT * FROM documents WHERE id = ?").get(docId);
    })();

    res.status(201).json(result);
  } catch (err) { next(err); }
});

app.get("/api/organization/bank-accounts", (req, res) => {
  const orgId = req.auth!.organizationId;
  const accounts = db.prepare(`SELECT * FROM bank_accounts WHERE organization_id = ? AND counterparty_id IS NULL AND active = 1 ORDER BY is_default DESC, id ASC`).all(orgId);
  res.json(accounts);
});

app.post("/api/organization/bank-accounts", (req, res, next) => {
  try {
    const orgId = req.auth!.organizationId;
    const accountNumber = String(req.body.accountNumber ?? req.body.account_number ?? "").trim();
    if (!accountNumber) throw new Error("Укажите номер расчетного счета (IBAN).");
    const bik = String(req.body.bik ?? "").trim();
    const bankName = String(req.body.bankName ?? req.body.bank_name ?? "").trim();
    const bankAddress = String(req.body.bankAddress ?? req.body.bank_address ?? "").trim();
    const corrAccount = String(req.body.corrAccount ?? req.body.corr_account ?? "").trim();

    const existingCount = (db.prepare("SELECT COUNT(*) AS c FROM bank_accounts WHERE organization_id = ? AND counterparty_id IS NULL AND active = 1").get(orgId) as { c: number }).c;
    const isDefault = req.body.isDefault !== undefined || req.body.is_default !== undefined
      ? (req.body.isDefault || req.body.is_default ? 1 : 0)
      : (existingCount === 0 ? 1 : 0);

    const result = db.transaction(() => {
      if (isDefault) {
        db.prepare("UPDATE bank_accounts SET is_default = 0 WHERE organization_id = ? AND counterparty_id IS NULL").run(orgId);
      }
      const insert = db.prepare(`INSERT INTO bank_accounts
        (organization_id, counterparty_id, bik, bank_name, bank_address, corr_account, account_number, is_default, active)
        VALUES (?, NULL, ?, ?, ?, ?, ?, ?, 1)`).run(orgId, bik, bankName, bankAddress, corrAccount, accountNumber, isDefault);
      const accountId = Number(insert.lastInsertRowid);
      recordAudit("bank_account", accountId, "create", `${accountNumber}; организация`, orgId);
      return db.prepare("SELECT * FROM bank_accounts WHERE id = ?").get(accountId);
    })();
    res.status(201).json(result);
  } catch (err) { next(err); }
});

app.get("/api/bank-accounts/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(404).json({ error: "Расчетный счет не найден." });
  const orgId = req.auth!.organizationId;
  const account = db.prepare("SELECT * FROM bank_accounts WHERE id = ? AND organization_id = ?").get(id, orgId);
  if (!account) return res.status(404).json({ error: "Расчетный счет не найден." });
  res.json(account);
});

app.patch("/api/bank-accounts/:id", (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(404).json({ error: "Расчетный счет не найден." });
    const orgId = req.auth!.organizationId;
    const existing = db.prepare("SELECT * FROM bank_accounts WHERE id = ? AND organization_id = ?").get(id, orgId) as Record<string, unknown> | undefined;
    if (!existing) return res.status(404).json({ error: "Расчетный счет не найден." });

    const accountNumber = req.body.accountNumber !== undefined || req.body.account_number !== undefined
      ? String(req.body.accountNumber ?? req.body.account_number).trim()
      : String(existing.account_number);
    if (!accountNumber) throw new Error("Укажите номер расчетного счета (IBAN).");

    const bik = req.body.bik !== undefined ? String(req.body.bik).trim() : String(existing.bik ?? "");
    const bankName = req.body.bankName !== undefined || req.body.bank_name !== undefined
      ? String(req.body.bankName ?? req.body.bank_name).trim()
      : String(existing.bank_name ?? "");
    const bankAddress = req.body.bankAddress !== undefined || req.body.bank_address !== undefined
      ? String(req.body.bankAddress ?? req.body.bank_address).trim()
      : String(existing.bank_address ?? "");
    const corrAccount = req.body.corrAccount !== undefined || req.body.corr_account !== undefined
      ? String(req.body.corrAccount ?? req.body.corr_account).trim()
      : String(existing.corr_account ?? "");
    const active = req.body.active !== undefined ? (req.body.active ? 1 : 0) : Number(existing.active);

    let isDefault = Number(existing.is_default);
    if (req.body.isDefault !== undefined || req.body.is_default !== undefined) {
      isDefault = req.body.isDefault || req.body.is_default ? 1 : 0;
    }

    const result = db.transaction(() => {
      if (isDefault && !existing.is_default) {
        if (existing.counterparty_id != null) {
          db.prepare("UPDATE bank_accounts SET is_default = 0 WHERE organization_id = ? AND counterparty_id = ?").run(orgId, existing.counterparty_id);
        } else {
          db.prepare("UPDATE bank_accounts SET is_default = 0 WHERE organization_id = ? AND counterparty_id IS NULL").run(orgId);
        }
      }
      db.prepare(`UPDATE bank_accounts SET bik = ?, bank_name = ?, bank_address = ?, corr_account = ?,
        account_number = ?, is_default = ?, active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?`)
        .run(bik, bankName, bankAddress, corrAccount, accountNumber, isDefault, active, id, orgId);
      recordAudit("bank_account", id, "update", accountNumber, orgId);
      return db.prepare("SELECT * FROM bank_accounts WHERE id = ?").get(id);
    })();
    res.json(result);
  } catch (err) { next(err); }
});

app.delete("/api/bank-accounts/:id", (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(404).json({ error: "Расчетный счет не найден." });
    const orgId = req.auth!.organizationId;
    const account = db.prepare("SELECT * FROM bank_accounts WHERE id = ? AND organization_id = ?").get(id, orgId) as { account_number: string } | undefined;
    if (!account) return res.status(404).json({ error: "Расчетный счет не найден." });

    const docCount = (db.prepare("SELECT COUNT(*) AS c FROM documents WHERE bank_account_id = ? AND status <> 'deleted'").get(id) as { c: number }).c;
    if (docCount > 0) {
      db.prepare("UPDATE bank_accounts SET active = 0, is_default = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?").run(id, orgId);
      recordAudit("bank_account", id, "archive", account.account_number, orgId);
      return res.json({ ok: true, active: 0, message: "Счет архивирован, так как к нему привязаны документы." });
    }

    db.prepare("DELETE FROM bank_accounts WHERE id = ? AND organization_id = ?").run(id, orgId);
    recordAudit("bank_account", id, "delete", account.account_number, orgId);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

app.get("/api/document-statuses", (req, res) => {
  const kind = String(req.query.kind ?? "");
  const statuses = db.prepare(`SELECT * FROM document_statuses
    WHERE organization_id = ? AND (document_kind = '' OR document_kind = ?)
    ORDER BY position, id`).all(req.auth!.organizationId, kind);
  res.json(statuses);
});

app.post("/api/document-statuses", (req, res, next) => {
  try {
    const name = String(req.body.name ?? "").trim();
    if (!name) throw new Error("Укажите название статуса.");
    const color = String(req.body.color ?? "#3b82f6").trim();
    const kind = String(req.body.kind ?? "").trim();
    const position = Number(req.body.position ?? 0);
    const result = db.prepare(`INSERT INTO document_statuses (organization_id, document_kind, name, color, position)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(organization_id, document_kind, name) DO UPDATE SET color = excluded.color, position = excluded.position
      RETURNING *`).get(req.auth!.organizationId, kind, name, color, position);
    res.status(201).json(result);
  } catch (err) { next(err); }
});

app.get("/api/documents", (req, res) => {
  const kind = String(req.query.kind ?? "");
  const status = String(req.query.status ?? "all");
  const statusName = String(req.query.statusName ?? req.query.status_name ?? "").trim();
  const query = String(req.query.q ?? "").trim();
  const from = String(req.query.from ?? "").trim();
  const to = String(req.query.to ?? "").trim();
  const warehouseId = req.query.warehouseId ? Number(req.query.warehouseId) : 0;
  const counterpartyId = req.query.counterpartyId ? Number(req.query.counterpartyId) : (req.query.counterparty_id ? Number(req.query.counterparty_id) : 0);
  const contractId = req.query.contractId ? Number(req.query.contractId) : (req.query.contract_id ? Number(req.query.contract_id) : 0);
  const vehicleIdValue = String(req.query.vehicleId ?? "").trim();
  const vehicleId = vehicleIdValue ? Number(vehicleIdValue) : 0;
  if (vehicleIdValue && (!Number.isSafeInteger(vehicleId) || vehicleId <= 0)) return res.status(400).json({ error: "Некорректный идентификатор автомобиля." });

  const isPostingStatus = ["draft", "posted", "cancelled", "deleted"].includes(status);
  const filterPostingStatus = isPostingStatus ? status : "all";
  const filterStatusName = statusName || (!isPostingStatus && status !== "all" ? status : "");
  const scope = scopedDocumentFilter(db, req.auth!, "d");
  const paymentScope = scopedDocumentFilterLiteral(db, req.auth!, "payment");
  const childProgressScope = scopedDocumentFilterLiteral(db, req.auth!, "progress_child");
  const parentNumberScope = scopedDocumentFilterLiteral(db, req.auth!, "visible_parent");
  const unrestricted = isUnrestricted(req.auth!);
  if (!unrestricted && contractId) return res.status(403).json({ error: "Фильтр по договору недоступен для подразделений." });
  const contractSearchClause = unrestricted ? " OR con.number LIKE '%' || ? || '%'" : "";
  const queryParams = unrestricted ? [query, query, query, query, query] : [query, query, query, query];

  const rows = db.prepare(`SELECT d.*, c.name AS counterparty_name, w.name AS warehouse_name, v.plate AS vehicle_plate,
      destination.name AS destination_warehouse_name,
      (SELECT visible_parent.number FROM documents visible_parent
        WHERE visible_parent.id = d.parent_document_id AND visible_parent.organization_id = d.organization_id ${parentNumberScope} LIMIT 1) AS parent_document_number,
      ${unrestricted ? "con.number" : "NULL"} AS contract_number,
      (SELECT COALESCE(SUM(pa.amount_tiyin), 0) FROM payment_allocations pa
        JOIN documents payment ON payment.id = pa.payment_document_id
        WHERE pa.target_document_id = d.id AND payment.kind IN ('incoming_payment', 'payment') AND payment.status = 'posted' ${paymentScope}) AS paid_tiyin,
      CASE WHEN d.total_tiyin > 0 THEN MAX(0, d.total_tiyin - (SELECT COALESCE(SUM(pa.amount_tiyin), 0)
        FROM payment_allocations pa JOIN documents payment ON payment.id = pa.payment_document_id
        WHERE pa.target_document_id = d.id AND payment.kind IN ('incoming_payment', 'payment') AND payment.status = 'posted' ${paymentScope})) ELSE 0 END AS outstanding_tiyin,
      CASE WHEN d.total_tiyin > 0 THEN MIN(100, ROUND((SELECT COALESCE(SUM(pa.amount_tiyin), 0)
        FROM payment_allocations pa JOIN documents payment ON payment.id = pa.payment_document_id
        WHERE pa.target_document_id = d.id AND payment.kind IN ('incoming_payment', 'payment') AND payment.status = 'posted' ${paymentScope}) * 100.0 / d.total_tiyin)) ELSE 0 END AS paid_percent,
      (SELECT CASE
        WHEN d.kind = 'work_order' AND d.status = 'posted' THEN 100
        WHEN d.kind IN ('shipment', 'receipt') AND d.status = 'posted' THEN 100
        WHEN COALESCE((SELECT SUM(l.quantity_units) FROM document_lines l WHERE l.document_id = d.id), 0) > 0 THEN
          MIN(100, ROUND(COALESCE((
            SELECT SUM(child_line.quantity_units)
            FROM document_relations dr
            JOIN documents child ON child.id = dr.child_document_id
            JOIN document_lines child_line ON child_line.document_id = child.id
            WHERE dr.parent_document_id = d.id
              AND child.status = 'posted'
              AND dr.relation_type IN ('order_to_shipment', 'order_to_receipt', 'invoice_to_shipment') ${childProgressScope}
          ), (
            SELECT SUM(child_line.quantity_units)
            FROM documents child
            JOIN document_lines child_line ON child_line.document_id = child.id
            WHERE child.parent_document_id = d.id
              AND child.status = 'posted'
              AND child.kind IN ('shipment', 'receipt') ${childProgressScope}
          ), 0) * 100.0 / (SELECT SUM(l.quantity_units) FROM document_lines l WHERE l.document_id = d.id)))
        ELSE 0
      END) AS shipped_percent,
      COUNT(l.id) AS line_count FROM documents d
      LEFT JOIN counterparties c ON c.id = d.counterparty_id
      LEFT JOIN contracts con ON con.id = d.contract_id
      LEFT JOIN vehicles v ON v.id = d.vehicle_id
      LEFT JOIN warehouses w ON w.id = d.warehouse_id
      LEFT JOIN warehouses destination ON destination.id = d.destination_warehouse_id
      LEFT JOIN document_lines l ON l.document_id = d.id
      WHERE d.organization_id = ?
        AND (? = '' OR d.kind = ? OR (? = 'money_journal' AND d.kind IN ('incoming_payment','payment','cash_in','cash_out')))
        AND ((? = 'all' AND d.status <> 'deleted') OR (? <> 'all' AND d.status = ?))
        AND (? = '' OR d.status_name = ? OR d.state = ?)
        AND (? = 0 OR d.counterparty_id = ?)
        AND (? = 0 OR d.contract_id = ?)
        AND (? = 0 OR d.vehicle_id = ?)
        AND (? = 0 OR d.warehouse_id = ?)
        AND (? = '' OR d.date >= ?)
        AND (? = '' OR d.date <= ?)
        AND (? = '' OR d.number LIKE '%' || ? || '%' OR c.name LIKE '%' || ? || '%' OR d.comment LIKE '%' || ? || '%' ${contractSearchClause})
        ${scope.sql}
      GROUP BY d.id ORDER BY d.date DESC, d.id DESC`)
    .all(req.auth!.organizationId,
      kind, kind, kind,
      filterPostingStatus, filterPostingStatus, filterPostingStatus,
      filterStatusName, filterStatusName, filterStatusName,
      counterpartyId, counterpartyId,
      contractId, contractId,
      vehicleId, vehicleId,
      warehouseId, warehouseId,
      from, from,
      to, to,
      ...queryParams,
      ...scope.params) as Array<Record<string, unknown>>;
  if (!unrestricted) {
    for (const row of rows) {
      const parentId = Number(row.parent_document_id);
      if (Number.isSafeInteger(parentId) && parentId > 0 && !assertRequestDocumentAccess(db, req, parentId)) {
        row.parent_document_id = null;
        row.parent_document_number = null;
      }
      delete row.contract_id;
      delete row.contract_number;
      delete row.bank_account_id;
    }
  }
  res.json(rows);
});

app.post("/api/documents", (req, res, next) => {
  try {
    const rawKind = String(req.body.kind ?? "").trim().toLowerCase();
    const kindAliases: Record<string, string> = {
      move: "transfer",
      loss: "writeoff",
      stock_in: "enter",
      stockin: "enter",
      inventory: "stocktake",
      retaildemand: "retailsale",
      retailsale: "retailsale",
      retailsalesreturn: "retailsalesreturn",
      retailreturn: "retailsalesreturn",
    };
    const kind = kindAliases[rawKind] ?? rawKind;
    const allowed = new Set([
      "supplier_order", "supplier_invoice", "receipt", "supplier_return",
      "customer_order", "customer_invoice", "shipment", "customer_return",
      "writeoff", "stocktake", "transfer", "enter", "cash_in", "cash_out",
      "payment", "incoming_payment", "cash_correction", "work_order",
      "retailsale", "retailsalesreturn"
    ]);
    if (!allowed.has(kind)) throw new Error("Выберите тип документа.");
    const lines = Array.isArray(req.body.lines) ? req.body.lines as Array<Record<string, unknown>> : [];
    const cashKinds = new Set(["cash_in", "cash_out", "payment", "incoming_payment", "cash_correction"]);
    if (!cashKinds.has(kind) && !lines.length) throw new Error("Добавьте хотя бы одну позицию.");
    const odometerKm = parseMileage(req.body.odometerKm, "Пробег", kind === "work_order");
    const nextServiceKm = parseMileage(req.body.nextServiceKm, "Пробег следующего обслуживания");

    const result = db.transaction(() => {
      const current = db.prepare("SELECT COUNT(*) AS c FROM documents WHERE organization_id = 1 AND kind = ?").get(kind) as { c: number };
      const prefix = kind.slice(0, 3).toUpperCase();
      let sequence = current.c + 1;
      let number = `${prefix}-${String(sequence).padStart(6, "0")}`;
      while (db.prepare("SELECT 1 FROM documents WHERE organization_id = 1 AND number = ?").get(number)) {
        sequence += 1;
        number = `${prefix}-${String(sequence).padStart(6, "0")}`;
      }

      const warehouseId = req.body.warehouseId ? Number(req.body.warehouseId) : 1;
      const destinationWarehouseId = req.body.destinationWarehouseId ? Number(req.body.destinationWarehouseId) : null;
      if (!db.prepare("SELECT id FROM warehouses WHERE id = ? AND organization_id = 1 AND active = 1").get(warehouseId)) throw new Error("Выбранный склад не найден.");
      assertRequestWarehouseAccess(db, req, warehouseId);
      if (kind === "transfer" && (!destinationWarehouseId || destinationWarehouseId === warehouseId)) throw new Error("Выберите другой склад-получатель.");
      if (kind === "transfer" && !db.prepare("SELECT id FROM warehouses WHERE id = ? AND organization_id = 1 AND active = 1").get(destinationWarehouseId)) throw new Error("Склад-получатель не найден или находится в архиве.");
      if (destinationWarehouseId != null) assertRequestWarehouseAccess(db, req, destinationWarehouseId);

      const parentId = req.body.parentDocumentId ? Number(req.body.parentDocumentId) : null;
      const vehicleId = req.body.vehicleId ? Number(req.body.vehicleId) : null;
      let counterpartyId = req.body.counterpartyId ? Number(req.body.counterpartyId) : null;
      const contractId = req.body.contractId ? Number(req.body.contractId) : (req.body.contract_id ? Number(req.body.contract_id) : null);
      if (!isUnrestricted(req.auth!) && contractId) throw new Error("Доступ к договорам не настроен для подразделений.");

      if (contractId) {
        const contract = db.prepare("SELECT * FROM contracts WHERE id = ? AND organization_id = 1 AND active = 1").get(contractId) as Record<string, unknown> | undefined;
        if (!contract) throw new Error("Выбранный договор не найден или находится в архиве.");
        if (counterpartyId && Number(contract.counterparty_id) !== counterpartyId) throw new Error("Выбранный договор принадлежит другому контрагенту.");
        if (!counterpartyId) counterpartyId = Number(contract.counterparty_id);
      }

      const bankAccountId = req.body.bankAccountId ? Number(req.body.bankAccountId) : (req.body.bank_account_id ? Number(req.body.bank_account_id) : null);
      if (!isUnrestricted(req.auth!) && bankAccountId) throw new Error("Доступ к банковским счетам не настроен для подразделений.");
      if (bankAccountId) {
        const ba = db.prepare("SELECT id FROM bank_accounts WHERE id = ? AND organization_id = 1 AND active = 1").get(bankAccountId);
        if (!ba) throw new Error("Выбранный расчетный счет не найден или находится в архиве.");
      }
      const lossReason = String(req.body.lossReason ?? req.body.loss_reason ?? "").trim();

      if (kind === "work_order") {
        if (!counterpartyId || !vehicleId) throw new Error("Для заказ-наряда выберите клиента и автомобиль.");
        const customer = db.prepare("SELECT kind FROM counterparties WHERE id = ? AND organization_id = 1 AND active = 1").get(counterpartyId) as { kind: string } | undefined;
        if (!customer || !["customer", "both"].includes(customer.kind)) throw new Error("Для заказ-наряда выберите активного клиента.");
        const vehicle = db.prepare("SELECT counterparty_id FROM vehicles WHERE id = ? AND organization_id = 1").get(vehicleId) as { counterparty_id: number } | undefined;
        if (!vehicle || vehicle.counterparty_id !== counterpartyId) throw new Error("Автомобиль должен быть привязан к выбранному клиенту.");
      }

      if (parentId) {
        const parent = db.prepare("SELECT id, kind, counterparty_id, contract_id, warehouse_id FROM documents WHERE id = ? AND organization_id = 1 AND status = 'posted'").get(parentId) as Record<string, unknown> | undefined;
        if (!parent) throw new Error("Связанный документ не найден или не проведён.");
        if (!assertRequestDocumentAccess(db, req, parentId)) throw new Error("Нет доступа к связанному документу.");
        if (kind === "shipment" && parent.kind !== "customer_order") throw new Error("Для отгрузки можно выбрать заказ покупателя.");
        if (kind === "shipment") {
          if (counterpartyId && parent.counterparty_id && counterpartyId !== parent.counterparty_id) throw new Error("Клиент отгрузки должен совпадать с заказом.");
          counterpartyId = Number(parent.counterparty_id);
        }
      }

      const isVatIncluded = req.body.isVatIncluded !== undefined ? (req.body.isVatIncluded ? 1 : 0) : (req.body.is_vat_included !== undefined ? (req.body.is_vat_included ? 1 : 0) : 1);
      const deliveryAddress = String(req.body.deliveryAddress ?? req.body.delivery_address ?? "");
      const deliveryPlannedMoment = req.body.deliveryPlannedMoment ? String(req.body.deliveryPlannedMoment) : (req.body.delivery_planned_moment ? String(req.body.delivery_planned_moment) : null);
      const overheadCostTiyin = req.body.overheadCost ? parseTiyin(req.body.overheadCost) : (req.body.overhead_cost_tiyin ? Number(req.body.overhead_cost_tiyin) : 0);

      let statusName = String(req.body.statusName ?? req.body.status_name ?? req.body.state ?? "Новый").trim();
      if (!statusName) statusName = "Новый";
      if (req.body.status && !["draft", "posted", "cancelled", "deleted"].includes(String(req.body.status))) {
        statusName = String(req.body.status).trim();
      }

      for (const line of lines) {
        const product = db.prepare("SELECT id FROM products WHERE id = ? AND organization_id = 1 AND active = 1").get(Number(line.productId ?? line.product_id)) as { id: number } | undefined;
        if (!product) throw new Error("Одна из позиций не найдена.");
        if (!line.vatRate && !line.vat_rate) line.vatRate = effectiveProductVatRate(product.id);
      }

      let calculatedTotalTiyin = 0;
      let calculatedDiscountTiyin = 0;
      const isStocktake = kind === "stocktake";
      const processedLines = lines.map((line, position) => {
        const productId = Number(line.productId ?? line.product_id);
        let accountingQuantity = 0;
        let actualQuantity = 0;
        let differenceQuantity = 0;
        let costTiyin = 0;
        let quantityUnits = 0;
        let unitPriceTiyin = 0;

        if (isStocktake) {
          if (line.accountingQuantity !== undefined || line.accounting_quantity !== undefined) {
            accountingQuantity = parseSignedUnits(line.accountingQuantity ?? line.accounting_quantity, "Учётное количество");
          } else {
            const stockRow = db.prepare("SELECT COALESCE(SUM(quantity_units), 0) AS qty FROM stock_movements WHERE product_id = ? AND warehouse_id = ?").get(productId, warehouseId) as { qty: number };
            accountingQuantity = stockRow.qty;
          }

          if (line.actualQuantity !== undefined || line.actual_quantity !== undefined) {
            actualQuantity = parseOptionalUnits(line.actualQuantity ?? line.actual_quantity, "Фактическое количество");
          } else if (line.quantity !== undefined || line.quantityUnits !== undefined || line.quantity_units !== undefined) {
            actualQuantity = parseOptionalUnits(line.quantity ?? line.quantityUnits ?? line.quantity_units, "Фактическое количество");
          } else {
            actualQuantity = accountingQuantity;
          }

          if (line.differenceQuantity !== undefined || line.difference_quantity !== undefined) {
            differenceQuantity = parseSignedUnits(line.differenceQuantity ?? line.difference_quantity, "Расхождение");
          } else {
            differenceQuantity = actualQuantity - accountingQuantity;
          }

          if (line.costTiyin !== undefined || line.cost_tiyin !== undefined || line.cost !== undefined) {
            costTiyin = parseTiyin(line.costTiyin ?? line.cost_tiyin ?? line.cost);
          } else if (line.price !== undefined || line.unitPriceTiyin !== undefined || line.unit_price_tiyin !== undefined) {
            costTiyin = parseTiyin(line.price ?? line.unitPriceTiyin ?? line.unit_price_tiyin);
          } else {
            costTiyin = averageCostTiyin(productId, warehouseId);
            if (costTiyin === 0) {
              const p = db.prepare("SELECT purchase_price_tiyin FROM products WHERE id = ?").get(productId) as { purchase_price_tiyin: number } | undefined;
              costTiyin = Number(p?.purchase_price_tiyin ?? 0);
            }
          }

          quantityUnits = actualQuantity;
          unitPriceTiyin = costTiyin;
        } else {
          quantityUnits = parseUnits(line.quantity ?? line.quantityUnits ?? line.quantity_units);
          unitPriceTiyin = parseTiyin(line.price ?? line.unitPriceTiyin ?? line.unit_price_tiyin);
          if (kind === "enter" && unitPriceTiyin === 0) {
            const p = db.prepare("SELECT purchase_price_tiyin FROM products WHERE id = ?").get(productId) as { purchase_price_tiyin: number } | undefined;
            unitPriceTiyin = Number(p?.purchase_price_tiyin ?? 0);
          }
          costTiyin = (line.costTiyin !== undefined || line.cost_tiyin !== undefined)
            ? parseTiyin(line.costTiyin ?? line.cost_tiyin)
            : unitPriceTiyin;
        }

        const discountBps = parseDiscountBps(line.discountBps ?? line.discount_bps ?? line.discount ?? 0);
        const vatRate = String(line.vatRate ?? line.vat_rate ?? "");
        const fin = calculateLineFinancials(quantityUnits, unitPriceTiyin, discountBps, vatRate, Boolean(isVatIncluded));
        calculatedTotalTiyin += fin.lineTotalTiyin;
        calculatedDiscountTiyin += fin.discountTiyin;
        return {
          productId,
          quantityUnits,
          unitPriceTiyin,
          discountBps,
          vatRate,
          vatSumTiyin: fin.vatSumTiyin,
          totalWithoutVatTiyin: fin.totalWithoutVatTiyin,
          position,
          accountingQuantity,
          actualQuantity,
          differenceQuantity,
          costTiyin,
        };
      });

      const total = cashKinds.has(kind) ? parseTiyin(req.body.amount) : calculatedTotalTiyin;
      const discountTiyin = cashKinds.has(kind) ? 0 : (req.body.discountTiyin ? parseTiyin(req.body.discountTiyin) : (req.body.discount_tiyin ? Number(req.body.discount_tiyin) : calculatedDiscountTiyin));

      if (kind === "incoming_payment" && total <= 0) throw new Error("Сумма входящего платежа должна быть больше нуля.");
      const paymentMethod = kind === "incoming_payment" ? String(req.body.paymentMethod ?? "bank") : "";
      if (kind === "incoming_payment" && !["cash", "bank"].includes(paymentMethod)) throw new Error("Выберите способ оплаты: наличные или перевод.");

      const paymentAllocations = kind === "incoming_payment"
        ? normalizeIncomingPaymentAllocations(req.body.allocations, total, counterpartyId)
        : [];
      for (const allocation of paymentAllocations) {
        if (!assertRequestDocumentAccess(db, req, allocation.documentId)) throw new Error("Нет доступа к документу в распределении платежа.");
      }

      const document = db.prepare(`INSERT INTO documents
        (organization_id, number, kind, status, status_name, state, date, due_date, counterparty_id, contract_id, bank_account_id, loss_reason, vehicle_id, odometer_km, next_service_km, warehouse_id,
         destination_warehouse_id, parent_document_id, delivery_address, delivery_planned_moment, overhead_cost_tiyin, is_vat_included, discount_tiyin, payment_method, comment, total_tiyin)
        VALUES (1, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(number, kind, statusName, statusName,
          String(req.body.date ?? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty" }).format(new Date())),
          req.body.dueDate ? String(req.body.dueDate) : (req.body.due_date ? String(req.body.due_date) : null),
          counterpartyId,
          contractId,
          bankAccountId,
          lossReason,
          vehicleId,
          odometerKm,
          nextServiceKm,
          warehouseId, destinationWarehouseId, parentId,
          deliveryAddress, deliveryPlannedMoment, overheadCostTiyin, isVatIncluded, discountTiyin,
          paymentMethod, String(req.body.comment ?? ""), total);

      const documentId = Number(document.lastInsertRowid);

      const insertAllocation = db.prepare(`INSERT INTO payment_allocations
        (organization_id, payment_document_id, target_document_id, amount_tiyin) VALUES (1, ?, ?, ?)`);
      for (const allocation of paymentAllocations) {
        insertAllocation.run(documentId, allocation.documentId, allocation.amountTiyin);
        const targetDoc = db.prepare("SELECT kind FROM documents WHERE id = ?").get(allocation.documentId) as { kind: string } | undefined;
        if (targetDoc) {
          const relType = determineRelationType(targetDoc.kind, kind);
          db.prepare(`INSERT OR IGNORE INTO document_relations (organization_id, parent_document_id, child_document_id, relation_type)
            VALUES (1, ?, ?, ?)`).run(allocation.documentId, documentId, relType);
        }
      }

      if (parentId) {
        const parentDoc = db.prepare("SELECT kind FROM documents WHERE id = ?").get(parentId) as { kind: string } | undefined;
        if (parentDoc) {
          const relType = determineRelationType(parentDoc.kind, kind);
          db.prepare(`INSERT OR IGNORE INTO document_relations (organization_id, parent_document_id, child_document_id, relation_type)
            VALUES (1, ?, ?, ?)`).run(parentId, documentId, relType);
        }
      }

      const insertLine = db.prepare(`INSERT INTO document_lines
        (document_id, product_id, quantity_units, unit_price_tiyin, discount_bps, vat_rate, vat_sum_tiyin, total_without_vat_tiyin, position,
         accounting_quantity, actual_quantity, difference_quantity, cost_tiyin)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const pl of processedLines) {
        insertLine.run(documentId, pl.productId, pl.quantityUnits, pl.unitPriceTiyin, pl.discountBps, pl.vatRate, pl.vatSumTiyin, pl.totalWithoutVatTiyin, pl.position,
          pl.accountingQuantity, pl.actualQuantity, pl.differenceQuantity, pl.costTiyin);
      }

      recordAudit("document", documentId, "create", `${number}; ${kind}`);
      return { id: documentId, number, kind, totalTiyin: total };
    })();
    res.status(201).json(result);
  } catch (error) { next(error); }
});

app.get("/api/documents/:id", (req, res) => {
  const id = Number(req.params.id);
  const paymentScope = scopedDocumentFilterLiteral(db, req.auth!, "payment");
  const parentNumberScope = scopedDocumentFilterLiteral(db, req.auth!, "visible_parent");
  const document = db.prepare(`SELECT d.*, c.name AS counterparty_name, w.name AS warehouse_name,
      v.plate AS vehicle_plate, v.make AS vehicle_make, v.model AS vehicle_model,
      destination.name AS destination_warehouse_name,
      (SELECT visible_parent.number FROM documents visible_parent
        WHERE visible_parent.id = d.parent_document_id AND visible_parent.organization_id = d.organization_id ${parentNumberScope} LIMIT 1) AS parent_document_number,
      con.number AS contract_number,
      ba.account_number AS bank_account_number, ba.bank_name AS bank_account_bank_name,
      (SELECT COALESCE(SUM(pa.amount_tiyin), 0) FROM payment_allocations pa
        JOIN documents payment ON payment.id = pa.payment_document_id
        WHERE pa.target_document_id = d.id AND payment.kind IN ('incoming_payment', 'payment') AND payment.status = 'posted' ${paymentScope}) AS paid_tiyin,
      CASE WHEN d.total_tiyin > 0 THEN MAX(0, d.total_tiyin - (SELECT COALESCE(SUM(pa.amount_tiyin), 0)
        FROM payment_allocations pa JOIN documents payment ON payment.id = pa.payment_document_id
        WHERE pa.target_document_id = d.id AND payment.kind IN ('incoming_payment', 'payment') AND payment.status = 'posted' ${paymentScope})) ELSE 0 END AS outstanding_tiyin
    FROM documents d LEFT JOIN counterparties c ON c.id = d.counterparty_id
    LEFT JOIN contracts con ON con.id = d.contract_id
    LEFT JOIN bank_accounts ba ON ba.id = d.bank_account_id
    LEFT JOIN vehicles v ON v.id = d.vehicle_id
    LEFT JOIN warehouses w ON w.id = d.warehouse_id
    LEFT JOIN warehouses destination ON destination.id = d.destination_warehouse_id
    WHERE d.id = ? AND d.organization_id = 1`).get(id) as Record<string, unknown> | undefined;
  if (!document || document.status === "deleted") return res.status(404).json({ error: "Документ не найден." });

  const lines = db.prepare(`SELECT l.*, p.name AS product_name, p.code AS product_code, p.unit
    FROM document_lines l JOIN products p ON p.id = l.product_id WHERE l.document_id = ? ORDER BY l.position`).all(id);

  const paymentAllocationRows = db.prepare(`SELECT target.id AS document_id, target.number, target.kind, pa.amount_tiyin
    FROM payment_allocations pa JOIN documents target ON target.id = pa.target_document_id
    WHERE pa.payment_document_id = ? ORDER BY target.date, target.id`).all(id);

  const relationRows = db.prepare(`SELECT dr.*, p.number AS parent_number, p.kind AS parent_kind,
      c.number AS child_number, c.kind AS child_kind
    FROM document_relations dr
    JOIN documents p ON p.id = dr.parent_document_id
    JOIN documents c ON c.id = dr.child_document_id
    WHERE dr.parent_document_id = ? OR dr.child_document_id = ?
    ORDER BY dr.id`).all(id, id);

  const progress = calculateDocumentProgress(id, req.auth!.organizationId, req.auth);

  const restricted = !isUnrestricted(req.auth!);
  const paymentAllocations = restricted
    ? (paymentAllocationRows as Array<{ document_id: number }>).filter((row) => assertRequestDocumentAccess(db, req, row.document_id))
    : paymentAllocationRows;
  const relations = restricted
    ? (relationRows as Array<{ parent_document_id: number; child_document_id: number }>).filter((row) =>
      assertRequestDocumentAccess(db, req, row.parent_document_id) && assertRequestDocumentAccess(db, req, row.child_document_id))
    : relationRows;
  const contract = restricted || !document.contract_id
    ? null
    : db.prepare("SELECT * FROM contracts WHERE id = ?").get(document.contract_id);
  const bankAccount = restricted || !document.bank_account_id
    ? null
    : db.prepare("SELECT * FROM bank_accounts WHERE id = ?").get(document.bank_account_id);
  if (restricted) {
    const parentId = Number(document.parent_document_id);
    if (Number.isSafeInteger(parentId) && parentId > 0 && !assertRequestDocumentAccess(db, req, parentId)) {
      document.parent_document_id = null;
      document.parent_document_number = null;
    }
    for (const field of ["contract_id", "contract_number", "bank_account_id", "bank_account_number", "bank_account_bank_name"]) delete document[field];
  }

  res.json({
    ...document,
    lines,
    paymentAllocations,
    relations,
    contract,
    bankAccount,
    progress,
    shipped_percent: progress.shipped_percent,
    paid_percent: progress.paid_percent,
  });
});

app.patch("/api/documents/:id", (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const result = db.transaction(() => {
      const document = db.prepare("SELECT * FROM documents WHERE id = ? AND organization_id = 1").get(id) as Record<string, unknown> | undefined;
      if (!document || document.status === "deleted") throw new Error("Документ не найден.");

      const nonStatusKeys = Object.keys(req.body).filter((k) =>
        !["statusName", "status_name", "state", "comment"].includes(k) &&
        !(k === "status" && !["draft", "posted", "cancelled", "deleted"].includes(String(req.body.status)))
      );

      if (nonStatusKeys.length > 0 && document.status !== "draft") {
        throw new Error("Сначала снимите документ с проведения.");
      }

      let statusName = String(document.status_name ?? document.state ?? "Новый");
      if (req.body.statusName !== undefined || req.body.status_name !== undefined || req.body.state !== undefined) {
        statusName = String(req.body.statusName ?? req.body.status_name ?? req.body.state).trim() || statusName;
      }
      if (req.body.status && !["draft", "posted", "cancelled", "deleted"].includes(String(req.body.status))) {
        statusName = String(req.body.status).trim();
      }

      let status = String(document.status);
      if (req.body.status && ["draft", "cancelled"].includes(String(req.body.status))) {
        status = String(req.body.status);
      }

      const isVatIncluded = req.body.isVatIncluded !== undefined
        ? (req.body.isVatIncluded ? 1 : 0)
        : (req.body.is_vat_included !== undefined ? (req.body.is_vat_included ? 1 : 0) : Number(document.is_vat_included ?? 1));

      const deliveryAddress = req.body.deliveryAddress !== undefined
        ? String(req.body.deliveryAddress)
        : (req.body.delivery_address !== undefined ? String(req.body.delivery_address) : String(document.delivery_address ?? ""));

      const deliveryPlannedMoment = req.body.deliveryPlannedMoment !== undefined
        ? (req.body.deliveryPlannedMoment ? String(req.body.deliveryPlannedMoment) : null)
        : (req.body.delivery_planned_moment !== undefined ? (req.body.delivery_planned_moment ? String(req.body.delivery_planned_moment) : null) : (document.delivery_planned_moment as string | null));

      const overheadCostTiyin = req.body.overheadCost !== undefined
        ? parseTiyin(req.body.overheadCost)
        : (req.body.overhead_cost_tiyin !== undefined ? Number(req.body.overhead_cost_tiyin) : Number(document.overhead_cost_tiyin ?? 0));

      const warehouseId = req.body.warehouseId ? Number(req.body.warehouseId) : Number(document.warehouse_id);
      const destinationWarehouseId = req.body.destinationWarehouseId !== undefined
        ? (req.body.destinationWarehouseId ? Number(req.body.destinationWarehouseId) : null)
        : (document.destination_warehouse_id == null ? null : Number(document.destination_warehouse_id));
      assertRequestWarehouseAccess(db, req, warehouseId);
      if (destinationWarehouseId != null) assertRequestWarehouseAccess(db, req, destinationWarehouseId);

      let counterpartyId = req.body.counterpartyId === undefined
        ? (document.counterparty_id == null ? null : Number(document.counterparty_id))
        : (req.body.counterpartyId ? Number(req.body.counterpartyId) : null);

      let contractId = req.body.contractId === undefined && req.body.contract_id === undefined
        ? (document.contract_id == null ? null : Number(document.contract_id))
        : (req.body.contractId ? Number(req.body.contractId) : (req.body.contract_id ? Number(req.body.contract_id) : null));
      if (!isUnrestricted(req.auth!) && (req.body.contractId !== undefined || req.body.contract_id !== undefined) && contractId) throw new Error("Доступ к договорам не настроен для подразделений.");

      if (contractId) {
        const contract = db.prepare("SELECT * FROM contracts WHERE id = ? AND organization_id = 1 AND active = 1").get(contractId) as Record<string, unknown> | undefined;
        if (!contract) throw new Error("Выбранный договор не найден или находится в архиве.");
        if (counterpartyId && Number(contract.counterparty_id) !== counterpartyId) throw new Error("Выбранный договор принадлежит другому контрагенту.");
        if (!counterpartyId) counterpartyId = Number(contract.counterparty_id);
      }

      let bankAccountId = req.body.bankAccountId === undefined && req.body.bank_account_id === undefined
        ? (document.bank_account_id == null ? null : Number(document.bank_account_id))
        : (req.body.bankAccountId ? Number(req.body.bankAccountId) : (req.body.bank_account_id ? Number(req.body.bank_account_id) : null));
      if (!isUnrestricted(req.auth!) && (req.body.bankAccountId !== undefined || req.body.bank_account_id !== undefined) && bankAccountId) throw new Error("Доступ к банковским счетам не настроен для подразделений.");
      if (bankAccountId) {
        const ba = db.prepare("SELECT id FROM bank_accounts WHERE id = ? AND organization_id = 1 AND active = 1").get(bankAccountId);
        if (!ba) throw new Error("Выбранный расчетный счет не найден или находится в архиве.");
      }

      let lossReason = req.body.lossReason !== undefined
        ? String(req.body.lossReason).trim()
        : (req.body.loss_reason !== undefined ? String(req.body.loss_reason).trim() : String(document.loss_reason ?? ""));

      const vehicleId = document.kind === "work_order"
        ? (req.body.vehicleId === undefined ? (document.vehicle_id == null ? null : Number(document.vehicle_id)) : (req.body.vehicleId ? Number(req.body.vehicleId) : null))
        : (document.vehicle_id == null ? null : Number(document.vehicle_id));

      const odometerKm = document.kind === "work_order"
        ? (req.body.odometerKm === undefined ? (document.odometer_km == null ? null : Number(document.odometer_km)) : parseMileage(req.body.odometerKm, "Пробег", true))
        : (document.odometer_km == null ? null : Number(document.odometer_km));

      const nextServiceKm = document.kind === "work_order"
        ? (req.body.nextServiceKm === undefined ? (document.next_service_km == null ? null : Number(document.next_service_km)) : parseMileage(req.body.nextServiceKm, "Пробег следующего обслуживания"))
        : (document.next_service_km == null ? null : Number(document.next_service_km));

      if (document.kind === "work_order") {
        if (!counterpartyId || !vehicleId) throw new Error("Для заказ-наряда выберите клиента и автомобиль.");
        const customer = db.prepare("SELECT kind FROM counterparties WHERE id = ? AND organization_id = 1 AND active = 1").get(counterpartyId) as { kind: string } | undefined;
        if (!customer || !["customer", "both"].includes(customer.kind)) throw new Error("Для заказ-наряда выберите активного клиента.");
        const vehicle = db.prepare("SELECT counterparty_id FROM vehicles WHERE id = ? AND organization_id = 1").get(vehicleId) as { counterparty_id: number } | undefined;
        if (!vehicle || vehicle.counterparty_id !== counterpartyId) throw new Error("Автомобиль должен быть привязан к выбранному клиенту.");
      }

      if (!db.prepare("SELECT id FROM warehouses WHERE id = ? AND organization_id = 1 AND active = 1").get(warehouseId)) throw new Error("Выбранный склад не найден или находится в архиве.");
      if (document.kind === "transfer") {
        if (!destinationWarehouseId || destinationWarehouseId === warehouseId) throw new Error("Выберите другой склад-получатель.");
        if (!db.prepare("SELECT id FROM warehouses WHERE id = ? AND organization_id = 1 AND active = 1").get(destinationWarehouseId)) throw new Error("Склад-получатель не найден или находится в архиве.");
      } else if (destinationWarehouseId != null && !db.prepare("SELECT id FROM warehouses WHERE id = ? AND organization_id = 1 AND active = 1").get(destinationWarehouseId)) {
        throw new Error("Склад-получатель не найден или находится в архиве.");
      }

      const cashKinds = new Set(["cash_in", "cash_out", "payment", "incoming_payment", "cash_correction"]);
      let total = Number(document.total_tiyin);
      let discountTiyin = Number(document.discount_tiyin ?? 0);

      if (req.body.lines !== undefined) {
        const lines = Array.isArray(req.body.lines) ? req.body.lines as Array<Record<string, unknown>> : [];
        if (!cashKinds.has(String(document.kind)) && !lines.length) throw new Error("Добавьте хотя бы одну позицию.");

        for (const line of lines) {
          const product = db.prepare("SELECT id FROM products WHERE id = ? AND organization_id = 1 AND active = 1").get(Number(line.productId ?? line.product_id)) as { id: number } | undefined;
          if (!product) throw new Error("Одна из позиций не найдена.");
          if (!line.vatRate && !line.vat_rate) line.vatRate = effectiveProductVatRate(product.id);
        }

        const isStocktake = document.kind === "stocktake";
        let calculatedTotalTiyin = 0;
        let calculatedDiscountTiyin = 0;
        const processedLines = lines.map((line, position) => {
          const productId = Number(line.productId ?? line.product_id);
          let accountingQuantity = 0;
          let actualQuantity = 0;
          let differenceQuantity = 0;
          let costTiyin = 0;
          let quantityUnits = 0;
          let unitPriceTiyin = 0;

          if (isStocktake) {
            if (line.accountingQuantity !== undefined || line.accounting_quantity !== undefined) {
              accountingQuantity = parseSignedUnits(line.accountingQuantity ?? line.accounting_quantity, "Учётное количество");
            } else {
              const stockRow = db.prepare("SELECT COALESCE(SUM(quantity_units), 0) AS qty FROM stock_movements WHERE product_id = ? AND warehouse_id = ?").get(productId, warehouseId) as { qty: number };
              accountingQuantity = stockRow.qty;
            }

            if (line.actualQuantity !== undefined || line.actual_quantity !== undefined) {
              actualQuantity = parseOptionalUnits(line.actualQuantity ?? line.actual_quantity, "Фактическое количество");
            } else if (line.quantity !== undefined || line.quantityUnits !== undefined || line.quantity_units !== undefined) {
              actualQuantity = parseOptionalUnits(line.quantity ?? line.quantityUnits ?? line.quantity_units, "Фактическое количество");
            } else {
              actualQuantity = accountingQuantity;
            }

            if (line.differenceQuantity !== undefined || line.difference_quantity !== undefined) {
              differenceQuantity = parseSignedUnits(line.differenceQuantity ?? line.difference_quantity, "Расхождение");
            } else {
              differenceQuantity = actualQuantity - accountingQuantity;
            }

            if (line.costTiyin !== undefined || line.cost_tiyin !== undefined || line.cost !== undefined) {
              costTiyin = parseTiyin(line.costTiyin ?? line.cost_tiyin ?? line.cost);
            } else if (line.price !== undefined || line.unitPriceTiyin !== undefined || line.unit_price_tiyin !== undefined) {
              costTiyin = parseTiyin(line.price ?? line.unitPriceTiyin ?? line.unit_price_tiyin);
            } else {
              costTiyin = averageCostTiyin(productId, warehouseId);
              if (costTiyin === 0) {
                const p = db.prepare("SELECT purchase_price_tiyin FROM products WHERE id = ?").get(productId) as { purchase_price_tiyin: number } | undefined;
                costTiyin = Number(p?.purchase_price_tiyin ?? 0);
              }
            }

            quantityUnits = actualQuantity;
            unitPriceTiyin = costTiyin;
          } else {
            quantityUnits = parseUnits(line.quantity ?? line.quantityUnits ?? line.quantity_units);
            unitPriceTiyin = parseTiyin(line.price ?? line.unitPriceTiyin ?? line.unit_price_tiyin);
            if (document.kind === "enter" && unitPriceTiyin === 0) {
              const p = db.prepare("SELECT purchase_price_tiyin FROM products WHERE id = ?").get(productId) as { purchase_price_tiyin: number } | undefined;
              unitPriceTiyin = Number(p?.purchase_price_tiyin ?? 0);
            }
            costTiyin = (line.costTiyin !== undefined || line.cost_tiyin !== undefined)
              ? parseTiyin(line.costTiyin ?? line.cost_tiyin)
              : unitPriceTiyin;
          }

          const discountBps = parseDiscountBps(line.discountBps ?? line.discount_bps ?? line.discount ?? 0);
          const vatRate = String(line.vatRate ?? line.vat_rate ?? "");
          const fin = calculateLineFinancials(quantityUnits, unitPriceTiyin, discountBps, vatRate, Boolean(isVatIncluded));
          calculatedTotalTiyin += fin.lineTotalTiyin;
          calculatedDiscountTiyin += fin.discountTiyin;
          return {
            productId,
            quantityUnits,
            unitPriceTiyin,
            discountBps,
            vatRate,
            vatSumTiyin: fin.vatSumTiyin,
            totalWithoutVatTiyin: fin.totalWithoutVatTiyin,
            position,
            accountingQuantity,
            actualQuantity,
            differenceQuantity,
            costTiyin,
          };
        });

        total = cashKinds.has(String(document.kind))
          ? parseTiyin(req.body.amount === undefined ? Number(document.total_tiyin) / 100 : req.body.amount)
          : calculatedTotalTiyin;
        discountTiyin = calculatedDiscountTiyin;

        db.prepare("DELETE FROM document_lines WHERE document_id = ?").run(id);
        const insertLine = db.prepare(`INSERT INTO document_lines
          (document_id, product_id, quantity_units, unit_price_tiyin, discount_bps, vat_rate, vat_sum_tiyin, total_without_vat_tiyin, position,
           accounting_quantity, actual_quantity, difference_quantity, cost_tiyin)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        for (const pl of processedLines) {
          insertLine.run(id, pl.productId, pl.quantityUnits, pl.unitPriceTiyin, pl.discountBps, pl.vatRate, pl.vatSumTiyin, pl.totalWithoutVatTiyin, pl.position,
            pl.accountingQuantity, pl.actualQuantity, pl.differenceQuantity, pl.costTiyin);
        }
      } else if (cashKinds.has(String(document.kind)) && req.body.amount !== undefined) {
        total = parseTiyin(req.body.amount);
      }

      if (req.body.discountTiyin !== undefined) discountTiyin = parseTiyin(req.body.discountTiyin);
      else if (req.body.discount_tiyin !== undefined) discountTiyin = Number(req.body.discount_tiyin);

      const paymentMethod = document.kind === "incoming_payment"
        ? String(req.body.paymentMethod ?? document.payment_method ?? "bank")
        : String(document.payment_method ?? "");
      if (document.kind === "incoming_payment" && !["cash", "bank"].includes(paymentMethod)) throw new Error("Выберите способ оплаты: наличные или перевод.");

      const paymentAllocations = document.kind === "incoming_payment"
        ? normalizeIncomingPaymentAllocations(req.body.allocations ?? db.prepare(`SELECT target_document_id AS documentId, amount_tiyin AS amountTiyin
          FROM payment_allocations WHERE payment_document_id = ?`).all(id), total, counterpartyId, id)
        : [];
      for (const allocation of paymentAllocations) {
        if (!assertRequestDocumentAccess(db, req, allocation.documentId)) throw new Error("Нет доступа к документу в распределении платежа.");
      }

      const dueDate = req.body.dueDate === undefined ? (document.due_date == null ? null : String(document.due_date)) : (req.body.dueDate ? String(req.body.dueDate) : null);
      const parentDocumentId = req.body.parentDocumentId === undefined
        ? (document.parent_document_id == null ? null : Number(document.parent_document_id))
        : (req.body.parentDocumentId ? Number(req.body.parentDocumentId) : null);
      if (parentDocumentId != null && !assertRequestDocumentAccess(db, req, parentDocumentId)) throw new Error("Нет доступа к связанному документу.");
      const comment = req.body.comment === undefined ? String(document.comment ?? "") : String(req.body.comment ?? "");

      db.prepare(`UPDATE documents SET date = ?, due_date = ?, counterparty_id = ?, contract_id = ?, bank_account_id = ?, loss_reason = ?, vehicle_id = ?, odometer_km = ?, next_service_km = ?,
        warehouse_id = ?, destination_warehouse_id = ?, parent_document_id = ?, delivery_address = ?, delivery_planned_moment = ?, overhead_cost_tiyin = ?,
        is_vat_included = ?, discount_tiyin = ?, status = ?, status_name = ?, state = ?, payment_method = ?, comment = ?, total_tiyin = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(String(req.body.date ?? document.date), dueDate, counterpartyId, contractId, bankAccountId, lossReason, vehicleId, odometerKm, nextServiceKm,
          warehouseId, destinationWarehouseId, parentDocumentId,
          deliveryAddress, deliveryPlannedMoment, overheadCostTiyin, isVatIncluded, discountTiyin,
          status, statusName, statusName, paymentMethod, comment, total, id);

      if (document.kind === "incoming_payment") {
        db.prepare("DELETE FROM payment_allocations WHERE payment_document_id = ?").run(id);
        const insertAllocation = db.prepare(`INSERT INTO payment_allocations
          (organization_id, payment_document_id, target_document_id, amount_tiyin) VALUES (1, ?, ?, ?)`);
        for (const allocation of paymentAllocations) insertAllocation.run(id, allocation.documentId, allocation.amountTiyin);
      }

      if (parentDocumentId) {
        const parentDoc = db.prepare("SELECT kind FROM documents WHERE id = ?").get(parentDocumentId) as { kind: string } | undefined;
        if (parentDoc) {
          const relType = determineRelationType(parentDoc.kind, String(document.kind));
          db.prepare(`INSERT OR IGNORE INTO document_relations (organization_id, parent_document_id, child_document_id, relation_type)
            VALUES (1, ?, ?, ?)`).run(parentDocumentId, id, relType);
        }
      }

      recordAudit("document", id, "update", String(document.number));
      return db.prepare("SELECT * FROM documents WHERE id = ?").get(id);
    })();
    res.json(result);
  } catch (error) { next(error); }
});

app.post("/api/documents/bulk-status", (req: Request, res: Response, next: NextFunction) => {
  try {
    const { ids, statusName, action } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "Не выбраны документы." });
    }
    if (action === "post" || action === "unpost") {
      return res.status(400).json({ error: "Проведение и отмена проведения выполняются по каждому документу отдельно." });
    }
    const orgId = (req as any).auth?.organizationId ?? 1;
    for (const id of ids) {
      const documentId = Number(id);
      if (!Number.isSafeInteger(documentId) || !assertRequestDocumentAccess(db, req, documentId)) {
        return res.status(404).json({ error: "Документ не найден." });
      }
      if (req.auth?.role === "employee") {
        const document = db.prepare("SELECT kind FROM documents WHERE id = ? AND organization_id = ?").get(documentId, orgId) as { kind: string } | undefined;
        if (document?.kind !== "work_order") return res.status(403).json({ error: "Сотрудник может выполнять массовые действия только с заказ-нарядами." });
      }
    }
    let modified = 0;
    db.transaction(() => {
      for (const id of ids) {
        const doc = db.prepare("SELECT * FROM documents WHERE id = ? AND organization_id = ?").get(id, orgId) as any;
        if (!doc) continue;
        if (action === "delete") {
          if (doc.status !== "posted") {
            db.prepare("UPDATE documents SET status = 'deleted', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
            recordAudit("document", id, "delete", String(doc.number), orgId);
            modified++;
          }
        } else if (action === "post") {
          if (doc.status !== "posted") {
            db.prepare("UPDATE documents SET status = 'posted', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
            recordAudit("document", id, "post", String(doc.number), orgId);
            executeAutomationRules(db, { orgId, triggerType: "doc_status_change", docId: id });
            modified++;
          }
        } else if (action === "unpost") {
          if (doc.status === "posted") {
            db.prepare("UPDATE documents SET status = 'draft', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
            recordAudit("document", id, "unpost", String(doc.number), orgId);
            modified++;
          }
        } else if (statusName) {
          db.prepare("UPDATE documents SET status_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(statusName, id);
          recordAudit("document", id, "status_change", statusName, orgId);
          executeAutomationRules(db, { orgId, triggerType: "doc_status_change", docId: id });
          modified++;
        }
      }
    })();
    res.json({ ok: true, count: modified });
  } catch (err) { next(err); }
});

app.delete("/api/documents/:id", (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const document = db.prepare("SELECT * FROM documents WHERE id = ? AND organization_id = 1").get(id) as Record<string, unknown> | undefined;
    if (!document || document.status === "deleted") return res.status(404).json({ error: "Документ не найден." });
    if (document.status === "posted") throw new Error("Сначала снимите документ с проведения.");
    db.prepare("UPDATE documents SET status = 'deleted', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
    db.prepare("DELETE FROM document_relations WHERE parent_document_id = ? OR child_document_id = ?").run(id, id);
    recordAudit("document", id, "delete", String(document.number));
    res.json({ ok: true });
  } catch (error) { next(error); }
});

app.get("/api/trash", (req, res) => {
  const orgId = req.auth?.organizationId ?? 1;
  const docs = db.prepare(`
    SELECT d.*, c.name AS counterparty_name, w.name AS warehouse_name
    FROM documents d
    LEFT JOIN counterparties c ON c.id = d.counterparty_id
    LEFT JOIN warehouses w ON w.id = d.warehouse_id
    WHERE d.organization_id = ? AND d.status = 'deleted'
    ORDER BY d.updated_at DESC
  `).all(orgId);
  res.json(docs);
});

app.post("/api/trash/:id/restore", (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const orgId = req.auth?.organizationId ?? 1;
    const doc = db.prepare("SELECT * FROM documents WHERE id = ? AND organization_id = ?").get(id, orgId) as Record<string, unknown> | undefined;
    if (!doc) return res.status(404).json({ error: "Документ не найден." });
    if (doc.status !== "deleted") throw new Error("Документ не находится в корзине.");

    db.prepare("UPDATE documents SET status = 'draft', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
    recordAudit("document", id, "restore", String(doc.number), orgId);
    res.json({ ok: true, id });
  } catch (err) { next(err); }
});

app.delete("/api/trash/:id", (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const orgId = req.auth?.organizationId ?? 1;
    const doc = db.prepare("SELECT * FROM documents WHERE id = ? AND organization_id = ?").get(id, orgId) as Record<string, unknown> | undefined;
    if (!doc) return res.status(404).json({ error: "Документ не найден." });

    db.transaction(() => {
      db.prepare("DELETE FROM document_lines WHERE document_id = ?").run(id);
      db.prepare("DELETE FROM document_relations WHERE parent_document_id = ? OR child_document_id = ?").run(id, id);
      db.prepare("DELETE FROM payment_allocations WHERE target_document_id = ? OR payment_document_id = ?").run(id, id);
      db.prepare("DELETE FROM documents WHERE id = ?").run(id);
      recordAudit("document", id, "purge", String(doc.number), orgId);
    })();
    res.json({ ok: true });
  } catch (err) { next(err); }
});

app.post("/api/trash/empty", (req, res, next) => {
  try {
    const orgId = req.auth?.organizationId ?? 1;
    const deletedDocs = db.prepare("SELECT id, number FROM documents WHERE organization_id = ? AND status = 'deleted'").all(orgId) as Array<{ id: number; number: string }>;

    db.transaction(() => {
      for (const d of deletedDocs) {
        db.prepare("DELETE FROM document_lines WHERE document_id = ?").run(d.id);
        db.prepare("DELETE FROM document_relations WHERE parent_document_id = ? OR child_document_id = ?").run(d.id, d.id);
        db.prepare("DELETE FROM payment_allocations WHERE target_document_id = ? OR payment_document_id = ?").run(d.id, d.id);
        db.prepare("DELETE FROM documents WHERE id = ?").run(d.id);
      }
      recordAudit("system", 1, "empty_trash", `Очищено документов: ${deletedDocs.length}`, orgId);
    })();
    res.json({ ok: true, deletedCount: deletedDocs.length });
  } catch (err) { next(err); }
});

app.get("/api/audit", (req, res) => {
  const orgId = req.auth?.organizationId ?? 1;
  const q = String(req.query.q ?? "").trim().toLowerCase();
  const entityType = String(req.query.entityType ?? "").trim();
  const action = String(req.query.action ?? "").trim();
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const offset = Math.max(0, Number(req.query.offset) || 0);

  let query = "SELECT * FROM audit_log WHERE organization_id = ?";
  const params: unknown[] = [orgId];

  if (entityType) { query += " AND entity_type = ?"; params.push(entityType); }
  if (action) { query += " AND action = ?"; params.push(action); }
  if (q) { query += " AND (detail LIKE ? OR action LIKE ? OR entity_type LIKE ?)"; params.push(`%${q}%`, `%${q}%`, `%${q}%`); }

  const total = (db.prepare(`SELECT COUNT(*) AS c FROM (${query})`).get(...params) as { c: number }).c;
  query += " ORDER BY id DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);

  const logs = db.prepare(query).all(...params);
  res.json({ total, logs });
});

app.get("/api/reports/cashflow", (req, res) => {
  const orgId = req.auth?.organizationId ?? 1;
  const from = String(req.query.from ?? "");
  const to = String(req.query.to ?? "");

  let openingCashTiyin = 0;
  if (from) {
    const opening = db.prepare(`
      SELECT
        COALESCE(SUM(CASE
          WHEN kind IN ('cash_in', 'incoming_payment', 'payment_in') THEN total_tiyin
          WHEN kind IN ('cash_out', 'payment', 'payment_out') THEN -total_tiyin
          WHEN kind = 'retailsale' AND payment_method IN ('cash', 'split') THEN total_tiyin
          ELSE 0 END), 0) AS opening_balance
      FROM documents
      WHERE organization_id = ? AND status = 'posted' AND date < ?
    `).get(orgId, from) as { opening_balance: number };
    openingCashTiyin = opening?.opening_balance ?? 0;
  }

  let txQuery = `
    SELECT d.id, d.number, d.date, d.kind, d.total_tiyin, d.comment, d.payment_method,
      c.name AS counterparty_name,
      ba.bank_name, ba.account_number
    FROM documents d
    LEFT JOIN counterparties c ON c.id = d.counterparty_id
    LEFT JOIN bank_accounts ba ON ba.id = d.bank_account_id
    WHERE d.organization_id = ? AND d.status = 'posted'
      AND d.kind IN ('cash_in', 'cash_out', 'incoming_payment', 'payment', 'retailsale')
  `;
  const params: unknown[] = [orgId];
  if (from) { txQuery += " AND d.date >= ?"; params.push(from); }
  if (to) { txQuery += " AND d.date <= ?"; params.push(to); }
  txQuery += " ORDER BY d.date ASC, d.id ASC";

  const rows = db.prepare(txQuery).all(...params) as Array<Record<string, unknown>>;

  let totalInflowTiyin = 0;
  let totalOutflowTiyin = 0;

  const items = rows.map((r) => {
    const kind = String(r.kind);
    const amount = Number(r.total_tiyin);
    const isInflow = ['cash_in', 'incoming_payment', 'payment_in', 'retailsale'].includes(kind);
    if (isInflow) totalInflowTiyin += amount;
    else totalOutflowTiyin += amount;

    return {
      id: r.id,
      number: r.number,
      date: r.date,
      kind: r.kind,
      direction: isInflow ? "in" : "out",
      amount_tiyin: amount,
      counterparty_name: r.counterparty_name,
      account: r.account_number ? `${r.bank_name || 'Банк'} (${r.account_number})` : "Касса",
      comment: r.comment,
    };
  });

  const netCashflowTiyin = totalInflowTiyin - totalOutflowTiyin;
  const closingCashTiyin = openingCashTiyin + netCashflowTiyin;

  res.json({
    opening_balance_tiyin: openingCashTiyin,
    total_inflow_tiyin: totalInflowTiyin,
    total_outflow_tiyin: totalOutflowTiyin,
    net_cashflow_tiyin: netCashflowTiyin,
    closing_balance_tiyin: closingCashTiyin,
    items,
  });
});

app.get("/api/reports/pnl", (req, res) => {
  const orgId = req.auth?.organizationId ?? 1;
  const from = String(req.query.from ?? "");
  const to = String(req.query.to ?? "");

  let dateFilter = "";
  const params: unknown[] = [orgId];
  if (from) { dateFilter += " AND d.date >= ?"; params.push(from); }
  if (to) { dateFilter += " AND d.date <= ?"; params.push(to); }

  const revenueData = db.prepare(`
    SELECT
      d.kind,
      COUNT(DISTINCT d.id) AS doc_count,
      COALESCE(SUM(d.total_tiyin), 0) AS total_revenue_tiyin
    FROM documents d
    WHERE d.organization_id = ? AND d.status = 'posted'
      AND d.kind IN ('work_order', 'shipment', 'retailsale')
      ${dateFilter}
    GROUP BY d.kind
  `).all(...params) as Array<{ kind: string; doc_count: number; total_revenue_tiyin: number }>;

  const totalRevenueTiyin = revenueData.reduce((acc, r) => acc + Number(r.total_revenue_tiyin), 0);

  const cogsData = db.prepare(`
    SELECT
      COALESCE(SUM(sm.value_tiyin), 0) AS total_cogs_tiyin
    FROM stock_movements sm
    JOIN documents d ON d.id = sm.document_id
    WHERE sm.organization_id = ? AND d.status = 'posted'
      AND d.kind IN ('work_order', 'shipment', 'retailsale', 'writeoff')
      AND sm.quantity_units < 0
      ${dateFilter}
  `).get(...params) as { total_cogs_tiyin: number };

  const cogsTiyin = Math.abs(Number(cogsData?.total_cogs_tiyin ?? 0));
  const grossProfitTiyin = totalRevenueTiyin - cogsTiyin;
  const grossMarginPercent = totalRevenueTiyin > 0 ? (grossProfitTiyin / totalRevenueTiyin) * 100 : 0;

  const itemProfitability = db.prepare(`
    SELECT
      p.id AS product_id,
      p.name AS product_name,
      p.code AS product_code,
      p.kind AS product_kind,
      COALESCE(SUM(l.quantity_units), 0) AS sold_quantity_units,
      COALESCE(SUM(ROUND(l.quantity_units * l.unit_price_tiyin / 1000000)), 0) AS revenue_tiyin
    FROM document_lines l
    JOIN documents d ON d.id = l.document_id
    JOIN products p ON p.id = l.product_id
    WHERE d.organization_id = ? AND d.status = 'posted'
      AND d.kind IN ('work_order', 'shipment', 'retailsale')
      ${dateFilter}
    GROUP BY p.id
    ORDER BY revenue_tiyin DESC
    LIMIT 20
  `).all(...params) as Array<{ product_id: number; product_name: string; product_code: string; product_kind: string; sold_quantity_units: number; revenue_tiyin: number }>;

  res.json({
    total_revenue_tiyin: totalRevenueTiyin,
    total_cogs_tiyin: cogsTiyin,
    gross_profit_tiyin: grossProfitTiyin,
    gross_margin_percent: grossMarginPercent,
    revenue_by_kind: revenueData,
    top_items: itemProfitability,
  });
});

app.get("/api/reports/settlements", (req, res) => {
  const orgId = req.auth?.organizationId ?? 1;

  const settlements = db.prepare(`
    SELECT
      c.id, c.name, c.kind, c.phone,
      COALESCE((
        SELECT SUM(d.total_tiyin)
        FROM documents d
        WHERE d.counterparty_id = c.id AND d.organization_id = ? AND d.status = 'posted'
          AND d.kind IN ('customer_order', 'work_order', 'shipment', 'customer_invoice')
      ), 0) AS total_invoiced_tiyin,
      COALESCE((
        SELECT SUM(d.total_tiyin)
        FROM documents d
        WHERE d.counterparty_id = c.id AND d.organization_id = ? AND d.status = 'posted'
          AND d.kind IN ('incoming_payment', 'cash_in')
      ), 0) AS total_customer_paid_tiyin,
      COALESCE((
        SELECT SUM(d.total_tiyin)
        FROM documents d
        WHERE d.counterparty_id = c.id AND d.organization_id = ? AND d.status = 'posted'
          AND d.kind IN ('supplier_order', 'receipt', 'supplier_invoice')
      ), 0) AS total_supplier_billed_tiyin,
      COALESCE((
        SELECT SUM(d.total_tiyin)
        FROM documents d
        WHERE d.counterparty_id = c.id AND d.organization_id = ? AND d.status = 'posted'
          AND d.kind IN ('payment', 'cash_out')
      ), 0) AS total_we_paid_tiyin
    FROM counterparties c
    WHERE c.organization_id = ? AND c.active = 1
    ORDER BY c.name ASC
  `).all(orgId, orgId, orgId, orgId, orgId) as Array<{
    id: number;
    name: string;
    kind: string;
    phone: string;
    total_invoiced_tiyin: number;
    total_customer_paid_tiyin: number;
    total_supplier_billed_tiyin: number;
    total_we_paid_tiyin: number;
  }>;

  let totalCustomerDebtTiyin = 0;
  let totalSupplierDebtTiyin = 0;

  const rows = settlements.map((s) => {
    const customerDebt = Math.max(0, Number(s.total_invoiced_tiyin) - Number(s.total_customer_paid_tiyin));
    const supplierDebt = Math.max(0, Number(s.total_supplier_billed_tiyin) - Number(s.total_we_paid_tiyin));
    totalCustomerDebtTiyin += customerDebt;
    totalSupplierDebtTiyin += supplierDebt;

    return {
      ...s,
      customer_debt_tiyin: customerDebt,
      supplier_debt_tiyin: supplierDebt,
      balance_tiyin: customerDebt - supplierDebt,
    };
  });

  res.json({
    total_customer_debt_tiyin: totalCustomerDebtTiyin,
    total_supplier_debt_tiyin: totalSupplierDebtTiyin,
    net_receivables_tiyin: totalCustomerDebtTiyin - totalSupplierDebtTiyin,
    items: rows,
  });
});

app.get("/api/reports/turnover", (req, res) => {
  const orgId = req.auth?.organizationId ?? 1;
  const warehouseId = req.query.warehouseId ? Number(req.query.warehouseId) : null;
  const from = String(req.query.from ?? "");
  const to = String(req.query.to ?? "");

  const products = db.prepare("SELECT id, name, code, unit, kind FROM products WHERE organization_id = ? AND active = 1 ORDER BY name ASC").all(orgId) as Array<{ id: number; name: string; code: string; unit: string; kind: string }>;

  const items = products.map((p) => {
    let whFilter = "";
    const baseParams: unknown[] = [p.id];
    if (warehouseId) { whFilter = " AND warehouse_id = ?"; baseParams.push(warehouseId); }

    let initialUnits = 0;
    let initialValueTiyin = 0;
    if (from) {
      const initRow = db.prepare(`
        SELECT COALESCE(SUM(sm.quantity_units), 0) AS q, COALESCE(SUM(sm.value_tiyin), 0) AS v
        FROM stock_movements sm
        JOIN documents d ON d.id = sm.document_id
        WHERE sm.product_id = ? ${whFilter} AND d.date < ?
      `).get(...baseParams, from) as { q: number; v: number };
      initialUnits = initRow?.q ?? 0;
      initialValueTiyin = initRow?.v ?? 0;
    }

    let inFilter = " AND sm.quantity_units > 0";
    const inParams = [...baseParams];
    if (from) { inFilter += " AND d.date >= ?"; inParams.push(from); }
    if (to) { inFilter += " AND d.date <= ?"; inParams.push(to); }
    const inRow = db.prepare(`
      SELECT COALESCE(SUM(sm.quantity_units), 0) AS q, COALESCE(SUM(sm.value_tiyin), 0) AS v
      FROM stock_movements sm
      JOIN documents d ON d.id = sm.document_id
      WHERE sm.product_id = ? ${whFilter} ${inFilter}
    `).get(...inParams) as { q: number; v: number };

    let outFilter = " AND sm.quantity_units < 0";
    const outParams = [...baseParams];
    if (from) { outFilter += " AND d.date >= ?"; outParams.push(from); }
    if (to) { outFilter += " AND d.date <= ?"; outParams.push(to); }
    const outRow = db.prepare(`
      SELECT COALESCE(SUM(sm.quantity_units), 0) AS q, COALESCE(SUM(sm.value_tiyin), 0) AS v
      FROM stock_movements sm
      JOIN documents d ON d.id = sm.document_id
      WHERE sm.product_id = ? ${whFilter} ${outFilter}
    `).get(...outParams) as { q: number; v: number };

    const inUnits = inRow?.q ?? 0;
    const inValueTiyin = inRow?.v ?? 0;
    const outUnits = Math.abs(outRow?.q ?? 0);
    const outValueTiyin = Math.abs(outRow?.v ?? 0);
    const finalUnits = initialUnits + inUnits - outUnits;
    const finalValueTiyin = initialValueTiyin + inValueTiyin - outValueTiyin;

    return {
      product_id: p.id,
      product_name: p.name,
      product_code: p.code,
      unit: p.unit,
      initial_units: initialUnits,
      initial_value_tiyin: initialValueTiyin,
      inflow_units: inUnits,
      inflow_value_tiyin: inValueTiyin,
      outflow_units: outUnits,
      outflow_value_tiyin: outValueTiyin,
      final_units: finalUnits,
      final_value_tiyin: finalValueTiyin,
    };
  });

  res.json({ items });
});

app.post("/api/documents/:id/create-child", (req, res, next) => {
  try {
    const parentId = Number(req.params.id);
    if (!Number.isSafeInteger(parentId) || parentId <= 0) return res.status(404).json({ error: "Документ не найден." });

    const rawKind = String(req.body.kind ?? "").trim().toLowerCase();
    const kindAliases: Record<string, string> = {
      customerinvoice: "customer_invoice",
      supplierinvoice: "supplier_invoice",
      customerorder: "customer_order",
      supplierorder: "supplier_order",
      incomingpayment: "incoming_payment",
      workorder: "work_order",
      customerreturn: "customer_return",
      supplierreturn: "supplier_return",
      move: "transfer",
      loss: "writeoff",
      stock_in: "enter",
      stockin: "enter",
      enter: "enter",
      inventory: "stocktake",
      retailsale: "retailsale",
      retaildemand: "retailsale",
      retailsalesreturn: "retailsalesreturn",
      retailreturn: "retailsalesreturn",
    };
    const childKind = kindAliases[rawKind] ?? rawKind;
    const allowed = new Set([
      "supplier_order", "supplier_invoice", "receipt", "supplier_return",
      "customer_order", "customer_invoice", "shipment", "customer_return",
      "writeoff", "stocktake", "transfer", "enter", "cash_in", "cash_out",
      "payment", "incoming_payment", "cash_correction", "work_order",
      "retailsale", "retailsalesreturn"
    ]);
    if (!allowed.has(childKind)) throw new Error(`Недопустимый тип дочернего документа: «${rawKind}».`);

    const result = db.transaction(() => {
      const parent = db.prepare("SELECT * FROM documents WHERE id = ? AND organization_id = 1").get(parentId) as Record<string, unknown> | undefined;
      if (!parent || parent.status === "deleted") throw new Error("Родительский документ не найден.");

      const parentKind = String(parent.kind);
      const cashKinds = new Set(["cash_in", "cash_out", "payment", "incoming_payment", "cash_correction"]);
      const isCash = cashKinds.has(childKind);

      const current = db.prepare("SELECT COUNT(*) AS c FROM documents WHERE organization_id = 1 AND kind = ?").get(childKind) as { c: number };
      const prefix = childKind.slice(0, 3).toUpperCase();
      let sequence = current.c + 1;
      let number = `${prefix}-${String(sequence).padStart(6, "0")}`;
      while (db.prepare("SELECT 1 FROM documents WHERE organization_id = 1 AND number = ?").get(number)) {
        sequence += 1;
        number = `${prefix}-${String(sequence).padStart(6, "0")}`;
      }

      const counterpartyId = parent.counterparty_id != null ? Number(parent.counterparty_id) : null;
      const contractId = parent.contract_id != null ? Number(parent.contract_id) : null;
      const bankAccountId = req.body.bankAccountId ? Number(req.body.bankAccountId) : (req.body.bank_account_id ? Number(req.body.bank_account_id) : (parent.bank_account_id != null ? Number(parent.bank_account_id) : null));
      const warehouseId = req.body.warehouseId ? Number(req.body.warehouseId) : (parent.warehouse_id != null ? Number(parent.warehouse_id) : 1);
      const destinationWarehouseId = req.body.destinationWarehouseId ? Number(req.body.destinationWarehouseId) : (parent.destination_warehouse_id != null ? Number(parent.destination_warehouse_id) : null);
      assertRequestWarehouseAccess(db, req, warehouseId);
      if (destinationWarehouseId != null) assertRequestWarehouseAccess(db, req, destinationWarehouseId);
      const vehicleId = parent.vehicle_id != null ? Number(parent.vehicle_id) : null;
      const date = String(req.body.date ?? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty" }).format(new Date()));
      const dueDate = req.body.dueDate ? String(req.body.dueDate) : (req.body.due_date ? String(req.body.due_date) : null);

      let defaultComment = `На основании ${parent.number}`;
      let lossReason = "";
      if (parentKind === "stocktake") {
        if (childKind === "enter") {
          defaultComment = `Оприходование излишков по инвентаризации ${parent.number}`;
        } else if (childKind === "writeoff") {
          lossReason = "Недостача при инвентаризации";
          defaultComment = `Списание недостачи по инвентаризации ${parent.number}`;
        }
      }
      if (req.body.lossReason !== undefined || req.body.loss_reason !== undefined) {
        lossReason = String(req.body.lossReason ?? req.body.loss_reason).trim();
      }
      const comment = String(req.body.comment ?? defaultComment);

      const deliveryAddress = String(req.body.deliveryAddress ?? parent.delivery_address ?? "");
      const deliveryPlannedMoment = req.body.deliveryPlannedMoment ? String(req.body.deliveryPlannedMoment) : (parent.delivery_planned_moment ? String(parent.delivery_planned_moment) : null);
      const isVatIncluded = req.body.isVatIncluded !== undefined ? (req.body.isVatIncluded ? 1 : 0) : Number(parent.is_vat_included ?? 1);

      let totalTiyin = 0;
      let discountTiyin = 0;
      const linesToInsert: Array<{
        productId: number;
        quantityUnits: number;
        unitPriceTiyin: number;
        discountBps: number;
        vatRate: string;
        vatSumTiyin: number;
        totalWithoutVatTiyin: number;
        position: number;
        accountingQuantity: number;
        actualQuantity: number;
        differenceQuantity: number;
        costTiyin: number;
      }> = [];

      if (isCash) {
        const paidRow = db.prepare(`SELECT COALESCE(SUM(pa.amount_tiyin), 0) AS paid
          FROM payment_allocations pa
          JOIN documents p ON p.id = pa.payment_document_id
          WHERE pa.target_document_id = ? AND p.status = 'posted'`).get(parentId) as { paid: number };
        const unpaid = Math.max(0, Number(parent.total_tiyin) - Number(paidRow.paid));
        totalTiyin = req.body.amount !== undefined ? parseTiyin(req.body.amount) : (unpaid > 0 ? unpaid : Number(parent.total_tiyin));
        if (totalTiyin <= 0) totalTiyin = Number(parent.total_tiyin);
      } else {
        const customLines = Array.isArray(req.body.lines) ? req.body.lines as Array<Record<string, unknown>> : null;
        if (customLines && customLines.length > 0) {
          customLines.forEach((line, position) => {
            const quantityUnits = parseUnits(line.quantity ?? line.quantityUnits ?? line.quantity_units);
            const unitPriceTiyin = parseTiyin(line.price ?? line.unitPriceTiyin ?? line.unit_price_tiyin);
            const discountBps = parseDiscountBps(line.discountBps ?? line.discount_bps ?? 0);
            const vatRate = String(line.vatRate ?? line.vat_rate ?? "");
            const fin = calculateLineFinancials(quantityUnits, unitPriceTiyin, discountBps, vatRate, Boolean(isVatIncluded));
            totalTiyin += fin.lineTotalTiyin;
            discountTiyin += fin.discountTiyin;
            linesToInsert.push({
              productId: Number(line.productId ?? line.product_id),
              quantityUnits,
              unitPriceTiyin,
              discountBps,
              vatRate,
              vatSumTiyin: fin.vatSumTiyin,
              totalWithoutVatTiyin: fin.totalWithoutVatTiyin,
              position,
              accountingQuantity: 0,
              actualQuantity: quantityUnits,
              differenceQuantity: 0,
              costTiyin: unitPriceTiyin,
            });
          });
        } else if (parentKind === "stocktake") {
          const parentLines = db.prepare(`SELECT * FROM document_lines WHERE document_id = ? ORDER BY position`).all(parentId) as Array<Record<string, unknown>>;
          if (!parentLines.length) throw new Error("У инвентаризации нет строк для переноса.");

          if (childKind === "enter") {
            let position = 0;
            for (const line of parentLines) {
              const diff = Number(line.difference_quantity ?? 0) !== 0
                ? Number(line.difference_quantity)
                : (Number(line.actual_quantity ?? 0) - Number(line.accounting_quantity ?? 0));
              if (diff <= 0) continue;
              const unitPriceTiyin = Number(line.cost_tiyin ?? 0) > 0
                ? Number(line.cost_tiyin)
                : (Number(line.unit_price_tiyin ?? 0) > 0 ? Number(line.unit_price_tiyin) : averageCostTiyin(Number(line.product_id), warehouseId));
              const vatRate = String(line.vat_rate ?? "");
              const fin = calculateLineFinancials(diff, unitPriceTiyin, 0, vatRate, Boolean(isVatIncluded));
              totalTiyin += fin.lineTotalTiyin;
              linesToInsert.push({
                productId: Number(line.product_id),
                quantityUnits: diff,
                unitPriceTiyin,
                discountBps: 0,
                vatRate,
                vatSumTiyin: fin.vatSumTiyin,
                totalWithoutVatTiyin: fin.totalWithoutVatTiyin,
                position: position++,
                accountingQuantity: 0,
                actualQuantity: diff,
                differenceQuantity: 0,
                costTiyin: unitPriceTiyin,
              });
            }
            if (!linesToInsert.length) throw new Error("В инвентаризации нет излишков для оприходования.");
          } else if (childKind === "writeoff") {
            let position = 0;
            for (const line of parentLines) {
              const diff = Number(line.difference_quantity ?? 0) !== 0
                ? Number(line.difference_quantity)
                : (Number(line.actual_quantity ?? 0) - Number(line.accounting_quantity ?? 0));
              if (diff >= 0) continue;
              const deficit = Math.abs(diff);
              const unitPriceTiyin = Number(line.cost_tiyin ?? 0) > 0
                ? Number(line.cost_tiyin)
                : (Number(line.unit_price_tiyin ?? 0) > 0 ? Number(line.unit_price_tiyin) : averageCostTiyin(Number(line.product_id), warehouseId));
              const vatRate = String(line.vat_rate ?? "");
              const fin = calculateLineFinancials(deficit, unitPriceTiyin, 0, vatRate, Boolean(isVatIncluded));
              totalTiyin += fin.lineTotalTiyin;
              linesToInsert.push({
                productId: Number(line.product_id),
                quantityUnits: deficit,
                unitPriceTiyin,
                discountBps: 0,
                vatRate,
                vatSumTiyin: fin.vatSumTiyin,
                totalWithoutVatTiyin: fin.totalWithoutVatTiyin,
                position: position++,
                accountingQuantity: 0,
                actualQuantity: deficit,
                differenceQuantity: 0,
                costTiyin: unitPriceTiyin,
              });
            }
            if (!linesToInsert.length) throw new Error("В инвентаризации нет недостачи для списания.");
          } else {
            throw new Error(`Из инвентаризации можно создать только оприходование (enter) или списание (writeoff).`);
          }
        } else {
          const parentLines = db.prepare(`SELECT * FROM document_lines WHERE document_id = ? ORDER BY position`).all(parentId) as Array<Record<string, unknown>>;
          if (!parentLines.length) throw new Error("У родительского документа нет строк для переноса.");

          const shippedMap = new Map<number, number>();
          if (childKind === "shipment" && parentKind === "customer_order") {
            const previouslyShipped = db.prepare(`
              SELECT l.product_id, SUM(l.quantity_units) AS quantity
              FROM documents d
              JOIN document_lines l ON l.document_id = d.id
              WHERE d.parent_document_id = ? AND d.kind = 'shipment' AND d.status <> 'deleted'
              GROUP BY l.product_id
            `).all(parentId) as Array<{ product_id: number; quantity: number }>;
            for (const s of previouslyShipped) shippedMap.set(s.product_id, s.quantity);
          }

          let position = 0;
          for (const line of parentLines) {
            let qty = Number(line.quantity_units);
            if (childKind === "shipment" && parentKind === "customer_order") {
              const alreadyShipped = shippedMap.get(Number(line.product_id)) ?? 0;
              qty = Math.max(0, qty - alreadyShipped);
              if (qty <= 0) continue;
            }
            const unitPriceTiyin = Number(line.unit_price_tiyin);
            const discountBps = Number(line.discount_bps ?? 0);
            const vatRate = String(line.vat_rate ?? "");
            const fin = calculateLineFinancials(qty, unitPriceTiyin, discountBps, vatRate, Boolean(isVatIncluded));
            totalTiyin += fin.lineTotalTiyin;
            discountTiyin += fin.discountTiyin;
            linesToInsert.push({
              productId: Number(line.product_id),
              quantityUnits: qty,
              unitPriceTiyin,
              discountBps,
              vatRate,
              vatSumTiyin: fin.vatSumTiyin,
              totalWithoutVatTiyin: fin.totalWithoutVatTiyin,
              position: position++,
              accountingQuantity: 0,
              actualQuantity: qty,
              differenceQuantity: 0,
              costTiyin: unitPriceTiyin,
            });
          }

          if (!linesToInsert.length) {
            throw new Error("Все позиции родительского документа уже отгружены.");
          }
        }
      }

      const paymentMethod = isCash ? String(req.body.paymentMethod ?? "bank") : "";

      const insertDoc = db.prepare(`
        INSERT INTO documents (
          organization_id, number, kind, status, status_name, state, date, due_date,
          counterparty_id, contract_id, bank_account_id, loss_reason, vehicle_id, warehouse_id, destination_warehouse_id,
          parent_document_id, delivery_address, delivery_planned_moment, overhead_cost_tiyin,
          is_vat_included, discount_tiyin, payment_method, comment, total_tiyin
        ) VALUES (
          1, ?, ?, 'draft', 'Новый', 'Новый', ?, ?,
          ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, 0,
          ?, ?, ?, ?, ?
        )
      `).run(
        number, childKind, date, dueDate,
        counterpartyId, contractId, bankAccountId, lossReason, vehicleId, warehouseId, destinationWarehouseId,
        parentId, deliveryAddress, deliveryPlannedMoment,
        isVatIncluded, discountTiyin, paymentMethod, comment, totalTiyin
      );

      const childId = Number(insertDoc.lastInsertRowid);

      const insertLine = db.prepare(`
        INSERT INTO document_lines (
          document_id, product_id, quantity_units, unit_price_tiyin, discount_bps, vat_rate, vat_sum_tiyin, total_without_vat_tiyin, position,
          accounting_quantity, actual_quantity, difference_quantity, cost_tiyin
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const pl of linesToInsert) {
        insertLine.run(childId, pl.productId, pl.quantityUnits, pl.unitPriceTiyin, pl.discountBps, pl.vatRate, pl.vatSumTiyin, pl.totalWithoutVatTiyin, pl.position,
          pl.accountingQuantity, pl.actualQuantity, pl.differenceQuantity, pl.costTiyin);
      }

      if (isCash && counterpartyId) {
        db.prepare(`
          INSERT INTO payment_allocations (organization_id, payment_document_id, target_document_id, amount_tiyin)
          VALUES (1, ?, ?, ?)
        `).run(childId, parentId, totalTiyin);
      }

      const relationType = determineRelationType(parentKind, childKind);
      db.prepare(`
        INSERT OR IGNORE INTO document_relations (organization_id, parent_document_id, child_document_id, relation_type)
        VALUES (1, ?, ?, ?)
      `).run(parentId, childId, relationType);

      recordAudit("document", childId, "create_child", `${number}; ${childKind}; parent: ${parent.number}`);

      return {
        id: childId,
        number,
        kind: childKind,
        parentDocumentId: parentId,
        parentNumber: parent.number,
        relationType,
        totalTiyin,
        lineCount: linesToInsert.length,
      };
    })();

    res.status(201).json(result);
  } catch (err) { next(err); }
});

app.get(["/api/documents/:id/chain", "/api/documents/:id/relations"], (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(404).json({ error: "Документ не найден." });
    const orgId = req.auth!.organizationId;
    const chainData = getConnectedDocumentChain(id, orgId);
    if (!chainData.document) return res.status(404).json({ error: "Документ не найден." });
    if (!isUnrestricted(req.auth!) && chainData.chain.some((document) => !assertRequestDocumentAccess(db, req, Number(document.id)))) {
      return res.status(404).json({ error: "Документ не найден." });
    }
    if (!isUnrestricted(req.auth!) && chainData.root) chainData.progress = calculateDocumentProgress(Number(chainData.root.id), orgId, req.auth);
    res.json(chainData);
  } catch (err) { next(err); }
});

const stockKinds = new Set(["receipt", "shipment", "customer_return", "supplier_return", "writeoff", "stocktake", "transfer", "enter", "work_order", "retailsale", "retailsalesreturn"]);

function averageCostTiyin(productId: number, warehouseId: number): number {
  const balance = db.prepare(`SELECT COALESCE(SUM(quantity_units),0) AS quantity,
      COALESCE(SUM(value_tiyin),0) AS value FROM stock_movements
    WHERE product_id = ? AND warehouse_id = ?`).get(productId, warehouseId) as { quantity: number; value: number };
  if (balance.quantity > 0 && balance.value >= 0) return Math.round(balance.value * 1_000_000 / balance.quantity);
  const product = db.prepare("SELECT purchase_price_tiyin FROM products WHERE id = ?").get(productId) as { purchase_price_tiyin: number } | undefined;
  return product?.purchase_price_tiyin ?? 0;
}

function addReservation(orderId: number, productId: number, warehouseId: number, quantity: number) {
  db.prepare(`INSERT INTO stock_reservations (organization_id, document_id, product_id, warehouse_id, quantity_units)
    VALUES (1, ?, ?, ?, ?) ON CONFLICT(document_id, product_id, warehouse_id)
    DO UPDATE SET quantity_units = quantity_units + excluded.quantity_units`)
    .run(orderId, productId, warehouseId, quantity);
}

app.post("/api/documents/:id/post", (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const result = db.transaction(() => {
      const doc = db.prepare("SELECT * FROM documents WHERE id = ? AND organization_id = 1").get(id) as Record<string, unknown> | undefined;
      if (!doc || doc.status === "deleted") throw new Error("Документ не найден.");
      if (doc.status === "posted") throw new Error("Документ уже проведён.");
      if (stockKinds.has(String(doc.kind)) || doc.kind === "customer_order") {
        if (!db.prepare("SELECT id FROM warehouses WHERE id = ? AND organization_id = 1 AND active = 1").get(Number(doc.warehouse_id))) {
          throw new Error("Склад документа не найден или находится в архиве. Выберите активный склад и сохраните документ заново.");
        }
        if (doc.kind === "transfer" && !db.prepare("SELECT id FROM warehouses WHERE id = ? AND organization_id = 1 AND active = 1").get(Number(doc.destination_warehouse_id))) {
          throw new Error("Склад-получатель не найден или находится в архиве. Выберите активный склад и сохраните документ заново.");
        }
      }
      const lines = db.prepare("SELECT * FROM document_lines WHERE document_id = ? ORDER BY position").all(id) as Array<Record<string, number>>;
      if (doc.kind === "incoming_payment") {
        const allocations = db.prepare(`SELECT target_document_id AS documentId, amount_tiyin AS amountTiyin
          FROM payment_allocations WHERE payment_document_id = ?`).all(id);
        normalizeIncomingPaymentAllocations(allocations, Number(doc.total_tiyin), doc.counterparty_id == null ? null : Number(doc.counterparty_id), id);
      }
      const movements = db.prepare(`INSERT INTO stock_movements
        (organization_id, document_id, product_id, warehouse_id, quantity_units, value_tiyin)
        VALUES (1, ?, ?, ?, ?, ?)`);
      const stockBalance = db.prepare(`SELECT COALESCE(SUM(quantity_units),0) AS quantity FROM stock_movements
        WHERE product_id = ? AND warehouse_id = ?`);
      const reservedBalance = db.prepare(`SELECT COALESCE(SUM(quantity_units),0) AS quantity FROM stock_reservations
        WHERE product_id = ? AND warehouse_id = ?`);
      const allowNegative = db.prepare("SELECT value FROM settings WHERE key = 'allowNegativeStock'").get() as { value: string } | undefined;
      if (doc.kind === "customer_order") {
        for (const line of lines) {
          const product = db.prepare("SELECT kind FROM products WHERE id = ?").get(line.product_id) as { kind: string };
          if (product.kind === "product") {
            const balance = stockBalance.get(line.product_id, Number(doc.warehouse_id)) as { quantity: number };
            const reserved = reservedBalance.get(line.product_id, Number(doc.warehouse_id)) as { quantity: number };
            if (balance.quantity - reserved.quantity < line.quantity_units) {
              throw new Error(`Недостаточно свободного товара для резерва: ${line.product_id}.`);
            }
            addReservation(id, line.product_id, Number(doc.warehouse_id), line.quantity_units);
          }
        }
      }
      if (doc.kind === "shipment" && doc.parent_document_id) {
        const parent = db.prepare("SELECT kind, status, counterparty_id FROM documents WHERE id = ? AND organization_id = 1")
          .get(doc.parent_document_id) as { kind: string; status: string; counterparty_id: number | null } | undefined;
        if (!parent || parent.kind !== "customer_order" || parent.status !== "posted") throw new Error("Отгрузка должна быть связана с проведённым заказом покупателя.");
        if (parent.counterparty_id && parent.counterparty_id !== doc.counterparty_id) throw new Error("Клиент отгрузки должен совпадать с заказом.");
        const ordered = db.prepare(`SELECT product_id, SUM(quantity_units) AS quantity FROM document_lines WHERE document_id = ? GROUP BY product_id`)
          .all(doc.parent_document_id) as Array<{ product_id: number; quantity: number }>;
        const previouslyShipped = db.prepare(`SELECT l.product_id, SUM(l.quantity_units) AS quantity FROM documents d
          JOIN document_lines l ON l.document_id = d.id WHERE d.parent_document_id = ? AND d.kind = 'shipment'
            AND d.status = 'posted' GROUP BY l.product_id`).all(doc.parent_document_id) as Array<{ product_id: number; quantity: number }>;
        const orderedByProduct = new Map(ordered.map((line) => [line.product_id, line.quantity]));
        const shippedByProduct = new Map(previouslyShipped.map((line) => [line.product_id, line.quantity]));
        const requestedByProduct = new Map<number, number>();
        for (const line of lines) requestedByProduct.set(line.product_id, (requestedByProduct.get(line.product_id) ?? 0) + line.quantity_units);
        for (const [productId, requested] of requestedByProduct) {
          const remaining = (orderedByProduct.get(productId) ?? 0) - (shippedByProduct.get(productId) ?? 0);
          if (remaining < requested) throw new Error(`В отгрузке превышено количество заказа по позиции ${productId}.`);
        }
      }
      for (const line of lines) {
        if (stockKinds.has(String(doc.kind))) {
          const product = db.prepare("SELECT kind FROM products WHERE id = ?").get(line.product_id) as { kind: string };
          if (product.kind !== "product") continue;
          let quantityDelta = 0;
          let unitCost = Number(line.unit_price_tiyin);
          if (unitCost === 0 && line.cost_tiyin) unitCost = Number(line.cost_tiyin);
          if (doc.kind === "transfer") {
            if (!doc.destination_warehouse_id) throw new Error("Для перемещения выберите склад-получатель.");
            const balance = stockBalance.get(line.product_id, Number(doc.warehouse_id)) as { quantity: number };
            const reserved = reservedBalance.get(line.product_id, Number(doc.warehouse_id)) as { quantity: number };
            if (reserved.quantity > 0 && balance.quantity - line.quantity_units < reserved.quantity) throw new Error(`Перемещение затронет товар, зарезервированный под заказы: ${line.product_id}.`);
            if (String(allowNegative?.value) !== "true" && balance.quantity < line.quantity_units) throw new Error(`Недостаточно товара на складе для перемещения: ${line.product_id}.`);
            unitCost = averageCostTiyin(line.product_id, Number(doc.warehouse_id));
            const value = Math.round(line.quantity_units * unitCost / 1_000_000);
            movements.run(id, line.product_id, Number(doc.warehouse_id), -line.quantity_units, -value);
            movements.run(id, line.product_id, Number(doc.destination_warehouse_id), line.quantity_units, Math.round(line.quantity_units * unitCost / 1_000_000));
            continue;
          }
          if (doc.kind === "receipt" || doc.kind === "customer_return" || doc.kind === "enter" || doc.kind === "retailsalesreturn") quantityDelta = line.quantity_units;
          else if (doc.kind === "shipment" || doc.kind === "supplier_return" || doc.kind === "writeoff" || doc.kind === "work_order" || doc.kind === "retailsale") quantityDelta = -line.quantity_units;
          else if (doc.kind === "stocktake") {
            const balance = stockBalance.get(line.product_id, Number(doc.warehouse_id)) as { quantity: number };
            quantityDelta = line.quantity_units - balance.quantity;
          }
          if (quantityDelta < 0) {
            const balance = stockBalance.get(line.product_id, Number(doc.warehouse_id)) as { quantity: number };
            const reserved = reservedBalance.get(line.product_id, Number(doc.warehouse_id)) as { quantity: number };
            let ownReservation = 0;
            if (doc.kind === "shipment" && doc.parent_document_id) {
              const own = db.prepare(`SELECT COALESCE(SUM(quantity_units),0) AS quantity FROM stock_reservations
                WHERE document_id = ? AND product_id = ? AND warehouse_id = ?`)
                .get(Number(doc.parent_document_id), line.product_id, Number(doc.warehouse_id)) as { quantity: number };
              ownReservation = own.quantity;
              if (ownReservation < -quantityDelta) throw new Error(`Недостаточно зарезервированного количества заказа для позиции ${line.product_id}.`);
            }
            const protectedReservations = Math.max(0, reserved.quantity - ownReservation);
            if (protectedReservations > 0 && balance.quantity + quantityDelta < protectedReservations) {
              throw new Error(`Списание затронет товар, зарезервированный под другие заказы: ${line.product_id}.`);
            }
            if (String(allowNegative?.value) !== "true" && balance.quantity < -quantityDelta) throw new Error(`Недостаточно товара на складе для списания: ${line.product_id}.`);
          }
          if (doc.kind === "customer_return" && quantityDelta > 0) unitCost = averageCostTiyin(line.product_id, Number(doc.warehouse_id));
          if (doc.kind !== "receipt" && doc.kind !== "enter" && quantityDelta < 0) {
            unitCost = averageCostTiyin(line.product_id, Number(doc.warehouse_id));
            if (!unitCost && line.unit_price_tiyin) unitCost = Number(line.unit_price_tiyin);
          }
          if (doc.kind === "enter" && !unitCost) {
            unitCost = averageCostTiyin(line.product_id, Number(doc.warehouse_id));
            if (!unitCost) {
              const p = db.prepare("SELECT purchase_price_tiyin FROM products WHERE id = ?").get(line.product_id) as { purchase_price_tiyin: number } | undefined;
              unitCost = Number(p?.purchase_price_tiyin ?? 0);
            }
          }
          if (doc.kind === "stocktake" && !unitCost) {
            unitCost = averageCostTiyin(line.product_id, Number(doc.warehouse_id));
            if (!unitCost) {
              const p = db.prepare("SELECT purchase_price_tiyin FROM products WHERE id = ?").get(line.product_id) as { purchase_price_tiyin: number } | undefined;
              unitCost = Number(p?.purchase_price_tiyin ?? 0);
            }
          }
          if (quantityDelta) movements.run(id, line.product_id, Number(doc.warehouse_id), quantityDelta,
            Math.sign(quantityDelta) * Math.round(Math.abs(quantityDelta) * unitCost / 1_000_000));
        }
      }
      if (doc.kind === "writeoff") {
        let totalLossTiyin = 0;
        for (const line of lines) {
          const cost = averageCostTiyin(line.product_id, Number(doc.warehouse_id)) || Number(line.unit_price_tiyin || line.cost_tiyin || 0);
          totalLossTiyin += Math.round(line.quantity_units * cost / 1_000_000);
        }
        if (totalLossTiyin > 0 && Number(doc.total_tiyin) === 0) {
          db.prepare("UPDATE documents SET total_tiyin = ? WHERE id = ?").run(totalLossTiyin, id);
        }
      }
      if (doc.kind === "shipment" && doc.parent_document_id) {
        for (const line of lines) {
          const product = db.prepare("SELECT kind FROM products WHERE id = ?").get(line.product_id) as { kind: string };
          if (product.kind !== "product") continue;
          let remaining = line.quantity_units;
          const matching = db.prepare(`SELECT id, quantity_units FROM stock_reservations
            WHERE document_id = ? AND product_id = ? AND warehouse_id = ? ORDER BY id`).all(doc.parent_document_id, line.product_id, doc.warehouse_id) as Array<{ id: number; quantity_units: number }>;
          for (const reservation of matching) {
            if (remaining <= 0) break;
            const used = Math.min(remaining, reservation.quantity_units);
            db.prepare(`INSERT INTO reservation_consumptions (shipment_document_id, order_document_id, product_id, warehouse_id, quantity_units)
              VALUES (?, ?, ?, ?, ?)`).run(id, Number(doc.parent_document_id), line.product_id, Number(doc.warehouse_id), used);
            if (used === reservation.quantity_units) db.prepare("DELETE FROM stock_reservations WHERE id = ?").run(reservation.id);
            else db.prepare("UPDATE stock_reservations SET quantity_units = quantity_units - ? WHERE id = ?").run(used, reservation.id);
            remaining -= used;
          }
          if (remaining > 0) throw new Error(`Не хватает резерва из заказа для позиции ${line.product_id}.`);
        }
      }
      db.prepare("UPDATE documents SET status = 'posted', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
      if (doc.kind === "work_order" && doc.vehicle_id && doc.odometer_km != null) {
        db.prepare("UPDATE vehicles SET current_mileage = MAX(current_mileage, ?) WHERE id = ? AND organization_id = 1")
          .run(Number(doc.odometer_km), Number(doc.vehicle_id));
      }
      recordAudit("document", id, "post", String(doc.number));
      return db.prepare("SELECT * FROM documents WHERE id = ?").get(id);
    })();
    res.json(result);
  } catch (error) { next(error); }
});

app.post("/api/documents/:id/unpost", (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const result = db.transaction(() => {
      const doc = db.prepare("SELECT * FROM documents WHERE id = ? AND organization_id = 1").get(id) as Record<string, unknown> | undefined;
      if (!doc || doc.status !== "posted") throw new Error("Проведённый документ не найден.");
      if (doc.kind === "customer_order" && db.prepare("SELECT 1 FROM documents WHERE parent_document_id = ? AND kind = 'shipment' AND status = 'posted' LIMIT 1").get(id)) {
        throw new Error("Сначала отмените проведение связанных отгрузок.");
      }
      if (doc.kind === "work_order" && db.prepare(`SELECT 1 FROM payment_allocations pa
        JOIN documents payment ON payment.id = pa.payment_document_id
        WHERE pa.target_document_id = ? AND payment.kind = 'incoming_payment' AND payment.status = 'posted' LIMIT 1`).get(id)) {
        throw new Error("Сначала отмените проведение связанных входящих платежей.");
      }
      const consumed = db.prepare(`SELECT order_document_id, product_id, warehouse_id, SUM(quantity_units) AS quantity
        FROM reservation_consumptions WHERE shipment_document_id = ? GROUP BY order_document_id, product_id, warehouse_id`).all(id) as Array<Record<string, number>>;
      for (const row of consumed) addReservation(row.order_document_id, row.product_id, row.warehouse_id, row.quantity);
      db.prepare("DELETE FROM reservation_consumptions WHERE shipment_document_id = ?").run(id);
      db.prepare(`INSERT INTO stock_movements (organization_id, document_id, product_id, warehouse_id, quantity_units, value_tiyin)
        SELECT organization_id, document_id, product_id, warehouse_id, -quantity_units, -value_tiyin
        FROM stock_movements WHERE document_id = ?`).run(id);
      if (doc.kind === "customer_order") db.prepare("DELETE FROM stock_reservations WHERE document_id = ?").run(id);
      db.prepare("UPDATE documents SET status = 'draft', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
      if (doc.kind === "work_order" && doc.vehicle_id) {
        db.prepare(`UPDATE vehicles SET current_mileage = MAX(initial_mileage, COALESCE((
          SELECT MAX(odometer_km) FROM documents WHERE vehicle_id = ? AND kind = 'work_order'
            AND status = 'posted' AND odometer_km IS NOT NULL
        ), 0)) WHERE id = ? AND organization_id = 1`)
          .run(Number(doc.vehicle_id), Number(doc.vehicle_id));
      }
      recordAudit("document", id, "unpost", String(doc.number));
      return db.prepare("SELECT * FROM documents WHERE id = ?").get(id);
    })();
    res.json(result);
  } catch (error) { next(error); }
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = error instanceof Error ? error.message : "Не удалось выполнить операцию.";
  res.status(400).json({ error: message });
});

const port = Number(process.env.API_PORT ?? 4300);
app.listen(port, "127.0.0.1", () => console.log(`API listening at http://127.0.0.1:${port}`));
