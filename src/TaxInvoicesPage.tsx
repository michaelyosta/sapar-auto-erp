import { useEffect, useState, useCallback } from "react";
import {
  FileSpreadsheet,
  Send,
  CheckCircle2,
  Clock,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";

interface TaxInvoice {
  id: number;
  direction: "issued" | "received";
  number: string;
  date: string;
  turnover_date: string;
  counterparty_id: number;
  counterparty_name: string;
  counterparty_bin?: string;
  source_doc_number?: string;
  source_doc_kind?: string;
  esf_registration_number?: string;
  esf_status: "draft" | "sent" | "registered" | "rejected";
  total_without_vat_tiyin: number;
  vat_tiyin: number;
  total_tiyin: number;
  comment?: string;
}

function fmtMoney(tiyins: number): string {
  const kzt = tiyins / 100;
  return kzt.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₸";
}

export default function TaxInvoicesPage({
  initialDirection = "issued",
  onNotify,
}: {
  initialDirection?: "issued" | "received";
  onNotify?: (msg: string) => void;
}) {
  const [direction, setDirection] = useState<"issued" | "received">(initialDirection);
  const [invoices, setInvoices] = useState<TaxInvoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams({ direction });
      if (statusFilter !== "all") q.set("status", statusFilter);
      const res = await fetch(`/api/tax-invoices?${q.toString()}`);
      if (res.ok) setInvoices(await res.json());
    } finally {
      setLoading(false);
    }
  }, [direction, statusFilter]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleRegisterEsf = async (id: number) => {
    try {
      const res = await fetch(`/api/tax-invoices/${id}/send-esf`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Ошибка отправки в ИС ЭСФ");
      if (onNotify) onNotify(`Счет-фактура зарегистрирован в ИС ЭСФ: ${data.registration_number}`);
      await loadData();
    } catch (e) {
      if (onNotify) onNotify(e instanceof Error ? e.message : "Ошибка регистрации");
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Удалить счет-фактуру?")) return;
    try {
      const res = await fetch(`/api/tax-invoices/${id}`, { method: "DELETE" });
      if (res.ok) {
        if (onNotify) onNotify("Счет-фактура удален");
        await loadData();
      }
    } catch {
      // silent
    }
  };

  const filtered = invoices.filter((it) => {
    if (!search.trim()) return true;
    const term = search.toLowerCase();
    return (
      it.number.toLowerCase().includes(term) ||
      it.counterparty_name?.toLowerCase().includes(term) ||
      it.counterparty_bin?.toLowerCase().includes(term) ||
      it.esf_registration_number?.toLowerCase().includes(term)
    );
  });

  return (
    <div className="tax-invoices-page" style={{ padding: "16px 24px", maxWidth: 1400, margin: "0 auto" }}>
      {/* Top Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, color: "#222", margin: "0 0 6px", display: "flex", alignItems: "center", gap: 8 }}>
            <FileSpreadsheet size={24} color="#186999" />
            Счета-фактуры (ЭСФ)
          </h1>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => setDirection("issued")}
              className={`button ${direction === "issued" ? "primary" : "outline"}`}
              style={{ padding: "6px 14px", fontSize: 13 }}
            >
              Выданные (ИС ЭСФ)
            </button>
            <button
              onClick={() => setDirection("received")}
              className={`button ${direction === "received" ? "primary" : "outline"}`}
              style={{ padding: "6px 14px", fontSize: 13 }}
            >
              Полученные (от поставщиков)
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
        <div style={{ position: "relative", width: 340 }}>
          <Search size={15} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#888" }} />
          <input
            type="text"
            placeholder="Поиск по номеру ЭСФ, контрагенту, БИН..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: "100%", padding: "6px 10px 6px 32px", fontSize: 13, border: "1px solid #ccc", borderRadius: 4 }}
          />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: "#666" }}>Статус:</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{ padding: "4px 8px", fontSize: 12, border: "1px solid #ccc", borderRadius: 4 }}
          >
            <option value="all">Все статусы</option>
            <option value="registered">Зарегистрирован в ИС ЭСФ</option>
            <option value="draft">Черновик</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div style={{ background: "#fff", border: "1px solid #d9d9d9", borderRadius: 6, overflowX: "auto" }}>
        <table className="enterprise-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "#fafafa", borderBottom: "1px solid #e8e8e8", textAlign: "left" }}>
              <th style={{ padding: "8px 10px" }}>Номер ЭСФ</th>
              <th style={{ padding: "8px 10px" }}>Дата выписки</th>
              <th style={{ padding: "8px 10px" }}>Дата оборота</th>
              <th style={{ padding: "8px 10px" }}>Контрагент</th>
              <th style={{ padding: "8px 10px" }}>БИН / ИИН</th>
              <th style={{ padding: "8px 10px" }}>Статус в ИС ЭСФ</th>
              <th style={{ padding: "8px 10px", textAlign: "right" }}>Без НДС</th>
              <th style={{ padding: "8px 10px", textAlign: "right" }}>НДС (12%)</th>
              <th style={{ padding: "8px 10px", textAlign: "right" }}>Всего с НДС</th>
              <th style={{ padding: "8px 10px", textAlign: "center" }}>Действия</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((inv) => (
              <tr key={inv.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                <td style={{ padding: "8px 10px", fontWeight: 700, color: "#186999" }}>
                  {inv.number}
                  {inv.esf_registration_number && (
                    <div style={{ fontSize: 10, color: "#64748b", fontFamily: "monospace" }}>
                      {inv.esf_registration_number}
                    </div>
                  )}
                </td>
                <td style={{ padding: "8px 10px", color: "#666" }}>{inv.date}</td>
                <td style={{ padding: "8px 10px", color: "#666" }}>{inv.turnover_date}</td>
                <td style={{ padding: "8px 10px", fontWeight: 500 }}>{inv.counterparty_name}</td>
                <td style={{ padding: "8px 10px", color: "#666" }}>{inv.counterparty_bin || "—"}</td>
                <td style={{ padding: "8px 10px" }}>
                  <span
                    style={{
                      padding: "2px 8px",
                      borderRadius: 12,
                      fontSize: 11,
                      fontWeight: 600,
                      background: inv.esf_status === "registered" ? "#dcfce7" : "#e0f2fe",
                      color: inv.esf_status === "registered" ? "#15803d" : "#0369a1",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    {inv.esf_status === "registered" ? (
                      <>
                        <CheckCircle2 size={12} /> Зарегистрирован
                      </>
                    ) : (
                      <>
                        <Clock size={12} /> Черновик
                      </>
                    )}
                  </span>
                </td>
                <td style={{ padding: "8px 10px", textAlign: "right" }}>{fmtMoney(inv.total_without_vat_tiyin)}</td>
                <td style={{ padding: "8px 10px", textAlign: "right", color: "#186999" }}>{fmtMoney(inv.vat_tiyin)}</td>
                <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 700, color: "#0f172a" }}>
                  {fmtMoney(inv.total_tiyin)}
                </td>
                <td style={{ padding: "8px 10px", textAlign: "center" }}>
                  <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
                    {inv.esf_status !== "registered" && (
                      <button
                        onClick={() => void handleRegisterEsf(inv.id)}
                        className="button primary"
                        style={{ padding: "3px 8px", fontSize: 11, background: "#186999" }}
                        title="Отправить и зарегистрировать в ИС ЭСФ"
                      >
                        <Send size={12} style={{ marginRight: 3 }} /> Регистрация
                      </button>
                    )}
                    <button
                      onClick={() => void handleDelete(inv.id)}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "#dc2626", padding: 2 }}
                      title="Удалить"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!filtered.length && (
              <tr>
                <td colSpan={10} style={{ padding: 36, textAlign: "center", color: "#888" }}>
                  Счетов-фактур в реестре не найдено. ЭСФ можно сформировать на основании проведенных заказ-нарядов и накладных.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
