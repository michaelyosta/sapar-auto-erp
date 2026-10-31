import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, Check, ClipboardList, Plus, RotateCcw, Search, X } from "lucide-react";

export type PriceListsPageProps = { onNotify: (message: string) => void };

type PriceListSummary = {
  id: number;
  name: string;
  price_type: string;
  active: number;
  position_count: number;
  created_at: string;
  updated_at: string;
};
type PriceListColumnDto = {
  id: number;
  name: string;
  position: number;
  apply_adjustment: number;
  adjustment_percent: number;
};
type PriceListItemDto = {
  id: number;
  product_id: number;
  position: number;
  code: string;
  article: string;
  name: string;
  kind: string;
  unit: string;
  group_name: string;
  active: number;
  prices: Array<number | null>;
};
type PriceListDto = PriceListSummary & { columns: PriceListColumnDto[]; items: PriceListItemDto[] };
type PriceListMetadata = { price_types: string[]; groups: Array<{ id: number; path: string }> };
type ProductOption = {
  id: number;
  code: string;
  article?: string;
  name: string;
  kind: "product" | "service";
  unit: string;
  group_name?: string;
  active: number;
};
type EditorColumn = { id?: number; name: string; applyAdjustment: boolean; adjustmentPercent: string };
type EditorItem = {
  productId: number;
  code: string;
  article: string;
  name: string;
  kind: string;
  unit: string;
  groupName: string;
  active: number;
  prices: string[];
};
type EditorState = {
  id: number | null;
  name: string;
  priceType: string;
  active: boolean;
  columns: EditorColumn[];
  items: EditorItem[];
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Не удалось выполнить запрос.");
  return data as T;
}

const moneyInput = (tiyin: number | null) => tiyin == null ? "" : (tiyin / 100).toFixed(2).replace(/\.00$/, "");
const itemTypeName = (kind: string) => kind === "service" ? "Услуга" : "Товар";

function toEditor(list: PriceListDto): EditorState {
  return {
    id: list.id,
    name: list.name,
    priceType: list.price_type,
    active: Boolean(list.active),
    columns: list.columns.map((column) => ({
      id: column.id,
      name: column.name,
      applyAdjustment: Boolean(column.apply_adjustment),
      adjustmentPercent: String(column.adjustment_percent),
    })),
    items: list.items.map((item) => ({
      productId: item.product_id,
      code: item.code,
      article: item.article,
      name: item.name,
      kind: item.kind,
      unit: item.unit,
      groupName: item.group_name,
      active: item.active,
      prices: list.columns.map((_, index) => moneyInput(item.prices[index] ?? null)),
    })),
  };
}

function emptyEditor(): EditorState {
  return {
    id: null,
    name: "",
    priceType: "Цена продажи",
    active: true,
    columns: [{ name: "Колонка 1", applyAdjustment: false, adjustmentPercent: "0" }],
    items: [],
  };
}

