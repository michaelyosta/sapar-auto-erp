import type { Express, Request, Response } from "express";
import type { Database } from "better-sqlite3";

export interface SystemFile {
  id: number;
  organization_id: number;
  name: string;
  category: "photo" | "scan" | "contract" | "act" | "pricelist" | "general";
  mime_type: string;
  size_bytes: number;
  entity_type: "product" | "document" | "counterparty" | "general";
  entity_id: number | null;
  entity_title?: string;
  created_at: string;
  active: number;
}

export function initializeFilesSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'general',
      mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
      size_bytes INTEGER NOT NULL DEFAULT 0,
      entity_type TEXT NOT NULL DEFAULT 'general',
      entity_id INTEGER,
      data BLOB,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_files_org ON files(organization_id, active, category);
  `);

  const count = (db.prepare("SELECT COUNT(*) AS c FROM files WHERE organization_id = 1").get() as { c: number }).c;
  if (count === 0) {
    const seedFiles = [
      {
        name: "Типовой договор обслуживания корпоративных клиентов Сапар.pdf",
        category: "contract",
        mime_type: "application/pdf",
        size_bytes: 348160,
        entity_type: "counterparty",
        entity_id: 1,
        content: "SAMPLE_PDF_CONTRACT_DATA"
      },
      {
        name: "Акт приема-передачи автомобиля в ремонт (бланк).docx",
        category: "act",
        mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size_bytes: 124928,
        entity_type: "general",
        entity_id: null,
        content: "SAMPLE_ACT_TEMPLATE_DATA"
      },
      {
        name: "Дефектовка ходовой части Toyota Camry (фото).jpg",
        category: "photo",
        mime_type: "image/jpeg",
        size_bytes: 852100,
        entity_type: "document",
        entity_id: 1,
        content: "SAMPLE_JPG_INSPECTION_PHOTO"
      },
      {
        name: "Официальный прайс-лист на моторные масла 2026.xlsx",
        category: "pricelist",
        mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        size_bytes: 215040,
        entity_type: "general",
        entity_id: null,
        content: "SAMPLE_XLSX_PRICELIST"
      }
    ];

    const insertStmt = db.prepare(`
      INSERT INTO files (organization_id, name, category, mime_type, size_bytes, entity_type, entity_id, data, active)
      VALUES (1, @name, @category, @mime_type, @size_bytes, @entity_type, @entity_id, @data, 1)
    `);

    for (const f of seedFiles) {
      insertStmt.run({
        ...f,
        data: Buffer.from(f.content, "utf-8")
      });
    }
  }
}

export function registerFilesRoutes(
  app: Express,
  db: Database,
  recordAudit: (type: string, id: number, action: string, detail?: string, orgId?: number) => void
): void {
  // List files with search, category filter, and linked entity info
  app.get("/api/files", (req: Request, res: Response) => {
    const orgId = (req as any).auth?.organizationId ?? 1;
    const category = req.query.category as string | undefined;
    const search = req.query.q as string | undefined;

    let query = `
      SELECT f.id, f.organization_id, f.name, f.category, f.mime_type, f.size_bytes,
             f.entity_type, f.entity_id, f.created_at, f.active,
             CASE
               WHEN f.entity_type = 'document' THEN (SELECT number FROM documents WHERE id = f.entity_id)
               WHEN f.entity_type = 'product' THEN (SELECT name FROM products WHERE id = f.entity_id)
               WHEN f.entity_type = 'counterparty' THEN (SELECT name FROM counterparties WHERE id = f.entity_id)
               ELSE 'Общий файл'
             END AS entity_title
      FROM files f
      WHERE f.organization_id = ? AND f.active = 1
    `;
    const params: any[] = [orgId];

    if (category && category !== "all") {
      query += " AND f.category = ?";
      params.push(category);
    }

    if (search) {
      query += " AND (f.name LIKE ? OR f.category LIKE ?)";
      params.push(`%${search}%`, `%${search}%`);
    }

    query += " ORDER BY f.created_at DESC, f.id DESC";

    const rows = db.prepare(query).all(...params);

    const quotaStats = db.prepare(`
      SELECT COUNT(*) AS fileCount, COALESCE(SUM(size_bytes), 0) AS totalBytesUsed
      FROM files
      WHERE organization_id = ? AND active = 1
    `).get(orgId) as { fileCount: number; totalBytesUsed: number };

    res.json({
      files: rows,
      quota: {
        fileCount: quotaStats.fileCount,
        totalBytesUsed: quotaStats.totalBytesUsed,
        totalBytesLimit: 10 * 1024 * 1024 * 1024, // 10 GB limit
        percentUsed: Math.min(100, Number(((quotaStats.totalBytesUsed / (10 * 1024 * 1024 * 1024)) * 100).toFixed(2)))
      }
    });
  });

  // Upload file
  app.post("/api/files", (req: Request, res: Response) => {
    const orgId = (req as any).auth?.organizationId ?? 1;
    const { name, category = "general", mimeType = "application/octet-stream", base64Data, entityType = "general", entityId } = req.body;

    if (!name) {
      return res.status(400).json({ error: "Укажите имя файла." });
    }

    const buffer = base64Data ? Buffer.from(base64Data, "base64") : Buffer.from("EMPTY_FILE", "utf-8");
    const sizeBytes = buffer.length;

    const result = db.prepare(`
      INSERT INTO files (organization_id, name, category, mime_type, size_bytes, entity_type, entity_id, data, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      orgId,
      name,
      category,
      mimeType,
      sizeBytes,
      entityType,
      entityId ? Number(entityId) : null,
      buffer
    );

    const insertedId = Number(result.lastInsertRowid);
    recordAudit("file", insertedId, "upload", name, orgId);

    const created = db.prepare(`
      SELECT id, organization_id, name, category, mime_type, size_bytes, entity_type, entity_id, created_at, active
      FROM files WHERE id = ?
    `).get(insertedId);

    res.status(201).json(created);
  });

  // Download or preview file
  app.get("/api/files/:id/download", (req: Request, res: Response) => {
    const orgId = (req as any).auth?.organizationId ?? 1;
    const id = Number(req.params.id);
    const row = db.prepare("SELECT * FROM files WHERE id = ? AND organization_id = ? AND active = 1").get(id, orgId) as any;

    if (!row) {
      return res.status(404).send("Файл не найден");
    }

    res.setHeader("Content-Type", row.mime_type || "application/octet-stream");
    const encodedName = encodeURIComponent(row.name);
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodedName}`);
    res.send(row.data || Buffer.from(""));
  });

  // Soft delete file
  app.delete("/api/files/:id", (req: Request, res: Response) => {
    const orgId = (req as any).auth?.organizationId ?? 1;
    const id = Number(req.params.id);
    const row = db.prepare("SELECT name FROM files WHERE id = ? AND organization_id = ?").get(id, orgId) as { name: string } | undefined;

    if (!row) {
      return res.status(404).json({ error: "Файл не найден" });
    }

    db.prepare("UPDATE files SET active = 0 WHERE id = ? AND organization_id = ?").run(id, orgId);
    recordAudit("file", id, "delete", row.name, orgId);
    res.json({ ok: true });
  });
}
