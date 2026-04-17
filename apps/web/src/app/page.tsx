"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Server, LogIn, Lock, Smartphone, ShieldCheck, UserPlus, LogOut, Terminal, TerminalSquare, AlertCircle, CheckCircle2, Globe } from "lucide-react";
import {
  beginLogin,
  bootstrapOwner,
  createOrReuseSession,
  fetchDevices,
  fetchMe,
  fetchTargets,
  initializeSystem,
  refreshToken,
  verifyLogin,
  type TargetItem,
  type TotpProvisioning,
} from "../lib/relaySocket";
import { clearAuthTokens, getAccessToken, getRefreshToken, hasAccessToken, setAuthTokens } from "../lib/auth";
import { useI18n, type Language } from "../components/I18nProvider";

type LoginStage = "credentials" | "totp" | "bootstrap";

type LoginState = {
  challengeId: string;
  expiresAt: number;
};

type BootstrapProvisioningState = {
  username: string;
  totp: TotpProvisioning;
};

function toUserMessage(error: unknown, fallback: string, t: (key: string) => string): string {
  if (!(error instanceof Error)) {
    return fallback;
  }

  switch (error.message) {
    case "invalid_credentials":
      return t("err.invalid_credentials");
    case "totp_mismatch":
      return t("err.totp_mismatch");
    case "challenge_expired":
      return t("err.challenge_expired");
    case "challenge_not_found":
      return t("err.challenge_not_found");
    case "invalid_body":
      return t("err.invalid_body");
    case "owner_exists":
      return t("err.owner_exists");
    case "username_taken":
      return t("err.username_taken");
    case "unauthorized":
      return t("err.unauthorized");
    case "forbidden_not_owner":
      return t("err.forbidden_not_owner");
    case "bootstrap_required":
      return t("err.bootstrap_required");
    default:
      return error.message || fallback;
  }
}

