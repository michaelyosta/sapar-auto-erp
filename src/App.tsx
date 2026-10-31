import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent as ReactMouseEvent } from "react";
import {
  Activity, Archive, Bell, Boxes, BriefcaseBusiness, CalendarDays,
  CarFront, Check, ChevronDown, CircleHelp, ClipboardList, Coins, FileClock, FileText, Filter,
  Folder, FolderOpen, Pencil, Trash2,
  Gauge, Home, Layers, List, Menu, Package, Plus, Search, Settings, ShoppingBag, ShoppingCart,
  Store, Truck, UsersRound, Wallet, Wrench, X,
} from "lucide-react";
import PriceListsPage from "./PriceListsPage";
import CompanySettingsPage from "./CompanySettingsPage";
import RetailPage from "./RetailPage";
import AuditPage from "./AuditPage";
import TrashPage from "./TrashPage";
import FinanceReportsPage from "./FinanceReportsPage";
import TurnoverReportPage from "./TurnoverReportPage";
import PayrollPage from "./PayrollPage";
import DiscountsPage from "./DiscountsPage";
import PurchaseAnalyticsPage from "./PurchaseAnalyticsPage";
import TaxInvoicesPage from "./TaxInvoicesPage";
import SalesFunnelPage from "./SalesFunnelPage";
import ScriptsPage from "./ScriptsPage";
import FilesPage from "./FilesPage";
import StartPage from "./StartPage";
import PrintModal from "./PrintModal";
import { useAuth } from "./AuthGate";

type MenuItem = { label: string; route: string };
type Module = { label: string; icon: typeof Home; route: string; items: MenuItem[] };
type Product = {
  id: number; code: string; name: string; kind: "product" | "service"; unit: string;
  purchase_price_tiyin: number; sale_price_tiyin: number; min_stock_units: number;
  stock_units: number; stock_value_tiyin: number; reserved_units: number; available_units: number; active: number;
  article?: string; external_code?: string; description?: string; group_id?: number | null; group_name?: string; country?: string; supplier_id?: number | null; supplier_name?: string;
  weight_milli?: number; volume_milli?: number; vat_rate?: string; minimum_price_tiyin?: number; retail_discount_allowed?: number;
  min_stock_mode?: string; is_low_stock?: number; ntin?: string; traceable?: number; marking?: string; product_type?: string; tax_system?: string;
  packaging_unit?: string; accounting_type?: string; calculation_subject?: string; access_employee?: string; access_department?: string; shared_access?: number;
};
type ProductGroup = { id: number; parent_id: number | null; name: string; description: string; code: string; external_code: string; vat_rate: string; tax_system: string; product_count: number; child_count: number };
type ProductGroupEditor = { id?: number; parentId: number | null; name: string; description: string; code: string; externalCode: string; vatRate: string; taxSystem: string };
function productGroupPath(groupId: number, groups: ProductGroup[]): string {
  const parts: string[] = [];
  const visited = new Set<number>();
  let group = groups.find((item) => item.id === groupId);
  while (group && !visited.has(group.id)) {
    visited.add(group.id); parts.unshift(group.name);
    group = group.parent_id == null ? undefined : groups.find((item) => item.id === group!.parent_id);
  }
  return parts.join(" / ");
}
type ProductCard = Product & {
  barcodes: Array<{ id?: number; barcodeType: string; barcode: string }>;
  packaging: Array<{ id?: number; name: string; quantity: number; unit: string; codeType: string; barcode: string }>;
  relations: Array<{ relationType: string; relatedProductId: number; relatedProductName: string; relatedProductCode: string }>;
  warehouses: Array<{ warehouse_id: number; warehouse_name: string; stock_units: number; reserved_units: number; available_units: number; min_stock_units: number }>;
  history: Array<{ id: number; action: string; detail: string; created_at: string }>;
  movements: Array<{ id: number; number: string; kind: string; status: string; warehouse_name: string; quantity_units: number; value_tiyin: number; created_at: string }>;
  priceTiers: Array<{ id: number; name: string; priceTiyin: number; currency: string }>;
  files: Array<{ id: number; fileKind: "image" | "file"; fileName: string; mimeType: string; size: number; createdAt: string }>;
};
type PendingProductFile = { file: File; fileKind: "image" | "file" };
type Counterparty = { id: number; name: string; kind: string; phone: string; email: string };
type Vehicle = { id: number; counterparty_id: number; counterparty_name?: string; plate: string; make: string; model: string; year?: number; vin: string; current_mileage: number; next_service_km?: number | null };
type VehicleServiceLine = { id: number; product_name: string; product_code: string; unit: string; quantity_units: number; unit_price_tiyin: number };
type VehicleServiceOrder = { id: number; number: string; status: string; date: string; odometer_km?: number | null; next_service_km?: number | null; warehouse_name?: string; total_tiyin: number; comment: string; lines: VehicleServiceLine[] };
type VehicleDetail = Vehicle & { counterparty_phone?: string; initial_mileage: number; service_history: VehicleServiceOrder[] };
type Contract = {
  id: number;
  organization_id: number;
  counterparty_id: number;
  number: string;
  date: string;
  due_date?: string;
  currency: string;
  sum_tiyin: number;
  comment?: string;
  active: number;
};
type DocumentRow = {
  id: number; number: string; kind: string; status: string; date: string;
  status_name?: string; contract_number?: string; contract_id?: number | null;
  shipped_percent?: number; paid_percent?: number; delivery_address?: string; is_vat_included?: number;
  counterparty_id?: number | null; counterparty_name?: string; vehicle_plate?: string; odometer_km?: number; next_service_km?: number; warehouse_name?: string; destination_warehouse_name?: string;
  parent_document_number?: string; payment_method?: string; updated_at?: string; total_tiyin: number; line_count: number; paid_tiyin?: number; outstanding_tiyin?: number;
};
type Warehouse = {
  id: number; name: string; address: string; address_comment?: string; comment?: string; code?: string;
  external_code?: string; parent_id?: number | null; parent_name?: string | null; active?: number;
  department_id?: number | null; department_name?: string | null;
};
type Department = { id: number; organization_id: number; name: string; active: number };
type PriceListSummary = { id: number; name: string; price_type: string; active: number };
type PriceListForDocument = PriceListSummary & {
  columns: Array<{ id: number; name: string; position: number }>;
  items: Array<{ product_id: number; prices: Array<number | null> }>;
};
type StockRow = { product_id: number; code: string; product_name: string; unit: string; warehouse_id: number; warehouse_name: string; stock_units: number; reserved_units: number; available_units: number; stock_value_tiyin: number };
type DocumentDetail = DocumentRow & {
  comment: string; destination_warehouse_name?: string; parent_document_number?: string;
  paymentAllocations?: Array<{ document_id: number; number: string; amount_tiyin: number }>;
  lines: Array<{
    id: number; product_name: string; product_code: string; unit: string;
    quantity_units: number; unit_price_tiyin: number;
    discount_bps?: number; vat_rate?: string; vat_sum_tiyin?: number; total_without_vat_tiyin?: number;
  }>;
};

const modules: Module[] = [
  { label: "Моя компания", icon: BriefcaseBusiness, route: "dashboard", items: [
    { label: "Показатели", route: "dashboard" }, { label: "Настройки компании", route: "company" },
    { label: "Юр. лица", route: "legalentities" }, { label: "Сотрудники", route: "employees" }, { label: "Подразделения", route: "departments" },
    { label: "Документы", route: "documents" }, { label: "Корзина", route: "trash" },
    { label: "Сценарии", route: "scripts" }, { label: "Аудит", route: "audit" },
    { label: "Файлы", route: "files" }, { label: "Начало работы", route: "start" },
  ] },
  { label: "Закупки", icon: ShoppingCart, route: "purchaseorder", items: [
    { label: "Заказы поставщикам", route: "purchaseorder" }, { label: "Счета поставщиков", route: "supplierinvoice" },
    { label: "Приемки", route: "receipt" }, { label: "Возвраты поставщикам", route: "supplierreturn" },
    { label: "Счета-фактуры полученные", route: "invoicesreceived" }, { label: "Управление закупками", route: "purchaseanalytics" },
    { label: "Обучение", route: "training" },
  ] },
  { label: "Продажи", icon: ShoppingBag, route: "customerorder", items: [
    { label: "Заказы покупателей", route: "customerorder" }, { label: "Заказ-наряды", route: "work_order" }, { label: "Счета покупателям", route: "customerinvoice" },
    { label: "Отгрузки", route: "shipment" }, { label: "Отчеты комиссионера", route: "commissionreport" },
    { label: "Возвраты покупателей", route: "customerreturn" }, { label: "Счета-фактуры выданные", route: "invoicesissued" },
    { label: "Прибыльность", route: "profitability" }, { label: "Товары на реализации", route: "consignment" },
    { label: "Воронка продаж", route: "salesfunnel" }, { label: "Юнит-экономика", route: "unitmetrics" },
    { label: "Обучение", route: "training" },
  ] },
  { label: "Товары", icon: Package, route: "products", items: [
    { label: "Товары и услуги", route: "products" }, { label: "Прайс-листы", route: "pricelists" },
    { label: "Серийные номера", route: "serials" },
  ] },
  { label: "CRM", icon: UsersRound, route: "counterparties", items: [
    { label: "Клиенты", route: "counterparties" }, { label: "Автомобили", route: "vehicles" }, { label: "Договоры", route: "contracts" },
    { label: "Звонки", route: "calls" }, { label: "Скидки", route: "discounts" },
    { label: "Операции с баллами", route: "loyalty" }, { label: "Обучение", route: "training" },
  ] },
  { label: "Склад", icon: Boxes, route: "stock", items: [
    { label: "Оприходования", route: "stockin" }, { label: "Списания", route: "writeoff" },
    { label: "Перемещения", route: "transfer" }, { label: "Инвентаризации", route: "stocktake" },
    { label: "Волны отбора", route: "pickingwaves" }, { label: "Внутренние заказы", route: "internalorders" },
    { label: "Остатки", route: "stock" }, { label: "Обороты", route: "turnover" },
    { label: "Склады", route: "warehouses" }, { label: "Обучение", route: "training" },
  ] },
  { label: "Деньги", icon: Wallet, route: "payments", items: [
    { label: "Платежи", route: "payments" }, { label: "Движение денежных средств", route: "cashflow" },
    { label: "Прибыли и убытки", route: "pnl" }, { label: "Взаиморасчёты", route: "settlements" },
    { label: "Начисления зарплаты", route: "payroll" }, { label: "Корректировки", route: "cashadjustments" },
  ] },
  { label: "Розница", icon: Store, route: "retail", items: [
    { label: "Точки продаж", route: "pos" }, { label: "Смены", route: "shifts" },
    { label: "Продажи", route: "retailsales" }, { label: "Возвраты", route: "retailreturns" },
    { label: "Внесения", route: "cashin" }, { label: "Выплаты", route: "cashout" },
    { label: "Предоплаты", route: "prepayments" }, { label: "Возвраты предоплат", route: "prepaymentreturns" },
    { label: "Расчёты с покупателями", route: "customerbalances" }, { label: "Возвраты авансов", route: "advanceReturns" },
    { label: "Действия кассира", route: "cashieractions" }, { label: "Очередь облачных чеков", route: "receiptqueue" },
  ] },
  { label: "Онлайн-торговля", icon: Gauge, route: "ecommerce", items: [
    { label: "Управление", route: "ecommerce" }, { label: "Онлайн-торговлей", route: "ecommerceconnectors" },
    { label: "Обучение", route: "training" },
  ] },
  { label: "Производство", icon: Wrench, route: "production", items: [
    { label: "Техкарты", route: "routes" }, { label: "Заказы на производство", route: "productionorders" },
    { label: "Техоперации", route: "operations" }, { label: "Производственные задания", route: "productiontasks" },
    { label: "Выполнение этапов", route: "productionstages" }, { label: "Оплата труда", route: "labor" },
    { label: "Техпроцессы", route: "processes" }, { label: "Этапы", route: "stages" },
    { label: "Статус производства", route: "productionstatus" }, { label: "Обучение", route: "training" },
  ] },
  { label: "Задачи", icon: ClipboardList, route: "tasks", items: [
    { label: "Задачи", route: "tasks" },
  ] },
  { label: "Решения", icon: Layers, route: "apps", items: [
    { label: "Каталог решений", route: "apps" },
  ] },
];

const pageTitles: Record<string, string> = Object.fromEntries(modules.flatMap((module) => module.items.map((item) => [item.route, item.label])));
const employeeAllowedRoutes = new Set(["products", "pricelists", "counterparties", "vehicles", "stock", "work_order"]);
const networkWideRoutes = new Set(["dashboard", "cashflow", "pnl", "settlements", "customersbalancelist", "turnover", "payroll", "retail", "pos", "retailsales", "shifts", "retailreturns", "purchaseanalytics", "invoicesissued", "invoicesreceived", "salesfunnel", "profitability", "audit", "trash", "recyclebin", "scripts", "files", "company", "legalentities", "tax-invoices", "start", "pricelists"]);
const canonicalRoute = (route: string) => route === "vehicle_detail" ? "vehicles" : route === "counterparty_detail" ? "counterparties" : route;
const isOrganizationAdmin = (role: string) => role === "owner" || role === "admin";
const fallbackRouteForRole = (role: string) => isOrganizationAdmin(role) ? "dashboard" : "work_order";
const routeAllowedForRole = (role: string, route: string) => {
  const canonical = canonicalRoute(route);
  if (["employees", "departments"].includes(canonical)) return isOrganizationAdmin(role);
  if (!isOrganizationAdmin(role) && networkWideRoutes.has(canonical)) return false;
  return role !== "employee" || employeeAllowedRoutes.has(canonical);
};
const money = (tiyin: number | string = 0) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(Number(tiyin) / 100);
const tiyinInput = (tiyin: number) => `${Math.trunc(tiyin / 100)}.${String(tiyin % 100).padStart(2, "0")}`;
const qty = (units: number | string = 0) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 6 }).format(Number(units) / 1_000_000);
const roleLabel = (role: string) => ({ owner: "Владелец", admin: "Администратор", manager: "Менеджер", employee: "Сотрудник" } as Record<string, string>)[role] ?? "Сотрудник";
const localDateValue = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const request = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const data = await response.json();
  if (!response.ok) { const error = new Error(data.error ?? "Ошибка запроса") as Error & { status?: number }; error.status = response.status; throw error; }
  return data as T;
};

async function fileBase64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

const imageMimeByExtension: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", avif: "image/avif" };
function imageMimeFor(file: File): string {
  const mimeType = file.type.toLowerCase();
  if (["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif"].includes(mimeType)) return mimeType;
  if (mimeType) return "";
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return imageMimeByExtension[extension] ?? "";
}

