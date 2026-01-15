"use client";

import { useState, useEffect } from "react";
import { Card, Typography, Space, Divider, Alert, Tag, List, Input, Affix, Button, Collapse, Steps } from "antd";
import {
  InfoCircleOutlined,
  QuestionCircleOutlined,
  RocketOutlined,
  DatabaseOutlined,
  SettingOutlined,
  FileTextOutlined,
  LineChartOutlined,
  ThunderboltOutlined,
  SearchOutlined,
  MenuOutlined,
  UpOutlined,
  RightOutlined,
} from "@ant-design/icons";
import Link from "next/link";

const { Title, Paragraph, Text } = Typography;
const { Panel } = Collapse;

export default function UsagePage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      setShowBackToTop(window.scrollY > 400);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const sections = [
    { id: "quick-start", label: "快速开始", icon: <RocketOutlined /> },
    { id: "devices", label: "设备管理", icon: <DatabaseOutlined /> },
    { id: "scripts", label: "控制脚本", icon: <ThunderboltOutlined /> },
    { id: "runs", label: "运行批次", icon: <FileTextOutlined /> },
    { id: "data", label: "数据探索", icon: <LineChartOutlined /> },
    { id: "settings", label: "系统设置", icon: <SettingOutlined /> },
    { id: "faq", label: "常见问题", icon: <QuestionCircleOutlined /> },
    { id: "best-practices", label: "最佳实践", icon: <InfoCircleOutlined /> },
  ];

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "0 24px" }}>
      {/* 头部 */}
      <div style={{ textAlign: "center", marginBottom: 48, padding: "40px 0 24px" }}>
        <Title level={2} style={{ fontWeight: 500, marginBottom: 12 }}>使用说明</Title>
        <Text type="secondary">CompostLab 操作指南</Text>
      </div>

      {/* 搜索框 */}
      <div style={{ marginBottom: 40 }}>
        <Input
          placeholder="搜索内容..."
          prefix={<SearchOutlined />}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          allowClear
        />
      </div>

      {/* 移动端目录 */}
      {isMobile && (
        <Card size="small" style={{ marginBottom: 24 }}>
          <Space wrap>
            {sections.map((section) => (
              <Button
                key={section.id}
                type="text"
                size="small"
                icon={section.icon}
                onClick={() => {
                  const element = document.getElementById(section.id);
                  element?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              >
                {section.label}
              </Button>
            ))}
          </Space>
        </Card>
      )}

      {/* 内容区域 */}
      <div style={{ display: "flex", gap: 24, position: "relative" }}>
        {/* 主内容区域 */}
        <div style={{ flex: 1 }}>
          {/* 快速开始 */}
          <Card
            id="quick-start"
            title={<Title level={4} style={{ margin: 0 }}>快速开始</Title>}
            style={{ marginBottom: 24 }}
          >
            <Steps
              direction="vertical"
              size="small"
              items={[
                {
                  title: "登录系统",
                  description: "使用管理员分配的用户名和密码登录系统"
                },
                {
                  title: "添加设备",
                  description: "在「设备」页面添加设备，配置参数和通道信息"
                },
                {
                  title: "创建运行批次",
                  description: "创建实验批次，选择设备和配置参数"
                },
                {
                  title: "配置自动化",
                  description: "根据需要配置自动化脚本"
                },
                {
                  title: "监控数据",
                  description: "在「数据探索」页面实时监控设备数据"
                }
              ]}
            />
          </Card>

          {/* 设备管理 */}
          <Card id="devices" title={<Title level={4} style={{ margin: 0 }}>设备管理</Title>} style={{ marginBottom: 24 }}>
            <List
              size="small"
              dataSource={[
                {
                  title: "添加设备",
                  description: "点击「设备」页面右上角的「添加设备」按钮，填写设备名称、类型和描述信息。"
                },
                {
                  title: "配置通道",
                  description: "在设备详情页点击「配置通道」，添加传感器通道或控制通道。"
                },
                {
                  title: "远程控制",
                  description: "在设备控制页面发送命令，远程控制设备执行操作。"
                },
                {
                  title: "设备监控",
                  description: "实时查看设备状态（在线/离线）、最后更新时间、信号强度等信息。"
                }
              ]}
              renderItem={item => (
                <List.Item>
                  <List.Item.Meta
                    title={<Text strong>{item.title}</Text>}
                    description={item.description}
                  />
                </List.Item>
              )}
            />
          </Card>

          {/* 控制脚本 */}
          <Card id="scripts" title={<Title level={4} style={{ margin: 0 }}>控制脚本</Title>} style={{ marginBottom: 24 }}>
            <List
              size="small"
              dataSource={[
                {
                  title: "阈值触发",
                  description: "当传感器数据达到设定的阈值时，自动执行预设的命令。"
                },
                {
                  title: "定时执行",
                  description: "使用 cron 表达式定义执行时间，系统会按计划自动执行。"
                },
                {
                  title: "自定义脚本",
                  description: "编写自定义 Python 代码实现复杂的控制逻辑。"
                },
                {
                  title: "命令模板",
                  description: "定义要发送给设备的控制命令，使用 JSON 格式配置。"
                }
              ]}
              renderItem={item => (
                <List.Item>
                  <List.Item.Meta
                    title={<Text strong>{item.title}</Text>}
                    description={item.description}
                  />
                </List.Item>
              )}
            />
          </Card>

          {/* 运行批次 */}
          <Card id="runs" title={<Title level={4} style={{ margin: 0 }}>运行批次</Title>} style={{ marginBottom: 24 }}>
            <Space direction="vertical" size="middle" style={{ width: "100%" }}>
              {[
                { title: "创建 Run", desc: "填写实验名称、开始时间、结束时间等基本信息。" },
                { title: "添加 Window", desc: "为 Run 添加时间窗口，定义不同阶段的配置。" },
                { title: "配置参数", desc: "为每个 Window 配置设备通道、目标值、报警阈值等参数。" },
                { title: "查看数据", desc: "在 Run 详情页查看该批次的所有数据、操作记录、事件日志等。" }
              ].map((item, index) => (
                <div key={index} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <div style={{
                    width: 24,
                    height: 24,
                    borderRadius: 4,
                    background: "#f0f0f0",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 12,
                    flexShrink: 0
                  }}>{index + 1}</div>
                  <div>
                    <Text strong>{item.title}</Text>
                    <br />
                    <Text type="secondary">{item.desc}</Text>
                  </div>
                </div>
              ))}
            </Space>
          </Card>

          {/* 数据探索 */}
          <Card id="data" title={<Title level={4} style={{ margin: 0 }}>数据探索</Title>} style={{ marginBottom: 24 }}>
            <List
              size="small"
              dataSource={[
                {
                  title: "数据查询",
                  description: "按时间范围、设备、通道等条件筛选数据。"
                },
                {
                  title: "实时监控",
                  description: "选择要监控的设备通道，实时显示最新数据。"
                },
                {
                  title: "可视化图表",
                  description: "将数据以图表形式展示，支持折线图、柱状图等多种类型。"
                },
                {
                  title: "数据导出",
                  description: "将查询结果导出为 CSV 格式。"
                }
              ]}
              renderItem={item => (
                <List.Item>
                  <List.Item.Meta
                    title={<Text strong>{item.title}</Text>}
                    description={item.description}
                  />
                </List.Item>
              )}
            />
          </Card>

          {/* 系统设置 */}
          <Card id="settings" title={<Title level={4} style={{ margin: 0 }}>系统设置</Title>} style={{ marginBottom: 24 }}>
            <List
              size="small"
              dataSource={[
                {
                  title: "个人中心",
                  description: "修改个人信息、更改密码、查看登录记录等。"
                },
                {
                  title: "权限管理（管理员）",
                  description: "创建和管理用户账号，分配用户角色和权限。"
                },
                {
                  title: "公告管理（管理员）",
                  description: "发布和管理系统公告。"
                },
                {
                  title: "操作日志（管理员）",
                  description: "查看所有用户的操作记录。"
                }
              ]}
              renderItem={item => (
                <List.Item>
                  <List.Item.Meta
                    title={<Text strong>{item.title}</Text>}
                    description={item.description}
                  />
                </List.Item>
              )}
            />
          </Card>

          {/* 常见问题 */}
          <Card id="faq" title={<Title level={4} style={{ margin: 0 }}>常见问题</Title>} style={{ marginBottom: 24 }}>
            <Collapse
              ghost
              items={[
                {
                  key: "1",
                  label: "忘记密码怎么办？",
                  children: <Paragraph style={{ marginBottom: 0 }}>请联系系统管理员重置密码。管理员可以在「用户管理」页面重置用户的密码。</Paragraph>
                },
                {
                  key: "2",
                  label: "如何删除不需要的数据？",
                  children: <Paragraph style={{ marginBottom: 0 }}>只有管理员角色才有删除权限。请谨慎操作，删除的数据无法恢复。删除前建议先导出数据备份。</Paragraph>
                },
                {
                  key: "3",
                  label: "设备离线怎么办？",
                  children: (
                    <div>
                      <Paragraph style={{ marginBottom: 8 }}>请检查设备网络连接，确认设备配置信息正确：</Paragraph>
                      <ol style={{ marginBottom: 0, paddingLeft: 20 }}>
                        <li>确认设备已通电</li>
                        <li>检查设备网络配置</li>
                        <li>确认设备 IP 地址正确</li>
                        <li>尝试 ping 设备地址</li>
                      </ol>
                    </div>
                  )
                },
                {
                  key: "4",
                  label: "如何备份实验数据？",
                  children: <Paragraph style={{ marginBottom: 0 }}>可以在「数据探索」页面导出数据为 CSV 文件，或联系管理员进行数据库完整备份。</Paragraph>
                },
                {
                  key: "5",
                  label: "自动化脚本没有执行怎么办？",
                  children: (
                    <div>
                      <Paragraph style={{ marginBottom: 8 }}>请检查以下几点：</Paragraph>
                      <ol style={{ marginBottom: 0, paddingLeft: 20 }}>
                        <li>脚本是否已启用（状态为「激活」）</li>
                        <li>阈值或时间配置是否正确</li>
                        <li>设备是否在线</li>
                        <li>命令模板格式是否正确</li>
                      </ol>
                    </div>
                  )
                },
                {
                  key: "6",
                  label: "数据显示不准确怎么办？",
                  children: (
                    <div>
                      <Paragraph style={{ marginBottom: 8 }}>可能的原因：</Paragraph>
                      <ol style={{ marginBottom: 0, paddingLeft: 20 }}>
                        <li>传感器校准问题，需要重新校准</li>
                        <li>传感器损坏或故障</li>
                        <li>信号干扰</li>
                        <li>采样频率设置不合理</li>
                      </ol>
                    </div>
                  )
                }
              ]}
            />
          </Card>

          {/* 最佳实践 */}
          <Card id="best-practices" title={<Title level={4} style={{ margin: 0 }}>最佳实践</Title>} style={{ marginBottom: 24 }}>
            <List
              size="small"
              dataSource={[
                { title: "定期检查设备状态", desc: "建议每天检查设备在线状态，及时发现并解决设备离线问题。" },
                { title: "合理设置阈值", desc: "阈值设置需要根据实际情况调整，避免频繁误触发或漏触发。" },
                { title: "定期数据备份", desc: "定期导出重要实验数据，建议每周进行一次完整备份。" },
                { title: "监控异常数据", desc: "设置合理的报警阈值，及时收到异常通知，避免问题扩大。" },
                { title: "详细记录文档", desc: "详细记录每次实验的配置、参数和结果，方便后续分析和复现。" }
              ]}
              renderItem={item => (
                <List.Item>
                  <List.Item.Meta
                    title={<Text strong>{item.title}</Text>}
                    description={item.desc}
                  />
                </List.Item>
              )}
            />
          </Card>

          {/* 技术支持 */}
          <Card id="support" title={<Title level={4} style={{ margin: 0 }}>技术支持</Title>} style={{ marginBottom: 24 }}>
            <Paragraph style={{ marginBottom: 16 }}>如果您在使用过程中遇到问题，可以通过以下方式获取帮助：</Paragraph>
            <List
              size="small"
              dataSource={[
                "查看系统公告获取最新信息和更新",
                "联系系统管理员或技术支持团队",
                "在开源项目仓库提交 Issue：https://github.com/zzZ5/compostlab_v2",
                "查看详细文档和 API 参考"
              ]}
              renderItem={item => <List.Item>{item}</List.Item>}
            />
            <Divider />
            <Space>
              <Tag>版本 v2.0.0</Tag>
            </Space>
          </Card>

          {/* 底部链接 */}
          <div style={{ textAlign: "center", marginTop: 32, marginBottom: 24 }}>
            <Divider />
            <Link href="/about">
              <Text type="secondary">关于我们</Text>
            </Link>
          </div>
        </div>

        {/* 侧边栏 */}
        {!isMobile && (
          <div style={{ width: 200, flexShrink: 0 }}>
            <Affix offsetTop={80}>
              <Card size="small">
                <List
                  size="small"
                  dataSource={sections}
                  renderItem={(section) => (
                    <List.Item
                      style={{ padding: "8px 0", cursor: "pointer" }}
                      onClick={() => {
                        const element = document.getElementById(section.id);
                        element?.scrollIntoView({ behavior: "smooth", block: "start" });
                      }}
                    >
                      <Space size={8}>
                        {section.icon}
                        <Text>{section.label}</Text>
                      </Space>
                    </List.Item>
                  )}
                />
              </Card>
            </Affix>
          </div>
        )}
      </div>

      {/* 返回顶部按钮 */}
      {showBackToTop && (
        <Button
          icon={<UpOutlined />}
          onClick={scrollToTop}
          style={{
            position: "fixed",
            right: 24,
            bottom: 24,
            zIndex: 1000
          }}
        >
          返回顶部
        </Button>
      )}
    </div>
  );
}
