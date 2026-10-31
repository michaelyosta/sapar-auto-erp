import type { Express, Request, Response } from "express";
import type { Database } from "better-sqlite3";

export interface AutomationRule {
  id: number;
  organization_id: number;
  name: string;
  description: string;
  active: number;
  trigger_type: string;
  conditions_json: string;
  action_type: string;
  action_payload_json: string;
  run_count: number;
  last_run_at: string | null;
  created_at: string;
}

export interface AutomationLog {
  id: number;
  organization_id: number;
  rule_id: number | null;
  rule_name: string;
  trigger_event: string;
  entity_id: number | null;
  entity_number: string | null;
  status: "success" | "failed" | "skipped";
  action_summary: string;
  details: string;
  created_at: string;
}

export function initializeAutomationSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS automation_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      trigger_type TEXT NOT NULL,
      conditions_json TEXT NOT NULL DEFAULT '{}',
      action_type TEXT NOT NULL,
      action_payload_json TEXT NOT NULL DEFAULT '{}',
      run_count INTEGER NOT NULL DEFAULT 0,
      last_run_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS automation_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      rule_id INTEGER REFERENCES automation_rules(id) ON DELETE SET NULL,
      rule_name TEXT NOT NULL,
      trigger_event TEXT NOT NULL,
      entity_id INTEGER,
      entity_number TEXT,
      status TEXT NOT NULL DEFAULT 'success',
      action_summary TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_automation_rules_org ON automation_rules(organization_id, active);
    CREATE INDEX IF NOT EXISTS idx_automation_logs_org ON automation_logs(organization_id, created_at DESC);
  `);

  // Seed default automotive workshop rules if table is empty
  const count = (db.prepare("SELECT COUNT(*) AS c FROM automation_rules WHERE organization_id = 1").get() as { c: number }).c;
  if (count === 0) {
    const seedRules = [
      {
        name: "SMS-оповещение клиенту: Автомобиль готов к выдаче",
        description: "Отправка SMS сообщения владельцу при переводе заказ-наряда в статус «Готов»",
        trigger_type: "doc_status_change",
        conditions_json: JSON.stringify({ docKind: "work_order", statusName: "Готов" }),
        action_type: "send_sms",
        action_payload_json: JSON.stringify({
          recipientField: "counterparty_phone",
          template: "Здравствуйте! Заказ-наряд {doc_number} на авто {vehicle_plate} выполнен. Сумма: {total_amount} ₸. Ждем вас в ТОО «Сапар»!"
        })
      },
      {
        name: "Уведомление отдела снабжения о дефиците товара",
        description: "Автоматическое создание заявки поставщику при остатке ниже минимального",
        trigger_type: "low_stock",
        conditions_json: JSON.stringify({ threshold: "min_stock_units" }),
        action_type: "notify_procurement",
        action_payload_json: JSON.stringify({
          recipientRole: "procurement",
          template: "Внимание: Запас товара {product_name} ({product_code}) снизился до {available_qty} {unit}. Требуется заказ!"
        })
      },
      {
        name: "Напоминание о сервисном интервале (замена масла)",
        description: "SMS напоминание автовладельцу при приближении расчетного пробега следующего ТО",
        trigger_type: "doc_status_change",
        conditions_json: JSON.stringify({ docKind: "work_order", statusName: "Закрыт" }),
        action_type: "send_sms",
        action_payload_json: JSON.stringify({
          recipientField: "counterparty_phone",
          template: "Спасибо за визит в ТОО «Сапар»! Рекомендуемый следующий заезд на ТО при пробеге {next_service_km} км. Тел: +7 701 111 22 33."
        })
      },
      {
        name: "Контроль качества: SMS опрос через 2 дня после ремонта",
        description: "Отправка ссылки на оценку качества обслуживания клиенту после закрытия заказ-наряда",
        trigger_type: "doc_status_change",
        conditions_json: JSON.stringify({ docKind: "work_order", statusName: "Закрыт" }),
        action_type: "send_sms",
        action_payload_json: JSON.stringify({
          recipientField: "counterparty_phone",
          template: "Оцените качество ремонта {vehicle_plate} в Сапар от 1 до 5: отправьте ответную цифру или звоните мастеру."
        })
      }
    ];

    const insertStmt = db.prepare(`
      INSERT INTO automation_rules (organization_id, name, description, active, trigger_type, conditions_json, action_type, action_payload_json)
      VALUES (1, @name, @description, 1, @trigger_type, @conditions_json, @action_type, @action_payload_json)
    `);

    for (const rule of seedRules) {
      insertStmt.run(rule);
    }
  }
}

export function executeAutomationRules(
  db: Database,
  event: {
    orgId: number;
    triggerType: string;
    docId?: number;
    productId?: number;
    meta?: Record<string, any>;
  }
): AutomationLog[] {
  const { orgId, triggerType, docId, productId, meta = {} } = event;
  const logs: AutomationLog[] = [];

  const rules = db.prepare(`
    SELECT * FROM automation_rules
    WHERE organization_id = ? AND active = 1 AND trigger_type = ?
  `).all(orgId, triggerType) as AutomationRule[];

  for (const rule of rules) {
    try {
      const conditions = JSON.parse(rule.conditions_json || "{}");
      const payload = JSON.parse(rule.action_payload_json || "{}");

      let docData: any = null;
      if (docId) {
        docData = db.prepare(`
          SELECT d.*, c.name AS counterparty_name, c.phone AS counterparty_phone,
                 v.plate AS vehicle_plate, v.make AS vehicle_make, v.model AS vehicle_model
          FROM documents d
          LEFT JOIN counterparties c ON c.id = d.counterparty_id
          LEFT JOIN vehicles v ON v.id = d.vehicle_id
          WHERE d.id = ? AND d.organization_id = ?
        `).get(docId, orgId);
      }

      // Check conditions
      let matches = true;
      if (conditions.docKind && docData && docData.kind !== conditions.docKind) {
        matches = false;
      }
      if (conditions.statusName && docData && (docData.status_name !== conditions.statusName && docData.status !== conditions.statusName)) {
        matches = false;
      }

      if (!matches) {
        continue;
      }

      // Format template message
      let renderedText = payload.template || "";
      if (docData) {
        renderedText = renderedText
          .replace(/{doc_number}/g, docData.number || "")
          .replace(/{total_amount}/g, Math.round((docData.total_tiyin || 0) / 100).toLocaleString("ru-RU"))
          .replace(/{vehicle_plate}/g, docData.vehicle_plate || "Автомобиль")
          .replace(/{next_service_km}/g, docData.next_service_km ? Number(docData.next_service_km).toLocaleString("ru-RU") : "следующего интервала")
          .replace(/{counterparty_name}/g, docData.counterparty_name || "");
      }
      if (productId) {
        const prod = db.prepare("SELECT name, code, unit FROM products WHERE id = ?").get(productId) as any;
        if (prod) {
          renderedText = renderedText
            .replace(/{product_name}/g, prod.name)
            .replace(/{product_code}/g, prod.code)
            .replace(/{unit}/g, prod.unit);
        }
      }
      if (meta.availableQty !== undefined) {
        renderedText = renderedText.replace(/{available_qty}/g, String(meta.availableQty));
      }

      const summary = rule.action_type === "send_sms"
        ? `SMS отправлено: ${docData?.counterparty_phone || "номер не указан"}`
        : rule.action_type === "notify_procurement"
        ? `Оповещение снабжения: ${rule.name}`
        : `Действие выполнено: ${rule.action_type}`;

      const logResult = db.prepare(`
        INSERT INTO automation_logs (organization_id, rule_id, rule_name, trigger_event, entity_id, entity_number, status, action_summary, details)
        VALUES (?, ?, ?, ?, ?, ?, 'success', ?, ?)
      `).run(
        orgId,
        rule.id,
        rule.name,
        triggerType,
        docId || productId || null,
        docData?.number || meta.code || null,
        summary,
        renderedText
      );

      db.prepare(`
        UPDATE automation_rules
        SET run_count = run_count + 1, last_run_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(rule.id);

      const insertedLog = db.prepare("SELECT * FROM automation_logs WHERE id = ?").get(logResult.lastInsertRowid) as AutomationLog;
      logs.push(insertedLog);
    } catch (err: any) {
      db.prepare(`
        INSERT INTO automation_logs (organization_id, rule_id, rule_name, trigger_event, entity_id, entity_number, status, action_summary, details)
        VALUES (?, ?, ?, ?, ?, ?, 'failed', 'Ошибка сценария', ?)
      `).run(
        orgId,
        rule.id,
        rule.name,
        triggerType,
        docId || productId || null,
        null,
        err.message || String(err)
      );
    }
  }

  return logs;
}

