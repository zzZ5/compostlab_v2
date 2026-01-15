"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Layout, Menu, Spin, Button, Space, Grid, Dropdown, Avatar, Typography, Tag } from "antd";
import {
    DashboardOutlined,
    DatabaseOutlined,
    ExperimentOutlined,
    LineChartOutlined,
    UserOutlined,
    TeamOutlined,
    AuditOutlined,
    MenuFoldOutlined,
    MenuUnfoldOutlined,
    LogoutOutlined,
    ControlOutlined,
    BellOutlined,
} from "@ant-design/icons";
import { hasBasicAuth, clearBasicAuth, hasToken, clearTokens, getUser, setUser } from "@/lib/auth";
import { useMe } from "@/features/users/queries";
import AnnouncementBanner from "@/components/AnnouncementBanner";
import AnnouncementBadge from "@/components/AnnouncementBadge";

const { Text } = Typography;

const { Header, Content, Sider } = Layout;
const { useBreakpoint } = Grid;

function getSelectedKey(pathname: string) {
    if (pathname.startsWith("/devices")) return "/devices";
    if (pathname.startsWith("/runs")) return "/runs";
    if (pathname.startsWith("/telemetry")) return "/telemetry";
    if (pathname.startsWith("/scripts")) return "/scripts";
    if (pathname.startsWith("/announcements/history")) return "/announcements/history";
    if (pathname.startsWith("/announcements")) return "/announcements";
    if (pathname.startsWith("/users")) return "/users";
    if (pathname.startsWith("/profile")) return "/profile";
    if (pathname.startsWith("/audit-logs")) return "/audit-logs";
    return "/";
}

export default function MainLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const [ready, setReady] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean>(false);

  // 使用 useMe query 获取当前用户信息
  const { data: meData, isLoading: isLoadingMe } = useMe();

  // 尝试从 sessionStorage 获取用户信息（避免频繁 API 请求）
  const sessionStorageUser = getUser();

  // 优先使用 sessionStorage 中的用户信息，如果没有则使用 API 返回的数据
  const currentUser = sessionStorageUser || meData || null;

  // 当从 API 获取到用户信息时，保存到 sessionStorage
  useEffect(() => {
    if (meData && !sessionStorageUser) {
      setUser(meData);
    }
  }, [meData, sessionStorageUser]);

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
    const ok = typeof window !== "undefined" ? (hasToken() || hasBasicAuth()) : true;
    if (!ok) {
      const next = encodeURIComponent(pathname);
      router.replace(`/login?next=${next}`);
      return;
    }
    // 设置 ready 状态（用户信息会通过 useMe query 异步获取）
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
        style={{ borderRight: "1px solid #e8e8e8" }}
      >
        <div
          style={{
            height: 56,
            display: "flex",
            alignItems: "center",
            padding: "0 20px",
            fontWeight: 600,
            fontSize: 18,
            color: "#fff",
          }}
        >
          {collapsed ? "🧪" : "🧪 CompostLab"}
        </div>

        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={[
            { key: "/", icon: <DashboardOutlined />, label: <Link href="/">仪表盘</Link> },
            { key: "/devices", icon: <DatabaseOutlined />, label: <Link href="/devices">设备</Link> },
            { key: "/scripts", icon: <ControlOutlined />, label: <Link href="/scripts">控制脚本</Link> },
            { key: "/runs", icon: <ExperimentOutlined />, label: <Link href="/runs">运行批次</Link> },
            { key: "/telemetry", icon: <LineChartOutlined />, label: <Link href="/telemetry">数据探索</Link> },
            { type: "divider" },
            { key: "/announcements/history", icon: <BellOutlined />, label: <Link href="/announcements/history">公告历史</Link> },
            ...(currentUser?.role === "admin"
              ? [
                  { key: "/announcements", icon: <BellOutlined />, label: <Link href="/announcements">公告管理</Link> },
                  { key: "/users", icon: <TeamOutlined />, label: <Link href="/users">用户管理</Link> },
                  { key: "/audit-logs", icon: <AuditOutlined />, label: <Link href="/audit-logs">操作日志</Link> },
                ]
              : []),
          ]}
        />
      </Sider>

      <Layout>
        <Header
          style={{
            background: "#fff",
            borderBottom: "1px solid #e8e8e8",
            padding: isMobile ? "0 16px" : "0 24px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            height: 56,
          }}
        >
          <Button
            type="text"
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={onToggleCollapsed}
          />

          <Space size="middle">
            <AnnouncementBadge />
            {currentUser && (
              <>
                {!isMobile && (
                  <Space size="small">
                    <Text type="secondary" style={{ fontSize: 13 }}>
                      {currentUser.real_name || currentUser.username}
                    </Text>
                    {currentUser.role && (
                      <Tag
                        color={
                          currentUser.role === "admin"
                            ? "red"
                            : currentUser.role === "operator"
                            ? "blue"
                            : "default"
                        }
                      >
                        {currentUser.role_display || currentUser.role}
                      </Tag>
                    )}
                  </Space>
                )}
              </>
            )}

            <Dropdown
              menu={{
                items: [
                  {
                    key: "profile",
                    icon: <UserOutlined />,
                    label: "个人中心",
                    onClick: () => router.push("/profile"),
                  },
                  { type: "divider" },
                  {
                    key: "logout",
                    icon: <LogoutOutlined />,
                    label: "退出登录",
                    danger: true,
                    onClick: () => {
                      clearTokens();
                      clearBasicAuth();
                      router.replace("/login");
                    },
                  },
                ],
              }}
              trigger={["click"]}
            >
              <Avatar icon={<UserOutlined />} style={{ cursor: "pointer" }} />
            </Dropdown>
          </Space>
        </Header>

        <Content style={{ padding: isMobile ? 16 : 24 }}>
          <div style={{ maxWidth: 1400, margin: "0 auto" }}>
            <AnnouncementBanner />
            {children}
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}
