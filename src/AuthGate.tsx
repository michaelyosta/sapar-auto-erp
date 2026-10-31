import { createContext, useContext, useEffect, useState, type FormEvent, type ReactNode } from "react";

export type AuthUser = {
  id: number;
  organization_id: number;
  login: string;
  full_name: string;
  role: "owner" | "admin" | "manager" | "employee";
  active: number;
  must_change_password: number;
};

type AuthContextValue = { user: AuthUser; logout: () => Promise<void>; changePassword: (currentPassword: string, newPassword: string) => Promise<void> };
type AuthResponse = { authenticated: boolean; user: AuthUser | null };
type SetupStatus = { needsSetup: boolean; setupTokenConfigured: boolean };

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth должен вызываться внутри AuthGate.");
  return value;
}

async function authRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? "Не удалось выполнить запрос.");
  return data as T;
}

export default function AuthGate({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [setupStatus, setSetupStatus] = useState<SetupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [serviceError, setServiceError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    Promise.all([
      authRequest<AuthResponse>("/api/auth/me"),
      authRequest<SetupStatus>("/api/auth/setup-status"),
    ]).then(([session, status]) => {
      if (!active) return;
      setUser(session.authenticated ? session.user : null);
      setSetupStatus(status);
      setServiceError("");
    }).catch((error) => {
      if (!active) return;
      setServiceError(error instanceof Error ? error.message : "Сервер учёта недоступен.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const logout = async () => {
    try { await authRequest<{ ok: boolean }>("/api/auth/logout", { method: "POST" }); }
    finally { setUser(null); setNotice("Вы вышли из системы."); }
  };
  const changePassword = async (currentPassword: string, newPassword: string) => {
    await authRequest<{ ok: boolean }>("/api/auth/password", {
      method: "POST", body: JSON.stringify({ currentPassword, newPassword }),
    });
    setUser(null);
    setNotice("Пароль изменён. Войдите с новым паролем.");
  };

  if (loading) return <div className="auth-loading">Загружаем «Учёт автосервиса»…</div>;
  if (serviceError && !setupStatus) return <AuthUnavailable message={serviceError} onRetry={() => window.location.reload()} />;
  if (!user) return <SignIn
    setupStatus={setupStatus}
    initialNotice={notice}
    onAuthenticated={(nextUser) => {
      setUser(nextUser); setNotice("");
      setSetupStatus((current) => current ? { ...current, needsSetup: false } : current);
    }}
  />;
  if (user.must_change_password) return <ChangePassword
    onDone={() => { setUser(null); setNotice("Пароль изменён. Войдите с новым паролем."); }}
  />;

  return <AuthContext.Provider value={{ user, logout, changePassword }}>{children}</AuthContext.Provider>;
}

function SignIn({ setupStatus, initialNotice, onAuthenticated }: {
  setupStatus: SetupStatus | null;
  initialNotice: string;
  onAuthenticated: (user: AuthUser) => void;
}) {
  const needsSetup = Boolean(setupStatus?.needsSetup);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const login = String(form.get("login") ?? "").trim();
    const password = String(form.get("password") ?? "");
    try {
      const result = needsSetup
        ? await authRequest<AuthResponse>("/api/auth/setup", {
            method: "POST",
            headers: { "x-setup-token": String(form.get("setupToken") ?? "") },
            body: JSON.stringify({ fullName: String(form.get("fullName") ?? "").trim(), login, password }),
          })
        : await authRequest<AuthResponse>("/api/auth/login", {
            method: "POST", body: JSON.stringify({ login, password }),
          });
      if (!result.authenticated || !result.user) throw new Error("Не удалось открыть рабочую сессию.");
      onAuthenticated(result.user);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Не удалось войти в систему.");
    } finally { setBusy(false); }
  }

  return <main className="auth-screen">
    <section className="auth-card">
      <div className="auth-brand"><span className="brand-symbol"><i /><b /><em /></span><span>Учёт автосервиса</span></div>
      <p className="auth-eyebrow">УЧЁТ ДЛЯ САЛОНОВ ЗАМЕНЫ МАСЕЛ</p>
      <h1>{needsSetup ? "Первичная настройка" : "Вход в систему"}</h1>
      <p className="auth-copy">{needsSetup ? "Создайте учётную запись владельца. После настройки можно добавлять сотрудников с разными правами." : "Войдите под своей учётной записью, чтобы продолжить работу."}</p>
      {initialNotice && <div className="auth-notice">{initialNotice}</div>}
      {needsSetup && !setupStatus?.setupTokenConfigured && <div className="auth-error">Сервер не настроен для первичного входа. Запустите его с переменной окружения SETUP_TOKEN и обновите страницу.</div>}
      <form onSubmit={(event) => void submit(event)}>
        {needsSetup && <label>Имя владельца<input name="fullName" autoComplete="name" required maxLength={120} /></label>}
        <label>Логин<input name="login" autoComplete="username" required minLength={3} maxLength={120} /></label>
        {needsSetup && <label>Токен настройки<input name="setupToken" autoComplete="off" required disabled={!setupStatus?.setupTokenConfigured} /><small className="auth-field-note">Токен выдаётся оператором сервера и используется только для создания владельца.</small></label>}
        <label>Пароль<input name="password" type="password" autoComplete={needsSetup ? "new-password" : "current-password"} required minLength={needsSetup ? 12 : 1} maxLength={256} /></label>
        {error && <div className="auth-error" role="alert">{error}</div>}
        <button className="auth-submit" type="submit" disabled={busy || (needsSetup && !setupStatus?.setupTokenConfigured)}>{busy ? "Проверяем…" : needsSetup ? "Создать владельца" : "Войти"}</button>
      </form>
      <small className="auth-footnote">Сессия хранится в защищённой cookie и завершается автоматически.</small>
    </section>
  </main>;
}

function ChangePassword({ onDone }: { onDone: () => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const currentPassword = String(form.get("currentPassword") ?? "");
    const newPassword = String(form.get("newPassword") ?? "");
    if (newPassword !== String(form.get("confirmPassword") ?? "")) {
      setError("Новые пароли не совпадают."); setBusy(false); return;
    }
    try {
      await authRequest<{ ok: boolean }>("/api/auth/password", {
        method: "POST", body: JSON.stringify({ currentPassword, newPassword }),
      });
      onDone();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Не удалось изменить пароль.");
    } finally { setBusy(false); }
  }
  return <main className="auth-screen"><section className="auth-card">
    <p className="auth-eyebrow">ЗАЩИТА УЧЁТНОЙ ЗАПИСИ</p><h1>Смените временный пароль</h1>
    <p className="auth-copy">Администратор выдал временный пароль. Придумайте личный пароль длиной от 12 символов.</p>
    <form onSubmit={(event) => void submit(event)}>
      <label>Текущий пароль<input name="currentPassword" type="password" autoComplete="current-password" required /></label>
      <label>Новый пароль<input name="newPassword" type="password" autoComplete="new-password" minLength={12} maxLength={256} required /></label>
      <label>Повторите новый пароль<input name="confirmPassword" type="password" autoComplete="new-password" minLength={12} maxLength={256} required /></label>
      {error && <div className="auth-error" role="alert">{error}</div>}
      <button className="auth-submit" type="submit" disabled={busy}>{busy ? "Сохраняем…" : "Сменить пароль"}</button>
    </form>
  </section></main>;
}

function AuthUnavailable({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <main className="auth-screen"><section className="auth-card">
    <p className="auth-eyebrow">УЧЁТ АВТОСЕРВИСА</p><h1>Нет связи с сервером</h1>
    <p className="auth-copy">{message}</p><button className="auth-submit" onClick={onRetry}>Попробовать снова</button>
  </section></main>;
}