export default function HomePage() {
  const { lang, setLang, t } = useI18n();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [deviceLabel, setDeviceLabel] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [loginStage, setLoginStage] = useState<LoginStage>("credentials");
  const [loginState, setLoginState] = useState<LoginState | null>(null);
  const [bootstrapUsername, setBootstrapUsername] = useState("");
  const [bootstrapPassword, setBootstrapPassword] = useState("");
  const [bootstrapPasswordConfirm, setBootstrapPasswordConfirm] = useState("");
  const [bootstrapProvisioning, setBootstrapProvisioning] = useState<BootstrapProvisioningState | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [targets, setTargets] = useState<TargetItem[]>([]);
  const [isAuthed, setIsAuthed] = useState(false);
  const [userSub, setUserSub] = useState<string>("");
  const [userRole, setUserRole] = useState<"owner" | "viewer" | null>(null);
  const [deviceCount, setDeviceCount] = useState(0);
  const [statusText, setStatusText] = useState<string | null>(null);

  const canSubmitCredentials = useMemo(() => {
    return username.trim().length > 0 && password.trim().length > 0 && deviceLabel.trim().length > 0;
  }, [username, password, deviceLabel]);

  const canSubmitBootstrap = useMemo(() => {
    return bootstrapUsername.trim().length >= 3 && bootstrapPassword.length >= 8 && bootstrapPasswordConfirm === bootstrapPassword;
  }, [bootstrapPassword, bootstrapPasswordConfirm, bootstrapUsername]);

  const loadAuthedData = useCallback(async () => {
    let accessToken = getAccessToken();
    if (!accessToken) {
      setIsAuthed(false);
      setTargets([]);
      setUserRole(null);
      return;
    }

    try {
      const [me, targetResult, deviceResult] = await Promise.all([fetchMe(accessToken), fetchTargets(accessToken), fetchDevices(accessToken)]);
      setUserSub(me.user.sub);
      setUserRole(me.user.role);
      setTargets(targetResult.targets);
      setDeviceCount(deviceResult.devices.length);
      setIsAuthed(true);
    } catch (error) {
      if (error instanceof Error && error.message === "unauthorized") {
        const refresh = getRefreshToken();
        if (refresh) {
          try {
            const tokens = await refreshToken(refresh);
            setAuthTokens(tokens.accessToken, tokens.refreshToken);
            accessToken = tokens.accessToken;

            const [me, targetResult, deviceResult] = await Promise.all([fetchMe(accessToken), fetchTargets(accessToken), fetchDevices(accessToken)]);
            setUserSub(me.user.sub);
            setUserRole(me.user.role);
            setTargets(targetResult.targets);
            setDeviceCount(deviceResult.devices.length);
            setIsAuthed(true);
            return;
          } catch {
            // refresh failed, clear and fall through
          }
        }
      }
      throw error;
    }
  }, []);

  useEffect(() => {
    if (!hasAccessToken() && !getRefreshToken()) {
      return;
    }

    loadAuthedData().catch((error: unknown) => {
      clearAuthTokens();
      setIsAuthed(false);
      setTargets([]);
      setUserRole(null);
      setErrorText(toUserMessage(error, t("err.load_failed"), t));
    });
  }, [loadAuthedData, t]);

  const handleBeginLogin = useCallback(async () => {
    if (!canSubmitCredentials) {
      return;
    }

    setLoading(true);
    setErrorText(null);
    setStatusText(null);

    try {
      const result = await beginLogin({
        username,
        password,
        deviceLabel,
      });

      setLoginState({
        challengeId: result.challengeId,
        expiresAt: result.expiresAt,
      });
      setTotpCode("");
      setLoginStage("totp");
    } catch (error: unknown) {
      if (error instanceof Error && error.message === "bootstrap_required") {
        setLoginStage("bootstrap");
        setLoginState(null);
        setTotpCode("");
        setBootstrapProvisioning(null);
        setBootstrapUsername((current) => current || username.trim());
        setBootstrapPassword((current) => current || password);
        setBootstrapPasswordConfirm((current) => current || password);
        setErrorText(t("err.bootstrap_required"));
      } else {
        setErrorText(toUserMessage(error, t("err.login_failed"), t));
      }
    } finally {
      setLoading(false);
    }
  }, [canSubmitCredentials, deviceLabel, password, username, t]);

  const handleVerifyTotp = useCallback(async () => {
    if (!loginState || totpCode.length !== 6) {
      return;
    }

    setLoading(true);
    setErrorText(null);
    setStatusText(null);

    try {
      const tokens = await verifyLogin({
        challengeId: loginState.challengeId,
        totpCode,
      });

      setAuthTokens(tokens.accessToken, tokens.refreshToken);
      setTotpCode("");
      setLoginStage("credentials");
      setLoginState(null);
      await loadAuthedData();
    } catch (error: unknown) {
      setErrorText(toUserMessage(error, t("err.verify_failed"), t));
    } finally {
      setLoading(false);
    }
  }, [loadAuthedData, loginState, totpCode, t]);

  const handleBootstrapOwner = useCallback(async () => {
    if (!canSubmitBootstrap) {
      return;
    }

    setLoading(true);
    setErrorText(null);
    setStatusText(null);

    try {
      const result = await bootstrapOwner({
        username: bootstrapUsername.trim(),
        password: bootstrapPassword,
      });

      setBootstrapProvisioning({
        username: result.user.username,
        totp: result.totp,
      });
      setUsername(result.user.username);
      setPassword(bootstrapPassword);
      setDeviceLabel((current) => current || "mobile-web");
    } catch (error: unknown) {
      setErrorText(toUserMessage(error, t("err.init_failed"), t));
    } finally {
      setLoading(false);
    }
  }, [bootstrapPassword, bootstrapUsername, canSubmitBootstrap, t]);

  const handleBootstrapCompleted = useCallback(() => {
    setBootstrapProvisioning(null);
    setBootstrapPasswordConfirm("");
    setLoginStage("credentials");
    setStatusText(t("boot.done.message"));
    setErrorText(null);
  }, [t]);

  const handleLogout = useCallback(() => {
    clearAuthTokens();
    setIsAuthed(false);
    setTargets([]);
    setUserSub("");
    setUserRole(null);
    setDeviceCount(0);
    setLoginStage("credentials");
    setLoginState(null);
    setTotpCode("");
    setErrorText(null);
    setStatusText(null);
  }, []);

  const handleInitializeSystem = useCallback(async () => {
    if (userRole !== "owner") {
      setErrorText(t("err.forbidden_not_owner"));
      setStatusText(null);
      return;
    }

    const accessToken = getAccessToken();
    if (!accessToken) {
      setErrorText(t("err.unauthorized"));
      return;
    }

    setLoading(true);
    setErrorText(null);
    setStatusText(null);

    try {
      const result = await initializeSystem(accessToken);
      setStatusText(result.status === "initialized" ? t("dash.init.success") : t("dash.init.already"));
      await loadAuthedData();
    } catch (error: unknown) {
      setErrorText(toUserMessage(error, t("err.init_failed"), t));
    } finally {
      setLoading(false);
    }
  }, [loadAuthedData, userRole, t]);

  const handleOpenSession = useCallback(async (targetId: string) => {
    const accessToken = getAccessToken();
    if (!accessToken) {
      setErrorText(t("err.unauthorized"));
      return;
    }

    setLoading(true);
    setErrorText(null);
    setStatusText(null);

    try {
      const result = await createOrReuseSession(accessToken, targetId);
      const target = encodeURIComponent(result.session.targetId);
      const ticket = encodeURIComponent(result.wsTicket);
      const href = `/terminal/${result.session.id}?targetId=${target}&ticket=${ticket}`;
      window.location.href = href;
    } catch (error: unknown) {
      setErrorText(toUserMessage(error, t("err.create_session_failed"), t));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const toggleLang = () => {
    setLang(lang === "en" ? "zh" : "en");
  };

  return (
    <main className="min-h-screen bg-slate-950 flex flex-col items-center p-4 sm:p-8">
      <div className="w-full max-w-3xl flex flex-col gap-6">

        {/* Header */}
        <header className="flex items-center justify-between gap-3 bg-slate-900/60 border border-slate-800 p-5 sm:px-6 rounded-2xl shadow-xl backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600/20 p-2.5 rounded-xl border border-blue-500/30 text-blue-400">
              <TerminalSquare size={26} strokeWidth={2} />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-slate-100 tracking-tight leading-none mb-1">{t("app.title")}</h1>
              <p className="text-sm text-slate-400 font-medium tracking-wide">{t("app.subtitle")}</p>
            </div>
          </div>

          <button
            onClick={toggleLang}
            className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-sm text-slate-300 transition-colors"
          >
            <Globe size={16} />
            <span className="font-semibold">{lang === "en" ? "中" : "EN"}</span>
          </button>
        </header>

        {/* Global Notifications */}
        {statusText && (
          <div className="flex gap-3 items-center bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 p-4 rounded-xl shadow-lg">
            <CheckCircle2 className="flex-shrink-0" size={20} />
            <p className="text-sm font-medium">{statusText}</p>
          </div>
        )}
        {errorText && (
          <div className="flex gap-3 items-center bg-rose-500/10 border border-rose-500/30 text-rose-300 p-4 rounded-xl shadow-lg">
            <AlertCircle className="flex-shrink-0" size={20} />
            <p className="text-sm font-medium">{errorText}</p>
          </div>
        )}

        {!isAuthed ? (
          /* Authentication Section */
          <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 right-0 p-8 opacity-5 pointer-events-none">
              <ShieldCheck size={180} />
            </div>

            <div className="flex justify-between items-center mb-8 relative z-10">
              <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
                {loginStage === "bootstrap" ? <UserPlus size={20} className="text-blue-400" /> : <Lock size={20} className="text-blue-400" />}
                {loginStage === "bootstrap" ? t("boot.title") : t("login.title")}
              </h2>
              <span className="px-3 py-1 bg-slate-800 border border-slate-700 text-slate-300 text-xs font-semibold rounded-full uppercase tracking-wider">
                {loginStage === "bootstrap" ? t("boot.badge") : t("login.badge")}
              </span>
            </div>

            {loginStage === "credentials" && (
              <div className="flex flex-col gap-5 relative z-10">
                <label className="flex flex-col gap-2">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider ml-1">{t("login.username")}</span>
                  <div className="relative">
                    <LogIn className="absolute left-3.5 top-3.5 text-slate-500" size={18} />
                    <input
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl py-3 pl-11 pr-4 text-slate-200 transition-colors outline-none"
                      autoComplete="username"
                      placeholder="admin"
                    />
                  </div>
                </label>
                <label className="flex flex-col gap-2">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider ml-1">{t("login.password")}</span>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-3.5 text-slate-500" size={18} />
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl py-3 pl-11 pr-4 text-slate-200 transition-colors outline-none"
                      autoComplete="current-password"
                      placeholder="••••••••"
                    />
                  </div>
                </label>
                <label className="flex flex-col gap-2">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider ml-1">{t("login.deviceLabel")}</span>
                  <div className="relative">
                    <Smartphone className="absolute left-3.5 top-3.5 text-slate-500" size={18} />
                    <input
                      value={deviceLabel}
                      onChange={(e) => setDeviceLabel(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl py-3 pl-11 pr-4 text-slate-200 transition-colors outline-none"
                      placeholder={t("login.devicePlaceholder")}
                      autoComplete="off"
                    />
                  </div>
                </label>

                <div className="flex flex-col gap-3 mt-4">
                  <button
                    disabled={!canSubmitCredentials || loading}
                    onClick={handleBeginLogin}
                    className="w-full py-3.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:hover:bg-blue-600 text-white font-semibold rounded-xl transition-colors shadow-lg shadow-blue-900/20"
                  >
                    {loading ? t("login.authenticating") : t("btn.continue")}
                  </button>
                  <button
                    disabled={loading}
                    onClick={() => {
                      setBootstrapProvisioning(null);
                      setLoginStage("bootstrap");
                      setBootstrapUsername((current) => current || username.trim());
                      setBootstrapPassword((current) => current || password);
                      setBootstrapPasswordConfirm((current) => current || password);
                      setErrorText(null);
                      setStatusText(null);
                    }}
                    className="w-full py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium rounded-xl transition-colors"
                  >
                    {t("login.firstTimeSetup")}
                  </button>
                </div>
              </div>
            )}

            {loginStage === "totp" && (
              <div className="flex flex-col gap-6 relative z-10 text-center items-center">
                <div className="bg-slate-800/50 p-4 rounded-2xl w-full border border-slate-700/50">
                  <p className="text-slate-300 font-medium mb-1">{t("totp.title")}</p>
                  {loginState && (
                    <p className="text-xs text-slate-500">
                      {t("totp.challengeValidUntil")} {new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(loginState.expiresAt))}
                    </p>
                  )}
                </div>

                <input
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  className="w-48 text-center text-3xl tracking-[0.25em] font-mono bg-slate-950 border-2 border-slate-800 focus:border-blue-500 rounded-xl py-4 text-slate-100 transition-colors outline-none"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="000000"
                  autoComplete="one-time-code"
                />

                <div className="w-full flex flex-col gap-3 mt-2">
                  <button
                    disabled={totpCode.length !== 6 || loading}
                    onClick={handleVerifyTotp}
                    className="w-full py-3.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:hover:bg-blue-600 text-white font-semibold rounded-xl transition-colors shadow-lg"
                  >
                    {loading ? t("totp.verifying") : t("totp.verifyAndLogin")}
                  </button>
                  <button
                    onClick={() => {
                      setLoginStage("credentials");
                      setLoginState(null);
                      setTotpCode("");
                      setErrorText(null);
                      setStatusText(null);
                    }}
                    className="w-full py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium rounded-xl transition-colors"
                  >
                    {t("btn.back")}
                  </button>
                </div>
              </div>
            )}

            {loginStage === "bootstrap" && (
              bootstrapProvisioning ? (
                <div className="flex flex-col gap-5 relative z-10">
                  <div className="bg-emerald-500/10 border border-emerald-500/20 p-4 rounded-xl mb-2">
                    <p className="text-emerald-400 font-medium">{t("boot.success.created")} <span className="text-emerald-300 font-bold">{bootstrapProvisioning.username}</span></p>
                    <p className="text-emerald-500/80 text-sm mt-1">{t("boot.success.saveTotp")}</p>
                  </div>

                  <div className="flex flex-col gap-2">
                    <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider ml-1">{t("boot.totpSecret")}</span>
                    <code className="bg-slate-950 border border-slate-800 p-4 rounded-xl text-center text-xl font-mono text-blue-400 select-all tracking-widest">
                      {bootstrapProvisioning.totp.secret}
                    </code>
                  </div>

                  <div className="flex flex-col gap-2 mt-2">
                    <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider ml-1">{t("boot.authenticatorUri")}</span>
                    <textarea
                      readOnly
                      value={bootstrapProvisioning.totp.otpauthUrl}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-slate-400 text-xs font-mono min-h-[80px] resize-none outline-none break-all"
                    />
                  </div>

                  <div className="flex flex-col gap-3 mt-4">
                    <a
                      href={bootstrapProvisioning.totp.otpauthUrl}
                      className="w-full py-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-center font-medium rounded-xl transition-colors"
                    >
                      {t("boot.openAuthenticator")}
                    </a>
                    <button
                      disabled={loading}
                      onClick={handleBootstrapCompleted}
                      className="w-full py-3.5 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl transition-colors shadow-lg"
                    >
                      {t("boot.setupCompleteBtn")}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-5 relative z-10">
                  <p className="text-sm text-slate-400 bg-slate-900 border border-slate-800 p-4 rounded-xl">
                    {t("boot.desc")}
                  </p>

                  <label className="flex flex-col gap-2">
                    <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider ml-1">{t("boot.ownerUsername")}</span>
                    <input
                      value={bootstrapUsername}
                      onChange={(e) => setBootstrapUsername(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl py-3 px-4 text-slate-200 transition-colors outline-none"
                      autoComplete="username"
                    />
                  </label>
                  <label className="flex flex-col gap-2">
                    <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider ml-1">{t("boot.ownerPassword")}</span>
                    <input
                      type="password"
                      value={bootstrapPassword}
                      onChange={(e) => setBootstrapPassword(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl py-3 px-4 text-slate-200 transition-colors outline-none"
                      autoComplete="new-password"
                    />
                  </label>
                  <label className="flex flex-col gap-2">
                    <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider ml-1">{t("boot.confirmPassword")}</span>
                    <input
                      type="password"
                      value={bootstrapPasswordConfirm}
                      onChange={(e) => setBootstrapPasswordConfirm(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 focus:border-rose-500 focus:ring-1 focus:ring-rose-500 rounded-xl py-3 px-4 text-slate-200 transition-colors outline-none"
                      autoComplete="new-password"
                    />
                  </label>

                  <div className="flex flex-col gap-3 mt-4">
                    <button
                      disabled={!canSubmitBootstrap || loading}
                      onClick={handleBootstrapOwner}
                      className="w-full py-3.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold rounded-xl transition-colors shadow-lg"
                    >
                      {loading ? t("boot.initializing") : t("boot.createBtn")}
                    </button>
                    <button
                      disabled={loading}
                      onClick={() => {
                        setLoginStage("credentials");
                        setBootstrapProvisioning(null);
                        setErrorText(null);
                        setStatusText(null);
                      }}
                      className="w-full py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium rounded-xl transition-colors"
                    >
                      {t("btn.cancel")}
                    </button>
                  </div>
                </div>
              )
            )}
          </section>
        ) : (
          /* Dashboard Section */
          <section className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col">

            {/* Dashboard Header */}
            <div className="p-6 sm:p-8 border-b border-slate-800 bg-slate-900/50 flex flex-col sm:flex-row gap-6 justify-between sm:items-center">
              <div>
                <h2 className="text-2xl font-bold text-slate-100 flex items-center gap-2 mb-2">
                  <Server className="text-blue-500" /> {t("dash.title")}
                </h2>
                <div className="flex flex-wrap gap-2 text-xs font-medium">
                  <span className="bg-slate-800 border border-slate-700 text-slate-300 px-2.5 py-1 rounded-md flex items-center gap-1.5"><UserPlus size={12} /> {userSub}</span>
                  <span className={`border px-2.5 py-1 rounded-md flex items-center gap-1.5 ${userRole === "owner" ? "bg-amber-500/10 border-amber-500/20 text-amber-400" : "bg-slate-800 border-slate-700 text-slate-400"}`}>
                    <ShieldCheck size={12} /> {userRole === "owner" ? t("dash.role.owner") : t("dash.role.viewer")}
                  </span>
                  <span className="bg-slate-800 border border-slate-700 text-slate-300 px-2.5 py-1 rounded-md flex items-center gap-1.5"><Smartphone size={12} /> {deviceCount} {t("dash.devices")}</span>
                </div>
              </div>

              <div className="flex gap-3">
                {userRole === "owner" && (
                  <button
                    onClick={handleInitializeSystem}
                    disabled={loading}
                    className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-medium rounded-xl transition-colors disabled:opacity-50"
                  >
                    <Server size={16} /> {t("btn.initSystem")}
                  </button>
                )}
                <button
                  onClick={handleLogout}
                  disabled={loading}
                  className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 text-rose-400 font-medium rounded-xl transition-colors"
                >
                  <LogOut size={16} /> {t("btn.logout")}
                </button>
              </div>
            </div>

            {/* Target List */}
            <div className="p-6 sm:p-8 bg-slate-950/30">
              {targets.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 px-4 text-center border-2 border-dashed border-slate-800/60 rounded-2xl bg-slate-900/30">
                  <Terminal className="text-slate-700 mb-4" size={48} strokeWidth={1} />
                  <h3 className="text-lg font-medium text-slate-300 mb-1">{t("dash.empty.title")}</h3>
                  <p className="text-sm text-slate-500 max-w-sm">{t("dash.empty.desc")}</p>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-2">
                  {targets.map((target) => (
                    <div key={target.id} className="group bg-slate-900 border border-slate-800 hover:border-blue-500/50 rounded-2xl p-5 transition-all shadow-md hover:shadow-blue-900/10 flex flex-col justify-between">
                      <div className="mb-6">
                        <div className="flex items-start justify-between mb-3">
                          <h3 className="text-lg font-bold text-slate-200 truncate pr-2" title={target.id}>{target.id}</h3>
                          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)] shrink-0 mt-2"></span>
                        </div>
                        <div className="text-xs text-slate-500 flex items-center gap-1.5 bg-slate-950 inline-flex px-2.5 py-1 rounded-md border border-slate-800">
                          <TerminalSquare size={12} /> {target.agentId}
                        </div>
                      </div>

                      <button
                        onClick={() => handleOpenSession(target.id)}
                        disabled={loading}
                        className="w-full py-2.5 bg-blue-600/10 hover:bg-blue-600/20 text-blue-400 group-hover:text-blue-300 font-medium rounded-xl border border-blue-500/20 group-hover:border-blue-500/40 transition-colors flex items-center justify-center gap-2"
                      >
                        <Terminal size={16} /> {t("dash.btn.openTerminal")}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

      </div>
    </main>
  );
}
