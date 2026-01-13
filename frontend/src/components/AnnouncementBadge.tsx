import { Badge, Button, Dropdown, Space, Typography } from "antd";
import { BellOutlined } from "@ant-design/icons";
import { useState } from "react";

import { useMyAnnouncements } from "@/features/announcements/queries";
import { useMarkAnnouncementAsRead } from "@/features/announcements/mutations";
import type { MyAnnouncement } from "@/types/api";

const { Text } = Typography;

export default function AnnouncementBadge() {
	const [open, setOpen] = useState(false);

	// 获取未读公告（最多显示5条）
	const { data: myAnnouncementsData, isLoading } = useMyAnnouncements({
		page: 1,
		page_size: 5,
		unread_only: true,
	});

	// 标记已读
	const markAsReadMutation = useMarkAnnouncementAsRead();

	const unreadCount = myAnnouncementsData?.unread_count || 0;
	const unreadAnnouncements = myAnnouncementsData?.data || [];

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

		// 显示公告详情（使用 alert 或跳转）
		alert(announcement.content);
	}

	// 查看全部
	function handleViewAll() {
		setOpen(false);
		// 可以跳转到公告列表页
		window.location.href = "/announcements";
	}

	const menuItems = unreadAnnouncements.map((announcement) => ({
		key: announcement.id,
		label: (
			<div
				style={{
					padding: "8px 12px",
					cursor: "pointer",
					maxWidth: 400,
					minWidth: 300,
				}}
				onClick={() => handleViewAnnouncement(announcement)}
			>
				<Space orientation="vertical" size={4} style={{ width: "100%" }}>
					<div
						style={{
							display: "flex",
							justifyContent: "space-between",
							alignItems: "flex-start",
						}}
					>
						<Text strong ellipsis style={{ flex: 1 }}>
							{announcement.title}
						</Text>
						{announcement.priority === "urgent" && (
							<span style={{ color: "#ff4d4f", fontSize: 12, marginLeft: 8 }}>紧急</span>
						)}
						{announcement.priority === "high" && (
							<span style={{ color: "#fa8c16", fontSize: 12, marginLeft: 8 }}>重要</span>
						)}
					</div>
					<Text type="secondary" ellipsis style={{ fontSize: 12, display: "block" }}>
						{announcement.content.substring(0, 100)}
						{announcement.content.length > 100 ? "..." : ""}
					</Text>
					<Text type="secondary" style={{ fontSize: 11 }}>
						{announcement.created_at}
					</Text>
				</Space>
			</div>
		),
	}));

	// 添加"查看全部"选项
	if (unreadAnnouncements.length > 0) {
		menuItems.push({
			key: "view-all" as any,
			label: (
				<div
					style={{
						padding: "8px 12px",
						textAlign: "center",
						borderTop: "1px solid #f0f0f0",
						cursor: "pointer",
					}}
					onClick={handleViewAll}
				>
					<Text style={{ fontSize: 12, color: "#1890ff", cursor: "pointer" }}>
						查看全部公告
					</Text>
				</div>
			),
		});
	}

	return (
		<Dropdown
			menu={{ items: menuItems }}
			trigger={["click"]}
			placement="bottomRight"
			open={open}
			onOpenChange={setOpen}
		>
			<Badge count={unreadCount} overflowCount={99}>
				<Button
					type="text"
					icon={<BellOutlined />}
					loading={isLoading}
					style={{ color: "#1890ff" }}
				/>
			</Badge>
		</Dropdown>
	);
}
