"use client";

import { useState } from "react";
import {
	Button,
	Card,
	Col,
	Form,
	Input,
	message,
	Modal,
	Row,
	Select,
	Space,
	Switch,
	Table,
	Tag,
	Typography,
} from "antd";

import Page from "@/components/Page";
import { useAnnouncementsList } from "@/features/announcements/queries";
import { useCreateAnnouncement, useUpdateAnnouncement, useDeleteAnnouncement } from "@/features/announcements/mutations";
import type { AnnouncementCategory, AnnouncementPriority, AnnouncementTargetRole, AnnouncementListItem } from "@/types/api";

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

export default function AnnouncementsPage() {
	const [createModalOpen, setCreateModalOpen] = useState(false);
	const [editingAnnouncement, setEditingAnnouncement] = useState<AnnouncementListItem | null>(null);
	const [form] = Form.useForm();

	// 查询参数
	const [page, setPage] = useState(1);
	const [pageSize, setPageSize] = useState(20);
	const [search, setSearch] = useState("");
	const [category, setCategory] = useState<AnnouncementCategory | "">("");
	const [priority, setPriority] = useState<AnnouncementPriority | "">("");
	const [targetRole, setTargetRole] = useState<AnnouncementTargetRole | "">("");
	const [isActive, setIsActive] = useState<"">("");
	const [isPinned] = useState<"">("");

	const { data: listData, isLoading } = useAnnouncementsList({
		page,
		page_size: pageSize,
		search,
		category: category || undefined,
		priority: priority || undefined,
		target_role: targetRole || undefined,
		is_active: isActive || undefined,
		is_pinned: isPinned || undefined,
	});

	const createMutation = useCreateAnnouncement();
	const updateMutation = useUpdateAnnouncement(editingAnnouncement?.id || 0);
	const deleteMutation = useDeleteAnnouncement();

	function openCreateModal() {
		setEditingAnnouncement(null);
		form.resetFields();
		setCreateModalOpen(true);
	}

	function openEditModal(announcement: AnnouncementListItem) {
		setEditingAnnouncement(announcement);
		form.setFieldsValue({
			title: announcement.title,
			content: announcement.content,
			category: announcement.category,
			priority: announcement.priority,
			target_role: announcement.target_role,
			is_active: announcement.is_active,
			is_pinned: announcement.is_pinned,
		});
		setCreateModalOpen(true);
	}

	function closeModal() {
		setCreateModalOpen(false);
		setEditingAnnouncement(null);
		form.resetFields();
	}

	async function handleSubmit() {
		try {
			const values = await form.validateFields();
			if (editingAnnouncement) {
				await updateMutation.mutateAsync(values);
				message.success("公告更新成功");
			} else {
				await createMutation.mutateAsync(values);
				message.success("公告创建成功");
			}
			closeModal();
		} catch (error: any) {
			if (error.errorFields) return;
			message.error(error.message || "操作失败");
		}
	}

	function confirmDelete(id: number, title: string) {
		Modal.confirm({
			title: `确认删除公告"${title}"？`,
			okText: "删除",
			okButtonProps: { danger: true },
			cancelText: "取消",
			onOk: async () => {
				try {
					await deleteMutation.mutateAsync(id);
					message.success("公告删除成功");
				} catch (error: any) {
					message.error(error.message || "删除失败");
				}
			},
		});
	}

	const columns = [
		{
			title: "标题",
			dataIndex: "title",
			key: "title",
			render: (title: string, record: AnnouncementListItem) => (
				<Space orientation="vertical" size={0}>
					<Text strong>{title}</Text>
					{record.is_pinned && <Tag color="blue">置顶</Tag>}
					{record.is_expired && <Tag color="red">已过期</Tag>}
				</Space>
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
			title: "目标角色",
			dataIndex: "target_role",
			key: "target_role",
			render: (role: AnnouncementTargetRole) => <Tag>{targetRoleLabels[role]}</Tag>,
			width: 120,
		},
		{
			title: "状态",
			key: "status",
			render: (_: any, record: AnnouncementListItem) => (
				<Space size={8}>
					{record.is_active ? <Tag color="green">启用</Tag> : <Tag color="red">禁用</Tag>}
				</Space>
			),
			width: 120,
		},
		{
			title: "阅读数",
			dataIndex: "read_count",
			key: "read_count",
			width: 100,
		},
		{
			title: "创建人",
			dataIndex: "created_by",
			key: "created_by",
			width: 100,
		},
		{
			title: "创建时间",
			dataIndex: "created_at",
			key: "created_at",
			width: 180,
		},
		{
			title: "操作",
			key: "actions",
			render: (_: any, record: AnnouncementListItem) => (
				<Space size={8}>
					<Button size="small" onClick={() => openEditModal(record)}>
						编辑
					</Button>
					<Button size="small" danger onClick={() => confirmDelete(record.id, record.title)}>
						删除
					</Button>
				</Space>
			),
			width: 150,
		},
	];

	return (
		<Page
			title="公告管理"
			extra={
				<Space>
					<Button type="primary" onClick={openCreateModal}>
						发布公告
					</Button>
				</Space>
			}
		>
			<Card>
				<Form layout="inline">
					<Form.Item label="搜索">
						<Input
							placeholder="标题/内容"
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							style={{ width: 200 }}
							allowClear
						/>
					</Form.Item>
					<Form.Item label="分类">
						<Select value={category} onChange={setCategory} style={{ width: 120 }} allowClear>
							<Option value="system">系统通知</Option>
							<Option value="maintenance">维护通知</Option>
							<Option value="feature">功能更新</Option>
							<Option value="announcement">公告</Option>
						</Select>
					</Form.Item>
					<Form.Item label="优先级">
						<Select value={priority} onChange={setPriority} style={{ width: 100 }} allowClear>
							<Option value="low">低</Option>
							<Option value="medium">中</Option>
							<Option value="high">高</Option>
							<Option value="urgent">紧急</Option>
						</Select>
					</Form.Item>
					<Form.Item label="目标角色">
						<Select value={targetRole} onChange={setTargetRole} style={{ width: 120 }} allowClear>
							<Option value="all">所有用户</Option>
							<Option value="admin">管理员</Option>
							<Option value="operator">操作员</Option>
							<Option value="readonly">只读用户</Option>
						</Select>
					</Form.Item>
					<Form.Item label="状态">
						<Select value={isActive} onChange={setIsActive} style={{ width: 100 }} allowClear>
							<Option value="true">启用</Option>
							<Option value="false">禁用</Option>
						</Select>
					</Form.Item>
				</Form>

				<Table
					rowKey="id"
					columns={columns}
					dataSource={listData?.data || []}
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
					scroll={{ x: 1400 }}
				/>
			</Card>

			<Modal
				open={createModalOpen}
				title={editingAnnouncement ? "编辑公告" : "发布公告"}
				onCancel={closeModal}
				onOk={handleSubmit}
				okText={editingAnnouncement ? "保存" : "发布"}
				cancelText="取消"
				destroyOnHidden
				confirmLoading={createMutation.isPending || updateMutation.isPending}
				width={700}
			>
				<Form form={form} layout="vertical">
					<Form.Item label="标题" name="title" rules={[{ required: true, message: "请输入标题" }]}>
						<Input placeholder="请输入公告标题" />
					</Form.Item>
					<Form.Item label="内容" name="content" rules={[{ required: true, message: "请输入内容" }]}>
						<Input.TextArea rows={6} placeholder="请输入公告内容" />
					</Form.Item>
					<Row gutter={16}>
						<Col span={8}>
							<Form.Item label="分类" name="category" initialValue="announcement">
								<Select>
									<Option value="system">系统通知</Option>
									<Option value="maintenance">维护通知</Option>
									<Option value="feature">功能更新</Option>
									<Option value="announcement">公告</Option>
								</Select>
							</Form.Item>
						</Col>
						<Col span={8}>
							<Form.Item label="优先级" name="priority" initialValue="medium">
								<Select>
									<Option value="low">低</Option>
									<Option value="medium">中</Option>
									<Option value="high">高</Option>
									<Option value="urgent">紧急</Option>
								</Select>
							</Form.Item>
						</Col>
						<Col span={8}>
							<Form.Item label="目标角色" name="target_role" initialValue="all">
								<Select>
									<Option value="all">所有用户</Option>
									<Option value="admin">管理员</Option>
									<Option value="operator">操作员</Option>
									<Option value="readonly">只读用户</Option>
								</Select>
							</Form.Item>
						</Col>
					</Row>
					<Row gutter={16}>
						<Col span={12}>
							<Form.Item label="是否启用" name="is_active" valuePropName="checked" initialValue={true}>
								<Switch />
							</Form.Item>
						</Col>
						<Col span={12}>
							<Form.Item label="是否置顶" name="is_pinned" valuePropName="checked" initialValue={false}>
								<Switch />
							</Form.Item>
						</Col>
					</Row>
				</Form>
			</Modal>
		</Page>
	);
}
