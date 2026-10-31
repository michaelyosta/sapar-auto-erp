import { useState, useEffect, useCallback } from "react";
import {
  FileText, Image, FileSpreadsheet, Upload, Download,
  Trash2, Search, HardDrive, RefreshCw, X, FolderOpen
} from "lucide-react";

interface SystemFile {
  id: number;
  name: string;
  category: "photo" | "scan" | "contract" | "act" | "pricelist" | "general";
  mime_type: string;
  size_bytes: number;
  entity_type: string;
  entity_id: number | null;
  entity_title?: string;
  created_at: string;
}

interface Quota {
  fileCount: number;
  totalBytesUsed: number;
  totalBytesLimit: number;
  percentUsed: number;
}

export default function FilesPage({ onNotify }: { onNotify: (msg: string) => void }) {
  const [files, setFiles] = useState<SystemFile[]>([]);
  const [quota, setQuota] = useState<Quota>({ fileCount: 0, totalBytesUsed: 0, totalBytesLimit: 10737418240, percentUsed: 0 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [uploadOpen, setUploadOpen] = useState(false);

  // Upload Form
  const [fileName, setFileName] = useState("");
  const [fileCat, setFileCat] = useState<"photo" | "scan" | "contract" | "act" | "pricelist" | "general">("general");
  const [fileContent, setFileContent] = useState("");
  const [fileMime, setFileMime] = useState("application/octet-stream");

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams();
      if (search) q.set("q", search);
      if (category !== "all") q.set("category", category);

      const res = await fetch(`/api/files?${q.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setFiles(data.files || []);
        if (data.quota) setQuota(data.quota);
      }
    } catch {
      onNotify("Ошибка загрузки списка файлов");
    } finally {
      setLoading(false);
    }
  }, [search, category, onNotify]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const deleteFile = async (id: number) => {
    if (!window.confirm("Удалить этот файл?")) return;
    try {
      const res = await fetch(`/api/files/${id}`, { method: "DELETE" });
      if (res.ok) {
        onNotify("Файл перемещён в корзину");
        await loadData();
      }
    } catch {
      onNotify("Не удалось удалить файл");
    }
  };

  const handleFileUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fileName.trim()) {
      alert("Укажите имя файла");
      return;
    }

    try {
      const res = await fetch("/api/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: fileName,
          category: fileCat,
          mimeType: fileMime,
          base64Data: fileContent ? btoa(unescape(encodeURIComponent(fileContent))) : ""
        })
      });

      if (res.ok) {
        onNotify("Файл успешно загружен");
        setUploadOpen(false);
        setFileName("");
        setFileContent("");
        await loadData();
      } else {
        const err = await res.json();
        onNotify(err.error || "Не удалось загрузить файл");
      }
    } catch {
      onNotify("Сбой при отправке файла на сервер");
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 Б";
    if (bytes < 1024) return `${bytes} Б`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} МБ`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} ГБ`;
  };

  const getFileIcon = (mime: string, cat: string) => {
    if (cat === "photo" || mime.startsWith("image/")) return <Image size={18} color="#1565c0" />;
    if (cat === "pricelist" || mime.includes("spreadsheet") || mime.includes("excel")) return <FileSpreadsheet size={18} color="#2e7d32" />;
    return <FileText size={18} color="#d32f2f" />;
  };

  const getCatLabel = (cat: string) => {
    switch (cat) {
      case "contract": return "Договор";
      case "act": return "Акт";
      case "photo": return "Фото авто";
      case "pricelist": return "Прайс-лист";
      case "scan": return "Скан документа";
      default: return "Общий";
    }
  };

  return (
    <div className="files-page" style={{ padding: "16px 20px" }}>
      <header className="page-header" style={{ marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 20, margin: 0, fontWeight: 700, color: "#222" }}>Файлы и вложения</h1>
          <p style={{ margin: "4px 0 0", color: "#666", fontSize: 13 }}>
            Хранилище скан-копий договоров, актов дефектовки, фотофиксации повреждений и прайс-листов
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="button outline" onClick={() => void loadData()}>
            <RefreshCw size={15} style={{ marginRight: 6 }} /> Обновить
          </button>
          <button className="button action-blue" onClick={() => setUploadOpen(true)}>
            <Upload size={16} style={{ marginRight: 6 }} /> Загрузить файл
          </button>
        </div>
      </header>

      {/* Quota widget */}
      <div style={{ background: "#fff", padding: "12px 16px", borderRadius: 4, border: "1px solid #dcdcdc", marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <HardDrive size={22} color="#186999" />
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#333" }}>
              Занято: {formatBytes(quota.totalBytesUsed)} из 10 ГБ ({quota.percentUsed}%)
            </div>
            <div style={{ fontSize: 11, color: "#777" }}>
              Всего файлов в системе: <b>{quota.fileCount}</b> шт.
            </div>
          </div>
        </div>
        <div style={{ width: 220, background: "#eee", borderRadius: 4, height: 8, overflow: "hidden" }}>
          <div style={{ width: `${Math.max(2, quota.percentUsed)}%`, background: "#48a43f", height: "100%" }} />
        </div>
      </div>

      {/* Filter toolbar */}
      <div className="list-toolbar" style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14 }}>
        <div className="search-box" style={{ flex: "1 1 240px", maxWidth: 360 }}>
          <Search size={16} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по названию файла..."
          />
        </div>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          style={{ padding: "6px 12px", fontSize: 13, border: "1px solid #ccc", borderRadius: 4, background: "#fff" }}
        >
          <option value="all">Все категории файлов</option>
          <option value="contract">Договоры</option>
          <option value="act">Акты и бланки</option>
          <option value="photo">Фото осмотра авто</option>
          <option value="pricelist">Прайс-листы</option>
          <option value="general">Общие файлы</option>
        </select>
      </div>

      {/* Files Table */}
      <div className="table-card responsive-table" style={{ background: "#fff", borderRadius: 4, border: "1px solid #dcdcdc" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#f8f9fa", borderBottom: "1px solid #e0e0e0", fontSize: 12, textAlign: "left", color: "#666" }}>
              <th style={{ padding: "10px 14px", width: 40 }}></th>
              <th style={{ padding: "10px 14px" }}>Имя файла</th>
              <th style={{ padding: "10px 14px", width: 130 }}>Категория</th>
              <th style={{ padding: "10px 14px", width: 180 }}>Привязка к объекту</th>
              <th style={{ padding: "10px 14px", width: 100 }}>Размер</th>
              <th style={{ padding: "10px 14px", width: 140 }}>Дата загрузки</th>
              <th style={{ padding: "10px 14px", width: 100, textAlign: "right" }}>Действия</th>
            </tr>
          </thead>
          <tbody>
            {files.map((file) => (
              <tr key={file.id} style={{ borderBottom: "1px solid #eee", fontSize: 13 }}>
                <td style={{ padding: "10px 14px", textAlign: "center" }}>
                  {getFileIcon(file.mime_type, file.category)}
                </td>
                <td style={{ padding: "10px 14px" }}>
                  <a
                    href={`/api/files/${file.id}/download`}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontWeight: 600, color: "#186999", textDecoration: "none" }}
                  >
                    {file.name}
                  </a>
                </td>
                <td style={{ padding: "10px 14px" }}>
                  <span style={{ background: "#f0f0f0", padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 500, color: "#555" }}>
                    {getCatLabel(file.category)}
                  </span>
                </td>
                <td style={{ padding: "10px 14px", fontSize: 12, color: "#444" }}>
                  {file.entity_title || "Общий файл"}
                </td>
                <td style={{ padding: "10px 14px", fontSize: 12, color: "#666" }}>
                  {formatBytes(file.size_bytes)}
                </td>
                <td style={{ padding: "10px 14px", fontSize: 12, color: "#777" }}>
                  {new Date(`${file.created_at.replace(" ", "T")}Z`).toLocaleString("ru-RU")}
                </td>
                <td style={{ padding: "10px 14px", textAlign: "right" }}>
                  <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                    <a
                      href={`/api/files/${file.id}/download`}
                      download={file.name}
                      className="link-button"
                      style={{ padding: "4px", color: "#186999" }}
                      title="Скачать файл"
                    >
                      <Download size={14} />
                    </a>
                    <button
                      className="link-button"
                      onClick={() => void deleteFile(file.id)}
                      style={{ padding: "4px", color: "#d32f2f" }}
                      title="Удалить файл"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!files.length && !loading && (
              <tr>
                <td colSpan={7} style={{ padding: 40, textAlign: "center", color: "#888" }}>
                  <FolderOpen size={36} color="#aaa" style={{ marginBottom: 8 }} />
                  <div>Файлы не найдены. Нажмите «Загрузить файл» для добавления.</div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Upload File Modal */}
      {uploadOpen && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setUploadOpen(false); }}>
          <section className="modal" style={{ maxWidth: 500 }}>
            <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: 18 }}>Загрузка нового файла</h2>
              <button aria-label="Закрыть" onClick={() => setUploadOpen(false)} style={{ background: "none", border: "none", cursor: "pointer" }}>
                <X size={19} />
              </button>
            </header>

            <form onSubmit={handleFileUpload} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Имя файла с расширением *</label>
                <input
                  value={fileName}
                  onChange={(e) => {
                    setFileName(e.target.value);
                    if (e.target.value.endsWith(".pdf")) setFileMime("application/pdf");
                    else if (e.target.value.endsWith(".docx")) setFileMime("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
                    else if (e.target.value.endsWith(".xlsx")) setFileMime("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
                    else if (e.target.value.endsWith(".jpg") || e.target.value.endsWith(".jpeg")) setFileMime("image/jpeg");
                    else if (e.target.value.endsWith(".png")) setFileMime("image/png");
                  }}
                  placeholder="Например: Договор_№12_Сапар.pdf"
                  style={{ width: "100%", padding: "7px 10px", fontSize: 13, border: "1px solid #ccc", borderRadius: 4 }}
                  required
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Категория документа</label>
                <select
                  value={fileCat}
                  onChange={(e) => setFileCat(e.target.value as any)}
                  style={{ width: "100%", padding: "7px 10px", fontSize: 13, border: "1px solid #ccc", borderRadius: 4 }}
                >
                  <option value="contract">Договор</option>
                  <option value="act">Акт выполненных работ / Дефектовка</option>
                  <option value="photo">Фотография автомобиля / повреждений</option>
                  <option value="pricelist">Прайс-лист</option>
                  <option value="scan">Скан документа</option>
                  <option value="general">Общий файл</option>
                </select>
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Содержимое файла (текст или тестовый образец)</label>
                <textarea
                  value={fileContent}
                  onChange={(e) => setFileContent(e.target.value)}
                  placeholder="Вставьте текстовое содержимое документа или оставьте пустым для создания типового бланка..."
                  rows={4}
                  style={{ width: "100%", padding: "8px 10px", fontSize: 13, border: "1px solid #ccc", borderRadius: 4 }}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
                <button type="button" className="button outline" onClick={() => setUploadOpen(false)}>Отмена</button>
                <button type="submit" className="button primary">Загрузить</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