function App() {
  const { user, logout, changePassword } = useAuth();
  const initialLocation = window.location.hash.replace(/^#\/?/, "") || "dashboard";
  const initialRoute = initialLocation.split("?")[0] || "dashboard";
  const [route, setRoute] = useState(() => routeAllowedForRole(user.role, initialRoute) ? initialRoute : fallbackRouteForRole(user.role));
  const [location, setLocation] = useState(initialLocation);
  const [openModule, setOpenModule] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState({ left: 60, top: 99 });
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileModule, setMobileModule] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [showAccount, setShowAccount] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const navigationGuardRef = useRef<NavigationGuard | null>(null);
  const locationRef = useRef(initialLocation);
  const routeRef = useRef(route);
  routeRef.current = route;
  const visibleModules = modules.map((module) => ({ ...module, items: module.items.filter((item) => routeAllowedForRole(user.role, item.route)) })).filter((module) => module.items.length);
  const accessibleModuleLabels = new Set(visibleModules.map((module) => module.label));
  const navigationRoute = canonicalRoute(route);
  const currentModule = visibleModules.find((module) => module.items.some((item) => item.route === navigationRoute)) ?? visibleModules[0];
  const mobileTabs: Array<{ label: string; route?: string; icon: typeof Home; more?: boolean }> = !isOrganizationAdmin(user.role)
    ? [
        { label: "Наряды", route: "work_order", icon: Wrench },
        { label: "Товары", route: "products", icon: Package },
        { label: "Клиенты", route: "counterparties", icon: UsersRound },
        { label: "Авто", route: "vehicles", icon: CarFront },
        { label: "Ещё", icon: Menu, more: true },
      ]
    : [
        { label: "Показатели", route: "dashboard", icon: Home },
        { label: "Наряды", route: "work_order", icon: Wrench },
        { label: "Товары", route: "products", icon: Package },
        { label: "Клиенты", route: "counterparties", icon: UsersRound },
        { label: "Ещё", icon: Menu, more: true },
      ];
  const mobileTabActive = (tab: { route?: string; more?: boolean }) => {
    if (tab.more) return mobileMenuOpen;
    if (tab.route === "dashboard") return route === "dashboard";
    if (tab.route === "work_order") return route === "work_order";
    if (tab.route === "products") return currentModule?.label === "Товары";
    if (tab.route === "counterparties") return currentModule?.label === "CRM";
    if (tab.route === "vehicles") return route === "vehicles" || route === "vehicle_detail";
    return false;
  };
  const openMobileMenu = () => {
    setShowAccount(false);
    setMobileModule(currentModule?.label ?? visibleModules[0]?.label ?? null);
    setMobileMenuOpen(true);
  };

  useEffect(() => {
    const update = () => {
      const nextLocation = window.location.hash.replace(/^#\/?/, "") || "dashboard";
      if (nextLocation === locationRef.current) return;
      const next = nextLocation.split("?")[0] || "dashboard";
      if (navigationGuardRef.current?.(nextLocation)) {
        window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}#${locationRef.current}`);
        return;
      }
      if (!routeAllowedForRole(user.role, next)) {
        const fallbackRoute = fallbackRouteForRole(user.role);
        window.location.hash = `#${fallbackRoute}`;
        locationRef.current = fallbackRoute;
        routeRef.current = fallbackRoute;
        setLocation(fallbackRoute);
        setRoute(fallbackRoute);
        return;
      }
      locationRef.current = nextLocation;
      setLocation(nextLocation);
      if (next === routeRef.current) return;
      routeRef.current = next;
      setRoute(next);
    };
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, [user.role]);

  const commitNavigation = useCallback((next: string) => {
    const nextLocation = next.replace(/^#\/?/, "") || "dashboard";
    const nextRoute = nextLocation.split("?")[0] || "dashboard";
    locationRef.current = nextLocation;
    routeRef.current = nextRoute;
    setLocation(nextLocation);
    window.location.hash = `#${nextLocation}`;
    setRoute(nextRoute);
    setOpenModule(null);
  }, []);
  const registerNavigationGuard = useCallback((guard: NavigationGuard | null) => { navigationGuardRef.current = guard; }, []);
  const navigate = useCallback((next: string) => {
    if (next === locationRef.current) { setOpenModule(null); return; }
    if (!routeAllowedForRole(user.role, next.split("?")[0])) return;
    if (navigationGuardRef.current?.(next)) return;
    commitNavigation(next);
  }, [commitNavigation, user.role]);
  useEffect(() => {
    const fallbackRoute = fallbackRouteForRole(user.role);
    if (!routeAllowedForRole(user.role, route)) { navigate(fallbackRoute); return; }
    const locationRoute = locationRef.current.split("?")[0] || "dashboard";
    if (!routeAllowedForRole(user.role, locationRoute)) {
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}#${route}`);
      locationRef.current = route;
      routeRef.current = route;
    }
  }, [navigate, route, user.role]);
  useEffect(() => { setMobileMenuOpen(false); setShowAccount(false); }, [location]);
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setMobileMenuOpen(false); };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", closeOnEscape); };
  }, [mobileMenuOpen]);
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 701px)");
    const closeOnDesktop = () => { if (desktop.matches) setMobileMenuOpen(false); };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);
  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 2800); };
  const toggleModuleMenu = (event: ReactMouseEvent<HTMLButtonElement>, label: string) => {
    if (openModule === label) { setOpenModule(null); return; }
    const rect = event.currentTarget.getBoundingClientRect();
    const menuWidth = 270;
    const viewportPadding = 8;
    let left = rect.left;
    if (left + menuWidth > window.innerWidth - viewportPadding) left = rect.right - menuWidth;
    left = Math.max(viewportPadding, left);
    setMenuPosition({ left: left + window.scrollX, top: rect.bottom + window.scrollY });
    setOpenModule(label);
  };

  return <div className="app-shell">
    <div className="subscription-banner"><span className="banner-mark">✦</span><strong><span className="banner-long">Учёт автосервиса · товары, автомобили и заказ-наряды</span><span className="banner-short">Учёт автосервиса</span></strong><button onClick={() => navigate("work_order")}><span className="banner-button-long">Создать заказ-наряд</span><span className="banner-button-short">Заказ-наряд</span></button></div>
    <header className="main-nav">
      <button className="mobile-menu-toggle" aria-label={mobileMenuOpen ? "Закрыть меню" : "Открыть меню"} aria-expanded={mobileMenuOpen} onClick={() => { if (mobileMenuOpen) setMobileMenuOpen(false); else openMobileMenu(); }}><Menu size={22} /></button>
      <button aria-label="Главная" className="brand" onClick={() => navigate(fallbackRouteForRole(user.role))}><span className="brand-symbol"><i /><b /><em /></span></button>
      <span className="mobile-current-module">{currentModule?.label ?? "Разделы"}</span>
      <nav className="module-nav" aria-label="Основные разделы">
        {modules.map((module) => {
          const Icon = module.icon;
          const active = module.label === currentModule.label;
          const allowed = accessibleModuleLabels.has(module.label);
          return <button key={module.label} className={`module-button ${active ? "module-active" : ""}`} disabled={!allowed} title={allowed ? undefined : "Раздел недоступен для этой роли"} onClick={(event) => toggleModuleMenu(event, module.label)}>
            <Icon size={20} strokeWidth={1.8} /><span>{module.label}</span>
          </button>;
        })}
      </nav>
      <div className="nav-tools">
        <div className="nav-search"><Search size={14} /><input type="search" placeholder="Поиск (Ctrl+/)" aria-label="Быстрый глобальный поиск" /></div>
        <button aria-label="Чаты" className="nav-icon-btn" onClick={() => notify("Чаты появятся после подключения пользователей")}><BriefcaseBusiness size={18} /></button>
        <button aria-label="Уведомления" className="nav-icon-btn" onClick={() => notify("Новых уведомлений нет")}><Bell size={18} /><span className="nav-badge">1</span></button>
        <button aria-label="Помощь" className="nav-icon-btn" onClick={() => notify("Справка по клону пока не настроена")}><CircleHelp size={18} /></button>
        <button className="account-button" onClick={() => setShowAccount((value) => !value)}><span><b>{user.full_name}</b><small>{roleLabel(user.role)}</small></span><span className="avatar">{user.full_name.trim().charAt(0).toLocaleUpperCase("ru-RU")}</span><ChevronDown size={14} /></button>
        {showAccount && <div className="account-menu"><b>{user.full_name}</b><small>{user.login} · {roleLabel(user.role)}</small><button onClick={() => { setShowAccount(false); setShowPassword(true); }}>Сменить пароль</button><button onClick={() => { setShowAccount(false); navigate("company"); }}>Настройки организации</button>{user.role === "owner" || user.role === "admin" ? <button onClick={() => { setShowAccount(false); navigate("employees"); }}>Пользователи</button> : null}<button onClick={() => void logout()}>Выйти</button></div>}
      </div>
    </header>
    {openModule && <div className="mega-menu" style={menuPosition}><div className="mega-heading">{openModule}</div>{visibleModules.find((item) => item.label === openModule)?.items.map((item) => <button key={item.route} onClick={() => navigate(item.route)}>{item.label}<span>›</span></button>)}</div>}
    <div className="sub-nav">
      <div className="subnav-scroll">{currentModule.items.map((item) => <button key={item.route} className={navigationRoute === item.route ? "sub-active" : ""} onClick={() => navigate(item.route)}>{item.label}</button>)}</div>
    </div>
    {mobileMenuOpen && <div className="mobile-nav-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setMobileMenuOpen(false); }}>
      <nav className="mobile-nav-panel" aria-label="Разделы приложения">
        <header>
          <div className="mobile-nav-brand"><span className="brand-symbol"><i /><b /><em /></span><b>Разделы</b></div>
          <button aria-label="Закрыть меню" onClick={() => setMobileMenuOpen(false)}><X size={20} /></button>
        </header>
        <div className="mobile-nav-scroll">
          {visibleModules.map((module) => {
            const Icon = module.icon;
            const expanded = mobileModule === module.label;
            return <section className={`mobile-nav-group ${expanded ? "expanded" : ""}`} key={module.label}>
              <button className="mobile-nav-module" aria-expanded={expanded} onClick={() => setMobileModule(expanded ? null : module.label)}>
                <Icon size={20} strokeWidth={1.8} /><span>{module.label}</span><ChevronDown size={16} />
              </button>
              {expanded && <div className="mobile-nav-items">{module.items.map((item) => <button key={item.route} className={navigationRoute === item.route ? "active" : ""} onClick={() => { setMobileMenuOpen(false); navigate(item.route); }}>{item.label}</button>)}</div>}
            </section>;
          })}
        </div>
        <div className="mobile-nav-footer">
          <div><b>{user.full_name}</b><small>{user.login} · {roleLabel(user.role)}</small></div>
          <button onClick={() => void logout()}>Выйти</button>
        </div>
      </nav>
    </div>}
    <main className="page-content">
      {route === "dashboard" ? <Dashboard onNavigate={navigate} />
        : route === "products" ? <ProductsPage notify={notify} onNavigate={navigate} registerNavigationGuard={registerNavigationGuard} commitNavigation={commitNavigation} />
          : route === "pricelists" ? <PriceListsPage onNotify={notify} />
          : route === "counterparties" ? <CounterpartiesPage notify={notify} onOpen={(id) => navigate(`counterparty_detail?id=${id}`)} />
          : route === "counterparty_detail" ? <CounterpartyDetailPage key={location} counterpartyId={Number(new URLSearchParams(location.split("?")[1] ?? "").get("id"))} onNavigate={navigate} registerNavigationGuard={registerNavigationGuard} notify={notify} />
          : route === "vehicles" ? <VehiclesPage notify={notify} onNewWorkOrder={() => navigate("work_order")} onOpenVehicle={(id) => navigate(`vehicle_detail?id=${id}`)} />
            : route === "vehicle_detail" ? <VehicleDetailPage vehicleId={Number(new URLSearchParams(location.split("?")[1] ?? "").get("id"))} onBack={() => navigate("vehicles")} onNewWorkOrder={(id) => navigate(`work_order?new=1&vehicleId=${id}`)} onOpenWorkOrder={(id) => navigate(`work_order?open=${id}`)} onAllWorkOrders={(id) => navigate(`work_order?vehicleId=${id}`)} />
            : route === "stock" ? <StockPage onNavigate={navigate} />
        : route === "warehouses" ? <WarehousesPage notify={notify} />
          : route === "employees" ? <EmployeesPage notify={notify} />
          : route === "departments" ? <DepartmentsPage notify={notify} />
          : route === "company" || route === "legalentities" ? <CompanySettingsPage initialTab={route === "legalentities" ? "details" : "policies"} onNotify={notify} />
          : route === "audit" ? <AuditPage />
          : route === "trash" || route === "recyclebin" ? <TrashPage onNotify={notify} />
          : ["cashflow", "pnl", "settlements", "customersbalancelist"].includes(route)
            ? <FinanceReportsPage initialType={route === "pnl" ? "pnl" : route === "settlements" || route === "customersbalancelist" ? "settlements" : "cashflow"} onNotify={notify} />
          : route === "turnover" ? <TurnoverReportPage onNotify={notify} />
          : route === "payroll" ? <PayrollPage onNotify={notify} />
          : route === "discounts" || route === "loyalty" ? <DiscountsPage initialTab={route === "loyalty" ? "loyalty" : "discounts"} onNotify={notify} />
          : route === "purchaseanalytics" ? <PurchaseAnalyticsPage onNotify={notify} onNavigate={navigate} />
          : route === "invoicesissued" || route === "invoicesreceived" ? <TaxInvoicesPage initialDirection={route === "invoicesreceived" ? "received" : "issued"} onNotify={notify} />
          : route === "salesfunnel" || route === "profitability" ? <SalesFunnelPage initialTab={route === "profitability" ? "profitability" : "funnel"} onNotify={notify} />
          : ["retail", "pos", "retailsales", "shifts", "retailreturns"].includes(route)
            ? <RetailPage initialSubTab={route === "shifts" ? "shifts" : route === "retailsales" ? "sales" : route === "pos" ? "stores" : "terminal"} onNotify={notify} />
          : route === "scripts" ? <ScriptsPage onNotify={notify} />
          : route === "files" ? <FilesPage onNotify={notify} />
          : route === "start" ? <StartPage onNavigate={navigate} />
            : ["customerorder", "purchaseorder", "supplierinvoice", "receipt", "shipment", "customerinvoice", "supplierreturn", "customerreturn", "stockin", "enter", "writeoff", "stocktake", "transfer", "payments", "cashin", "cashout", "cashadjustments", "work_order"].includes(route)
              ? <DocumentsPage route={route} location={location} notify={notify} onNavigate={navigate} />
              : route === "documents" ? <DocumentsPage route={route} location={location} notify={notify} onNavigate={navigate} />
              : <PlaceholderPage route={route} title={pageTitles[route] ?? route} onNavigate={navigate} />}
    </main>
    <nav className="mobile-bottom-nav" aria-label="Быстрая навигация">
      {mobileTabs.map((tab) => {
        const Icon = tab.icon;
        const active = mobileTabActive(tab);
        return <button key={tab.label} className={active ? "active" : ""} aria-current={active ? "page" : undefined} onClick={() => {
          if (tab.more) { if (mobileMenuOpen) setMobileMenuOpen(false); else openMobileMenu(); return; }
          if (tab.route) navigate(tab.route);
        }}><Icon size={21} strokeWidth={1.8} /><span>{tab.label}</span></button>;
      })}
    </nav>
    {toast && <div className="toast"><Check size={16} />{toast}</div>}
    {showPassword && <PasswordChangeDialog onClose={() => setShowPassword(false)} onSubmit={changePassword} />}
  </div>;
}

type Employee = { id: number; login: string; full_name: string; role: "owner" | "admin" | "manager" | "employee"; active: number; must_change_password: number; last_login_at: string | null; department_ids: number[] };

function EmployeesPage({ notify }: { notify: (message: string) => void }) {
  const { user: actor } = useAuth();
  const [rows, setRows] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<Employee | null>(null);
  const [assignmentTarget, setAssignmentTarget] = useState<Employee | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setMessage("");
    try {
      const [users, units] = await Promise.all([request<Employee[]>("/api/auth/users"), request<Department[]>("/api/departments")]);
      setRows(users); setDepartments(units.filter((unit) => unit.active));
    }
    catch (error) { setMessage(error instanceof Error ? error.message : "Не удалось загрузить сотрудников."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function createEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await request<Employee>("/api/auth/users", { method: "POST", body: JSON.stringify({
        login: form.get("login"), fullName: form.get("fullName"), role: form.get("role"), temporaryPassword: form.get("temporaryPassword"),
        departmentIds: form.getAll("departmentIds").map(Number),
      }) });
      setCreateOpen(false); await load(); notify("Учётная запись создана. Сотрудник сменит временный пароль при первом входе.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Не удалось создать учётную запись."); }
  }

  async function updateEmployee(row: Employee, fields: Record<string, unknown>): Promise<boolean> {
    setMessage("");
    try { await request<Employee>(`/api/auth/users/${row.id}`, { method: "PATCH", body: JSON.stringify(fields) }); await load(); return true; }
    catch (error) { setMessage(error instanceof Error ? error.message : "Не удалось изменить учётную запись."); return false; }
  }

  function changeRole(row: Employee, role: string) {
    const hasActiveDepartment = row.department_ids.some((id) => departments.some((department) => department.id === id));
    if ((role === "manager" || role === "employee") && !hasActiveDepartment) {
      setMessage("Сначала назначьте активное подразделение сотруднику.");
      setAssignmentTarget(row);
      return;
    }
    void updateEmployee(row, { role });
  }

  async function resetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!resetTarget) return;
    const form = new FormData(event.currentTarget);
    try {
      await request<{ ok: boolean }>(`/api/auth/users/${resetTarget.id}/reset-password`, {
        method: "POST", body: JSON.stringify({ temporaryPassword: form.get("temporaryPassword") }),
      });
      setResetTarget(null); await load(); notify("Временный пароль установлен. При следующем входе сотрудник сменит его.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Не удалось сбросить пароль."); }
  }

  async function saveAssignments(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!assignmentTarget) return;
    const departmentIds = new FormData(event.currentTarget).getAll("departmentIds").map(Number);
    if (await updateEmployee(assignmentTarget, { departmentIds })) setAssignmentTarget(null);
  }

  return <>
    <PageHeader title="Пользователи" actions={<button className="button primary" onClick={() => { setMessage(""); setCreateOpen(true); }}><Plus size={16} />Сотрудник</button>} />
    <p className="employee-intro">Назначайте каждому менеджеру и сотруднику один или несколько салонов. Они будут видеть документы и остатки только назначенных салонов. При первом входе новый сотрудник должен заменить временный пароль.</p>
    {message && <div className="notice-error">{message}<button onClick={() => setMessage("")}><X size={14} /></button></div>}
    <div className="table-card employee-table responsive-table"><table><thead><tr><th>Сотрудник</th><th>Логин</th><th>Роль</th><th>Салоны</th><th>Статус</th><th>Последний вход</th><th>Действия</th></tr></thead><tbody>
      {rows.map((row) => {
        const isSelf = row.id === actor.id;
        const canEdit = row.role !== "owner" && !isSelf && !(actor.role === "admin" && row.role === "admin");
        return <tr key={row.id}>
          <td data-label="Сотрудник" className="cell-main"><b>{row.full_name}</b>{row.must_change_password ? <small className="subcell">Нужна смена пароля</small> : null}</td>
          <td data-label="Логин">{row.login}</td>
          <td data-label="Роль">{canEdit ? <select aria-label={`Роль: ${row.full_name}`} value={row.role} onChange={(event) => changeRole(row, event.target.value)}>
            {actor.role === "owner" && <option value="admin">Администратор</option>}<option value="manager">Менеджер</option><option value="employee">Сотрудник</option>
          </select> : roleLabel(row.role)}</td>
          <td data-label="Салоны">{row.role === "owner" ? "Все" : row.role === "admin" ? <><span>Полный доступ{row.department_ids.length ? ` · резерв: ${row.department_ids.map((id) => departments.find((department) => department.id === id)?.name ?? "Архив").join(", ")}` : ""}</span>{canEdit && <button className="link-button" onClick={() => { setMessage(""); setAssignmentTarget(row); }}>Настроить подразделения</button>}</> : <><span>{row.department_ids.map((id) => departments.find((department) => department.id === id)?.name ?? "Архив").join(", ") || "Не назначены"}</span>{canEdit && <button className="link-button" onClick={() => { setMessage(""); setAssignmentTarget(row); }}>Изменить</button>}</>}</td>
          <td data-label="Статус"><span className={`status-pill ${row.active ? "status-posted" : "status-cancelled"}`}>{row.active ? "Активен" : "Отключён"}</span></td>
          <td data-label="Последний вход">{row.last_login_at ? new Date(`${row.last_login_at.replace(" ", "T")}Z`).toLocaleString("ru-RU") : "Ещё не входил"}</td>
          <td data-label="Действия" className="employee-actions actions-cell">{canEdit && <><button className="link-button" onClick={() => { setMessage(""); setResetTarget(row); }}>Сбросить пароль</button><button className="link-button" onClick={() => void updateEmployee(row, { active: row.active ? 0 : 1 })}>{row.active ? "Отключить" : "Включить"}</button></>}</td>
        </tr>;
      })}
      {!loading && rows.length === 0 && <tr><td colSpan={7} className="empty-state">Пользователи ещё не настроены.</td></tr>}
      {loading && <tr><td colSpan={7} className="empty-state">Загружаем сотрудников…</td></tr>}
    </tbody></table></div>
    {createOpen && <Modal title="Новый сотрудник" onClose={() => setCreateOpen(false)}><form className="employee-form" onSubmit={(event) => void createEmployee(event)}>
      <label>Имя сотрудника<input name="fullName" required maxLength={120} autoComplete="name" /></label>
      <label>Логин<input name="login" required minLength={3} maxLength={120} autoComplete="username" /></label>
      <label>Роль<select name="role" defaultValue="employee">{actor.role === "owner" && <option value="admin">Администратор</option>}<option value="manager">Менеджер</option><option value="employee">Сотрудник</option></select></label>
      <label>Временный пароль<input name="temporaryPassword" type="password" required minLength={12} maxLength={256} autoComplete="new-password" /></label>
      <fieldset className="span-2"><legend>Доступ к салонам</legend>{departments.map((department) => <label key={department.id}><input type="checkbox" name="departmentIds" value={department.id} />{department.name}</label>)}{!departments.length && <span>Сначала добавьте салон в разделе «Подразделения».</span>}</fieldset>
      <p className="employee-form-hint">Сообщите пароль сотруднику лично. Система не отправляет его по электронной почте.</p>
      <div className="modal-actions span-2"><button type="button" className="button outline" onClick={() => setCreateOpen(false)}>Отмена</button><button className="button primary">Создать</button></div>
    </form></Modal>}
    {assignmentTarget && <Modal title={`Салоны · ${assignmentTarget.full_name}`} onClose={() => setAssignmentTarget(null)}><form className="employee-form" onSubmit={(event) => void saveAssignments(event)}>
      <fieldset className="span-2"><legend>Доступные подразделения</legend>{departments.map((department) => <label key={department.id}><input type="checkbox" name="departmentIds" value={department.id} defaultChecked={assignmentTarget.department_ids.includes(department.id)} />{department.name}</label>)}{!departments.length && <span>Активных подразделений нет.</span>}</fieldset>
      <div className="modal-actions span-2"><button type="button" className="button outline" onClick={() => setAssignmentTarget(null)}>Отмена</button><button className="button primary">Сохранить</button></div>
    </form></Modal>}
    {resetTarget && <Modal title={`Временный пароль · ${resetTarget.full_name}`} onClose={() => setResetTarget(null)}><form className="employee-form" onSubmit={(event) => void resetPassword(event)}>
      <label className="span-2">Новый временный пароль<input name="temporaryPassword" type="password" required minLength={12} maxLength={256} autoComplete="new-password" /></label>
      <p className="employee-form-hint">Все текущие сессии пользователя будут завершены. При следующем входе он должен сменить пароль.</p>
      <div className="modal-actions span-2"><button type="button" className="button outline" onClick={() => setResetTarget(null)}>Отмена</button><button className="button primary">Сбросить пароль</button></div>
    </form></Modal>}
  </>;
}

