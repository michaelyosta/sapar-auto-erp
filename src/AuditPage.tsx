import { useEffect, useState, useCallback } from "react";
import { Search, RefreshCw } from "lucide-react";

type AuditEntry = {
  id: number;
  entity_type: string;
  entity_id: number;
  action: string;
  detail: string;
  created_at: string;
};

async function request<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Ошибка запроса");
  return data as T;
}

const entityLabels: Record<string, string> = {
  document: "Документ",
  product: "Товар / Услуга",
  counterparty: "Контрагент",
  vehicle: "Автомобиль",
  warehouse: "Склад",
  organization: "Организация",
  retail_store: "Точка продаж",
  retail_shift: "Кассовая смена",
  bank_account: "Расчетный счет",
  system: "Система",
};

const actionLabels: Record<string, string> = {
  create: "Создание",
  update: "Изменение",
  delete: "Удаление",
  post: "Проведение",
  unpost: "Снятие с проведения",
  restore: "Восстановление",
  open: "Открытие",
  close: "Закрытие",
  attach_file: "Загрузка файла",
  archive: "Архивирование",
  empty_trash: "Очистка корзины",
};

export default function AuditPage() {
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [entityFilter, setEntityFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      if (entityFilter) params.set("entityType", entityFilter);
      if (actionFilter) params.set("action", actionFilter);
      params.set("limit", "100");

      const res = await request<{ total: number; logs: AuditEntry[] }>(`/api/audit?${params.toString()}`);
      setLogs(res.logs);
      setTotal(res.total);
    } catch {
      setLogs([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [query, entityFilter, actionFilter]);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  return (
    <div className="audit-page">
      <div className="page-header">
        <h1>Аудит действий и изменений</h1>
        <div className="page-actions">
          <button className="button outline" onClick={() => void loadLogs()}><RefreshCw size={14} style={{ marginRight: 4 }} />Обновить</button>
        </div>
      </div>

      <div className="list-toolbar">
        <div className="search-box">
          <Search size={16} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск по деталям, действию или объекту…"
          />
        </div>
        <select
          value={entityFilter}
          onChange={(e) => setEntityFilter(e.target.value)}
          style={{ minHeight: 34, padding: "0 10px", border: "1px solid var(--line)", borderRadius: 3 }}
        >
          <option value="">Все объекты учета</option>
          <option value="document">Документы</option>
          <option value="product">Товары и услуги</option>
          <option value="counterparty">Контрагенты</option>
          <option value="vehicle">Автомобили</option>
          <option value="warehouse">Склады</option>
          <option value="retail_shift">Кассовые смены</option>
          <option value="organization">Реквизиты компании</option>
        </select>
        <select
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          style={{ minHeight: 34, padding: "0 10px", border: "1px solid var(--line)", borderRadius: 3 }}
        >
          <option value="">Все действия</option>
          <option value="create">Создание</option>
          <option value="update">Изменение</option>
          <option value="post">Проведение</option>
          <option value="unpost">Снятие проведения</option>
          <option value="delete">Удаление</option>
          <option value="open">Открытие</option>
          <option value="close">Закрытие</option>
        </select>
      </div>

      <div className="list-meta">
        <span>Всего записей: {total}</span>
      </div>

      <div className="table-card responsive-table" style={{ background: "white", padding: 16, borderRadius: 4, border: "1px solid var(--line)" }}>
        <table>
          <thead>
            <tr>
              <th style={{ width: 150 }}>Дата и время</th>
              <th style={{ width: 140 }}>Объект</th>
              <th style={{ width: 130 }}>Действие</th>
              <th>Подробности</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id}>
                <td data-label="Время" style={{ fontSize: 12, color: "#4b5563" }}>{log.created_at}</td>
                <td data-label="Объект" className="cell-main">
                  <b>{entityLabels[log.entity_type] ?? log.entity_type}</b>
                  <div style={{ fontSize: 11, color: "#6b7280" }}>ID #{log.entity_id}</div>
                </td>
                <td data-label="Действие">
                  <span className={`status-pill ${log.action === "post" ? "status-posted" : log.action === "delete" ? "status-cancelled" : "status-draft"}`}>
                    {actionLabels[log.action] ?? log.action}
                  </span>
                </td>
                <td data-label="Детали">{log.detail || "—"}</td>
              </tr>
            ))}
            {!logs.length && !loading && (
              <tr>
                <td colSpan={4} className="empty-inline">Записей в журнале аудита не найдено.</td>
              </tr>
            )}
            {loading && (
              <tr>
                <td colSpan={4} className="empty-inline">Загрузка журнала аудита…</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
