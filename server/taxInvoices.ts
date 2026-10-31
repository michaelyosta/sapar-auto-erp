import type Database from "better-sqlite3";
import type { Express, Request, Response } from "express";

type SqliteDb = Database.Database;

export function initializeTaxInvoicesSchema(db: SqliteDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tax_invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      direction TEXT NOT NULL DEFAULT 'issued',
      number TEXT NOT NULL,
      date TEXT NOT NULL,
      turnover_date TEXT NOT NULL,
      counterparty_id INTEGER NOT NULL REFERENCES counterparties(id),
      document_id INTEGER REFERENCES documents(id),
      contract_id INTEGER REFERENCES contracts(id),
      esf_registration_number TEXT,
      esf_status TEXT NOT NULL DEFAULT 'draft',
      total_without_vat_tiyin INTEGER NOT NULL DEFAULT 0,
      vat_tiyin INTEGER NOT NULL DEFAULT 0,
      total_tiyin INTEGER NOT NULL DEFAULT 0,
      comment TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_tax_invoices_org ON tax_invoices(organization_id, direction);
  `);
}

export function registerTaxInvoicesRoutes(
  app: Express,
  db: SqliteDb,
  recordAudit: (entityType: string, entityId: number, action: string, detail?: string, orgId?: number) => void
): void {
  // 1. List tax invoices
  app.get("/api/tax-invoices", (req: Request, res: Response) => {
    const orgId = req.auth?.organizationId ?? 1;
    const direction = String(req.query.direction ?? "issued");
    const status = String(req.query.status ?? "all");

    let query = `
      SELECT ti.*, c.name AS counterparty_name, c.bin AS counterparty_bin,
        d.number AS source_doc_number, d.kind AS source_doc_kind
      FROM tax_invoices ti
      LEFT JOIN counterparties c ON c.id = ti.counterparty_id
      LEFT JOIN documents d ON d.id = ti.document_id
      WHERE ti.organization_id = ? AND ti.direction = ?
    `;
    const params: unknown[] = [orgId, direction];

    if (status !== "all") {
      query += " AND ti.esf_status = ?";
      params.push(status);
    }
    query += " ORDER BY ti.date DESC, ti.id DESC";

    const rows = db.prepare(query).all(...params);
    res.json(rows);
  });

  // 2. Create tax invoice directly or from document
  app.post("/api/tax-invoices/from-document/:documentId", (req: Request, res: Response) => {
    const orgId = req.auth?.organizationId ?? 1;
    const docId = Number(req.params.documentId);

    const doc = db.prepare("SELECT * FROM documents WHERE id = ? AND organization_id = ?").get(docId, orgId) as Record<string, unknown> | undefined;
    if (!doc) return res.status(404).json({ error: "Документ не найден" });

    const total = Number(doc.total_tiyin);
    // Standard KZ VAT is 12%
    const totalWithoutVat = Math.round(total / 1.12);
    const vat = total - totalWithoutVat;

    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty" }).format(new Date());
    const esfNum = "ЭСФ-" + String(Math.floor(Math.random() * 900000) + 100000);

    const result = db.prepare(`
      INSERT INTO tax_invoices (
        organization_id, direction, number, date, turnover_date,
        counterparty_id, document_id, contract_id, esf_status,
        total_without_vat_tiyin, vat_tiyin, total_tiyin, comment
      ) VALUES (?, 'issued', ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)
    `).run(
      orgId,
      esfNum,
      today,
      doc.date || today,
      doc.counterparty_id,
      doc.id,
      doc.contract_id || null,
      totalWithoutVat,
      vat,
      total,
      `Выписан на основании ${doc.number}`
    );

    const newId = Number(result.lastInsertRowid);
    recordAudit("tax_invoice", newId, "create", `Сформирована ЭСФ ${esfNum} к документу ${doc.number}`, orgId);
    res.json({ id: newId, number: esfNum, ok: true });
  });

  // 3. Register / Send to IS ESF
  app.post("/api/tax-invoices/:id/send-esf", (req: Request, res: Response) => {
    const orgId = req.auth?.organizationId ?? 1;
    const id = Number(req.params.id);

    const invoice = db.prepare("SELECT * FROM tax_invoices WHERE id = ? AND organization_id = ?").get(id, orgId) as Record<string, unknown> | undefined;
    if (!invoice) return res.status(404).json({ error: "Счет-фактура не найден" });

    const regNum = `ESF-KZ-${Date.now().toString().slice(-8)}-${Math.floor(Math.random() * 900) + 100}`;

    db.prepare(`
      UPDATE tax_invoices
      SET esf_status = 'registered', esf_registration_number = ?
      WHERE id = ?
    `).run(regNum, id);

    recordAudit("tax_invoice", id, "register_esf", `Зарегистрирована в ИС ЭСФ с номером ${regNum}`, orgId);
    res.json({ ok: true, registration_number: regNum });
  });

  // 4. Delete tax invoice
  app.delete("/api/tax-invoices/:id", (req: Request, res: Response) => {
    const orgId = req.auth?.organizationId ?? 1;
    const id = Number(req.params.id);

    db.prepare("DELETE FROM tax_invoices WHERE id = ? AND organization_id = ?").run(id, orgId);
    recordAudit("tax_invoice", id, "delete", `Удален счет-фактура #${id}`, orgId);
    res.json({ ok: true });
  });
}
