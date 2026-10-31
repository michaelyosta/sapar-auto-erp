import { useState, useEffect } from "react";
import {
  CheckCircle2, Circle, ArrowRight, Building2, Package, Users,
  Wrench, Wallet, Award
} from "lucide-react";

interface StartStats {
  orgConfigured: boolean;
  productsCount: number;
  counterpartiesCount: number;
  vehiclesCount: number;
  documentsCount: number;
  paymentsCount: number;
}

export default function StartPage({ onNavigate }: { onNavigate: (route: string) => void }) {
  const [stats, setStats] = useState<StartStats>({
    orgConfigured: true,
    productsCount: 0,
    counterpartiesCount: 0,
    vehiclesCount: 0,
    documentsCount: 0,
    paymentsCount: 0,
  });

  useEffect(() => {
    void (async () => {
      try {
        const [orgRes, prodRes, cpRes, vehRes, docRes] = await Promise.all([
          fetch("/api/organization"),
          fetch("/api/products"),
          fetch("/api/counterparties"),
          fetch("/api/vehicles"),
          fetch("/api/documents")
        ]);

        const org = orgRes.ok ? await orgRes.json() : null;
        const products = prodRes.ok ? await prodRes.json() : [];
        const counterparties = cpRes.ok ? await cpRes.json() : [];
        const vehicles = vehRes.ok ? await vehRes.json() : [];
        const documents = docRes.ok ? await docRes.json() : [];

        const payments = documents.filter((d: any) => ["incoming_payment", "payment", "cash_in"].includes(d.kind));

        setStats({
          orgConfigured: Boolean(org?.name && org?.bin),
          productsCount: products.length,
          counterpartiesCount: counterparties.length,
          vehiclesCount: vehicles.length,
          documentsCount: documents.length,
          paymentsCount: payments.length,
        });
      } catch {
        // fallback
      }
    })();
  }, []);

  const steps = [
    {
      id: "org",
      title: "1. Настройка реквизитов компании",
      desc: "Укажите официальное наименование ТОО/ИП, БИН, юридический адрес и расчетный счет в банке Казахстана.",
      done: stats.orgConfigured,
      route: "company",
      btnText: "Настройки компании",
      icon: Building2
    },
    {
      id: "products",
      title: "2. Добавление товаров, запчастей и услуг",
      desc: "Настройте номенклатуру: моторные масла, фильтры, колодки и автослесарные работы с ценами и нормами.",
      done: stats.productsCount > 0,
      countLabel: `${stats.productsCount} позиций`,
      route: "products",
      btnText: "Перейти к товарам",
      icon: Package
    },
    {
      id: "crm",
      title: "3. База клиентов и автопарк",
      desc: "Внесите автовладельцев с контактными номерами телефонов, госномерами, марками, VIN и текущим пробегом.",
      done: stats.counterpartiesCount > 0 && stats.vehiclesCount > 0,
      countLabel: `${stats.counterpartiesCount} клиентов, ${stats.vehiclesCount} авто`,
      route: "vehicles",
      btnText: "Открыть автопарк",
      icon: Users
    },
    {
      id: "work_order",
      title: "4. Первый заказ-наряд автосервиса",
      desc: "Создайте рабочий заказ-наряд: укажите причину обращения, пробег, мастера, требуемые детали и проведите документ.",
      done: stats.documentsCount > 0,
      countLabel: `${stats.documentsCount} документов`,
      route: "work_order",
      btnText: "Создать заказ-наряд",
      icon: Wrench
    },
    {
      id: "finance",
      title: "5. Приём оплаты и касса",
      desc: "Оформите входящий платёж через Kaspi QR, POS-терминал или наличными в кассу и сверьте отчет Движение денег.",
      done: stats.paymentsCount > 0,
      countLabel: `${stats.paymentsCount} платежей`,
      route: "cashflow",
      btnText: "Отчет Движение денег",
      icon: Wallet
    }
  ];

  const completedSteps = steps.filter((s) => s.done).length;
  const progressPercent = Math.round((completedSteps / steps.length) * 100);

  return (
    <div className="start-page" style={{ padding: "20px 24px", maxWidth: 960, margin: "0 auto" }}>
      {/* Banner */}
      <div style={{
        background: "linear-gradient(135deg, #186999 0%, #0d4b73 100%)",
        color: "#fff",
        borderRadius: 8,
        padding: "24px 28px",
        marginBottom: 24,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: 16
      }}>
        <div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,0.2)", padding: "3px 10px", borderRadius: 12, fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
            <Award size={14} /> МойСклад · Автокомплекс
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Начало работы с системой</h1>
          <p style={{ margin: "6px 0 0", opacity: 0.9, fontSize: 13, maxWidth: 520 }}>
            Пошаговый план быстрого запуска операционного учета автосервиса: от заполнения реквизитов до проведения первого заказ-наряда и кассового отчета.
          </p>
        </div>
        <div style={{ background: "rgba(255,255,255,0.15)", padding: "16px 20px", borderRadius: 8, textAlign: "center", minWidth: 140 }}>
          <div style={{ fontSize: 28, fontWeight: 800 }}>{progressPercent}%</div>
          <div style={{ fontSize: 12, opacity: 0.85 }}>Выполнено {completedSteps} из {steps.length}</div>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ background: "#e0e0e0", borderRadius: 4, height: 8, overflow: "hidden", marginBottom: 24 }}>
        <div style={{ width: `${progressPercent}%`, background: "#48a43f", height: "100%", transition: "width 0.4s ease" }} />
      </div>

      {/* Steps List */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {steps.map((step) => {
          const Icon = step.icon;
          return (
            <div
              key={step.id}
              style={{
                background: "#fff",
                border: "1px solid #dcdcdc",
                borderRadius: 6,
                padding: "16px 20px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: 14,
                boxShadow: "0 1px 3px rgba(0,0,0,0.03)"
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", gap: 14, flex: "1 1 400px" }}>
                <div style={{ marginTop: 2 }}>
                  {step.done ? (
                    <CheckCircle2 size={22} color="#48a43f" />
                  ) : (
                    <Circle size={22} color="#bbb" />
                  )}
                </div>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "#222" }}>{step.title}</h3>
                    {step.done ? (
                      <span style={{ background: "#e8f5e9", color: "#2e7d32", padding: "1px 7px", borderRadius: 4, fontSize: 11, fontWeight: 600 }}>
                        {step.countLabel ? `Готово · ${step.countLabel}` : "Выполнено"}
                      </span>
                    ) : (
                      <span style={{ background: "#fff3e0", color: "#e65100", padding: "1px 7px", borderRadius: 4, fontSize: 11, fontWeight: 500 }}>
                        Осталось сделать
                      </span>
                    )}
                  </div>
                  <p style={{ margin: "4px 0 0", fontSize: 13, color: "#666", lineHeight: 1.4 }}>
                    {step.desc}
                  </p>
                </div>
              </div>

              <div>
                <button
                  className={`button ${step.done ? "outline" : "primary"}`}
                  onClick={() => onNavigate(step.route)}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}
                >
                  <Icon size={14} />
                  {step.btnText}
                  <ArrowRight size={13} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