export function registerAutomationRoutes(
  app: Express,
  db: Database,
  recordAudit: (type: string, id: number, action: string, detail?: string, orgId?: number) => void
): void {
  // List rules
  app.get("/api/automation/rules", (req: Request, res: Response) => {
    const orgId = (req as any).auth?.organizationId ?? 1;
    const rules = db.prepare(`
      SELECT * FROM automation_rules
      WHERE organization_id = ?
      ORDER BY id ASC
    `).all(orgId);
    res.json(rules);
  });

  // Create rule
  app.post("/api/automation/rules", (req: Request, res: Response) => {
    const orgId = (req as any).auth?.organizationId ?? 1;
    const { name, description = "", trigger_type, conditions = {}, action_type, action_payload = {} } = req.body;

    if (!name || !trigger_type || !action_type) {
      return res.status(400).json({ error: "Укажите название сценария, тип триггера и действие." });
    }

    const result = db.prepare(`
      INSERT INTO automation_rules (organization_id, name, description, active, trigger_type, conditions_json, action_type, action_payload_json)
      VALUES (?, ?, ?, 1, ?, ?, ?, ?)
    `).run(
      orgId,
      name,
      description,
      trigger_type,
      JSON.stringify(conditions),
      action_type,
      JSON.stringify(action_payload)
    );

    recordAudit("automation_rule", Number(result.lastInsertRowid), "create", name, orgId);
    const created = db.prepare("SELECT * FROM automation_rules WHERE id = ?").get(result.lastInsertRowid);
    res.status(201).json(created);
  });

  // Update rule
  app.patch("/api/automation/rules/:id", (req: Request, res: Response) => {
    const orgId = (req as any).auth?.organizationId ?? 1;
    const id = Number(req.params.id);
    const existing = db.prepare("SELECT * FROM automation_rules WHERE id = ? AND organization_id = ?").get(id, orgId) as AutomationRule | undefined;
    if (!existing) {
      return res.status(404).json({ error: "Сценарий не найден" });
    }

    const { name, description, active, trigger_type, conditions, action_type, action_payload } = req.body;

    db.prepare(`
      UPDATE automation_rules
      SET name = COALESCE(?, name),
          description = COALESCE(?, description),
          active = COALESCE(?, active),
          trigger_type = COALESCE(?, trigger_type),
          conditions_json = COALESCE(?, conditions_json),
          action_type = COALESCE(?, action_type),
          action_payload_json = COALESCE(?, action_payload_json)
      WHERE id = ? AND organization_id = ?
    `).run(
      name,
      description,
      active !== undefined ? (active ? 1 : 0) : null,
      trigger_type,
      conditions ? JSON.stringify(conditions) : null,
      action_type,
      action_payload ? JSON.stringify(action_payload) : null,
      id,
      orgId
    );

    recordAudit("automation_rule", id, "update", name || existing.name, orgId);
    const updated = db.prepare("SELECT * FROM automation_rules WHERE id = ?").get(id);
    res.json(updated);
  });

  // Delete rule
  app.delete("/api/automation/rules/:id", (req: Request, res: Response) => {
    const orgId = (req as any).auth?.organizationId ?? 1;
    const id = Number(req.params.id);
    const existing = db.prepare("SELECT * FROM automation_rules WHERE id = ? AND organization_id = ?").get(id, orgId) as AutomationRule | undefined;
    if (!existing) {
      return res.status(404).json({ error: "Сценарий не найден" });
    }

    db.prepare("DELETE FROM automation_rules WHERE id = ? AND organization_id = ?").run(id, orgId);
    recordAudit("automation_rule", id, "delete", existing.name, orgId);
    res.json({ ok: true });
  });

  // Get execution logs
  app.get("/api/automation/logs", (req: Request, res: Response) => {
    const orgId = (req as any).auth?.organizationId ?? 1;
    const ruleId = req.query.ruleId ? Number(req.query.ruleId) : null;
    let query = "SELECT * FROM automation_logs WHERE organization_id = ?";
    const params: any[] = [orgId];

    if (ruleId) {
      query += " AND rule_id = ?";
      params.push(ruleId);
    }
    query += " ORDER BY id DESC LIMIT 100";

    const logs = db.prepare(query).all(...params);
    res.json(logs);
  });

  // Test / Manually run a rule
  app.post("/api/automation/rules/:id/run", (req: Request, res: Response) => {
    const orgId = (req as any).auth?.organizationId ?? 1;
    const id = Number(req.params.id);
    const rule = db.prepare("SELECT * FROM automation_rules WHERE id = ? AND organization_id = ?").get(id, orgId) as AutomationRule | undefined;
    if (!rule) {
      return res.status(404).json({ error: "Сценарий не найден" });
    }

    // Find a sample document or product to test with
    let sampleDocId = req.body.documentId ? Number(req.body.documentId) : null;
    if (!sampleDocId) {
      const latestDoc = db.prepare("SELECT id FROM documents WHERE organization_id = ? ORDER BY id DESC LIMIT 1").get(orgId) as { id: number } | undefined;
      sampleDocId = latestDoc?.id || null;
    }

    const executedLogs = executeAutomationRules(db, {
      orgId,
      triggerType: rule.trigger_type,
      docId: sampleDocId || undefined,
      meta: { forced: true }
    });

    res.json({ ok: true, executedCount: executedLogs.length, logs: executedLogs });
  });
}
