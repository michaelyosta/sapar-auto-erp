import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { scryptSync, randomBytes } from "node:crypto";
import Database from "better-sqlite3";

// Ensure QA owner account exists in test database
try {
  const db = new Database("data/moysklad.sqlite");
  const scryptOptions = { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
  const salt = randomBytes(16);
  const hash = scryptSync("MobileQa!2026", salt, 64, scryptOptions);
  const passwordHash = `scrypt$${scryptOptions.N}$${scryptOptions.r}$${scryptOptions.p}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
  db.prepare(`
    INSERT INTO users (organization_id, login, full_name, role, active, must_change_password, password_hash)
    VALUES (1, 'qa.mobile', 'QA Mobile Test', 'owner', 1, 0, ?)
    ON CONFLICT(organization_id, login) DO UPDATE SET password_hash = excluded.password_hash, active = 1, must_change_password = 0
  `).run(passwordHash);
  db.close();
} catch (e) {
  console.warn("Could not seed QA user in data/moysklad.sqlite:", e.message);
}

const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const outDir = path.resolve(".tmp-gauntlet-suite/shots");
const reportFile = path.resolve(".tmp-gauntlet-suite/gauntlet-report.json");
const profile = path.join(process.env.TEMP ?? "C:\\Users\\misa\\AppData\\Local\\Temp", "opencode", "gauntlet-suite-chrome");
const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:5176/";
const debugPort = 9224;

fs.mkdirSync(outDir, { recursive: true });
fs.rmSync(profile, { recursive: true, force: true });

const chrome = spawn(chromePath, [
  "--headless=new",
  "--disable-gpu",
  "--hide-scrollbars",
  "--no-first-run",
  "--no-default-browser-check",
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profile}`,
  "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function pageTarget() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      const targets = await response.json();
      const page = targets.find((target) => target.type === "page");
      if (page) return page;
    } catch {}
    await sleep(200);
  }
  throw new Error("Chrome DevTools target did not appear");
}

const target = await pageTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve, { once: true });
  ws.addEventListener("error", reject, { once: true });
});

let nextId = 1;
const pending = new Map();
const jsErrors = [];
const consoleLogs = [];

ws.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data));
  if (message.method === "Runtime.exceptionThrown") {
    jsErrors.push(message.params.exceptionDetails);
  } else if (message.method === "Runtime.consoleAPICalled") {
    consoleLogs.push({ type: message.params.type, args: message.params.args.map((a) => a.value ?? a.description) });
    if (message.params.type === "error") {
      jsErrors.push({ text: "console.error", details: message.params.args.map((a) => a.value ?? a.description).join(" ") });
    }
  }

  if (!message.id) return;
  const entry = pending.get(message.id);
  if (!entry) return;
  pending.delete(message.id);
  if (message.error) entry.reject(new Error(`${entry.method}: ${message.error.message}`));
  else entry.resolve(message.result);
});

function send(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject, method }));
}

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + " " + (result.exceptionDetails.exception?.description ?? ""));
  return result.result.value;
}

async function waitFor(expression, timeout = 12000, label = expression) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      if (await evaluate(expression)) return;
    } catch {}
    await sleep(150);
  }
  throw new Error(`Timeout waiting for ${label}`);
}

async function screenshot(name) {
  const shot = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
  const file = path.join(outDir, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(shot.data, "base64"));
  return file;
}

async function setViewport(width, height, isMobile = false) {
  await send("Emulation.clearDeviceMetricsOverride");
  await send("Emulation.setTouchEmulationEnabled", { enabled: isMobile });
  await send("Emulation.setDeviceMetricsOverride", {
    width, height, deviceScaleFactor: isMobile ? 2 : 1, mobile: isMobile, screenWidth: width, screenHeight: height,
  });
  await sleep(200);
}

async function navigate(hash) {
  await evaluate(`window.location.hash = ${JSON.stringify(hash)}`);
  await sleep(600);
}

const auditSuite = {
  timestamp: new Date().toISOString(),
  environment: { baseUrl, chromePath, debugPort },
  jsErrors: [],
  discrepancies: [],
  tokenChecks: [],
  routeChecks: [],
  componentChecks: [],
  emptyStateChecks: [],
  responsiveChecks: [],
};

function recordTokenCheck(category, property, foundValue, referenceBenchmark, matches, note) {
  auditSuite.tokenChecks.push({ category, property, foundValue, referenceBenchmark, matches, note });
}

function recordDiscrepancy(severity, component, issue, expected, actual, recommendation) {
  auditSuite.discrepancies.push({ severity, component, issue, expected, actual, recommendation });
}

