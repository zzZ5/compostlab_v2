"use client";

import { Suspense } from "react";
import { Button, Card, Form, Input, Typography, message } from "antd";
import { useRouter, useSearchParams } from "next/navigation";
import { setTokens, setUser, clearTokens } from "@/lib/auth";
import { api } from "@/lib/api";
import type { LoginResp } from "@/types/api";

const { Title, Text } = Typography;

function LoginForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const next = sp.get("next") || "/";

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <Card style={{ width: 440, maxWidth: "100%" }}>
        <Title level={3} style={{ marginTop: 0, marginBottom: 4 }}>
          CompostLab 登录
        </Title>
        <Text type="secondary">使用账号密码登录</Text>

        <Form
          layout="vertical"
          style={{ marginTop: 16 }}
          onFinish={async (v) => {
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
          }}
        >
          <Form.Item label="用户名" name="username" rules={[{ required: true, message: "请输入用户名" }]}>
            <Input autoFocus placeholder="例如：admin" />
          </Form.Item>

          <Form.Item label="密码" name="password" rules={[{ required: true, message: "请输入密码" }]}>
            <Input.Password placeholder="请输入密码" />
          </Form.Item>

          <Button type="primary" htmlType="submit" block>
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
