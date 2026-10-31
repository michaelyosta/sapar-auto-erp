import { useEffect, useState } from "react";
import { Trash2, RotateCcw, RefreshCw, AlertTriangle } from "lucide-react";

type DeletedDoc = {
  id: number;
  number: string;
  kind: string;
  date: string;
  counterparty_name?: string;
  warehouse_name?: string;
  total_tiyin: number;
  updated_at: string;
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Ошибка запроса");
  return data as T;
}

const money = (tiyin: number = 0) =>
  new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(tiyin) / 100);

const kindLabels: Record<string, string> = {
  customer_order: "Заказ покупателя",
  customer_invoice: "Счет покупателю",
  shipment: "Отгрузка",
  customer_return: "Возврат покупателя",
  supplier_order: "Заказ поставщику",
  supplier_invoice: "Счет поставщика",
  receipt: "Приемка",
  supplier_return: "Возврат поставщику",
  work_order: "Заказ-наряд",
  enter: "Оприходование",
  writeoff: "Списание",
  transfer: "Перемещение",
  stocktake: "Инвентаризация",
  incoming_payment: "Входящий платеж",
  payment: "Исходящий платеж",
  cash_in: "Приходный кассовый ордер",
  cash_out: "Расходный кассовый ордер",
  retailsale: "Чек продажи",
};

export default function TrashPage({ onNotify }: { onNotify: (msg: string) => void }) {
  const [items, setItems] = useState<DeletedDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const loadTrash = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await request<DeletedDoc[]>("/api/trash");
      setItems(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить корзину.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadTrash();
  }, []);

  const handleRestore = async (id: number, number: string) => {
    setBusy(true);
    try {
      await request(`/api/trash/${id}/restore`, { method: "POST" });
      await loadTrash();
      onNotify(`Документ ${number} восстановлен из корзины в черновики.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось восстановить документ.");
    } finally {
      setBusy(false);
    }
  };

  const handlePurge = async (id: number) => {
    if (!window.confirm("Удалить документ навсегда? Это действие необратимо.")) return;
    setBusy(true);
    try {
      await request(`/api/trash/${id}`, { method: "DELETE" });
      await loadTrash();
      onNotify("Документ окончательно удален.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить документ.");
    } finally {
      setBusy(false);
    }
  };

  const handleEmptyTrash = async () => {
    if (!window.confirm("Очистить корзину полностью? Все удаленные документы будут стерты безвозвратно.")) return;
    setBusy(true);
    try {
      const res = await request<{ ok: boolean; deletedCount: number }>("/api/trash/empty", { method: "POST" });
      await loadTrash();
      onNotify(`Корзина очищена (удалено документов: ${res.deletedCount}).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось очистить корзину.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="trash-page">
      <div className="page-header">
        <h1>Корзина удаленных документов</h1>
        <div className="page-actions">
          <button className="button outline" onClick={() => void loadTrash()}><RefreshCw size={14} style={{ marginRight: 4 }} />Обновить</button>
          {items.length > 0 && (
            <button className="button outline" onClick={handleEmptyTrash} disabled={busy} style={{ color: "#ef4444" }}>
              <Trash2 size={14} style={{ marginRight: 4 }} />Очистить корзину
            </button>
          )}
        </div>
      </div>

      <div style={{ background: "#fffbeb", border: "1px solid #fef3c7", padding: "10px 14px", borderRadius: 4, display: "flex", alignItems: "center", gap: 10, marginBottom: 14, fontSize: 13, color: "#92400e" }}>
        <AlertTriangle size={18} />
        <span>Удаленные документы хранятся в корзине в соответствии с политикой компании (по умолчанию 7 дней) и могут быть восстановлены в 1 клик.</span>
      </div>

      {error && <div className="notice-error" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="table-card responsive-table" style={{ background: "white", padding: 16, borderRadius: 4, border: "1px solid var(--line)" }}>
        <table>
          <thead>
            <tr>
              <th>Номер документа</th>
              <th>Тип документа</th>
              <th>Дата документа</th>
              <th>Контрагент</th>
              <th>Сумма, ₸</th>
              <th>Дата удаления</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            {items.map((doc) => (
              <tr key={doc.id}>
                <td data-label="Номер" className="cell-main"><b>{doc.number}</b></td>
                <td data-label="Тип">{kindLabels[doc.kind] ?? doc.kind}</td>
                <td data-label="Дата">{doc.date}</td>
                <td data-label="Контрагент">{doc.counterparty_name || "—"}</td>
                <td data-label="Сумма" style={{ fontWeight: 600 }}>{money(doc.total_tiyin)} ₸</td>
                <td data-label="Удален" style={{ fontSize: 12, color: "#6b7280" }}>{doc.updated_at}</td>
                <td data-label="Действия">
                  <div style={{ display: "flex", gap: 6 }}>
                    <button className="button outline" style={{ padding: "4px 8px", fontSize: 11 }} onClick={() => handleRestore(doc.id, doc.number)} disabled={busy}>
                      <RotateCcw size={12} style={{ marginRight: 4 }} />Восстановить
                    </button>
                    <button className="link-button" style={{ color: "#ef4444", fontSize: 11 }} onClick={() => handlePurge(doc.id)} disabled={busy}>
                      Удалить навсегда
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!items.length && !loading && (
              <tr>
                <td colSpan={7} className="empty-inline">Корзина пуста. Удаленные документы будут отображаться здесь.</td>
              </tr>
            )}
            {loading && (
              <tr>
                <td colSpan={7} className="empty-inline">Загрузка корзины…</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
