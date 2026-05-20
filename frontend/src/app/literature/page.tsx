"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Alert, Button, Card, Col, Empty, Row, Skeleton, Space, Tag, Typography } from "antd";
import { ArrowRightOutlined, HomeOutlined } from "@ant-design/icons";

const { Paragraph, Text, Title } = Typography;

type DigestItem = {
	slug: string;
	date: string;
	title: string;
	summary: string;
	filename: string;
};

function apiBase() {
	return (process.env.NEXT_PUBLIC_API_BASE || "/api/v2").replace(/\/+$/, "");
}

export default function LiteraturePage() {
	const [items, setItems] = useState<DigestItem[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let alive = true;
		fetch(`${apiBase()}/literature/digests?limit=60`)
			.then(async (res) => {
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				return res.json();
			})
			.then((body) => {
				if (!alive) return;
				setItems(Array.isArray(body?.data) ? body.data : []);
				setError(null);
			})
			.catch((err) => {
				if (!alive) return;
				setError(err?.message || "加载失败");
			})
			.finally(() => {
				if (alive) setLoading(false);
			});
		return () => {
			alive = false;
		};
	}, []);

	return (
		<main style={{ minHeight: "100vh", background: "#f5f4ee", padding: "28px 16px 48px" }}>
			<div style={{ maxWidth: 1080, margin: "0 auto" }}>
				<div style={{ marginBottom: 22, display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
					<div>
						<Space size={8} wrap style={{ marginBottom: 10 }}>
							<Tag color="green">堆肥科研札记</Tag>
							<Tag>文献分析</Tag>
						</Space>
						<Title level={1} style={{ margin: 0, color: "#20372a", fontSize: 34 }}>文献分析</Title>
						<Paragraph style={{ marginTop: 10, marginBottom: 0, color: "#536157", maxWidth: 680, lineHeight: 1.8 }}>
							面向堆肥、资源化利用与环境过程控制的文献导读。公众号可将“阅读原文”链接到这里的对应日期文章。
						</Paragraph>
					</div>
					<Link href="/">
						<Button icon={<HomeOutlined />}>返回系统</Button>
					</Link>
				</div>

				{error ? <Alert type="error" showIcon title="文献列表加载失败" description={error} style={{ marginBottom: 16 }} /> : null}

				{loading ? (
					<Row gutter={[16, 16]}>
						{Array.from({ length: 6 }).map((_, index) => (
							<Col key={index} xs={24} md={12}>
								<Card><Skeleton active paragraph={{ rows: 3 }} /></Card>
							</Col>
						))}
					</Row>
				) : items.length ? (
					<Row gutter={[16, 16]}>
						{items.map((item) => (
							<Col key={item.slug} xs={24} md={12}>
								<Link href={`/literature/${item.slug}`} style={{ display: "block", height: "100%" }}>
									<Card
										hoverable
										style={{ height: "100%", borderRadius: 18, borderColor: "#e0e6dc", background: "#fffdfa" }}
										styles={{ body: { padding: 20 } }}
									>
										<Space size={8} wrap style={{ marginBottom: 10 }}>
											<Tag color="green">{item.date}</Tag>
											<Text type="secondary" style={{ fontSize: 12 }}>{item.filename}</Text>
										</Space>
										<Title level={4} style={{ marginTop: 0, marginBottom: 10, color: "#24382d", lineHeight: 1.45 }}>
											{item.title}
										</Title>
										<Paragraph ellipsis={{ rows: 3 }} style={{ color: "#526157", lineHeight: 1.75, minHeight: 78 }}>
											{item.summary || "暂无摘要。"}
										</Paragraph>
										<Button type="link" style={{ padding: 0, color: "#315540" }}>
											阅读全文 <ArrowRightOutlined />
										</Button>
									</Card>
								</Link>
							</Col>
						))}
					</Row>
				) : (
					<Card style={{ borderRadius: 18 }}>
						<Empty description="还没有已发布的文献分析文章" />
					</Card>
				)}
			</div>
		</main>
	);
}
