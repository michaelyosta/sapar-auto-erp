import { useEffect, useState, useMemo, type FormEvent } from "react";
import { Store, ShoppingCart, Clock, Plus, Check, Search, CreditCard, Banknote, User, CarFront, FileText } from "lucide-react";
import { useAuth } from "./AuthGate";

type RetailStore = {
  id: number;
  name: string;
  code: string;
  warehouse_id: number;
  warehouse_name?: string;
  active: number;
  price_type: string;
  allow_free_price: number;
  allow_discounts: number;
  auto_pko_on_shift_close: number;
  auto_payment_on_shift_close: number;
  card_fee_bps: number;
  active_shift_id?: number | null;
  active_shift_number?: number | null;
  active_shift_opened_at?: string | null;
};

type RetailShift = {
  id: number;
  shift_number: number;
  retail_store_id: number;
  store_name?: string;
  status: "open" | "closed";
  opened_at: string;
  closed_at?: string | null;
  cash_start_tiyin: number;
  revenue_cash_tiyin: number;
  revenue_card_tiyin: number;
  revenue_total_tiyin: number;
  cashier_name?: string;
};

type RetailSaleDoc = {
  id: number;
  number: string;
  date: string;
  status: string;
  counterparty_name?: string;
  warehouse_name?: string;
  total_tiyin: number;
  payment_method: string;
  line_count?: number;
};

type Product = {
  id: number;
  name: string;
  code: string;
  unit: string;
  sale_price_tiyin: number;
};

type Counterparty = {
  id: number;
  name: string;
  phone: string;
};

type Vehicle = {
  id: number;
  counterparty_id: number;
  plate: string;
  make: string;
  model: string;
  current_mileage: number;
};

type CartItem = {
  productId: number;
  name: string;
  code: string;
  unit: string;
  quantity: number;
  price: number; // in KZT
  discountPercent: number;
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error ?? "Ошибка запроса") as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return data as T;
}

const money = (tiyin: number = 0) =>
  new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(tiyin) / 100);

