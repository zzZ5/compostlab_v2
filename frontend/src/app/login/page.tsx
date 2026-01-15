"use client";

import { Suspense } from "react";
import { Button, Card, Form, Input, Typography, message } from "antd";
import { UserOutlined, LockOutlined } from "@ant-design/icons";
import { useRouter, useSearchParams } from "next/navigation";
import { setTokens, setUser, clearTokens } from "@/lib/auth";
import { api } from "@/lib/api";
import type { LoginResp } from "@/types/api";
import CompostLabLogo from "@/components/CompostLabLogo";

const { Text } = Typography;

function LoginForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const next = sp.get("next") || "/";

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        background: "#f5f5f5",
      }}
    >
      <Card
        style={{
          width: 400,
          maxWidth: "100%",
          borderRadius: 8,
          boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
          border: "1px solid #e8e8e8",
        }}
        styles={{ body: { padding: 24 } }}
      >
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ marginBottom: 6, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <CompostLabLogo size="xlarge" />
          </div>
          <Text type="secondary">Compostlab</Text>
          <br />
          <Text type="secondary">实验室数据管理系统</Text>
        </div>

        <Form layout="vertical" onFinish={async (v) => {
          try {
            const res = await api.post<LoginResp>("/auth/login", {
              username: v.username,
              password: v.password,
            });

            const { access, refresh, user } = res.data;

            // 保存 token 和用户信息
            setTokens(access, refresh);
            setUser(user);

            message.success(`欢迎回来，${user.real_name || user.username}！`);
            router.replace(next);
          } catch (err: any) {
            const errMsg = err?.response?.data?.detail || "登录失败";
            message.error(errMsg);
            clearTokens();
          }
        }}>
          <Form.Item
            label="用户名/邮箱/手机号"
            name="username"
            rules={[{ required: true, message: "请输入用户名" }]}
          >
            <Input
              autoFocus
              prefix={<UserOutlined />}
              placeholder="请输入用户名/邮箱/手机号"
              size="large"
            />
          </Form.Item>

              <Form.Item
                label="密码"
                name="password"
                rules={[
                  { required: true, message: "请输入密码" },
                  { min: 8, message: "密码至少 8 位" }
                ]}
              >
                <Input.Password
                  prefix={<LockOutlined />}
                  placeholder="请输入密码（至少 8 位）"
                  size="large"
                />
              </Form.Item>

          <Button type="primary" htmlType="submit" block size="large">
            登录
          </Button>
        </Form>
      </Card>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <LoginForm />
    </Suspense>
  );
}
