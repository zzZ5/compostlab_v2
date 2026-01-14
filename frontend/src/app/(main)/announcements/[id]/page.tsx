"use client";

import { useParams, useRouter } from "next/navigation";
import { Card, Descriptions, Tag, Typography, Space, Button } from "antd";
import { ArrowLeftOutlined } from "@ant-design/icons";
import { useEffect, useRef } from "react";

import Page from "@/components/Page";
import { useAnnouncementDetail } from "@/features/announcements/queries";
import type { AnnouncementCategory, AnnouncementPriority, AnnouncementTargetRole } from "@/types/api";

const { Text, Paragraph } = Typography;

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

export default function AnnouncementDetailPage() {
	const params = useParams();
	const router = useRouter();
	const announcementId = parseInt(params.id as string);
	const scrollPositionRef = useRef<number>(0);

	const { data: announcement, isLoading } = useAnnouncementDetail(announcementId);

	// 记录页面进入时的滚动位置
	useEffect(() => {
		scrollPositionRef.current = window.scrollY;
	}, []);

	// 返回处理，保持滚动位置
	function handleBack() {
		// 使用 router.back() 返回，浏览器会自动恢复滚动位置
		router.back();
	}

	return (
		<Page
			title="公告详情"
			extra={
				<Button icon={<ArrowLeftOutlined />} onClick={handleBack}>
					返回
				</Button>
			}
		>
			<Card loading={isLoading}>
				{announcement && (
					<Space direction="vertical" size={24} style={{ width: "100%" }}>
						{/* 标题和标签 */}
						<div>
							<Text strong style={{ fontSize: 20 }}>
								{announcement.title}
							</Text>
							<Space style={{ marginLeft: 12 }}>
								{announcement.is_pinned && <Tag color="blue">置顶</Tag>}
								{announcement.is_expired && <Tag color="red">已过期</Tag>}
								{!announcement.is_active && <Tag color="default">已禁用</Tag>}
							</Space>
						</div>

						{/* 基本信息描述 */}
						<Descriptions column={2} bordered size="middle">
							<Descriptions.Item label="分类">
								<Tag>{categoryLabels[announcement.category]}</Tag>
							</Descriptions.Item>
							<Descriptions.Item label="优先级">
								<Tag color={priorityColors[announcement.priority]}>
									{priorityLabels[announcement.priority]}
								</Tag>
							</Descriptions.Item>
							<Descriptions.Item label="目标角色">
								<Tag>{targetRoleLabels[announcement.target_role]}</Tag>
							</Descriptions.Item>
							<Descriptions.Item label="状态">
								<Tag color={announcement.is_active ? "green" : "red"}>
									{announcement.is_active ? "启用" : "禁用"}
								</Tag>
							</Descriptions.Item>
							<Descriptions.Item label="创建人">
								<Text>{announcement.created_by}</Text>
							</Descriptions.Item>
							<Descriptions.Item label="阅读人数">
								<Text strong>{announcement.read_count}</Text>
							</Descriptions.Item>
							<Descriptions.Item label="创建时间">
								<Text type="secondary">{announcement.created_at}</Text>
							</Descriptions.Item>
							<Descriptions.Item label="更新时间">
								<Text type="secondary">{announcement.updated_at}</Text>
							</Descriptions.Item>
							<Descriptions.Item label="过期时间" span={2}>
								<Text type={announcement.expiry_at && new Date(announcement.expiry_at) < new Date() ? "danger" : undefined}>
									{announcement.expiry_at || "永不过期"}
								</Text>
							</Descriptions.Item>
						</Descriptions>

						{/* 公告内容 */}
						<div style={{ background: "#f5f5f5", padding: 20, borderRadius: 8 }}>
							<Text type="secondary" strong style={{ display: "block", marginBottom: 12 }}>
								公告内容
							</Text>
							<Paragraph
								style={{
									whiteSpace: "pre-wrap",
									lineHeight: 1.8,
									fontSize: 14,
									margin: 0,
								}}
							>
								{announcement.content}
							</Paragraph>
						</div>
					</Space>
				)}
			</Card>
		</Page>
	);
}