function DepartmentsPage({ notify }: { notify: (message: string) => void }) {
  const [rows, setRows] = useState<Department[]>([]);
  const [editing, setEditing] = useState<Department | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setRows(await request<Department[]>("/api/departments")); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Не удалось загрузить подразделения."); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    const name = String(new FormData(event.currentTarget).get("name") ?? "");
    try {
      if (editing) await request(`/api/departments/${editing.id}`, { method: "PATCH", body: JSON.stringify({ name }) });
      else await request("/api/departments", { method: "POST", body: JSON.stringify({ name }) });
      setEditing(null); setCreateOpen(false); await load(); notify(editing ? "Подразделение обновлено" : "Подразделение создано");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Не удалось сохранить подразделение."); }
    finally { setBusy(false); }
  }
  async function setActive(department: Department, active: boolean) {
    if (!active && !window.confirm(`Архивировать подразделение «${department.name}»? Сначала назначьте его сотрудников в другие активные салоны. Склады и история сохранятся; доступ к архиву останется у владельца и администратора.`)) return;
    try { await request(`/api/departments/${department.id}`, { method: "PATCH", body: JSON.stringify({ active }) }); await load(); notify(active ? "Подразделение восстановлено" : "Подразделение архивировано"); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Не удалось изменить подразделение."); }
  }
  const openEditor = (department: Department | null) => { setMessage(""); setEditing(department); setCreateOpen(!department); };
  const dialogOpen = editing != null || createOpen;
  return <>
    <PageHeader title="Подразделения" actions={<button className="button primary" onClick={() => openEditor(null)}><Plus size={16} />Салон</button>} />
    <p className="employee-intro">Подразделение представляет отдельный салон. К нему можно привязать несколько складов и назначить доступ сотрудникам.</p>
    {message && <div className="notice-error">{message}<button onClick={() => setMessage("")}><X size={14} /></button></div>}
    <div className="table-card responsive-table"><table><thead><tr><th>Подразделение</th><th>Состояние</th><th>Действия</th></tr></thead><tbody>
      {rows.map((row) => <tr key={row.id}><td data-label="Подразделение" className="cell-main"><b>{row.name}</b></td><td data-label="Состояние"><span className={`status-pill ${row.active ? "status-posted" : "status-cancelled"}`}>{row.active ? "Активно" : "В архиве"}</span></td><td data-label="Действия" className="actions-cell">{row.active && <button className="link-button" onClick={() => openEditor(row)}>Изменить</button>}{row.active ? <button className="link-button" onClick={() => void setActive(row, false)}>Архивировать</button> : <button className="link-button" onClick={() => void setActive(row, true)}>Восстановить</button>}</td></tr>)}
      {!rows.length && <tr><td colSpan={3} className="empty-state">Подразделения ещё не созданы.</td></tr>}
    </tbody></table></div>
    {dialogOpen && <Modal title={editing ? `Подразделение «${editing.name}»` : "Новый салон"} onClose={() => { if (!busy) { setEditing(null); setCreateOpen(false); } }}><form className="form-grid" onSubmit={(event) => void save(event)}>
      <label className="span-2">Название<input autoFocus name="name" required maxLength={120} defaultValue={editing?.name ?? ""} /></label>
      {message && <div className="form-error span-2">{message}</div>}
      <div className="modal-actions span-2"><button type="button" className="button outline" disabled={busy} onClick={() => { setEditing(null); setCreateOpen(false); }}>Отмена</button><button className="button primary" disabled={busy}>{busy ? "Сохранение…" : "Сохранить"}</button></div>
    </form></Modal>}
  </>;
}

function PasswordChangeDialog({ onClose, onSubmit }: { onClose: () => void; onSubmit: (currentPassword: string, newPassword: string) => Promise<void> }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage(""); setBusy(true);
    const form = new FormData(event.currentTarget);
    const next = String(form.get("newPassword") ?? "");
    if (next !== String(form.get("confirmPassword") ?? "")) { setMessage("Новые пароли не совпадают."); setBusy(false); return; }
    try { await onSubmit(String(form.get("currentPassword") ?? ""), next); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Не удалось изменить пароль."); setBusy(false); }
  }
  return <Modal title="Сменить пароль" onClose={onClose}><form className="employee-form" onSubmit={(event) => void submit(event)}>
    <label className="span-2">Текущий пароль<input name="currentPassword" type="password" autoComplete="current-password" required /></label>
    <label>Новый пароль<input name="newPassword" type="password" minLength={12} maxLength={256} autoComplete="new-password" required /></label>
    <label>Повтор нового пароля<input name="confirmPassword" type="password" minLength={12} maxLength={256} autoComplete="new-password" required /></label>
    {message && <p className="form-error span-2">{message}</p>}
    <div className="modal-actions span-2"><button type="button" className="button outline" onClick={onClose}>Отмена</button><button className="button primary" disabled={busy}>{busy ? "Сохраняем…" : "Сменить пароль"}</button></div>
  </form></Modal>;
}

function Dashboard({ onNavigate }: { onNavigate: (route: string) => void }) {
  const [period, setPeriod] = useState<"week" | "month" | "year">("week");
  const [data, setData] = useState<{ stock: { products: number; low_stock: number }; salesToday: { count: number; total: number }; sales: { count: number; total: number }; salesSeries: Array<{ bucket: string; total: number; count: number }>; cash: { total: number }; recent: DocumentRow[]; overdueOrders: { count: number; total: number }; overdueInvoices: { count: number; total: number }; serviceDue: { count: number } } | null>(null);
  const range = useMemo(() => {
    const today = new Date(); const from = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    if (period === "week") from.setDate(from.getDate() - ((from.getDay() + 6) % 7));
    if (period === "month") from.setDate(1);
    if (period === "year") { from.setMonth(0); from.setDate(1); }
    return { from: localDateValue(from), to: localDateValue(today), today: localDateValue(today) };
  }, [period]);
  useEffect(() => { request<typeof data>(`/api/dashboard?today=${range.today}&from=${range.from}&to=${range.to}&period=${period}`).then(setData).catch(() => setData(null)); }, [range, period]);
  const buckets = useMemo(() => {
    const start = new Date(`${range.from}T12:00:00`); const end = new Date(`${range.to}T12:00:00`); const values: string[] = [];
    if (period === "year") { for (let month = 0; month < 12; month++) values.push(`${start.getFullYear()}-${String(month + 1).padStart(2, "0")}`); }
    else for (const date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) values.push(localDateValue(date));
    return values;
  }, [range, period]);
  const salesByBucket = new Map((data?.salesSeries ?? []).map((item) => [item.bucket, Number(item.total)]));
  const values = buckets.map((bucket) => salesByBucket.get(bucket) ?? 0); const maxSales = Math.max(...values, 0);
  const chartPoints = values.map((value, index) => {
    const x = values.length <= 1 ? 325 : index * 650 / (values.length - 1);
    const y = maxSales === 0 ? 105 : 195 - value / maxSales * 180;
    return `${x},${y}`;
  }).join(" ");
  const axisIndices = period === "week" ? buckets.map((_, index) => index) : period === "month" ? [0, 7, 14, 21, buckets.length - 1] : [0, 2, 4, 6, 8, 10];
  const chartLabels = axisIndices.map((index) => {
    const key = buckets[index]; if (!key) return "";
    const date = new Date(`${key.length === 7 ? `${key}-01` : key}T12:00:00`);
    return period === "week" ? new Intl.DateTimeFormat("ru-RU", { weekday: "short" }).format(date)
      : period === "month" ? String(date.getDate())
        : new Intl.DateTimeFormat("ru-RU", { month: "short" }).format(date);
  });
  const currentDay = new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long" }).format(new Date());
  const periodLabel = period === "week" ? "На этой неделе" : period === "month" ? "В этом месяце" : "В этом году";
  const todayAmount = Number(data?.salesToday?.total ?? 0); const periodAmount = Number(data?.sales?.total ?? 0);
  return <>
    <div className="dashboard-top"><div className="sales-summary">
      <h2>Продажи</h2><div className="period-toggle">{([["week", "Неделя"], ["month", "Месяц"], ["year", "Год"]] as const).map(([value, label]) => <button key={value} className={period === value ? "selected" : ""} onClick={() => setPeriod(value)}>{label}</button>)}</div>
      <p className="muted">Сегодня, {currentDay}</p>
      <div className="stat-row"><div><strong className="teal">{data?.salesToday?.count ?? 0}</strong><small>Продаж</small></div><div><strong>{money(todayAmount)}</strong><small>тенге</small></div><div><strong>{money(0)} <small>тенге</small> <em>(0%)</em></strong><small>По сравнению со вчера</small></div></div>
      <p className="muted week-label">{periodLabel}</p><div className="stat-row"><div><strong className="teal">{data?.sales?.count ?? 0}</strong><small>Продаж</small></div><div><strong>{money(periodAmount)}</strong><small>тенге</small></div><div><strong>{money(0)} <small>тенге</small> <em>(0%)</em></strong><small>По сравнению с прошлым периодом</small></div></div>
    </div><div className="chart-wrap"><div className="chart-y"><span>100%</span><span>75%</span><span>50%</span><span>25%</span><span>0</span></div><svg className="sales-chart" viewBox="0 0 650 220" preserveAspectRatio="none" aria-label="Диаграмма продаж">
      {[15, 60, 105, 150, 195].map((y) => <line key={y} x1="0" x2="650" y1={y} y2={y} />)}<line className="chart-zero" x1="0" x2="650" y1="195" y2="195" /><polyline points={chartPoints} />
    </svg><div className="chart-days">{chartLabels.map((label, index) => <span key={`${label}-${index}`}>{label}</span>)}</div></div></div>
    <div className="dashboard-columns">
      <DashboardCard title="Просроченные заказы" count={Number(data?.overdueOrders.count ?? 0)} amount={Number(data?.overdueOrders.total ?? 0)} label="Заказов" columns={["Контрагент", "Заказ", "Сумма", "Срок"]} onClick={() => onNavigate("customerorder")} />
      <DashboardCard title="Просроченные счета" count={Number(data?.overdueInvoices.count ?? 0)} amount={Number(data?.overdueInvoices.total ?? 0)} label="Счетов" columns={["Контрагент", "Счет", "Сумма", "Срок"]} onClick={() => onNavigate("customerinvoice")} />
      <DashboardCard title="Пора менять масло" count={Number(data?.serviceDue.count ?? 0)} label="Автомобилей" columns={["Госномер", "Клиент", "Пробег"]} onClick={() => onNavigate("vehicles")} />
    </div>
    <section className="dashboard-money"><h2>Деньги</h2><strong className="money-balance">{money(Number(data?.cash?.total ?? 0))}<small>тенге</small></strong><div className="money-table"><b>Юр. лицо</b><b>Остаток</b><span>Моя компания</span><span>{money(Number(data?.cash?.total ?? 0))}</span></div><div className="pager">‹　‹ <span>1-1 из 1</span> ›　›</div></section>
    <section className="recent-documents"><div className="section-heading"><h2>Недавние документы</h2><button onClick={() => onNavigate("documents")}>Все документы</button></div>
      <div className="table-card responsive-table"><table><thead><tr>{["Документ", "Пров.", "Момент", "Контрагент", "Организация", "Сумма", "Валюта", "Когда изменен", "Кто изменил"].map((name) => <th key={name}>{name}</th>)}</tr></thead><tbody>
        {(data?.recent ?? []).map((row) => <tr key={row.id}><td data-label="Документ" className="cell-main">{row.number}</td><td data-label="Пров." className="mobile-hide">{row.status === "posted" ? "✓" : ""}</td><td data-label="Момент" className="mobile-hide">{row.date}</td><td data-label="Контрагент">{row.counterparty_name ?? ""}</td><td data-label="Организация" className="mobile-hide">Моя компания</td><td data-label="Сумма">{money(row.total_tiyin)}</td><td data-label="Валюта" className="mobile-hide">тенге</td><td data-label="Когда изменен">{row.updated_at ?? "—"}</td><td data-label="Кто изменил" className="mobile-hide">Михаил</td></tr>)}
        {!data?.recent?.length && <tr><td colSpan={9} className="empty-inline">Пока нет документов</td></tr>}
      </tbody></table></div>
    </section>
  </>;
}

function DashboardCard({ title, count, amount, label, columns, onClick }: { title: string; count: number; amount?: number; label: string; columns: string[]; onClick: () => void }) {
  return <section className="dashboard-card"><button className="card-title" onClick={onClick}>{title}</button><div className="card-stats"><strong className="teal">{count}</strong>{amount != null && <div><b>{money(amount)}</b><small>тенге</small></div>}<span>{label}</span></div><div className="mini-columns">{columns.map((column) => <b key={column}>{column}</b>)}</div></section>;
}

function PageHeader({ title, actions }: { title: string; actions?: React.ReactNode }) {
  return <div className="page-header"><h1>{title}</h1><div className="page-actions">{actions}</div></div>;
}

function StockPage({ onNavigate }: { onNavigate?: (route: string) => void }) {
  const [rows, setRows] = useState<StockRow[]>([]); const [query, setQuery] = useState(""); const [message, setMessage] = useState("");
  const load = useCallback(async () => setRows(await request<StockRow[]>(`/api/stock?q=${encodeURIComponent(query)}`)), [query]);
  useEffect(() => { void load().catch((error) => setMessage(error.message)); }, [load]);
  return <>
    <PageHeader title="Остатки" actions={<button className="button outline" onClick={() => void load()}>Обновить</button>} />
    <div className="list-toolbar"><button className="button outline"><Filter size={15} />Фильтр</button><div className="search-box"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Код или наименование" /></div><button className="button outline"><List size={15} />Список</button></div>
    {message && <div className="notice-error">{message}</div>}
    <div className="table-card responsive-table"><table><thead><tr><th>Код</th><th>Наименование</th><th>Склад</th><th>Ед.</th><th>Остаток</th><th>Резерв</th><th>Доступно</th><th>Себестоимость</th></tr></thead><tbody>{rows.map((row) => <tr key={`${row.product_id}-${row.warehouse_id}`}><td data-label="Код" className="mobile-hide">{row.code}</td><td data-label="Наименование" className="cell-main">{row.product_name}</td><td data-label="Склад">{row.warehouse_name}</td><td data-label="Ед." className="mobile-hide">{row.unit}</td><td data-label="Остаток">{qty(row.stock_units)}</td><td data-label="Резерв">{qty(row.reserved_units)}</td><td data-label="Доступно" className={Number(row.available_units) < 0 ? "low-stock" : ""}>{qty(row.available_units)}</td><td data-label="Себестоимость">{money(row.stock_value_tiyin)} ₸</td></tr>)}{!rows.length && <tr><td colSpan={8} className="empty-state"><Boxes size={42} /><h3>{query ? "Ничего не найдено" : "Нет товарных остатков"}</h3><p>{query ? "Попробуйте изменить поисковый запрос" : "Оприходуйте товар или проведите документ приёмки, чтобы появились остатки на складах"}</p>{!query && onNavigate && <button className="button outline" onClick={() => onNavigate("receipt")}>Перейти к приёмкам</button>}</td></tr>}</tbody></table></div>
  </>;
}

function WarehousesPage({ notify }: { notify: (message: string) => void }) {
  const [rows, setRows] = useState<Warehouse[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [query, setQuery] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [editing, setEditing] = useState<Warehouse | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const [warehouses, units] = await Promise.all([
      request<Warehouse[]>(`/api/warehouses?q=${encodeURIComponent(query)}&includeArchived=${includeArchived ? "1" : "0"}`),
      request<Department[]>("/api/departments"),
    ]);
    setRows(warehouses); setDepartments(units);
  }, [query, includeArchived]);
  useEffect(() => { void load().catch((error) => setMessage(error.message)); }, [load]);

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setMessage(""); setBusy(true);
    const form = new FormData(event.currentTarget);
    const body = Object.fromEntries(form) as Record<string, unknown>;
    body.parentId = String(body.parentId ?? "") || null;
    body.departmentId = Number(body.departmentId);
    try {
      if (editing) await request(`/api/warehouses/${editing.id}`, { method: "PATCH", body: JSON.stringify(body) });
      else await request("/api/warehouses", { method: "POST", body: JSON.stringify(body) });
      setEditing(null); setCreateOpen(false); await load(); notify(editing ? "Склад обновлён" : "Склад создан");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Не удалось сохранить склад"); }
    finally { setBusy(false); }
  };

  const setActive = async (warehouse: Warehouse, active: boolean) => {
    setMessage("");
    if (!active && !window.confirm(`Архивировать склад «${warehouse.name}»? История движений сохранится.`)) return;
    try {
      await request(`/api/warehouses/${warehouse.id}`, { method: "PATCH", body: JSON.stringify({ active }) });
      await load(); notify(active ? "Склад восстановлен" : "Склад архивирован");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Не удалось изменить состояние склада"); }
  };

  const descendants = (warehouseId?: number) => {
    const ids = new Set<number>();
    if (!warehouseId) return ids;
    ids.add(warehouseId);
    let changed = true;
    while (changed) {
      changed = false;
      for (const row of rows) if (row.parent_id != null && ids.has(Number(row.parent_id)) && !ids.has(row.id)) { ids.add(row.id); changed = true; }
    }
    return ids;
  };

  const dialogWarehouse = editing ?? (createOpen ? null : undefined);
  const dialogOpen = editing != null || createOpen;
  return <>
    <PageHeader title="Склады" actions={<button className="button primary" onClick={() => { setMessage(""); setCreateOpen(true); }}><Plus size={16} />Склад</button>} />
    <div className="list-toolbar"><div className="search-box"><Search size={16} /><input aria-label="Поиск складов по наименованию, коду или адресу" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Наименование, код или адрес" /></div><label className="archive-toggle"><input type="checkbox" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} />Показать архив</label></div>
    <div className="list-meta"><span>Все {rows.length}</span></div>
    {message && <div className="notice-error">{message}<button onClick={() => setMessage("")}><X size={14} /></button></div>}
    <div className="table-card responsive-table"><table><thead><tr><th>Наименование</th><th>Салон</th><th>Код</th><th>Адрес</th><th>Родительский склад</th><th>Статус</th><th></th></tr></thead><tbody>
      {rows.map((row) => <tr key={row.id}><td data-label="Наименование" className="cell-main"><b>{row.name}</b>{row.comment && <small className="subcell">{row.comment}</small>}</td><td data-label="Салон">{row.department_name || "—"}</td><td data-label="Код">{row.code || "—"}</td><td data-label="Адрес">{row.address || "—"}{row.address_comment && <small className="subcell">{row.address_comment}</small>}</td><td data-label="Родительский склад">{row.parent_name || "—"}</td><td data-label="Статус"><span className={`status-pill ${row.active ? "status-posted" : "status-cancelled"}`}>{row.active ? "Активен" : "В архиве"}</span></td><td data-label="Действия" className="warehouse-row-actions actions-cell">{row.active && <button className="link-button" onClick={() => { setMessage(""); setEditing(row); }}>Изменить</button>}{row.active ? <button className="link-button" onClick={() => void setActive(row, false)}>Архивировать</button> : <button className="link-button" onClick={() => void setActive(row, true)}>Восстановить</button>}</td></tr>)}
      {!rows.length && <tr><td colSpan={7} className="empty-state"><Store size={42} /><h3>{query ? "Ничего не найдено" : "Складов пока нет"}</h3><p>{query ? "Попробуйте изменить поисковый запрос" : "Создайте склад для раздельного учета товаров по точкам"}</p>{!query && <button className="button primary" onClick={() => { setMessage(""); setEditing(null); setCreateOpen(true); }}><Plus size={16} />Создать склад</button>}</td></tr>}
    </tbody></table></div>
    {dialogOpen && <Modal title={editing ? `Склад «${editing.name}»` : "Новый склад"} onClose={() => { if (busy) return; setEditing(null); setCreateOpen(false); setMessage(""); }}><form className="form-grid" onSubmit={save}>
      <label className="span-2">Наименование<input autoFocus required maxLength={200} name="name" defaultValue={dialogWarehouse?.name ?? ""} /></label>
      <label>Код<input maxLength={100} name="code" defaultValue={dialogWarehouse?.code ?? ""} /></label>
      <label>Внешний код<input maxLength={150} name="externalCode" defaultValue={dialogWarehouse?.external_code ?? ""} /></label>
      <label className="span-2">Адрес<input maxLength={500} name="address" defaultValue={dialogWarehouse?.address ?? ""} /></label>
      <label className="span-2">Комментарий к адресу<input maxLength={500} name="addressComment" defaultValue={dialogWarehouse?.address_comment ?? ""} /></label>
      <label className="span-2">Подразделение / салон<select name="departmentId" required defaultValue={String(dialogWarehouse?.department_id ?? departments.find((department) => department.active)?.id ?? "")}>{departments.filter((department) => department.active).map((department) => <option value={department.id} key={department.id}>{department.name}</option>)}</select></label>
      <label className="span-2">Родительский склад<select name="parentId" defaultValue={String(dialogWarehouse?.parent_id ?? "")}><option value="">Нет</option>{rows.filter((row) => row.active && !descendants(dialogWarehouse?.id).has(row.id)).map((row) => <option value={row.id} key={row.id}>{row.name}</option>)}</select></label>
      <label className="span-2">Комментарий<textarea name="comment" rows={3} maxLength={2000} defaultValue={dialogWarehouse?.comment ?? ""} /></label>
      {message && <div className="form-error span-2">{message}</div>}
      <div className="modal-actions span-2"><button type="button" className="button outline" disabled={busy} onClick={() => { setEditing(null); setCreateOpen(false); setMessage(""); }}>Отмена</button><button className="button primary" disabled={busy}>{busy ? "Сохранение…" : "Сохранить"}</button></div>
    </form></Modal>}
  </>;
}

function productEditorFromHash(): number | "new" | null {
  const [path, query = ""] = window.location.hash.replace(/^#\/?/, "").split("?");
  if (path !== "products") return null;
  const editor = new URLSearchParams(query).get("edit");
  if (editor === "new") return "new";
  const id = Number(editor);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function ProductsPage({ notify, onNavigate, registerNavigationGuard, commitNavigation }: { notify: (message: string) => void; onNavigate: (route: string) => void; registerNavigationGuard: (guard: NavigationGuard | null) => void; commitNavigation: (route: string) => void }) {
  const { user } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const [selectedProduct, setSelectedProduct] = useState<number | "new" | null>(() => productEditorFromHash());
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [showFolders, setShowFolders] = useState(false);
  const [groups, setGroups] = useState<ProductGroup[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [groupEditor, setGroupEditor] = useState<ProductGroupEditor | null>(null);
  const [groupMessage, setGroupMessage] = useState("");
  const [message, setMessage] = useState("");
  const load = useCallback(async () => { setProducts(await request<Product[]>(`/api/products?q=${encodeURIComponent(query)}&kind=${kind}`)); }, [query, kind]);
  const loadGroups = useCallback(async () => { setGroups(await request<ProductGroup[]>("/api/product-groups")); }, []);
  useEffect(() => { void load().catch((error) => setMessage(error.message)); }, [load]);
  useEffect(() => { void loadGroups().catch((error) => setMessage(error.message)); }, [loadGroups]);
  useEffect(() => {
    const syncEditorRoute = () => setSelectedProduct(productEditorFromHash());
    window.addEventListener("hashchange", syncEditorRoute);
    return () => window.removeEventListener("hashchange", syncEditorRoute);
  }, []);

  const groupCounts = useMemo(() => {
    const counts = new Map<number, number>(groups.map((group) => [group.id, 0]));
    for (const product of products) {
      let group = groups.find((item) => item.id === product.group_id);
      while (group) {
        counts.set(group.id, (counts.get(group.id) ?? 0) + 1);
        group = group.parent_id == null ? undefined : groups.find((item) => item.id === group!.parent_id);
      }
    }
    return counts;
  }, [products, groups]);

  const groupTreeRows = useMemo(() => {
    const rows: Array<{ group: ProductGroup; depth: number }> = [];
    const visit = (parentId: number | null, depth: number) => {
      for (const group of groups.filter((item) => item.parent_id === parentId)) {
        rows.push({ group, depth });
        visit(group.id, depth + 1);
      }
    };
    visit(null, 0);
    return rows;
  }, [groups]);

  const visibleProducts = useMemo(() => {
    if (selectedGroupId == null) return products;
    const included = new Set<number>([selectedGroupId]);
    for (const row of groupTreeRows) {
      let parent = row.group.parent_id;
      while (parent != null) {
        if (parent === selectedGroupId) { included.add(row.group.id); break; }
        parent = groups.find((group) => group.id === parent)?.parent_id ?? null;
      }
    }
    return products.filter((product) => product.group_id != null && included.has(product.group_id));
  }, [products, selectedGroupId, groupTreeRows, groups]);

  const openGroupEditor = (group?: ProductGroup) => {
    setGroupMessage("");
    setGroupEditor(group ? { id: group.id, parentId: group.parent_id, name: group.name, description: group.description, code: group.code, externalCode: group.external_code, vatRate: group.vat_rate, taxSystem: group.tax_system }
      : { parentId: null, name: "", description: "", code: "", externalCode: "", vatRate: "", taxSystem: "" });
  };
  const saveGroup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!groupEditor) return;
    const values = new FormData(event.currentTarget);
    const parentValue = String(values.get("parentId") ?? "");
    const payload = { name: String(values.get("name") ?? "").trim(), description: String(values.get("description") ?? ""), parentId: parentValue ? Number(parentValue) : null,
      code: String(values.get("code") ?? ""), externalCode: String(values.get("externalCode") ?? ""), vatRate: String(values.get("vatRate") ?? ""), taxSystem: String(values.get("taxSystem") ?? "") };
    try {
      if (groupEditor.id) await request(`/api/product-groups/${groupEditor.id}`, { method: "PATCH", body: JSON.stringify(payload) });
      else await request("/api/product-groups", { method: "POST", body: JSON.stringify(payload) });
      await Promise.all([loadGroups(), load()]);
      setGroupEditor(null); setGroupMessage("");
      notify(groupEditor.id ? "Группа обновлена" : "Группа создана");
    } catch (error) { setGroupMessage(error instanceof Error ? error.message : "Не удалось сохранить группу"); }
  };
  const deleteGroup = async (group: ProductGroup) => {
    if (group.product_count || group.child_count) { setMessage("Сначала перенесите товары и вложенные группы."); return; }
    if (!window.confirm(`Удалить пустую группу «${group.name}»?`)) return;
    try { await request(`/api/product-groups/${group.id}`, { method: "DELETE" }); await loadGroups(); setSelectedGroupId((current) => current === group.id ? null : current); setMessage(""); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Не удалось удалить группу"); }
  };
  const selectedGroupName = selectedGroupId == null ? "" : groups.find((group) => group.id === selectedGroupId)?.name ?? "";
  const blockedParentIds = new Set<number>();
  if (groupEditor?.id) {
    blockedParentIds.add(groupEditor.id);
    let changed = true;
    while (changed) {
      changed = false;
      for (const group of groups) if (group.parent_id != null && blockedParentIds.has(group.parent_id) && !blockedParentIds.has(group.id)) { blockedParentIds.add(group.id); changed = true; }
    }
  }

  const openProduct = (id: number | "new") => { window.location.hash = `products?edit=${id}&type=Good`; };
  const closeProduct = () => { window.location.hash = "products"; };
  const productSaved = async () => { closeProduct(); await Promise.all([load(), loadGroups()]); };
  const toggleSelected = (id: number) => setSelectedIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  const toggleAll = () => setSelectedIds((current) => current.length === visibleProducts.length ? [] : visibleProducts.map((product) => product.id));
  if (selectedProduct != null) return <ProductCardPage key={selectedProduct} productId={selectedProduct} products={products} notify={notify} registerNavigationGuard={registerNavigationGuard} commitNavigation={commitNavigation} onClose={closeProduct} onSaved={productSaved} />;
  return <>
  <PageHeader title="Товары и услуги" actions={<><button className="button outline" onClick={() => onNavigate("pricelists")}>Прайс-лист</button>{user.role !== "employee" && <><button className="button outline" onClick={() => openGroupEditor()}><FolderOpen size={15} />Группа</button><button className="button primary" onClick={() => openProduct("new")}><Plus size={16} />Товар</button><button className="button caret" aria-label="Создать товар или услугу" onClick={() => openProduct("new")}><ChevronDown size={17} /></button></>}</>} />
    <div className="list-toolbar">
      <button className="button outline"><Filter size={15} />Фильтр</button>
      <select aria-label="Тип номенклатуры" value={kind} onChange={(event) => setKind(event.target.value)}><option value="all">Все типы</option><option value="product">Товары</option><option value="service">Услуги</option></select>
      <div className="search-box"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Код или наименование" /></div>
      <button className="button outline view-selected"><List size={15} />Список</button>
      <button className={`button outline ${showFolders ? "view-selected" : ""}`} onClick={() => setShowFolders((prev) => !prev)}><Layers size={15} />Папки</button>
    </div>
    {message && <div className="notice-error">{message}</div>}
    <div className="list-meta">
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span>Все {visibleProducts.length}{selectedGroupId != null ? ` (из ${products.length})` : ""}</span>
        {selectedGroupId != null && (
          <span className="group-filter-badge" style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "#e8eff4", color: "#1976a5", padding: "2px 8px", borderRadius: 12, fontSize: 11, fontWeight: "bold" }}>
            <Folder size={12} /> {selectedGroupName}
            <button type="button" onClick={() => setSelectedGroupId(null)} style={{ border: 0, background: "transparent", color: "#1976a5", padding: "0 2px", cursor: "pointer", fontWeight: "bold" }} aria-label="Сбросить фильтр по группе">×</button>
          </span>
        )}
      </div>
      <div><button disabled={!selectedIds.length} onClick={() => setSelectedIds([])}>Снять выбор {selectedIds.length ? `(${selectedIds.length})` : ""}</button><button onClick={() => window.print()}>Печать</button></div>
    </div>
    <div className={showFolders ? "catalog-layout" : ""}>
      {showFolders && (
        <aside className="catalog-folders-sidebar">
          <div className="folders-sidebar-header">
            <b><FolderOpen size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />Группы товаров</b>
          </div>
          <ul className="folders-tree-list">
            <li className={selectedGroupId === null ? "active" : ""} onClick={() => setSelectedGroupId(null)}>
              <span>Все товары</span>
              <small>{products.length}</small>
            </li>
            {groupTreeRows.map(({ group, depth }) => (
              <li key={group.id} className={selectedGroupId === group.id ? "active" : ""} style={{ paddingLeft: 12 + depth * 16 }} onClick={() => setSelectedGroupId(group.id)}>
                <span className="catalog-group-name"><Folder size={13} /><span>{group.name}</span></span>
                <span className="catalog-group-tools"><small>{groupCounts.get(group.id) ?? 0}</small>{user.role !== "employee" && <><button type="button" aria-label={`Изменить группу ${group.name}`} title="Изменить группу" onClick={(event) => { event.stopPropagation(); openGroupEditor(group); }}><Pencil size={12} /></button><button type="button" aria-label={`Удалить группу ${group.name}`} title={group.product_count || group.child_count ? "Сначала очистите группу" : "Удалить группу"} disabled={Boolean(group.product_count || group.child_count)} onClick={(event) => { event.stopPropagation(); void deleteGroup(group); }}><Trash2 size={12} /></button></>}</span>
              </li>
            ))}
            {!groups.length && <li className="folders-empty">Группы пока не созданы</li>}
          </ul>
        </aside>
      )}
      <div className="catalog-main-content">
        <div className="table-card responsive-table"><table><thead><tr><th><input type="checkbox" aria-label="Выбрать все" checked={visibleProducts.length > 0 && selectedIds.length === visibleProducts.length} onChange={toggleAll} /></th><th>Код</th><th>Наименование</th><th>Ед.</th><th>Остаток</th><th>Закупка</th><th>Продажа</th><th>Себестоимость</th><th>Статус</th></tr></thead><tbody>
          {visibleProducts.map((product) => <tr key={product.id}><td className="mobile-hide"><input type="checkbox" checked={selectedIds.includes(product.id)} onChange={() => toggleSelected(product.id)} aria-label={`Выбрать ${product.name}`} /></td><td data-label="Код" className="mobile-hide">{product.code}</td><td data-label="Наименование" className="cell-main"><button className="link-button" onClick={() => openProduct(product.id)}>{product.name}</button><small className="subcell">{product.kind === "service" ? "Услуга" : "Товар"}</small></td><td data-label="Ед." className="mobile-hide">{product.unit}</td><td data-label="Остаток" className={product.is_low_stock ? "low-stock" : ""}>{qty(product.stock_units)}</td><td data-label="Закупка" className="mobile-hide">{money(product.purchase_price_tiyin)}</td><td data-label="Продажа"><b>{money(product.sale_price_tiyin)} ₸</b></td><td data-label="Себестоимость" className="mobile-hide">{money(product.stock_value_tiyin)}</td><td data-label="Статус"><span className={`status-pill ${product.active ? "status-posted" : "status-cancelled"}`}>{product.active ? "Активен" : "Архив"}</span></td></tr>)}
          {!visibleProducts.length && <tr><td colSpan={9} className="empty-state"><Package size={42} /><h3>{query || selectedGroupId != null ? "Ничего не найдено" : "В каталоге пока нет товаров и услуг"}</h3><p>{query || selectedGroupId != null ? "Попробуйте изменить поисковый запрос или фильтр по группе" : "Создайте первый товар или услугу, чтобы начать продажи"}</p>{!query && selectedGroupId == null && user.role !== "employee" && <button className="button primary" onClick={() => openProduct("new")}><Plus size={16} />Создать товар</button>}</td></tr>}
        </tbody></table></div>
      </div>
    </div>
    {groupEditor && <Modal title={groupEditor.id ? "Изменить группу" : "Новая группа"} onClose={() => { setGroupEditor(null); setGroupMessage(""); }} className="product-group-modal"><form className="form-grid" onSubmit={saveGroup}>
      <label className="span-2">Наименование группы<input autoFocus required name="name" maxLength={255} defaultValue={groupEditor.name} /></label>
      <label className="span-2">Родительская группа<select name="parentId" defaultValue={groupEditor.parentId ?? ""}><option value="">Верхний уровень</option>{groups.filter((group) => !blockedParentIds.has(group.id)).map((group) => <option key={group.id} value={group.id}>{productGroupPath(group.id, groups)}</option>)}</select></label>
      <label className="span-2">Описание<textarea name="description" rows={3} defaultValue={groupEditor.description} /></label>
      <label>Код<input name="code" maxLength={100} defaultValue={groupEditor.code} /></label>
      <label>Внешний код<input name="externalCode" maxLength={120} defaultValue={groupEditor.externalCode} /></label>
      <label>НДС<select name="vatRate" defaultValue={groupEditor.vatRate}><option value="">Не задан</option><option value="0">0%</option><option value="5">5%</option><option value="10">10%</option><option value="12">12%</option><option value="20">20%</option></select></label>
      <label>Система налогообложения<select name="taxSystem" defaultValue={groupEditor.taxSystem}><option value="">Совпадает с организацией</option><option value="general">Общая</option><option value="simplified_income">Упрощённая: доходы</option><option value="simplified_income_expense">Упрощённая: доходы минус расходы</option></select></label>
      {groupMessage && <p className="form-error span-2" role="alert">{groupMessage}</p>}
      <div className="modal-actions span-2"><button type="button" className="button outline" onClick={() => setGroupEditor(null)}>Отмена</button><button className="button primary">Сохранить</button></div>
    </form></Modal>}
  </>;
}

const productTabs = ["Цены", "Модификации", "Аналоги", "Упаковка", "Остатки", "История", "Файлы"] as const;
type ProductTab = typeof productTabs[number];
type NavigationGuard = (nextRoute: string) => boolean;

function ProductCardPage({ productId, products, notify, registerNavigationGuard, commitNavigation, onClose, onSaved }: { productId: number | "new"; products: Product[]; notify: (message: string) => void; registerNavigationGuard: (guard: NavigationGuard | null) => void; commitNavigation: (route: string) => void; onClose: () => void; onSaved: () => void }) {
  const { user } = useAuth();
  const canWriteCatalog = user.role !== "employee";
  const [card, setCard] = useState<ProductCard | null>(null);
  const [tab, setTab] = useState<ProductTab>("Цены");
  const [suppliers, setSuppliers] = useState<Counterparty[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [groupOptions, setGroupOptions] = useState<ProductGroup[]>([]);
  const [countryOptions, setCountryOptions] = useState<string[]>([]);
  const [barcodeRows, setBarcodeRows] = useState<Array<{ barcodeType: string; barcode: string }>>([]);
  const [packagingRows, setPackagingRows] = useState<Array<{ name: string; quantity: string; unit: string; codeType: string; barcode: string }>>([]);
  const [relationRows, setRelationRows] = useState<Array<{ relatedProductId: string; relationType: string }>>([]);
  const [priceRows, setPriceRows] = useState<Array<{ name: string; price: string; currency: string }>>([]);
  const [showPriceSetup, setShowPriceSetup] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<PendingProductFile[]>([]);
  const [createdProductId, setCreatedProductId] = useState<number | null>(null);
  const [minStockMode, setMinStockMode] = useState("total");
  const [minimumRows, setMinimumRows] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

  const markDirty = () => { dirtyRef.current = true; setDirty(true); };
  useEffect(() => {
    const guard = (nextRoute: string) => {
      if (!dirtyRef.current) return false;
      setPendingNavigation(nextRoute);
      setConfirmClose(true);
      return true;
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    registerNavigationGuard(guard);
    window.addEventListener("beforeunload", beforeUnload);
    return () => { registerNavigationGuard(null); window.removeEventListener("beforeunload", beforeUnload); };
  }, [registerNavigationGuard]);

  useEffect(() => {
    let cancelled = false;
    const loadedCard = productId === "new"
      ? request<{ code: string }>("/api/products/next-code").then((result) => ({ newCode: result.code as string }))
      : request<ProductCard>(`/api/products/${productId}`).then((product) => ({ product }));
    void Promise.all([loadedCard, request<Counterparty[]>("/api/counterparties"), request<Warehouse[]>("/api/warehouses"), request<ProductGroup[]>("/api/product-groups"), request<{ groups: string[]; countries: string[] }>("/api/products/metadata")]).then(([cardResult, supplierList, warehouseList, productGroups, metadata]) => {
      if (cancelled) return;
      setSuppliers(supplierList.filter((item) => item.kind === "supplier" || item.kind === "both"));
      setWarehouses(warehouseList);
      setGroupOptions(productGroups);
      setCountryOptions(metadata.countries);
      const loaded = "product" in cardResult ? cardResult.product : null;
      if (!loaded) {
        const newCode = "newCode" in cardResult ? cardResult.newCode : "";
        const empty: ProductCard = {
          id: 0, code: newCode, name: "", kind: "product", unit: "шт", purchase_price_tiyin: 0, sale_price_tiyin: 0, minimum_price_tiyin: 0,
          min_stock_units: 0, min_stock_mode: "total", stock_units: 0, stock_value_tiyin: 0, reserved_units: 0, available_units: 0, active: 1,
          article: "", external_code: "", description: "", group_id: null, group_name: "", country: "", weight_milli: 0, volume_milli: 0, vat_rate: "",
          retail_discount_allowed: 1, packaging_unit: "", accounting_type: "", ntin: "", traceable: 0, marking: "", product_type: "", tax_system: "", calculation_subject: "Товар",
          access_employee: "", access_department: "", shared_access: 1, barcodes: [], packaging: [], relations: [], warehouses: [], history: [], movements: [], priceTiers: [], files: [],
        };
        setCard(empty);
        setMinimumRows(Object.fromEntries(warehouseList.map((item) => [item.id, "0"])));
      } else setCard(loaded);
      if (loaded) {
        setMinStockMode(loaded.min_stock_mode ?? "total");
        setBarcodeRows(loaded.barcodes.map(({ barcodeType, barcode }) => ({ barcodeType, barcode })));
        setPackagingRows(loaded.packaging.map(({ name, quantity, unit, codeType, barcode }) => ({ name, quantity: String(Number(quantity) / 1_000_000), unit, codeType, barcode })));
        setRelationRows(loaded.relations.map((item) => ({ relatedProductId: String(item.relatedProductId), relationType: item.relationType })));
        setMinimumRows(Object.fromEntries(loaded.warehouses.map((item) => [item.warehouse_id, String(Number(item.min_stock_units) / 1_000_000)])));
        setPriceRows(loaded.priceTiers.map((item) => ({ name: item.name, price: String(Number(item.priceTiyin) / 100), currency: item.currency })));
        setShowPriceSetup(loaded.priceTiers.length > 0);
      }
    }).catch((error) => { if (!cancelled) setMessage(error.message); });
    return () => { cancelled = true; };
  }, [productId]);

  const requestClose = () => { if (dirtyRef.current) setConfirmClose(true); else onClose(); };
  const setBarcode = (index: number, field: "barcodeType" | "barcode", value: string) => { markDirty(); setBarcodeRows((rows) => rows.map((row, i) => i === index ? { ...row, [field]: value } : row)); };
  const setPackaging = (index: number, field: keyof (typeof packagingRows)[number], value: string) => { markDirty(); setPackagingRows((rows) => rows.map((row, i) => i === index ? { ...row, [field]: value } : row)); };
  const queueFiles = (fileList: FileList | null, fileKind: "image" | "file") => {
    const files = Array.from(fileList ?? []);
    if (files.some((file) => file.size > 8 * 1024 * 1024)) { setMessage("Размер одного файла должен быть не больше 8 МБ."); return; }
    if (fileKind === "image" && files.some((file) => !imageMimeFor(file))) { setMessage("Поддерживаются изображения JPEG, PNG, GIF, WebP и AVIF."); return; }
    if (files.length) { markDirty(); setPendingFiles((current) => [...current, ...files.map((file) => ({ file, fileKind }))]); setMessage(""); }
  };
  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!card) return;
    const priceNames = priceRows.map((row) => row.name.trim().normalize("NFKC").toLocaleLowerCase("ru")).filter(Boolean);
    if (new Set(priceNames).size !== priceNames.length) { setPendingNavigation(null); setMessage("Названия дополнительных типов цен должны быть уникальными."); return; }
    setBusy(true); setMessage("");
    const form = event.currentTarget; const formData = new FormData(form); const payload: Record<string, unknown> = Object.fromEntries(formData.entries());
    const checked = (name: string) => (form.elements.namedItem(name) as HTMLInputElement | null)?.checked ? 1 : 0;
    payload.minStockMode = minStockMode;
    if (minStockMode === "per_warehouse") payload.minStock = "0";
    payload.retailDiscountAllowed = checked("retailDiscountAllowed") ? 0 : 1; payload.traceable = checked("traceable"); payload.sharedAccess = checked("sharedAccess");
    payload.barcodes = barcodeRows; payload.packaging = packagingRows; payload.relations = relationRows; payload.priceTiers = priceRows;
    payload.warehouseMinima = Object.entries(minimumRows).map(([warehouseId, minStock]) => ({ warehouseId: Number(warehouseId), minStock }));
    try {
      let savedId = typeof productId === "number" ? productId : createdProductId;
      if (productId === "new" && savedId == null) {
        const created = await request<Product>("/api/products", { method: "POST", body: JSON.stringify(payload) });
        savedId = created.id; setCreatedProductId(created.id);
      } else if (savedId != null) {
        await request<Product>(`/api/products/${savedId}`, { method: "PATCH", body: JSON.stringify(payload) });
      }
      if (savedId != null && pendingFiles.length) {
        for (const pending of pendingFiles) {
          await request(`/api/products/${savedId}/files`, { method: "POST", body: JSON.stringify({
            fileName: pending.file.name, mimeType: pending.fileKind === "image" ? imageMimeFor(pending.file) : pending.file.type || "application/octet-stream", fileKind: pending.fileKind,
            dataBase64: await fileBase64(pending.file),
          }) });
          setPendingFiles((current) => current.filter((item) => item !== pending));
        }
      }
      const nextRoute = pendingNavigation;
      setPendingNavigation(null);
      dirtyRef.current = false; setDirty(false);
      notify(productId === "new" ? "Товар сохранён" : "Карточка товара сохранена"); await onSaved();
      if (nextRoute) commitNavigation(nextRoute);
    } catch (error) { setPendingNavigation(null); setMessage(error instanceof Error ? error.message : "Не удалось сохранить карточку"); }
    finally { setBusy(false); }
  };
  const archive = async () => {
    if (productId === "new" || !card) return;
    setBusy(true); setMessage("");
    try { await request<Product>(`/api/products/${productId}`, { method: "PATCH", body: JSON.stringify({ active: card.active ? 0 : 1 }) }); notify(card.active ? "Товар перемещён в архив" : "Товар восстановлен из архива"); await onSaved(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Не удалось изменить статус"); }
    finally { setBusy(false); }
  };
  const input = (name: string, label: string, value: string | number, options: { type?: string; placeholder?: string; step?: string; min?: string; max?: string; required?: boolean; disabled?: boolean; className?: string; list?: string } = {}) => <label className={options.className ?? ""}>{label}<input name={name} type={options.type ?? "text"} defaultValue={value} placeholder={options.placeholder} step={options.step} min={options.min} max={options.max} required={options.required} disabled={options.disabled} list={options.list} /></label>;
  const select = (name: string, label: string, value: string | number, options: Array<[string, string]>, className = "") => <label className={className}>{label}<select name={name} defaultValue={value}>{options.map(([v, caption]) => <option key={v} value={v}>{caption}</option>)}</select></label>;
  const currentPrice = (value?: number) => String(Number(value ?? 0) / 100);
  const currentDecimal = (value?: number) => String(Number(value ?? 0) / 1000);
  const currentUnits = (value?: number) => String(Number(value ?? 0) / 1_000_000);
  const savedId = typeof productId === "number" ? productId : createdProductId;
  const archiveFile = async (file: ProductCard["files"][number]) => {
    if (savedId == null) return;
    try {
      await request(`/api/products/${savedId}/files/${file.id}`, { method: "PATCH", body: JSON.stringify({ active: 0 }) });
      setCard((current) => current ? { ...current, files: current.files.filter((item) => item.id !== file.id) } : current);
      notify(`Файл «${file.fileName}» перемещён в архив`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Не удалось убрать файл"); }
  };

  return <div className="product-card-page">
    {!card ? <div className="product-card-loading">{message || "Загрузка карточки…"}</div> : <form ref={formRef} className="product-card-form" onSubmit={save} onChange={() => markDirty()} onInvalidCapture={() => setPendingNavigation(null)}>
      <div className="product-card-actions">{canWriteCatalog && <button className="button primary" disabled={busy}>{busy ? "Сохранение…" : "Сохранить"}</button>}<button type="button" className="button outline" onClick={requestClose}>Закрыть</button>{canWriteCatalog && productId !== "new" && <button type="button" className="button outline" disabled={busy || dirty} onClick={() => void archive()}>{card.active ? "В архив" : "Восстановить"}</button>}<button type="button" className="button outline" onClick={() => window.print()}>Печать</button></div>
      {message && <div className="form-error product-card-error">{message}</div>}
      <fieldset disabled={!canWriteCatalog} className="product-card-readonly"><label className="product-card-name">{card.kind === "service" ? "Наименование услуги" : "Наименование товара"}<input name="name" required defaultValue={card.name} placeholder={card.kind === "service" ? "Например, Замена масла" : "Например, Масло моторное 5W-30"} /></label></fieldset>
      <div className="product-card-workspace">
        <aside className="product-card-properties">
          <fieldset disabled={!canWriteCatalog} className="product-card-readonly">
          <section className="product-card-subsection product-image-section">
            <b>Изображения</b>
            <label className="button outline product-file-select">Изображение<input type="file" accept="image/jpeg,image/png,image/gif,image/webp,image/avif" onChange={(event) => { event.stopPropagation(); queueFiles(event.currentTarget.files, "image"); event.currentTarget.value = ""; }} /></label>
            <small>JPEG, PNG, GIF, WebP или AVIF · до 8 МБ.</small>
            {card.files.filter((file) => file.fileKind === "image").map((file) => <a className="product-image-preview" key={file.id} href={`/api/products/${savedId}/files/${file.id}?inline=true`} target="_blank" rel="noreferrer"><img src={`/api/products/${savedId}/files/${file.id}?inline=true`} alt={file.fileName} /><span>{file.fileName}</span></a>)}
            {pendingFiles.filter((item) => item.fileKind === "image").map((item, index) => <small key={`${item.file.name}-${index}`}>Будет сохранено: {item.file.name}</small>)}
          </section>
          <section className="product-card-subsection"><b>Общие данные</b><div className="product-fields-stack">
            {select("kind", "Тип", card.kind, [["product", "Товар"], ["service", "Услуга"]])}
            <label>Описание<textarea name="description" rows={3} defaultValue={card.description ?? ""} /></label>
            {select("groupId", "Группа", card.group_id ?? "", [["", "Без группы"], ...groupOptions.map((group) => [String(group.id), productGroupPath(group.id, groupOptions)] as [string, string])])}
            {input("country", "Страна", card.country ?? "", { list: "product-country-options" })}<datalist id="product-country-options">{countryOptions.map((country) => <option key={country} value={country} />)}</datalist>
            <label>Поставщик<select name="supplierId" defaultValue={card.supplier_id ?? ""}><option value="">Не выбран</option>{suppliers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            {input("article", "Артикул", card.article ?? "")}
            {input("code", "Код", card.code)}
            {input("externalCode", "Внешний код", card.external_code ?? "")}
            {input("unit", "Единица измерения", card.unit, { required: true })}
            <div className="product-inline-fields">{input("weight", "Вес", currentDecimal(card.weight_milli), { type: "number", step: "0.001" })}{input("volume", "Объём", currentDecimal(card.volume_milli), { type: "number", step: "0.001" })}</div>
            {select("vatRate", "НДС", card.vat_rate ?? "", [["", "Наследовать из группы / не облагается"], ["0", "0%"], ["5", "5%"], ["10", "10%"], ["12", "12%"], ["20", "20%"]])}<small>Если ставка не указана в карточке товара, используется ближайшая ставка НДС из группы.</small>
          </div></section>
          <section className="product-card-properties-extra">
            <div className="product-card-subsection"><b>Контент торговых площадок</b><p>Отдельные карточки для подключённых каналов продаж.</p><button type="button" className="button outline" disabled>Настроить</button></div>
            <div className="product-card-subsection"><b>Учёт остатков</b><label>Неснижаемый остаток<select name="minStockMode" value={minStockMode} disabled={!isOrganizationAdmin(user.role)} onChange={(event) => setMinStockMode(event.target.value)}><option value="total">Общий по всем складам</option><option value="same">Одинаковый на каждом складе</option><option value="per_warehouse">Задать для каждого склада</option></select></label>{input("minStock", "Минимальное количество", currentUnits(card.min_stock_units), { type: "number", step: "0.000001", min: "0", disabled: minStockMode === "per_warehouse" || !isOrganizationAdmin(user.role) })}{!isOrganizationAdmin(user.role) && <small>Общий режим неснижаемого остатка настраивает владелец или администратор. В режиме по складам можно менять минимумы назначенных салонов.</small>}</div>
            <div className="product-card-subsection"><b>Специализированный учёт</b>{input("packagingUnit", "Фасовка", card.packaging_unit ?? "")}{input("accountingType", "Тип учёта", card.accounting_type ?? "")}{input("ntin", "NTIN", card.ntin ?? "")}{select("productType", "Тип продукции", card.product_type ?? "", [["", "Не задан"], ["product", "Товар"], ["excise", "Подакцизный товар"], ["service", "Услуга"]])}<label className="checkbox-line"><input type="checkbox" name="traceable" defaultChecked={Boolean(card.traceable)} />Прослеживаемый товар</label>{input("marking", "Маркировка", card.marking ?? "")}</div>
            <div className="product-card-subsection"><b>Штрихкоды</b><div className="section-heading"><span /><button type="button" className="button outline" onClick={() => { markDirty(); setBarcodeRows((rows) => [...rows, { barcodeType: "EAN13", barcode: "" }]); }}><Plus size={14} />Добавить штрихкод</button></div>{barcodeRows.map((row, index) => <div className="product-inline-fields barcode-row" key={index}><label>Тип кода<select value={row.barcodeType} onChange={(event) => setBarcode(index, "barcodeType", event.target.value)}><option>EAN13</option><option>EAN8</option><option>UPC</option><option>CODE128</option></select></label><label>Штрихкод<input value={row.barcode} inputMode="numeric" onChange={(event) => setBarcode(index, "barcode", event.target.value)} /></label><button type="button" className="icon-button" aria-label="Удалить штрихкод" onClick={() => { markDirty(); setBarcodeRows((rows) => rows.filter((_, i) => i !== index)); }}>×</button></div>)}{!barcodeRows.length && <small>Штрихкоды не заданы.</small>}</div>
            <div className="product-card-subsection"><b>Для кассового чека</b>{select("taxSystem", "Система налогообложения", card.tax_system ?? "", [["", "По умолчанию"], ["general", "Общая"], ["simplified_income", "Упрощённая: доходы"], ["simplified_income_expense", "Упрощённая: доходы минус расходы"]])}{select("calculationSubject", "Признак предмета расчёта", card.calculation_subject ?? "Товар", [["Товар", "Товар"], ["Услуга", "Услуга"], ["Работа", "Работа"], ["Аванс", "Аванс"]])}</div>
            <div className="product-card-subsection"><b>Доступ</b>{input("accessEmployee", "Сотрудник", card.access_employee ?? "")}{input("accessDepartment", "Отдел", card.access_department ?? "")}<label className="checkbox-line"><input type="checkbox" name="sharedAccess" defaultChecked={card.shared_access !== 0} />Общий доступ</label></div>
          </section>
          </fieldset>
        </aside>
        <div className="product-card-main">
          <div className="product-card-tabs" role="tablist">{productTabs.map((name) => <button type="button" role="tab" aria-selected={tab === name} className={tab === name ? "selected" : ""} key={name} onClick={() => setTab(name)}>{name}{name === "Модификации" && <small>{card.relations.filter((item) => item.relationType === "modification").length}</small>}{name === "Упаковка" && <small>{packagingRows.filter((item) => item.name).length}</small>}{name === "Файлы" && <small>{card.files.length + pendingFiles.length}</small>}</button>)}</div>
          <div className="product-card-content">
        <fieldset disabled={!canWriteCatalog} className="product-card-readonly product-card-tab-readonly">
        <section className="product-tab-panel" hidden={tab !== "Цены"}>
          <div className="product-prices-grid">{input("minimumPrice", "Минимальная цена, ₸", currentPrice(card.minimum_price_tiyin), { type: "number", step: "0.01", min: "0" })}{input("purchasePrice", "Цена закупки, ₸", currentPrice(card.purchase_price_tiyin), { type: "number", step: "0.01", min: "0" })}{input("salePrice", "Цена продажи, ₸", currentPrice(card.sale_price_tiyin), { type: "number", step: "0.01", min: "0" })}<button type="button" className="button outline" onClick={() => setShowPriceSetup((value) => !value)}>{showPriceSetup ? "Скрыть типы цен" : "Настроить цены"}</button></div>
          <label className="checkbox-line"><input type="checkbox" name="retailDiscountAllowed" defaultChecked={card.retail_discount_allowed === 0} />Запретить скидки при продаже в розницу</label>
          <div className="product-card-subsection"><div className="section-heading"><b>Дополнительные цены продажи</b>{showPriceSetup && <button type="button" className="button outline" onClick={() => { markDirty(); setPriceRows((rows) => [...rows, { name: "", price: "0", currency: "KZT" }]); }}><Plus size={14} />Добавить цену</button>}</div>{!showPriceSetup && <p>Базовая цена продажи настроена выше. Дополнительные типы цен сохраняются в карточке товара.</p>}{showPriceSetup && <>{priceRows.map((row, index) => <div className="product-price-row" key={index}><label>Название цены<input value={row.name} onChange={(event) => setPriceRows((rows) => rows.map((item, i) => i === index ? { ...item, name: event.target.value } : item))} placeholder="Например, Оптовая" /></label><label>Цена, ₸<input type="number" min="0" step="0.01" value={row.price} onChange={(event) => setPriceRows((rows) => rows.map((item, i) => i === index ? { ...item, price: event.target.value } : item))} /></label><button type="button" className="icon-button" aria-label="Удалить тип цены" onClick={() => { markDirty(); setPriceRows((rows) => rows.filter((_, i) => i !== index)); }}>×</button></div>)}{!priceRows.length && <small>Дополнительные типы цен не добавлены.</small>}</>}</div>
        </section>
        <section className="product-tab-panel" hidden={tab !== "Модификации" && tab !== "Аналоги"}>
          <div className="section-heading"><b>{tab === "Модификации" ? "Модификации товара" : "Аналоги товара"}</b><button type="button" className="button outline" onClick={() => { markDirty(); setRelationRows((rows) => [...rows, { relatedProductId: "", relationType: tab === "Модификации" ? "modification" : "analogue" }]); }}><Plus size={14} />Добавить</button></div>
          {relationRows.filter((row) => row.relationType === (tab === "Модификации" ? "modification" : "analogue")).map((row) => { const index = relationRows.indexOf(row); return <div className="product-relation-row" key={index}><select value={row.relatedProductId} onChange={(event) => setRelationRows((rows) => rows.map((item, i) => i === index ? { ...item, relatedProductId: event.target.value } : item))}><option value="">Выберите товар или услугу</option>{products.filter((item) => item.id !== productId).map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select><button type="button" className="icon-button" aria-label="Удалить связь" onClick={() => { markDirty(); setRelationRows((rows) => rows.filter((_, i) => i !== index)); }}>×</button></div>; })}
          {!relationRows.some((row) => row.relationType === (tab === "Модификации" ? "modification" : "analogue")) && <div className="product-empty-state">Связанные товары не добавлены.</div>}
        </section>
        <section className="product-tab-panel" hidden={tab !== "Упаковка"}>
          <div className="section-heading"><b>Упаковка</b><button type="button" className="button outline" onClick={() => { markDirty(); setPackagingRows((rows) => [...rows, { name: "", quantity: "", unit: card.unit, codeType: "EAN13", barcode: "" }]); }}><Plus size={14} />Добавить упаковку</button></div>
          <div className="product-packaging-table"><div className="packaging-header"><span>Наименование</span><span>Количество</span><span>Ед.</span><span>Тип кода</span><span>Штрихкод упаковки</span><span /></div>{packagingRows.map((row, index) => <div className="packaging-fields" key={index}><input aria-label="Наименование упаковки" value={row.name} onChange={(event) => setPackaging(index, "name", event.target.value)} /><input aria-label="Количество в упаковке" type="number" min="0" step="0.000001" value={row.quantity} onChange={(event) => setPackaging(index, "quantity", event.target.value)} /><input aria-label="Единица упаковки" value={row.unit} onChange={(event) => setPackaging(index, "unit", event.target.value)} /><select aria-label="Тип кода" value={row.codeType} onChange={(event) => setPackaging(index, "codeType", event.target.value)}><option>EAN13</option><option>EAN8</option><option>CODE128</option></select><input aria-label="Штрихкод упаковки" value={row.barcode} onChange={(event) => setPackaging(index, "barcode", event.target.value)} /><button type="button" className="icon-button" aria-label="Удалить упаковку" onClick={() => { markDirty(); setPackagingRows((rows) => rows.filter((_, i) => i !== index)); }}>×</button></div>)}</div>
          {!packagingRows.length && <div className="product-empty-state">Упаковка не добавлена.</div>}
        </section>
        <section className="product-tab-panel" hidden={tab !== "Остатки"}>
          <div className="product-stock-summary"><div><small>Физический остаток</small><b>{qty(card.stock_units)} {card.unit}</b></div><div><small>Резерв</small><b>{qty(card.reserved_units)} {card.unit}</b></div><div><small>Доступно</small><b>{qty(card.available_units)} {card.unit}</b></div><div><small>Себестоимость</small><b>{money(card.stock_value_tiyin)} ₸</b></div></div>
          <div className="table-card"><table><thead><tr><th>Склад</th><th>Остаток</th><th>Резерв</th><th>Доступно</th><th>Минимум</th></tr></thead><tbody>{warehouses.map((warehouse) => { const row = card.warehouses.find((item) => item.warehouse_id === warehouse.id); return <tr key={warehouse.id}><td>{warehouse.name}</td><td>{qty(row?.stock_units ?? 0)}</td><td>{qty(row?.reserved_units ?? 0)}</td><td>{qty(row?.available_units ?? 0)}</td><td><input aria-label={`Минимум на складе ${warehouse.name}`} type="number" min="0" step="0.000001" disabled={minStockMode !== "per_warehouse"} value={minimumRows[warehouse.id] ?? "0"} onChange={(event) => setMinimumRows((values) => ({ ...values, [warehouse.id]: event.target.value }))} /></td></tr>; })}</tbody></table></div>
        </section>
        <section className="product-tab-panel" hidden={tab !== "История"}>
          <h3>Движение товара</h3><div className="table-card"><table><thead><tr><th>Документ</th><th>Склад</th><th>Статус</th><th>Количество</th><th>Стоимость</th><th>Дата</th></tr></thead><tbody>{card.movements.map((item) => <tr key={item.id}><td>{item.number}</td><td>{item.warehouse_name}</td><td>{item.status === "posted" ? "Проведён" : item.status}</td><td>{qty(item.quantity_units)} {card.unit}</td><td>{money(item.value_tiyin)} ₸</td><td>{item.created_at}</td></tr>)}{!card.movements.length && <tr><td colSpan={6} className="empty-inline">Складских движений пока нет</td></tr>}</tbody></table></div>
          <h3>Изменения карточки</h3><div className="table-card"><table><thead><tr><th>Действие</th><th>Описание</th><th>Дата</th></tr></thead><tbody>{card.history.map((item) => <tr key={item.id}><td>{item.action}</td><td>{item.detail}</td><td>{item.created_at}</td></tr>)}{!card.history.length && <tr><td colSpan={3} className="empty-inline">История пуста</td></tr>}</tbody></table></div>
        </section>
        <section className="product-tab-panel" hidden={tab !== "Файлы"}>
          <div className="section-heading"><h3>Файлы товара</h3><label className="button outline product-file-select">Прикрепить файлы<input type="file" multiple onChange={(event) => { event.stopPropagation(); queueFiles(event.currentTarget.files, "file"); event.currentTarget.value = ""; }} /></label></div>
          {pendingFiles.filter((item) => item.fileKind === "file").map((item, index) => <div className="product-file-row pending" key={`${item.file.name}-${index}`}><span>{item.file.name} · будет сохранён после нажатия «Сохранить»</span><button type="button" className="icon-button" aria-label={`Убрать ${item.file.name}`} onClick={() => { markDirty(); setPendingFiles((files) => files.filter((current) => current !== item)); }}>×</button></div>)}
          {card.files.map((file) => <div className="product-file-row" key={file.id}><span><b>{file.fileName}</b><small>{file.mimeType} · {(Number(file.size) / 1024).toFixed(0)} КБ · {file.createdAt}</small></span><a href={`/api/products/${savedId}/files/${file.id}`} download={file.fileName}>Скачать</a><button type="button" className="icon-button" aria-label={`Убрать ${file.fileName}`} onClick={() => void archiveFile(file)}>×</button></div>)}
          {!pendingFiles.some((item) => item.fileKind === "file") && !card.files.length && <div className="product-empty-state">Файлы товара не прикреплены.</div>}
          <small className="product-file-note">Один файл до 8 МБ. Убранные файлы перемещаются в архив и не удаляются из базы.</small>
        </section>
        </fieldset>
      </div>
      </div>
      </div>
      {confirmClose && <div className="product-close-confirmation" role="alertdialog" aria-modal="true"><section><b>Сохранить изменения?</b><p>В карточке есть несохранённые изменения.</p><div><button type="button" className="button primary" onClick={() => { setConfirmClose(false); formRef.current?.requestSubmit(); }}>Да</button><button type="button" className="button outline" onClick={() => { const next = pendingNavigation; setPendingNavigation(null); dirtyRef.current = false; setDirty(false); onClose(); if (next) commitNavigation(next); }}>Нет</button><button type="button" className="button outline" onClick={() => { setPendingNavigation(null); setConfirmClose(false); }}>Отмена</button></div></section></div>}
    </form>}
  </div>;
}

function CounterpartiesPage({ notify, onOpen }: { notify: (message: string) => void; onOpen: (id: number) => void }) {
  const { user } = useAuth();
  const [rows, setRows] = useState<Counterparty[]>([]); const [query, setQuery] = useState(""); const [dialog, setDialog] = useState(false); const [message, setMessage] = useState("");
  const [creating, setCreating] = useState(false); const creatingRef = useRef(false);
  const queryRef = useRef(query); queryRef.current = query; const loadSequence = useRef(0);
  const load = useCallback(async () => { if (queryRef.current !== query) return; const sequence = ++loadSequence.current; const data = await request<Counterparty[]>(`/api/counterparties?q=${encodeURIComponent(query)}`); if (sequence === loadSequence.current && queryRef.current === query) setRows(data); }, [query]);
  useEffect(() => { let active = true; void load().catch((error) => { if (active) setMessage(error.message); }); return () => { active = false; loadSequence.current += 1; }; }, [load]);
  const create = async (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); if (creatingRef.current) return; creatingRef.current = true; setCreating(true); setMessage(""); const form = new FormData(event.currentTarget);
    try { await request("/api/counterparties", { method: "POST", body: JSON.stringify(Object.fromEntries(form)) }); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Не удалось сохранить"); creatingRef.current = false; setCreating(false); return; }
    setDialog(false); notify("Контрагент сохранён");
    try { await load(); } catch { setMessage("Контрагент сохранён, но список не обновился. Обновите страницу."); }
    creatingRef.current = false; setCreating(false);
  };
  return <>
    <PageHeader title="Контрагенты" actions={<button className="button primary" onClick={() => setDialog(true)}><Plus size={16} />Контрагент</button>} />
    <div className="list-toolbar"><button className="button outline"><Filter size={15} />Фильтр</button><div className="search-box"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Наименование или телефон" /></div><button className="button outline"><List size={15} />Список</button></div>
    {message && !dialog && <div className="notice-error" role="alert">{message}</div>}
    <div className="list-meta"><span>Все {rows.length}</span></div><div className="table-card responsive-table"><table><thead><tr><th><input type="checkbox" /></th><th>Наименование</th><th>Тип</th><th>Телефон</th><th>Электронная почта</th><th>Долг</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td className="mobile-hide"><input type="checkbox" /></td><td data-label="Наименование" className="cell-main"><button className="link-button" onClick={() => onOpen(row.id)}>{row.name}</button></td><td data-label="Тип">{row.kind === "supplier" ? "Поставщик" : row.kind === "both" ? "Покупатель, поставщик" : "Покупатель"}</td><td data-label="Телефон">{row.phone || "—"}</td><td data-label="Электронная почта">{row.email || "—"}</td><td data-label="Долг" title="Расчёт взаиморасчётов пока недоступен">—</td></tr>)}{!rows.length && <tr><td colSpan={6} className="empty-inline">Список пуст</td></tr>}</tbody></table></div>
    {dialog && <Modal title="Новый контрагент" onClose={() => { if (!creatingRef.current) setDialog(false); }}><form className="form-grid" onSubmit={create}><label className="span-2">Наименование<input autoFocus required name="name" /></label><label>Тип<select name="kind" defaultValue="customer">{user.role !== "employee" && <><option value="supplier">Поставщик</option><option value="both">Покупатель и поставщик</option></>}<option value="customer">Покупатель</option></select></label><label>Телефон<input name="phone" /></label><label>Электронная почта<input name="email" type="email" /></label><label className="span-2">Комментарий<textarea name="comment" rows={3} /></label>{message && <p className="form-error span-2">{message}</p>}<div className="modal-actions span-2"><button type="button" className="button outline" disabled={creating} onClick={() => setDialog(false)}>Отмена</button><button className="button primary" disabled={creating}>{creating ? "Сохранение…" : "Сохранить"}</button></div></form></Modal>}
  </>;
}

type CounterpartyContact = { id?: number; fullName: string; position: string; phone: string; email: string; comment: string };
type CounterpartyDetail = Counterparty & Record<string, unknown> & { contacts: CounterpartyContact[]; documents: DocumentRow[]; vehicles: Vehicle[]; contracts?: Contract[] };

function CounterpartyDetailPage({ counterpartyId, onNavigate, registerNavigationGuard, notify }: { counterpartyId: number; onNavigate: (route: string) => void; registerNavigationGuard: (guard: NavigationGuard | null) => void; notify: (message: string) => void }) {
  const { user } = useAuth();
  const [card, setCard] = useState<CounterpartyDetail | null>(null);
  const [contacts, setContacts] = useState<CounterpartyContact[]>([]);
  const [error, setError] = useState(""); const [saving, setSaving] = useState(false); const [reloadRequired, setReloadRequired] = useState(false); const [conflict, setConflict] = useState(false); const [formRevision, setFormRevision] = useState(0);
  const [tab, setTab] = useState<"documents" | "vehicles" | "contracts">("documents");
  const [contractModal, setContractModal] = useState(false);
  const [contractError, setContractError] = useState("");
  const [contractSaving, setContractSaving] = useState(false);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const editable = user.role !== "employee";

  useEffect(() => {
    let active = true;
    if (!Number.isSafeInteger(counterpartyId) || counterpartyId <= 0) { setError("Некорректный идентификатор контрагента."); return; }
    void request<CounterpartyDetail>(`/api/counterparties/${counterpartyId}`)
      .then((result) => { if (active) { setCard(result); setContacts(result.contacts); } })
      .catch((exception) => { if (active) setError(exception instanceof Error ? exception.message : "Не удалось открыть карточку"); });
    return () => { active = false; };
  }, [counterpartyId]);
  useEffect(() => {
    const guard: NavigationGuard = () => {
      if (savingRef.current) return true;
      if (!dirtyRef.current) return false;
      if (!window.confirm("В карточке есть несохранённые изменения. Покинуть страницу?")) return true;
      dirtyRef.current = false; return false;
    };
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirtyRef.current || savingRef.current) { event.preventDefault(); event.returnValue = ""; } };
    registerNavigationGuard(guard); window.addEventListener("beforeunload", beforeUnload);
    return () => { registerNavigationGuard(null); window.removeEventListener("beforeunload", beforeUnload); };
  }, [registerNavigationGuard]);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (savingRef.current) return;
    savingRef.current = true; setSaving(true); setError("");
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    try { await request(`/api/counterparties/${counterpartyId}`, { method: "PATCH", body: JSON.stringify({ ...fields, contacts, expectedRevision: Number(card?.revision ?? 0) }) }); }
    catch (exception) { if (exception instanceof Error && (exception as Error & { status?: number }).status === 409) setConflict(true); setError(exception instanceof Error ? exception.message : "Не удалось сохранить карточку"); savingRef.current = false; setSaving(false); return; }
    dirtyRef.current = false; notify("Контрагент сохранён");
    try { const updated = await request<CounterpartyDetail>(`/api/counterparties/${counterpartyId}`); setCard(updated); setContacts(updated.contacts); setFormRevision((revision) => revision + 1); }
    catch { setReloadRequired(true); setError("Изменения сохранены, но карточку не удалось обновить. Повторите загрузку перед дальнейшим редактированием."); }
    savingRef.current = false; setSaving(false);
  };
  const reload = async () => {
    if (conflict && dirtyRef.current && !window.confirm("Несохранённые изменения будут потеряны. Загрузить актуальную карточку?")) return;
    savingRef.current = true; setSaving(true); setError("");
    try { const updated = await request<CounterpartyDetail>(`/api/counterparties/${counterpartyId}`); setCard(updated); setContacts(updated.contacts); setFormRevision((revision) => revision + 1); setReloadRequired(false); setConflict(false); dirtyRef.current = false; }
    catch { setError("Не удалось обновить карточку. Повторите попытку."); }
    finally { savingRef.current = false; setSaving(false); }
  };
  const handleCreateContract = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setContractSaving(true);
    setContractError("");
    const form = new FormData(event.currentTarget);
    try {
      await request(`/api/counterparties/${counterpartyId}/contracts`, {
        method: "POST",
        body: JSON.stringify({
          number: form.get("number") || undefined,
          date: form.get("date"),
          dueDate: form.get("dueDate") || null,
          currency: form.get("currency") || "KZT",
          sum: form.get("sum") ? Number(form.get("sum")) : 0,
          comment: form.get("comment") || "",
        }),
      });
      setContractModal(false);
      notify("Договор добавлен");
      await reload();
    } catch (err) {
      setContractError(err instanceof Error ? err.message : "Не удалось сохранить договор");
    } finally {
      setContractSaving(false);
    }
  };
  if (!card) return <><PageHeader title="Контрагент" actions={<button className="button outline" onClick={() => onNavigate("counterparties")}>К списку</button>} />{error ? <div className="notice-error">{error}</div> : <p className="muted">Загружаем карточку…</p>}</>;
  const field = (label: string, name: string, column: string, type = "text") => <label key={name}>{label}<input name={name} type={type} defaultValue={String(card[column] ?? "")} /></label>;
  return <div className="counterparty-card">
    <PageHeader title={card.name} actions={<button className="button outline" onClick={() => onNavigate("counterparties")}>К списку</button>} />
    {error && <div className="notice-error" role="alert">{error}</div>}
    {(reloadRequired || conflict) && <button type="button" className="button outline" disabled={saving} onClick={() => void reload()}>{conflict ? "Загрузить актуальную карточку" : "Повторить загрузку"}</button>}
    <form key={`${card.id}-${formRevision}`} onSubmit={save} onChange={() => { if (editable) dirtyRef.current = true; }}>
      <fieldset disabled={!editable || saving || reloadRequired} className="counterparty-fields">
        <section><h2>О контрагенте</h2><div className="form-grid">
          <label className="span-2">Наименование<input name="name" required defaultValue={card.name} /></label>
          <label>Тип отношений<select name="kind" defaultValue={card.kind}><option value="customer">Покупатель</option><option value="supplier">Поставщик</option><option value="both">Покупатель и поставщик</option></select></label>
          {field("Статус", "status", "status")}{field("Группа", "groupName", "group_name")}{field("Телефон", "phone", "phone")}{field("Факс", "fax", "fax")}{field("Электронная почта", "email", "email", "email")}{field("Фактический адрес", "actualAddress", "actual_address")}{field("Комментарий к адресу", "addressComment", "address_comment")}{field("Код", "code", "code")}{field("Внешний код", "externalCode", "external_code")}
          <label className="span-2">Комментарий<textarea name="comment" rows={2} defaultValue={String(card.comment ?? "")} /></label>
        </div></section>
        <section><div className="section-heading"><h2>Контактные лица</h2>{editable && <button type="button" className="button outline" onClick={() => { dirtyRef.current = true; setContacts((rows) => [...rows, { fullName: "", position: "", phone: "", email: "", comment: "" }]); }}><Plus size={14} />Контакт</button>}</div>
          {contacts.map((contact, index) => <div className="counterparty-contact form-grid" key={index}>{([ ["ФИО", "fullName"], ["Должность", "position"], ["Телефон", "phone"], ["Email", "email"], ["Комментарий", "comment"] ] as Array<[string, keyof CounterpartyContact]>).map(([label, key]) => <label key={key}>{label}<input required={key === "fullName"} type={key === "email" ? "email" : "text"} value={contact[key]} onChange={(event) => { dirtyRef.current = true; setContacts((rows) => rows.map((row, i) => i === index ? { ...row, [key]: event.target.value } : row)); }} /></label>)}{editable && <button type="button" className="button outline" onClick={() => { dirtyRef.current = true; setContacts((rows) => rows.filter((_, i) => i !== index)); }}>Удалить контакт</button>}</div>)}
          {!contacts.length && <p className="muted">Контактные лица не добавлены.</p>}
        </section>
        <section><h2>Реквизиты и налоги</h2><div className="form-grid">
          <label>Тип<select name="legalType" defaultValue={String(card.legal_type ?? "legal_entity")}><option value="legal_entity">Юридическое лицо</option><option value="entrepreneur">ИП</option><option value="individual">Физическое лицо</option><option value="legal_entity_ru">Юридическое лицо (Россия)</option><option value="entrepreneur_ru">ИП (Россия)</option><option value="individual_ru">Физическое лицо (Россия)</option></select></label>{field("БИН / ИИН", "bin", "bin")}{field("Полное наименование", "legalName", "legal_name")}{field("Юридический адрес", "legalAddress", "legal_address")}{field("Комментарий к адресу", "legalAddressComment", "legal_address_comment")}{field("ОКЭД", "oked", "oked")}{field("КБе", "kbe", "kbe")}{field("Номер свидетельства НДС", "vatCertificateNumber", "vat_certificate_number")}{field("Дата свидетельства НДС", "vatCertificateDate", "vat_certificate_date", "date")}{field("Тип цены", "priceType", "price_type")}{field("Дисконтная карта", "discountCard", "discount_card")}
        </div></section>
      </fieldset>
      {editable && <div className="modal-actions"><button className="button primary" disabled={saving || reloadRequired || conflict}>{saving ? "Сохранение…" : "Сохранить"}</button></div>}
    </form>
    <div className="counterparty-tabs">
      <button className={tab === "documents" ? "selected" : ""} onClick={() => setTab("documents")}>Документы ({card.documents.length})</button>
      <button className={tab === "vehicles" ? "selected" : ""} onClick={() => setTab("vehicles")}>Автомобили ({card.vehicles.length})</button>
      <button className={tab === "contracts" ? "selected" : ""} onClick={() => setTab("contracts")}>Договоры ({(card.contracts ?? []).length})</button>
    </div>
    {tab === "documents" && <div className="table-card responsive-table"><table><thead><tr><th>Документ</th><th>Дата</th><th>Статус</th><th>Сумма</th></tr></thead><tbody>{card.documents.map((document) => <tr key={document.id}><td data-label="Документ" className="cell-main"><button className="link-button" onClick={() => onNavigate(`${document.kind === "work_order" ? "work_order" : "documents"}?open=${document.id}`)}>{document.number}</button></td><td data-label="Дата">{document.date}</td><td data-label="Статус">{({ posted: "Проведён", draft: "Черновик", cancelled: "Отменён" } as Record<string, string>)[document.status] ?? document.status}</td><td data-label="Сумма">{money(document.total_tiyin)} ₸</td></tr>)}{!card.documents.length && <tr><td colSpan={4} className="empty-inline">Документов пока нет</td></tr>}</tbody></table></div>}
    {tab === "vehicles" && <div className="table-card responsive-table"><table><thead><tr><th>Госномер</th><th>Автомобиль</th><th>Пробег</th></tr></thead><tbody>{card.vehicles.map((vehicle) => <tr key={vehicle.id}><td data-label="Госномер" className="cell-main"><button className="link-button" onClick={() => onNavigate(`vehicle_detail?id=${vehicle.id}`)}>{vehicle.plate}</button></td><td data-label="Автомобиль">{vehicle.make} {vehicle.model}</td><td data-label="Пробег">{Number(vehicle.current_mileage).toLocaleString("ru-RU")} км</td></tr>)}{!card.vehicles.length && <tr><td colSpan={3} className="empty-inline">Автомобилей пока нет</td></tr>}</tbody></table></div>}
    {tab === "contracts" && <div className="table-card responsive-table">
      {editable && <div style={{ display: "flex", justifyContent: "flex-end", padding: "8px 12px", borderBottom: "1px solid var(--line)" }}><button type="button" className="button primary" onClick={() => { setContractError(""); setContractModal(true); }}><Plus size={14} />Договор</button></div>}
      <table><thead><tr><th>№ договора</th><th>Дата</th><th>Срок действия</th><th>Сумма</th><th>Статус</th><th>Комментарий</th></tr></thead><tbody>
        {(card.contracts ?? []).map((contract) => <tr key={contract.id}><td data-label="№ договора" className="cell-main"><b>№ {contract.number}</b></td><td data-label="Дата">{contract.date}</td><td data-label="Срок действия">{contract.due_date || "Бессрочный"}</td><td data-label="Сумма">{contract.sum_tiyin ? `${money(contract.sum_tiyin)} ${contract.currency || "₸"}` : "Без ограничения"}</td><td data-label="Статус"><span className={`status-pill ${contract.active ? "status-posted" : "status-cancelled"}`}>{contract.active ? "Активен" : "В архиве"}</span></td><td data-label="Комментарий">{contract.comment || "—"}</td></tr>)}
        {!(card.contracts ?? []).length && <tr><td colSpan={6} className="empty-inline">Договоров пока нет</td></tr>}
      </tbody></table>
    </div>}
    {contractModal && <Modal title="Новый договор" onClose={() => setContractModal(false)}>
      <form onSubmit={handleCreateContract} className="form-grid">
        <label>Номер договора<input name="number" placeholder="Оставьте пустым для автонумерации" /></label>
        <label>Дата договора<input name="date" type="date" defaultValue={localDateValue()} required /></label>
        <label>Срок действия (до)<input name="dueDate" type="date" /></label>
        <label>Валюта<select name="currency" defaultValue="KZT"><option value="KZT">KZT (Тенге)</option><option value="RUB">RUB (Рубль)</option><option value="USD">USD ($)</option><option value="EUR">EUR (€)</option></select></label>
        <label>Сумма договора<input name="sum" type="number" min="0" step="0.01" placeholder="0 = без ограничения" /></label>
        <label className="span-2">Комментарий<textarea name="comment" rows={2} /></label>
        {contractError && <div className="form-error span-2">{contractError}</div>}
        <div className="modal-actions span-2"><button type="button" className="button outline" onClick={() => setContractModal(false)}>Отмена</button><button className="button primary" disabled={contractSaving}>{contractSaving ? "Сохранение…" : "Сохранить"}</button></div>
      </form>
    </Modal>}
  </div>;
}

function VehiclesPage({ notify, onNewWorkOrder, onOpenVehicle }: { notify: (message: string) => void; onNewWorkOrder: () => void; onOpenVehicle: (id: number) => void }) {
  const [rows, setRows] = useState<Vehicle[]>([]); const [customers, setCustomers] = useState<Counterparty[]>([]);
  const [query, setQuery] = useState(""); const [dialog, setDialog] = useState(false); const [message, setMessage] = useState("");
  const load = useCallback(async () => setRows(await request<Vehicle[]>(`/api/vehicles?q=${encodeURIComponent(query)}`)), [query]);
  useEffect(() => { void Promise.all([load(), request<Counterparty[]>("/api/counterparties")]).then(([, values]) => setCustomers(values.filter((customer) => ["customer", "both"].includes(customer.kind)))).catch((error) => setMessage(error.message)); }, [load]);
  const create = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setMessage(""); const form = new FormData(event.currentTarget);
    try { await request("/api/vehicles", { method: "POST", body: JSON.stringify(Object.fromEntries(form)) }); setDialog(false); await load(); notify("Автомобиль сохранён"); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Не удалось сохранить автомобиль"); }
  };
  return <>
    <PageHeader title="Автомобили клиентов" actions={<><button className="button outline" onClick={onNewWorkOrder}><Wrench size={15} />Заказ-наряд</button><button className="button primary" onClick={() => setDialog(true)}><Plus size={16} />Автомобиль</button></>} />
    <div className="list-toolbar"><button className="button outline"><Filter size={15} />Фильтр</button><div className="search-box"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Госномер, VIN, марка или клиент" /></div><button className="button outline"><List size={15} />Список</button></div>
    <div className="list-meta"><span>Все {rows.length}</span></div>
    {message && <div className="notice-error">{message}</div>}
    <div className="table-card responsive-table"><table><thead><tr><th>Госномер</th><th>Автомобиль</th><th>Клиент</th><th>VIN</th><th>Текущий пробег</th><th>Следующая замена</th></tr></thead><tbody>
      {rows.map((vehicle) => <tr key={vehicle.id}><td data-label="Госномер" className="cell-main"><button className="link-button" onClick={() => onOpenVehicle(vehicle.id)}><b>{vehicle.plate}</b></button></td><td data-label="Автомобиль"><button className="link-button" onClick={() => onOpenVehicle(vehicle.id)}>{vehicle.make} {vehicle.model}{vehicle.year ? ` · ${vehicle.year}` : ""}</button></td><td data-label="Клиент">{vehicle.counterparty_name ?? "—"}</td><td data-label="VIN" className="mobile-hide">{vehicle.vin || "—"}</td><td data-label="Текущий пробег">{Number(vehicle.current_mileage).toLocaleString("ru-RU")} км</td><td data-label="Следующая замена">{vehicle.next_service_km ? <span className={Number(vehicle.current_mileage) >= Number(vehicle.next_service_km) ? "low-stock" : ""}>{Number(vehicle.next_service_km).toLocaleString("ru-RU")} км</span> : "Не задана"}</td></tr>)}
      {!rows.length && <tr><td colSpan={6} className="empty-inline">Добавьте автомобиль — история обслуживания и напоминания будут привязаны к нему.</td></tr>}
    </tbody></table></div>
    {dialog && <Modal title="Новый автомобиль" onClose={() => { setDialog(false); setMessage(""); }}><form className="form-grid" onSubmit={create}>
      <label className="span-2">Клиент<select name="counterpartyId" required defaultValue=""><option value="" disabled>Выберите клиента</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name} · {customer.phone || "без телефона"}</option>)}</select></label>
      <label>Госномер<input name="plate" required placeholder="Например, 123ABC02" /></label><label>Марка<input name="make" required placeholder="Toyota" /></label>
      <label>Модель<input name="model" required placeholder="Camry" /></label><label>Год<input name="year" type="number" min="1950" max="2100" /></label>
      <label>VIN<input name="vin" /></label><label>Пробег, км<input name="currentMileage" type="number" min="0" step="1" defaultValue="0" /></label>
      {!customers.length && <div className="form-error span-2">Сначала добавьте клиента в разделе «Клиенты».</div>}
      <div className="modal-actions span-2"><button type="button" className="button outline" onClick={() => setDialog(false)}>Отмена</button><button className="button primary" disabled={!customers.length}>Сохранить</button></div>
    </form></Modal>}
  </>;
}