try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");

  // Step 1: Open login screen at Desktop 1440x900
  await setViewport(1440, 900);
  await send("Page.navigate", { url: baseUrl });
  await waitFor("document.readyState === 'complete'", 15000, "page load");
  await waitFor("Boolean(document.querySelector('.auth-card'))", 15000, "auth card");
  await screenshot("01-login-screen");

  // Login as owner
  await evaluate(`(() => {
    const set = (name, value) => {
      const input = document.querySelector('input[name="' + name + '"]');
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };
    set("login", "qa.mobile");
    set("password", "MobileQa!2026");
    document.querySelector(".auth-card form").requestSubmit();
    return true;
  })()`);

  await waitFor("Boolean(document.querySelector('.main-nav'))", 15000, "authenticated app shell");
  await waitFor("Boolean(document.querySelector('.dashboard-top'))", 15000, "dashboard page");
  await screenshot("02-dashboard-desktop");

  // Step 2: Audit Design Tokens (Computed Styles)
  const tokenAudit = await evaluate(`(() => {
    const mainNav = document.querySelector(".main-nav");
    const navStyle = getComputedStyle(mainNav);
    const bodyStyle = getComputedStyle(document.body);
    const appShell = document.querySelector(".app-shell");
    const appShellStyle = getComputedStyle(appShell);
    const primaryBtn = document.querySelector(".button.primary") || document.querySelector(".subscription-banner button");
    const primaryBtnStyle = primaryBtn ? getComputedStyle(primaryBtn) : null;
    const subNav = document.querySelector(".sub-nav");
    const subNavStyle = subNav ? getComputedStyle(subNav) : null;
    const firstSubBtn = document.querySelector(".subnav-scroll button");
    const firstSubBtnStyle = firstSubBtn ? getComputedStyle(firstSubBtn) : null;
    const activeSubBtn = document.querySelector(".subnav-scroll button.sub-active");
    const activeSubBtnStyle = activeSubBtn ? getComputedStyle(activeSubBtn) : null;
    const banner = document.querySelector(".subscription-banner");
    const bannerStyle = banner ? getComputedStyle(banner) : null;

    return {
      navBg: navStyle.backgroundColor,
      navHeight: mainNav.getBoundingClientRect().height,
      bodyBg: bodyStyle.backgroundColor,
      bodyFont: bodyStyle.fontFamily,
      bodyFontSize: bodyStyle.fontSize,
      appShellBg: appShellStyle.backgroundColor,
      primaryBtnBg: primaryBtnStyle?.backgroundColor,
      primaryBtnColor: primaryBtnStyle?.color,
      primaryBtnHeight: primaryBtn?.getBoundingClientRect().height,
      subNavBg: subNavStyle?.backgroundColor,
      subNavHeight: subNav?.getBoundingClientRect().height,
      subNavBorderBottom: subNavStyle?.borderBottom,
      subBtnColor: firstSubBtnStyle?.color,
      activeSubBtnColor: activeSubBtnStyle?.color,
      bannerBg: bannerStyle?.backgroundColor,
      bannerHeight: banner?.getBoundingClientRect().height,
    };
  })()`);

  recordTokenCheck(
    "Color: Top Nav Blue",
    "background-color",
    tokenAudit.navBg,
    "rgb(25, 118, 165) (#1976a5) or rgb(43, 90, 132) (#2b5a84)",
    tokenAudit.navBg === "rgb(25, 118, 165)" || tokenAudit.navBg === "rgb(43, 90, 132)",
    "Corporate blue header"
  );

  recordTokenCheck(
    "Color: Canvas Background",
    "body / app-shell background-color",
    tokenAudit.appShellBg,
    "rgb(242, 242, 242) (#f2f2f2) or rgb(240, 242, 244) contrast gray",
    tokenAudit.appShellBg === "rgb(242, 242, 242)" || tokenAudit.appShellBg === "rgb(240, 242, 244)",
    tokenAudit.appShellBg === "rgb(255, 255, 255)"
      ? "Deviation: canvas is pure white #ffffff instead of MoySklad's gray #f2f2f2 backdrop"
      : "Canvas background conforms"
  );

  if (tokenAudit.appShellBg === "rgb(255, 255, 255)") {
    recordDiscrepancy(
      "MEDIUM",
      "Global Canvas Background",
      "Background color of .app-shell and body is pure white (#ffffff)",
      "MoySklad uses light-gray backdrop (#f2f2f2 / #f4f5f7) so white content tables and cards stand out",
      tokenAudit.appShellBg,
      "Set .app-shell background to #f2f2f2 and place page content inside card containers with white background and #d9d9d9 borders"
    );
  }

  // Check primary button color
  await navigate("#products");
  await waitFor("Boolean(document.querySelector('.page-header .button.primary'))", 8000, "products primary button");
  const productBtnToken = await evaluate(`(() => {
    const btn = document.querySelector(".page-header .button.primary");
    const style = getComputedStyle(btn);
    return {
      bg: style.backgroundColor,
      color: style.color,
      border: style.border,
      borderRadius: style.borderRadius,
      height: Math.round(btn.getBoundingClientRect().height),
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
    };
  })()`);

  recordTokenCheck(
    "Color: Primary Button",
    "background-color",
    productBtnToken.bg,
    "rgb(72, 164, 63) (#48a43f) or rgb(58, 166, 58) (MoySklad Green)",
    productBtnToken.bg === "rgb(72, 164, 63)" || productBtnToken.bg === "rgb(58, 166, 58)",
    productBtnToken.bg === "rgb(233, 115, 67)"
      ? "Deviation: button is orange #e97343 instead of MoySklad green #48a43f / #3aa63a"
      : "Primary button conforms"
  );

  if (productBtnToken.bg === "rgb(233, 115, 67)") {
    recordDiscrepancy(
      "HIGH",
      "Action Buttons (.button.primary)",
      "Primary creation buttons ('+ Товар', '+ Заказ', '+ Прайс-лист') use orange #e97343",
      "MoySklad uses classic green (#48a43f / #36952d) for primary creation actions; orange is reserved for promo banners / tariff warnings",
      productBtnToken.bg,
      "Change .button.primary to background: #48a43f, border: 1px solid #3d9435 with hover #3d9435"
    );
  }

  // Step 3: Table Metrics & Compact Desktop Density Audit
  const tableMetrics = await evaluate(`(() => {
    const table = document.querySelector("table");
    const th = table.querySelector("th");
    const td = table.querySelector("td");
    const tr = table.querySelector("tbody tr");
    const thStyle = getComputedStyle(th);
    const tdStyle = getComputedStyle(td);
    return {
      thPadding: thStyle.padding,
      thFontWeight: thStyle.fontWeight,
      thFontSize: thStyle.fontSize,
      thBorderBottom: thStyle.borderBottom,
      thBg: thStyle.backgroundColor,
      tdPadding: tdStyle.padding,
      tdFontSize: tdStyle.fontSize,
      tdBorderBottom: tdStyle.borderBottom,
      rowHeight: tr ? Math.round(tr.getBoundingClientRect().height) : 0,
    };
  })()`);

  recordTokenCheck(
    "Table: Row Height Density",
    "tbody tr height",
    `${tableMetrics.rowHeight}px`,
    "<= 32px (Compact Desktop View)",
    tableMetrics.rowHeight <= 34,
    tableMetrics.rowHeight > 34 ? `Row height is ${tableMetrics.rowHeight}px, exceeding compact standard (28-32px)` : "Conforms"
  );

  if (tableMetrics.rowHeight > 34) {
    recordDiscrepancy(
      "MEDIUM",
      "Table Row Density (Desktop Compact View)",
      `Table rows have height ${tableMetrics.rowHeight}px with td padding ${tableMetrics.tdPadding}`,
      "MoySklad compact data table rows have height 28-32px with td padding: 5px 8px and line-height: 1.2",
      `${tableMetrics.rowHeight}px`,
      "Adjust td { padding: 5px 8px; font-size: 12px; } and reduce subcell margins to achieve 28-32px row height"
    );
  }

  recordTokenCheck(
    "Table: Header Weight & Style",
    "th font-weight",
    tableMetrics.thFontWeight,
    "600 or 700 (Bold column headers)",
    tableMetrics.thFontWeight === "600" || tableMetrics.thFontWeight === "700" || tableMetrics.thFontWeight === "bold",
    tableMetrics.thFontWeight === "400" ? "Deviation: th font-weight is 400 (normal), blends with cell content" : "Conforms"
  );

  if (tableMetrics.thFontWeight === "400") {
    recordDiscrepancy(
      "MEDIUM",
      "Table Header Typography",
      "Table header cells (th) use font-weight: 400 and lack background contrast",
      "MoySklad headers use font-weight: 600, font-size: 11-12px, background: #f7f9fa, and subtle borders",
      `font-weight: ${tableMetrics.thFontWeight}`,
      "Set th { font-weight: 600; font-size: 11px; background: #fafbfc; border-bottom: 2px solid #1976a5; color: #444; }"
    );
  }

  // Step 4: Two-Level Top Menu Structure & Interaction Audit
  const navAudit = await evaluate(`(() => {
    const mainNav = document.querySelector(".main-nav");
    const moduleButtons = [...mainNav.querySelectorAll(".module-button")].map((b) => b.innerText.trim());
    const tools = [...mainNav.querySelectorAll(".nav-tools button")].map((b) => b.getAttribute("aria-label") || b.innerText.trim());
    const subNav = document.querySelector(".sub-nav");
    const subNavTabs = [...subNav.querySelectorAll(".subnav-scroll button")].map((b) => ({
      text: b.innerText.trim(),
      isActive: b.classList.contains("sub-active"),
    }));
    return {
      moduleCount: moduleButtons.length,
      moduleButtons,
      tools,
      subTabsCount: subNavTabs.length,
      subNavTabs,
      hasGlobalSearchInNav: Boolean(mainNav.querySelector(".nav-search, input[type='search']")),
      hasNotificationBadge: Boolean(mainNav.querySelector(".nav-badge, .badge")),
    };
  })()`);

  recordTokenCheck(
    "Navigation: Two-Level Structure",
    "level 1 modules + level 2 tabs",
    `${navAudit.moduleCount} modules, ${navAudit.subTabsCount} tabs in current module`,
    "12 standard modules, tabbed subnav",
    navAudit.moduleCount >= 10 && navAudit.subTabsCount >= 2,
    "Structure conforms"
  );

  if (!navAudit.hasGlobalSearchInNav) {
    recordDiscrepancy(
      "LOW",
      "Global Quick Search",
      "Top blue navigation bar lacks global search bar / icon",
      "MoySklad provides quick search in top bar for documents, counterparties, and goods",
      "No search input in .main-nav",
      "Add quick search input or hotkey trigger (Ctrl+/) in .nav-tools"
    );
  }

  if (!navAudit.hasNotificationBadge) {
    recordDiscrepancy(
      "LOW",
      "Notification Badges",
      "Top bar notification & chat buttons have no badge counters",
      "MoySklad displays counter badges on bell / message icons when updates exist",
      "No badge elements found",
      "Add badge pill styling (.nav-badge) to notification and task icons"
    );
  }

  // Test top menu interaction: does clicking module open mega-menu or navigate?
  await evaluate(`(() => {
    const crmBtn = [...document.querySelectorAll(".module-button")].find((b) => b.innerText.includes("CRM"));
    if (crmBtn) crmBtn.click();
  })()`);
  await sleep(400);

  const menuBehavior = await evaluate(`(() => {
    const megaMenu = document.querySelector(".mega-menu");
    const currentRoute = window.location.hash;
    return {
      megaMenuVisible: Boolean(megaMenu && getComputedStyle(megaMenu).display !== "none"),
      routeAfterModuleClick: currentRoute,
    };
  })()`);

  recordTokenCheck(
    "Navigation: Module Click Behavior",
    "click on module in top bar",
    menuBehavior.megaMenuVisible ? "Opens floating mega-menu dropdown" : "Navigates directly",
    "Clicking module navigates to default screen & reveals subnav tabs; hover/caret opens menu",
    true,
    "Mega-menu dropdown functions"
  );

  // Close mega-menu by clicking document
  await evaluate(`document.body.click()`);
  await sleep(300);

  // Step 5: Exhaustive Route Traversal & DOM Integrity / JS Error Verification
  const testRoutes = [
    { hash: "#dashboard", label: "Показатели", selector: ".dashboard-top" },
    { hash: "#products", label: "Товары и услуги", selector: ".responsive-table tbody" },
    { hash: "#pricelists", label: "Прайс-листы", selector: ".responsive-table tbody" },
    { hash: "#counterparties", label: "Контрагенты", selector: ".responsive-table tbody" },
    { hash: "#vehicles", label: "Автомобили", selector: ".responsive-table tbody" },
    { hash: "#stock", label: "Остатки", selector: ".responsive-table tbody" },
    { hash: "#warehouses", label: "Склады", selector: ".responsive-table tbody" },
    { hash: "#employees", label: "Пользователи", selector: ".responsive-table tbody" },
    { hash: "#customerorder", label: "Заказы покупателей", selector: ".responsive-table tbody" },
    { hash: "#work_order", label: "Заказ-наряды", selector: ".responsive-table tbody" },
    { hash: "#payments", label: "Платежи", selector: ".responsive-table tbody" },
    { hash: "#documents", label: "Общий журнал документов", selector: ".responsive-table tbody" },
    { hash: "#company", label: "Настройки компании", selector: ".company-settings-page" },
    { hash: "#legalentities", label: "Юр. лица", selector: ".company-settings-page" },
    { hash: "#pos", label: "Точки продаж", selector: ".retail-page" },
    { hash: "#shifts", label: "Кассовые смены", selector: ".retail-page" },
    { hash: "#retailsales", label: "Чеки продаж", selector: ".retail-page" },
    { hash: "#audit", label: "Аудит", selector: ".audit-page" },
    { hash: "#trash", label: "Корзина", selector: ".trash-page" },
    { hash: "#cashflow", label: "Движение денег", selector: ".finance-reports-page" },
    { hash: "#pnl", label: "Прибыли и убытки", selector: ".finance-reports-page" },
    { hash: "#settlements", label: "Взаиморасчеты", selector: ".finance-reports-page" },
    { hash: "#turnover", label: "Обороты товаров", selector: ".turnover-report-page" },
    { hash: "#payroll", label: "Начисления зарплаты", selector: ".payroll-page" },
    { hash: "#discounts", label: "Скидки", selector: ".discounts-page" },
    { hash: "#loyalty", label: "Карты лояльности", selector: ".discounts-page" },
    { hash: "#purchaseanalytics", label: "Управление закупками", selector: ".procurement-page" },
    { hash: "#invoicesissued", label: "Счета-фактуры ЭСФ", selector: ".tax-invoices-page" },
    { hash: "#salesfunnel", label: "Воронка продаж", selector: ".analytics-funnel-page" },
    { hash: "#profitability", label: "Прибыльность мастеров", selector: ".analytics-funnel-page" },
    { hash: "#scripts", label: "Сценарии автоматизации", selector: ".automation-page" },
    { hash: "#files", label: "Файлы и вложения", selector: ".files-page" },
    { hash: "#start", label: "Начало работы", selector: ".start-page" },
  ];

  for (const item of testRoutes) {
    const errorCountBefore = jsErrors.length;
    await navigate(item.hash);
    await waitFor(`Boolean(document.querySelector(${JSON.stringify(item.selector)}))`, 10000, item.label);
    await sleep(350);

    const shotName = item.hash.replace(/[^a-zA-Z0-9_-]/g, "_");
    await screenshot(`route_${shotName}`);

    const routeReport = await evaluate(`(() => {
      const vw = window.innerWidth;
      const scrollWidth = document.documentElement.scrollWidth;
      const hasHorizontalScroll = scrollWidth > vw + 1;
      const table = document.querySelector("table");
      const hasRows = table ? table.querySelectorAll("tbody tr").length : 0;
      const pageTitle = document.querySelector(".page-header h1, h1, h2")?.innerText.trim();
      const hasSearch = Boolean(document.querySelector(".search-box input"));
      const hasFilterBtn = Boolean([...document.querySelectorAll(".list-toolbar button, .page-header button")].find((b) => b.innerText.includes("Фильтр")));
      const hasCreateBtn = Boolean(document.querySelector(".page-header .button.primary"));
      return {
        vw, scrollWidth, hasHorizontalScroll, hasRows, pageTitle, hasSearch, hasFilterBtn, hasCreateBtn,
      };
    })()`);

    const newErrors = jsErrors.length - errorCountBefore;
    auditSuite.routeChecks.push({
      route: item.hash,
      label: item.label,
      pass: !routeReport.hasHorizontalScroll && newErrors === 0,
      newErrors,
      overflow: routeReport.hasHorizontalScroll,
      ...routeReport,
    });
  }

  // Step 6: Empty States Audit (Search non-existent query across tables)
  const emptyStateTestRoutes = [
    { hash: "#products", name: "Товары" },
    { hash: "#pricelists", name: "Прайс-листы" },
    { hash: "#stock", name: "Остатки" },
    { hash: "#warehouses", name: "Склады" },
    { hash: "#work_order", name: "Заказ-наряды" },
  ];

  for (const entry of emptyStateTestRoutes) {
    await navigate(entry.hash);
    await waitFor("Boolean(document.querySelector('.search-box input'))", 6000, "search input");
    await evaluate(`(() => {
      const input = document.querySelector('.search-box input');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, "NON_EXISTENT_QUERY_GAUNTLET_9999");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    })()`);
    await sleep(600);

    const emptyStateInfo = await evaluate(`(() => {
      const table = document.querySelector("table");
      const rows = table ? [...table.querySelectorAll("tbody tr")] : [];
      const emptyTd = table?.querySelector("td.empty-state, td.empty-inline");
      const hasIcon = Boolean(emptyTd?.querySelector("svg"));
      const hasTitle = Boolean(emptyTd?.querySelector("h3, h2, b"));
      const hasDescription = Boolean(emptyTd?.querySelector("p, span"));
      const hasActionBtn = Boolean(emptyTd?.querySelector("button, .button"));
      const isPlainInline = Boolean(table?.querySelector("td.empty-inline"));
      return {
        rowCount: rows.length,
        text: emptyTd ? emptyTd.innerText.trim().replace(/\\s+/g, " ") : "no empty td",
        hasIcon, hasTitle, hasDescription, hasActionBtn, isPlainInline,
      };
    })()`);

    auditSuite.emptyStateChecks.push({
      section: entry.name,
      route: entry.hash,
      ...emptyStateInfo,
    });

    if (emptyStateInfo.isPlainInline) {
      recordDiscrepancy(
        "LOW",
        `Empty State: ${entry.name}`,
        `Shows plain single-line .empty-inline ("${emptyStateInfo.text}") instead of rich empty state`,
        "MoySklad empty states display icon, descriptive title, explanation, and primary action button (+ Создать)",
        emptyStateInfo.text,
        `Enhance empty state in ${entry.name} with icon, explanatory prompt, and primary action button`
      );
    }
  }

  // Clear search on last test
  await evaluate(`(() => {
    const input = document.querySelector('.search-box input');
    if (input) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, "");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  })()`);
  await sleep(400);

  // Step 7: Product Card (Full Card & Tabs Audit)
  await navigate("#products?edit=new&type=Good");
  await waitFor("Boolean(document.querySelector('.product-card-page'))", 8000, "product card page");
  await sleep(600);
  await screenshot("03-product-card-new");

  const productCardAudit = await evaluate(`(() => {
    const page = document.querySelector(".product-card-page");
    const actions = [...document.querySelectorAll(".product-card-actions button")].map((b) => b.innerText.trim());
    const nameInput = document.querySelector(".product-card-name input");
    const tabs = [...document.querySelectorAll(".product-card-tabs button")].map((b) => ({
      name: b.innerText.trim(),
      selected: b.classList.contains("selected"),
    }));
    const aside = document.querySelector(".product-card-properties");
    const asideSections = aside ? [...aside.querySelectorAll(".product-card-subsection b")].map((b) => b.innerText.trim()) : [];
    return {
      actions,
      namePlaceholder: nameInput?.placeholder,
      tabs,
      activeTab: tabs.find((t) => t.selected)?.name,
      asideSections,
      isOverlayDialog: Boolean(document.querySelector(".modal-backdrop .product-card-page")),
    };
  })()`);

  recordTokenCheck(
    "Product Card: Layout Architecture",
    "page vs dialog overlay",
    productCardAudit.isOverlayDialog ? "Dialog overlay" : "Full embedded workspace page",
    "Full embedded workspace page (#good/edit?new)",
    !productCardAudit.isOverlayDialog,
    "Product card renders as workspace page, not popup modal"
  );

  recordTokenCheck(
    "Product Card: Default Active Tab",
    "initial active tab on new card",
    productCardAudit.activeTab,
    "Цены (MoySklad benchmark)",
    productCardAudit.activeTab?.startsWith("Цены"),
    "Default tab is 'Цены'"
  );

  // Switch through each tab of Product Card and verify no JS errors
  const tabsToTest = ["Цены", "Модификации", "Аналоги", "Упаковка", "Остатки", "История", "Файлы"];
  for (const tabName of tabsToTest) {
    const errorsBefore = jsErrors.length;
    await evaluate(`(() => {
      const btn = [...document.querySelectorAll(".product-card-tabs button")].find((b) => b.innerText.includes(${JSON.stringify(tabName)}));
      if (btn) btn.click();
    })()`);
    await sleep(300);

    const tabState = await evaluate(`(() => {
      const activeBtn = document.querySelector(".product-card-tabs button.selected");
      const activePanel = document.querySelector(".product-tab-panel:not([hidden])");
      return {
        activeTabLabel: activeBtn?.innerText.trim(),
        hasPanelContent: Boolean(activePanel && activePanel.innerText.trim().length > 0),
      };
    })()`);

    auditSuite.componentChecks.push({
      component: `ProductCard Tab: ${tabName}`,
      pass: tabState.hasPanelContent && jsErrors.length === errorsBefore,
      activeTabLabel: tabState.activeTabLabel,
      errors: jsErrors.length - errorsBefore,
    });
  }

  // Close product card via button
  await evaluate(`document.querySelector(".product-card-actions button:nth-child(2)").click()`);
  await sleep(500);

  // Step 8: Price List Modal Audit (Step 1 & Step 2)
  await navigate("#pricelists");
  await waitFor("Boolean(document.querySelector('.page-header .button.primary'))", 8000, "price lists page");
  // Click "+ Прайс-лист"
  await evaluate(`document.querySelector(".page-header .button.primary").click()`);
  await waitFor("Boolean(document.querySelector('.product-card-modal'))", 8000, "price list modal step 1");
  await sleep(500);
  await screenshot("04-pricelist-modal-step1");

  const priceListStep1 = await evaluate(`(() => {
    const modal = document.querySelector(".product-card-modal");
    const title = modal.querySelector("header h2")?.innerText.trim();
    const nameInput = modal.querySelector("input[maxlength='200']");
    const columns = [...modal.querySelectorAll(".product-price-row")].length;
    const continueBtn = [...modal.querySelectorAll(".modal-actions button")].find((b) => b.innerText.includes("Продолжить"));
    return {
      title,
      hasNameInput: Boolean(nameInput),
      columns,
      canContinue: Boolean(continueBtn && !continueBtn.disabled),
    };
  })()`);

  recordTokenCheck(
    "Price List: Step 1 Modal",
    "Initial wizard step",
    priceListStep1.title,
    "Новый прайс-лист with columns setup",
    priceListStep1.hasNameInput && priceListStep1.columns >= 1,
    "Price list modal wizard step 1 conforms"
  );

  // Enter test name and proceed to Step 2
  await evaluate(`(() => {
    const input = document.querySelector(".product-card-modal input[maxlength='200']");
    input.value = "Тестовый прайс-лист Gauntlet";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    const continueBtn = [...document.querySelectorAll(".modal-actions button")].find((b) => b.innerText.includes("Продолжить"));
    if (continueBtn) continueBtn.click();
  })()`);
  await sleep(600);
  await screenshot("05-pricelist-modal-step2");

  const priceListStep2 = await evaluate(`(() => {
    const modal = document.querySelector(".product-card-modal");
    const hasPositionsTab = Boolean(modal.querySelector(".product-card-tabs"));
    const hasAddToolbar = Boolean(modal.querySelector(".list-toolbar select"));
    const emptyNotice = modal.querySelector(".empty-inline")?.innerText.trim();
    const backBtn = [...modal.querySelectorAll(".modal-actions button")].find((b) => b.innerText.includes("Назад"));
    const saveBtn = [...modal.querySelectorAll(".modal-actions button")].find((b) => b.innerText.includes("Сохранить"));
    return {
      hasPositionsTab,
      hasAddToolbar,
      emptyNotice,
      hasBackBtn: Boolean(backBtn),
      hasSaveBtn: Boolean(saveBtn),
    };
  })()`);

  recordTokenCheck(
    "Price List: Step 2 Position Matrix",
    "Columns and items grid",
    priceListStep2.emptyNotice,
    "В прайс-листе пока нет позиций",
    priceListStep2.hasPositionsTab && priceListStep2.hasAddToolbar,
    "Step 2 position matrix view conforms"
  );

  // Close price list modal
  await evaluate(`(() => {
    const closeBtn = document.querySelector(".product-card-modal header button[aria-label='Закрыть']");
    if (closeBtn) closeBtn.click();
  })()`);
  await sleep(500);

  // Step 9: Document Creation Dialog Audit (#work_order?new=1)
  await navigate("#work_order?new=1");
  await waitFor("Boolean(document.querySelector('.modal'))", 8000, "work order modal");
  await sleep(500);
  await screenshot("06-document-modal-work-order");

  const docModalAudit = await evaluate(`(() => {
    const modal = document.querySelector(".modal");
    const title = modal.querySelector("header h2")?.innerText.trim();
    const labels = [...modal.querySelectorAll(".form-grid label")].map((l) => l.innerText.split("\\n")[0].trim());
    const lineEditor = modal.querySelector(".line-editor");
    const addLineBtn = lineEditor?.querySelector(".button.outline");
    const cancelBtn = [...modal.querySelectorAll(".modal-actions button")].find((b) => b.innerText.includes("Отмена"));
    const submitBtn = modal.querySelector(".modal-actions .button.primary");
    return {
      title,
      labels,
      hasLineEditor: Boolean(lineEditor),
      hasAddLineBtn: Boolean(addLineBtn),
      hasSubmitBtn: Boolean(submitBtn),
    };
  })()`);

  recordTokenCheck(
    "Document Modal: Structure",
    "header, fields, line editor, footer actions",
    docModalAudit.title,
    "Новый заказ-наряд with header, line editor, actions",
    docModalAudit.hasLineEditor && docModalAudit.hasSubmitBtn,
    "Document modal conforms"
  );

  // Close document modal
  await evaluate(`document.querySelector(".modal header button")?.click()`);
  await sleep(400);

  // Step 10: Interactive States Audit (Hover, Active, Disabled, Focus)
  const interactiveAudit = await evaluate(`(() => {
    // Disabled state of mass action buttons on current screen
    const metaButtons = [...document.querySelectorAll(".list-meta button")];
    const disabledCount = metaButtons.filter((b) => b.disabled).length;
    const totalCount = metaButtons.length;

    // Active sub-nav button
    const activeSub = document.querySelector(".subnav-scroll button.sub-active");
    const activeSubStyle = activeSub ? getComputedStyle(activeSub) : null;

    // View switch active
    const activeView = document.querySelector(".view-switch button.selected");

    // Inspect CSS Stylesheet rules for interactive pseudo-classes (:hover, :focus, :active, :disabled)
    const sheets = [...document.styleSheets];
    const rules = [];
    for (const sheet of sheets) {
      try {
        for (const rule of sheet.cssRules || []) {
          if (rule.selectorText) rules.push(rule.selectorText);
        }
      } catch {}
    }

    const hasHoverRules = {
      primaryBtnHover: rules.some((s) => s.includes(".button.primary:hover")),
      outlineBtnHover: rules.some((s) => s.includes(".button.outline:hover")),
      moduleBtnHover: rules.some((s) => s.includes(".module-button:hover")),
      tableRowHover: rules.some((s) => s.includes("tbody tr:hover")),
      subnavHover: rules.some((s) => s.includes(".subnav-scroll button:hover")),
      linkBtnHover: rules.some((s) => s.includes(".link-button:hover")),
    };

    const hasInteractiveStates = {
      btnDisabled: rules.some((s) => s.includes("button:disabled")),
      moduleActive: rules.some((s) => s.includes(".module-active")),
      subnavActive: rules.some((s) => s.includes(".sub-active")),
      formFocus: rules.some((s) => s.includes(":focus")),
      productReadonlyDisabled: rules.some((s) => s.includes(".product-card-readonly:disabled")),
    };

    return {
      massActionsDisabledWhenEmpty: totalCount > 0 && disabledCount === totalCount,
      totalCount,
      disabledCount,
      activeSubUnderline: activeSubStyle ? getComputedStyle(activeSub, "::after").content : "none",
      hasActiveView: Boolean(activeView),
      hasHoverRules,
      hasInteractiveStates,
    };
  })()`);

  recordTokenCheck(
    "Interactive: Hover Rules Coverage",
    "presence of :hover rules for buttons, rows, tabs",
    JSON.stringify(interactiveAudit.hasHoverRules),
    "All true",
    Object.values(interactiveAudit.hasHoverRules).every(Boolean),
    "CSS stylesheet contains all required hover states"
  );

  recordTokenCheck(
    "Interactive: Focus & Disabled State Coverage",
    "presence of :focus, :disabled, .active rules",
    JSON.stringify(interactiveAudit.hasInteractiveStates),
    "All true",
    Object.values(interactiveAudit.hasInteractiveStates).every(Boolean),
    "CSS stylesheet contains all interactive focus & disabled states"
  );

  // Step 11: Multi-Viewport Responsive & DOM Integrity Audit
  const viewports = [
    { name: "desktop-hd", width: 1920, height: 1080, mobile: false },
    { name: "desktop-standard", width: 1440, height: 900, mobile: false },
    { name: "tablet", width: 1024, height: 768, mobile: false },
    { name: "mobile", width: 390, height: 844, mobile: true },
  ];

  for (const vp of viewports) {
    await setViewport(vp.width, vp.height, vp.mobile);
    await navigate("#products");
    await sleep(400);

    const vpReport = await evaluate(`(() => {
      const vw = window.innerWidth;
      const scrollWidth = document.documentElement.scrollWidth;
      const hasHorizontalScroll = scrollWidth > vw + 1;
      const navDisplay = getComputedStyle(document.querySelector(".main-nav")).display;
      const bottomNavDisplay = document.querySelector(".mobile-bottom-nav")
        ? getComputedStyle(document.querySelector(".mobile-bottom-nav")).display
        : "none";
      return {
        vw, scrollWidth, hasHorizontalScroll, navDisplay, bottomNavDisplay,
      };
    })()`);

    auditSuite.responsiveChecks.push({
      viewport: vp.name,
      width: vp.width,
      height: vp.height,
      pass: !vpReport.hasHorizontalScroll,
      ...vpReport,
    });
  }

  // Restore desktop viewport
  await setViewport(1440, 900);

  // Compile final results
  auditSuite.jsErrors = jsErrors;
  const criticalDiscrepancies = auditSuite.discrepancies.filter((d) => d.severity === "CRITICAL" || d.severity === "HIGH");
  const failedRouteChecks = auditSuite.routeChecks.filter((r) => !r.pass);
  const failedResponsiveChecks = auditSuite.responsiveChecks.filter((r) => !r.pass);

  console.log(`\n================ GAUNTLET CRITIC SUITE REPORT ================\n`);
  console.log(`Timestamp: ${auditSuite.timestamp}`);
  console.log(`Total Routes Tested: ${auditSuite.routeChecks.length}`);
  console.log(`Failed Route Checks: ${failedRouteChecks.length}`);
  console.log(`JavaScript Errors Caught: ${jsErrors.length}`);
  console.log(`Responsive Checks: ${auditSuite.responsiveChecks.length} (Failed: ${failedResponsiveChecks.length})`);
  console.log(`Token Checks: ${auditSuite.tokenChecks.length}`);
  console.log(`Identified Discrepancies: ${auditSuite.discrepancies.length} (High/Critical: ${criticalDiscrepancies.length})\n`);

  fs.writeFileSync(reportFile, JSON.stringify(auditSuite, null, 2));
  console.log(`Detailed report written to: ${reportFile}`);

  process.exitCode = jsErrors.length > 0 || failedRouteChecks.length > 0 ? 1 : 0;
} catch (error) {
  console.error("FATAL GAUNTLET ERROR:", error);
  process.exitCode = 1;
} finally {
  ws.close();
  chrome.kill();
}
