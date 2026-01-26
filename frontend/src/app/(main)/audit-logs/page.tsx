"use client";

import { Card, Table, Tag, Select, Input, Space } from "antd";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Page from "@/components/Page";
import { api } from "@/lib/api";
import type { AuditLog } from "@/types/api";

export default function AuditLogsPage() {
  const [username, setUsername] = useState("");
  const [action, setAction] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const logsQ = useQuery<{ data: AuditLog[]; count?: number; pagination?: any }>({
    queryKey: ["audit-logs", username, action, page, pageSize],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (username) params.set("username", username);
      if (action) params.set("action", action);
      params.set("page", String(page));
      params.set("page_size", String(pageSize));
      
      const res = await api.get<{ data: AuditLog[]; count?: number; pagination?: any }>(`/audit-logs?${params}`);
      return res.data;
    },
  });

  const logs = logsQ.data?.data || [];

  return (
    <Page title="操作日志">
      <Card style={{ marginBottom: 16 }}>
        <Space wrap>
          <Input
            placeholder="按用户名筛选"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            style={{ width: 200 }}
            allowClear
          />
          <Select
            placeholder="按操作类型筛选"
            value={action}
            onChange={setAction}
            style={{ width: 200 }}
            allowClear
            options={[
              { value: "", label: "全部" },
              { value: "login", label: "登录" },
              { value: "device_create", label: "创建设备" },
              { value: "device_update", label: "更新设备" },
              { value: "device_delete", label: "删除设备" },
              { value: "user_create", label: "创建用户" },
              { value: "user_update", label: "更新用户" },
            ]}
          />
        </Space>
      </Card>

      <Card>
        <Table
          loading={logsQ.isLoading}
          dataSource={logs}
          rowKey="id"
          pagination={{
            current: page,
            pageSize,
            total: logsQ.data?.pagination?.total ?? logsQ.data?.count ?? logs.length,
            showSizeChanger: true,
            onChange: (nextPage, nextPageSize) => {
              setPage(nextPage);
              if (nextPageSize && nextPageSize !== pageSize) {
                setPageSize(nextPageSize);
                setPage(1);
              }
            },
          }}
          scroll={{ x: 1200 }}
          columns={[
            { title: "时间", dataIndex: "created_at", width: 180, render: (v) => new Date(v).toLocaleString() },
            { title: "用户", dataIndex: "username", width: 120 },
            { title: "操作", dataIndex: "action_display", width: 150 },
            { title: "资源类型", dataIndex: "resource_type", width: 120, render: (v) => v || "-" },
            { title: "资源 ID", dataIndex: "resource_id", width: 100, render: (v) => v || "-" },
            { title: "描述", dataIndex: "description", ellipsis: true },
            {
              title: "状态",
              dataIndex: "success",
              width: 80,
              render: (v) => (v ? <Tag color="success">成功</Tag> : <Tag color="error">失败</Tag>),
            },
            { title: "IP", dataIndex: "ip_address", width: 140, render: (v) => v || "-" },
          ]}
        />
      </Card>
    </Page>
  );
}
