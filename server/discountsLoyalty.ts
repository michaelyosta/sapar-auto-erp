import type Database from "better-sqlite3";
import type { Express, Request, Response } from "express";

type SqliteDb = Database.Database;

export function initializeDiscountsLoyaltySchema(db: SqliteDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS discounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'fixed_percent',
      discount_percent REAL NOT NULL DEFAULT 0,
      min_spent_tiyin INTEGER NOT NULL DEFAULT 0,
      bonus_earn_percent REAL NOT NULL DEFAULT 5.0,
      max_redemption_percent REAL NOT NULL DEFAULT 50.0,
      promo_code TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS loyalty_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      counterparty_id INTEGER NOT NULL UNIQUE REFERENCES counterparties(id),
      card_number TEXT UNIQUE,
      points_balance INTEGER NOT NULL DEFAULT 0,
      total_spent_tiyin INTEGER NOT NULL DEFAULT 0,
      tier_name TEXT DEFAULT 'Базовый (5%)',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS loyalty_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      loyalty_account_id INTEGER NOT NULL REFERENCES loyalty_accounts(id) ON DELETE CASCADE,
      document_id INTEGER REFERENCES documents(id),
      amount_points INTEGER NOT NULL,
      kind TEXT NOT NULL,
      comment TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Seed default discounts if empty
  const count = (db.prepare("SELECT COUNT(*) AS c FROM discounts WHERE organization_id = 1").get() as { c: number }).c;
  if (count === 0) {
    db.prepare(`
      INSERT INTO discounts (organization_id, name, kind, discount_percent, min_spent_tiyin, bonus_earn_percent)
      VALUES
        (1, 'Автоклуб / Партнерская (7%)', 'fixed_percent', 7.0, 0, 0),
        (1, 'Накопительная VIP (10%)', 'cumulative', 10.0, 50000000, 0),
        (1, 'Бонусная программа кэшбека (5%)', 'bonus_points', 0, 0, 5.0)
    `).run();
  }
}

