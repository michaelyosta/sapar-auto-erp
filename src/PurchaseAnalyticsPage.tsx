import { useEffect, useState, useCallback, useMemo } from "react";
import {
  ShoppingCart,
  AlertTriangle,
  RefreshCw,
  Search,
  CheckCircle2,
} from "lucide-react";

interface ProcurementItem {
  id: number;
  code: string;
  name: string;
  unit: string;
  stock_units: number;
  reserved_units: number;
  available_units: number;
  min_stock_units: number;
  shortage_units: number;
  recommended_order_units: number;
  purchase_price_tiyin: number;
  estimated_cost_tiyin: number;
  supplier_id?: number;
  supplier_name: string;
}

interface ProcurementResponse {
  items: ProcurementItem[];
  shortage_count: number;
  total_items: number;
  total_estimated_cost_tiyin: number;
}

function fmtMoney(tiyins: number): string {
  const kzt = tiyins / 100;
  return kzt.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₸";
}

function fmtQty(microUnits: number): string {
  const q = microUnits / 1000000;
  return q.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
}

export default function PurchaseAnalyticsPage({
  onNotify,
  onNavigate,
}: {
  onNotify?: (msg: string) => void;
  onNavigate?: (route: string) => void;
}) {
  const [data, setData] = useState<ProcurementResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [onlyShortage, setOnlyShortage] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [orderQtys, setOrderQtys] = useState<Record<number, number>>({});
  const [createdOrders, setCreatedOrders] = useState<Array<{ id: number; number: string; total_tiyin: number }> | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams();
      if (onlyShortage) q.set("onlyShortage", "true");
      const res = await fetch(`/api/procurement/plan?${q.toString()}`);
      if (!res.ok) throw new Error("Не удалось загрузить план закупок");
      const json: ProcurementResponse = await res.json();
      setData(json);

      // Pre-select shortage items and initialize order quantities
      const initialQtys: Record<number, number> = {};
      const shortageIds: number[] = [];
      for (const it of json.items) {
        initialQtys[it.id] = it.recommended_order_units;
        if (it.shortage_units > 0) shortageIds.push(it.id);
      }
      setOrderQtys(initialQtys);
      setSelectedIds(shortageIds);
    } catch (e) {
      if (onNotify) onNotify(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, [onlyShortage, onNotify]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleQtyChange = (id: number, val: number) => {
    setOrderQtys((prev) => ({ ...prev, [id]: Math.max(0, Math.round(val * 1000000)) }));
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]));
  };

  const toggleSelectAll = (filteredItems: ProcurementItem[]) => {
    const allIds = filteredItems.map((i) => i.id);
    const allSelected = allIds.every((id) => selectedIds.includes(id));
    if (allSelected) {
      setSelectedIds((prev) => prev.filter((id) => !allIds.includes(id)));
    } else {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...allIds])));
    }
  };

  const filteredItems = useMemo(() => {
    if (!data?.items) return [];
    if (!search.trim()) return data.items;
    const term = search.toLowerCase();
    return data.items.filter(
      (it) =>
        it.name.toLowerCase().includes(term) ||
        it.code.toLowerCase().includes(term) ||
        it.supplier_name.toLowerCase().includes(term)
    );
  }, [data, search]);

  // Selected totals
  const selectedSummary = useMemo(() => {
    if (!data?.items) return { count: 0, totalTiyin: 0 };
    let count = 0;
    let totalTiyin = 0;

    for (const it of data.items) {
      if (selectedIds.includes(it.id)) {
        const qty = orderQtys[it.id] ?? it.recommended_order_units;
        if (qty > 0) {
          count += 1;
          totalTiyin += Math.round((qty * it.purchase_price_tiyin) / 1000000);
        }
      }
    }
    return { count, totalTiyin };
  }, [data, selectedIds, orderQtys]);

  const handleCreateOrders = async () => {
    if (!selectedSummary.count) return;
    try {
      const payload = selectedIds
        .map((id) => ({
          productId: id,
          orderUnits: orderQtys[id] ?? 0,
        }))
        .filter((it) => it.orderUnits > 0);

      const res = await fetch("/api/procurement/create-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: payload }),
      });
      const resJson = await res.json();
      if (!res.ok) throw new Error(resJson.error ?? "Ошибка создания заказов");

      setCreatedOrders(resJson.created_orders ?? []);
      if (onNotify) {
        onNotify(`Сформировано заказов поставщикам: ${resJson.created_orders?.length ?? 1}`);
      }
      await loadData();
    } catch (e) {
      if (onNotify) onNotify(e instanceof Error ? e.message : "Ошибка создания заказов");
    }
  };

  return (
    <div className="procurement-page" style={{ padding: "16px 24px", maxWidth: 1400, margin: "0 auto" }}>
      {/* Top Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, color: "#222", margin: "0 0 4px", display: "flex", alignItems: "center", gap: 8 }}>
            <ShoppingCart size={24} color="#186999" />
            Управление закупками (Анализ неснижаемого остатка и автозаказ)
          </h1>
          <p style={{ margin: 0, fontSize: 13, color: "#666" }}>
            Автоматический расчет потребности склада на основе страховых запасов, резервов под заказ-наряды и групповой заказ поставщикам
          </p>
        </div>

        <button
          onClick={() => void loadData()}
          disabled={loading}
          className="button outline"
          style={{ padding: "6px 12px", display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}
        >
          <RefreshCw size={14} className={loading ? "spin" : ""} />
          Обновить расчет
        </button>
      </div>

      {/* KPI Cards */}
      {data && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginBottom: 16 }}>
          <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 6, padding: "12px 16px" }}>
            <div style={{ fontSize: 12, color: "#dc2626", display: "flex", alignItems: "center", gap: 4, marginBottom: 4 }}>
              <AlertTriangle size={15} /> Позиций в дефиците
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: data.shortage_count > 0 ? "#dc2626" : "#16a34a" }}>
              {data.shortage_count} / {data.total_items}
            </div>
          </div>
          <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 6, padding: "12px 16px" }}>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Рекомендуемый объем закупки</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#0f172a" }}>
              {fmtMoney(data.total_estimated_cost_tiyin)}
            </div>
          </div>
          <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 6, padding: "12px 16px" }}>
            <div style={{ fontSize: 12, color: "#166534", marginBottom: 4 }}>Выбрано к заказу в корзине</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#15803d" }}>
              {selectedSummary.count} поз. на {fmtMoney(selectedSummary.totalTiyin)}
            </div>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div
        style={{
          background: "#fff",
          border: "1px solid #d9d9d9",
          borderRadius: 6,
          padding: "10px 16px",
          marginBottom: 14,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div style={{ position: "relative", width: 280 }}>
            <Search size={15} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#888" }} />
            <input
              type="text"
              placeholder="Поиск по номенклатуре, коду, поставщику..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: "100%", padding: "6px 10px 6px 32px", fontSize: 13, border: "1px solid #ccc", borderRadius: 4 }}
            />
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer", color: "#333" }}>
            <input
              type="checkbox"
              checked={onlyShortage}
              onChange={(e) => setOnlyShortage(e.target.checked)}
            />
            Только позиции с дефицитом (ниже неснижаемого остатка)
          </label>
        </div>

        <button
          onClick={() => void handleCreateOrders()}
          disabled={selectedSummary.count === 0}
          className="button action-blue"
          style={{ padding: "8px 16px", fontSize: 13 }}
        >
          <ShoppingCart size={15} style={{ marginRight: 6 }} />
          Сформировать заказы поставщикам ({selectedSummary.count})
        </button>
      </div>

      {/* Table */}
      <div style={{ background: "#fff", border: "1px solid #d9d9d9", borderRadius: 6, overflowX: "auto" }}>
        <table className="enterprise-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "#fafafa", borderBottom: "1px solid #e8e8e8", textAlign: "left" }}>
              <th style={{ padding: "8px 10px", width: 36, textAlign: "center" }}>
                <input
                  type="checkbox"
                  checked={filteredItems.length > 0 && filteredItems.every((i) => selectedIds.includes(i.id))}
                  onChange={() => toggleSelectAll(filteredItems)}
                />
              </th>
              <th style={{ padding: "8px 10px" }}>Код</th>
              <th style={{ padding: "8px 10px", minWidth: 200 }}>Номенклатура</th>
              <th style={{ padding: "8px 10px" }}>Поставщик</th>
              <th style={{ padding: "8px 10px", textAlign: "right" }}>Остаток</th>
              <th style={{ padding: "8px 10px", textAlign: "right" }}>В резерве</th>
              <th style={{ padding: "8px 10px", textAlign: "right" }}>Доступно</th>
              <th style={{ padding: "8px 10px", textAlign: "right" }}>Мин. остаток</th>
              <th style={{ padding: "8px 10px", textAlign: "right", color: "#dc2626" }}>Дефицит</th>
              <th style={{ padding: "8px 10px", textAlign: "center", width: 110 }}>Заказать</th>
              <th style={{ padding: "8px 10px", textAlign: "right" }}>Цена закупки</th>
              <th style={{ padding: "8px 10px", textAlign: "right" }}>Сумма заказа</th>
            </tr>
          </thead>
          <tbody>
            {filteredItems.map((it) => {
              const isSelected = selectedIds.includes(it.id);
              const orderUnitVal = (orderQtys[it.id] ?? it.recommended_order_units) / 1000000;
              const orderSum = Math.round(((orderQtys[it.id] ?? it.recommended_order_units) * it.purchase_price_tiyin) / 1000000);

              return (
                <tr
                  key={it.id}
                  style={{
                    borderBottom: "1px solid #f0f0f0",
                    background: it.shortage_units > 0 ? "#fffcfc" : "#fff",
                  }}
                >
                  <td style={{ padding: "7px 10px", textAlign: "center" }}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelect(it.id)}
                    />
                  </td>
                  <td style={{ padding: "7px 10px", color: "#666" }}>{it.code || "—"}</td>
                  <td style={{ padding: "7px 10px", fontWeight: 500 }}>
                    {it.name} <span style={{ fontSize: 11, color: "#888" }}>({it.unit})</span>
                  </td>
                  <td style={{ padding: "7px 10px", color: "#186999" }}>{it.supplier_name}</td>
                  <td style={{ padding: "7px 10px", textAlign: "right" }}>{fmtQty(it.stock_units)}</td>
                  <td style={{ padding: "7px 10px", textAlign: "right", color: "#666" }}>{fmtQty(it.reserved_units)}</td>
                  <td
                    style={{
                      padding: "7px 10px",
                      textAlign: "right",
                      fontWeight: 600,
                      color: it.available_units <= 0 ? "#dc2626" : "#16a34a",
                    }}
                  >
                    {fmtQty(it.available_units)}
                  </td>
                  <td style={{ padding: "7px 10px", textAlign: "right", color: "#666" }}>{fmtQty(it.min_stock_units)}</td>
                  <td
                    style={{
                      padding: "7px 10px",
                      textAlign: "right",
                      fontWeight: 700,
                      color: it.shortage_units > 0 ? "#dc2626" : "#666",
                    }}
                  >
                    {it.shortage_units > 0 ? `-${fmtQty(it.shortage_units)}` : "—"}
                  </td>
                  <td style={{ padding: "7px 10px", textAlign: "center" }}>
                    <input
                      type="number"
                      step="1"
                      min="0"
                      value={orderUnitVal}
                      onChange={(e) => handleQtyChange(it.id, Number(e.target.value))}
                      style={{
                        width: 70,
                        padding: "3px 6px",
                        textAlign: "center",
                        fontSize: 12,
                        border: "1px solid #ccc",
                        borderRadius: 3,
                        fontWeight: orderUnitVal > 0 ? 600 : 400,
                      }}
                    />
                  </td>
                  <td style={{ padding: "7px 10px", textAlign: "right" }}>{fmtMoney(it.purchase_price_tiyin)}</td>
                  <td style={{ padding: "7px 10px", textAlign: "right", fontWeight: 600, color: "#0f172a" }}>
                    {orderSum > 0 ? fmtMoney(orderSum) : "—"}
                  </td>
                </tr>
              );
            })}
            {!filteredItems.length && (
              <tr>
                <td colSpan={12} style={{ padding: 36, textAlign: "center", color: "#888" }}>
                  {onlyShortage
                    ? "Все товары находятся в пределах нормы (дефицит отсутствует)!"
                    : "Товары не найдены"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Orders Created Success Modal */}
      {createdOrders && (
        <div className="modal-backdrop" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "grid", placeItems: "center", zIndex: 999 }}>
          <div style={{ background: "#fff", width: 480, borderRadius: 8, padding: 20, boxShadow: "0 10px 25px rgba(0,0,0,0.2)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#16a34a", marginBottom: 12 }}>
              <CheckCircle2 size={24} />
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#0f172a" }}>Заказы поставщикам успешно сформированы</h3>
            </div>
            <p style={{ fontSize: 13, color: "#666", margin: "0 0 16px" }}>
              Система автоматически сгруппировала заказанные запчасти по поставщикам и создала черновики заказов:
            </p>
            <div style={{ display: "grid", gap: 8, marginBottom: 20 }}>
              {createdOrders.map((ord) => (
                <div
                  key={ord.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "8px 12px",
                    background: "#f8fafc",
                    border: "1px solid #e2e8f0",
                    borderRadius: 4,
                    fontSize: 13,
                  }}
                >
                  <strong style={{ color: "#186999" }}>Заказ {ord.number}</strong>
                  <span>{fmtMoney(ord.total_tiyin)}</span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button
                onClick={() => setCreatedOrders(null)}
                className="button outline"
              >
                Закрыть
              </button>
              {onNavigate && (
                <button
                  onClick={() => {
                    setCreatedOrders(null);
                    onNavigate("purchaseorder");
                  }}
                  className="button action-blue"
                >
                  Перейти в Заказы поставщикам
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
