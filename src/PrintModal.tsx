import { useState } from "react";
import { Printer, X, FileText } from "lucide-react";

type Line = {
  id?: number;
  product_name: string;
  product_code?: string;
  unit?: string;
  quantity_units: number;
  unit_price_tiyin: number;
  vat_rate?: string;
  vat_sum_tiyin?: number;
  total_without_vat_tiyin?: number;
};

type DocProps = {
  number: string;
  kind: string;
  date: string;
  counterparty_name?: string;
  vehicle_plate?: string;
  odometer_km?: number | null;
  next_service_km?: number | null;
  total_tiyin: number;
  comment?: string;
  lines: Line[];
};

type OrgProps = {
  name: string;
  legal_name: string;
  bin: string;
  phone: string;
  email: string;
  legal_address: string;
  director: string;
  director_position: string;
  accountant: string;
  stamp_url?: string;
  director_signature_url?: string;
  accountant_signature_url?: string;
  logo_url?: string;
  bankAccounts?: Array<{
    bank_name: string;
    bik: string;
    account_number: string;
    is_default: number;
  }>;
};

const money = (tiyin: number = 0) =>
  new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(tiyin) / 100);

export default function PrintModal({
  doc,
  org,
  onClose,
}: {
  doc: DocProps;
  org: OrgProps;
  onClose: () => void;
}) {
  const [template, setTemplate] = useState<"work_order" | "invoice" | "act" | "torg12" | "check">(
    doc.kind === "work_order" ? "work_order" : doc.kind === "customer_invoice" ? "invoice" : "act"
  );
  const [withFacsimile, setWithFacsimile] = useState(true);

  const defaultAccount = org.bankAccounts?.find((a) => a.is_default) ?? org.bankAccounts?.[0] ?? {
    bank_name: "АО «Halyk Bank»",
    bik: "KZKOKZ22",
    account_number: "KZ123456789012345678",
    is_default: 1,
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="modal print-dialog" role="dialog" aria-modal="true" style={{ maxWidth: 900, width: "95vw", maxHeight: "95vh" }}>
        <header className="no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--line)", padding: "12px 18px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <FileText size={18} />
            <b>Печать документа</b>
            <select
              value={template}
              onChange={(e) => setTemplate(e.target.value as typeof template)}
              style={{ padding: "4px 8px", fontSize: 13, borderRadius: 3, border: "1px solid var(--line)" }}
            >
              <option value="work_order">Заказ-наряд (Автосервис)</option>
              <option value="invoice">Счет на оплату</option>
              <option value="act">Акт выполненных работ (Форма Р-1)</option>
              <option value="torg12">Накладная на отпуск запасов (Форма З-2)</option>
              <option value="check">Товарный чек</option>
            </select>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
              <input type="checkbox" checked={withFacsimile} onChange={(e) => setWithFacsimile(e.target.checked)} />
              Печать и подписи (факсимиле)
            </label>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button className="button primary" onClick={handlePrint} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Printer size={15} /> Печать
            </button>
            <button onClick={onClose} className="link-button" style={{ padding: 6 }}><X size={18} /></button>
          </div>
        </header>

        {/* PRINTABLE SHEET */}
        <div className="printable-sheet" style={{ padding: 32, background: "white", overflowY: "auto", maxHeight: "calc(95vh - 75px)", fontSize: 13, color: "#111827", lineHeight: 1.45 }}>
          {/* TEMPLATE: WORK ORDER */}
          {template === "work_order" && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "2px solid #111827", paddingBottom: 14, marginBottom: 16 }}>
                <div>
                  <h2 style={{ margin: "0 0 4px 0", fontSize: 20 }}>ЗАКАЗ-НАРЯД № {doc.number}</h2>
                  <div style={{ fontSize: 13, color: "#4b5563" }}>от {doc.date} г.</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{org.legal_name || org.name}</div>
                  <div style={{ fontSize: 12 }}>БИН/ИИН: {org.bin} · Тел: {org.phone}</div>
                  <div style={{ fontSize: 12 }}>{org.legal_address}</div>
                </div>
              </div>

              {/* Vehicle & Customer Info */}
              <table style={{ width: "100%", marginBottom: 18, border: "1px solid #d1d5db", borderCollapse: "collapse" }}>
                <tbody>
                  <tr>
                    <td style={{ padding: 8, background: "#f9fafb", width: "20%", border: "1px solid #d1d5db" }}><b>Заказчик:</b></td>
                    <td style={{ padding: 8, border: "1px solid #d1d5db" }}>{doc.counterparty_name || "Розничный покупатель"}</td>
                    <td style={{ padding: 8, background: "#f9fafb", width: "20%", border: "1px solid #d1d5db" }}><b>Гос. номер:</b></td>
                    <td style={{ padding: 8, border: "1px solid #d1d5db" }}><b>{doc.vehicle_plate || "—"}</b></td>
                  </tr>
                  <tr>
                    <td style={{ padding: 8, background: "#f9fafb", border: "1px solid #d1d5db" }}><b>Пробег (текущий):</b></td>
                    <td style={{ padding: 8, border: "1px solid #d1d5db" }}>{doc.odometer_km ? `${Number(doc.odometer_km).toLocaleString("ru-RU")} км` : "—"}</td>
                    <td style={{ padding: 8, background: "#f9fafb", border: "1px solid #d1d5db" }}><b>След. замена масла:</b></td>
                    <td style={{ padding: 8, border: "1px solid #d1d5db" }}>{doc.next_service_km ? `${Number(doc.next_service_km).toLocaleString("ru-RU")} км` : "—"}</td>
                  </tr>
                </tbody>
              </table>

              {/* Items Table */}
              <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 18, border: "1px solid #d1d5db" }}>
                <thead>
                  <tr style={{ background: "#f3f4f6", borderBottom: "1px solid #d1d5db" }}>
                    <th style={{ padding: "6px 8px", width: 30, border: "1px solid #d1d5db" }}>№</th>
                    <th style={{ padding: "6px 8px", textAlign: "left", border: "1px solid #d1d5db" }}>Наименование работ и запчастей</th>
                    <th style={{ padding: "6px 8px", width: 70, border: "1px solid #d1d5db" }}>Кол-во</th>
                    <th style={{ padding: "6px 8px", width: 50, border: "1px solid #d1d5db" }}>Ед.</th>
                    <th style={{ padding: "6px 8px", width: 90, textAlign: "right", border: "1px solid #d1d5db" }}>Цена, ₸</th>
                    <th style={{ padding: "6px 8px", width: 100, textAlign: "right", border: "1px solid #d1d5db" }}>Сумма, ₸</th>
                  </tr>
                </thead>
                <tbody>
                  {doc.lines.map((line, idx) => (
                    <tr key={idx}>
                      <td style={{ padding: "6px 8px", textAlign: "center", border: "1px solid #d1d5db" }}>{idx + 1}</td>
                      <td style={{ padding: "6px 8px", border: "1px solid #d1d5db" }}>{line.product_name}</td>
                      <td style={{ padding: "6px 8px", textAlign: "center", border: "1px solid #d1d5db" }}>{line.quantity_units / 1_000_000}</td>
                      <td style={{ padding: "6px 8px", textAlign: "center", border: "1px solid #d1d5db" }}>{line.unit || "шт"}</td>
                      <td style={{ padding: "6px 8px", textAlign: "right", border: "1px solid #d1d5db" }}>{money(line.unit_price_tiyin)}</td>
                      <td style={{ padding: "6px 8px", textAlign: "right", border: "1px solid #d1d5db", fontWeight: 600 }}>
                        {money(Math.round((line.quantity_units * line.unit_price_tiyin) / 1_000_000))}
                      </td>
                    </tr>
                  ))}
                  <tr style={{ fontWeight: 700, background: "#f9fafb" }}>
                    <td colSpan={5} style={{ padding: "8px 10px", textAlign: "right", border: "1px solid #d1d5db" }}>ВСЕГО К ОПЛАТЕ:</td>
                    <td style={{ padding: "8px 10px", textAlign: "right", border: "1px solid #d1d5db" }}>{money(doc.total_tiyin)} ₸</td>
                  </tr>
                </tbody>
              </table>

              <div style={{ fontSize: 11, color: "#4b5563", marginBottom: 24 }}>
                Работы выполнены в полном объеме, качественно и в срок. Претензий по объему, качеству и срокам выполнения заказчик не имеет.
                Гарантия на выполненные слесарные работы и замену технических жидкостей составляет 30 дней либо 2 000 км пробега.
              </div>

              {/* Signatures & Seal */}
              <div style={{ display: "flex", justifyContent: "space-between", position: "relative", marginTop: 40, paddingTop: 10 }}>
                <div style={{ width: "45%" }}>
                  <div>Мастер-приемщик: _________________ / {org.director || "Администратор"} /</div>
                  {withFacsimile && org.director_signature_url && (
                    <img src={org.director_signature_url} alt="Подпись" style={{ position: "absolute", left: 130, top: -20, height: 44 }} />
                  )}
                </div>
                <div style={{ width: "45%", textAlign: "right" }}>
                  <div>Заказчик: _________________ / {doc.counterparty_name || "Клиент"} /</div>
                </div>

                {withFacsimile && org.stamp_url && (
                  <img src={org.stamp_url} alt="Печать" style={{ position: "absolute", left: 240, top: -35, height: 90, opacity: 0.88 }} />
                )}
              </div>
            </div>
          )}

          {/* TEMPLATE: INVOICE */}
          {template === "invoice" && (
            <div>
              {/* Bank requisites table */}
              <table style={{ width: "100%", border: "2px solid #111827", borderCollapse: "collapse", marginBottom: 16 }}>
                <tbody>
                  <tr>
                    <td style={{ padding: 6, border: "1px solid #9ca3af", width: "65%" }}>
                      Банк получателя: <b>{defaultAccount.bank_name}</b>
                    </td>
                    <td style={{ padding: 6, border: "1px solid #9ca3af" }}>БИК: <b>{defaultAccount.bik}</b></td>
                  </tr>
                  <tr>
                    <td style={{ padding: 6, border: "1px solid #9ca3af" }}>
                      Получатель: <b>{org.legal_name || org.name}</b><br />
                      БИН: <b>{org.bin}</b>
                    </td>
                    <td style={{ padding: 6, border: "1px solid #9ca3af" }}>
                      Сч. № (IBAN):<br />
                      <b>{defaultAccount.account_number}</b>
                    </td>
                  </tr>
                </tbody>
              </table>

              <h2 style={{ fontSize: 18, margin: "16px 0 10px 0" }}>СЧЕТ НА ОПЛАТУ № {doc.number} от {doc.date} г.</h2>

              <div style={{ marginBottom: 14 }}>
                <div><b>Поставщик:</b> {org.legal_name || org.name}, БИН {org.bin}, {org.legal_address}, тел: {org.phone}</div>
                <div style={{ marginTop: 4 }}><b>Покупатель:</b> {doc.counterparty_name || "Розничный покупатель"}</div>
              </div>

              {/* Items */}
              <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 18, border: "1px solid #d1d5db" }}>
                <thead>
                  <tr style={{ background: "#f3f4f6" }}>
                    <th style={{ padding: 6, border: "1px solid #d1d5db" }}>№</th>
                    <th style={{ padding: 6, textAlign: "left", border: "1px solid #d1d5db" }}>Товары (работы, услуги)</th>
                    <th style={{ padding: 6, width: 60, border: "1px solid #d1d5db" }}>Кол-во</th>
                    <th style={{ padding: 6, width: 45, border: "1px solid #d1d5db" }}>Ед.</th>
                    <th style={{ padding: 6, width: 85, textAlign: "right", border: "1px solid #d1d5db" }}>Цена</th>
                    <th style={{ padding: 6, width: 100, textAlign: "right", border: "1px solid #d1d5db" }}>Сумма</th>
                  </tr>
                </thead>
                <tbody>
                  {doc.lines.map((l, i) => (
                    <tr key={i}>
                      <td style={{ padding: 6, textAlign: "center", border: "1px solid #d1d5db" }}>{i + 1}</td>
                      <td style={{ padding: 6, border: "1px solid #d1d5db" }}>{l.product_name}</td>
                      <td style={{ padding: 6, textAlign: "center", border: "1px solid #d1d5db" }}>{l.quantity_units / 1_000_000}</td>
                      <td style={{ padding: 6, textAlign: "center", border: "1px solid #d1d5db" }}>{l.unit || "шт"}</td>
                      <td style={{ padding: 6, textAlign: "right", border: "1px solid #d1d5db" }}>{money(l.unit_price_tiyin)}</td>
                      <td style={{ padding: 6, textAlign: "right", border: "1px solid #d1d5db", fontWeight: 600 }}>
                        {money(Math.round((l.quantity_units * l.unit_price_tiyin) / 1_000_000))}
                      </td>
                    </tr>
                  ))}
                  <tr style={{ fontWeight: 700 }}>
                    <td colSpan={5} style={{ padding: 6, textAlign: "right", border: "1px solid #d1d5db" }}>Итого:</td>
                    <td style={{ padding: 6, textAlign: "right", border: "1px solid #d1d5db" }}>{money(doc.total_tiyin)} ₸</td>
                  </tr>
                </tbody>
              </table>

              <div style={{ position: "relative", marginTop: 40 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <div>Руководитель: ______________ / {org.director || "Руководитель"} /</div>
                  <div>Бухгалтер: ______________ / {org.accountant || "Бухгалтер"} /</div>
                </div>
                {withFacsimile && org.director_signature_url && (
                  <img src={org.director_signature_url} alt="Подпись директора" style={{ position: "absolute", left: 100, top: -20, height: 44 }} />
                )}
                {withFacsimile && org.stamp_url && (
                  <img src={org.stamp_url} alt="Печать" style={{ position: "absolute", left: 240, top: -35, height: 85, opacity: 0.88 }} />
                )}
              </div>
            </div>
          )}

          {/* TEMPLATE: ACT (Р-1) */}
          {template === "act" && (
            <div>
              <div style={{ textAlign: "right", fontSize: 11, marginBottom: 8 }}>
                Приложение 50<br />к приказу Министра финансов РК<br />Форма Р-1
              </div>
              <h2 style={{ textAlign: "center", fontSize: 16, margin: "0 0 14px 0" }}>АКТ ВЫПОЛНЕННЫХ РАБОТ (ОКАЗАННЫХ УСЛУГ) № {doc.number} от {doc.date} г.</h2>
              <div style={{ marginBottom: 12, fontSize: 12 }}>
                <div><b>Исполнитель:</b> {org.legal_name || org.name}, БИН {org.bin}, {org.legal_address}</div>
                <div style={{ marginTop: 4 }}><b>Заказчик:</b> {doc.counterparty_name || "Розничный покупатель"}</div>
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 16, border: "1px solid #d1d5db", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#f3f4f6" }}>
                    <th style={{ padding: 6, border: "1px solid #d1d5db" }}>№</th>
                    <th style={{ padding: 6, textAlign: "left", border: "1px solid #d1d5db" }}>Наименование работ (услуг)</th>
                    <th style={{ padding: 6, width: 70, border: "1px solid #d1d5db" }}>Объем</th>
                    <th style={{ padding: 6, width: 85, textAlign: "right", border: "1px solid #d1d5db" }}>Цена, ₸</th>
                    <th style={{ padding: 6, width: 95, textAlign: "right", border: "1px solid #d1d5db" }}>Стоимость, ₸</th>
                  </tr>
                </thead>
                <tbody>
                  {doc.lines.map((l, i) => (
                    <tr key={i}>
                      <td style={{ padding: 6, textAlign: "center", border: "1px solid #d1d5db" }}>{i + 1}</td>
                      <td style={{ padding: 6, border: "1px solid #d1d5db" }}>{l.product_name}</td>
                      <td style={{ padding: 6, textAlign: "center", border: "1px solid #d1d5db" }}>{l.quantity_units / 1_000_000}</td>
                      <td style={{ padding: 6, textAlign: "right", border: "1px solid #d1d5db" }}>{money(l.unit_price_tiyin)}</td>
                      <td style={{ padding: 6, textAlign: "right", border: "1px solid #d1d5db" }}>
                        {money(Math.round((l.quantity_units * l.unit_price_tiyin) / 1_000_000))}
                      </td>
                    </tr>
                  ))}
                  <tr style={{ fontWeight: 700 }}>
                    <td colSpan={4} style={{ padding: 6, textAlign: "right", border: "1px solid #d1d5db" }}>Всего выполнено на сумму:</td>
                    <td style={{ padding: 6, textAlign: "right", border: "1px solid #d1d5db" }}>{money(doc.total_tiyin)} ₸</td>
                  </tr>
                </tbody>
              </table>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 36, position: "relative" }}>
                <div>Сдал (Исполнитель): ____________ / {org.director || "Директор"} /</div>
                <div>Принял (Заказчик): ____________ / {doc.counterparty_name || "Заказчик"} /</div>
                {withFacsimile && org.stamp_url && (
                  <img src={org.stamp_url} alt="Печать" style={{ position: "absolute", left: 160, top: -30, height: 75, opacity: 0.88 }} />
                )}
              </div>
            </div>
          )}

          {/* TEMPLATE: TORG-12 / Z-2 */}
          {template === "torg12" && (
            <div>
              <div style={{ textAlign: "right", fontSize: 11, marginBottom: 8 }}>Форма З-2 / ТОРГ-12</div>
              <h2 style={{ textAlign: "center", fontSize: 16, margin: "0 0 14px 0" }}>НАКЛАДНАЯ НА ОТПУСК ЗАПАСОВ НА СТОРОНУ № {doc.number} от {doc.date} г.</h2>
              <div style={{ marginBottom: 12, fontSize: 12 }}>
                <div><b>Организация (отправитель):</b> {org.legal_name || org.name}, БИН {org.bin}</div>
                <div><b>Получатель:</b> {doc.counterparty_name || "Розничный покупатель"}</div>
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 16, border: "1px solid #d1d5db", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#f3f4f6" }}>
                    <th style={{ padding: 6, border: "1px solid #d1d5db" }}>№</th>
                    <th style={{ padding: 6, textAlign: "left", border: "1px solid #d1d5db" }}>Наименование товара, сорт, артикул</th>
                    <th style={{ padding: 6, width: 60, border: "1px solid #d1d5db" }}>Кол-во</th>
                    <th style={{ padding: 6, width: 85, textAlign: "right", border: "1px solid #d1d5db" }}>Цена</th>
                    <th style={{ padding: 6, width: 95, textAlign: "right", border: "1px solid #d1d5db" }}>Сумма</th>
                  </tr>
                </thead>
                <tbody>
                  {doc.lines.map((l, i) => (
                    <tr key={i}>
                      <td style={{ padding: 6, textAlign: "center", border: "1px solid #d1d5db" }}>{i + 1}</td>
                      <td style={{ padding: 6, border: "1px solid #d1d5db" }}>{l.product_name}</td>
                      <td style={{ padding: 6, textAlign: "center", border: "1px solid #d1d5db" }}>{l.quantity_units / 1_000_000}</td>
                      <td style={{ padding: 6, textAlign: "right", border: "1px solid #d1d5db" }}>{money(l.unit_price_tiyin)}</td>
                      <td style={{ padding: 6, textAlign: "right", border: "1px solid #d1d5db" }}>
                        {money(Math.round((l.quantity_units * l.unit_price_tiyin) / 1_000_000))}
                      </td>
                    </tr>
                  ))}
                  <tr style={{ fontWeight: 700 }}>
                    <td colSpan={4} style={{ padding: 6, textAlign: "right", border: "1px solid #d1d5db" }}>ИТОГО:</td>
                    <td style={{ padding: 6, textAlign: "right", border: "1px solid #d1d5db" }}>{money(doc.total_tiyin)} ₸</td>
                  </tr>
                </tbody>
              </table>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 36, position: "relative" }}>
                <div>Отпуск разрешил: ____________ / {org.director || "Директор"} /</div>
                <div>Груз получил: ____________ / {doc.counterparty_name || "Покупатель"} /</div>
                {withFacsimile && org.stamp_url && (
                  <img src={org.stamp_url} alt="Печать" style={{ position: "absolute", left: 160, top: -30, height: 75, opacity: 0.88 }} />
                )}
              </div>
            </div>
          )}

          {/* TEMPLATE: CASH CHECK */}
          {template === "check" && (
            <div style={{ maxWidth: 360, margin: "0 auto", border: "1px dashed #9ca3af", padding: 18, fontFamily: "monospace" }}>
              <div style={{ textAlign: "center", marginBottom: 12 }}>
                <b>{org.name}</b><br />
                {org.legal_name}<br />
                БИН: {org.bin}<br />
                {org.legal_address}<br />
                --------------------------------
              </div>
              <div style={{ marginBottom: 10 }}>
                ЧЕК № {doc.number}<br />
                ДАТА: {doc.date}<br />
                КЛИЕНТ: {doc.counterparty_name || "Розничный покупатель"}<br />
                --------------------------------
              </div>
              {doc.lines.map((l, i) => (
                <div key={i} style={{ marginBottom: 6 }}>
                  <div>{l.product_name}</div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>{l.quantity_units / 1_000_000} x {money(l.unit_price_tiyin)}</span>
                    <b>{money(Math.round((l.quantity_units * l.unit_price_tiyin) / 1_000_000))} ₸</b>
                  </div>
                </div>
              ))}
              <div style={{ borderTop: "1px dashed #9ca3af", paddingTop: 8, marginTop: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, fontWeight: 700 }}>
                  <span>ИТОГ:</span>
                  <span>{money(doc.total_tiyin)} ₸</span>
                </div>
              </div>
              <div style={{ textAlign: "center", marginTop: 14, fontSize: 11 }}>
                СПАСИБО ЗА ПОКУПКУ!<br />
                ФИСКАЛЬНЫЙ ДОКУМЕНТ
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
