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
    console.log("表单提交值:", values);

    try {
      if (editingUser) {
        // 更新用户 - 确保所有字段都被发送
        const updateData = {
          email: values.email || "",
          role: values.role || "readonly",
          real_name: values.real_name || "",
          department: values.department || "",
          phone: values.phone || "",
        };
        console.log("更新用户数据:", updateData);
        await api.put(`/users/${editingUser.id}/update`, updateData);
        message.success("用户更新成功");
        setModalOpen(false);
        form.resetFields();
        setEditingUser(null);
        queryClient.invalidateQueries({ queryKey: ["users"] });
      } else {
        // 创建用户 - 确保所有字段都有默认值
        const createData = {
          username: values.username || "",
          password: values.password || "",
          email: values.email || "",
          role: values.role || "readonly",
          real_name: values.real_name || "",
          department: values.department || "",
          phone: values.phone || "",
        };

        console.log("创建用户数据:", createData);

        try {
          const res = await api.post("/users/create", createData);
          console.log("创建用户响应:", res.data);

          // 检查返回的角色是否与请求的一致
          if (res.data.role !== createData.role) {
            message.warning(`用户已创建，但角色从 ${createData.role} 变更为 ${res.data.role}`);
          } else {
            message.success("用户创建成功");
          }

          // 创建成功后关闭模态框
          setModalOpen(false);
          form.resetFields();
          setEditingUser(null);
          queryClient.invalidateQueries({ queryKey: ["users"] });
        } catch (apiError: any) {
          console.error("API 请求错误:", apiError);
          throw apiError;
        }
      }
    } catch (err: any) {
      const errMsg = err?.response?.data?.detail || "操作失败";
      const status = err?.response?.status;
      const responseData = err?.response?.data;

      console.error("用户操作错误:", err);
      console.error("错误响应:", responseData);
      console.error("状态码:", status);

      // 根据不同的状态码显示不同的错误信息
      if (status === 400) {
        if (responseData?.errors && Array.isArray(responseData.errors)) {
          message.error(`验证失败: ${responseData.errors.join("; ")}`);
        } else if (responseData?.detail) {
          message.error(responseData.detail);
        } else {
          message.error("请求参数错误，请检查输入");
        }
      } else if (status === 403) {
        message.error("权限不足：需要管理员权限才能创建用户");
      } else if (status === 401) {
        message.error("未授权：请重新登录");
      } else if (status === 422) {
        message.error(`验证失败: ${JSON.stringify(responseData?.errors || responseData?.detail || errMsg)}`);
      } else {
        message.error(`${errMsg}${status ? ` (HTTP ${status})` : ""}`);
      }

      // 错误时不关闭模态框，让用户可以修正后重试
      return;
    }
  }

  function handleOk() {
    form.validateFields()
      .then((values) => {
        console.log("表单验证通过:", values);
        handleSubmit(values);
      })
      .catch((errorInfo) => {
        console.error("表单验证失败:", errorInfo);
        // 表单验证失败时，Ant Design 会自动显示字段错误
      });
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
    // 使用 form.setFieldValue 设置默认角色，而不是 setFieldsValue
    form.setFieldsValue({
      email: "",
      real_name: "",
      department: "",
      phone: "",
    });
    // 确保角色字段的初始值
    form.setFieldValue("role", "readonly");
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
          pagination={{ pageSize: isMobile ? 10 : 20 }}
          scroll={{ x: isMobile ? 600 : undefined }}
          columns={[
            { title: "ID", dataIndex: "id", width: 60, responsive: ["lg"] },
            { title: "用户名", dataIndex: "username", width: 120 },
            {
              title: "真实姓名",
              dataIndex: "real_name",
              width: 100,
              responsive: ["xs", "sm", "md", "lg", "xl"],
              render: (v) => v || "-",
            },
            {
              title: "角色",
              dataIndex: "role_display",
              width: 90,
              responsive: ["xs", "sm", "md", "lg", "xl"],
              render: (v, r) => {
                const colors: any = { readonly: "default", operator: "blue", admin: "red" };
                return <Tag color={colors[r.role]}>{v}</Tag>;
              },
            },
            { title: "部门", dataIndex: "department", width: 120, responsive: ["md"], render: (v) => v || "-" },
            { title: "邮箱", dataIndex: "email", width: 150, responsive: ["md"], render: (v) => v || "-" },
            {
              title: "状态",
              dataIndex: "is_active",
              width: 80,
              responsive: ["xs", "sm", "md", "lg", "xl"],
              render: (v) => (v ? <Tag color="success">启用</Tag> : <Tag>禁用</Tag>),
            },
            {
              title: "操作",
              width: isMobile ? 140 : 200,
              fixed: isMobile ? "right" : undefined,
              responsive: ["xs", "sm", "md", "lg", "xl"],
              render: (_, record) => (
                <Space size="small" wrap>
                  <Button size="small" type="primary" onClick={() => openEditModal(record)}>
                    编辑
                  </Button>
                  <Popconfirm
                    title={record.is_active ? "确定禁用？" : "确定启用？"}
                    onConfirm={() => handleToggleActive(record)}
                  >
                    <Button size="small" danger={record.is_active}>
                      {record.is_active ? "禁用" : "启用"}
                    </Button>
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
        onOk={handleOk}
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
                rules={[
                  { required: true, message: "请输入密码" },
                  { min: 8, message: "密码至少 8 位" }
                ]}
              >
                <Input.Password placeholder="至少 8 位，不能过于简单" />
              </Form.Item>
            </>
          )}

          <Form.Item label="角色" name="role" rules={[{ required: true, message: "请选择角色" }]}>
            <Select options={roleOptions} />
          </Form.Item>

          <Form.Item label="邮箱" name="email">
            <Input placeholder="可选" />
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
