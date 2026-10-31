import { useEffect, useState, useCallback } from "react";
import {
  Banknote,
  Users,
  Calculator,
  CheckCircle2,
  Wrench,
  RefreshCw,
  X,
} from "lucide-react";

interface PayrollSheet {
  id: number;
  number: string;
  period_month: string;
  date: string;
  status: "draft" | "calculated" | "paid";
  total_accrued_tiyin: number;
  total_paid_tiyin: number;
  employees_count: number;
  comment?: string;
}

interface PayrollLine {
  id: number;
  employee_id: number;
  employee_name: string;
  employee_login: string;
  employee_position: string;
  base_salary_tiyin: number;
  work_orders_count: number;
  work_revenue_tiyin: number;
  work_accrual_tiyin: number;
  parts_revenue_tiyin: number;
  parts_accrual_tiyin: number;
  bonus_tiyin: number;
  deduction_tiyin: number;
  total_tiyin: number;
  paid_tiyin: number;
  status: string;
}

interface EmployeeRate {
  id: number;
  login: string;
  full_name: string;
  position: string;
  labor_rate_percent: number;
  parts_rate_percent: number;
  base_salary_tiyin: number;
  phone: string;
}

interface PerformanceData {
  employee: EmployeeRate;
  period: string;
  orders_count: number;
  total_work_revenue_tiyin: number;
  total_parts_revenue_tiyin: number;
  work_accrual_tiyin: number;
  parts_accrual_tiyin: number;
  base_salary_tiyin: number;
  total_earnings_tiyin: number;
  orders: Array<{
    id: number;
    number: string;
    date: string;
    total_tiyin: number;
    counterparty_name?: string;
    vehicle_plate?: string;
    make?: string;
    model?: string;
    work_revenue_tiyin: number;
    parts_revenue_tiyin: number;
    lines_count: number;
  }>;
}

function fmtMoney(tiyins: number): string {
  const kzt = tiyins / 100;
  return kzt.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₸";
}

