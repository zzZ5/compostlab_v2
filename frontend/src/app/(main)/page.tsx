"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Card, Col, Grid, Input, Row, Select, Space, Spin, Tag, Tooltip, Typography } from "antd";

import Page from "@/components/Page";
import { useDevicesTree } from "@/features/devices/queries";

import { getOnlineState, onlineTag } from "@/lib/status";
import { evalO2, evalTemp, sevToColor } from "@/lib/alerts";
import { MetricKey, metricLabel, normalizeMetric, getChannelDisplayName } from "@/lib/metrics";
import { pickFeaturedChannels } from "@/lib/channelGroups";

const { Text } = Typography;
const { useBreakpoint } = Grid;

function sevRank(sev: "danger" | "warn" | "ok" | "none") {
  if (sev === "danger") return 3;
  if (sev === "warn") return 2;
  if (sev === "ok") return 1;
  return 0;
}

function overallSev(tempSev: any, o2Sev: any): "danger" | "warn" | "ok" | "none" {
  const r = Math.max(sevRank(tempSev), sevRank(o2Sev));
  return r === 3 ? "danger" : r === 2 ? "warn" : r === 1 ? "ok" : "none";
}

function latestNumber(ch: any): number | null {
	const v = ch?.latest?.value;
	if (typeof v === "number") return v;
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
}

function maxLatest(chs: any[]): number | null {
	let best: number | null = null;
	for (const ch of chs || []) {
		const v = latestNumber(ch);
		if (v === null) continue;
		best = best === null ? v : Math.max(best, v);
	}
	return best;
}

function minLatest(chs: any[]): number | null {
	let best: number | null = null;
	for (const ch of chs || []) {
		const v = latestNumber(ch);
		if (v === null) continue;
		best = best === null ? v : Math.min(best, v);
	}
	return best;
}

