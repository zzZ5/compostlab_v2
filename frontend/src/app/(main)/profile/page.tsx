"use client";

import { useState } from "react";
import { Card, Descriptions, Button, Modal, Form, Input, message, Tag } from "antd";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Page from "@/components/Page";
import { api } from "@/lib/api";
import { getUser } from "@/lib/auth";
import type { User } from "@/types/api";

export default function ProfilePage() {
  const queryClient = useQueryClient();
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [form] = Form.useForm();

  const meQ = useQuery<User>({
    queryKey: ["auth", "me"],
    queryFn: async () => {
      const res = await api.get<User>("/auth/me");
      return res.data;
    },
    initialData: getUser(),
  });

  const user = meQ.data;

  async function handleChangePassword(values: any) {
    try {
      await api.post("/auth/change-password", values);
      message.success("密码修改成功，请重新登录");
      setPasswordModalOpen(false);
      form.resetFields();
      // 可以选择自动登出
      setTimeout(() => {
        window.location.href = "/login";
      }, 1500);
    } catch (err: any) {
      const errMsg = err?.response?.data?.detail || "修改失败";
      message.error(errMsg);
    }
  }

  const roleColors: any = { readonly: "default", operator: "blue", admin: "red" };

  return (
    <Page
      title="个人中心"
      extra={
        <Button type="primary" onClick={() => setPasswordModalOpen(true)}>
          修改密码
        </Button>
      }
    >
      <Card title="基本信息">
        <Descriptions column={2} bordered>
          <Descriptions.Item label="用户名">{user?.username}</Descriptions.Item>
          <Descriptions.Item label="邮箱">{user?.email || "-"}</Descriptions.Item>
          <Descriptions.Item label="角色">
            <Tag color={roleColors[user?.role || "readonly"]}>{user?.role_display}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="真实姓名">{user?.real_name || "-"}</Descriptions.Item>
          <Descriptions.Item label="部门/实验室">{user?.department || "-"}</Descriptions.Item>
          <Descriptions.Item label="联系电话">{user?.phone || "-"}</Descriptions.Item>
          <Descriptions.Item label="最后登录">
            {user?.last_login_at ? new Date(user.last_login_at).toLocaleString() : "-"}
          </Descriptions.Item>
          <Descriptions.Item label="注册时间">
            {user?.date_joined ? new Date(user.date_joined).toLocaleString() : "-"}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Modal
        open={passwordModalOpen}
        title="修改密码"
        onCancel={() => {
          setPasswordModalOpen(false);
          form.resetFields();
        }}
        onOk={() => form.submit()}
      >
        <Form form={form} layout="vertical" onFinish={handleChangePassword}>
          <Form.Item
            label="当前密码"
            name="old_password"
            rules={[{ required: true, message: "请输入当前密码" }]}
          >
            <Input.Password />
          </Form.Item>

          <Form.Item
            label="新密码"
            name="new_password"
            rules={[
              { required: true, message: "请输入新密码" },
              { min: 8, message: "密码至少 8 位" },
            ]}
          >
            <Input.Password />
          </Form.Item>

          <Form.Item
            label="确认新密码"
            name="confirm_password"
            dependencies={["new_password"]}
            rules={[
              { required: true, message: "请再次输入新密码" },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue("new_password") === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error("两次输入的密码不一致"));
                },
              }),
            ]}
          >
            <Input.Password />
          </Form.Item>
        </Form>
      </Modal>
    </Page>
  );
}
