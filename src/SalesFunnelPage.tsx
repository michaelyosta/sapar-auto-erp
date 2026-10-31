import { useEffect, useState, useCallback } from "react";
import {
  Filter,
  TrendingUp,
  Calendar,
  Award,
  RefreshCw,
} from "lucide-react";

interface FunnelStage {
  key: string;
  name: string;
  count: number;
  total_tiyin: number;
  avg_check_tiyin: number;
  conversion_percent: number;
}

interface FunnelResponse {
  total_orders: number;
  total_revenue_tiyin: number;
  avg_check_tiyin: number;
  stages: FunnelStage[];
}

interface ManagerPerformance {
  user_id: number;
  full_name: string;
  position: string;
  orders_count: number;
  work_revenue_tiyin: number;
  parts_revenue_tiyin: number;
  total_revenue_tiyin: number;
  gross_profit_tiyin: number;
  margin_percent: number;
}

function fmtMoney(tiyins: number): string {
  const kzt = tiyins / 100;
  return kzt.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₸";
}

export default function SalesFunnelPage({
  initialTab = "funnel",
}: {
  initialTab?: "funnel" | "profitability";
  onNotify?: (msg: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<"funnel" | "profitability">(initialTab);
  const [funnel, setFunnel] = useState<FunnelResponse | null>(null);
  const [managers, setManagers] = useState<ManagerPerformance[]>([]);
  const [loading, setLoading] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams();
      if (dateFrom) q.set("from", dateFrom);
      if (dateTo) q.set("to", dateTo);

      if (activeTab === "funnel") {
        const res = await fetch(`/api/analytics/sales-funnel?${q.toString()}`);
        if (res.ok) setFunnel(await res.json());
      } else {
        const res = await fetch(`/api/analytics/manager-performance?${q.toString()}`);
        if (res.ok) setManagers(await res.json());
      }
    } finally {
      setLoading(false);
    }
  }, [activeTab, dateFrom, dateTo]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const maxStageCount = Math.max(1, ...(funnel?.stages.map((s) => s.count) ?? [1]));

  return (
    <div className="analytics-funnel-page" style={{ padding: "16px 24px", maxWidth: 1400, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, color: "#222", margin: "0 0 6px", display: "flex", alignItems: "center", gap: 8 }}>
            <TrendingUp size={24} color="#186999" />
            Аналитика продаж и Прибыльность
          </h1>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => setActiveTab("funnel")}
              className={`button ${activeTab === "funnel" ? "primary" : "outline"}`}
              style={{ padding: "6px 14px", fontSize: 13 }}
            >
              <Filter size={14} style={{ marginRight: 6 }} />
              Воронка этапов ремонта
            </button>
            <button
              onClick={() => setActiveTab("profitability")}
              className={`button ${activeTab === "profitability" ? "primary" : "outline"}`}
              style={{ padding: "6px 14px", fontSize: 13 }}
            >
              <Award size={14} style={{ marginRight: 6 }} />
              Прибыльность по мастерам и менеджерам
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

      {/* Date Filter Bar */}
      <div
        style={{
          background: "#fff",
          border: "1px solid #d9d9d9",
          borderRadius: 6,
          padding: "8px 16px",
          marginBottom: 16,
          display: "flex",
          alignItems: "center",
          gap: 12,
          fontSize: 12,
        }}
      >
        <Calendar size={15} color="#666" />
        <span style={{ fontWeight: 600, color: "#444" }}>Период:</span>
        <label>С:</label>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          style={{ padding: "3px 8px", border: "1px solid #ccc", borderRadius: 4 }}
        />
        <label>По:</label>
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          style={{ padding: "3px 8px", border: "1px solid #ccc", borderRadius: 4 }}
        />
        {(dateFrom || dateTo) && (
          <button
            onClick={() => { setDateFrom(""); setDateTo(""); }}
            style={{ background: "none", border: "none", color: "#186999", cursor: "pointer", textDecoration: "underline" }}
          >
            Сбросить
          </button>
        )}
      </div>

      {/* ---------------- 1. FUNNEL TAB ---------------- */}
      {activeTab === "funnel" && funnel && (
        <div>
          {/* Top Funnel Metrics */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12, marginBottom: 20 }}>
            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 6, padding: "14px 16px" }}>
              <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Всего заказ-нарядов и заказов</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: "#1e293b" }}>{funnel.total_orders}</div>
            </div>
            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 6, padding: "14px 16px" }}>
              <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Общий объем воронки</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: "#16a34a" }}>{fmtMoney(funnel.total_revenue_tiyin)}</div>
            </div>
            <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 6, padding: "14px 16px" }}>
              <div style={{ fontSize: 12, color: "#166534", marginBottom: 4 }}>Средний чек заказ-наряда</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: "#15803d" }}>{fmtMoney(funnel.avg_check_tiyin)}</div>
            </div>
          </div>

          {/* Visual Funnel Diagram */}
          <div style={{ background: "#fff", border: "1px solid #d9d9d9", borderRadius: 6, padding: 20 }}>
            <h3 style={{ fontSize: 15, fontWeight: 600, margin: "0 0 16px" }}>
              Конверсия движения автомобилей по технологическим этапам
            </h3>

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {funnel.stages.map((st, idx) => {
                const widthPercent = Math.max(12, Math.round((st.count / maxStageCount) * 100));
                return (
                  <div key={st.key} style={{ display: "flex", alignItems: "center", gap: 16 }}>
                    <div style={{ width: 260, fontSize: 13, fontWeight: 600, color: "#334155" }}>
                      {st.name}
                    </div>

                    <div style={{ flex: 1, position: "relative", height: 38, background: "#f1f5f9", borderRadius: 6, overflow: "hidden" }}>
                      <div
                        style={{
                          height: "100%",
                          width: `${widthPercent}%`,
                          background: idx === funnel.stages.length - 1 ? "#16a34a" : "#186999",
                          borderRadius: 6,
                          display: "flex",
                          alignItems: "center",
                          padding: "0 12px",
                          color: "#fff",
                          fontWeight: 700,
                          fontSize: 13,
                          transition: "width 0.4s ease",
                        }}
                      >
                        {st.count} заказов
                      </div>
                    </div>

                    <div style={{ width: 150, textAlign: "right", fontSize: 13, fontWeight: 700, color: "#0f172a" }}>
                      {fmtMoney(st.total_tiyin)}
                    </div>

                    <div style={{ width: 120, textAlign: "right", fontSize: 12, color: "#64748b" }}>
                      Ср. чек: {fmtMoney(st.avg_check_tiyin)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ---------------- 2. PROFITABILITY TAB ---------------- */}
      {activeTab === "profitability" && (
        <div style={{ background: "#fff", border: "1px solid #d9d9d9", borderRadius: 6, overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid #eee", fontSize: 13, color: "#666" }}>
            Рейтинг эффективности мастеров и менеджеров автосервиса: закрытые заказ-наряды, выручка за работы/запчасти и маржинальная прибыль.
          </div>
          <table className="enterprise-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#fafafa", borderBottom: "1px solid #e8e8e8", textAlign: "left" }}>
                <th style={{ padding: "8px 12px" }}>Сотрудник</th>
                <th style={{ padding: "8px 12px" }}>Должность</th>
                <th style={{ padding: "8px 12px", textAlign: "center" }}>Закрыто заказов</th>
                <th style={{ padding: "8px 12px", textAlign: "right" }}>Выручка (работы)</th>
                <th style={{ padding: "8px 12px", textAlign: "right" }}>Выручка (запчасти)</th>
                <th style={{ padding: "8px 12px", textAlign: "right" }}>Общая выручка</th>
                <th style={{ padding: "8px 12px", textAlign: "right", color: "#16a34a" }}>Валовая прибыль</th>
                <th style={{ padding: "8px 12px", textAlign: "center" }}>Рентабельность</th>
              </tr>
            </thead>
            <tbody>
              {managers.map((m) => (
                <tr key={m.user_id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                  <td style={{ padding: "8px 12px", fontWeight: 600 }}>{m.full_name}</td>
                  <td style={{ padding: "8px 12px", color: "#666" }}>{m.position}</td>
                  <td style={{ padding: "8px 12px", textAlign: "center", fontWeight: 700 }}>{m.orders_count}</td>
                  <td style={{ padding: "8px 12px", textAlign: "right" }}>{fmtMoney(m.work_revenue_tiyin)}</td>
                  <td style={{ padding: "8px 12px", textAlign: "right" }}>{fmtMoney(m.parts_revenue_tiyin)}</td>
                  <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 700 }}>{fmtMoney(m.total_revenue_tiyin)}</td>
                  <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 700, color: "#16a34a" }}>
                    {fmtMoney(m.gross_profit_tiyin)}
                  </td>
                  <td style={{ padding: "8px 12px", textAlign: "center" }}>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <div style={{ width: 50, height: 6, background: "#e2e8f0", borderRadius: 3, overflow: "hidden" }}>
                        <div style={{ width: `${Math.min(100, m.margin_percent)}%`, height: "100%", background: "#16a34a" }} />
                      </div>
                      <span style={{ fontWeight: 700, fontSize: 12 }}>{m.margin_percent}%</span>
                    </div>
                  </td>
                </tr>
              ))}
              {!managers.length && (
                <tr>
                  <td colSpan={8} style={{ padding: 36, textAlign: "center", color: "#888" }}>
                    Данных по выработке сотрудников за период не найдено
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
