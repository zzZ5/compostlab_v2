"use client";

import { Button, Card, Form, Input, Typography, message } from "antd";
import { useRouter, useSearchParams } from "next/navigation";
import { setBasicAuth, clearBasicAuth } from "@/lib/auth";
import { api } from "@/lib/api";

const { Title, Text } = Typography;

export default function LoginPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const next = sp.get("next") || "/";

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <Card style={{ width: 440, maxWidth: "100%" }}>
        <Title level={3} style={{ marginTop: 0, marginBottom: 4 }}>
          CompostLab 登录
        </Title>
        <Text type="secondary">使用后端 Basic Auth 账号密码</Text>

        <Form
          layout="vertical"
          style={{ marginTop: 16 }}
          onFinish={async (v) => {
            try {
              setBasicAuth(v.username, v.password);
              // 立刻验证：请求一个轻量接口
              await api.get("/devices/tree");
              message.success("登录成功");
              router.replace(next);
            } catch {
              message.error("登录失败：账号/密码错误，或后端不可达");
              clearBasicAuth();
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