function VehicleDetailPage({ vehicleId, onBack, onNewWorkOrder, onOpenWorkOrder, onAllWorkOrders }: { vehicleId: number; onBack: () => void; onNewWorkOrder: (id: number) => void; onOpenWorkOrder: (id: number) => void; onAllWorkOrders: (id: number) => void }) {
  const [vehicle, setVehicle] = useState<VehicleDetail | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setVehicle(null); setError("");
    if (!Number.isSafeInteger(vehicleId) || vehicleId <= 0) { setError("В адресе страницы нет корректного идентификатора автомобиля."); return; }
    void request<VehicleDetail>(`/api/vehicles/${vehicleId}`)
      .then((result) => { if (active) setVehicle(result); })
      .catch((exception) => { if (active) setError(exception instanceof Error ? exception.message : "Не удалось загрузить автомобиль"); });
    return () => { active = false; };
  }, [vehicleId]);
  if (error) return <><PageHeader title="Автомобиль" actions={<button className="button outline" onClick={onBack}>К списку автомобилей</button>} /><div className="notice-error">{error}</div></>;
  if (!vehicle) return <div className="vehicle-detail-loading">Загружаем карточку автомобиля…</div>;
  const nextServiceDistance = vehicle.next_service_km == null ? null : Number(vehicle.next_service_km) - Number(vehicle.current_mileage);
  return <div className="vehicle-detail-page">
    <PageHeader title={`${vehicle.plate} · ${vehicle.make} ${vehicle.model}`} actions={<><button className="button outline" onClick={onBack}>К списку автомобилей</button><button className="button primary" onClick={() => onNewWorkOrder(vehicle.id)}><Wrench size={15} />Заказ-наряд</button></>} />
    <div className="vehicle-summary">
      <div><small>Клиент</small><b>{vehicle.counterparty_name ?? "—"}</b><span>{vehicle.counterparty_phone || "Телефон не указан"}</span></div>
      <div><small>Автомобиль</small><b>{vehicle.make} {vehicle.model}{vehicle.year ? ` · ${vehicle.year}` : ""}</b><span>{vehicle.vin ? `VIN ${vehicle.vin}` : "VIN не указан"}</span></div>
      <div><small>Текущий пробег</small><b>{Number(vehicle.current_mileage).toLocaleString("ru-RU")} км</b><span>При создании: {Number(vehicle.initial_mileage).toLocaleString("ru-RU")} км</span></div>
      <div><small>Следующее обслуживание</small><b>{vehicle.next_service_km == null ? "Не задано" : `${Number(vehicle.next_service_km).toLocaleString("ru-RU")} км`}</b><span className={nextServiceDistance != null && nextServiceDistance <= 0 ? "low-stock" : ""}>{nextServiceDistance == null ? "Задайте пробег в заказ-наряде" : nextServiceDistance <= 0 ? `Просрочено на ${Math.abs(nextServiceDistance).toLocaleString("ru-RU")} км` : `Осталось ${nextServiceDistance.toLocaleString("ru-RU")} км`}</span></div>
    </div>
    <div className="vehicle-history-heading"><div><h2>История заказ-нарядов</h2><small>Показаны проведённые документы и черновики. В пробеге учитываются только проведённые заказ-наряды.</small></div><button className="button outline" onClick={() => onAllWorkOrders(vehicle.id)}>Все документы автомобиля</button></div>
    {vehicle.service_history.length ? <div className="vehicle-history-list">{vehicle.service_history.map((order) => <article className="vehicle-history-card" key={order.id}>
      <header><div><button className="link-button vehicle-history-number" onClick={() => onOpenWorkOrder(order.id)}>{order.number}</button><span className={`status-pill status-${order.status}`}>{order.status === "posted" ? "Проведён" : order.status === "draft" ? "Черновик" : order.status}</span></div><time>{order.date}</time></header>
      <div className="vehicle-history-meta"><span>Пробег: <b>{order.odometer_km == null ? "—" : `${Number(order.odometer_km).toLocaleString("ru-RU")} км`}</b></span><span>Склад: <b>{order.warehouse_name ?? "—"}</b></span><span>Сумма: <b>{money(order.total_tiyin)} ₸</b></span></div>
      <div className="vehicle-history-lines">{order.lines.length ? order.lines.map((line) => <div key={line.id}><span>{line.product_name}</span><small>{qty(line.quantity_units)} {line.unit} × {money(line.unit_price_tiyin)} ₸</small></div>) : <span className="muted">Без товарных позиций</span>}</div>
      {order.comment && <p className="vehicle-history-comment">{order.comment}</p>}
      <footer><button className="link-button" onClick={() => onOpenWorkOrder(order.id)}>Открыть заказ-наряд</button></footer>
    </article>)}</div> : <div className="vehicle-history-empty"><CarFront size={32} /><b>Заказ-нарядов пока нет</b><span>Создайте заказ-наряд, чтобы сохранить первое обслуживание автомобиля.</span><button className="button primary" onClick={() => onNewWorkOrder(vehicle.id)}><Wrench size={15} />Создать заказ-наряд</button></div>}
  </div>;
}

