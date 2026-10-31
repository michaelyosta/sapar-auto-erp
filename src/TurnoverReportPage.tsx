import { useEffect, useState, useCallback, useMemo } from "react";
import { Package, RefreshCw, Calendar, Search } from "lucide-react";

interface TurnoverItem {
  product_id: number;
  product_name: string;
  product_code: string;
  unit: string;
  initial_units: number;
  initial_value_tiyin: number;
  in_units: number;
  in_value_tiyin: number;
  out_units: number;
  out_value_tiyin: number;
  final_units: number;
  final_value_tiyin: number;
}

interface Warehouse {
  id: number;
  name: string;
}

function fmtMoney(tiyins: number): string {
  const kzt = tiyins / 100;
  return kzt.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₸";
}

function fmtUnits(microUnits: number): string {
  const units = microUnits / 1000000;
  return units.toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 3 });
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

export default function TurnoverReportPage({ onNotify }: { onNotify?: (msg: string) => void }) {
  const [periodPreset, setPeriodPreset] = useState<"all" | "today" | "yesterday" | "week" | "month" | "year">("month");
  const [dateFrom, setDateFrom] = useState(() => getPeriodDates("month").from);
  const [dateTo, setDateTo] = useState(() => getPeriodDates("month").to);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<number | "all">("all");
  const [hideZeroMovements, setHideZeroMovements] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [items, setItems] = useState<TurnoverItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Load warehouses
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/warehouses");
        if (res.ok) {
          const data = await res.json();
          setWarehouses(data);
        }
      } catch {
        // silent fallback
      }
    })();
  }, []);

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
      if (selectedWarehouseId !== "all") q.set("warehouseId", String(selectedWarehouseId));

      const res = await fetch(`/api/reports/turnover?${q.toString()}`);
      if (!res.ok) throw new Error("Не удалось загрузить отчет оборотов");
      const json = await res.json();
      setItems(json.items ?? []);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Ошибка загрузки отчета оборотов";
      setError(msg);
      if (onNotify) onNotify(msg);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, selectedWarehouseId, onNotify]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filteredItems = useMemo(() => {
    return items.filter((it) => {
      if (hideZeroMovements) {
        const hasMovement = it.in_units > 0 || it.out_units > 0;
        if (!hasMovement) return false;
      }
      if (searchQuery.trim()) {
        const term = searchQuery.toLowerCase();
        const matchesName = it.product_name.toLowerCase().includes(term);
        const matchesCode = it.product_code?.toLowerCase().includes(term);
        if (!matchesName && !matchesCode) return false;
      }
      return true;
    });
  }, [items, hideZeroMovements, searchQuery]);

  // Totals
  const totals = useMemo(() => {
    return filteredItems.reduce(
      (acc, it) => {
        acc.initialUnits += it.initial_units;
        acc.initialValue += it.initial_value_tiyin;
        acc.inUnits += it.in_units;
        acc.inValue += it.in_value_tiyin;
        acc.outUnits += it.out_units;
        acc.outValue += it.out_value_tiyin;
        acc.finalUnits += it.final_units;
        acc.finalValue += it.final_value_tiyin;
        return acc;
      },
      {
        initialUnits: 0,
        initialValue: 0,
        inUnits: 0,
        inValue: 0,
        outUnits: 0,
        outValue: 0,
        finalUnits: 0,
        finalValue: 0,
      }
    );
  }, [filteredItems]);

  return (
    <div className="turnover-report-page" style={{ padding: "16px 24px", maxWidth: 1400, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, color: "#222", margin: "0 0 4px", display: "flex", alignItems: "center", gap: 8 }}>
            <Package size={22} color="#1976a5" />
            Обороты товаров (Оборотно-сальдовая ведомость)
          </h1>
          <p style={{ margin: 0, fontSize: 13, color: "#666" }}>
            Движение товарно-материальных ценностей за период в количественном и суммовом выражении
          </p>
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

      {/* Filter Toolbar */}
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

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
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

        {/* Warehouse selector */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
          <span style={{ fontSize: 12, color: "#666" }}>Склад:</span>
          <select
            value={selectedWarehouseId}
            onChange={(e) => setSelectedWarehouseId(e.target.value === "all" ? "all" : Number(e.target.value))}
            style={{ padding: "4px 8px", fontSize: 12, border: "1px solid #ccc", borderRadius: 4 }}
          >
            <option value="all">Все склады</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Sub-bar: Search & Zero-movement Toggle */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 12, flexWrap: "wrap" }}>
        <div style={{ position: "relative", width: 280 }}>
          <Search size={15} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#888" }} />
          <input
            type="text"
            placeholder="Поиск по наименованию или коду..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ width: "100%", padding: "6px 10px 6px 32px", fontSize: 13, border: "1px solid #d9d9d9", borderRadius: 4 }}
          />
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer", color: "#444" }}>
          <input
            type="checkbox"
            checked={hideZeroMovements}
            onChange={(e) => setHideZeroMovements(e.target.checked)}
          />
          Скрывать товары без движения за период
        </label>
      </div>

      {error && (
        <div style={{ padding: "10px 14px", background: "#fde8e8", color: "#c81e1e", borderRadius: 6, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* Multi-level Turnover Table */}
      <div style={{ background: "#fff", border: "1px solid #d9d9d9", borderRadius: 6, overflowX: "auto" }}>
        <table className="enterprise-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "#f4f4f5", borderBottom: "1px solid #d4d4d8", textAlign: "center" }}>
              <th rowSpan={2} style={{ padding: "8px 12px", textAlign: "left", minWidth: 220 }}>Наименование номенклатуры</th>
              <th rowSpan={2} style={{ padding: "8px 8px", width: 80 }}>Код</th>
              <th rowSpan={2} style={{ padding: "8px 8px", width: 50 }}>Ед.</th>
              <th colSpan={2} style={{ padding: "6px 8px", borderLeft: "1px solid #e4e4e7", borderRight: "1px solid #e4e4e7" }}>
                Начальный остаток
              </th>
              <th colSpan={2} style={{ padding: "6px 8px", borderRight: "1px solid #e4e4e7", color: "#16a34a" }}>
                Приход
              </th>
              <th colSpan={2} style={{ padding: "6px 8px", borderRight: "1px solid #e4e4e7", color: "#dc2626" }}>
                Расход
              </th>
              <th colSpan={2} style={{ padding: "6px 8px" }}>
                Конечный остаток
              </th>
            </tr>
            <tr style={{ background: "#fafafa", borderBottom: "2px solid #cbd5e1", textAlign: "right" }}>
              <th style={{ padding: "4px 8px", borderLeft: "1px solid #e4e4e7" }}>Кол-во</th>
              <th style={{ padding: "4px 8px", borderRight: "1px solid #e4e4e7" }}>Сумма</th>
              <th style={{ padding: "4px 8px" }}>Кол-во</th>
              <th style={{ padding: "4px 8px", borderRight: "1px solid #e4e4e7" }}>Сумма</th>
              <th style={{ padding: "4px 8px" }}>Кол-во</th>
              <th style={{ padding: "4px 8px", borderRight: "1px solid #e4e4e7" }}>Сумма</th>
              <th style={{ padding: "4px 8px" }}>Кол-во</th>
              <th style={{ padding: "4px 8px" }}>Сумма</th>
            </tr>
          </thead>
          <tbody>
            {filteredItems.map((it) => (
              <tr key={it.product_id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                <td style={{ padding: "7px 12px", fontWeight: 500, color: "#1e293b" }}>{it.product_name}</td>
                <td style={{ padding: "7px 8px", color: "#64748b", textAlign: "center" }}>{it.product_code || "—"}</td>
                <td style={{ padding: "7px 8px", color: "#64748b", textAlign: "center" }}>{it.unit || "шт"}</td>

                {/* Начальный */}
                <td style={{ padding: "7px 8px", textAlign: "right", borderLeft: "1px solid #f1f5f9" }}>
                  {fmtUnits(it.initial_units)}
                </td>
                <td style={{ padding: "7px 8px", textAlign: "right", borderRight: "1px solid #f1f5f9", color: "#64748b" }}>
                  {fmtMoney(it.initial_value_tiyin)}
                </td>

                {/* Приход */}
                <td style={{ padding: "7px 8px", textAlign: "right", color: it.in_units > 0 ? "#16a34a" : "#64748b" }}>
                  {fmtUnits(it.in_units)}
                </td>
                <td style={{ padding: "7px 8px", textAlign: "right", borderRight: "1px solid #f1f5f9", color: it.in_units > 0 ? "#16a34a" : "#64748b" }}>
                  {fmtMoney(it.in_value_tiyin)}
                </td>

                {/* Расход */}
                <td style={{ padding: "7px 8px", textAlign: "right", color: it.out_units > 0 ? "#dc2626" : "#64748b" }}>
                  {fmtUnits(it.out_units)}
                </td>
                <td style={{ padding: "7px 8px", textAlign: "right", borderRight: "1px solid #f1f5f9", color: it.out_units > 0 ? "#dc2626" : "#64748b" }}>
                  {fmtMoney(it.out_value_tiyin)}
                </td>

                {/* Конечный */}
                <td style={{ padding: "7px 8px", textAlign: "right", fontWeight: 600 }}>
                  {fmtUnits(it.final_units)}
                </td>
                <td style={{ padding: "7px 8px", textAlign: "right", fontWeight: 600, color: "#0f172a" }}>
                  {fmtMoney(it.final_value_tiyin)}
                </td>
              </tr>
            ))}

            {!filteredItems.length && (
              <tr>
                <td colSpan={11} style={{ padding: 32, textAlign: "center", color: "#888" }}>
                  Позиций по выбранным критериям не найдено
                </td>
              </tr>
            )}
          </tbody>
          {filteredItems.length > 0 && (
            <tfoot>
              <tr style={{ background: "#f8fafc", borderTop: "2px solid #cbd5e1", fontWeight: 700 }}>
                <td colSpan={3} style={{ padding: "8px 12px", textAlign: "right" }}>ИТОГО ПО СКЛАДУ:</td>
                <td style={{ padding: "8px 8px", textAlign: "right", borderLeft: "1px solid #e2e8f0" }}>{fmtUnits(totals.initialUnits)}</td>
                <td style={{ padding: "8px 8px", textAlign: "right", borderRight: "1px solid #e2e8f0" }}>{fmtMoney(totals.initialValue)}</td>
                <td style={{ padding: "8px 8px", textAlign: "right", color: "#16a34a" }}>{fmtUnits(totals.inUnits)}</td>
                <td style={{ padding: "8px 8px", textAlign: "right", borderRight: "1px solid #e2e8f0", color: "#16a34a" }}>{fmtMoney(totals.inValue)}</td>
                <td style={{ padding: "8px 8px", textAlign: "right", color: "#dc2626" }}>{fmtUnits(totals.outUnits)}</td>
                <td style={{ padding: "8px 8px", textAlign: "right", borderRight: "1px solid #e2e8f0", color: "#dc2626" }}>{fmtMoney(totals.outValue)}</td>
                <td style={{ padding: "8px 8px", textAlign: "right" }}>{fmtUnits(totals.finalUnits)}</td>
                <td style={{ padding: "8px 8px", textAlign: "right", color: "#0f172a" }}>{fmtMoney(totals.finalValue)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
