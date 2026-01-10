"use client";

import { useState } from "react";
import {
  Button,
  Card,
  Table,
  Tag,
  Space,
  Modal,
  Form,
  Input,
  Select,
  message,
  Popconfirm,
  Grid,
} from "antd";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Page from "@/components/Page";
import { api } from "@/lib/api";
import type { User } from "@/types/api";

const { useBreakpoint } = Grid;

const roleOptions = [
  { value: "readonly", label: "只读用户" },
  { value: "operator", label: "操作员" },
  { value: "admin", label: "管理员" },
];

export default function UsersPage() {
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [form] = Form.useForm();

  const usersQ = useQuery<{ data: User[] }>({
    queryKey: ["users"],
    queryFn: async () => {
      const res = await api.get<{ data: User[] }>("/users");
      return res.data;
    },
  });

  const users = usersQ.data?.data || [];

  async function handleSubmit(values: any) {
    try {
      if (editingUser) {
        // 更新用户
        await api.put(`/users/${editingUser.id}/update`, values);
        message.success("用户更新成功");
      } else {
        // 创建用户
        const res = await api.post("/users/create", values);
        message.success("用户创建成功");
      }
      setModalOpen(false);
      form.resetFields();
      setEditingUser(null);
      queryClient.invalidateQueries({ queryKey: ["users"] });
    } catch (err: any) {
      const errMsg = err?.response?.data?.detail || "操作失败";
      message.error(errMsg);
    }
  }

  async function handleToggleActive(user: User) {
    try {
      await api.post(`/users/${user.id}/toggle-active`);
      message.success(user.is_active ? "用户已禁用" : "用户已启用");
      queryClient.invalidateQueries({ queryKey: ["users"] });
    } catch (err: any) {
      const errMsg = err?.response?.data?.detail || "操作失败";
      message.error(errMsg);
    }
  }

  function openCreateModal() {
    setEditingUser(null);
    form.resetFields();
    setModalOpen(true);
  }

  function openEditModal(user: User) {
    setEditingUser(user);
    form.setFieldsValue({
      email: user.email,
      role: user.role,
      real_name: user.real_name,
      department: user.department,
      phone: user.phone,
    });
    setModalOpen(true);
  }

  return (
    <Page title="用户管理" extra={<Button type="primary" onClick={openCreateModal}>新建用户</Button>}>
      <Card>
        <Table
          loading={usersQ.isLoading}
          dataSource={users}
          rowKey="id"
          pagination={{ pageSize: 20 }}
          scroll={{ x: isMobile ? 800 : undefined }}
          columns={[
            { title: "ID", dataIndex: "id", width: 80, responsive: ["lg"] },
            { title: "用户名", dataIndex: "username", width: 150 },
            {
              title: "真实姓名",
              dataIndex: "real_name",
              width: 120,
              responsive: ["sm"],
              render: (v) => v || "-",
            },
            {
              title: "角色",
              dataIndex: "role_display",
              width: 120,
              responsive: ["sm"],
              render: (v, r) => {
                const colors: any = { readonly: "default", operator: "blue", admin: "red" };
                return <Tag color={colors[r.role]}>{v}</Tag>;
              },
            },
            { title: "部门", dataIndex: "department", width: 150, responsive: ["md"], render: (v) => v || "-" },
            { title: "邮箱", dataIndex: "email", width: 200, responsive: ["md"], render: (v) => v || "-" },
            {
              title: "状态",
              dataIndex: "is_active",
              width: 100,
              responsive: ["sm"],
              render: (v) => (v ? <Tag color="success">启用</Tag> : <Tag>禁用</Tag>),
            },
            {
              title: "操作",
              width: 200,
              fixed: isMobile ? "right" : undefined,
              render: (_, record) => (
                <Space size="small" wrap>
                  <Button size="small" onClick={() => openEditModal(record)}>
                    编辑
                  </Button>
                  <Popconfirm
                    title={record.is_active ? "确定禁用？" : "确定启用？"}
                    onConfirm={() => handleToggleActive(record)}
                  >
                    <Button size="small">{record.is_active ? "禁用" : "启用"}</Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        open={modalOpen}
        title={editingUser ? "编辑用户" : "新建用户"}
        onCancel={() => {
          setModalOpen(false);
          setEditingUser(null);
          form.resetFields();
        }}
        onOk={() => form.submit()}
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          {!editingUser && (
            <>
              <Form.Item
                label="用户名"
                name="username"
                rules={[{ required: true, message: "请输入用户名" }]}
              >
                <Input placeholder="英文字母和数字" />
              </Form.Item>
              <Form.Item
                label="密码"
                name="password"
                rules={[{ required: true, message: "请输入密码" }]}
              >
                <Input.Password placeholder="至少 8 位" />
              </Form.Item>
            </>
          )}

          <Form.Item label="邮箱" name="email">
            <Input placeholder="可选" />
          </Form.Item>

          <Form.Item label="角色" name="role" initialValue="readonly">
            <Select options={roleOptions} />
          </Form.Item>

          <Form.Item label="真实姓名" name="real_name">
            <Input placeholder="可选" />
          </Form.Item>

          <Form.Item label="部门/实验室" name="department">
            <Input placeholder="可选" />
          </Form.Item>

          <Form.Item label="联系电话" name="phone">
            <Input placeholder="可选" />
          </Form.Item>
        </Form>
      </Modal>
    </Page>
  );
}