const docKinds: Record<string, string> = {
  purchaseorder: "Заказ поставщику", supplierinvoice: "Счёт поставщика", receipt: "Приёмка", supplierreturn: "Возврат поставщику",
  customerorder: "Заказ покупателя", customerinvoice: "Счёт покупателю", shipment: "Отгрузка", customerreturn: "Возврат покупателя",
  stockin: "Оприходование", enter: "Оприходование", writeoff: "Списание", loss: "Списание",
  stocktake: "Инвентаризация", inventory: "Инвентаризация", transfer: "Перемещение", move: "Перемещение",
  payments: "Платежи", cashin: "Внесение", cashout: "Выплата",
  cashadjustments: "Корректировка денежных средств", work_order: "Заказ-наряд",
};
const routeDocumentKinds: Record<string, string> = {
  purchaseorder: "supplier_order", supplierinvoice: "supplier_invoice", supplierreturn: "supplier_return",
  customerorder: "customer_order", customerinvoice: "customer_invoice", customerreturn: "customer_return",
  cashin: "cash_in", cashout: "cash_out", cashadjustments: "cash_correction",
  payments: "incoming_payment",
  stockin: "enter", enter: "enter", writeoff: "writeoff", loss: "writeoff",
  stocktake: "stocktake", inventory: "stocktake", transfer: "transfer", move: "transfer",
};
const documentTypeOptions = [
  { kind: "work_order", title: "Заказ-наряд" },
  { kind: "supplier_order", title: "Заказ поставщику" },
  { kind: "supplier_invoice", title: "Счёт поставщика" },
  { kind: "receipt", title: "Приёмка" },
  { kind: "supplier_return", title: "Возврат поставщику" },
  { kind: "customer_order", title: "Заказ покупателя" },
  { kind: "customer_invoice", title: "Счёт покупателю" },
  { kind: "shipment", title: "Отгрузка" },
  { kind: "customer_return", title: "Возврат покупателя" },
  { kind: "enter", title: "Оприходование" },
  { kind: "writeoff", title: "Списание" },
  { kind: "stocktake", title: "Инвентаризация" },
  { kind: "transfer", title: "Перемещение" },
  { kind: "payment", title: "Платёж" },
  { kind: "incoming_payment", title: "Входящий платёж" },
  { kind: "cash_in", title: "Внесение" },
  { kind: "cash_out", title: "Выплата" },
  { kind: "cash_correction", title: "Корректировка денежных средств" },
];
const createButtonLabels: Record<string, string> = {
  customerorder: "+ Заказ",
  work_order: "+ Заказ-наряд",
  customerinvoice: "+ Счёт",
  shipment: "+ Отгрузка",
  customerreturn: "+ Возврат",
  purchaseorder: "+ Заказ",
  supplierinvoice: "+ Счёт",
  receipt: "+ Приёмка",
  supplierreturn: "+ Возврат",
  stockin: "+ Оприходование",
  enter: "+ Оприходование",
  writeoff: "+ Списание",
  loss: "+ Списание",
  transfer: "+ Перемещение",
  move: "+ Перемещение",
  stocktake: "+ Инвентаризация",
  inventory: "+ Инвентаризация",
  payments: "+ Платёж",
  cashin: "+ Внесение",
  cashout: "+ Выплата",
};