export default function PriceListsPage({ onNotify }: PriceListsPageProps) {
  const [rows, setRows] = useState<PriceListSummary[]>([]);
  const [query, setQuery] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [metadata, setMetadata] = useState<PriceListMetadata>({ price_types: ["Закупочные", "Цена продажи"], groups: [] });
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [editorStage, setEditorStage] = useState<1 | 2>(1);
  const [editorDirty, setEditorDirty] = useState(false);
  const [editorBusy, setEditorBusy] = useState(false);
  const [editorError, setEditorError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [productQuery, setProductQuery] = useState("");
  const [productOptions, setProductOptions] = useState<ProductOption[]>([]);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [groupId, setGroupId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const result = await request<PriceListSummary[]>(`/api/price-lists?q=${encodeURIComponent(query)}&archived=${includeArchived ? "1" : "0"}`);
      setRows(result);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось загрузить прайс-листы.");
    } finally { setLoading(false); }
  }, [query, includeArchived]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    void request<PriceListMetadata>("/api/price-lists/metadata")
      .then((result) => setMetadata({ price_types: result.price_types.length ? result.price_types : ["Закупочные", "Цена продажи"], groups: result.groups }))
      .catch(() => undefined);
  }, []);

  const editorOpen = editor !== null;
  useEffect(() => {
    if (!editorOpen) return;
    const timer = window.setTimeout(() => {
      void request<ProductOption[]>(`/api/products?q=${encodeURIComponent(productQuery)}&kind=all`)
        .then(setProductOptions)
        .catch((error) => setEditorError(error instanceof Error ? error.message : "Не удалось загрузить номенклатуру."));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [editorOpen, productQuery]);

  const updateEditor = (change: (current: EditorState) => EditorState) => {
    setEditor((current) => current ? change(current) : current);
    setEditorDirty(true);
    setEditorError("");
  };

  const openList = async (id: number) => {
    setMessage(""); setEditorError(""); setEditorBusy(true);
    try { setEditor(toEditor(await request<PriceListDto>(`/api/price-lists/${id}`))); setEditorDirty(false); setEditorStage(2); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Не удалось открыть прайс-лист."); }
    finally { setEditorBusy(false); }
  };

  const closeEditor = () => {
    if (editorDirty && !window.confirm("Закрыть без сохранения? Несохранённые изменения будут потеряны.")) return;
    setEditor(null); setEditorDirty(false); setEditorError(""); setProductQuery(""); setSelectedProductId(""); setGroupId("");
  };

  const saveEditor = async (notify = true): Promise<PriceListDto | null> => {
    if (!editor) return null;
    setEditorError(""); setEditorBusy(true);
    const body = {
      name: editor.name,
      priceType: editor.priceType,
      active: editor.active,
      columns: editor.columns.map((column) => ({
        ...(column.id ? { id: column.id } : {}),
        name: column.name,
        applyAdjustment: column.applyAdjustment,
        adjustmentPercent: column.adjustmentPercent,
      })),
      items: editor.items.map((item) => ({
        productId: item.productId,
        prices: editor.columns.map((_, index) => item.prices[index] ?? ""),
      })),
    };
    try {
      const result = await request<PriceListDto>(editor.id ? `/api/price-lists/${editor.id}` : "/api/price-lists", {
        method: editor.id ? "PATCH" : "POST", body: JSON.stringify(body),
      });
      setEditor(toEditor(result)); setEditorDirty(false); await load();
      if (notify) onNotify(editor.id ? "Прайс-лист обновлён" : "Прайс-лист создан");
      return result;
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : "Не удалось сохранить прайс-лист.");
      return null;
    } finally { setEditorBusy(false); }
  };

  const archiveList = async (row: PriceListSummary, active: boolean) => {
    if (!active && !window.confirm(`Архивировать прайс-лист «${row.name}»?`)) return;
    setMessage("");
    try {
      await request(`/api/price-lists/${row.id}`, { method: "PATCH", body: JSON.stringify({ active }) });
      await load(); onNotify(active ? "Прайс-лист восстановлен" : "Прайс-лист архивирован");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Не удалось изменить прайс-лист."); }
  };

  const fill = async (source: "catalog" | "stock" | "group") => {
    if (!editor) return;
    if (source === "group" && !groupId) {
      setEditorError("Выберите группу номенклатуры.");
      return;
    }
    setEditorError("");
    setEditorBusy(true);
    try {
      if (!editor.id) {
        const preview = await request<{ items: Array<{ product_id: number; code: string; article: string; name: string; kind: string; unit: string; group_name: string; active: number; prices: Array<number | null> }> }>("/api/price-lists/preview-fill", {
          method: "POST",
          body: JSON.stringify({
            source, priceType: editor.priceType,
            columns: editor.columns.map((column) => ({ name: column.name, applyAdjustment: column.applyAdjustment, adjustmentPercent: column.adjustmentPercent })),
            excludeProductIds: editor.items.map((item) => item.productId),
            ...(source === "group" ? { groupId: Number(groupId) } : {}),
          }),
        });
        const added = preview.items.map((item) => ({
          productId: item.product_id, code: item.code, article: item.article, name: item.name, kind: item.kind,
          unit: item.unit, groupName: item.group_name, active: item.active,
          prices: item.prices.map((price) => moneyInput(price)),
        }));
        setEditor((current) => current ? { ...current, items: [...current.items, ...added] } : current);
        setEditorDirty(true);
        onNotify(`Добавлено позиций: ${added.length}`);
      } else {
        if (editorDirty) {
          const saved = await saveEditor(false);
          if (!saved) return;
        }
        const result = await request<{ added: number; skipped: number; list: PriceListDto }>(`/api/price-lists/${editor.id}/fill`, {
          method: "POST", body: JSON.stringify({ source, ...(source === "group" ? { groupId: Number(groupId) } : {}) }),
        });
        setEditor(toEditor(result.list)); setEditorDirty(false); await load();
        onNotify(`Добавлено позиций: ${result.added}; уже были в списке: ${result.skipped}`);
      }
    } catch (error) { setEditorError(error instanceof Error ? error.message : "Не удалось дополнить прайс-лист."); }
    finally { setEditorBusy(false); }
  };

  const continueEditor = () => {
    if (!editor?.name.trim()) { setEditorError("Заполните название прайс-листа."); return; }
    if (!editor.priceType.trim()) { setEditorError("Выберите тип цен."); return; }
    if (!editor.columns.length || editor.columns.some((column) => !column.name.trim())) { setEditorError("Укажите название каждой колонки."); return; }
    setEditorError(""); setEditorStage(2);
  };

  const addProduct = async () => {
    const product = productOptions.find((item) => item.id === Number(selectedProductId));
    if (!product || !editor || editor.items.some((item) => item.productId === product.id)) return;
    setEditorError(""); setEditorBusy(true);
    try {
      const preview = await request<{ items: Array<{ product_id: number; code: string; article: string; name: string; kind: string; unit: string; group_name: string; active: number; prices: Array<number | null> }> }>("/api/price-lists/preview-fill", {
        method: "POST",
        body: JSON.stringify({
          source: "catalog", productIds: [product.id], priceType: editor.priceType,
          columns: editor.columns.map((column) => ({ name: column.name, applyAdjustment: column.applyAdjustment, adjustmentPercent: column.adjustmentPercent })),
        }),
      });
      const item = preview.items[0];
      if (!item) throw new Error("Позиция больше недоступна.");
      updateEditor((current) => ({ ...current, items: [...current.items, {
        productId: item.product_id, code: item.code, article: item.article, name: item.name, kind: item.kind,
        unit: item.unit, groupName: item.group_name, active: item.active, prices: item.prices.map(moneyInput),
      }] }));
      setSelectedProductId("");
    } catch (error) { setEditorError(error instanceof Error ? error.message : "Не удалось добавить позицию."); }
    finally { setEditorBusy(false); }
  };

  const filteredOptions = useMemo(() => {
    const added = new Set(editor?.items.map((item) => item.productId) ?? []);
    return productOptions.filter((product) => !added.has(product.id));
  }, [editor?.items, productOptions]);

  return <>
    <div className="page-header">
      <h1>Прайс-листы</h1>
      <div className="page-actions"><button className="button primary" onClick={() => { setEditor(emptyEditor()); setEditorDirty(false); setEditorError(""); setEditorStage(1); }}><Plus size={16} />Прайс-лист</button></div>
    </div>
    <div className="list-toolbar">
      <div className="search-box"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Название, тип цен или товар" /></div>
      <label className="archive-toggle"><input type="checkbox" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} />Показать архив</label>
    </div>
    <div className="list-meta"><span>{loading ? "Загрузка…" : `Все ${rows.length}`}</span><div><button onClick={() => void load()}>Обновить</button></div></div>
    {message && <div className="notice-error">{message}<button onClick={() => setMessage("")}><X size={14} /></button></div>}
    <div className="table-card responsive-table"><table>
      <thead><tr><th>Название</th><th>Тип цен</th><th>Позиций</th><th>Изменён</th><th>Статус</th><th></th></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.id}>
        <td data-label="Название" className="cell-main"><button className="link-button" onClick={() => void openList(row.id)}>{row.name}</button></td>
        <td data-label="Тип цен">{row.price_type}</td><td data-label="Позиций">{row.position_count}</td><td data-label="Изменён">{row.updated_at}</td>
        <td data-label="Статус"><span className={`status-pill ${row.active ? "status-posted" : "status-cancelled"}`}>{row.active ? "Активен" : "В архиве"}</span></td>
        <td data-label="Действия" className="actions-cell">{row.active
          ? <button className="link-button" onClick={() => void archiveList(row, false)}><Archive size={13} /> Архивировать</button>
          : <button className="link-button" onClick={() => void archiveList(row, true)}><RotateCcw size={13} /> Восстановить</button>}</td>
      </tr>)}
      {!rows.length && <tr><td colSpan={6} className="empty-state"><ClipboardList size={42} /><h3>{loading ? "Загрузка прайс-листов…" : query ? "Ничего не найдено" : "Прайс-листов пока нет"}</h3><p>{query ? "Попробуйте изменить поисковый запрос" : "Создайте прайс-лист для индивидуальных цен покупателей или колонок наценок"}</p>{!loading && !query && <button className="button primary" onClick={() => { setEditor(emptyEditor()); setEditorDirty(false); setEditorError(""); setEditorStage(1); }}><Plus size={16} />Создать прайс-лист</button>}</td></tr>}</tbody>
    </table></div>

    {editor && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeEditor(); }}>
      <section className="modal product-card-modal" role="dialog" aria-modal="true" aria-labelledby="price-list-title">
        <header><h2 id="price-list-title">{editor.id ? `Прайс-лист · ${editor.name || "Без названия"}` : "Новый прайс-лист"}</h2><button aria-label="Закрыть" onClick={closeEditor}><X size={19} /></button></header>
        <div className="product-card-form">
          {editorStage === 2 && <div className="product-card-actions">
            <button className="button outline" disabled={editorBusy} onClick={() => void fill("catalog")}>Дополнить из номенклатуры</button>
            <button className="button outline" disabled={editorBusy} onClick={() => void fill("stock")}>Дополнить из остатков</button>
          </div>}
          <div className={`product-card-workspace ${editorStage === 1 ? "price-list-settings-only" : ""}`}>
            <aside className="product-card-properties">
              <div className="product-fields-stack">
                <label>Название прайс-листа<input maxLength={200} value={editor.name} onChange={(event) => updateEditor((current) => ({ ...current, name: event.target.value }))} /></label>
                <label>Тип цен<select value={editor.priceType} onChange={(event) => updateEditor((current) => ({ ...current, priceType: event.target.value }))}>
                  {[...new Set([...metadata.price_types, editor.priceType].filter(Boolean))].map((priceType) => <option key={priceType} value={priceType}>{priceType}</option>)}
                </select></label>
                <label className="checkbox-line"><input type="checkbox" checked={editor.active} onChange={(event) => updateEditor((current) => ({ ...current, active: event.target.checked }))} />Активен</label>

                <div className="product-card-subsection">
                  <div className="section-heading"><b>Колонки</b><button type="button" className="button outline" onClick={() => updateEditor((current) => ({
                    ...current,
                    columns: [...current.columns, { name: `Колонка ${current.columns.length + 1}`, applyAdjustment: false, adjustmentPercent: "0" }],
                    items: current.items.map((item) => ({ ...item, prices: [...item.prices, ""] })),
                  }))}><Plus size={14} />Добавить</button></div>
                  {editor.columns.map((column, index) => <div key={column.id ?? `new-${index}`}>
                    <div className="product-price-row">
                      <label>Название<input maxLength={100} value={column.name} onChange={(event) => updateEditor((current) => ({ ...current, columns: current.columns.map((item, columnIndex) => columnIndex === index ? { ...item, name: event.target.value } : item) }))} /></label>
                      <label>Скидка / наценка, %<input type="number" step="0.01" min="-100" disabled={!column.applyAdjustment} value={column.adjustmentPercent} onChange={(event) => updateEditor((current) => ({ ...current, columns: current.columns.map((item, columnIndex) => columnIndex === index ? { ...item, adjustmentPercent: event.target.value } : item) }))} /></label>
                      <button type="button" className="icon-button" aria-label={`Удалить колонку ${column.name}`} onClick={() => {
                        if (editor.columns.length <= 1) { setEditorError("В прайс-листе должна остаться хотя бы одна колонка."); return; }
                        updateEditor((current) => ({ ...current, columns: current.columns.filter((_, columnIndex) => columnIndex !== index), items: current.items.map((item) => ({ ...item, prices: item.prices.filter((_, priceIndex) => priceIndex !== index) })) }));
                      }}><X size={16} /></button>
                    </div>
                    <label className="checkbox-line" style={{ marginTop: 5 }}><input type="checkbox" checked={column.applyAdjustment} onChange={(event) => updateEditor((current) => ({ ...current, columns: current.columns.map((item, columnIndex) => columnIndex === index ? { ...item, applyAdjustment: event.target.checked } : item) }))} />Скидка (-) или наценка (+), % от выбранного типа цен</label>
                  </div>)}
                  <small>Положительный процент — наценка, отрицательный — скидка. Процент применяется к выбранному выше типу цен. Если расчёт выключен, автоматическое заполнение оставит цену пустой.</small>
                </div>

                {editorStage === 2 && <div className="product-card-subsection">
                  <b>Дополнить группу</b>
                  <label>Группа номенклатуры<select value={groupId} onChange={(event) => setGroupId(event.target.value)}><option value="">Выберите группу</option>{metadata.groups.map((group) => <option key={group.id} value={group.id}>{group.path}</option>)}</select></label>
                  <button className="button outline" disabled={editorBusy || !groupId} onClick={() => void fill("group")}>Дополнить из группы</button>
                </div>}
              </div>
            </aside>
            {editorStage === 2 && <section className="product-card-main">
              <div className="product-card-tabs"><button className="selected">Позиции <small>{editor.items.length}</small></button></div>
              <div className="product-card-content">
                <p className="muted">Добавьте позиции и укажите цены колонок. При создании документа можно будет вручную расценить позиции этим прайс-листом.</p>
                <div className="list-toolbar">
                  <div className="search-box"><Search size={16} /><input value={productQuery} onChange={(event) => setProductQuery(event.target.value)} placeholder="Найти товар или услугу" /></div>
                  <select value={selectedProductId} onChange={(event) => setSelectedProductId(event.target.value)} aria-label="Выберите позицию для добавления">
                    <option value="">Выберите позицию</option>{filteredOptions.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.code || itemTypeName(product.kind)}</option>)}
                  </select>
                  <button className="button outline" disabled={editorBusy || !selectedProductId} onClick={() => void addProduct()}><Plus size={14} />Добавить</button>
                </div>
                {editorError && <div className="form-error">{editorError}</div>}
                <div className="table-card"><table>
                  <thead><tr><th>Наименование</th><th>Код</th>{editor.columns.map((column, index) => <th key={column.id ?? `new-${index}`}>{column.name}</th>)}<th></th></tr></thead>
                  <tbody>{editor.items.map((item, itemIndex) => <tr key={item.productId}>
                    <td><b>{item.name}</b><small className="subcell">{itemTypeName(item.kind)}{item.unit ? ` · ${item.unit}` : ""}{item.groupName ? ` · ${item.groupName}` : ""}{!item.active ? " · архив" : ""}</small></td>
                    <td>{item.code || item.article || "—"}</td>
                    {editor.columns.map((column, columnIndex) => <td key={column.id ?? `new-${columnIndex}`}><input aria-label={`Цена ${column.name} для ${item.name}`} type="number" min="0" step="0.01" value={item.prices[columnIndex] ?? ""} onChange={(event) => updateEditor((current) => ({ ...current, items: current.items.map((row, rowIndex) => rowIndex === itemIndex ? { ...row, prices: row.prices.map((price, priceIndex) => priceIndex === columnIndex ? event.target.value : price) } : row) }))} /></td>)}
                    <td><button className="link-button" onClick={() => updateEditor((current) => ({ ...current, items: current.items.filter((_, rowIndex) => rowIndex !== itemIndex) }))}>Удалить</button></td>
                  </tr>)}
                  {!editor.items.length && <tr><td colSpan={editor.columns.length + 3} className="empty-inline">В прайс-листе пока нет позиций</td></tr>}</tbody>
                </table></div>
              </div>
            </section>}
          </div>
          {editorStage === 1 && editorError && <div className="form-error">{editorError}</div>}
          <div className="product-card-footer">
            <span>{editor.id ? `${editor.items.length} позиций · ${editor.active ? "Активен" : "В архиве"}` : `Шаг ${editorStage} из 2`}{editorDirty ? " · Есть несохранённые изменения" : ""}</span>
            <div className="modal-actions">{editorStage === 2 && !editor.id && <button className="button outline" disabled={editorBusy} onClick={() => { setEditorStage(1); setEditorError(""); }}>Назад</button>}<button className="button outline" disabled={editorBusy} onClick={closeEditor}>{editorDirty ? "Закрыть" : "Отмена"}</button>{!editor.id && editorStage === 1
              ? <button className="button primary" disabled={editorBusy} onClick={continueEditor}>Продолжить</button>
              : <button className="button primary" disabled={editorBusy || !editor.name.trim() || !editor.priceType.trim()} onClick={() => void saveEditor()}>{editorBusy ? "Сохранение…" : "Сохранить"}<Check size={15} /></button>}</div>
          </div>
        </div>
      </section>
    </div>}
  </>;
}
