"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Language = "en" | "zh";

type Translations = {
  [key: string]: string;
};

const translations: Record<Language, Translations> = {
  en: {
    // Global & Header
    "app.title": "CCMT Remote",
    "app.subtitle": "Secure Terminal Control Console",
    "btn.continue": "Continue",
    "btn.back": "Back",
    "btn.cancel": "Cancel & Return",
    "btn.logout": "Logout",
    "btn.initSystem": "Factory Reset",
    "status.loading": "Processing...",

    // Errors
    "err.invalid_credentials": "Username or password incorrect.",
    "err.totp_mismatch": "Invalid TOTP code, please try again.",
    "err.challenge_expired": "Login challenge expired, please log in again.",
    "err.challenge_not_found": "Login challenge not found, please log in again.",
    "err.invalid_body": "Invalid input format, please check and try again.",
    "err.owner_exists": "System is already initialized, please log in directly.",
    "err.username_taken": "Username is already taken, please choose another.",
    "err.unauthorized": "Session invalid, please log in again.",
    "err.forbidden_not_owner": "Only owners can factory reset the system.",
    "err.load_failed": "Failed to load data.",
    "err.login_failed": "Login failed.",
    "err.verify_failed": "Verification failed.",
    "err.init_failed": "System reset failed.",
    "err.create_session_failed": "Failed to create terminal session.",
    "err.bootstrap_required": "System requires initialization. Please create the first owner account and bind TOTP.",

    // Login: Credentials
    "login.title": "Authentication",
    "login.badge": "2FA Required",
    "login.username": "Username",
    "login.password": "Password",
    "login.deviceLabel": "Device Label",
    "login.devicePlaceholder": "e.g., iPhone-15",
    "login.authenticating": "Authenticating...",
    "login.firstTimeSetup": "First Time Setup: Initialize Owner",

    // Login: TOTP
    "totp.title": "Enter your 6-digit TOTP code",
    "totp.challengeValidUntil": "Challenge valid until",
    "totp.verifyAndLogin": "Verify & Login",
    "totp.verifying": "Verifying...",

    // Bootstrap
    "boot.title": "Set Up System",
    "boot.badge": "Setup",
    "boot.desc": "System requires initialization. Create the first administrative owner account and bind TOTP for 2FA.",
    "boot.ownerUsername": "Owner Username (min 3 chars)",
    "boot.ownerPassword": "Owner Password (min 8 chars)",
    "boot.confirmPassword": "Confirm Password",
    "boot.createBtn": "Create Owner & Generate TOTP",
    "boot.initializing": "Initializing...",
    "boot.success.created": "Owner account created:",
    "boot.success.saveTotp": "Please save your TOTP secret immediately.",
    "boot.totpSecret": "TOTP Secret",
    "boot.authenticatorUri": "Authenticator URI",
    "boot.openAuthenticator": "Open in Authenticator App",
    "boot.setupCompleteBtn": "Setup Complete - Return to Login",
    "boot.done.message": "Owner creation complete. Please log in using the TOTP code from your authenticator app.",

    // Dashboard
    "dash.title": "Targets",
    "dash.role.owner": "Owner",
    "dash.role.viewer": "Viewer",
    "dash.devices": "Devices",
    "dash.empty.title": "No Targets Online",
    "dash.empty.desc": "Start a host-agent on your target machine to connect.",
    "dash.btn.openTerminal": "Open Terminal",
    "dash.init.success": "System reset complete. Create a new owner account and bind TOTP.",
    "dash.init.already": "",

    // Terminal
    "term.backLink": "Dashboard",
    "term.ctrlC": "Ctrl+C",
    "term.reconnect": "Reconnect",
    "term.state.ready": "Ready",
    "term.state.connecting": "Connecting",
    "term.state.disconnected": "Disconnected",
    "term.sessionPrefix": "CCMT Session:",
  },
  zh: {
    // Global & Header
    "app.title": "CCMT 远程控制台",
    "app.subtitle": "安全的远程终端管理系统",
    "btn.continue": "继续",
    "btn.back": "返回上一步",
    "btn.cancel": "取消并返回",
    "btn.logout": "退出登录",
    "btn.initSystem": "恢复出厂设置",
    "status.loading": "处理中...",

    // Errors
    "err.invalid_credentials": "用户名或密码错误。",
    "err.totp_mismatch": "TOTP 动态码错误，请重试。",
    "err.challenge_expired": "验证挑战已过期，请重新登录。",
    "err.challenge_not_found": "验证挑战不存在，请重新登录。",
    "err.invalid_body": "输入格式不正确，请检查后重试。",
    "err.owner_exists": "系统已初始化，请直接登录。",
    "err.username_taken": "用户名已被占用，请更换后重试。",
    "err.unauthorized": "登录状态无效，请重新登录。",
    "err.forbidden_not_owner": "只有管理员可以执行恢复出厂设置操作。",
    "err.load_failed": "加载失败。",
    "err.login_failed": "登录失败。",
    "err.verify_failed": "验证失败。",
    "err.init_failed": "系统重置失败。",
    "err.create_session_failed": "创建终端会话失败。",
    "err.bootstrap_required": "系统尚未初始化，请先创建管理员账号并绑定 TOTP。",

    // Login: Credentials
    "login.title": "身份验证",
    "login.badge": "双因子",
    "login.username": "用户名",
    "login.password": "密码",
    "login.deviceLabel": "设备标签",
    "login.devicePlaceholder": "例如：iPhone-15",
    "login.authenticating": "验证中...",
    "login.firstTimeSetup": "首次部署：初始化管理员",

    // Login: TOTP
    "totp.title": "请输入身份验证器中的 6 位 TOTP 动态码。",
    "totp.challengeValidUntil": "挑战有效至",
    "totp.verifyAndLogin": "验证并登录",
    "totp.verifying": "验证中...",

    // Bootstrap
    "boot.title": "系统设置",
    "boot.badge": "初始化",
    "boot.desc": "系统尚未初始化。请创建首个管理员账号并完成 TOTP 绑定。",
    "boot.ownerUsername": "管理员用户名（至少 3 位）",
    "boot.ownerPassword": "管理员密码（至少 8 位）",
    "boot.confirmPassword": "确认密码",
    "boot.createBtn": "创建管理员并生成 TOTP",
    "boot.initializing": "初始化中...",
    "boot.success.created": "管理员账号已创建：",
    "boot.success.saveTotp": "请立即保存下方密钥或扫码。",
    "boot.totpSecret": "TOTP Secret",
    "boot.authenticatorUri": "otpauth URI",
    "boot.openAuthenticator": "打开身份验证器链接",
    "boot.setupCompleteBtn": "我已完成绑定，返回登录",
    "boot.done.message": "管理员创建完成，请使用身份验证器中的 TOTP 动态码登录。",

    // Dashboard
    "dash.title": "可控终端",
    "dash.role.owner": "管理员",
    "dash.role.viewer": "只读",
    "dash.devices": "可信设备",
    "dash.empty.title": "暂无在线终端",
    "dash.empty.desc": "请先在目标机器启动 host-agent。",
    "dash.btn.openTerminal": "打开终端",
    "dash.init.success": "系统已重置，请重新创建管理员并绑定 TOTP。",
    "dash.init.already": "",

    // Terminal
    "term.backLink": "会话列表",
    "term.ctrlC": "强退",
    "term.reconnect": "重连",
    "term.state.ready": "已连接",
    "term.state.connecting": "连接中",
    "term.state.disconnected": "已断开",
    "term.sessionPrefix": "当前会话:",
  },
};

type I18nContextType = {
  lang: Language;
  setLang: (lang: Language) => void;
  t: (key: string) => string;
};

const I18nContext = createContext<I18nContextType | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>("en");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem("ccmt_lang") as Language;
    if (saved && (saved === "en" || saved === "zh")) {
      setLangState(saved);
    } else {
      const isZh = window.navigator.language.startsWith("zh");
      setLangState(isZh ? "zh" : "en");
    }
    setMounted(true);
  }, []);

  const setLang = (newLang: Language) => {
    setLangState(newLang);
    window.localStorage.setItem("ccmt_lang", newLang);
  };

  const t = (key: string): string => {
    return translations[lang][key] ?? key;
  };

  if (!mounted) {
    return null;
  }

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within I18nProvider");
  }
  return ctx;
}