function DocumentsPage({ route, location, notify, onNavigate }: { route: string; location: string; notify: (message: string) => void; onNavigate: (route: string) => void }) {
  const { user } = useAuth();
  const initialParams = new URLSearchParams(location.split("?")[1] ?? "");
  const shouldOpenNew = ["work_order", "payments"].includes(route) && initialParams.get("new") === "1";
  const seededOrderId = route === "payments" ? initialParams.get("orderId") ?? "" : "";
  const [rows, setRows] = useState<DocumentRow[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [dialog, setDialog] = useState(shouldOpenNew);
  const [selected, setSelected] = useState<DocumentDetail | null>(null);
  const [query, setQuery] = useState(initialParams.get("q") ?? "");
  const [vehicleFilterId, setVehicleFilterId] = useState(initialParams.get("vehicleId") ?? "");
  const [filterVehicle, setFilterVehicle] = useState<VehicleDetail | null>(null);
  const [message, setMessage] = useState("");

  // Interactive filters
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filterWarehouseId, setFilterWarehouseId] = useState<number | "all">("all");
  const [warehousesList, setWarehousesList] = useState<Array<{ id: number; name: string }>>([]);
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false);
  const [targetStatusName, setTargetStatusName] = useState("Подтвержден");
  const [bulkBusy, setBulkBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/warehouses");
        if (res.ok) setWarehousesList(await res.json());
      } catch {}
    })();
  }, []);

  const kind = route === "documents" ? "" : routeDocumentKinds[route] ?? route;
  const title = pageTitles[route] ?? docKinds[route] ?? "Документы";
  const createLabel = createButtonLabels[route] ?? (route === "documents" ? "+ Документ" : `+ ${title}`);
  const openDocumentId = Number(initialParams.get("open") ?? "");
  const seededVehicleId = initialParams.get("vehicleId") ?? "";
  const queryKind = route === "payments" ? "money_journal" : kind;

  const queryKey = JSON.stringify([queryKind, query, vehicleFilterId, filterStatus, filterDateFrom, filterDateTo, filterWarehouseId]);
  const queryKeyRef = useRef(queryKey);
  queryKeyRef.current = queryKey;
  const loadSequenceRef = useRef(0);
  const openSequenceRef = useRef(0);

  const load = useCallback(async () => {
    if (queryKeyRef.current !== queryKey) return;
    const sequence = ++loadSequenceRef.current;
    const q = new URLSearchParams();
    if (queryKind) q.set("kind", queryKind);
    if (query) q.set("q", query);
    if (vehicleFilterId) q.set("vehicleId", vehicleFilterId);
    if (filterStatus !== "all") q.set("status", filterStatus);
    if (filterDateFrom) q.set("from", filterDateFrom);
    if (filterDateTo) q.set("to", filterDateTo);
    if (filterWarehouseId !== "all") q.set("warehouseId", String(filterWarehouseId));

    const result = await request<DocumentRow[]>(`/api/documents?${q.toString()}`);
    if (queryKeyRef.current === queryKey && loadSequenceRef.current === sequence) setRows(result);
  }, [queryKey, queryKind, query, vehicleFilterId, filterStatus, filterDateFrom, filterDateTo, filterWarehouseId]);
  useEffect(() => { let active = true; void load().catch((error) => { if (active) setMessage(error.message); }); return () => { active = false; loadSequenceRef.current += 1; }; }, [load]);
  useEffect(() => {
    const params = new URLSearchParams(location.split("?")[1] ?? "");
    setQuery(params.get("q") ?? ""); setVehicleFilterId(params.get("vehicleId") ?? "");
    setDialog(["work_order", "payments"].includes(route) && params.get("new") === "1");
    const linkedDocumentId = Number(params.get("open") ?? "");
    if (!Number.isSafeInteger(linkedDocumentId) || linkedDocumentId <= 0) { openSequenceRef.current += 1; setSelected(null); }
  }, [location, route]);
  useEffect(() => {
    let active = true;
    if (!vehicleFilterId) { setFilterVehicle(null); return () => { active = false; }; }
    void request<VehicleDetail>(`/api/vehicles/${encodeURIComponent(vehicleFilterId)}`)
      .then((vehicle) => { if (active) setFilterVehicle(vehicle); })
      .catch(() => { if (active) setFilterVehicle(null); });
    return () => { active = false; };
  }, [vehicleFilterId]);
  const post = async (id: number) => {
    setMessage("");
    try { await request(`/api/documents/${id}/post`, { method: "POST" }); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Не удалось провести документ"); return; }
    notify("Документ проведён");
    try { await load(); } catch { setMessage("Документ проведён, но список не обновился. Обновите страницу."); }
  };
  const open = async (id: number) => {
    setMessage(""); const sequence = ++openSequenceRef.current;
    try { const result = await request<DocumentDetail>(`/api/documents/${id}`); if (sequence === openSequenceRef.current) setSelected(result); }
    catch (error) { if (sequence === openSequenceRef.current) setMessage(error instanceof Error ? error.message : "Не удалось открыть документ"); }
  };
  useEffect(() => { if (Number.isSafeInteger(openDocumentId) && openDocumentId > 0) void open(openDocumentId); }, [openDocumentId]);
  const updateStatus = async (action: "post" | "unpost") => {
    if (!selected) return;
    const sequence = openSequenceRef.current;
    setMessage("");
    try { await request(`/api/documents/${selected.id}/${action}`, { method: "POST" }); }
    catch (error) { if (sequence === openSequenceRef.current) setMessage(error instanceof Error ? error.message : "Не удалось изменить статус"); return; }
    notify(action === "post" ? "Документ проведён" : "Проведение отменено");
    try { const detail = await request<DocumentDetail>(`/api/documents/${selected.id}`); if (sequence === openSequenceRef.current) setSelected(detail); await load(); }
    catch { if (sequence === openSequenceRef.current) setMessage("Статус изменён, но данные не обновились. Закройте окно и обновите страницу."); }
  };
  const remove = async () => {
    if (!selected) return;
    const sequence = openSequenceRef.current;
    setMessage("");
    try { await request(`/api/documents/${selected.id}`, { method: "DELETE" }); }
    catch (error) { if (sequence === openSequenceRef.current) setMessage(error instanceof Error ? error.message : "Не удалось удалить документ"); return; }
    if (sequence === openSequenceRef.current) { setSelected(null); if (openDocumentId > 0) onNavigate(route); }
    notify("Документ перемещён в корзину");
    try { await load(); } catch { if (sequence === openSequenceRef.current) setMessage("Документ удалён, но список не обновился. Обновите страницу."); }
  };
  const hasActiveFilters = filterStatus !== "all" || filterDateFrom !== "" || filterDateTo !== "" || filterWarehouseId !== "all";

  const handleBulkAction = async (action: "post" | "unpost" | "delete" | "status", statusName?: string) => {
    if (!selectedIds.length) return;
    setBulkBusy(true);
    try {
      if (action === "post" || action === "unpost") {
        for (const id of selectedIds) await request(`/api/documents/${id}/${action}`, { method: "POST" });
        notify(`Обработано документов: ${selectedIds.length}`);
        setSelectedIds([]); setBulkStatusOpen(false); await load();
        return;
      }
      const res = await fetch("/api/documents/bulk-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: selectedIds,
          action: action === "status" ? undefined : action,
          statusName: action === "status" ? statusName : undefined,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        notify(`Обработано документов: ${data.count}`);
        setSelectedIds([]);
        setBulkStatusOpen(false);
        await load();
      } else {
        setMessage(data.error || "Ошибка при массовой операции");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ошибка соединения с сервером");
      void load().catch(() => undefined);
    } finally {
      setBulkBusy(false);
    }
  };

  const exportToCsv = () => {
    const exportRows = selectedIds.length ? rows.filter(r => selectedIds.includes(r.id)) : rows;
    if (!exportRows.length) return;
    const headers = ["Номер", "Дата", "Статус", "Контрагент", "Автомобиль", "Склад", "Позиций", "Сумма (KZT)"];
    const csvContent = [
      headers.join(";"),
      ...exportRows.map(r => [
        `"${r.number}"`,
        `"${r.date}"`,
        `"${r.status === 'posted' ? 'Проведён' : 'Черновик'}"`,
        `"${(r.counterparty_name || '').replace(/"/g, '""')}"`,
        `"${r.vehicle_plate || ''}"`,
        `"${(r.warehouse_name || '').replace(/"/g, '""')}"`,
        r.line_count,
        (r.total_tiyin / 100).toFixed(2),
      ].join(";"))
    ].join("\r\n");

    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `documents_${route}_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    notify("Реестр экспортирован в Excel / CSV");
  };

  return <>
    <PageHeader
      title={title}
      actions={
        <>
          <button className="button outline" onClick={exportToCsv}><PrinterIcon />Экспорт в Excel</button>
          <button className="button action-blue" onClick={() => setDialog(true)}>
            <Plus size={16} />{createLabel}
          </button>
        </>
      }
    />
    <div className="list-toolbar">
      <button
        className={`button outline ${filterOpen || hasActiveFilters ? "filter-active" : ""}`}
        onClick={() => setFilterOpen((prev) => !prev)}
      >
        <Filter size={15} />Фильтр {hasActiveFilters ? "●" : ""}
      </button>
      <div className="search-box">
        <Search size={16} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Номер, контрагент или комментарий..." />
      </div>
      <div className="view-switch">
        <button className="selected"><List size={15} />Список</button>
        <button><Layers size={15} />Столбцы</button>
        <button><CalendarDays size={15} />Календарь</button>
      </div>
    </div>

    {filterOpen && (
      <div className="filter-drawer">
        <div className="filter-group">
          <label>Период:</label>
          <input type="date" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)} />
          <span>—</span>
          <input type="date" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)} />
        </div>
        <div className="filter-group">
          <label>Статус:</label>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
            <option value="all">Все статусы</option>
            <option value="posted">Проведён</option>
            <option value="draft">Черновик</option>
          </select>
        </div>
        <div className="filter-group">
          <label>Склад:</label>
          <select value={filterWarehouseId} onChange={(e) => setFilterWarehouseId(e.target.value === "all" ? "all" : Number(e.target.value))}>
            <option value="all">Все склады</option>
            {warehousesList.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
        {hasActiveFilters && (
          <button
            className="filter-reset-btn"
            onClick={() => {
              setFilterStatus("all");
              setFilterDateFrom("");
              setFilterDateTo("");
              setFilterWarehouseId("all");
            }}
          >
            Сбросить фильтры
          </button>
        )}
      </div>
    )}

    {vehicleFilterId && <div className="vehicle-filter-banner"><span>Заказ-наряды автомобиля: <b>{filterVehicle ? `${filterVehicle.plate} · ${filterVehicle.make} ${filterVehicle.model}` : `#${vehicleFilterId}`}</b></span><button className="link-button" onClick={() => onNavigate("work_order")}>Сбросить фильтр</button></div>}
    <div className="list-meta">
      <span>Все {rows.length}{selectedIds.length > 0 ? ` (выбрано ${selectedIds.length})` : ""}</span>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button className="button outline" disabled={!selectedIds.length} onClick={() => setBulkStatusOpen(true)}>
          Статус
        </button>
        <button className="button outline" disabled={!selectedIds.length || bulkBusy} onClick={() => void handleBulkAction("post")}>
          Провести
        </button>
        <button className="button outline" disabled={!selectedIds.length || bulkBusy} onClick={() => void handleBulkAction("unpost")}>
          Снять проведение
        </button>
        <button className="button outline" disabled={!selectedIds.length || bulkBusy} onClick={() => void handleBulkAction("delete")} style={{ color: "#d32f2f" }}>
          В корзину
        </button>
        <button className="button outline" onClick={exportToCsv}>
          Печать / Экспорт
        </button>
        <button className="button outline" onClick={() => onNavigate("scripts")}>
          Сценарии
        </button>
      </div>
    </div>
    {message && !selected && <div className="notice-error">{message}<button onClick={() => setMessage("")}><X size={14} /></button></div>}
    <div className="table-card responsive-table"><table><thead><tr><th><input type="checkbox" checked={rows.length > 0 && selectedIds.length === rows.length} onChange={(e) => setSelectedIds(e.target.checked ? rows.map(r => r.id) : [])} /></th><th>Документ</th>{route === "payments" && <th>Тип</th>}<th>Статус</th><th>Дата</th><th>Контрагент</th>{kind === "work_order" && <th>Автомобиль</th>}{kind === "work_order" && <th>Оплата</th>}<th>Склад</th><th>Позиции</th><th>Сумма</th><th></th></tr></thead><tbody>
      {rows.map((row) => <tr key={row.id}>
        <td className="mobile-hide"><input type="checkbox" checked={selectedIds.includes(row.id)} onChange={(e) => setSelectedIds(prev => e.target.checked ? [...prev, row.id] : prev.filter(id => id !== row.id))} /></td>
        <td data-label="Документ" className="cell-main"><button className="link-button" onClick={() => void open(row.id)}>{row.number}</button></td>
        {route === "payments" && <td data-label="Тип">{({ incoming_payment: "Входящий платёж", payment: "Платёж (старый тип)", cash_in: "Внесение (розница)", cash_out: "Выплата (розница)" } as Record<string, string>)[row.kind] ?? row.kind}</td>}
        <td data-label="Статус"><span className={`status-pill status-${row.status}`}>{row.status === "posted" ? "Проведён" : row.status === "draft" ? "Черновик" : row.status === "deleted" ? "Удалён" : row.status}</span></td>
        <td data-label="Дата">{row.date}</td>
        <td data-label="Контрагент">{row.counterparty_name ?? "—"}</td>
        {kind === "work_order" && <td data-label="Автомобиль">{row.vehicle_plate ?? "—"}</td>}
        {kind === "work_order" && <td data-label="Оплата">{money(row.paid_tiyin ?? 0)} / {money(row.total_tiyin)} ₸<small className="payment-open-amount">К оплате: {money(row.outstanding_tiyin ?? row.total_tiyin)} ₸</small></td>}
        <td data-label="Склад" className="mobile-hide">{row.warehouse_name ?? "—"}{row.destination_warehouse_name && ` → ${row.destination_warehouse_name}`}</td>
        <td data-label="Позиции" className="mobile-hide">{row.line_count}</td>
        <td data-label="Сумма" className="amount-cell">{route === "payments" ? (row.kind === "incoming_payment" || row.kind === "cash_in" ? "+" : "−") : ""}{money(row.total_tiyin)} ₸</td>
        <td data-label="Действия" className="actions-cell">{row.status === "draft" && <button className="link-button" onClick={() => void post(row.id)}>Провести</button>}</td>
      </tr>)}
      {!rows.length && <tr><td colSpan={kind === "work_order" ? 11 : route === "payments" ? 10 : 9} className="empty-state"><FileText size={42} /><h3>Список пуст</h3><p>Создайте первый документ</p>{route !== "documents" && <button className="button primary" onClick={() => setDialog(true)}><Plus size={16} />{createLabel}</button>}</td></tr>}
    </tbody></table></div>
    {dialog && <DocumentDialog kind={kind || "all"} title={title} initialVehicleId={seededVehicleId} initialOrderId={seededOrderId} onClose={() => { setDialog(false); if (shouldOpenNew) onNavigate(route); }} onSaved={async () => { setDialog(false); notify("Документ сохранён как черновик"); try { await load(); } catch { setMessage("Документ сохранён, но список не обновился. Обновите страницу."); } if (shouldOpenNew) onNavigate(route); }} />}
    {selected && <DocumentDetailDialog document={selected} error={message} onClose={() => { openSequenceRef.current += 1; setSelected(null); setMessage(""); if (openDocumentId > 0) onNavigate(route); }} onPost={() => void updateStatus("post")} onUnpost={() => void updateStatus("unpost")} onDelete={() => void remove()} onNavigate={onNavigate} onReload={load} onCreatePayment={user.role !== "employee" && selected.kind === "work_order" && selected.status === "posted" && Number(selected.outstanding_tiyin ?? selected.total_tiyin) > 0 ? () => { const orderId = selected.id; setSelected(null); onNavigate(`payments?new=1&orderId=${orderId}`); } : undefined} />}
    {bulkStatusOpen && (
      <Modal title={`Смена статуса для ${selectedIds.length} документов`} onClose={() => setBulkStatusOpen(false)}>
        <div style={{ padding: "10px 0", display: "flex", flexDirection: "column", gap: 14 }}>
          <label style={{ fontSize: 13, fontWeight: 600 }}>
            Выберите новый статус:
            <select
              value={targetStatusName}
              onChange={(e) => setTargetStatusName(e.target.value)}
              style={{ width: "100%", marginTop: 6, padding: "8px 10px", fontSize: 13, border: "1px solid #ccc", borderRadius: 4 }}
            >
              <option value="Новый">Новый</option>
              <option value="Подтвержден">Подтвержден</option>
              <option value="В работе">В работе</option>
              <option value="Готов">Готов</option>
              <option value="Закрыт">Закрыт</option>
              <option value="Отменен">Отменен</option>
            </select>
          </label>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
            <button className="button outline" onClick={() => setBulkStatusOpen(false)}>Отмена</button>
            <button className="button primary" disabled={bulkBusy} onClick={() => void handleBulkAction("status", targetStatusName)}>
              {bulkBusy ? "Сохранение…" : "Применить к выбранным"}
            </button>
          </div>
        </div>
      </Modal>
    )}
  </>;
}

function DocumentDetailDialog({ document, error, onClose, onPost, onUnpost, onDelete, onCreatePayment, onNavigate, onReload }: { document: DocumentDetail; error: string; onClose: () => void; onPost: () => void; onUnpost: () => void; onDelete: () => void; onCreatePayment?: () => void; onNavigate?: (route: string) => void; onReload?: () => Promise<void> }) {
  const [chain, setChain] = useState<{ documents?: DocumentRow[]; progress?: { shipped_percent: number; paid_percent: number } } | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [printOpen, setPrintOpen] = useState(false);
  const [orgData, setOrgData] = useState<any>(null);

  useEffect(() => {
    void request("/api/organization").then(setOrgData).catch(() => {});
  }, []);

  useEffect(() => {
    let active = true;
    void request<{ documents?: DocumentRow[]; progress?: { shipped_percent: number; paid_percent: number } }>(`/api/documents/${document.id}/chain`)
      .then((data) => { if (active) setChain(data); })
      .catch(() => { if (active) setChain(null); });
    return () => { active = false; };
  }, [document.id]);

  const createChild = async (childKind: string) => {
    setActionBusy(true); setActionError("");
    try {
      const child = await request<DocumentRow>(`/api/documents/${document.id}/create-child`, {
        method: "POST", body: JSON.stringify({ kind: childKind })
      });
      if (onReload) await onReload();
      onClose();
      if (onNavigate) onNavigate(`${childKind === "work_order" ? "work_order" : "documents"}?open=${child.id}`);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Не удалось создать связанный документ");
    } finally {
      setActionBusy(false);
    }
  };

  return <Modal title={document.number} onClose={onClose}><div className="document-detail">
    <div className="detail-grid">
      <div><small>Статус</small><b><span className={`status-pill status-${document.status}`}>{document.status_name || (document.status === "posted" ? "Проведён" : document.status === "draft" ? "Черновик" : document.status)}</span></b></div>
      <div><small>Дата</small><b>{document.date}</b></div>
      <div><small>Контрагент</small><b>{document.counterparty_name ?? "—"}</b></div>
      {document.contract_number && <div><small>Договор</small><b>№ {document.contract_number}</b></div>}
      {document.delivery_address && <div><small>Адрес доставки</small><b>{document.delivery_address}</b></div>}
      {document.vehicle_plate && <div><small>Автомобиль / пробег</small><b>{document.vehicle_plate} · {Number(document.odometer_km ?? 0).toLocaleString("ru-RU")} км</b></div>}
      {document.next_service_km && <div><small>Следующая замена</small><b>{Number(document.next_service_km).toLocaleString("ru-RU")} км</b></div>}
      <div><small>Склад</small><b>{document.warehouse_name ?? "—"}{document.destination_warehouse_name ? ` → ${document.destination_warehouse_name}` : ""}</b></div>
      {document.parent_document_number && <div><small>Заказ-основание</small><b>{document.parent_document_number}</b></div>}
    </div>

    {chain?.progress && (Number(chain.progress.shipped_percent) > 0 || Number(chain.progress.paid_percent) > 0) && (
      <div className="payment-summary" style={{ marginTop: 8 }}>
        <span>Отгружено: <b>{chain.progress.shipped_percent}%</b></span>
        <span>Оплачено: <b>{chain.progress.paid_percent}%</b></span>
      </div>
    )}

    {document.kind === "work_order" && <div className="payment-summary"><span>Оплачено: <b>{money(document.paid_tiyin ?? 0)} ₸</b></span><span>Остаток: <b>{money(document.outstanding_tiyin ?? document.total_tiyin)} ₸</b></span></div>}
    {document.kind === "incoming_payment" && <div className="payment-summary"><span>Способ оплаты</span><b>{document.payment_method === "cash" ? "Наличные" : "Банковский перевод"}</b></div>}
    {document.kind === "incoming_payment" && <div className="payment-summary payment-allocation-list"><b>Оплаченные заказ-наряды</b>{(document.paymentAllocations ?? []).map((allocation) => <span key={allocation.document_id}>{allocation.number}: <b>{money(allocation.amount_tiyin)} ₸</b></span>)}{!document.paymentAllocations?.length && <span>Связанных заказ-нарядов нет</span>}</div>}

    {chain?.documents && chain.documents.length > 1 && (
      <div className="payment-summary" style={{ flexDirection: "column", alignItems: "flex-start", gap: 6, marginTop: 8 }}>
        <b>Связанные документы в цепочке:</b>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {chain.documents.map((doc) => (
            <button key={doc.id} className="link-button" onClick={() => { onClose(); if (onNavigate) onNavigate(`${doc.kind === "work_order" ? "work_order" : "documents"}?open=${doc.id}`); }}>
              {doc.number} ({doc.status === "posted" ? "✓" : "черновик"}) · {money(doc.total_tiyin)} ₸
            </button>
          ))}
        </div>
      </div>
    )}

    <table>
      <thead>
        <tr><th>Наименование</th><th>Количество</th><th>Цена</th><th>Скидка</th><th>НДС</th><th>Сумма</th></tr>
      </thead>
      <tbody>
        {document.lines.map((line) => (
          <tr key={line.id}>
            <td>{line.product_name}</td>
            <td>{qty(line.quantity_units)} {line.unit}</td>
            <td>{money(line.unit_price_tiyin)} ₸</td>
            <td>{line.discount_bps ? `${(line.discount_bps / 100).toFixed(1)}%` : "—"}</td>
            <td>{line.vat_rate || "Без НДС"}</td>
            <td>{money(Math.round(line.quantity_units * line.unit_price_tiyin / 1_000_000))} ₸</td>
          </tr>
        ))}
        {!document.lines.length && <tr><td colSpan={6} className="empty-inline">Без товарных позиций</td></tr>}
      </tbody>
      <tfoot><tr><th colSpan={5}>Итого</th><th>{money(document.total_tiyin)} ₸</th></tr></tfoot>
    </table>
    {document.comment && <p className="detail-comment">{document.comment}</p>}
    {(error || actionError) && <div className="form-error" role="alert">{error || actionError}</div>}

    <div className="modal-actions" style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "space-between" }}>
      <div style={{ display: "flex", gap: 6 }}>
        {document.status === "posted" && ["customer_order", "work_order"].includes(document.kind) && (
          <>
            <button className="button outline" disabled={actionBusy} onClick={() => void createChild("shipment")}>+ Отгрузка</button>
            <button className="button outline" disabled={actionBusy} onClick={() => void createChild("customerinvoice")}>+ Счет</button>
          </>
        )}
        {document.status === "posted" && document.kind === "stocktake" && (
          <>
            <button className="button outline" disabled={actionBusy} onClick={() => void createChild("enter")}>+ Оприходование</button>
            <button className="button outline" disabled={actionBusy} onClick={() => void createChild("writeoff")}>+ Списание</button>
          </>
        )}
        {onCreatePayment && <button className="button primary" onClick={onCreatePayment}>Принять оплату</button>}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <button className="button outline" onClick={() => setPrintOpen(true)}><FileText size={14} style={{ marginRight: 4 }} />Печать</button>
        {document.status === "draft" && <button className="button outline" onClick={onDelete}>В корзину</button>}
        {document.status === "draft" && <button className="button primary" onClick={onPost}>Провести</button>}
        {document.status === "posted" && <button className="button outline" onClick={onUnpost}>Снять проведение</button>}
        <button className="button outline" onClick={onClose}>Закрыть</button>
      </div>
    </div>
    {printOpen && orgData && (
      <PrintModal
        doc={{
          number: document.number,
          kind: document.kind,
          date: document.date,
          counterparty_name: document.counterparty_name,
          vehicle_plate: document.vehicle_plate,
          odometer_km: document.odometer_km,
          next_service_km: document.next_service_km,
          total_tiyin: document.total_tiyin,
          comment: document.comment,
          lines: document.lines,
        }}
        org={orgData}
        onClose={() => setPrintOpen(false)}
      />
    )}
  </div></Modal>;
}

