import { useEffect, useState, type FormEvent } from "react";
import { Check, Building2, CreditCard, SlidersHorizontal, Plus, Save, RefreshCw } from "lucide-react";
import { useAuth } from "./AuthGate";

type BankAccount = {
  id: number;
  bik: string;
  bank_name: string;
  bank_address: string;
  corr_account: string;
  account_number: string;
  is_default: number;
  active: number;
};

type OrgSettings = {
  allowNegativeStock?: boolean;
  numberingScheme?: "yearly" | "continuous";
  emailSender?: "employee" | "company";
  trashRetentionDays?: number;
};

type Organization = {
  id: number;
  name: string;
  currency: string;
  code: string;
  phone: string;
  fax: string;
  email: string;
  actual_address: string;
  actual_address_comment: string;
  comment: string;
  director: string;
  director_position: string;
  director_signature_url: string;
  accountant: string;
  accountant_signature_url: string;
  stamp_url: string;
  logo_url: string;
  legal_type: "legal_entity" | "entrepreneur" | "individual";
  legal_name: string;
  legal_address: string;
  legal_address_comment: string;
  bin: string;
  kbe: string;
  oked: string;
  vat_payer: number;
  vat_rate_source: "product" | "constant";
  vat_constant_rate: string;
  vat_advance_rate: string;
  vat_certificate_number: string;
  vat_certificate_date: string;
  cash_balance_tiyin?: number;
  bankAccounts?: BankAccount[];
  settings?: OrgSettings;
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

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function CompanySettingsPage({
  initialTab = "details",
  onNotify,
}: {
  initialTab?: "details" | "bank" | "policies";
  onNotify: (msg: string) => void;
}) {
  const { user } = useAuth();
  const editable = user.role !== "employee";

  const [activeTab, setActiveTab] = useState<"details" | "bank" | "policies">(initialTab);
  const [org, setOrg] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Bank modal state
  const [bankModal, setBankModal] = useState(false);
  const [bankSaving, setBankSaving] = useState(false);
  const [bankError, setBankError] = useState("");

  const loadData = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await request<Organization>("/api/organization");
      setOrg(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить данные организации.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const handleSaveDetails = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editable || !org) return;
    setSaving(true);
    setError("");

    try {
      const form = new FormData(e.currentTarget);
      const payload: Record<string, unknown> = {
        name: form.get("name"),
        code: form.get("code"),
        phone: form.get("phone"),
        fax: form.get("fax"),
        email: form.get("email"),
        actual_address: form.get("actual_address"),
        actual_address_comment: form.get("actual_address_comment"),
        comment: form.get("comment"),
        director: form.get("director"),
        director_position: form.get("director_position"),
        accountant: form.get("accountant"),
        legal_type: form.get("legal_type"),
        legal_name: form.get("legal_name"),
        legal_address: form.get("legal_address"),
        legal_address_comment: form.get("legal_address_comment"),
        bin: form.get("bin"),
        kbe: form.get("kbe"),
        oked: form.get("oked"),
        vat_payer: form.get("vat_payer") === "on" ? 1 : 0,
        vat_rate_source: form.get("vat_rate_source"),
        vat_constant_rate: form.get("vat_constant_rate"),
        vat_advance_rate: form.get("vat_advance_rate"),
        vat_certificate_number: form.get("vat_certificate_number"),
        vat_certificate_date: form.get("vat_certificate_date"),
        director_signature_url: org.director_signature_url,
        accountant_signature_url: org.accountant_signature_url,
        stamp_url: org.stamp_url,
        logo_url: org.logo_url,
        settings: {
          allowNegativeStock: form.get("allowNegativeStock") === "on",
          numberingScheme: form.get("numberingScheme"),
          emailSender: form.get("emailSender"),
          trashRetentionDays: Number(form.get("trashRetentionDays")) || 7,
        },
      };

      const updated = await request<Organization>("/api/organization", {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      setOrg(updated);
      onNotify("Реквизиты и настройки компании сохранены.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить настройки.");
    } finally {
      setSaving(false);
    }
  };

  const handleImageUpload = async (field: "director_signature_url" | "accountant_signature_url" | "stamp_url" | "logo_url", file: File) => {
    if (!file) return;
    try {
      const b64 = await fileToBase64(file);
      setOrg((prev) => (prev ? { ...prev, [field]: b64 } : prev));
      onNotify("Изображение прикреплено. Нажмите «Сохранить» для применения.");
    } catch (err) {
      setError("Не удалось загрузить изображение.");
    }
  };

  const handleCreateBankAccount = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBankSaving(true);
    setBankError("");
    try {
      const form = new FormData(e.currentTarget);
      await request("/api/organization/bank-accounts", {
        method: "POST",
        body: JSON.stringify({
          accountNumber: form.get("accountNumber"),
          bik: form.get("bik"),
          bankName: form.get("bankName"),
          corrAccount: form.get("corrAccount"),
          bankAddress: form.get("bankAddress"),
          isDefault: form.get("isDefault") === "on",
        }),
      });
      setBankModal(false);
      await loadData();
      onNotify("Расчетный счет добавлен.");
    } catch (err) {
      setBankError(err instanceof Error ? err.message : "Не удалось добавить счет.");
    } finally {
      setBankSaving(false);
    }
  };

  const handleSetDefaultAccount = async (id: number) => {
    try {
      await request(`/api/bank-accounts/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ isDefault: true }),
      });
      await loadData();
      onNotify("Основной расчетный счет изменен.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось изменить счет по умолчанию.");
    }
  };

  if (loading) {
    return <div className="page-content"><div className="loading-state">Загрузка данных организации…</div></div>;
  }

  if (!org) {
    return <div className="page-content"><div className="notice-error">{error || "Организация не найдена."}</div></div>;
  }

  return (
    <div className="company-settings-page">
      <div className="page-header">
        <h1>Моя компания · {org.name}</h1>
        <div className="page-actions">
          <button className="button outline" onClick={() => void loadData()} title="Обновить"><RefreshCw size={14} /> Обновить</button>
        </div>
      </div>

      <div className="tab-buttons">
        <button className={activeTab === "details" ? "selected" : ""} onClick={() => setActiveTab("details")}>
          <Building2 size={15} style={{ marginRight: 6 }} />Реквизиты организации
        </button>
        <button className={activeTab === "bank" ? "selected" : ""} onClick={() => setActiveTab("bank")}>
          <CreditCard size={15} style={{ marginRight: 6 }} />Расчетные счета ({org.bankAccounts?.length ?? 0})
        </button>
        <button className={activeTab === "policies" ? "selected" : ""} onClick={() => setActiveTab("policies")}>
          <SlidersHorizontal size={15} style={{ marginRight: 6 }} />Учетная политика и нумерация
        </button>
      </div>

      {error && <div className="notice-error" style={{ margin: "12px 0" }}>{error}</div>}

      {/* TAB 1: Реквизиты и факсимиле */}
      {activeTab === "details" && (
        <form onSubmit={handleSaveDetails} className="product-card-form" style={{ maxWidth: 1040, background: "white", padding: 20, borderRadius: 4, border: "1px solid var(--line)" }}>
          <div className="product-card-section">
            <h3 style={{ borderBottom: "1px solid var(--line)", paddingBottom: 8, margin: "0 0 16px 0", color: "#374151" }}>Основные сведения</h3>
            <div className="form-grid">
              <label>Краткое наименование *<input name="name" defaultValue={org.name} required /></label>
              <label>Внутренний код<input name="code" defaultValue={org.code} placeholder="ORG-01" /></label>
              <label>Телефон<input name="phone" defaultValue={org.phone} placeholder="+7 (727) ..." /></label>
              <label>E-mail<input name="email" type="email" defaultValue={org.email} placeholder="info@company.kz" /></label>
              <label className="span-2">Фактический адрес<textarea name="actual_address" defaultValue={org.actual_address} rows={2} /></label>
              <label className="span-2">Комментарий к адресу<input name="actual_address_comment" defaultValue={org.actual_address_comment} /></label>
            </div>
          </div>

          <div className="product-card-section" style={{ marginTop: 24 }}>
            <h3 style={{ borderBottom: "1px solid var(--line)", paddingBottom: 8, margin: "0 0 16px 0", color: "#374151" }}>Юридические реквизиты</h3>
            <div className="form-grid">
              <label>Тип контрагента
                <select name="legal_type" defaultValue={org.legal_type}>
                  <option value="legal_entity">Юридическое лицо (ТОО / АО / ООО)</option>
                  <option value="entrepreneur">Индивидуальный предприниматель (ИП)</option>
                  <option value="individual">Физическое лицо</option>
                </select>
              </label>
              <label>БИН / ИИН *<input name="bin" defaultValue={org.bin} placeholder="12-значный номер" required /></label>
              <label className="span-2">Полное наименование<textarea name="legal_name" defaultValue={org.legal_name} rows={2} placeholder="Товарищество с ограниченной ответственностью «...»" /></label>
              <label className="span-2">Юридический адрес<textarea name="legal_address" defaultValue={org.legal_address} rows={2} /></label>
              <label>КБе / КПП<input name="kbe" defaultValue={org.kbe} placeholder="Код бенефициара (напр. 17)" /></label>
              <label>ОКЭД / ОКВЭД<input name="oked" defaultValue={org.oked} placeholder="Код вида экономической деятельности" /></label>
            </div>
          </div>

          <div className="product-card-section" style={{ marginTop: 24 }}>
            <h3 style={{ borderBottom: "1px solid var(--line)", paddingBottom: 8, margin: "0 0 16px 0", color: "#374151" }}>Налоговый контур (НДС)</h3>
            <div className="form-grid">
              <label className="span-2" style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <input type="checkbox" name="vat_payer" defaultChecked={Boolean(org.vat_payer)} style={{ width: 18, height: 18 }} />
                <b>Организация является плательщиком НДС</b>
              </label>
              <label>Режим определения ставки НДС
                <select name="vat_rate_source" defaultValue={org.vat_rate_source}>
                  <option value="product">Брать из карточки товара / услуги</option>
                  <option value="constant">Использовать постоянную ставку</option>
                </select>
              </label>
              <label>Постоянная ставка НДС
                <select name="vat_constant_rate" defaultValue={org.vat_constant_rate || "12%"}>
                  <option value="12%">12% (Казахстан)</option>
                  <option value="0%">0%</option>
                  <option value="20%">20% (Россия)</option>
                  <option value="без НДС">Без НДС</option>
                </select>
              </label>
              <label>Номер свидетельства плательщика НДС<input name="vat_certificate_number" defaultValue={org.vat_certificate_number} /></label>
              <label>Дата выдачи свидетельства НДС<input name="vat_certificate_date" type="date" defaultValue={org.vat_certificate_date} /></label>
            </div>
          </div>

          <div className="product-card-section" style={{ marginTop: 24 }}>
            <h3 style={{ borderBottom: "1px solid var(--line)", paddingBottom: 8, margin: "0 0 16px 0", color: "#374151" }}>Ответственные лица и факсимиле (для счетов, актов и заказ-нарядов)</h3>
            <div className="form-grid">
              <label>Руководитель (ФИО)<input name="director" defaultValue={org.director} placeholder="Иванов Иван Иванович" /></label>
              <label>Должность руководителя<input name="director_position" defaultValue={org.director_position} placeholder="Генеральный директор" /></label>
              <label className="span-2">
                Подпись руководителя (прозрачный PNG)
                <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 6 }}>
                  {org.director_signature_url && <img src={org.director_signature_url} alt="Подпись руководителя" style={{ maxHeight: 44, border: "1px solid #cbd8dd", padding: 4, background: "#fafafa" }} />}
                  <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && void handleImageUpload("director_signature_url", e.target.files[0])} />
                </div>
              </label>

              <label>Главный бухгалтер (ФИО)<input name="accountant" defaultValue={org.accountant} placeholder="Петрова Анна Сергеевна" /></label>
              <label>
                Подпись главного бухгалтера
                <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 6 }}>
                  {org.accountant_signature_url && <img src={org.accountant_signature_url} alt="Подпись бухгалтера" style={{ maxHeight: 44, border: "1px solid #cbd8dd", padding: 4, background: "#fafafa" }} />}
                  <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && void handleImageUpload("accountant_signature_url", e.target.files[0])} />
                </div>
              </label>

              <label>
                Оттиск круглой печати
                <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 6 }}>
                  {org.stamp_url && <img src={org.stamp_url} alt="Печать" style={{ maxHeight: 60, border: "1px solid #cbd8dd", padding: 4, background: "#fafafa" }} />}
                  <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && void handleImageUpload("stamp_url", e.target.files[0])} />
                </div>
              </label>

              <label>
                Фирменный логотип
                <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 6 }}>
                  {org.logo_url && <img src={org.logo_url} alt="Логотип" style={{ maxHeight: 60, border: "1px solid #cbd8dd", padding: 4, background: "#fafafa" }} />}
                  <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && void handleImageUpload("logo_url", e.target.files[0])} />
                </div>
              </label>
            </div>
          </div>

          <div style={{ marginTop: 28, display: "flex", justifyContent: "flex-end" }}>
            <button className="button primary" disabled={saving || !editable} style={{ minWidth: 160 }}>
              <Save size={15} style={{ marginRight: 6 }} />{saving ? "Сохранение…" : "Сохранить изменения"}
            </button>
          </div>
        </form>
      )}

      {/* TAB 2: Расчетные счета */}
      {activeTab === "bank" && (
        <div className="table-card responsive-table" style={{ background: "white", padding: 16, borderRadius: 4, border: "1px solid var(--line)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div>
              <h3 style={{ margin: 0 }}>Банковские расчетные счета</h3>
              <small style={{ color: "#6b7280" }}>Используются в печатных формах счетов на оплату и закрывающих документов</small>
            </div>
            {editable && (
              <button className="button primary" onClick={() => { setBankError(""); setBankModal(true); }}>
                <Plus size={14} style={{ marginRight: 4 }} />Расчетный счет
              </button>
            )}
          </div>

          <table>
            <thead>
              <tr>
                <th>Номер счета (IBAN)</th>
                <th>Банк</th>
                <th>БИК</th>
                <th>Корр. счет</th>
                <th>Основной счет</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {(org.bankAccounts ?? []).map((acc) => (
                <tr key={acc.id}>
                  <td data-label="IBAN" className="cell-main"><b>{acc.account_number}</b></td>
                  <td data-label="Банк">{acc.bank_name || "—"}</td>
                  <td data-label="БИК">{acc.bik || "—"}</td>
                  <td data-label="Корр. счет">{acc.corr_account || "—"}</td>
                  <td data-label="Основной">
                    {acc.is_default ? (
                      <span className="status-pill status-posted" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                        <Check size={12} /> Основной
                      </span>
                    ) : (
                      <span style={{ color: "#9ca3af" }}>—</span>
                    )}
                  </td>
                  <td data-label="Действия">
                    {!acc.is_default && editable && (
                      <button className="button outline" style={{ padding: "3px 8px", fontSize: 11 }} onClick={() => void handleSetDefaultAccount(acc.id)}>
                        Сделать основным
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!(org.bankAccounts ?? []).length && (
                <tr>
                  <td colSpan={6} className="empty-inline">Расчетные счета еще не добавлены. Добавьте счет для выставления счетов на оплату.</td>
                </tr>
              )}
            </tbody>
          </table>

          {bankModal && (
            <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setBankModal(false); }}>
              <section className="modal" role="dialog" aria-modal="true" style={{ maxWidth: 540 }}>
                <header>
                  <h2>Новый расчетный счет организации</h2>
                  <button onClick={() => setBankModal(false)}>✕</button>
                </header>
                <form onSubmit={handleCreateBankAccount} className="form-grid" style={{ padding: 18 }}>
                  <label className="span-2">Номер расчетного счета (IBAN) *<input name="accountNumber" placeholder="KZ..." required /></label>
                  <label>БИК банка<input name="bik" placeholder="KZKOKZ22" /></label>
                  <label>Наименование банка<input name="bankName" placeholder="АО «Halyk Bank»" /></label>
                  <label>Корр. счет банка<input name="corrAccount" placeholder="" /></label>
                  <label>Адрес отделения банка<input name="bankAddress" placeholder="г. Алматы" /></label>
                  <label className="span-2" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <input type="checkbox" name="isDefault" defaultChecked style={{ width: 16, height: 16 }} />
                    Сделать основным счетом по умолчанию
                  </label>
                  {bankError && <div className="form-error span-2">{bankError}</div>}
                  <div className="modal-actions span-2">
                    <button type="button" className="button outline" onClick={() => setBankModal(false)}>Отмена</button>
                    <button className="button primary" disabled={bankSaving}>{bankSaving ? "Сохранение…" : "Сохранить"}</button>
                  </div>
                </form>
              </section>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: Учетная политика */}
      {activeTab === "policies" && (
        <form onSubmit={handleSaveDetails} style={{ maxWidth: 840, background: "white", padding: 24, borderRadius: 4, border: "1px solid var(--line)" }}>
          <h3 style={{ borderBottom: "1px solid var(--line)", paddingBottom: 8, margin: "0 0 16px 0", color: "#374151" }}>Глобальные политики учета (МойСклад #companysettings)</h3>

          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
              <input
                type="checkbox"
                name="allowNegativeStock"
                defaultChecked={Boolean(org.settings?.allowNegativeStock)}
                style={{ width: 18, height: 18, marginTop: 2 }}
              />
              <div>
                <b>Запретить отгрузку товаров, которых нет на складе (Контроль отрицательных остатков)</b>
                <div style={{ color: "#6b7280", fontSize: 12, marginTop: 2 }}>
                  Исключает проведение заказ-нарядов и отгрузок запчастей, которые фактически еще не оприходованы на склад.
                </div>
              </div>
            </label>

            <div style={{ marginTop: 10 }}>
              <b>Правила нумерации документов:</b>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13 }}>
                  <input type="radio" name="numberingScheme" value="yearly" defaultChecked={org.settings?.numberingScheme !== "continuous"} />
                  Внутри календарного года (сброс нумерации 1 января, например ЗН-000001/26)
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13 }}>
                  <input type="radio" name="numberingScheme" value="continuous" defaultChecked={org.settings?.numberingScheme === "continuous"} />
                  По порядку за всю историю (сквозная нумерация)
                </label>
              </div>
            </div>

            <div style={{ marginTop: 10 }}>
              <b>Обратный адрес в почтовых уведомлениях:</b>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13 }}>
                  <input type="radio" name="emailSender" value="employee" defaultChecked={org.settings?.emailSender !== "company"} />
                  Адрес сотрудника, который отправляет документ
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13 }}>
                  <input type="radio" name="emailSender" value="company" defaultChecked={org.settings?.emailSender === "company"} />
                  Единый корпоративный email организации ({org.email || "info@..."})
                </label>
              </div>
            </div>

            <div style={{ marginTop: 10 }}>
              <label>
                <b>Хранить удаленные документы в корзине:</b>
                <select name="trashRetentionDays" defaultValue={String(org.settings?.trashRetentionDays ?? 7)} style={{ display: "block", marginTop: 6, width: 220 }}>
                  <option value="7">7 дней (дефолт МойСклад)</option>
                  <option value="14">14 дней</option>
                  <option value="30">30 дней</option>
                </select>
              </label>
            </div>
          </div>

          {/* Hidden fields needed to preserve details during form submit */}
          <input type="hidden" name="name" value={org.name} />
          <input type="hidden" name="code" value={org.code} />
          <input type="hidden" name="phone" value={org.phone} />
          <input type="hidden" name="fax" value={org.fax} />
          <input type="hidden" name="email" value={org.email} />
          <input type="hidden" name="actual_address" value={org.actual_address} />
          <input type="hidden" name="actual_address_comment" value={org.actual_address_comment} />
          <input type="hidden" name="comment" value={org.comment} />
          <input type="hidden" name="director" value={org.director} />
          <input type="hidden" name="director_position" value={org.director_position} />
          <input type="hidden" name="accountant" value={org.accountant} />
          <input type="hidden" name="legal_type" value={org.legal_type} />
          <input type="hidden" name="legal_name" value={org.legal_name} />
          <input type="hidden" name="legal_address" value={org.legal_address} />
          <input type="hidden" name="legal_address_comment" value={org.legal_address_comment} />
          <input type="hidden" name="bin" value={org.bin} />
          <input type="hidden" name="kbe" value={org.kbe} />
          <input type="hidden" name="oked" value={org.oked} />
          <input type="hidden" name="vat_payer" value={org.vat_payer ? "on" : ""} />
          <input type="hidden" name="vat_rate_source" value={org.vat_rate_source} />
          <input type="hidden" name="vat_constant_rate" value={org.vat_constant_rate} />
          <input type="hidden" name="vat_advance_rate" value={org.vat_advance_rate} />
          <input type="hidden" name="vat_certificate_number" value={org.vat_certificate_number} />
          <input type="hidden" name="vat_certificate_date" value={org.vat_certificate_date} />

          <div style={{ marginTop: 28, display: "flex", justifyContent: "flex-end" }}>
            <button className="button primary" disabled={saving || !editable} style={{ minWidth: 160 }}>
              <Save size={15} style={{ marginRight: 6 }} />{saving ? "Сохранение…" : "Сохранить политики"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
