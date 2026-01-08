"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Layout, Menu, Spin, Button, Space, Grid } from "antd";
import {
  DashboardOutlined,
  DatabaseOutlined,
  ExperimentOutlined,
  LineChartOutlined,
} from "@ant-design/icons";
import { hasBasicAuth, clearBasicAuth } from "@/lib/auth";

const { Header, Content, Sider } = Layout;
const { useBreakpoint } = Grid;

function getSelectedKey(pathname: string) {
  if (pathname.startsWith("/devices")) return "/devices";
  if (pathname.startsWith("/runs")) return "/runs";
  if (pathname.startsWith("/telemetry")) return "/telemetry";
  return "/";
}

export default function MainLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const [ready, setReady] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean>(false);

  const selectedKey = useMemo(() => getSelectedKey(pathname), [pathname]);

  // 初始化折叠状态（桌面端记忆；移动端默认折叠）
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isMobile) {
      setCollapsed(true);
      return;
    }
    const v = window.localStorage.getItem("compostlab:siderCollapsed");
    if (v === "1") setCollapsed(true);
  }, [isMobile]);

  useEffect(() => {
    const ok = typeof window !== "undefined" ? hasBasicAuth() : true;
    if (!ok) {
      const next = encodeURIComponent(pathname);
      router.replace(`/login?next=${next}`);
      return;
    }
    setReady(true);
  }, [pathname, router]);

  function onToggleCollapsed() {
    setCollapsed((c) => {
      const next = !c;
      if (typeof window !== "undefined" && !isMobile) {
        window.localStorage.setItem("compostlab:siderCollapsed", next ? "1" : "0");
      }
      return next;
    });
  }

  if (!ready) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
        <Spin />
      </div>
    );
  }

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={(v) => {
          setCollapsed(v);
          if (typeof window !== "undefined" && !isMobile) {
            window.localStorage.setItem("compostlab:siderCollapsed", v ? "1" : "0");
          }
        }}
        breakpoint="md"
        collapsedWidth={isMobile ? 0 : 80}
        style={{ borderRight: "1px solid rgba(0,0,0,0.06)" }}
      >
        <div
          style={{
            height: 56,
            display: "flex",
            alignItems: "center",
            padding: "0 16px",
            fontWeight: 700,
            letterSpacing: 0.2,
            color: "#fff",
          }}
        >
          {collapsed ? "CL" : "CompostLab"}
        </div>

        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={[
            { key: "/", icon: <DashboardOutlined />, label: <Link href="/">仪表盘</Link> },
            { key: "/devices", icon: <DatabaseOutlined />, label: <Link href="/devices">设备</Link> },
            { key: "/runs", icon: <ExperimentOutlined />, label: <Link href="/runs">运行批次</Link> },
            { key: "/telemetry", icon: <LineChartOutlined />, label: <Link href="/telemetry">数据探索</Link> },
          ]}
        />
      </Sider>

      <Layout>
        <Header
          style={{
            background: "#fff",
            borderBottom: "1px solid rgba(0,0,0,0.06)",
            padding: "0 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <Space>
            <Button onClick={onToggleCollapsed}>{collapsed ? "展开菜单" : "收起菜单"}</Button>
          </Space>

          <Space>
            <Button
              onClick={() => {
                clearBasicAuth();
                router.replace("/login");
              }}
            >
              退出登录
            </Button>
          </Space>
        </Header>

        <Content style={{ padding: 24 }}>
          <div style={{ maxWidth: 1400, margin: "0 auto" }}>{children}</div>
        </Content>
      </Layout>
    </Layout>
  );
}