function DocumentDialog({ kind, title, initialVehicleId = "", initialOrderId = "", onClose, onSaved }: { kind: string; title: string; initialVehicleId?: string; initialOrderId?: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const { user } = useAuth();
  const [products, setProducts] = useState<Product[]>([]); const [counterparties, setCounterparties] = useState<Counterparty[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]); const [orders, setOrders] = useState<DocumentRow[]>([]); const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [priceLists, setPriceLists] = useState<PriceListSummary[]>([]); const [selectedPriceListId, setSelectedPriceListId] = useState("");
  const [documentPriceList, setDocumentPriceList] = useState<PriceListForDocument | null>(null); const [priceListColumnIndex, setPriceListColumnIndex] = useState(0); const [priceListLoading, setPriceListLoading] = useState(false);
  const [selectedCounterpartyId, setSelectedCounterpartyId] = useState(""); const [selectedVehicleId, setSelectedVehicleId] = useState(""); const [selectedOrderId, setSelectedOrderId] = useState("");
  const selectionTouchedRef = useRef(false);
  const [selectedKind, setSelectedKind] = useState(kind === "all" ? "work_order" : kind);
  const [lineCount, setLineCount] = useState(1); const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  const cashKind = ["cash_in", "cash_out", "payment", "incoming_payment", "cash_correction"].includes(selectedKind);
  const isIncomingPayment = selectedKind === "incoming_payment";
  const isShipment = selectedKind === "shipment";
  const isTransfer = selectedKind === "transfer";
  const isStocktake = selectedKind === "stocktake";
  const isWriteoff = selectedKind === "writeoff";
  const isEnter = selectedKind === "enter";
  const isWarehouseDoc = ["transfer", "stocktake", "writeoff", "enter"].includes(selectedKind);
  const isWorkOrder = selectedKind === "work_order";
  const dialogTitle = isIncomingPayment ? "Новый входящий платёж" : kind === "all" ? (documentTypeOptions.find((option) => option.kind === selectedKind)?.title ?? "Новый документ") : title;
  useEffect(() => {
    let active = true;
    setSelectedOrderId("");
    setOrders([]);
    const orderKind = selectedKind === "incoming_payment" ? "work_order" : "customer_order";
    const ordersRequest = user.role === "employee" ? Promise.resolve([] as DocumentRow[]) : request<DocumentRow[]>(`/api/documents?kind=${orderKind}&status=posted`);
    void Promise.all([request<Product[]>("/api/products"), request<Counterparty[]>("/api/counterparties"), request<Warehouse[]>("/api/warehouses"), ordersRequest, request<Vehicle[]>("/api/vehicles")])
      .then(([p, c, w, o, v]) => {
        if (!active) return;
        setProducts(p); setCounterparties(c); setWarehouses(w); setOrders(o); setVehicles(v);
        const initialVehicle = v.find((vehicle) => vehicle.id === Number(initialVehicleId));
        if (initialVehicle && !selectionTouchedRef.current) { setSelectedCounterpartyId(String(initialVehicle.counterparty_id)); setSelectedVehicleId(String(initialVehicle.id)); }
        const initialOrder = o.find((order) => order.id === Number(initialOrderId));
        if (initialOrder && !selectionTouchedRef.current) { setSelectedCounterpartyId(String(initialOrder.counterparty_id ?? "")); setSelectedOrderId(String(initialOrder.id)); }
      })
      .catch((exception) => { if (active) setError(exception instanceof Error ? exception.message : "Не удалось загрузить справочники"); });
    void request<PriceListSummary[]>("/api/price-lists").then((rows) => { if (active) setPriceLists(rows); }).catch(() => { if (active) setPriceLists([]); });
    return () => { active = false; };
  }, [user.role, initialVehicleId, initialOrderId, selectedKind]);
  useEffect(() => {
    if (!selectedCounterpartyId) { setContracts([]); return; }
    let active = true;
    void request<Contract[]>(`/api/counterparties/${selectedCounterpartyId}/contracts`)
      .then((items) => { if (active) setContracts(items.filter((c) => c.active)); })
      .catch(() => { if (active) setContracts([]); });
    return () => { active = false; };
  }, [selectedCounterpartyId]);
  useEffect(() => {
    if (!selectedPriceListId) { setDocumentPriceList(null); setPriceListColumnIndex(0); setPriceListLoading(false); return; }
    let current = true;
    setDocumentPriceList(null); setPriceListColumnIndex(0); setPriceListLoading(true);
    void request<PriceListForDocument>(`/api/price-lists/${selectedPriceListId}`)
      .then((priceList) => { if (current) setDocumentPriceList(priceList); })
      .catch((exception) => { if (current) setError(exception instanceof Error ? exception.message : "Не удалось загрузить прайс-лист"); })
      .finally(() => { if (current) setPriceListLoading(false); });
    return () => { current = false; };
  }, [selectedPriceListId]);
  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(""); setSaving(true); const form = new FormData(event.currentTarget);
    const lines = Array.from({ length: lineCount }, (_, index) => {
      const productId = Number(form.get(`product_${index}`));
      if (!productId) return null;
      const product = products.find((item) => item.id === productId);
      const priceField = String(form.get(`price_${index}`) ?? "").trim();
      const fallback = isStocktake || selectedKind === "receipt" || selectedKind === "supplier_return" || isTransfer ? Number(product?.purchase_price_tiyin ?? 0) / 100 : Number(product?.sale_price_tiyin ?? 0) / 100;
      const listedPrice = documentPriceList?.items.find((item) => item.product_id === productId)?.prices[priceListColumnIndex];
      const discountPercent = Number(form.get(`discount_percent_${index}`) || 0);
      const discountBps = Math.round(discountPercent * 100);
      const vatRate = String(form.get(`vat_rate_${index}`) ?? "");
      return {
        productId,
        quantity: form.get(`quantity_${index}`),
        price: priceField || (listedPrice == null ? String(fallback) : tiyinInput(listedPrice)),
        discountBps,
        vatRate,
      };
    }).filter((line): line is { productId: number; quantity: FormDataEntryValue | null; price: string; discountBps: number; vatRate: string } => line !== null);
    const body = {
      date: form.get("date"),
      counterpartyId: form.get("counterpartyId") || undefined,
      contractId: form.get("contractId") ? Number(form.get("contractId")) : undefined,
      statusName: form.get("statusName"),
      deliveryAddress: form.get("deliveryAddress") || "",
      isVatIncluded: form.get("isVatIncluded") === "on" ? 1 : 0,
      warehouseId: form.get("warehouseId") || warehouses[0]?.id,
      vehicleId: form.get("vehicleId"), odometerKm: form.get("odometerKm"), nextServiceKm: form.get("nextServiceKm"),
      destinationWarehouseId: form.get("destinationWarehouseId"), parentDocumentId: form.get("parentDocumentId"),
      amount: form.get("amount"), comment: form.get("comment"), lines,
      paymentMethod: form.get("paymentMethod"),
      allocations: isIncomingPayment && selectedOrderId ? [{ documentId: Number(selectedOrderId), amountTiyin: Math.round(Number(form.get("amount")) * 100) }] : [],
    };
    try { await request("/api/documents", { method: "POST", body: JSON.stringify({ ...body, kind: selectedKind }) }); await onSaved(); }
    catch (exception) { setError(exception instanceof Error ? exception.message : "Не удалось сохранить документ"); }
    finally { setSaving(false); }
  };
  const eligibleOrders = orders.filter((order) => Number(order.counterparty_id) === Number(selectedCounterpartyId)
    && Number(order.outstanding_tiyin ?? order.total_tiyin) > 0);
  const selectedOrder = eligibleOrders.find((order) => order.id === Number(selectedOrderId));
  return <Modal title={dialogTitle} onClose={onClose}><form onSubmit={save} className="form-grid">
    {kind === "all" && <label className="span-2">Тип документа<select value={selectedKind} onChange={(event) => setSelectedKind(event.target.value)}>{documentTypeOptions.map((option) => <option key={option.kind} value={option.kind}>{option.title}</option>)}</select></label>}
    <label>Дата<input name="date" type="date" defaultValue={localDateValue()} required /></label>
    <label>Статус документа<select name="statusName" defaultValue="Новый"><option value="Новый">Новый</option><option value="Подтвержден">Подтвержден</option><option value="Собран">Собран</option><option value="Отгружен">Отгружен</option><option value="Доставлен">Доставлен</option><option value="Отменен">Отменен</option></select></label>
    {!isWarehouseDoc && <label>{isWorkOrder || isIncomingPayment ? "Клиент" : "Контрагент"}<select name="counterpartyId" required={isWorkOrder || isIncomingPayment} value={selectedCounterpartyId} onChange={(event) => { selectionTouchedRef.current = true; setSelectedCounterpartyId(event.target.value); setSelectedVehicleId(""); setSelectedOrderId(""); }}><option value="">{isWorkOrder || isIncomingPayment ? "Выберите клиента" : "Не выбран"}</option>{counterparties.filter((counterparty) => !(isWorkOrder || isIncomingPayment) || ["customer", "both"].includes(counterparty.kind)).map((counterparty) => <option value={counterparty.id} key={counterparty.id}>{counterparty.name}</option>)}</select></label>}
    {!isWarehouseDoc && contracts.length > 0 && <label>Договор<select name="contractId" defaultValue=""><option value="">Без договора</option>{contracts.map((c) => <option key={c.id} value={c.id}>№ {c.number} от {c.date}</option>)}</select></label>}
    {isWorkOrder && <>
      <label>Автомобиль<select name="vehicleId" required value={selectedVehicleId} onChange={(event) => { selectionTouchedRef.current = true; setSelectedVehicleId(event.target.value); }}><option value="">Выберите автомобиль</option>{vehicles.filter((vehicle) => vehicle.counterparty_id === Number(selectedCounterpartyId)).map((vehicle) => <option value={vehicle.id} key={vehicle.id}>{vehicle.plate} · {vehicle.make} {vehicle.model}</option>)}</select></label>
      <label>Пробег при обслуживании, км<input key={`odo-${selectedVehicleId}`} name="odometerKm" type="number" min="0" step="1" defaultValue={vehicles.find((vehicle) => vehicle.id === Number(selectedVehicleId))?.current_mileage ?? ""} required /></label>
      <label>Следующая замена, км<input name="nextServiceKm" type="number" min="1" step="1" placeholder="Например, 25 000" /></label>
    </>}
    {!cashKind && <>
      <label>{isTransfer ? "Со склада" : "Склад"}<select name="warehouseId" required defaultValue={warehouses[0]?.id}>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label>
      {isTransfer && <label>На склад (получатель)<select name="destinationWarehouseId" required defaultValue=""><option value="" disabled>Выберите склад-получатель</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label>}
      {isShipment && <label className="span-2">Заказ покупателя<select name="parentDocumentId" defaultValue=""><option value="">Без связи с заказом</option>{orders.map((order) => <option key={order.id} value={order.id}>{order.number} · {order.counterparty_name ?? "без контрагента"} · {money(order.total_tiyin)} ₸</option>)}</select></label>}
      {!isWarehouseDoc && <label className="span-2">Адрес доставки<input name="deliveryAddress" placeholder="Город, улица, дом, помещение..." /></label>}
      {!isWarehouseDoc && <label className="span-2" style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 12 }}><input type="checkbox" name="isVatIncluded" defaultChecked /> Цена включает НДС</label>}
      {priceLists.length > 0 && <>
        <label className="span-2">Расценить по прайс-листу<select aria-label="Выберите прайс-лист для документа" value={selectedPriceListId} onChange={(event) => { setSelectedPriceListId(event.target.value); setDocumentPriceList(null); }}><option value="">Не выбран</option>{priceLists.map((priceList) => <option key={priceList.id} value={priceList.id}>{priceList.name} · {priceList.price_type}</option>)}</select></label>
        {documentPriceList && <label>Колонка цен<select aria-label="Колонка прайс-листа" value={priceListColumnIndex} onChange={(event) => setPriceListColumnIndex(Number(event.target.value))}>{documentPriceList.columns.map((column, index) => <option key={column.id} value={index}>{column.name}</option>)}</select></label>}
        {selectedPriceListId && documentPriceList && <p className="span-2 muted">Совпавшие позиции получат цену выбранной колонки. Цена, введённая вручную в строке, имеет приоритет; если цена для позиции не задана, сохранится обычная цена товара.</p>}
      </>}
      <div className="line-editor span-2"><div className="section-heading"><b>{isStocktake ? "Фактические остатки" : isWriteoff ? "Списываемые позиции" : isEnter ? "Оприходуемые позиции" : "Товары и услуги"}<small>{isStocktake ? "Укажите пересчитанное количество" : isWriteoff ? "Укажите списываемое количество" : isEnter ? "Укажите поступившее количество" : "Позиции документа"}</small></b><button type="button" className="button outline" onClick={() => setLineCount((count) => count + 1)}><Plus size={14} />Строка</button></div>
        {Array.from({ length: lineCount }, (_, index) => <div className="line-fields" key={index} style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}><select name={`product_${index}`} required defaultValue="" style={{ flex: "1 1 180px" }}><option value="" disabled>Выберите товар или услугу</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select><input name={`quantity_${index}`} type="number" min="0.000001" step="0.000001" placeholder={isStocktake ? "Факт" : isWriteoff ? "Списать" : isEnter ? "Приход" : "Кол-во"} style={{ width: 80 }} required /><input name={`price_${index}`} type="number" min="0" step="0.01" placeholder={isStocktake || isWriteoff || isEnter ? "Себестоимость, ₸" : "Цена, ₸"} style={{ width: 100 }} /><input name={`discount_percent_${index}`} type="number" min="0" max="100" step="0.1" placeholder="Скидка, %" style={{ width: 85 }} /><select name={`vat_rate_${index}`} style={{ width: 95 }} defaultValue=""><option value="">Без НДС</option><option value="0%">0%</option><option value="12%">12%</option><option value="20%">20%</option></select></div>)}
        {!products.length && <small>Сначала добавьте товары в разделе «Товары».</small>}</div>
    </>}
    {cashKind && <><label>Сумма, ₸<input name="amount" type="number" min="0.01" max={isIncomingPayment && selectedOrder ? Number(selectedOrder.outstanding_tiyin ?? selectedOrder.total_tiyin) / 100 : undefined} step="0.01" required /></label>{isIncomingPayment ? <><label>Способ оплаты<select name="paymentMethod" defaultValue="bank"><option value="bank">Банковский перевод</option><option value="cash">Наличные</option></select></label><label className="span-2">Заказ-наряд<select name="paymentOrderId" required value={selectedOrderId} onChange={(event) => { selectionTouchedRef.current = true; setSelectedOrderId(event.target.value); }}><option value="">Выберите заказ-наряд для оплаты</option>{eligibleOrders.map((order) => <option key={order.id} value={order.id}>{order.number} · {order.vehicle_plate ?? "без авто"} · к оплате {money(order.outstanding_tiyin ?? order.total_tiyin)} ₸</option>)}</select>{!selectedCounterpartyId ? <small>Сначала выберите клиента.</small> : !eligibleOrders.length ? <small>У клиента нет проведённых заказ-нарядов с остатком к оплате.</small> : selectedOrder && <small>Остаток по заказ-наряду: {money(selectedOrder.outstanding_tiyin ?? selectedOrder.total_tiyin)} ₸.</small>}</label></> : <label>Счёт<select name="cashAccount"><option value="main">Основной счёт</option></select></label>}</>}
    <label className="span-2">Комментарий<textarea name="comment" rows={2} /></label>
    {error && <div className="form-error span-2">{error}</div>}
    <div className="modal-actions span-2"><button type="button" className="button outline" onClick={onClose}>Отмена</button><button className="button primary" disabled={saving || priceListLoading || Boolean(selectedPriceListId && !documentPriceList) || (!cashKind && !products.length)}>{saving ? "Сохранение…" : priceListLoading ? "Загружаем цены…" : "Сохранить"}</button></div>
  </form></Modal>;
}

