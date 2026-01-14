"use client";

import { useState } from "react";
import { Card, Select, Space, Table, Tag, Typography } from "antd";
import Link from "next/link";

import Page from "@/components/Page";
import { useMyHistory } from "@/features/announcements/queries";
import type { AnnouncementCategory, AnnouncementPriority, AnnouncementTargetRole, MyAnnouncement } from "@/types/api";

const { Text } = Typography;
const { Option } = Select;

const categoryLabels: Record<AnnouncementCategory, string> = {
	system: "系统通知",
	maintenance: "维护通知",
	feature: "功能更新",
	announcement: "公告",
};

const priorityLabels: Record<AnnouncementPriority, string> = {
	low: "低",
	medium: "中",
	high: "高",
	urgent: "紧急",
};

const priorityColors: Record<AnnouncementPriority, string> = {
	low: "default",
	medium: "blue",
	high: "orange",
	urgent: "red",
};

const targetRoleLabels: Record<AnnouncementTargetRole, string> = {
	all: "所有用户",
	admin: "管理员",
	operator: "操作员",
	readonly: "只读用户",
};

export default function AnnouncementHistoryPage() {
	const [page, setPage] = useState(1);
	const [pageSize, setPageSize] = useState(20);
	const [category, setCategory] = useState<AnnouncementCategory | "">("");
	const [priority, setPriority] = useState<AnnouncementPriority | "">("");

	const { data: historyData, isLoading } = useMyHistory({
		page,
		page_size: pageSize,
		category: category || undefined,
		priority: priority || undefined,
	});

	const columns = [
		{
			title: "标题",
			dataIndex: "title",
			key: "title",
			render: (title: string, record: MyAnnouncement) => (
				<Link href={`/announcements/${record.id}`}>
					<Space orientation="vertical" size={0}>
						<Text strong style={{ color: "#1890ff", cursor: "pointer" }}>{title}</Text>
						{record.is_pinned && <Tag color="blue">置顶</Tag>}
						{record.is_expired && <Tag color="red">已过期</Tag>}
					</Space>
				</Link>
			),
		},
		{
			title: "分类",
			dataIndex: "category",
			key: "category",
			render: (cat: AnnouncementCategory) => <Tag>{categoryLabels[cat]}</Tag>,
			width: 120,
		},
		{
			title: "优先级",
			dataIndex: "priority",
			key: "priority",
			render: (pri: AnnouncementPriority) => <Tag color={priorityColors[pri]}>{priorityLabels[pri]}</Tag>,
			width: 100,
		},
		{
			title: "阅读时间",
			dataIndex: "read_at",
			key: "read_at",
			render: (readAt: string) => <Text>{readAt || "-"}</Text>,
			width: 180,
		},
		{
			title: "创建时间",
			dataIndex: "created_at",
			key: "created_at",
			width: 180,
		},
		{
			title: "过期时间",
			dataIndex: "expiry_at",
			key: "expiry_at",
			render: (expiryAt: string | null) => <Text>{expiryAt || "永不过期"}</Text>,
			width: 180,
		},
		{
			title: "操作",
			key: "actions",
			render: (_: any, record: MyAnnouncement) => (
				<Link href={`/announcements/${record.id}`}>
					<Text style={{ color: "#1890ff", cursor: "pointer" }}>查看详情</Text>
				</Link>
			),
			width: 120,
		},
	];

	return (
		<Page title="公告历史记录" extra={<Text type="secondary">已读公告总数：{historyData?.total_count || 0}</Text>}>
			<Card>
				<div style={{ marginBottom: 16, display: "flex", gap: 16, flexWrap: "wrap" }}>
					<div>
						<div style={{ marginBottom: 8, color: "#595959", fontSize: 14 }}>分类</div>
						<Select value={category} onChange={setCategory} style={{ width: 120 }} allowClear placeholder="全部分类">
							<Option value="system">系统通知</Option>
							<Option value="maintenance">维护通知</Option>
							<Option value="feature">功能更新</Option>
							<Option value="announcement">公告</Option>
						</Select>
					</div>
					<div>
						<div style={{ marginBottom: 8, color: "#595959", fontSize: 14 }}>优先级</div>
						<Select value={priority} onChange={setPriority} style={{ width: 100 }} allowClear placeholder="全部优先级">
							<Option value="low">低</Option>
							<Option value="medium">中</Option>
							<Option value="high">高</Option>
							<Option value="urgent">紧急</Option>
						</Select>
					</div>
				</div>

				<Table
					rowKey="id"
					columns={columns}
					dataSource={historyData?.data || []}
					loading={isLoading}
					pagination={{
						current: page,
						pageSize,
						showSizeChanger: true,
						onChange: setPage,
						onShowSizeChange: (_, size) => {
							setPageSize(size);
							setPage(1);
						},
					}}
					scroll={{ x: 1200 }}
				/>
			</Card>
		</Page>
	);
}
