"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Alert, Button, Card, Skeleton, Space, Typography } from "antd";
import { ArrowLeftOutlined, HomeOutlined } from "@ant-design/icons";

const { Text, Title } = Typography;

type DigestDetail = {
	slug: string;
	date: string;
	title: string;
	summary: string;
	filename: string;
	html: string;
};

function apiBase() {
	return (process.env.NEXT_PUBLIC_API_BASE || "/api/v2").replace(/\/+$/, "");
}

export default function LiteratureDetailPage() {
	const params = useParams<{ slug: string }>();
	const iframeRef = useRef<HTMLIFrameElement | null>(null);
	const [digest, setDigest] = useState<DigestDetail | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [height, setHeight] = useState(900);

	useEffect(() => {
		if (!params?.slug) return;
		let alive = true;
		fetch(`${apiBase()}/literature/digests/${encodeURIComponent(params.slug)}`)
			.then(async (res) => {
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				return res.json();
			})
			.then((body) => {
				if (!alive) return;
				setDigest(body?.data || null);
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
	}, [params?.slug]);

	function resizeIframe() {
		const iframe = iframeRef.current;
		const doc = iframe?.contentDocument;
		if (!doc) return;
		setHeight(Math.max(700, doc.documentElement.scrollHeight, doc.body.scrollHeight) + 24);
	}

	return (
		<main style={{ minHeight: "100vh", background: "#f5f4ee", padding: "18px 12px 36px" }}>
			<div style={{ maxWidth: 920, margin: "0 auto" }}>
				<Card style={{ marginBottom: 14, borderRadius: 18, borderColor: "#e0e6dc" }} styles={{ body: { padding: "14px 16px" } }}>
					<Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
						<Space wrap>
							<Link href="/literature">
								<Button icon={<ArrowLeftOutlined />}>文献列表</Button>
							</Link>
							<Link href="/">
								<Button icon={<HomeOutlined />}>返回系统</Button>
							</Link>
						</Space>
						{digest ? <Text type="secondary">{digest.date}</Text> : null}
					</Space>
				</Card>

				{error ? <Alert type="error" showIcon title="文献内容加载失败" description={error} style={{ marginBottom: 14 }} /> : null}

				{loading ? (
					<Card style={{ borderRadius: 18 }}>
						<Skeleton active paragraph={{ rows: 12 }} />
					</Card>
				) : digest ? (
					<>
						<Card style={{ marginBottom: 14, borderRadius: 18, borderColor: "#e0e6dc" }} styles={{ body: { padding: "16px 18px" } }}>
							<Title level={3} style={{ marginTop: 0, marginBottom: 8, color: "#20372a", lineHeight: 1.45 }}>{digest.title}</Title>
							<Text type="secondary">{digest.filename}</Text>
						</Card>
						<iframe
							ref={iframeRef}
							title={digest.title}
							srcDoc={digest.html}
							sandbox="allow-same-origin"
							onLoad={resizeIframe}
							style={{
								width: "100%",
								height,
								border: 0,
								borderRadius: 20,
								background: "#f5f4ee",
								display: "block",
							}}
						/>
					</>
				) : (
					<Alert type="warning" showIcon title="未找到该日期的文献分享" />
				)}
			</div>
		</main>
	);
}
