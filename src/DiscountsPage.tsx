import { useEffect, useState, useCallback } from "react";
import {
  Percent,
  Award,
  CreditCard,
  Plus,
  RefreshCw,
  Search,
  X,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";

interface DiscountProgram {
  id: number;
  name: string;
  kind: "fixed_percent" | "cumulative" | "bonus_points" | "promo_code";
  discount_percent: number;
  min_spent_tiyin: number;
  bonus_earn_percent: number;
  max_redemption_percent: number;
  promo_code?: string;
  active: number;
}

interface LoyaltyAccount {
  id: number;
  counterparty_id: number;
  counterparty_name: string;
  counterparty_phone: string;
  card_number: string;
  points_balance: number;
  total_spent_tiyin: number;
  tier_name: string;
}

interface LoyaltyHistoryItem {
  id: number;
  amount_points: number;
  kind: string;
  comment?: string;
  created_at: string;
  document_number?: string;
}

function fmtMoney(tiyins: number): string {
  const kzt = tiyins / 100;
  return kzt.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₸";
}

export default function DiscountsPage({
  initialTab = "discounts",
  onNotify,
}: {
  initialTab?: "discounts" | "loyalty";
  onNotify?: (msg: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<"discounts" | "loyalty">(initialTab);
  const [discounts, setDiscounts] = useState<DiscountProgram[]>([]);
  const [accounts, setAccounts] = useState<LoyaltyAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  // New discount modal
  const [newDiscOpen, setNewDiscOpen] = useState(false);
  const [discName, setDiscName] = useState("");
  const [discKind, setDiscKind] = useState<"fixed_percent" | "cumulative" | "bonus_points">("fixed_percent");
  const [discPercent, setDiscPercent] = useState(5);
  const [discBonusEarn, setDiscBonusEarn] = useState(5);
  const [discMinSpent, setDiscMinSpent] = useState(0);

  // Points adjust modal
  const [adjustAccount, setAdjustAccount] = useState<LoyaltyAccount | null>(null);
  const [adjustAmount, setAdjustAmount] = useState<number>(500);
  const [adjustComment, setAdjustComment] = useState("");
  const [accountHistory, setAccountHistory] = useState<LoyaltyHistoryItem[]>([]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      if (activeTab === "discounts") {
        const res = await fetch("/api/discounts");
        if (res.ok) setDiscounts(await res.json());
      } else {
        const res = await fetch("/api/loyalty/accounts");
        if (res.ok) setAccounts(await res.json());
      }
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const toggleDiscountActive = async (id: number, currentActive: number) => {
    try {
      const res = await fetch(`/api/discounts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: currentActive ? 0 : 1 }),
      });
      if (res.ok) {
        if (onNotify) onNotify("Статус скидки изменен");
        await loadData();
      }
    } catch {
      // silent
    }
  };

  const handleCreateDiscount = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/discounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: discName,
          kind: discKind,
          discount_percent: discPercent,
          bonus_earn_percent: discBonusEarn,
          min_spent_tiyin: Math.round(discMinSpent * 100),
        }),
      });
      if (!res.ok) throw new Error("Ошибка создания скидки");
      if (onNotify) onNotify(`Скидка «${discName}» создана!`);
      setNewDiscOpen(false);
      setDiscName("");
      await loadData();
    } catch (err) {
      if (onNotify) onNotify(err instanceof Error ? err.message : "Ошибка");
    }
  };

  const openAdjustModal = async (acc: LoyaltyAccount) => {
    setAdjustAccount(acc);
    setAdjustAmount(500);
    setAdjustComment("Бонусное поощрение клиента");
    try {
      const res = await fetch(`/api/loyalty/account/${acc.counterparty_id}`);
      if (res.ok) {
        const data = await res.json();
        setAccountHistory(data.history ?? []);
      }
    } catch {
      setAccountHistory([]);
    }
  };

  const handleAdjustPoints = async (isDeduct = false) => {
    if (!adjustAccount) return;
    const finalAmount = isDeduct ? -Math.abs(adjustAmount) : Math.abs(adjustAmount);
    try {
      const res = await fetch("/api/loyalty/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          loyalty_account_id: adjustAccount.id,
          amount_points: finalAmount,
          comment: adjustComment,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Ошибка операции с баллами");
      if (onNotify) onNotify(`Баланс карты ${adjustAccount.card_number} обновлен (${finalAmount > 0 ? "+" : ""}${finalAmount} баллов)!`);
      setAdjustAccount(null);
      await loadData();
    } catch (err) {
      if (onNotify) onNotify(err instanceof Error ? err.message : "Ошибка");
    }
  };

  const filteredAccounts = accounts.filter((a) => {
    if (!search.trim()) return true;
    const t = search.toLowerCase();
    return (
      a.counterparty_name?.toLowerCase().includes(t) ||
      a.counterparty_phone?.toLowerCase().includes(t) ||
      a.card_number?.toLowerCase().includes(t)
    );
  });

  return (
    <div className="discounts-page" style={{ padding: "16px 24px", maxWidth: 1400, margin: "0 auto" }}>
      {/* Top Bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, color: "#222", margin: "0 0 6px", display: "flex", alignItems: "center", gap: 8 }}>
            <Award size={24} color="#186999" />
            Скидки и Программы лояльности
          </h1>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => setActiveTab("discounts")}
              className={`button ${activeTab === "discounts" ? "primary" : "outline"}`}
              style={{ padding: "6px 14px", fontSize: 13 }}
            >
              <Percent size={14} style={{ marginRight: 6 }} />
              Программы скидок
            </button>
            <button
              onClick={() => setActiveTab("loyalty")}
              className={`button ${activeTab === "loyalty" ? "primary" : "outline"}`}
              style={{ padding: "6px 14px", fontSize: 13 }}
            >
              <CreditCard size={14} style={{ marginRight: 6 }} />
              Карты лояльности клиентов
            </button>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          {activeTab === "discounts" && (
            <button
              onClick={() => setNewDiscOpen(true)}
              className="button action-blue"
              style={{ padding: "6px 14px", fontSize: 13 }}
            >
              <Plus size={15} style={{ marginRight: 6 }} />
              + Новая скидка
            </button>
          )}
          <button
            onClick={() => void loadData()}
            disabled={loading}
            className="button outline"
            style={{ padding: "6px 12px", fontSize: 13 }}
          >
            <RefreshCw size={14} className={loading ? "spin" : ""} />
          </button>
        </div>
      </div>

      {/* ---------------- 1. DISCOUNTS TAB ---------------- */}
      {activeTab === "discounts" && (
        <div style={{ background: "#fff", border: "1px solid #d9d9d9", borderRadius: 6, overflow: "hidden" }}>
          <table className="enterprise-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#fafafa", borderBottom: "1px solid #e8e8e8", textAlign: "left" }}>
                <th style={{ padding: "8px 12px" }}>Название программы</th>
                <th style={{ padding: "8px 12px" }}>Тип скидки</th>
                <th style={{ padding: "8px 12px", textAlign: "center" }}>Размер скидки</th>
                <th style={{ padding: "8px 12px", textAlign: "center" }}>Кэшбек баллами</th>
                <th style={{ padding: "8px 12px", textAlign: "right" }}>Порог накопления</th>
                <th style={{ padding: "8px 12px", textAlign: "center" }}>Статус</th>
              </tr>
            </thead>
            <tbody>
              {discounts.map((d) => (
                <tr key={d.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                  <td style={{ padding: "8px 12px", fontWeight: 600 }}>{d.name}</td>
                  <td style={{ padding: "8px 12px", color: "#666" }}>
                    {d.kind === "fixed_percent" ? "Фиксированный %"
                      : d.kind === "cumulative" ? "Накопительная шкала"
                      : d.kind === "bonus_points" ? "Бонусный кэшбек" : "Промокод"}
                  </td>
                  <td style={{ padding: "8px 12px", textAlign: "center", fontWeight: 700, color: "#186999" }}>
                    {d.discount_percent > 0 ? `${d.discount_percent}%` : "—"}
                  </td>
                  <td style={{ padding: "8px 12px", textAlign: "center", color: "#16a34a", fontWeight: 600 }}>
                    {d.bonus_earn_percent > 0 ? `+${d.bonus_earn_percent}%` : "—"}
                  </td>
                  <td style={{ padding: "8px 12px", textAlign: "right", color: "#666" }}>
                    {d.min_spent_tiyin > 0 ? fmtMoney(d.min_spent_tiyin) : "Без порога"}
                  </td>
                  <td style={{ padding: "8px 12px", textAlign: "center" }}>
                    <button
                      onClick={() => void toggleDiscountActive(d.id, d.active)}
                      style={{
                        padding: "3px 10px",
                        fontSize: 11,
                        borderRadius: 12,
                        border: "none",
                        cursor: "pointer",
                        fontWeight: 600,
                        background: d.active ? "#dcfce7" : "#f1f5f9",
                        color: d.active ? "#15803d" : "#64748b",
                      }}
                    >
                      {d.active ? "Активна" : "Отключена"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ---------------- 2. LOYALTY TAB ---------------- */}
      {activeTab === "loyalty" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ position: "relative", width: 320 }}>
              <Search size={15} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#888" }} />
              <input
                type="text"
                placeholder="Поиск по клиенту, телефону или номеру карты..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ width: "100%", padding: "6px 10px 6px 32px", fontSize: 13, border: "1px solid #d9d9d9", borderRadius: 4 }}
              />
            </div>
            <div style={{ fontSize: 13, color: "#666" }}>Всего активных карт: <strong>{filteredAccounts.length}</strong></div>
          </div>

          <div style={{ background: "#fff", border: "1px solid #d9d9d9", borderRadius: 6, overflow: "hidden" }}>
            <table className="enterprise-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#fafafa", borderBottom: "1px solid #e8e8e8", textAlign: "left" }}>
                  <th style={{ padding: "8px 12px" }}>Номер карты</th>
                  <th style={{ padding: "8px 12px" }}>Клиент</th>
                  <th style={{ padding: "8px 12px" }}>Телефон</th>
                  <th style={{ padding: "8px 12px" }}>Уровень лояльности</th>
                  <th style={{ padding: "8px 12px", textAlign: "right" }}>Баланс бонусов</th>
                  <th style={{ padding: "8px 12px", textAlign: "center" }}>Операции с баллами</th>
                </tr>
              </thead>
              <tbody>
                {filteredAccounts.map((acc) => (
                  <tr key={acc.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                    <td style={{ padding: "8px 12px", fontWeight: 700, color: "#186999" }}>
                      <CreditCard size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />
                      {acc.card_number}
                    </td>
                    <td style={{ padding: "8px 12px", fontWeight: 600 }}>{acc.counterparty_name}</td>
                    <td style={{ padding: "8px 12px", color: "#666" }}>{acc.counterparty_phone || "—"}</td>
                    <td style={{ padding: "8px 12px", color: "#475569" }}>{acc.tier_name || "Базовый"}</td>
                    <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 800, color: "#16a34a", fontSize: 14 }}>
                      {acc.points_balance.toLocaleString("ru-RU")} баллов
                    </td>
                    <td style={{ padding: "8px 12px", textAlign: "center" }}>
                      <button
                        onClick={() => void openAdjustModal(acc)}
                        className="button outline"
                        style={{ padding: "2px 8px", fontSize: 11 }}
                      >
                        Начислить / Списать
                      </button>
                    </td>
                  </tr>
                ))}
                {!filteredAccounts.length && (
                  <tr>
                    <td colSpan={6} style={{ padding: 28, textAlign: "center", color: "#888" }}>
                      Карт лояльности не найдено
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ---------------- NEW DISCOUNT MODAL ---------------- */}
      {newDiscOpen && (
        <div className="modal-backdrop" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "grid", placeItems: "center", zIndex: 999 }}>
          <form onSubmit={handleCreateDiscount} style={{ background: "#fff", width: 440, borderRadius: 8, padding: 20, boxShadow: "0 10px 25px rgba(0,0,0,0.2)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Создание программы скидок</h3>
              <button type="button" onClick={() => setNewDiscOpen(false)} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
            </div>

            <div style={{ display: "grid", gap: 12, marginBottom: 20 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Название скидки:</label>
                <input
                  type="text"
                  required
                  placeholder="Например: Скидка для постоянных клиентов 5%"
                  value={discName}
                  onChange={(e) => setDiscName(e.target.value)}
                  style={{ width: "100%", padding: "6px 10px", fontSize: 13, border: "1px solid #ccc", borderRadius: 4 }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Тип программы:</label>
                <select
                  value={discKind}
                  onChange={(e) => setDiscKind(e.target.value as typeof discKind)}
                  style={{ width: "100%", padding: "6px 10px", fontSize: 13, border: "1px solid #ccc", borderRadius: 4 }}
                >
                  <option value="fixed_percent">Фиксированная процентная скидка</option>
                  <option value="cumulative">Накопительная скидка от суммы покупок</option>
                  <option value="bonus_points">Бонусные баллы (кэшбек)</option>
                </select>
              </div>

              {discKind !== "bonus_points" && (
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Размер скидки (%):</label>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={discPercent}
                    onChange={(e) => setDiscPercent(Number(e.target.value))}
                    style={{ width: "100%", padding: "6px 10px", fontSize: 13, border: "1px solid #ccc", borderRadius: 4 }}
                  />
                </div>
              )}

              {discKind === "bonus_points" && (
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Процент начисления бонусов (%):</label>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value={discBonusEarn}
                    onChange={(e) => setDiscBonusEarn(Number(e.target.value))}
                    style={{ width: "100%", padding: "6px 10px", fontSize: 13, border: "1px solid #ccc", borderRadius: 4 }}
                  />
                </div>
              )}

              {discKind === "cumulative" && (
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Порог накоплений для активации (₸):</label>
                  <input
                    type="number"
                    min="0"
                    step="10000"
                    value={discMinSpent}
                    onChange={(e) => setDiscMinSpent(Number(e.target.value))}
                    style={{ width: "100%", padding: "6px 10px", fontSize: 13, border: "1px solid #ccc", borderRadius: 4 }}
                  />
                </div>
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button type="button" onClick={() => setNewDiscOpen(false)} className="button outline">Отмена</button>
              <button type="submit" className="button action-blue">Создать скидку</button>
            </div>
          </form>
        </div>
      )}

      {/* ---------------- ADJUST POINTS MODAL ---------------- */}
      {adjustAccount && (
        <div className="modal-backdrop" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "grid", placeItems: "center", zIndex: 999 }}>
          <div style={{ background: "#fff", width: 480, borderRadius: 8, padding: 20, boxShadow: "0 10px 25px rgba(0,0,0,0.2)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Операции с баллами: {adjustAccount.counterparty_name}</h3>
              <button onClick={() => setAdjustAccount(null)} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
            </div>

            <div style={{ padding: "8px 12px", background: "#f8fafc", borderRadius: 6, marginBottom: 14, fontSize: 13 }}>
              Карта: <strong>{adjustAccount.card_number}</strong> | Текущий баланс: <strong style={{ color: "#16a34a" }}>{adjustAccount.points_balance} баллов</strong>
            </div>

            <div style={{ display: "grid", gap: 10, marginBottom: 16 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Количество баллов (1 балл = 1 ₸):</label>
                <input
                  type="number"
                  min="1"
                  step="50"
                  value={adjustAmount}
                  onChange={(e) => setAdjustAmount(Number(e.target.value))}
                  style={{ width: "100%", padding: "6px 10px", fontSize: 13, border: "1px solid #ccc", borderRadius: 4 }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Причина / Комментарий:</label>
                <input
                  type="text"
                  value={adjustComment}
                  onChange={(e) => setAdjustComment(e.target.value)}
                  style={{ width: "100%", padding: "6px 10px", fontSize: 13, border: "1px solid #ccc", borderRadius: 4 }}
                />
              </div>

              <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
                <button
                  type="button"
                  onClick={() => void handleAdjustPoints(false)}
                  className="button primary"
                  style={{ flex: 1, background: "#16a34a", padding: "8px" }}
                >
                  <ArrowUpRight size={14} style={{ marginRight: 4 }} /> Начислить +{adjustAmount}
                </button>
                <button
                  type="button"
                  onClick={() => void handleAdjustPoints(true)}
                  className="button outline"
                  style={{ flex: 1, color: "#dc2626", borderColor: "#dc2626", padding: "8px" }}
                >
                  <ArrowDownRight size={14} style={{ marginRight: 4 }} /> Списать -{adjustAmount}
                </button>
              </div>
            </div>

            {/* History */}
            <div style={{ borderTop: "1px solid #eee", paddingTop: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#666", marginBottom: 6 }}>История операций:</div>
              <div style={{ maxHeight: 150, overflowY: "auto", fontSize: 11 }}>
                {accountHistory.map((h) => (
                  <div key={h.id} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid #f8f8f8" }}>
                    <span>{h.created_at?.slice(0, 16)} · {h.comment || h.kind}</span>
                    <strong style={{ color: h.amount_points > 0 ? "#16a34a" : "#dc2626" }}>
                      {h.amount_points > 0 ? "+" : ""}{h.amount_points}
                    </strong>
                  </div>
                ))}
                {!accountHistory.length && <div style={{ color: "#999" }}>Операций пока не было</div>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