function Modal({ title, onClose, children, className = "" }: { title: string; onClose: () => void; children: React.ReactNode; className?: string }) {
  useEffect(() => { const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); }; window.addEventListener("keydown", closeOnEscape); return () => window.removeEventListener("keydown", closeOnEscape); }, [onClose]);
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className={`modal ${className}`} role="dialog" aria-modal="true" aria-labelledby="modal-title"><header><h2 id="modal-title">{title}</h2><button aria-label="Закрыть" onClick={onClose}><X size={19} /></button></header>{children}</section></div>;
}

function PlaceholderPage({ route, title, onNavigate }: { route: string; title: string; onNavigate: (route: string) => void }) {
  const icon = route.includes("car") || route.includes("vehicle") ? CarFront : route.includes("stock") ? Boxes : route.includes("cash") ? Coins : route.includes("files") ? Archive : route.includes("settings") ? Settings : route.includes("task") ? FileClock : route.includes("ecommerce") ? ShoppingBag : route.includes("production") ? Wrench : route.includes("order") ? Truck : Activity;
  const Icon = icon;
  const nextLinks = useMemo(() => {
    if (route === "start") return [{ title: "Добавить товары", route: "products" }, { title: "Добавить контрагента", route: "counterparties" }, { title: "Посмотреть показатели", route: "dashboard" }];
    return [];
  }, [route]);
  return <div className="placeholder-page"><PageHeader title={title} actions={<button className="button outline" onClick={() => onNavigate("dashboard")}><Home size={15} />На главную</button>} /><div className="placeholder-card"><Icon size={44} strokeWidth={1.35} /><h2>{title}</h2><p>Раздел добавлен в общую навигацию. Его поля и сценарии ещё сверяются с эталонным сервисом.</p>{nextLinks.map((link) => <button className="button primary" key={link.route} onClick={() => onNavigate(link.route)}>{link.title}</button>)}</div></div>;
}

function PrinterIcon() { return <FileText size={15} />; }

export default App;
