import { useState, useEffect, useCallback } from "react";
import {
  Play, Plus, Trash2, CheckCircle2, AlertCircle, Clock,
  MessageSquare, Bell, RefreshCw, X
} from "lucide-react";

interface AutomationRule {
  id: number;
  organization_id: number;
  name: string;
  description: string;
  active: number;
  trigger_type: string;
  conditions_json: string;
  action_type: string;
  action_payload_json: string;
  run_count: number;
  last_run_at: string | null;
  created_at: string;
}

interface AutomationLog {
  id: number;
  rule_id: number | null;
  rule_name: string;
  trigger_event: string;
  entity_id: number | null;
  entity_number: string | null;
  status: "success" | "failed" | "skipped";
  action_summary: string;
  details: string;
  created_at: string;
}

export default function ScriptsPage({ onNotify }: { onNotify: (msg: string) => void }) {
  const [tab, setTab] = useState<"rules" | "logs">("rules");
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [logs, setLogs] = useState<AutomationLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [testingRuleId, setTestingRuleId] = useState<number | null>(null);

  // Form state
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formTrigger, setFormTrigger] = useState("doc_status_change");
  const [formDocKind, setFormDocKind] = useState("work_order");
  const [formStatusName, setFormStatusName] = useState("Готов");
  const [formAction, setFormAction] = useState("send_sms");
  const [formTemplate, setFormTemplate] = useState("Здравствуйте! Заказ-наряд {doc_number} на авто {vehicle_plate} готов к выдаче. Сумма к оплате: {total_amount} ₸.");

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [rulesRes, logsRes] = await Promise.all([
        fetch("/api/automation/rules"),
        fetch("/api/automation/logs")
      ]);
      if (rulesRes.ok) setRules(await rulesRes.json());
      if (logsRes.ok) setLogs(await logsRes.json());
    } catch {
      onNotify("Ошибка загрузки сценариев");
    } finally {
      setLoading(false);
    }
  }, [onNotify]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const toggleActive = async (rule: AutomationRule) => {
    try {
      const res = await fetch(`/api/automation/rules/${rule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: rule.active ? 0 : 1 })
      });
      if (res.ok) {
        onNotify(`Сценарий ${rule.active ? "отключён" : "включён"}`);
        await loadData();
      }
    } catch {
      onNotify("Не удалось обновить статус сценария");
    }
  };

  const deleteRule = async (id: number) => {
    if (!window.confirm("Удалить этот сценарий?")) return;
    try {
      const res = await fetch(`/api/automation/rules/${id}`, { method: "DELETE" });
      if (res.ok) {
        onNotify("Сценарий удалён");
        await loadData();
      }
    } catch {
      onNotify("Не удалось удалить сценарий");
    }
  };

  const runTest = async (ruleId: number) => {
    setTestingRuleId(ruleId);
    try {
      const res = await fetch(`/api/automation/rules/${ruleId}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (res.ok) {
        onNotify(`Тестовый запуск выполнен! Выполнено действий: ${data.executedCount}`);
        await loadData();
        setTab("logs");
      } else {
        onNotify(data.error || "Ошибка при выполнении теста");
      }
    } catch {
      onNotify("Сбой сетевого запроса при запуске теста");
    } finally {
      setTestingRuleId(null);
    }
  };

  const handleCreateRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) {
      alert("Укажите название сценария");
      return;
    }

    try {
      const res = await fetch("/api/automation/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formName,
          description: formDesc,
          trigger_type: formTrigger,
          conditions: {
            docKind: formTrigger === "doc_status_change" ? formDocKind : undefined,
            statusName: formTrigger === "doc_status_change" ? formStatusName : undefined
          },
          action_type: formAction,
          action_payload: {
            template: formTemplate
          }
        })
      });

      if (res.ok) {
        onNotify("Новый сценарий успешно создан");
        setCreateOpen(false);
        setFormName("");
        setFormDesc("");
        await loadData();
      } else {
        const err = await res.json();
        onNotify(err.error || "Не удалось создать сценарий");
      }
    } catch {
      onNotify("Ошибка при сохранении сценария");
    }
  };

  return (
    <div className="automation-page" style={{ padding: "16px 20px" }}>
      <header className="page-header" style={{ marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 20, margin: 0, fontWeight: 700, color: "#222" }}>Сценарии и автоматизация</h1>
          <p style={{ margin: "4px 0 0", color: "#666", fontSize: 13 }}>
            Автоматические триггеры, SMS-уведомления автовладельцам, напоминания о ТО и контроль снабжения
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="button outline" onClick={() => void loadData()}>
            <RefreshCw size={15} style={{ marginRight: 6 }} /> Обновить
          </button>
          <button className="button action-blue" onClick={() => setCreateOpen(true)}>
            <Plus size={16} style={{ marginRight: 6 }} /> + Сценарий
          </button>
        </div>
      </header>

      {/* Tabs */}
      <div className="subnav-tabs" style={{ display: "flex", gap: 16, borderBottom: "1px solid #ddd", marginBottom: 16 }}>
        <button
          className="link-button"
          style={{
            padding: "8px 12px",
            fontSize: 14,
            fontWeight: tab === "rules" ? 600 : 400,
            color: tab === "rules" ? "#186999" : "#555",
            borderBottom: tab === "rules" ? "3px solid #186999" : "none"
          }}
          onClick={() => setTab("rules")}
        >
          Правила автоматизации ({rules.length})
        </button>
        <button
          className="link-button"
          style={{
            padding: "8px 12px",
            fontSize: 14,
            fontWeight: tab === "logs" ? 600 : 400,
            color: tab === "logs" ? "#186999" : "#555",
            borderBottom: tab === "logs" ? "3px solid #186999" : "none"
          }}
          onClick={() => setTab("logs")}
        >
          Журнал выполнений ({logs.length})
        </button>
      </div>

      {tab === "rules" && (
        <div className="rules-container">
          <div className="table-card responsive-table" style={{ background: "#fff", borderRadius: 4, border: "1px solid #dcdcdc" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#f8f9fa", borderBottom: "1px solid #e0e0e0", fontSize: 12, textAlign: "left", color: "#666" }}>
                  <th style={{ padding: "10px 14px", width: 70 }}>Статус</th>
                  <th style={{ padding: "10px 14px" }}>Сценарий</th>
                  <th style={{ padding: "10px 14px" }}>Событие-триггер</th>
                  <th style={{ padding: "10px 14px" }}>Действие</th>
                  <th style={{ padding: "10px 14px", width: 110 }}>Срабатываний</th>
                  <th style={{ padding: "10px 14px", width: 140 }}>Посл. запуск</th>
                  <th style={{ padding: "10px 14px", width: 150, textAlign: "right" }}>Управление</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => {
                  let conditions: any = {};
                  let payload: any = {};
                  try { conditions = JSON.parse(rule.conditions_json || "{}"); } catch {}
                  try { payload = JSON.parse(rule.action_payload_json || "{}"); } catch {}

                  return (
                    <tr key={rule.id} style={{ borderBottom: "1px solid #eee", fontSize: 13 }}>
                      <td style={{ padding: "12px 14px" }}>
                        <button
                          className="link-button"
                          onClick={() => void toggleActive(rule)}
                          style={{
                            padding: "3px 8px",
                            borderRadius: 12,
                            fontSize: 11,
                            fontWeight: 600,
                            background: rule.active ? "#e8f5e9" : "#f5f5f5",
                            color: rule.active ? "#2e7d32" : "#888",
                            cursor: "pointer",
                            border: "none"
                          }}
                        >
                          {rule.active ? "Активен" : "Отключён"}
                        </button>
                      </td>
                      <td style={{ padding: "12px 14px" }}>
                        <div style={{ fontWeight: 600, color: "#222" }}>{rule.name}</div>
                        {rule.description && <div style={{ fontSize: 12, color: "#777", marginTop: 2 }}>{rule.description}</div>}
                      </td>
                      <td style={{ padding: "12px 14px" }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "#e3f2fd", color: "#1565c0", padding: "2px 7px", borderRadius: 4, fontSize: 12 }}>
                          <Clock size={12} />
                          {rule.trigger_type === "doc_status_change" ? "Смена статуса" : rule.trigger_type === "low_stock" ? "Дефицит остатка" : rule.trigger_type}
                        </span>
                        {conditions.docKind && <div style={{ fontSize: 11, color: "#555", marginTop: 4 }}>Документ: {conditions.docKind === "work_order" ? "Заказ-наряд" : conditions.docKind} → {conditions.statusName || "любой"}</div>}
                      </td>
                      <td style={{ padding: "12px 14px" }}>
                        <div style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "#f3e5f5", color: "#7b1fa2", padding: "2px 7px", borderRadius: 4, fontSize: 12, marginBottom: 4 }}>
                          {rule.action_type === "send_sms" ? <MessageSquare size={12} /> : <Bell size={12} />}
                          {rule.action_type === "send_sms" ? "SMS-сообщение" : rule.action_type === "notify_procurement" ? "Оповещение снабжения" : rule.action_type}
                        </div>
                        {payload.template && (
                          <div style={{ fontSize: 11, color: "#666", maxWidth: 300, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            «{payload.template}»
                          </div>
                        )}
                      </td>
                      <td style={{ padding: "12px 14px", fontWeight: 600, color: "#333" }}>
                        {rule.run_count}
                      </td>
                      <td style={{ padding: "12px 14px", fontSize: 12, color: "#666" }}>
                        {rule.last_run_at ? new Date(`${rule.last_run_at.replace(" ", "T")}Z`).toLocaleString("ru-RU") : "Не запускался"}
                      </td>
                      <td style={{ padding: "12px 14px", textAlign: "right" }}>
                        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                          <button
                            className="button outline"
                            disabled={testingRuleId === rule.id}
                            style={{ padding: "4px 8px", fontSize: 12 }}
                            onClick={() => void runTest(rule.id)}
                            title="Протестировать сценарий на последнем документе"
                          >
                            <Play size={12} style={{ marginRight: 4 }} />
                            {testingRuleId === rule.id ? "Тест…" : "Тест"}
                          </button>
                          <button
                            className="link-button"
                            onClick={() => void deleteRule(rule.id)}
                            style={{ color: "#d32f2f", padding: "4px 6px" }}
                            title="Удалить сценарий"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!rules.length && !loading && (
                  <tr>
                    <td colSpan={7} style={{ padding: 40, textAlign: "center", color: "#888" }}>
                      Сценариев пока нет. Создайте первый сценарий для автоматизации процессов.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "logs" && (
        <div className="logs-container">
          <div className="table-card responsive-table" style={{ background: "#fff", borderRadius: 4, border: "1px solid #dcdcdc" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#f8f9fa", borderBottom: "1px solid #e0e0e0", fontSize: 12, textAlign: "left", color: "#666" }}>
                  <th style={{ padding: "10px 14px", width: 140 }}>Дата и время</th>
                  <th style={{ padding: "10px 14px", width: 90 }}>Результат</th>
                  <th style={{ padding: "10px 14px" }}>Сценарий</th>
                  <th style={{ padding: "10px 14px" }}>Документ / Объект</th>
                  <th style={{ padding: "10px 14px" }}>Действие</th>
                  <th style={{ padding: "10px 14px" }}>Подробности сообщения</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} style={{ borderBottom: "1px solid #eee", fontSize: 13 }}>
                    <td style={{ padding: "10px 14px", fontSize: 12, color: "#666" }}>
                      {new Date(`${log.created_at.replace(" ", "T")}Z`).toLocaleString("ru-RU")}
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      <span style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        padding: "2px 6px",
                        borderRadius: 4,
                        fontSize: 11,
                        fontWeight: 600,
                        background: log.status === "success" ? "#e8f5e9" : "#ffebee",
                        color: log.status === "success" ? "#2e7d32" : "#c62828"
                      }}>
                        {log.status === "success" ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
                        {log.status === "success" ? "Успешно" : "Сбой"}
                      </span>
                    </td>
                    <td style={{ padding: "10px 14px", fontWeight: 600, color: "#222" }}>
                      {log.rule_name}
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      {log.entity_number ? (
                        <span style={{ background: "#f5f5f5", padding: "2px 6px", borderRadius: 4, fontSize: 12, fontWeight: 500 }}>
                          № {log.entity_number}
                        </span>
                      ) : "—"}
                    </td>
                    <td style={{ padding: "10px 14px", color: "#444" }}>
                      {log.action_summary}
                    </td>
                    <td style={{ padding: "10px 14px", fontSize: 12, color: "#555" }}>
                      {log.details}
                    </td>
                  </tr>
                ))}
                {!logs.length && (
                  <tr>
                    <td colSpan={6} style={{ padding: 40, textAlign: "center", color: "#888" }}>
                      История выполнений пока пуста. Запустите тест любого правила для проверки.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Create Rule Modal */}
      {createOpen && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setCreateOpen(false); }}>
          <section className="modal" style={{ maxWidth: 640 }}>
            <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: 18 }}>Новый сценарий автоматизации</h2>
              <button aria-label="Закрыть" onClick={() => setCreateOpen(false)} style={{ background: "none", border: "none", cursor: "pointer" }}>
                <X size={19} />
              </button>
            </header>

            <form onSubmit={handleCreateRule} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Название сценария *</label>
                <input
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Например: SMS при готовности автомобиля"
                  style={{ width: "100%", padding: "7px 10px", fontSize: 13, border: "1px solid #ccc", borderRadius: 4 }}
                  required
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Описание цели сценария</label>
                <input
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  placeholder="Краткое пояснение для сотрудников"
                  style={{ width: "100%", padding: "7px 10px", fontSize: 13, border: "1px solid #ccc", borderRadius: 4 }}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Событие-триггер</label>
                  <select
                    value={formTrigger}
                    onChange={(e) => setFormTrigger(e.target.value)}
                    style={{ width: "100%", padding: "7px 10px", fontSize: 13, border: "1px solid #ccc", borderRadius: 4 }}
                  >
                    <option value="doc_status_change">Смена статуса документа</option>
                    <option value="low_stock">Остаток ниже неснижаемого</option>
                  </select>
                </div>

                {formTrigger === "doc_status_change" && (
                  <div>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Тип документа</label>
                    <select
                      value={formDocKind}
                      onChange={(e) => setFormDocKind(e.target.value)}
                      style={{ width: "100%", padding: "7px 10px", fontSize: 13, border: "1px solid #ccc", borderRadius: 4 }}
                    >
                      <option value="work_order">Заказ-наряд (СТО)</option>
                      <option value="customer_order">Заказ покупателя</option>
                      <option value="shipment">Отгрузка</option>
                    </select>
                  </div>
                )}
              </div>

              {formTrigger === "doc_status_change" && (
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Целевой статус для срабатывания</label>
                  <select
                    value={formStatusName}
                    onChange={(e) => setFormStatusName(e.target.value)}
                    style={{ width: "100%", padding: "7px 10px", fontSize: 13, border: "1px solid #ccc", borderRadius: 4 }}
                  >
                    <option value="Готов">Готов</option>
                    <option value="В работе">В работе</option>
                    <option value="Подтвержден">Подтвержден</option>
                    <option value="Закрыт">Закрыт</option>
                    <option value="Отменен">Отменен</option>
                  </select>
                </div>
              )}

              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Выполняемое действие</label>
                <select
                  value={formAction}
                  onChange={(e) => setFormAction(e.target.value)}
                  style={{ width: "100%", padding: "7px 10px", fontSize: 13, border: "1px solid #ccc", borderRadius: 4 }}
                >
                  <option value="send_sms">Отправить SMS клиенту</option>
                  <option value="notify_procurement">Создать оповещение в снабжение</option>
                  <option value="create_task">Поставить задачу сотруднику</option>
                </select>
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                  Шаблон текста сообщения
                </label>
                <textarea
                  value={formTemplate}
                  onChange={(e) => setFormTemplate(e.target.value)}
                  rows={3}
                  style={{ width: "100%", padding: "8px 10px", fontSize: 13, border: "1px solid #ccc", borderRadius: 4 }}
                />
                <div style={{ fontSize: 11, color: "#666", marginTop: 4 }}>
                  Доступные переменные: <code>{'{doc_number}'}</code>, <code>{'{vehicle_plate}'}</code>, <code>{'{total_amount}'}</code>, <code>{'{counterparty_name}'}</code>, <code>{'{next_service_km}'}</code>
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
                <button type="button" className="button outline" onClick={() => setCreateOpen(false)}>Отмена</button>
                <button type="submit" className="button primary">Создать сценарий</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
