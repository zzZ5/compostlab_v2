import "./globals.css";
import { ReactNode } from "react";
import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import Providers from "./providers";

export const metadata = {
  title: "CompostLab",
  description: "CompostLab Dashboard",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh">
      <body>
        <ConfigProvider locale={zhCN}>
          <Providers>{children}</Providers>
        </ConfigProvider>
      </body>
    </html>
  );
}