export default function PayrollPage({ onNotify }: { onNotify?: (msg: string) => void }) {
  const [activeTab, setActiveTab] = useState<"sheets" | "rates" | "performance">("sheets");
  const [sheets, setSheets] = useState<PayrollSheet[]>([]);
  const [selectedSheet, setSelectedSheet] = useState<{ sheet: PayrollSheet; lines: PayrollLine[] } | null>(null);
  const [employees, setEmployees] = useState<EmployeeRate[]>([]);
  const [selectedEmpId, setSelectedEmpId] = useState<number | null>(null);
  const [performance, setPerformance] = useState<PerformanceData | null>(null);
  const [perfPeriod, setPerfPeriod] = useState(() =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty" }).format(new Date()).slice(0, 7)
  );

  const [loading, setLoading] = useState(false);
  const [calcModalOpen, setCalcModalOpen] = useState(false);
  const [calcMonth, setCalcMonth] = useState(() =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty" }).format(new Date()).slice(0, 7)
  );
  const [editingEmp, setEditingEmp] = useState<EmployeeRate | null>(null);
  const [payModalSheet, setPayModalSheet] = useState<PayrollSheet | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "bank">("cash");

  // Load sheets
  const loadSheets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/payroll/sheets");
      if (res.ok) setSheets(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  // Load employees
  const loadEmployees = useCallback(async () => {
    try {
      const res = await fetch("/api/payroll/employees");
      if (res.ok) {
        const data = await res.json();
        setEmployees(data);
        if (data.length > 0 && selectedEmpId === null) {
          setSelectedEmpId(data[0].id);
        }
      }
    } catch {
      // silent
    }
  }, [selectedEmpId]);

  // Load performance
  const loadPerformance = useCallback(async () => {
    if (!selectedEmpId) return;
    try {
      const res = await fetch(`/api/payroll/employees/${selectedEmpId}/performance?period=${perfPeriod}`);
      if (res.ok) setPerformance(await res.json());
    } catch {
      // silent
    }
  }, [selectedEmpId, perfPeriod]);

  useEffect(() => {
    void loadSheets();
    void loadEmployees();
  }, [loadSheets, loadEmployees]);

  useEffect(() => {
    if (activeTab === "performance" && selectedEmpId) {
      void loadPerformance();
    }
  }, [activeTab, selectedEmpId, perfPeriod, loadPerformance]);

  const openSheetDetail = async (id: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/payroll/sheets/${id}`);
      if (!res.ok) throw new Error("Не удалось загрузить ведомость");
      const data = await res.json();
      setSelectedSheet({ sheet: data, lines: data.lines });
    } catch (e) {
      if (onNotify) onNotify(e instanceof Error ? e.message : "Ошибка загрузки ведомости");
    } finally {
      setLoading(false);
    }
  };

  const handleCalculate = async () => {
    try {
      const res = await fetch("/api/payroll/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period_month: calcMonth }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Ошибка расчета");
      if (onNotify) onNotify(`Ведомость ${data.number} успешно рассчитана!`);
      setCalcModalOpen(false);
      await loadSheets();
      await openSheetDetail(data.id);
    } catch (e) {
      if (onNotify) onNotify(e instanceof Error ? e.message : "Ошибка расчета зарплаты");
    }
  };

  const handlePay = async () => {
    if (!payModalSheet) return;
    try {
      const res = await fetch(`/api/payroll/sheets/${payModalSheet.id}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentMethod }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Ошибка проведения выплаты");
      if (onNotify) onNotify(data.message ?? "Зарплата успешно выплачена!");
      setPayModalSheet(null);
      await loadSheets();
      if (selectedSheet?.sheet.id === payModalSheet.id) {
        await openSheetDetail(payModalSheet.id);
      }
    } catch (e) {
      if (onNotify) onNotify(e instanceof Error ? e.message : "Ошибка выплаты зарплаты");
    }
  };

  const handleSaveRates = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEmp) return;
    try {
      const res = await fetch(`/api/payroll/employees/${editingEmp.id}/rates`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          position: editingEmp.position,
          labor_rate_percent: editingEmp.labor_rate_percent,
          parts_rate_percent: editingEmp.parts_rate_percent,
          base_salary_tiyin: editingEmp.base_salary_tiyin,
          phone: editingEmp.phone,
        }),
      });
      if (!res.ok) throw new Error("Не удалось сохранить ставки");
      if (onNotify) onNotify(`Ставки сотрудника ${editingEmp.full_name} сохранены!`);
      setEditingEmp(null);
      await loadEmployees();
    } catch (err) {
      if (onNotify) onNotify(err instanceof Error ? err.message : "Ошибка сохранения ставок");
    }
  };

  return (
    <div className="payroll-page" style={{ padding: "16px 24px", maxWidth: 1400, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, color: "#222", margin: "0 0 6px", display: "flex", alignItems: "center", gap: 8 }}>
            <Banknote size={24} color="#186999" />
            Начисления зарплаты (Сдельная оплата мастеров)
          </h1>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => { setActiveTab("sheets"); setSelectedSheet(null); }}
              className={`button ${activeTab === "sheets" ? "primary" : "outline"}`}
              style={{ padding: "6px 14px", fontSize: 13 }}
            >
              Расчетные ведомости
            </button>
            <button
              onClick={() => setActiveTab("rates")}
              className={`button ${activeTab === "rates" ? "primary" : "outline"}`}
              style={{ padding: "6px 14px", fontSize: 13 }}
            >
              <Users size={14} style={{ marginRight: 6 }} />
              Сотрудники и ставки
            </button>
            <button
              onClick={() => setActiveTab("performance")}
              className={`button ${activeTab === "performance" ? "primary" : "outline"}`}
              style={{ padding: "6px 14px", fontSize: 13 }}
            >
              <Wrench size={14} style={{ marginRight: 6 }} />
              Выработка мастера
            </button>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => setCalcModalOpen(true)}
            className="button action-blue"
            style={{ padding: "6px 14px", fontSize: 13 }}
          >
            <Calculator size={15} style={{ marginRight: 6 }} />
            Рассчитать зарплату за месяц
          </button>
          <button
            onClick={() => void loadSheets()}
            disabled={loading}
            className="button outline"
            style={{ padding: "6px 12px", fontSize: 13 }}
          >
            <RefreshCw size={14} className={loading ? "spin" : ""} />
          </button>
        </div>
      </div>

      {/* ---------------- 1. SHEETS TAB ---------------- */}
      {activeTab === "sheets" && !selectedSheet && (
        <div style={{ background: "#fff", border: "1px solid #d9d9d9", borderRadius: 6, overflow: "hidden" }}>
          <table className="enterprise-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#fafafa", borderBottom: "1px solid #e8e8e8", textAlign: "left" }}>
                <th style={{ padding: "8px 12px" }}>Номер</th>
                <th style={{ padding: "8px 12px" }}>Период</th>
                <th style={{ padding: "8px 12px" }}>Дата создания</th>
                <th style={{ padding: "8px 12px" }}>Статус</th>
                <th style={{ padding: "8px 12px", textAlign: "center" }}>Сотрудников</th>
                <th style={{ padding: "8px 12px", textAlign: "right" }}>Начислено</th>
                <th style={{ padding: "8px 12px", textAlign: "right" }}>Выплачено</th>
                <th style={{ padding: "8px 12px", textAlign: "center" }}>Действия</th>
              </tr>
            </thead>
            <tbody>
              {sheets.map((s) => (
                <tr key={s.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                  <td style={{ padding: "8px 12px", fontWeight: 600 }}>
                    <button
                      className="link-button"
                      onClick={() => void openSheetDetail(s.id)}
                      style={{ color: "#186999", textDecoration: "none", cursor: "pointer" }}
                    >
                      {s.number}
                    </button>
                  </td>
                  <td style={{ padding: "8px 12px", color: "#333" }}>{s.period_month}</td>
                  <td style={{ padding: "8px 12px", color: "#666" }}>{s.date}</td>
                  <td style={{ padding: "8px 12px" }}>
                    <span
                      style={{
                        padding: "2px 8px",
                        borderRadius: 12,
                        fontSize: 11,
                        fontWeight: 600,
                        background: s.status === "paid" ? "#dcfce7" : "#e0f2fe",
                        color: s.status === "paid" ? "#15803d" : "#0369a1",
                      }}
                    >
                      {s.status === "paid" ? "Выплачена" : "Рассчитана"}
                    </span>
                  </td>
                  <td style={{ padding: "8px 12px", textAlign: "center", color: "#666" }}>{s.employees_count}</td>
                  <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 700, color: "#0f172a" }}>
                    {fmtMoney(s.total_accrued_tiyin)}
                  </td>
                  <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 600, color: s.total_paid_tiyin > 0 ? "#16a34a" : "#666" }}>
                    {fmtMoney(s.total_paid_tiyin)}
                  </td>
                  <td style={{ padding: "8px 12px", textAlign: "center" }}>
                    {s.status !== "paid" ? (
                      <button
                        onClick={() => setPayModalSheet(s)}
                        className="button primary"
                        style={{ padding: "3px 10px", fontSize: 11, background: "#16a34a" }}
                      >
                        Выплатить
                      </button>
                    ) : (
                      <span style={{ fontSize: 11, color: "#15803d", display: "inline-flex", alignItems: "center", gap: 3 }}>
                        <CheckCircle2 size={13} /> Оплачено
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {!sheets.length && (
                <tr>
                  <td colSpan={8} style={{ padding: 36, textAlign: "center", color: "#888" }}>
                    Ведомостей пока нет. Нажмите «Рассчитать зарплату за месяц», чтобы автоматически сформировать начисления по заказ-нарядам.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ---------------- 1B. SHEET DETAIL MODAL / VIEW ---------------- */}
      {activeTab === "sheets" && selectedSheet && (
        <div style={{ background: "#fff", border: "1px solid #d9d9d9", borderRadius: 6, padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, borderBottom: "1px solid #eee", paddingBottom: 12 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button className="link-button" onClick={() => setSelectedSheet(null)} style={{ fontSize: 13, color: "#666" }}>
                  ← Назад к ведомостям
                </button>
                <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>{selectedSheet.sheet.number} ({selectedSheet.sheet.period_month})</h2>
                <span
                  style={{
                    padding: "2px 8px",
                    borderRadius: 12,
                    fontSize: 11,
                    fontWeight: 600,
                    background: selectedSheet.sheet.status === "paid" ? "#dcfce7" : "#e0f2fe",
                    color: selectedSheet.sheet.status === "paid" ? "#15803d" : "#0369a1",
                  }}
                >
                  {selectedSheet.sheet.status === "paid" ? "Выплачена" : "Рассчитана"}
                </span>
              </div>
              <p style={{ margin: "4px 0 0", fontSize: 12, color: "#666" }}>
                Сумма к начислению: <strong>{fmtMoney(selectedSheet.sheet.total_accrued_tiyin)}</strong> | Выплачено: <strong>{fmtMoney(selectedSheet.sheet.total_paid_tiyin)}</strong>
              </p>
            </div>

            {selectedSheet.sheet.status !== "paid" && (
              <button
                onClick={() => setPayModalSheet(selectedSheet.sheet)}
                className="button primary"
                style={{ padding: "6px 14px", fontSize: 13, background: "#16a34a" }}
              >
                Выплатить всем сотрудникам
              </button>
            )}
          </div>

          <table className="enterprise-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#fafafa", borderBottom: "1px solid #e8e8e8", textAlign: "left" }}>
                <th style={{ padding: "8px 10px" }}>Сотрудник</th>
                <th style={{ padding: "8px 10px" }}>Должность</th>
                <th style={{ padding: "8px 10px", textAlign: "right" }}>Оклад</th>
                <th style={{ padding: "8px 10px", textAlign: "center" }}>Заказ-нарядов</th>
                <th style={{ padding: "8px 10px", textAlign: "right" }}>Выручка (работы)</th>
                <th style={{ padding: "8px 10px", textAlign: "right", color: "#186999" }}>Начислено (% работ)</th>
                <th style={{ padding: "8px 10px", textAlign: "right" }}>Выручка (запчасти)</th>
                <th style={{ padding: "8px 10px", textAlign: "right", color: "#186999" }}>Начислено (% деталей)</th>
                <th style={{ padding: "8px 10px", textAlign: "right", fontWeight: 700 }}>ИТОГО К ВЫПЛАТЕ</th>
              </tr>
            </thead>
            <tbody>
              {selectedSheet.lines.map((l) => (
                <tr key={l.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                  <td style={{ padding: "8px 10px", fontWeight: 600 }}>{l.employee_name}</td>
                  <td style={{ padding: "8px 10px", color: "#666" }}>{l.employee_position || "Специалист"}</td>
                  <td style={{ padding: "8px 10px", textAlign: "right" }}>{fmtMoney(l.base_salary_tiyin)}</td>
                  <td style={{ padding: "8px 10px", textAlign: "center", fontWeight: 600 }}>{l.work_orders_count}</td>
                  <td style={{ padding: "8px 10px", textAlign: "right" }}>{fmtMoney(l.work_revenue_tiyin)}</td>
                  <td style={{ padding: "8px 10px", textAlign: "right", color: "#186999", fontWeight: 600 }}>
                    +{fmtMoney(l.work_accrual_tiyin)}
                  </td>
                  <td style={{ padding: "8px 10px", textAlign: "right" }}>{fmtMoney(l.parts_revenue_tiyin)}</td>
                  <td style={{ padding: "8px 10px", textAlign: "right", color: "#186999", fontWeight: 600 }}>
                    +{fmtMoney(l.parts_accrual_tiyin)}
                  </td>
                  <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 800, color: "#0f172a", fontSize: 13 }}>
                    {fmtMoney(l.total_tiyin)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ---------------- 2. RATES TAB ---------------- */}
      {activeTab === "rates" && (
        <div style={{ background: "#fff", border: "1px solid #d9d9d9", borderRadius: 6, overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid #eee", fontSize: 13, color: "#666" }}>
            Настройка системы мотивации персонала автосервиса: проценты за работы, проценты за проданные запчасти и базовые оклады.
          </div>
          <table className="enterprise-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#fafafa", borderBottom: "1px solid #e8e8e8", textAlign: "left" }}>
                <th style={{ padding: "8px 12px" }}>ФИО сотрудника</th>
                <th style={{ padding: "8px 12px" }}>Логин</th>
                <th style={{ padding: "8px 12px" }}>Должность</th>
                <th style={{ padding: "8px 12px", textAlign: "right" }}>% за выполненные работы</th>
                <th style={{ padding: "8px 12px", textAlign: "right" }}>% за проданные запчасти</th>
                <th style={{ padding: "8px 12px", textAlign: "right" }}>Фиксированный оклад</th>
                <th style={{ padding: "8px 12px", textAlign: "center" }}>Действия</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((emp) => (
                <tr key={emp.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                  <td style={{ padding: "8px 12px", fontWeight: 600 }}>{emp.full_name}</td>
                  <td style={{ padding: "8px 12px", color: "#666" }}>{emp.login}</td>
                  <td style={{ padding: "8px 12px" }}>{emp.position || "Мастер"}</td>
                  <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 600, color: "#186999" }}>
                    {emp.labor_rate_percent}%
                  </td>
                  <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 600, color: "#186999" }}>
                    {emp.parts_rate_percent}%
                  </td>
                  <td style={{ padding: "8px 12px", textAlign: "right" }}>{fmtMoney(emp.base_salary_tiyin)}</td>
                  <td style={{ padding: "8px 12px", textAlign: "center" }}>
                    <button
                      onClick={() => setEditingEmp({ ...emp })}
                      className="button outline"
                      style={{ padding: "2px 8px", fontSize: 12 }}
                    >
                      Изменить ставки
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ---------------- 3. PERFORMANCE TAB ---------------- */}
      {activeTab === "performance" && (
        <div>
          {/* Top selection bar */}
          <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16, background: "#fff", padding: "10px 16px", borderRadius: 6, border: "1px solid #d9d9d9", flexWrap: "wrap" }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: "#444" }}>Сотрудник:</label>
            <select
              value={selectedEmpId ?? ""}
              onChange={(e) => setSelectedEmpId(Number(e.target.value))}
              style={{ padding: "4px 10px", fontSize: 13, borderRadius: 4, border: "1px solid #ccc" }}
            >
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.full_name} ({emp.position || "Специалист"})
                </option>
              ))}
            </select>

            <label style={{ fontSize: 13, fontWeight: 600, color: "#444", marginLeft: 12 }}>Месяц:</label>
            <input
              type="month"
              value={perfPeriod}
              onChange={(e) => setPerfPeriod(e.target.value)}
              style={{ padding: "4px 8px", fontSize: 13, borderRadius: 4, border: "1px solid #ccc" }}
            />
          </div>

          {/* Performance Summary Cards */}
          {performance && (
            <div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginBottom: 16 }}>
                <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 6, padding: "12px 16px" }}>
                  <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Закрытых заказ-нарядов</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: "#1e293b" }}>{performance.orders_count}</div>
                </div>
                <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 6, padding: "12px 16px" }}>
                  <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Выручка за работы</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: "#1e293b" }}>{fmtMoney(performance.total_work_revenue_tiyin)}</div>
                  <div style={{ fontSize: 11, color: "#186999", marginTop: 4 }}>
                    Начислено ({performance.employee.labor_rate_percent}%): <strong>+{fmtMoney(performance.work_accrual_tiyin)}</strong>
                  </div>
                </div>
                <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 6, padding: "12px 16px" }}>
                  <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Выручка за запчасти</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: "#1e293b" }}>{fmtMoney(performance.total_parts_revenue_tiyin)}</div>
                  <div style={{ fontSize: 11, color: "#186999", marginTop: 4 }}>
                    Начислено ({performance.employee.parts_rate_percent}%): <strong>+{fmtMoney(performance.parts_accrual_tiyin)}</strong>
                  </div>
                </div>
                <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 6, padding: "12px 16px" }}>
                  <div style={{ fontSize: 12, color: "#166534", marginBottom: 4 }}>ИТОГО ЗАРАБОТОК МАСТЕРА</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: "#15803d" }}>{fmtMoney(performance.total_earnings_tiyin)}</div>
                  <div style={{ fontSize: 11, color: "#166534", marginTop: 4 }}>Включая оклад: {fmtMoney(performance.base_salary_tiyin)}</div>
                </div>
              </div>

              {/* Table of Orders */}
              <div style={{ background: "#fff", border: "1px solid #d9d9d9", borderRadius: 6, overflow: "hidden" }}>
                <div style={{ padding: "10px 16px", borderBottom: "1px solid #eee", fontWeight: 600, fontSize: 13 }}>
                  Закрытые заказ-наряды мастера за {perfPeriod}
                </div>
                <table className="enterprise-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: "#fafafa", borderBottom: "1px solid #e8e8e8", textAlign: "left" }}>
                      <th style={{ padding: "8px 12px" }}>Заказ-наряд</th>
                      <th style={{ padding: "8px 12px" }}>Дата</th>
                      <th style={{ padding: "8px 12px" }}>Автомобиль</th>
                      <th style={{ padding: "8px 12px" }}>Клиент</th>
                      <th style={{ padding: "8px 12px", textAlign: "right" }}>Работы (₸)</th>
                      <th style={{ padding: "8px 12px", textAlign: "right" }}>Запчасти (₸)</th>
                      <th style={{ padding: "8px 12px", textAlign: "right" }}>Сумма заказ-наряда</th>
                    </tr>
                  </thead>
                  <tbody>
                    {performance.orders.map((o) => (
                      <tr key={o.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                        <td style={{ padding: "8px 12px", fontWeight: 600, color: "#186999" }}>{o.number}</td>
                        <td style={{ padding: "8px 12px", color: "#666" }}>{o.date}</td>
                        <td style={{ padding: "8px 12px" }}>
                          {o.vehicle_plate ? `${o.vehicle_plate} (${o.make || ""} ${o.model || ""})` : "—"}
                        </td>
                        <td style={{ padding: "8px 12px" }}>{o.counterparty_name || "—"}</td>
                        <td style={{ padding: "8px 12px", textAlign: "right", color: "#186999", fontWeight: 600 }}>
                          {fmtMoney(o.work_revenue_tiyin)}
                        </td>
                        <td style={{ padding: "8px 12px", textAlign: "right" }}>{fmtMoney(o.parts_revenue_tiyin)}</td>
                        <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 700 }}>{fmtMoney(o.total_tiyin)}</td>
                      </tr>
                    ))}
                    {!performance.orders.length && (
                      <tr>
                        <td colSpan={7} style={{ padding: 28, textAlign: "center", color: "#888" }}>
                          За выбранный месяц закрытых заказ-нарядов не обнаружено
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---------------- CALCULATION MODAL ---------------- */}
      {calcModalOpen && (
        <div className="modal-backdrop" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "grid", placeItems: "center", zIndex: 999 }}>
          <div style={{ background: "#fff", width: 440, borderRadius: 8, padding: 20, boxShadow: "0 10px 25px rgba(0,0,0,0.2)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Расчет зарплаты за месяц</h3>
              <button onClick={() => setCalcModalOpen(false)} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
            </div>
            <p style={{ fontSize: 13, color: "#666", lineHeight: 1.4, margin: "0 0 16px" }}>
              Система автоматически проверит все закрытые заказ-наряды за выбранный месяц, рассчитает сдельную выработку по нормативам каждого мастера и сформирует ведомость начислений.
            </p>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Выберите расчетный месяц:</label>
            <input
              type="month"
              value={calcMonth}
              onChange={(e) => setCalcMonth(e.target.value)}
              style={{ width: "100%", padding: "8px 12px", fontSize: 14, border: "1px solid #ccc", borderRadius: 4, marginBottom: 20 }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button onClick={() => setCalcModalOpen(false)} className="button outline">Отмена</button>
              <button onClick={() => void handleCalculate()} className="button action-blue">
                <Calculator size={15} style={{ marginRight: 6 }} /> Рассчитать
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- PAY MODAL ---------------- */}
      {payModalSheet && (
        <div className="modal-backdrop" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "grid", placeItems: "center", zIndex: 999 }}>
          <div style={{ background: "#fff", width: 440, borderRadius: 8, padding: 20, boxShadow: "0 10px 25px rgba(0,0,0,0.2)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Выплата зарплаты</h3>
              <button onClick={() => setPayModalSheet(null)} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
            </div>
            <p style={{ fontSize: 13, color: "#333", margin: "0 0 12px" }}>
              Ведомость: <strong>{payModalSheet.number}</strong> ({payModalSheet.period_month})
            </p>
            <p style={{ fontSize: 14, fontWeight: 700, color: "#16a34a", margin: "0 0 16px" }}>
              Сумма к выплате: {fmtMoney(payModalSheet.total_accrued_tiyin)}
            </p>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Способ выплаты:</label>
            <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
                <input
                  type="radio"
                  name="payMethod"
                  value="cash"
                  checked={paymentMethod === "cash"}
                  onChange={() => setPaymentMethod("cash")}
                />
                Наличные (через РКО)
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
                <input
                  type="radio"
                  name="payMethod"
                  value="bank"
                  checked={paymentMethod === "bank"}
                  onChange={() => setPaymentMethod("bank")}
                />
                Безналично (на карты)
              </label>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button onClick={() => setPayModalSheet(null)} className="button outline">Отмена</button>
              <button onClick={() => void handlePay()} className="button primary" style={{ background: "#16a34a" }}>
                Подтвердить выплату
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- EDIT RATES MODAL ---------------- */}
      {editingEmp && (
        <div className="modal-backdrop" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "grid", placeItems: "center", zIndex: 999 }}>
          <form onSubmit={handleSaveRates} style={{ background: "#fff", width: 480, borderRadius: 8, padding: 20, boxShadow: "0 10px 25px rgba(0,0,0,0.2)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Ставки сотрудника: {editingEmp.full_name}</h3>
              <button type="button" onClick={() => setEditingEmp(null)} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
            </div>

            <div style={{ display: "grid", gap: 12, marginBottom: 20 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Должность:</label>
                <input
                  type="text"
                  value={editingEmp.position || ""}
                  onChange={(e) => setEditingEmp({ ...editingEmp, position: e.target.value })}
                  style={{ width: "100%", padding: "6px 10px", fontSize: 13, border: "1px solid #ccc", borderRadius: 4 }}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>% за работы:</label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    max="100"
                    value={editingEmp.labor_rate_percent}
                    onChange={(e) => setEditingEmp({ ...editingEmp, labor_rate_percent: Number(e.target.value) })}
                    style={{ width: "100%", padding: "6px 10px", fontSize: 13, border: "1px solid #ccc", borderRadius: 4 }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>% за запчасти:</label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    max="100"
                    value={editingEmp.parts_rate_percent}
                    onChange={(e) => setEditingEmp({ ...editingEmp, parts_rate_percent: Number(e.target.value) })}
                    style={{ width: "100%", padding: "6px 10px", fontSize: 13, border: "1px solid #ccc", borderRadius: 4 }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Базовый оклад (₸):</label>
                <input
                  type="number"
                  step="1000"
                  min="0"
                  value={editingEmp.base_salary_tiyin / 100}
                  onChange={(e) => setEditingEmp({ ...editingEmp, base_salary_tiyin: Math.round(Number(e.target.value) * 100) })}
                  style={{ width: "100%", padding: "6px 10px", fontSize: 13, border: "1px solid #ccc", borderRadius: 4 }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Телефон:</label>
                <input
                  type="text"
                  value={editingEmp.phone || ""}
                  onChange={(e) => setEditingEmp({ ...editingEmp, phone: e.target.value })}
                  style={{ width: "100%", padding: "6px 10px", fontSize: 13, border: "1px solid #ccc", borderRadius: 4 }}
                />
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button type="button" onClick={() => setEditingEmp(null)} className="button outline">Отмена</button>
              <button type="submit" className="button action-blue">Сохранить ставки</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
