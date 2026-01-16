"use client";

import React from "react";
import { Menu, Typography, Space, Card, Divider } from "antd";
import {
  DashboardOutlined,
  DatabaseOutlined,
  ExperimentOutlined,
  LineChartOutlined,
  UserOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import AnimatedSidebar from "./AnimatedSidebar";

const { Text } = Typography;

function SidebarContent() {
  return (
    <>
      {/* Logo区域 */}
      <div
        style={{
          height: 56,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderBottom: "1px solid rgba(255, 255, 255, 0.12)",
        }}
      >
        <Text strong style={{ color: "#fff", fontSize: 18 }}>
          Logo
        </Text>
      </div>

      {/* 菜单 */}
      <Menu
        theme="dark"
        mode="inline"
        defaultSelectedKeys={["1"]}
        items={[
          {
            key: "1",
            icon: <DashboardOutlined />,
            label: "仪表盘",
          },
          {
            key: "2",
            icon: <DatabaseOutlined />,
            label: "设备管理",
          },
          {
            key: "3",
            icon: <ExperimentOutlined />,
            label: "运行批次",
          },
          {
            key: "4",
            icon: <LineChartOutlined />,
            label: "数据探索",
          },
          {
            type: "divider",
          },
          {
            key: "5",
            icon: <UserOutlined />,
            label: "个人中心",
          },
          {
            key: "6",
            icon: <TeamOutlined />,
            label: "用户管理",
          },
        ]}
      />
    </>
  );
}

function MainContent() {
  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Card title="欢迎使用动画侧边栏" bordered={false}>
        <Text>
          这是一个具有流畅动画效果的侧边栏组件，支持以下特性：
        </Text>
        <ul style={{ marginTop: 16, paddingLeft: 20 }}>
          <li>平滑的展开/收起动画</li>
          <li>响应式设计，适配移动端</li>
          <li>支持手势滑动操作</li>
          <li>优雅的遮罩层效果</li>
          <li>性能优化的动画</li>
        </ul>
      </Card>

      <Card title="桌面端操作" bordered={false}>
        <Text>
          在桌面端，点击左上角的按钮可以展开或收起侧边栏。
          动画使用 CSS transition 实现，提供流畅的用户体验。
        </Text>
      </Card>

      <Card title="移动端操作" bordered={false}>
        <Text>
          在移动端，侧边栏默认隐藏。点击按钮或从左边缘向右滑动可以打开侧边栏。
          点击遮罩层、向左滑动或按 ESC 键可以关闭侧边栏。
        </Text>
      </Card>

      <Card title="自定义配置" bordered={false}>
        <Text>
          组件支持多种自定义选项：
        </Text>
        <ul style={{ marginTop: 16, paddingLeft: 20 }}>
          <li>expandedWidth: 展开时的宽度（默认 200px）</li>
          <li>collapsedWidth: 收起时的宽度（默认 80px）</li>
          <li>transitionDuration: 动画时长（默认 200ms）</li>
          <li>touchSensitivity: 触摸滑动灵敏度（默认 50px）</li>
          <li>onCollapseChange: 状态变化回调函数</li>
        </ul>
      </Card>

      <Divider />

      <Card title="性能优化" bordered={false}>
        <Text>
          组件经过性能优化：
        </Text>
        <ul style={{ marginTop: 16, paddingLeft: 20 }}>
          <li>使用 CSS transform 而非 width 属性进行移动端动画</li>
          <li>使用 cubic-bezier 缓动函数实现自然的动画效果</li>
          <li>使用 useCallback 优化事件处理函数</li>
          <li>使用 requestAnimationFrame 优化渲染性能</li>
        </ul>
      </Card>
    </Space>
  );
}

export default function AnimatedSidebarExample() {
  return (
    <AnimatedSidebar
      expandedWidth={200}
      collapsedWidth={80}
      breakpoint={768}
      defaultCollapsed={false}
      transitionDuration={200}
      showOverlay={true}
      onCollapseChange={(collapsed) => {
        console.log("侧边栏状态:", collapsed ? "收起" : "展开");
      }}
      theme="dark"
      mainContent={<MainContent />}
    >
      <SidebarContent />
    </AnimatedSidebar>
  );
}