export default function RetailPage({
  initialSubTab = "terminal",
  onNotify,
}: {
  initialSubTab?: "terminal" | "stores" | "shifts" | "sales" | "returns";
  onNotify: (msg: string) => void;
}) {
  const { user } = useAuth();
  const editable = user.role !== "employee";

  const [subTab, setSubTab] = useState<"terminal" | "stores" | "shifts" | "sales" | "returns">(initialSubTab);
  const [stores, setStores] = useState<RetailStore[]>([]);
  const [shifts, setShifts] = useState<RetailShift[]>([]);
  const [sales, setSales] = useState<RetailSaleDoc[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Counterparty[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Terminal active store & shift
  const [selectedStoreId, setSelectedStoreId] = useState<number | null>(null);

  // Modals
  const [openShiftModal, setOpenShiftModal] = useState(false);
  const [closeShiftConfirm, setCloseShiftConfirm] = useState<RetailShift | null>(null);
  const [storeModal, setStoreModal] = useState(false);
  const [savingShift, setSavingShift] = useState(false);

  // Cart / POS state
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const [selectedVehicleId, setSelectedVehicleId] = useState<number | null>(null);
  const [odometerKm, setOdometerKm] = useState<string>("");
  const [productSearch, setProductSearch] = useState("");
  const [cashAmount, setCashAmount] = useState<string>("");
  const [cardAmount, setCardAmount] = useState<string>("");
  const [processingSale, setProcessingSale] = useState(false);

  const activeStore = useMemo(() => stores.find((s) => s.id === selectedStoreId) ?? stores[0] ?? null, [stores, selectedStoreId]);
  const activeShift = useMemo(() => shifts.find((sh) => sh.retail_store_id === activeStore?.id && sh.status === "open") ?? null, [shifts, activeStore]);

  const customerVehicles = useMemo(
    () => (selectedCustomerId ? vehicles.filter((v) => v.counterparty_id === selectedCustomerId) : []),
    [selectedCustomerId, vehicles]
  );

  const loadAll = async () => {
    setLoading(true);
    try {
      const [st, sh, sl, pr, cp, vh] = await Promise.all([
        request<RetailStore[]>("/api/retail/stores"),
        request<RetailShift[]>("/api/retail/shifts"),
        request<RetailSaleDoc[]>("/api/retail/sales"),
        request<Product[]>("/api/products"),
        request<Counterparty[]>("/api/counterparties"),
        request<Vehicle[]>("/api/vehicles"),
      ]);
      setStores(st);
      setShifts(sh);
      setSales(sl);
      setProducts(pr);
      setCustomers(cp);
      setVehicles(vh);
      if (!selectedStoreId && st.length) setSelectedStoreId(st[0].id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить данные розницы.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
  }, []);

  // Cart totals
  const totalAmountKzt = useMemo(() => {
    return cart.reduce((acc, item) => {
      const discounted = item.price * (1 - item.discountPercent / 100);
      return acc + discounted * item.quantity;
    }, 0);
  }, [cart]);

  const paidCash = Number(cashAmount) || 0;
  const paidCard = Number(cardAmount) || 0;
  const totalPaid = paidCash + paidCard;
  const changeKzt = Math.max(0, paidCash + paidCard - totalAmountKzt);

  const handleAddItemToCart = (p: Product) => {
    setCart((prev) => {
      const existing = prev.find((item) => item.productId === p.id);
      if (existing) {
        return prev.map((item) => (item.productId === p.id ? { ...item, quantity: item.quantity + 1 } : item));
      }
      return [
        ...prev,
        {
          productId: p.id,
          name: p.name,
          code: p.code,
          unit: p.unit,
          quantity: 1,
          price: p.sale_price_tiyin / 100,
          discountPercent: 0,
        },
      ];
    });
    setProductSearch("");
  };

  const handleRemoveFromCart = (productId: number) => {
    setCart((prev) => prev.filter((item) => item.productId !== productId));
  };

  const handleOpenShift = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!activeStore) return;
    setSavingShift(true);
    try {
      const form = new FormData(e.currentTarget);
      const cashStart = Number(form.get("cashStart")) || 0;
      await request("/api/retail/shifts/open", {
        method: "POST",
        body: JSON.stringify({ store_id: activeStore.id, cash_start: cashStart }),
      });
      setOpenShiftModal(false);
      await loadAll();
      onNotify(`Смена открыта на точке «${activeStore.name}».`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось открыть смену.");
    } finally {
      setSavingShift(false);
    }
  };

  const handleCloseShift = async () => {
    if (!closeShiftConfirm) return;
    setSavingShift(true);
    try {
      await request(`/api/retail/shifts/${closeShiftConfirm.id}/close`, { method: "POST" });
      setCloseShiftConfirm(null);
      await loadAll();
      onNotify(`Смена №${closeShiftConfirm.shift_number} закрыта. Z-отчет и ПКО сформированы.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось закрыть смену.");
    } finally {
      setSavingShift(false);
    }
  };

  const handleProcessSale = async (e: FormEvent) => {
    e.preventDefault();
    if (!activeStore || !cart.length) return;
    if (totalPaid < totalAmountKzt) {
      setError(`Внесено недостаточно средств: сумма чека ${totalAmountKzt.toFixed(2)} ₸, внесено ${totalPaid.toFixed(2)} ₸.`);
      return;
    }

    setProcessingSale(true);
    setError("");
    try {
      const payload = {
        store_id: activeStore.id,
        counterparty_id: selectedCustomerId,
        vehicle_id: selectedVehicleId,
        odometer_km: odometerKm ? Number(odometerKm) : undefined,
        cash_amount: paidCash > totalAmountKzt ? totalAmountKzt - paidCard : paidCash,
        card_amount: paidCard,
        items: cart.map((c) => ({
          productId: c.productId,
          quantity: c.quantity,
          price: c.price,
          discountPercent: c.discountPercent,
        })),
      };

      await request("/api/retail/sales", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      // Clear cart
      setCart([]);
      setCashAmount("");
      setCardAmount("");
      setSelectedCustomerId(null);
      setSelectedVehicleId(null);
      setOdometerKm("");
      await loadAll();
      onNotify("Чек успешно пробит и проведен! Запчасти списаны со склада.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось провести розничную продажу.");
    } finally {
      setProcessingSale(false);
    }
  };

  const handleCreateStore = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    try {
      const form = new FormData(e.currentTarget);
      await request("/api/retail/stores", {
        method: "POST",
        body: JSON.stringify({
          name: form.get("name"),
          code: form.get("code"),
          warehouse_id: form.get("warehouseId"),
          price_type: form.get("priceType"),
          auto_pko_on_shift_close: form.get("autoPko") === "on",
          auto_payment_on_shift_close: form.get("autoPayment") === "on",
          card_fee_bps: Number(form.get("cardFeeBps")) || 150,
        }),
      });
      setStoreModal(false);
      await loadAll();
      onNotify("Точка продаж создана.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось создать точку продаж.");
    }
  };

  const filteredProducts = useMemo(() => {
    if (!productSearch.trim()) return [];
    const q = productSearch.toLowerCase();
    return products.filter((p) => p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q)).slice(0, 8);
  }, [products, productSearch]);

  if (loading) return <div className="page-content"><div className="loading-state">Загрузка кассового модуля…</div></div>;

  return (
    <div className="retail-page">
      <div className="page-header">
        <h1>Розница · Касса и продажи</h1>
        <div className="page-actions">
          {activeStore && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <select
                value={activeStore.id}
                onChange={(e) => setSelectedStoreId(Number(e.target.value))}
                style={{ minHeight: 32, fontSize: 13, border: "1px solid var(--line)", borderRadius: 3 }}
              >
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>{s.name} ({s.code || "POS"})</option>
                ))}
              </select>
            </div>
          )}
          {editable && (
            <button className="button outline" onClick={() => setStoreModal(true)}>
              <Plus size={14} style={{ marginRight: 4 }} />Точка продаж
            </button>
          )}
        </div>
      </div>

      <div className="tab-buttons">
        <button className={subTab === "terminal" ? "selected" : ""} onClick={() => setSubTab("terminal")}>
          <ShoppingCart size={15} style={{ marginRight: 6 }} />Кассовый терминал (POS)
        </button>
        <button className={subTab === "sales" ? "selected" : ""} onClick={() => setSubTab("sales")}>
          <FileText size={15} style={{ marginRight: 6 }} />Чеки продаж ({sales.length})
        </button>
        <button className={subTab === "shifts" ? "selected" : ""} onClick={() => setSubTab("shifts")}>
          <Clock size={15} style={{ marginRight: 6 }} />Кассовые смены ({shifts.length})
        </button>
        <button className={subTab === "stores" ? "selected" : ""} onClick={() => setSubTab("stores")}>
          <Store size={15} style={{ marginRight: 6 }} />Точки продаж ({stores.length})
        </button>
      </div>

      {error && <div className="notice-error" style={{ margin: "12px 0" }}>{error}</div>}

      {/* SUBTAB 1: POS TERMINAL */}
      {subTab === "terminal" && activeStore && (
        <div className="pos-terminal-grid" style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 16, marginTop: 14 }}>
          {/* LEFT: CART & ITEM SELECTION */}
          <div style={{ background: "white", padding: 18, borderRadius: 4, border: "1px solid var(--line)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--line)", paddingBottom: 10, marginBottom: 14 }}>
              <div>
                <b>Точка: {activeStore.name}</b>
                <div style={{ fontSize: 12, color: "#6b7280" }}>Склад списания: {activeStore.warehouse_name || "Основной склад"}</div>
              </div>
              <div>
                {activeShift ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span className="status-pill status-posted" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <Check size={12} /> Смена №{activeShift.shift_number} (Открыта)
                    </span>
                    <button className="button outline" style={{ padding: "4px 8px", fontSize: 11 }} onClick={() => setCloseShiftConfirm(activeShift)}>
                      Закрыть смену (Z-отчет)
                    </button>
                  </div>
                ) : (
                  <button className="button primary" style={{ padding: "5px 12px", fontSize: 12 }} onClick={() => setOpenShiftModal(true)}>
                    Открыть смену
                  </button>
                )}
              </div>
            </div>

            {/* Fast item search */}
            <div style={{ position: "relative", marginBottom: 14 }}>
              <div className="search-box" style={{ width: "100%" }}>
                <Search size={16} />
                <input
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  placeholder="Штрихкод, артикул, наименование масла или фильтра…"
                  style={{ width: "100%" }}
                />
              </div>
              {filteredProducts.length > 0 && (
                <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "white", border: "1px solid var(--line)", boxShadow: "0 4px 12px rgba(0,0,0,0.1)", zIndex: 30, borderRadius: 4, marginTop: 4 }}>
                  {filteredProducts.map((p) => (
                    <div
                      key={p.id}
                      onClick={() => handleAddItemToCart(p)}
                      style={{ padding: "8px 12px", borderBottom: "1px solid #f3f4f6", cursor: "pointer", display: "flex", justifyContent: "space-between" }}
                    >
                      <div>
                        <b>{p.name}</b> <small style={{ color: "#6b7280" }}>({p.code})</small>
                      </div>
                      <div style={{ color: "#3d9435", fontWeight: 600 }}>{money(p.sale_price_tiyin)} ₸</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Cart Table */}
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#f9fafb", textAlign: "left", fontSize: 12, borderBottom: "1px solid var(--line)" }}>
                  <th style={{ padding: 8 }}>Позиция</th>
                  <th style={{ padding: 8, width: 70 }}>Кол-во</th>
                  <th style={{ padding: 8, width: 85 }}>Цена, ₸</th>
                  <th style={{ padding: 8, width: 65 }}>Скидка %</th>
                  <th style={{ padding: 8, width: 95 }}>Сумма, ₸</th>
                  <th style={{ padding: 8, width: 35 }}></th>
                </tr>
              </thead>
              <tbody>
                {cart.map((item) => {
                  const lineTotal = item.price * (1 - item.discountPercent / 100) * item.quantity;
                  return (
                    <tr key={item.productId} style={{ borderBottom: "1px solid #f3f4f6", fontSize: 13 }}>
                      <td style={{ padding: 8 }}>
                        <b>{item.name}</b>
                        <div style={{ fontSize: 11, color: "#6b7280" }}>{item.code}</div>
                      </td>
                      <td style={{ padding: 8 }}>
                        <input
                          type="number"
                          min="0.001"
                          step="0.001"
                          value={item.quantity}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            setCart((prev) => prev.map((c) => (c.productId === item.productId ? { ...c, quantity: val } : c)));
                          }}
                          style={{ width: "100%", padding: "4px 6px", fontSize: 12 }}
                        />
                      </td>
                      <td style={{ padding: 8 }}>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.price}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            setCart((prev) => prev.map((c) => (c.productId === item.productId ? { ...c, price: val } : c)));
                          }}
                          style={{ width: "100%", padding: "4px 6px", fontSize: 12 }}
                        />
                      </td>
                      <td style={{ padding: 8 }}>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="1"
                          value={item.discountPercent}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            setCart((prev) => prev.map((c) => (c.productId === item.productId ? { ...c, discountPercent: val } : c)));
                          }}
                          style={{ width: "100%", padding: "4px 6px", fontSize: 12 }}
                        />
                      </td>
                      <td style={{ padding: 8, fontWeight: 600 }}>{lineTotal.toFixed(2)}</td>
                      <td style={{ padding: 8 }}>
                        <button className="link-button" onClick={() => handleRemoveFromCart(item.productId)} style={{ color: "#ef4444" }}>✕</button>
                      </td>
                    </tr>
                  );
                })}
                {!cart.length && (
                  <tr>
                    <td colSpan={6} style={{ textAlign: "center", padding: "28px 12px", color: "#9ca3af" }}>
                      Чек пуст. Добавьте товар из поиска выше.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* RIGHT: CUSTOMER, VEHICLE & PAYMENT */}
          <div style={{ background: "white", padding: 18, borderRadius: 4, border: "1px solid var(--line)" }}>
            <h3 style={{ margin: "0 0 14px 0", borderBottom: "1px solid var(--line)", paddingBottom: 8 }}>Расчет и фискализация чека</h3>

            <form onSubmit={handleProcessSale} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {/* Customer selection */}
              <div>
                <label style={{ fontSize: 12, color: "#4b5563", display: "block", marginBottom: 4 }}>
                  <User size={13} style={{ display: "inline", marginRight: 4 }} />Клиент
                </label>
                <select
                  value={selectedCustomerId ?? ""}
                  onChange={(e) => {
                    const id = e.target.value ? Number(e.target.value) : null;
                    setSelectedCustomerId(id);
                    setSelectedVehicleId(null);
                  }}
                  style={{ width: "100%", minHeight: 34 }}
                >
                  <option value="">Розничный покупатель (без регистрации)</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>{c.name} {c.phone ? `· ${c.phone}` : ""}</option>
                  ))}
                </select>
              </div>

              {/* Vehicle if customer selected */}
              {selectedCustomerId && (
                <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 12, color: "#4b5563", display: "block", marginBottom: 4 }}>
                      <CarFront size={13} style={{ display: "inline", marginRight: 4 }} />Автомобиль
                    </label>
                    <select
                      value={selectedVehicleId ?? ""}
                      onChange={(e) => {
                        const id = e.target.value ? Number(e.target.value) : null;
                        setSelectedVehicleId(id);
                        const v = vehicles.find((item) => item.id === id);
                        if (v) setOdometerKm(String(v.current_mileage || ""));
                      }}
                      style={{ width: "100%", minHeight: 34 }}
                    >
                      <option value="">Выберите авто</option>
                      {customerVehicles.map((v) => (
                        <option key={v.id} value={v.id}>{v.plate} · {v.make} {v.model}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: "#4b5563", display: "block", marginBottom: 4 }}>Пробег, км</label>
                    <input
                      type="number"
                      value={odometerKm}
                      onChange={(e) => setOdometerKm(e.target.value)}
                      placeholder="0"
                      style={{ width: "100%", minHeight: 34 }}
                    />
                  </div>
                </div>
              )}

              {/* Summary panel */}
              <div style={{ background: "#f8fafc", padding: 14, borderRadius: 4, border: "1px solid #e2e8f0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 18, fontWeight: 700, color: "#1e293b" }}>
                  <span>ИТОГО К ОПЛАТЕ:</span>
                  <span>{totalAmountKzt.toFixed(2)} ₸</span>
                </div>
              </div>

              {/* Payment Split */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, color: "#4b5563", display: "flex", alignItems: "center", gap: 4, marginBottom: 4 }}>
                    <Banknote size={14} /> Наличные, ₸
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={cashAmount}
                    onChange={(e) => setCashAmount(e.target.value)}
                    placeholder="0.00"
                    style={{ width: "100%", minHeight: 34 }}
                  />
                  {paidCash > 0 && changeKzt > 0 && (
                    <div style={{ fontSize: 12, color: "#15803d", marginTop: 4, fontWeight: 600 }}>
                      Сдача: {changeKzt.toFixed(2)} ₸
                    </div>
                  )}
                </div>

                <div>
                  <label style={{ fontSize: 12, color: "#4b5563", display: "flex", alignItems: "center", gap: 4, marginBottom: 4 }}>
                    <CreditCard size={14} /> Банковская карта / QR, ₸
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={cardAmount}
                    onChange={(e) => setCardAmount(e.target.value)}
                    placeholder="0.00"
                    style={{ width: "100%", minHeight: 34 }}
                  />
                </div>
              </div>

              {/* Quick shortcut to pay full by card or cash */}
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  className="button outline"
                  style={{ flex: 1, fontSize: 11, padding: "5px 8px" }}
                  onClick={() => { setCashAmount(totalAmountKzt.toFixed(2)); setCardAmount("0"); }}
                >
                  Вся сумма наличными
                </button>
                <button
                  type="button"
                  className="button outline"
                  style={{ flex: 1, fontSize: 11, padding: "5px 8px" }}
                  onClick={() => { setCardAmount(totalAmountKzt.toFixed(2)); setCashAmount("0"); }}
                >
                  Вся сумма картой
                </button>
              </div>

              <button
                type="submit"
                className="button primary"
                disabled={processingSale || !cart.length || totalPaid < totalAmountKzt}
                style={{ minHeight: 44, fontSize: 15, fontWeight: 600, marginTop: 8 }}
              >
                {processingSale ? "Проведение чека…" : "ПРОБИТЬ ЧЕК (ПРОВЕСТИ)"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* SUBTAB 2: SALES REGISTER */}
      {subTab === "sales" && (
        <div className="table-card responsive-table" style={{ background: "white", padding: 16, borderRadius: 4, border: "1px solid var(--line)", marginTop: 14 }}>
          <table>
            <thead>
              <tr>
                <th>Номер чека</th>
                <th>Дата</th>
                <th>Покупатель</th>
                <th>Склад списания</th>
                <th>Способ оплаты</th>
                <th>Сумма чека</th>
                <th>Статус</th>
              </tr>
            </thead>
            <tbody>
              {sales.map((doc) => (
                <tr key={doc.id}>
                  <td data-label="Чек" className="cell-main"><b>{doc.number}</b></td>
                  <td data-label="Дата">{doc.date}</td>
                  <td data-label="Покупатель">{doc.counterparty_name || "Розничный покупатель"}</td>
                  <td data-label="Склад">{doc.warehouse_name || "Основной склад"}</td>
                  <td data-label="Оплата">
                    {doc.payment_method === "split" ? "Сплит (Нал + Карта)" : doc.payment_method === "card" ? "Карта / QR" : "Наличные"}
                  </td>
                  <td data-label="Сумма" style={{ fontWeight: 600 }}>{money(doc.total_tiyin)} ₸</td>
                  <td data-label="Статус">
                    <span className="status-pill status-posted">Проведён</span>
                  </td>
                </tr>
              ))}
              {!sales.length && (
                <tr>
                  <td colSpan={7} className="empty-inline">Чеков продаж пока нет. Пробейте первый чек на вкладке «Кассовый терминал».</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* SUBTAB 3: SHIFTS REGISTER */}
      {subTab === "shifts" && (
        <div className="table-card responsive-table" style={{ background: "white", padding: 16, borderRadius: 4, border: "1px solid var(--line)", marginTop: 14 }}>
          <table>
            <thead>
              <tr>
                <th>№ смены</th>
                <th>Точка продаж</th>
                <th>Открыта</th>
                <th>Закрыта</th>
                <th>Начальный размен</th>
                <th>Выручка нал</th>
                <th>Выручка безнал</th>
                <th>Итого выручка</th>
                <th>Статус</th>
              </tr>
            </thead>
            <tbody>
              {shifts.map((sh) => (
                <tr key={sh.id}>
                  <td data-label="№ смены" className="cell-main"><b>Смена №{sh.shift_number}</b></td>
                  <td data-label="Точка">{sh.store_name}</td>
                  <td data-label="Открыта">{sh.opened_at}</td>
                  <td data-label="Закрыта">{sh.closed_at || "—"}</td>
                  <td data-label="Размен">{money(sh.cash_start_tiyin)} ₸</td>
                  <td data-label="Нал">{money(sh.revenue_cash_tiyin)} ₸</td>
                  <td data-label="Безнал">{money(sh.revenue_card_tiyin)} ₸</td>
                  <td data-label="Итого" style={{ fontWeight: 600 }}>{money(sh.revenue_total_tiyin)} ₸</td>
                  <td data-label="Статус">
                    <span className={`status-pill ${sh.status === "open" ? "status-posted" : "status-draft"}`}>
                      {sh.status === "open" ? "Открыта" : "Закрыта (Z-отчет)"}
                    </span>
                  </td>
                </tr>
              ))}
              {!shifts.length && (
                <tr>
                  <td colSpan={9} className="empty-inline">Кассовые смены еще не открывались.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* SUBTAB 4: RETAIL STORES */}
      {subTab === "stores" && (
        <div className="table-card responsive-table" style={{ background: "white", padding: 16, borderRadius: 4, border: "1px solid var(--line)", marginTop: 14 }}>
          <table>
            <thead>
              <tr>
                <th>Наименование точки</th>
                <th>Код</th>
                <th>Склад списания</th>
                <th>Комиссия эквайринга</th>
                <th>Авто-ПКО при Z-отчете</th>
                <th>Авто-платеж по карте</th>
                <th>Активность</th>
              </tr>
            </thead>
            <tbody>
              {stores.map((s) => (
                <tr key={s.id}>
                  <td data-label="Наименование" className="cell-main"><b>{s.name}</b></td>
                  <td data-label="Код">{s.code || "—"}</td>
                  <td data-label="Склад">{s.warehouse_name}</td>
                  <td data-label="Комиссия">{(s.card_fee_bps / 100).toFixed(2)}%</td>
                  <td data-label="Авто-ПКО">{s.auto_pko_on_shift_close ? "Да" : "Нет"}</td>
                  <td data-label="Авто-безнал">{s.auto_payment_on_shift_close ? "Да" : "Нет"}</td>
                  <td data-label="Статус">
                    <span className={`status-pill ${s.active ? "status-posted" : "status-cancelled"}`}>
                      {s.active ? "Активна" : "Отключена"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* MODAL: OPEN SHIFT */}
      {openShiftModal && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpenShiftModal(false); }}>
          <section className="modal" role="dialog" aria-modal="true" style={{ maxWidth: 440 }}>
            <header>
              <h2>Открытие кассовой смены</h2>
              <button onClick={() => setOpenShiftModal(false)}>✕</button>
            </header>
            <form onSubmit={handleOpenShift} className="form-grid" style={{ padding: 18 }}>
              <label className="span-2">Точка продаж
                <input value={activeStore?.name ?? ""} readOnly disabled />
              </label>
              <label className="span-2">Начальный разменный фонд в ящике, ₸
                <input name="cashStart" type="number" min="0" step="100" defaultValue="15000" placeholder="15 000" />
              </label>
              <div className="modal-actions span-2">
                <button type="button" className="button outline" onClick={() => setOpenShiftModal(false)}>Отмена</button>
                <button className="button primary" disabled={savingShift}>{savingShift ? "Открытие…" : "Открыть смену"}</button>
              </div>
            </form>
          </section>
        </div>
      )}

      {/* MODAL: CLOSE SHIFT CONFIRMATION */}
      {closeShiftConfirm && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setCloseShiftConfirm(null); }}>
          <section className="modal" role="dialog" aria-modal="true" style={{ maxWidth: 480 }}>
            <header>
              <h2>Закрытие смены (Формирование Z-отчета)</h2>
              <button onClick={() => setCloseShiftConfirm(null)}>✕</button>
            </header>
            <div style={{ padding: 18 }}>
              <p>Вы действительно хотите закрыть смену <b>№{closeShiftConfirm.shift_number}</b>?</p>
              <div style={{ background: "#f8fafc", padding: 12, borderRadius: 4, border: "1px solid #e2e8f0", margin: "14px 0", fontSize: 13 }}>
                <div>Выручка наличными: <b>{money(closeShiftConfirm.revenue_cash_tiyin)} ₸</b> (Будет создан ПКО в главную кассу)</div>
                <div style={{ marginTop: 6 }}>Выручка по картам: <b>{money(closeShiftConfirm.revenue_card_tiyin)} ₸</b> (Будет создан входящий платеж на банк)</div>
                <div style={{ marginTop: 6, fontWeight: 700 }}>Всего выручка за смену: {money(closeShiftConfirm.revenue_total_tiyin)} ₸</div>
              </div>
              <div className="modal-actions">
                <button type="button" className="button outline" onClick={() => setCloseShiftConfirm(null)}>Отмена</button>
                <button className="button primary" onClick={handleCloseShift} disabled={savingShift}>
                  {savingShift ? "Закрытие…" : "Снять Z-отчет и закрыть"}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* MODAL: NEW STORE */}
      {storeModal && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setStoreModal(false); }}>
          <section className="modal" role="dialog" aria-modal="true" style={{ maxWidth: 500 }}>
            <header>
              <h2>Новая точка продаж (Касса)</h2>
              <button onClick={() => setStoreModal(false)}>✕</button>
            </header>
            <form onSubmit={handleCreateStore} className="form-grid" style={{ padding: 18 }}>
              <label className="span-2">Наименование точки *<input name="name" placeholder="Касса автосервиса / Магазин масел" required /></label>
              <label>Код точки<input name="code" placeholder="POS-02" /></label>
              <label>Склад списания
                <select name="warehouseId" defaultValue="1">
                  <option value="1">Основной склад</option>
                </select>
              </label>
              <label>Комиссия эквайринга (%)<input name="cardFeeBps" type="number" step="10" defaultValue="150" placeholder="150 = 1.5%" /></label>
              <label className="span-2" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <input type="checkbox" name="autoPko" defaultChecked style={{ width: 16, height: 16 }} />
                Автоматически создавать ПКО на наличную выручку при закрытии смены
              </label>
              <label className="span-2" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <input type="checkbox" name="autoPayment" defaultChecked style={{ width: 16, height: 16 }} />
                Автоматически создавать входящий платеж на безналичную выручку
              </label>
              <div className="modal-actions span-2">
                <button type="button" className="button outline" onClick={() => setStoreModal(false)}>Отмена</button>
                <button className="button primary">Создать точку</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