export function registerDiscountsLoyaltyRoutes(
  app: Express,
  db: SqliteDb,
  recordAudit: (entityType: string, entityId: number, action: string, detail?: string, orgId?: number) => void
): void {
  // 1. List discounts
  app.get("/api/discounts", (req: Request, res: Response) => {
    const orgId = req.auth?.organizationId ?? 1;
    const discounts = db.prepare("SELECT * FROM discounts WHERE organization_id = ? ORDER BY id ASC").all(orgId);
    res.json(discounts);
  });

  // 2. Create discount
  app.post("/api/discounts", (req: Request, res: Response) => {
    const orgId = req.auth?.organizationId ?? 1;
    const { name, kind, discount_percent, min_spent_tiyin, bonus_earn_percent, max_redemption_percent, promo_code } = req.body;
    if (!name || !String(name).trim()) return res.status(400).json({ error: "Укажите название скидки" });

    const result = db.prepare(`
      INSERT INTO discounts (organization_id, name, kind, discount_percent, min_spent_tiyin, bonus_earn_percent, max_redemption_percent, promo_code)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      orgId,
      String(name).trim(),
      String(kind || "fixed_percent"),
      Number(discount_percent || 0),
      Number(min_spent_tiyin || 0),
      Number(bonus_earn_percent || 0),
      Number(max_redemption_percent || 50),
      promo_code ? String(promo_code).trim() : null
    );

    recordAudit("discount", Number(result.lastInsertRowid), "create", `Создана скидка: ${name}`, orgId);
    res.json({ id: result.lastInsertRowid, ok: true });
  });

  // 3. Toggle/edit discount
  app.patch("/api/discounts/:id", (req: Request, res: Response) => {
    const orgId = req.auth?.organizationId ?? 1;
    const id = Number(req.params.id);
    const { active, discount_percent, name } = req.body;

    db.prepare(`
      UPDATE discounts
      SET active = COALESCE(?, active),
          discount_percent = COALESCE(?, discount_percent),
          name = COALESCE(?, name)
      WHERE id = ? AND organization_id = ?
    `).run(
      active !== undefined ? (active ? 1 : 0) : null,
      discount_percent !== undefined ? Number(discount_percent) : null,
      name !== undefined ? String(name).trim() : null,
      id,
      orgId
    );

    recordAudit("discount", id, "update", `Обновлена скидка #${id}`, orgId);
    res.json({ ok: true });
  });

  // 4. List loyalty accounts
  app.get("/api/loyalty/accounts", (req: Request, res: Response) => {
    const orgId = req.auth?.organizationId ?? 1;
    const accounts = db.prepare(`
      SELECT la.*, c.name AS counterparty_name, c.phone AS counterparty_phone
      FROM loyalty_accounts la
      JOIN counterparties c ON c.id = la.counterparty_id
      WHERE la.organization_id = ?
      ORDER BY la.points_balance DESC, la.id DESC
    `).all(orgId);
    res.json(accounts);
  });

  // 5. Get loyalty account for counterparty (or auto-create)
  app.get("/api/loyalty/account/:counterpartyId", (req: Request, res: Response) => {
    const orgId = req.auth?.organizationId ?? 1;
    const cpId = Number(req.params.counterpartyId);

    let account = db.prepare(`
      SELECT la.*, c.name AS counterparty_name, c.phone AS counterparty_phone
      FROM loyalty_accounts la
      JOIN counterparties c ON c.id = la.counterparty_id
      WHERE la.counterparty_id = ? AND la.organization_id = ?
    `).get(cpId, orgId) as Record<string, unknown> | undefined;

    if (!account) {
      // Auto-issue loyalty card
      const cardNum = "7700-" + String(1000 + cpId) + "-" + String(Math.floor(Math.random() * 9000) + 1000);
      const resInsert = db.prepare(`
        INSERT INTO loyalty_accounts (organization_id, counterparty_id, card_number, points_balance, total_spent_tiyin)
        VALUES (?, ?, ?, 0, 0)
      `).run(orgId, cpId, cardNum);

      account = db.prepare(`
        SELECT la.*, c.name AS counterparty_name, c.phone AS counterparty_phone
        FROM loyalty_accounts la
        JOIN counterparties c ON c.id = la.counterparty_id
        WHERE la.id = ?
      `).get(resInsert.lastInsertRowid) as Record<string, unknown>;
    }

    const history = db.prepare(`
      SELECT lt.*, d.number AS document_number
      FROM loyalty_transactions lt
      LEFT JOIN documents d ON d.id = lt.document_id
      WHERE lt.loyalty_account_id = ?
      ORDER BY lt.created_at DESC, lt.id DESC
      LIMIT 30
    `).all(account.id);

    res.json({ ...account, history });
  });

  // 6. Manual bonus point transaction
  app.post("/api/loyalty/transactions", (req: Request, res: Response) => {
    const orgId = req.auth?.organizationId ?? 1;
    const { loyalty_account_id, amount_points, comment } = req.body;
    const accountId = Number(loyalty_account_id);
    const amount = Number(amount_points);

    if (!accountId || isNaN(amount) || amount === 0) {
      return res.status(400).json({ error: "Укажите корректный счет и количество баллов" });
    }

    const account = db.prepare("SELECT * FROM loyalty_accounts WHERE id = ? AND organization_id = ?").get(accountId, orgId) as Record<string, unknown> | undefined;
    if (!account) return res.status(404).json({ error: "Счет лояльности не найден" });

    const currentBalance = Number(account.points_balance);
    if (amount < 0 && currentBalance + amount < 0) {
      return res.status(400).json({ error: `Недостаточно баллов для списания (текущий баланс: ${currentBalance} баллов)` });
    }

    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO loyalty_transactions (loyalty_account_id, amount_points, kind, comment)
        VALUES (?, ?, ?, ?)
      `).run(
        accountId,
        amount,
        amount > 0 ? "manual_accrual" : "manual_redemption",
        String(comment ?? "Корректировка баллов администратором")
      );

      db.prepare(`
        UPDATE loyalty_accounts
        SET points_balance = points_balance + ?
        WHERE id = ?
      `).run(amount, accountId);
    });

    tx();
    recordAudit("loyalty", accountId, "points_adjust", `Начислено/списано ${amount} баллов`, orgId);
    res.json({ ok: true, new_balance: currentBalance + amount });
  });
}
