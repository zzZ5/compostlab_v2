"use client";

import React, { useState } from "react";
import { Menu, Typography, Space, Card, Button, Slider, Switch, InputNumber, Tag } from "antd";
import {
  DashboardOutlined,
  DatabaseOutlined,
  ExperimentOutlined,
  LineChartOutlined,
  UserOutlined,
  TeamOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import AnimatedSidebar from "@/components/AnimatedSidebar";

const { Text, Title } = Typography;

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
          cursor: "pointer",
        }}
      >
        <Text strong style={{ color: "#fff", fontSize: 18 }}>
          🚀 Demo
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
          {
            key: "7",
            icon: <SettingOutlined />,
            label: "系统设置",
          },
        ]}
      />
    </>
  );
}

function MainContent({ sidebarState, onConfigChange }: {
  sidebarState: { collapsed: boolean; lastChangeTime: string };
  onConfigChange: (config: any) => void;
}) {
  const [config, setConfig] = useState({
    expandedWidth: 200,
    collapsedWidth: 80,
    breakpoint: 768,
    transitionDuration: 200,
    showOverlay: true,
    theme: "dark" as "light" | "dark",
  });

  const handleConfigChange = (key: string, value: any) => {
    const newConfig = { ...config, [key]: value };
    setConfig(newConfig);
    onConfigChange(newConfig);
  };

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Card title="🎉 动画侧边栏演示" bordered={false}>
        <Text>
          这是一个功能完整的动画侧边栏组件演示。你可以通过下方的配置面板自定义各种参数，实时查看效果。
        </Text>
      </Card>

      <Card title="⚙️ 配置面板" bordered={false}>
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          {/* 展开宽度 */}
          <div>
            <Space direction="vertical" style={{ width: "100%" }}>
              <Text strong>展开宽度</Text>
              <Space>
                <Slider
                  min={120}
                  max={320}
                  value={config.expandedWidth}
                  onChange={(value) => handleConfigChange("expandedWidth", value)}
                  style={{ width: 200 }}
                />
                <InputNumber
                  min={120}
                  max={320}
                  value={config.expandedWidth}
                  onChange={(value) => handleConfigChange("expandedWidth", value || 200)}
                />
              </Space>
            </Space>
          </div>

          {/* 收起宽度 */}
          <div>
            <Space direction="vertical" style={{ width: "100%" }}>
              <Text strong>收起宽度</Text>
              <Space>
                <Slider
                  min={40}
                  max={120}
                  value={config.collapsedWidth}
                  onChange={(value) => handleConfigChange("collapsedWidth", value)}
                  style={{ width: 200 }}
                />
                <InputNumber
                  min={40}
                  max={120}
                  value={config.collapsedWidth}
                  onChange={(value) => handleConfigChange("collapsedWidth", value || 80)}
                />
              </Space>
            </Space>
          </div>

          {/* 断点 */}
          <div>
            <Space direction="vertical" style={{ width: "100%" }}>
              <Text strong>响应式断点</Text>
              <Space>
                <Slider
                  min={480}
                  max={1200}
                  step={32}
                  value={config.breakpoint}
                  onChange={(value) => handleConfigChange("breakpoint", value)}
                  style={{ width: 200 }}
                />
                <InputNumber
                  min={480}
                  max={1200}
                  step={32}
                  value={config.breakpoint}
                  onChange={(value) => handleConfigChange("breakpoint", value || 768)}
                />
                <Tag color="blue">当前: {window.innerWidth}</Tag>
              </Space>
            </Space>
          </div>

          {/* 动画时长 */}
          <div>
            <Space direction="vertical" style={{ width: "100%" }}>
              <Text strong>动画时长 (ms)</Text>
              <Space>
                <Slider
                  min={100}
                  max={500}
                  step={50}
                  value={config.transitionDuration}
                  onChange={(value) => handleConfigChange("transitionDuration", value)}
                  style={{ width: 200 }}
                />
                <InputNumber
                  min={100}
                  max={500}
                  step={50}
                  value={config.transitionDuration}
                  onChange={(value) => handleConfigChange("transitionDuration", value || 200)}
                />
              </Space>
            </Space>
          </div>

          {/* 其他选项 */}
          <div>
            <Space>
              <Text strong>显示遮罩层：</Text>
              <Switch
                checked={config.showOverlay}
                onChange={(value) => handleConfigChange("showOverlay", value)}
              />
            </Space>
          </div>

          <div>
            <Space>
              <Text strong>主题：</Text>
              <Switch
                checked={config.theme === "dark"}
                checkedChildren="深色"
                unCheckedChildren="浅色"
                onChange={(value) => handleConfigChange("theme", value ? "dark" : "light")}
              />
            </Space>
          </div>
        </Space>
      </Card>

      <Card title="📊 状态监控" bordered={false}>
        <Space direction="vertical" size="small">
          <Text>
            侧边栏状态:{" "}
            <Tag color={sidebarState.collapsed ? "orange" : "green"}>
              {sidebarState.collapsed ? "收起" : "展开"}
            </Tag>
          </Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            最后更新: {sidebarState.lastChangeTime}
          </Text>
        </Space>
      </Card>

      <Card title="📱 操作说明" bordered={false}>
        <Space direction="vertical" size="middle">
          <div>
            <Text strong>桌面端：</Text>
            <ul style={{ marginTop: 8, paddingLeft: 20 }}>
              <li>点击左上角的按钮可以展开/收起侧边栏</li>
              <li>动画使用 CSS transition 实现，流畅自然</li>
            </ul>
          </div>
          <div>
            <Text strong>移动端：</Text>
            <ul style={{ marginTop: 8, paddingLeft: 20 }}>
              <li>从左边缘向右滑动打开侧边栏</li>
              <li>点击遮罩层、向左滑动或按 ESC 键关闭侧边栏</li>
            </ul>
          </div>
        </Space>
      </Card>

      <Card title="✨ 特性展示" bordered={false}>
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <div>
            <Title level={5}>🎯 核心特性</Title>
            <Space wrap>
              <Tag color="blue">流畅动画</Tag>
              <Tag color="green">响应式设计</Tag>
              <Tag color="purple">手势操作</Tag>
              <Tag color="orange">性能优化</Tag>
              <Tag color="cyan">TypeScript</Tag>
            </Space>
          </div>
          <div>
            <Title level={5}>⚡ 性能优化</Title>
            <ul style={{ paddingLeft: 20 }}>
              <li>使用 CSS transform 代替 left（移动端）</li>
              <li>使用 cubic-bezier 缓动函数</li>
              <li>使用 useCallback 优化事件处理</li>
              <li>硬件加速（translateZ, backface-visibility）</li>
            </ul>
          </div>
        </Space>
      </Card>

      <Card title="🎨 自定义建议" bordered={false}>
        <Space direction="vertical" size="small">
          <Text>• 展开宽度建议: 180-240px</Text>
          <Text>• 收起宽度建议: 60-80px</Text>
          <Text>• 动画时长建议: 200-300ms</Text>
          <Text>• 响应式断点建议: 768px（平板）或 480px（手机）</Text>
        </Space>
      </Card>
    </Space>
  );
}

export default function AnimatedSidebarDemoPage() {
  const [sidebarState, setSidebarState] = useState({
    collapsed: false,
    lastChangeTime: new Date().toLocaleTimeString(),
  });

  const handleCollapseChange = (collapsed: boolean) => {
    setSidebarState({
      collapsed,
      lastChangeTime: new Date().toLocaleTimeString(),
    });
  };

  return (
    <AnimatedSidebar
      expandedWidth={200}
      collapsedWidth={80}
      breakpoint={768}
      defaultCollapsed={false}
      transitionDuration={200}
      showOverlay={true}
      onCollapseChange={handleCollapseChange}
      theme="dark"
    >
      <SidebarContent />
      <MainContent sidebarState={sidebarState} onConfigChange={() => {}} />
    </AnimatedSidebar>
  );
}
