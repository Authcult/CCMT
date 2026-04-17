import "./globals.css";
import "xterm/css/xterm.css";
import type { ReactNode } from "react";
import { I18nProvider } from "../components/I18nProvider";

export const metadata = {
  title: "CCMT | 远程终端管理",
  description: "Secure terminal console",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <I18nProvider>
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
