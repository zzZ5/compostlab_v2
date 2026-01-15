"use client";

import { Card, Typography, Space, Divider, Tag } from "antd";
import { SafetyOutlined, RocketOutlined, TeamOutlined, GithubOutlined } from "@ant-design/icons";
import Link from "next/link";
import { useEffect, useState } from "react";
import { hasToken, hasBasicAuth } from "@/lib/auth";

const { Title, Paragraph, Text } = Typography;

export default function AboutPage() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setIsLoggedIn(hasToken() || hasBasicAuth());
    }
  }, []);
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f5f5f5",
        padding: "40px 20px",
      }}
    >
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        {/* 头部 */}
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <Title level={1}>关于 CompostLab</Title>
          <Text type="secondary" style={{ fontSize: 16 }}>
            实验室数据管理系统
          </Text>
        </div>

        {/* 系统介绍 */}
        <Card
          title={
            <Space>
              <RocketOutlined />
              <span>系统简介</span>
            </Space>
          }
          style={{ marginBottom: 24 }}
        >
          <Paragraph>
            CompostLab 是一套专为实验室设计的现代化数据管理系统，旨在帮助科研团队高效管理设备、
            监控实验数据、自动化控制流程。系统提供完整的设备管理、数据采集、自动化脚本和可视化分析功能。
          </Paragraph>
          <Paragraph>
            通过直观的用户界面和强大的 API，CompostLab 让实验室管理变得简单高效，让科研人员能够专注于实验本身。
          </Paragraph>
        </Card>

        {/* 核心功能 */}
        <Card
          title={
            <Space>
              <SafetyOutlined />
              <span>核心功能</span>
            </Space>
          }
          style={{ marginBottom: 24 }}
        >
          <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
            <div>
              <Title level={4}>设备管理</Title>
              <Paragraph>
                支持多种设备类型的接入与管理，包括传感器、控制器、执行器等。实时监控设备状态，
                远程控制设备操作。
              </Paragraph>
            </div>

            <Divider />

            <div>
              <Title level={4}>数据采集与分析</Title>
              <Paragraph>
                自动化数据采集，实时存储设备遥测数据。提供强大的数据查询和可视化功能，
                支持自定义指标和图表展示。
              </Paragraph>
            </div>

            <Divider />

            <div>
              <Title level={4}>自动化脚本</Title>
              <Paragraph>
                支持基于阈值和定时的自动化控制脚本。使用 Python 编写自定义逻辑，
                灵活配置命令模板，实现复杂的自动控制流程。
              </Paragraph>
            </div>

            <Divider />

            <div>
              <Title level={4}>运行批次管理</Title>
              <Paragraph>
                管理实验批次和窗口，跟踪每次实验的配置和数据。
                支持批量操作和历史记录查询。
              </Paragraph>
            </div>

            <Divider />

            <div>
              <Title level={4}>权限管理</Title>
              <Paragraph>
                基于角色的权限控制系统，支持管理员、操作员、观察员等多种角色。
                完善的审计日志记录所有操作。
              </Paragraph>
            </div>
          </Space>
        </Card>

        {/* 技术栈 */}
        <Card
          title={
            <Space>
              <GithubOutlined />
              <span>技术栈</span>
            </Space>
          }
          style={{ marginBottom: 24 }}
        >
          <Space orientation="vertical" size="small" style={{ width: "100%" }}>
            <Paragraph>
              <Text strong>前端：</Text>
              Next.js 14 + React 18 + TypeScript + Ant Design
            </Paragraph>
            <Paragraph>
              <Text strong>后端：</Text>
              Django 5.1 + Django REST Framework
            </Paragraph>
            <Paragraph>
              <Text strong>数据库：</Text>
              PostgreSQL
            </Paragraph>
            <Paragraph>
              <Text strong>认证：</Text>
              JWT Token Authentication
            </Paragraph>
            <Paragraph>
              <Text strong>部署：</Text>
              Docker + Docker Compose
            </Paragraph>
          </Space>
        </Card>

        {/* 开源信息 */}
        <Card
          title={
            <Space>
              <TeamOutlined />
              <span>开源与支持</span>
            </Space>
          }
        >
          <Paragraph>
            CompostLab 是一个开源项目，遵循 MIT 许可协议。我们欢迎社区贡献，
            包括代码提交、问题反馈、功能建议等。
          </Paragraph>
          <Paragraph>
            <Text type="secondary">版本：v2.0.0</Text>
          </Paragraph>
          <div style={{ marginTop: 16 }}>
            <a
              href="https://github.com/zzZ5/compostlab_v2"
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: "inline-flex", alignItems: "center", gap: 8, textDecoration: "none" }}
            >
              <GithubOutlined style={{ fontSize: 24, color: "#1890ff" }} />
              <Text style={{ fontSize: 16, color: "#1890ff", fontWeight: 500 }}>
                GitHub 仓库
              </Text>
            </a>
          </div>
          <div style={{ marginTop: 16 }}>
            <Tag color="blue">Django</Tag>
            <Tag color="cyan">Next.js</Tag>
            <Tag color="green">PostgreSQL</Tag>
            <Tag color="purple">Docker</Tag>
          </div>
        </Card>

        {/* 底部链接 */}
        <div style={{ textAlign: "center", marginTop: 32 }}>
          {isLoggedIn ? (
            <Link href="/">
              <Text type="secondary">返回首页</Text>
            </Link>
          ) : (
            <Link href="/login">
              <Text type="secondary">返回登录</Text>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
