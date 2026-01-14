import { Badge, Button, Dropdown, Space, Typography, Tabs, Tag, Empty } from "antd";
import { BellOutlined, HistoryOutlined } from "@ant-design/icons";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { useMyAnnouncements, useMyHistory } from "@/features/announcements/queries";
import { useMarkAnnouncementAsRead } from "@/features/announcements/mutations";
import type { MyAnnouncement } from "@/types/api";

const { Text } = Typography;

// 格式化日期显示
function formatDate(dateString: string | null) {
	if (!dateString) return "永不过期";
	const date = new Date(dateString);
	const now = new Date();
	const diffMs = now.getTime() - date.getTime();
	const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

	if (diffDays === 0) return "今天";
	if (diffDays === 1) return "昨天";
	if (diffDays < 7) return `${diffDays}天前`;
	if (diffDays < 30) return `${Math.floor(diffDays / 7)}周前`;
	return `${Math.floor(diffDays / 30)}个月前`;
}

// 判断是否已过期
function isExpired(expiryDate: string | null) {
	if (!expiryDate) return false;
	return new Date(expiryDate) < new Date();
}

export default function AnnouncementBadge() {
	const router = useRouter();
	const [open, setOpen] = useState(false);
	const [activeTab, setActiveTab] = useState("unread");

	// 获取未读公告
	const { data: myAnnouncementsData, isLoading: isLoadingUnread } = useMyAnnouncements({
		page: 1,
		page_size: 5,
		unread_only: true,
		enabled: open && activeTab === "unread",
	});

	// 获取历史公告
	const { data: historyData, isLoading: isLoadingHistory } = useMyHistory({
		page: 1,
		page_size: 5,
		enabled: open && activeTab === "history",
	});

	// 标记已读
	const markAsReadMutation = useMarkAnnouncementAsRead();

	const unreadCount = myAnnouncementsData?.unread_count || 0;
	const unreadAnnouncements = myAnnouncementsData?.data || [];
	const historyAnnouncements = historyData?.data || [];

	// 点击查看公告
	async function handleViewAnnouncement(announcement: MyAnnouncement) {
		// 标记为已读
		if (!announcement.is_read) {
			try {
				await markAsReadMutation.mutateAsync(announcement.id);
			} catch (error) {
				console.error("标记已读失败:", error);
			}
		}
		// 跳转到公告详情页（无刷新）
		setOpen(false);
		router.push(`/announcements/${announcement.id}`);
	}

	// 查看全部
	function handleViewAll() {
		setOpen(false);
		if (activeTab === "unread") {
			router.push("/announcements");
		} else {
			router.push("/announcements/history");
		}
	}

	// 优先级颜色
	const priorityColors: Record<string, string> = {
		urgent: "#ff4d4f",
		high: "#fa8c16",
		medium: "#1890ff",
		low: "#52c41a",
	};

	// 优先级标签
	const priorityLabels: Record<string, string> = {
		urgent: "紧急",
		high: "重要",
		medium: "普通",
		low: "低",
	};

	// 渲染公告项
	function renderAnnouncementItem(announcement: MyAnnouncement) {
		const expired = isExpired(announcement.expiry_at);
		return (
			<div
				key={announcement.id}
				style={{
					padding: "12px",
					borderBottom: "1px solid #f0f0f0",
					cursor: "pointer",
					maxWidth: 420,
					minWidth: 320,
					transition: "background-color 0.2s",
				}}
				onClick={() => handleViewAnnouncement(announcement)}
				onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "#f5f5f5"}
				onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "transparent"}
			>
				<Space orientation="vertical" size={6} style={{ width: "100%" }}>
					<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
						<Text strong ellipsis style={{ flex: 1, fontSize: 14 }}>
							{announcement.title}
							{expired && <Tag color="red" style={{ marginLeft: 8, fontSize: 11 }}>已过期</Tag>}
							{announcement.is_pinned && <Tag color="blue" style={{ marginLeft: 4, fontSize: 11 }}>置顶</Tag>}
						</Text>
						{announcement.priority && (
							<Tag color={priorityColors[announcement.priority]} style={{ fontSize: 11, marginLeft: 8 }}>
								{priorityLabels[announcement.priority]}
							</Tag>
						)}
					</div>
					<Text type="secondary" ellipsis style={{ fontSize: 12, display: "block" }}>
						{announcement.content.substring(0, 80)}
						{announcement.content.length > 80 ? "..." : ""}
					</Text>
					<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
						<Space size={8}>
							<Text type="secondary" style={{ fontSize: 11 }}>
								📅 {formatDate(announcement.created_at)}
							</Text>
							{announcement.expiry_at && (
								<Text
									type={expired ? "danger" : "secondary"}
									style={{ fontSize: 11 }}
								>
									⏰ {expired ? "已过期" : formatDate(announcement.expiry_at)}
								</Text>
							)}
						</Space>
					</div>
				</Space>
			</div>
		);
	}

	// 未读公告列表
	const unreadList = (
		<div style={{ maxHeight: 400, overflow: "auto" }}>
			{unreadAnnouncements.length === 0 ? (
				<Empty
					image={Empty.PRESENTED_IMAGE_SIMPLE}
					description="暂无未读公告"
					style={{ padding: "20px 0" }}
				/>
			) : (
				unreadAnnouncements.map(renderAnnouncementItem)
			)}
		</div>
	);

	// 历史公告列表
	const historyList = (
		<div style={{ maxHeight: 400, overflow: "auto" }}>
			{historyAnnouncements.length === 0 ? (
				<Empty
					image={Empty.PRESENTED_IMAGE_SIMPLE}
					description="暂无历史记录"
					style={{ padding: "20px 0" }}
				/>
			) : (
				historyAnnouncements.map(renderAnnouncementItem)
			)}
		</div>
	);

	// 标签页内容
	const tabItems = [
		{
			key: "unread",
			label: (
				<Space size={4}>
					<BellOutlined />
					未读 ({unreadCount})
				</Space>
			),
			children: unreadList,
		},
		{
			key: "history",
			label: (
				<Space size={4}>
					<HistoryOutlined />
					历史记录
				</Space>
			),
			children: historyList,
		},
	];

	return (
		<Dropdown
			trigger={["click"]}
			placement="bottomRight"
			open={open}
			onOpenChange={setOpen}
			dropdownRender={(menu) => (
				<div style={{ background: "#fff", borderRadius: 8, boxShadow: "0 3px 6px -4px rgba(0,0,0,.12), 0 6px 16px 0 rgba(0,0,0,.08), 0 9px 28px 8px rgba(0,0,0,.05)" }}>
					<Tabs
						activeKey={activeTab}
						onChange={setActiveTab}
						items={tabItems}
						size="small"
						style={{ width: 420 }}
					/>
					<div
						style={{
							padding: "8px 12px",
							textAlign: "center",
							borderTop: "1px solid #f0f0f0",
							background: "#fafafa",
						}}
					>
						<Link href={`/announcements/${activeTab === "unread" ? "" : "history"}`}>
							<Text style={{ fontSize: 12, color: "#1890ff", cursor: "pointer" }}>
								查看全部{activeTab === "unread" ? "未读公告" : "历史记录"} →
							</Text>
						</Link>
					</div>
				</div>
			)}
		>
			<Badge count={unreadCount} overflowCount={99}>
				<Button
					type="text"
					icon={<BellOutlined />}
					loading={isLoadingUnread || isLoadingHistory}
					style={{ color: "#1890ff", fontSize: 18 }}
				/>
			</Badge>
		</Dropdown>
	);
}