export default function DashboardPage() {
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const devicesQ = useDevicesTree(true);
  const devices = devicesQ.data || [];

  // filters
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [alertFilter, setAlertFilter] = useState<string>("all");

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();

    return devices.filter((d) => {
      // status filter
      const state = getOnlineState(d.last_seen_at);
      if (statusFilter !== "all" && state !== statusFilter) return false;

      // alerts (O2 + Temp) —— 不再假设每台设备一定有且仅有一个温度/氧气
      const tempChs = (d.channels || []).filter((ch: any) => normalizeMetric(ch.metric) === "temperature");
      const o2Chs = (d.channels || []).filter((ch: any) => normalizeMetric(ch.metric) === "o2");
      const tempV = maxLatest(tempChs); // 多路温度：取最大值更保守
      const o2V = minLatest(o2Chs); // 多路氧气：取最小值更保守

      const tA = evalTemp(tempV);
      const oA = evalO2(o2V);

      const overall = overallSev(tA.sev, oA.sev);
      if (alertFilter !== "all" && overall !== alertFilter) return false;

      // keyword filter
      if (!qq) return true;
      const hay = `${d.name || ""} ${d.code || ""}`.toLowerCase();
      return hay.includes(qq);
    });
  }, [devices, q, statusFilter, alertFilter]);

  // KPI
  const kpi = useMemo(() => {
    const total = devices.length;
    let online = 0;
    let danger = 0;

    for (const d of devices) {
      const st = getOnlineState(d.last_seen_at);
      if (st === "online") online++;

		const tempChs = (d.channels || []).filter((ch: any) => normalizeMetric(ch.metric) === "temperature");
		const o2Chs = (d.channels || []).filter((ch: any) => normalizeMetric(ch.metric) === "o2");
		const tempV = maxLatest(tempChs);
		const o2V = minLatest(o2Chs);
      const tA = evalTemp(tempV);
      const oA = evalO2(o2V);
      if (overallSev(tA.sev, oA.sev) === "danger") danger++;
    }

    return { total, online, danger };
  }, [devices]);

  if (devicesQ.isLoading) {
    return (
      <div style={{ padding: 48 }}>
        <Spin />
      </div>
    );
  }

  return (
    <Page
      title="Dashboard"
      extra={
        <Space wrap>
          <Input.Search
            placeholder="搜索设备（name / code）"
            allowClear
            style={{ width: isMobile ? 220 : 320 }}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <Select
            style={{ width: 150 }}
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: "all", label: "全部状态" },
              { value: "online", label: "Online" },
              { value: "idle", label: "Idle" },
              { value: "offline", label: "Offline" },
              { value: "unknown", label: "Unknown" },
            ]}
          />
          <Select
            style={{ width: 180 }}
            value={alertFilter}
            onChange={setAlertFilter}
            options={[
              { value: "all", label: "全部告警" },
              { value: "danger", label: "仅危险（低氧/过热）" },
              { value: "warn", label: "仅预警（偏离）" },
              { value: "ok", label: "仅正常" },
              { value: "none", label: "仅无数据" },
            ]}
          />
        </Space>
      }
    >
      {/* KPI */}
      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        <Col xs={12} md={6}>
          <Card>
            <Text type="secondary">设备总数</Text>
            <div style={{ fontSize: 26, fontWeight: 700 }}>{kpi.total}</div>
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card>
            <Text type="secondary">Online</Text>
            <div style={{ fontSize: 26, fontWeight: 700 }}>{kpi.online}</div>
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card>
            <Text type="secondary">危险告警</Text>
            <div style={{ fontSize: 26, fontWeight: 700 }}>{kpi.danger}</div>
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card>
            <Text type="secondary">当前展示</Text>
            <div style={{ fontSize: 26, fontWeight: 700 }}>{filtered.length}</div>
          </Card>
        </Col>
      </Row>

      {/* Cards */}
      <Row gutter={[12, 12]}>
        {filtered.map((d) => {
          const st = onlineTag(getOnlineState(d.last_seen_at));

			// 多路指标（如多点温度）支持：告警用“最保守”的 maxTemp / minO2
			const tempChs = (d.channels || []).filter((ch: any) => normalizeMetric(ch.metric) === "temperature");
			const o2Chs = (d.channels || []).filter((ch: any) => normalizeMetric(ch.metric) === "o2");
			const maxTemp = maxLatest(tempChs);
			const minO2 = minLatest(o2Chs);

			const tA = evalTemp(maxTemp);
			const oA = evalO2(minO2);
          const ov = overallSev(tA.sev, oA.sev);

          const ovTagColor = ov === "danger" ? "red" : ov === "warn" ? "orange" : ov === "ok" ? "green" : "default";
          const ovText = ov === "danger" ? "Danger" : ov === "warn" ? "Warn" : ov === "ok" ? "OK" : "No Data";

			const featured = pickFeaturedChannels(d.channels || [], 5);

			// show metrics present
          const ms = Array.from(
            new Set((d.channels || []).map((c: any) => normalizeMetric(c.metric)))
          ).filter((m) => m !== "unknown") as MetricKey[];

          return (
            <Col key={d.device_id} xs={24} md={12} lg={8}>
              <Link href={`/devices/${d.device_id}`} style={{ display: "block" }}>
                <Card hoverable>
                  {/* header */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {d.name || d.code}
                      </div>
                      <Space size={6} wrap style={{ marginTop: 8 }}>
                        <Tag color={st.color}>{st.text}</Tag>
                        <Tag color="blue">{d.code}</Tag>
                        <Tag color={ovTagColor}>{ovText}</Tag>
                      </Space>
                    </div>

                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 12, color: "rgba(0,0,0,.45)" }}>Last seen</div>
                      <div style={{ fontSize: 12 }}>{d.last_seen_at || "-"}</div>
                    </div>
                  </div>

                  {/* metrics chips */}
                  <div style={{ marginTop: 10 }}>
                    {ms.length ? ms.map((m) => <Tag key={m}>{metricLabel(m)}</Tag>) : <Tag>未分类</Tag>}
                  </div>

							{/* values (dynamic) */}
							<div style={{ marginTop: 12, display: "grid", gap: 8 }}>
								{featured.length ? (
									featured.map((ch: any) => {
										const mk = normalizeMetric(ch.metric) as MetricKey;
										const v = latestNumber(ch);
										const isTemp = mk === "temperature";
										const isO2 = mk === "o2";
										const a = isTemp ? evalTemp(v) : isO2 ? evalO2(v) : null;
										const tag = ch?.latest ? `${ch.latest.value ?? "-"} ${ch.unit || ""}` : "-";
										const displayName = getChannelDisplayName(ch);
										return (
											<div key={ch.code} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
												<Text type="secondary" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
													{displayName}
												</Text>
												<Space size={6}>
													<Tag color={a ? sevToColor(a.sev) : undefined}>{tag}</Tag>
													{a ? (
														<Tooltip title={a.tip}>
															<span style={{ color: "rgba(0,0,0,.45)" }}>ⓘ</span>
														</Tooltip>
													) : null}
												</Space>
											</div>
										);
									})
								) : (
									<div style={{ display: "flex", justifyContent: "space-between" }}>
										<Text type="secondary">暂无通道数据</Text>
										<Tag>-</Tag>
									</div>
								)}
							</div>
                </Card>
              </Link>
            </Col>
          );
        })}
      </Row>
    </Page>
  );
}
