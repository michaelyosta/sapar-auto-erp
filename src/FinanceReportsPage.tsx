import { useEffect, useState, useCallback, useMemo } from "react";
import {
  TrendingUp,
  ArrowUpRight,
  ArrowDownRight,
  Wallet,
  Building,
  RefreshCw,
  Users,
  Calendar,
  Layers,
  PieChart,
} from "lucide-react";

type ReportType = "cashflow" | "pnl" | "settlements";

interface CashflowData {
  opening_balance_tiyin: number;
  total_inflow_tiyin: number;
  total_outflow_tiyin: number;
  net_cashflow_tiyin: number;
  closing_balance_tiyin: number;
  items: Array<{
    id: number;
    number: string;
    date: string;
    kind: string;
    direction: "in" | "out";
    amount_tiyin: number;
    counterparty_name?: string;
    account: string;
    comment?: string;
  }>;
}

interface PnlData {
  total_revenue_tiyin: number;
  total_cogs_tiyin: number;
  gross_profit_tiyin: number;
  gross_margin_percent: number;
  revenue_by_kind: Array<{
    kind: string;
    doc_count: number;
    total_revenue_tiyin: number;
  }>;
  top_items: Array<{
    product_id: number;
    product_name: string;
    product_code: string;
    product_kind: string;
    sold_quantity_units: number;
    revenue_tiyin: number;
  }>;
}

interface SettlementsData {
  total_customer_debt_tiyin: number;
  total_supplier_debt_tiyin: number;
  rows: Array<{
    id: number;
    name: string;
    kind: string;
    phone: string;
    total_invoiced_tiyin: number;
    total_customer_paid_tiyin: number;
    total_supplier_billed_tiyin: number;
    total_we_paid_tiyin: number;
    customer_debt_tiyin: number;
    supplier_debt_tiyin: number;
    balance_tiyin: number;
  }>;
}

function fmtMoney(tiyins: number): string {
  const kzt = tiyins / 100;
  return kzt.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₸";
}

function getPeriodDates(preset: "all" | "today" | "yesterday" | "week" | "month" | "year") {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty" }).format(new Date());
  if (preset === "all") return { from: "", to: "" };
  if (preset === "today") return { from: today, to: today };

  const d = new Date();
  if (preset === "yesterday") {
    d.setDate(d.getDate() - 1);
    const yest = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty" }).format(d);
    return { from: yest, to: yest };
  }
  if (preset === "week") {
    d.setDate(d.getDate() - 7);
    const weekAgo = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty" }).format(d);
    return { from: weekAgo, to: today };
  }
  if (preset === "month") {
    d.setMonth(d.getMonth() - 1);
    const monthAgo = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty" }).format(d);
    return { from: monthAgo, to: today };
  }
  if (preset === "year") {
    const yearStart = `${today.slice(0, 4)}-01-01`;
    return { from: yearStart, to: today };
  }
  return { from: "", to: "" };
}

export default function FinanceReportsPage({
  initialType = "cashflow",
  onNotify,
}: {
  initialType?: ReportType;
  onNotify?: (msg: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<ReportType>(initialType);
  const [periodPreset, setPeriodPreset] = useState<"all" | "today" | "yesterday" | "week" | "month" | "year">("month");
  const [dateFrom, setDateFrom] = useState(() => getPeriodDates("month").from);
  const [dateTo, setDateTo] = useState(() => getPeriodDates("month").to);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Cashflow sub-view
  const [cashflowMode, setCashflowMode] = useState<"all" | "days" | "accounts">("all");

  // Data states
  const [cashflowData, setCashflowData] = useState<CashflowData | null>(null);
  const [pnlData, setPnlData] = useState<PnlData | null>(null);
  const [settlementsData, setSettlementsData] = useState<SettlementsData | null>(null);

  // Settlement filter
  const [settlementKind, setSettlementKind] = useState<"all" | "customer" | "supplier">("all");

  const handlePresetChange = (preset: "all" | "today" | "yesterday" | "week" | "month" | "year") => {
    setPeriodPreset(preset);
    const { from, to } = getPeriodDates(preset);
    setDateFrom(from);
    setDateTo(to);
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const q = new URLSearchParams();
      if (dateFrom) q.set("from", dateFrom);
      if (dateTo) q.set("to", dateTo);

      if (activeTab === "cashflow") {
        const res = await fetch(`/api/reports/cashflow?${q.toString()}`);
        if (!res.ok) throw new Error("Не удалось загрузить отчет ДДС");
        const json = await res.json();
        setCashflowData(json);
      } else if (activeTab === "pnl") {
        const res = await fetch(`/api/reports/pnl?${q.toString()}`);
        if (!res.ok) throw new Error("Не удалось загрузить отчет P&L");
        const json = await res.json();
        setPnlData(json);
      } else if (activeTab === "settlements") {
        const res = await fetch(`/api/reports/settlements`);
        if (!res.ok) throw new Error("Не удалось загрузить отчет Взаиморасчеты");
        const json = await res.json();
        setSettlementsData(json);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Ошибка загрузки отчета";
      setError(msg);
      if (onNotify) onNotify(msg);
    } finally {
      setLoading(false);
    }
  }, [activeTab, dateFrom, dateTo, onNotify]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Aggregate cashflow by days
  const dailyCashflow = useMemo(() => {
    if (!cashflowData?.items) return [];
    const map = new Map<string, { date: string; inflow: number; outflow: number; count: number }>();
    for (const it of cashflowData.items) {
      const entry = map.get(it.date) ?? { date: it.date, inflow: 0, outflow: 0, count: 0 };
      if (it.direction === "in") entry.inflow += it.amount_tiyin;
      else entry.outflow += it.amount_tiyin;
      entry.count += 1;
      map.set(it.date, entry);
    }
    return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
  }, [cashflowData]);

  // Aggregate cashflow by account
  const accountCashflow = useMemo(() => {
    if (!cashflowData?.items) return [];
    const map = new Map<string, { account: string; inflow: number; outflow: number; count: number }>();
    for (const it of cashflowData.items) {
      const entry = map.get(it.account) ?? { account: it.account, inflow: 0, outflow: 0, count: 0 };
      if (it.direction === "in") entry.inflow += it.amount_tiyin;
      else entry.outflow += it.amount_tiyin;
      entry.count += 1;
      map.set(it.account, entry);
    }
    return Array.from(map.values()).sort((a, b) => (b.inflow + b.outflow) - (a.inflow + a.outflow));
  }, [cashflowData]);

  // Filter settlements
  const filteredSettlements = useMemo(() => {
    if (!settlementsData?.rows) return [];
    if (settlementKind === "all") return settlementsData.rows;
    return settlementsData.rows.filter((r) => r.kind === settlementKind);
  }, [settlementsData, settlementKind]);

  const docKindNames: Record<string, string> = {
    work_order: "Заказ-наряды автосервиса",
    shipment: "Отгрузки (накладные)",
    retailsale: "Розничные продажи (POS)",
    customer_order: "Заказы клиентов",
    cash_in: "Приходный кассовый ордер (ПКО)",
    cash_out: "Расходный кассовый ордер (РКО)",
    incoming_payment: "Входящий банковский платеж",
    payment: "Исходящий банковский платеж",
  };

  return (
    <div className="finance-reports-page" style={{ padding: "16px 24px", maxWidth: 1400, margin: "0 auto" }}>
      {/* Top Header & Report Switcher */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, color: "#222", margin: "0 0 6px" }}>Финансовые отчеты</h1>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => setActiveTab("cashflow")}
              className={`button ${activeTab === "cashflow" ? "primary" : "outline"}`}
              style={{ padding: "6px 14px", fontSize: 13 }}
            >
              <Wallet size={15} style={{ marginRight: 6 }} />
              Движение денежных средств (Cash Flow)
            </button>
            <button
              onClick={() => setActiveTab("pnl")}
              className={`button ${activeTab === "pnl" ? "primary" : "outline"}`}
              style={{ padding: "6px 14px", fontSize: 13 }}
            >
              <TrendingUp size={15} style={{ marginRight: 6 }} />
              Прибыли и убытки (P&L)
            </button>
            <button
              onClick={() => setActiveTab("settlements")}
              className={`button ${activeTab === "settlements" ? "primary" : "outline"}`}
              style={{ padding: "6px 14px", fontSize: 13 }}
            >
              <Users size={15} style={{ marginRight: 6 }} />
              Взаиморасчеты (Дебиторка/Кредиторка)
            </button>
          </div>
        </div>

        <button
          onClick={() => void loadData()}
          disabled={loading}
          className="button outline"
          style={{ padding: "6px 12px", display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}
        >
          <RefreshCw size={14} className={loading ? "spin" : ""} />
          Обновить
        </button>
      </div>

      {/* Date Filter Toolbar */}
      {activeTab !== "settlements" && (
        <div
          style={{
            background: "#fff",
            border: "1px solid #d9d9d9",
            borderRadius: 6,
            padding: "10px 16px",
            marginBottom: 16,
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Calendar size={16} color="#666" />
            <span style={{ fontSize: 13, fontWeight: 500, color: "#444" }}>Период:</span>
          </div>

          <div style={{ display: "flex", gap: 4 }}>
            {[
              { id: "today", label: "Сегодня" },
              { id: "yesterday", label: "Вчера" },
              { id: "week", label: "Неделя" },
              { id: "month", label: "Месяц" },
              { id: "year", label: "Год" },
              { id: "all", label: "Весь период" },
            ].map((p) => (
              <button
                key={p.id}
                onClick={() => handlePresetChange(p.id as typeof periodPreset)}
                style={{
                  padding: "4px 10px",
                  fontSize: 12,
                  borderRadius: 4,
                  border: "1px solid",
                  borderColor: periodPreset === p.id ? "#1976a5" : "#ddd",
                  background: periodPreset === p.id ? "#e8f2f8" : "#fff",
                  color: periodPreset === p.id ? "#1976a5" : "#444",
                  fontWeight: periodPreset === p.id ? 600 : 400,
                  cursor: "pointer",
                }}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
            <label style={{ fontSize: 12, color: "#666" }}>С:</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value);
                setPeriodPreset("all");
              }}
              style={{ padding: "3px 8px", fontSize: 12, border: "1px solid #ccc", borderRadius: 4 }}
            />
            <label style={{ fontSize: 12, color: "#666" }}>По:</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value);
                setPeriodPreset("all");
              }}
              style={{ padding: "3px 8px", fontSize: 12, border: "1px solid #ccc", borderRadius: 4 }}
            />
          </div>
        </div>
      )}

      {error && (
        <div style={{ padding: "10px 14px", background: "#fde8e8", color: "#c81e1e", borderRadius: 6, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* ---------------- CASH FLOW TAB ---------------- */}
      {activeTab === "cashflow" && cashflowData && (
        <div>
          {/* Summary Metric Cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginBottom: 16 }}>
            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 6, padding: "12px 16px" }}>
              <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Начальный остаток</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#1e293b" }}>{fmtMoney(cashflowData.opening_balance_tiyin)}</div>
            </div>
            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 6, padding: "12px 16px" }}>
              <div style={{ fontSize: 12, color: "#16a34a", display: "flex", alignItems: "center", gap: 4, marginBottom: 4 }}>
                <ArrowUpRight size={14} /> Приход (поступления)
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#16a34a" }}>+{fmtMoney(cashflowData.total_inflow_tiyin)}</div>
            </div>
            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 6, padding: "12px 16px" }}>
              <div style={{ fontSize: 12, color: "#dc2626", display: "flex", alignItems: "center", gap: 4, marginBottom: 4 }}>
                <ArrowDownRight size={14} /> Расход (выплаты)
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#dc2626" }}>-{fmtMoney(cashflowData.total_outflow_tiyin)}</div>
            </div>
            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 6, padding: "12px 16px" }}>
              <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Чистый поток (Net Cash)</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: cashflowData.net_cashflow_tiyin >= 0 ? "#16a34a" : "#dc2626" }}>
                {cashflowData.net_cashflow_tiyin >= 0 ? "+" : ""}{fmtMoney(cashflowData.net_cashflow_tiyin)}
              </div>
            </div>
            <div style={{ background: "#f8fafc", border: "1px solid #cbd5e1", borderRadius: 6, padding: "12px 16px" }}>
              <div style={{ fontSize: 12, color: "#475569", marginBottom: 4 }}>Конечный остаток</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#0f172a" }}>{fmtMoney(cashflowData.closing_balance_tiyin)}</div>
            </div>
          </div>

          {/* Subview Selector */}
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <button
              onClick={() => setCashflowMode("all")}
              style={{
                padding: "4px 12px",
                fontSize: 12,
                borderRadius: 4,
                border: "1px solid",
                borderColor: cashflowMode === "all" ? "#1976a5" : "#ccc",
                background: cashflowMode === "all" ? "#1976a5" : "#fff",
                color: cashflowMode === "all" ? "#fff" : "#333",
                cursor: "pointer",
              }}
            >
              Все операции ({cashflowData.items.length})
            </button>
            <button
              onClick={() => setCashflowMode("days")}
              style={{
                padding: "4px 12px",
                fontSize: 12,
                borderRadius: 4,
                border: "1px solid",
                borderColor: cashflowMode === "days" ? "#1976a5" : "#ccc",
                background: cashflowMode === "days" ? "#1976a5" : "#fff",
                color: cashflowMode === "days" ? "#fff" : "#333",
                cursor: "pointer",
              }}
            >
              По дням
            </button>
            <button
              onClick={() => setCashflowMode("accounts")}
              style={{
                padding: "4px 12px",
                fontSize: 12,
                borderRadius: 4,
                border: "1px solid",
                borderColor: cashflowMode === "accounts" ? "#1976a5" : "#ccc",
                background: cashflowMode === "accounts" ? "#1976a5" : "#fff",
                color: cashflowMode === "accounts" ? "#fff" : "#333",
                cursor: "pointer",
              }}
            >
              По счетам и кассам
            </button>
          </div>

          {/* Content Table */}
          <div style={{ background: "#fff", border: "1px solid #d9d9d9", borderRadius: 6, overflow: "hidden" }}>
            {cashflowMode === "all" && (
              <table className="enterprise-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#fafafa", borderBottom: "1px solid #e8e8e8", textAlign: "left" }}>
                    <th style={{ padding: "8px 12px" }}>Дата</th>
                    <th style={{ padding: "8px 12px" }}>Документ</th>
                    <th style={{ padding: "8px 12px" }}>Счет / Касса</th>
                    <th style={{ padding: "8px 12px" }}>Контрагент</th>
                    <th style={{ padding: "8px 12px" }}>Комментарий</th>
                    <th style={{ padding: "8px 12px", textAlign: "right" }}>Приход</th>
                    <th style={{ padding: "8px 12px", textAlign: "right" }}>Расход</th>
                  </tr>
                </thead>
                <tbody>
                  {cashflowData.items.map((it) => (
                    <tr key={it.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                      <td style={{ padding: "8px 12px", color: "#666" }}>{it.date}</td>
                      <td style={{ padding: "8px 12px", fontWeight: 500 }}>
                        <span style={{ color: "#1976a5" }}>{it.number}</span>
                        <span style={{ fontSize: 11, color: "#888", display: "block" }}>{docKindNames[it.kind] ?? it.kind}</span>
                      </td>
                      <td style={{ padding: "8px 12px" }}>{it.account}</td>
                      <td style={{ padding: "8px 12px" }}>{it.counterparty_name || "—"}</td>
                      <td style={{ padding: "8px 12px", color: "#666" }}>{it.comment || "—"}</td>
                      <td style={{ padding: "8px 12px", textAlign: "right", color: "#16a34a", fontWeight: 600 }}>
                        {it.direction === "in" ? `+${fmtMoney(it.amount_tiyin)}` : ""}
                      </td>
                      <td style={{ padding: "8px 12px", textAlign: "right", color: "#dc2626", fontWeight: 600 }}>
                        {it.direction === "out" ? `-${fmtMoney(it.amount_tiyin)}` : ""}
                      </td>
                    </tr>
                  ))}
                  {!cashflowData.items.length && (
                    <tr>
                      <td colSpan={7} style={{ padding: 32, textAlign: "center", color: "#888" }}>
                        Движений по счетам и кассе за выбранный период не обнаружено
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}

            {cashflowMode === "days" && (
              <table className="enterprise-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#fafafa", borderBottom: "1px solid #e8e8e8", textAlign: "left" }}>
                    <th style={{ padding: "8px 12px" }}>Дата</th>
                    <th style={{ padding: "8px 12px", textAlign: "center" }}>Операций</th>
                    <th style={{ padding: "8px 12px", textAlign: "right", color: "#16a34a" }}>Приход</th>
                    <th style={{ padding: "8px 12px", textAlign: "right", color: "#dc2626" }}>Расход</th>
                    <th style={{ padding: "8px 12px", textAlign: "right" }}>Сальдо за день</th>
                  </tr>
                </thead>
                <tbody>
                  {dailyCashflow.map((d) => (
                    <tr key={d.date} style={{ borderBottom: "1px solid #f0f0f0" }}>
                      <td style={{ padding: "8px 12px", fontWeight: 500 }}>{d.date}</td>
                      <td style={{ padding: "8px 12px", textAlign: "center", color: "#666" }}>{d.count}</td>
                      <td style={{ padding: "8px 12px", textAlign: "right", color: "#16a34a", fontWeight: 600 }}>
                        +{fmtMoney(d.inflow)}
                      </td>
                      <td style={{ padding: "8px 12px", textAlign: "right", color: "#dc2626", fontWeight: 600 }}>
                        -{fmtMoney(d.outflow)}
                      </td>
                      <td
                        style={{
                          padding: "8px 12px",
                          textAlign: "right",
                          fontWeight: 700,
                          color: d.inflow - d.outflow >= 0 ? "#16a34a" : "#dc2626",
                        }}
                      >
                        {d.inflow - d.outflow >= 0 ? "+" : ""}{fmtMoney(d.inflow - d.outflow)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {cashflowMode === "accounts" && (
              <table className="enterprise-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#fafafa", borderBottom: "1px solid #e8e8e8", textAlign: "left" }}>
                    <th style={{ padding: "8px 12px" }}>Счет / Касса</th>
                    <th style={{ padding: "8px 12px", textAlign: "center" }}>Операций</th>
                    <th style={{ padding: "8px 12px", textAlign: "right", color: "#16a34a" }}>Приход</th>
                    <th style={{ padding: "8px 12px", textAlign: "right", color: "#dc2626" }}>Расход</th>
                    <th style={{ padding: "8px 12px", textAlign: "right" }}>Баланс потока</th>
                  </tr>
                </thead>
                <tbody>
                  {accountCashflow.map((a) => (
                    <tr key={a.account} style={{ borderBottom: "1px solid #f0f0f0" }}>
                      <td style={{ padding: "8px 12px", fontWeight: 500 }}>
                        <Building size={14} style={{ marginRight: 6, verticalAlign: "middle", color: "#1976a5" }} />
                        {a.account}
                      </td>
                      <td style={{ padding: "8px 12px", textAlign: "center", color: "#666" }}>{a.count}</td>
                      <td style={{ padding: "8px 12px", textAlign: "right", color: "#16a34a", fontWeight: 600 }}>
                        +{fmtMoney(a.inflow)}
                      </td>
                      <td style={{ padding: "8px 12px", textAlign: "right", color: "#dc2626", fontWeight: 600 }}>
                        -{fmtMoney(a.outflow)}
                      </td>
                      <td
                        style={{
                          padding: "8px 12px",
                          textAlign: "right",
                          fontWeight: 700,
                          color: a.inflow - a.outflow >= 0 ? "#16a34a" : "#dc2626",
                        }}
                      >
                        {a.inflow - a.outflow >= 0 ? "+" : ""}{fmtMoney(a.inflow - a.outflow)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ---------------- P&L TAB ---------------- */}
      {activeTab === "pnl" && pnlData && (
        <div>
          {/* Executive Profitability Cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12, marginBottom: 16 }}>
            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 6, padding: "14px 16px" }}>
              <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Выручка (начислено)</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "#1e293b" }}>{fmtMoney(pnlData.total_revenue_tiyin)}</div>
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>По закрытым заказ-нарядам и продажам</div>
            </div>
            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 6, padding: "14px 16px" }}>
              <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Себестоимость (COGS)</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "#dc2626" }}>{fmtMoney(pnlData.total_cogs_tiyin)}</div>
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>Списанные запчасти и жидкости</div>
            </div>
            <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 6, padding: "14px 16px" }}>
              <div style={{ fontSize: 12, color: "#166534", marginBottom: 4 }}>Валовая прибыль (Gross Profit)</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "#15803d" }}>{fmtMoney(pnlData.gross_profit_tiyin)}</div>
              <div style={{ fontSize: 11, color: "#166534", marginTop: 4 }}>Маржинальность: <strong>{pnlData.gross_margin_percent}%</strong></div>
            </div>
          </div>

          {/* Revenue Breakdown by Document Kind */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
            <div style={{ background: "#fff", border: "1px solid #d9d9d9", borderRadius: 6, padding: 16 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 12px", display: "flex", alignItems: "center", gap: 6 }}>
                <PieChart size={16} color="#1976a5" />
                Структура выручки по видам операций
              </h3>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #eee", textAlign: "left", color: "#666" }}>
                    <th style={{ padding: "6px 8px" }}>Тип документа</th>
                    <th style={{ padding: "6px 8px", textAlign: "center" }}>Кол-во</th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }}>Сумма</th>
                  </tr>
                </thead>
                <tbody>
                  {pnlData.revenue_by_kind.map((r) => (
                    <tr key={r.kind} style={{ borderBottom: "1px solid #f8f8f8" }}>
                      <td style={{ padding: "8px" }}>{docKindNames[r.kind] ?? r.kind}</td>
                      <td style={{ padding: "8px", textAlign: "center", color: "#666" }}>{r.doc_count}</td>
                      <td style={{ padding: "8px", textAlign: "right", fontWeight: 600 }}>{fmtMoney(r.total_revenue_tiyin)}</td>
                    </tr>
                  ))}
                  {!pnlData.revenue_by_kind.length && (
                    <tr>
                      <td colSpan={3} style={{ padding: 16, textAlign: "center", color: "#888" }}>
                        Нет данных о выручке за выбранный период
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Financial P&L Statement */}
            <div style={{ background: "#fff", border: "1px solid #d9d9d9", borderRadius: 6, padding: 16 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 12px", display: "flex", alignItems: "center", gap: 6 }}>
                <Layers size={16} color="#1976a5" />
                Отчет о финансовых результатах (P&L)
              </h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #eee" }}>
                  <span style={{ fontWeight: 600 }}>Выручка (нетто)</span>
                  <span style={{ fontWeight: 600 }}>{fmtMoney(pnlData.total_revenue_tiyin)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #eee", color: "#dc2626" }}>
                  <span>Себестоимость реализованных ТМЦ</span>
                  <span>-{fmtMoney(pnlData.total_cogs_tiyin)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "2px solid #333", fontWeight: 700, color: "#16a34a" }}>
                  <span>Валовая прибыль (Gross Profit)</span>
                  <span>{fmtMoney(pnlData.gross_profit_tiyin)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #eee", color: "#666" }}>
                  <span>Коммерческие и управленческие расходы (OPEX)</span>
                  <span>0,00 ₸</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", fontWeight: 800, fontSize: 15, color: "#0f172a" }}>
                  <span>Чистая прибыль автосервиса</span>
                  <span style={{ color: pnlData.gross_profit_tiyin >= 0 ? "#15803d" : "#dc2626" }}>
                    {fmtMoney(pnlData.gross_profit_tiyin)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Top Items Table */}
          <div style={{ background: "#fff", border: "1px solid #d9d9d9", borderRadius: 6, overflow: "hidden" }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid #eee", fontWeight: 600, fontSize: 14 }}>
              Рейтинг доходности по номенклатуре (Топ товаров и услуг)
            </div>
            <table className="enterprise-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#fafafa", borderBottom: "1px solid #e8e8e8", textAlign: "left" }}>
                  <th style={{ padding: "8px 12px" }}>Наименование</th>
                  <th style={{ padding: "8px 12px" }}>Код</th>
                  <th style={{ padding: "8px 12px" }}>Тип</th>
                  <th style={{ padding: "8px 12px", textAlign: "right" }}>Реализовано</th>
                  <th style={{ padding: "8px 12px", textAlign: "right" }}>Выручка</th>
                </tr>
              </thead>
              <tbody>
                {pnlData.top_items.map((it) => (
                  <tr key={it.product_id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                    <td style={{ padding: "8px 12px", fontWeight: 500 }}>{it.product_name}</td>
                    <td style={{ padding: "8px 12px", color: "#666" }}>{it.product_code || "—"}</td>
                    <td style={{ padding: "8px 12px", color: "#666" }}>
                      {it.product_kind === "service" ? "Услуга (работа)" : "Товар (деталь)"}
                    </td>
                    <td style={{ padding: "8px 12px", textAlign: "right" }}>
                      {(it.sold_quantity_units / 1000000).toLocaleString("ru-RU", { maximumFractionDigits: 2 })}
                    </td>
                    <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 600, color: "#1976a5" }}>
                      {fmtMoney(it.revenue_tiyin)}
                    </td>
                  </tr>
                ))}
                {!pnlData.top_items.length && (
                  <tr>
                    <td colSpan={5} style={{ padding: 24, textAlign: "center", color: "#888" }}>
                      Нет данных о продажах номенклатуры
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ---------------- SETTLEMENTS TAB ---------------- */}
      {activeTab === "settlements" && settlementsData && (
        <div>
          {/* Summary Cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12, marginBottom: 16 }}>
            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 6, padding: "14px 16px" }}>
              <div style={{ fontSize: 12, color: "#16a34a", marginBottom: 4 }}>Нам должны (дебиторская задолженность)</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "#16a34a" }}>
                {fmtMoney(settlementsData.total_customer_debt_tiyin)}
              </div>
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>Долг автовладельцев и клиентов</div>
            </div>
            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 6, padding: "14px 16px" }}>
              <div style={{ fontSize: 12, color: "#dc2626", marginBottom: 4 }}>Мы должны (кредиторская задолженность)</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "#dc2626" }}>
                {fmtMoney(settlementsData.total_supplier_debt_tiyin)}
              </div>
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>Задолженность перед поставщиками</div>
            </div>
          </div>

          {/* Filter Bar */}
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <button
              onClick={() => setSettlementKind("all")}
              style={{
                padding: "4px 12px",
                fontSize: 12,
                borderRadius: 4,
                border: "1px solid",
                borderColor: settlementKind === "all" ? "#1976a5" : "#ccc",
                background: settlementKind === "all" ? "#1976a5" : "#fff",
                color: settlementKind === "all" ? "#fff" : "#333",
                cursor: "pointer",
              }}
            >
              Все контрагенты ({settlementsData.rows.length})
            </button>
            <button
              onClick={() => setSettlementKind("customer")}
              style={{
                padding: "4px 12px",
                fontSize: 12,
                borderRadius: 4,
                border: "1px solid",
                borderColor: settlementKind === "customer" ? "#1976a5" : "#ccc",
                background: settlementKind === "customer" ? "#1976a5" : "#fff",
                color: settlementKind === "customer" ? "#fff" : "#333",
                cursor: "pointer",
              }}
            >
              Только покупатели
            </button>
            <button
              onClick={() => setSettlementKind("supplier")}
              style={{
                padding: "4px 12px",
                fontSize: 12,
                borderRadius: 4,
                border: "1px solid",
                borderColor: settlementKind === "supplier" ? "#1976a5" : "#ccc",
                background: settlementKind === "supplier" ? "#1976a5" : "#fff",
                color: settlementKind === "supplier" ? "#fff" : "#333",
                cursor: "pointer",
              }}
            >
              Только поставщики
            </button>
          </div>

          {/* Table */}
          <div style={{ background: "#fff", border: "1px solid #d9d9d9", borderRadius: 6, overflow: "hidden" }}>
            <table className="enterprise-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#fafafa", borderBottom: "1px solid #e8e8e8", textAlign: "left" }}>
                  <th style={{ padding: "8px 12px" }}>Контрагент</th>
                  <th style={{ padding: "8px 12px" }}>Тип</th>
                  <th style={{ padding: "8px 12px" }}>Телефон</th>
                  <th style={{ padding: "8px 12px", textAlign: "right" }}>Выставлено / Принято</th>
                  <th style={{ padding: "8px 12px", textAlign: "right" }}>Оплачено</th>
                  <th style={{ padding: "8px 12px", textAlign: "right" }}>Долг клиента</th>
                  <th style={{ padding: "8px 12px", textAlign: "right" }}>Наш долг</th>
                </tr>
              </thead>
              <tbody>
                {filteredSettlements.map((r) => (
                  <tr key={r.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                    <td style={{ padding: "8px 12px", fontWeight: 500 }}>{r.name}</td>
                    <td style={{ padding: "8px 12px", color: "#666" }}>
                      {r.kind === "customer" ? "Покупатель" : r.kind === "supplier" ? "Поставщик" : "Контрагент"}
                    </td>
                    <td style={{ padding: "8px 12px", color: "#666" }}>{r.phone || "—"}</td>
                    <td style={{ padding: "8px 12px", textAlign: "right" }}>
                      {fmtMoney(r.total_invoiced_tiyin || r.total_supplier_billed_tiyin)}
                    </td>
                    <td style={{ padding: "8px 12px", textAlign: "right" }}>
                      {fmtMoney(r.total_customer_paid_tiyin || r.total_we_paid_tiyin)}
                    </td>
                    <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 600, color: r.customer_debt_tiyin > 0 ? "#16a34a" : "#666" }}>
                      {r.customer_debt_tiyin > 0 ? `+${fmtMoney(r.customer_debt_tiyin)}` : "—"}
                    </td>
                    <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 600, color: r.supplier_debt_tiyin > 0 ? "#dc2626" : "#666" }}>
                      {r.supplier_debt_tiyin > 0 ? `-${fmtMoney(r.supplier_debt_tiyin)}` : "—"}
                    </td>
                  </tr>
                ))}
                {!filteredSettlements.length && (
                  <tr>
                    <td colSpan={7} style={{ padding: 24, textAlign: "center", color: "#888" }}>
                      Контрагентов с задолженностями не найдено
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
