"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Card, Col, Grid, Input, Row, Select, Space, Spin, Tag, Tooltip, Typography, Alert } from "antd";
import { InfoCircleOutlined, ExclamationCircleOutlined } from "@ant-design/icons";

import Page from "@/components/Page";
import { useDevicesTree } from "@/features/devices/queries";
import { useRuns } from "@/features/runs/queries";
import { api } from "@/lib/api";

import { getOnlineState, onlineTag } from "@/lib/status";
import { evalO2, evalTemp, sevToColor } from "@/lib/alerts";
import { MetricKey, metricLabel, normalizeMetric, getChannelDisplayName } from "@/lib/metrics";
import { groupChannelsByMetric, sortChannels } from "@/lib/channelGroups";

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

function getQualityInfo(ch: any): { quality: string; color: string; isBad: boolean } {
	if (!ch?.latest) return { quality: "无数据", color: "default", isBad: true };
	const q = ch.latest.quality || ch.latest.quality_flag || "OK";
	const qUpper = String(q).toUpperCase();
	if (qUpper === "OK") return { quality: "OK", color: "green", isBad: false };
	if (qUpper === "WARN" || qUpper === "WARNING") return { quality: "WARN", color: "orange", isBad: true };
	if (qUpper === "BAD" || qUpper === "ERROR") return { quality: "BAD", color: "red", isBad: true };
	if (qUpper === "ERR") return { quality: "ERR", color: "red", isBad: true };
	return { quality: qUpper, color: "default", isBad: false };
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
  const runsQ = useRuns();
  const runs = runsQ.data || [];
  const [windowsMap, setWindowsMap] = useState<Map<number, any[]>>(new Map());
  const [isLoadingWindows, setIsLoadingWindows] = useState(false);

  // 加载所有 run 的 windows
  useEffect(() => {
    const loadRunWindows = async () => {
      if (runs.length === 0) return;

      setIsLoadingWindows(true);
      const map = new Map<number, any[]>();

      await Promise.all(
        runs.map(async (r: any) => {
          try {
            const wsRes = await api.get(`/runs/${r.run_id}/windows`);
            map.set(r.run_id, wsRes.data.data);
          } catch (e) {
            console.error(`Failed to load windows for run ${r.run_id}`, e);
          }
        })
      );

      setWindowsMap(map);
      setIsLoadingWindows(false);
    };

    loadRunWindows();
  }, [runs]);

  // filters
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [alertFilter, setAlertFilter] = useState<string>("all");
  const [runFilter, setRunFilter] = useState<string | undefined>(undefined);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();

    return devices.filter((d) => {
      // run filter
      if (runFilter !== undefined && runFilter !== "") {
        // 找到该 run 下的所有窗口
        const run = runs.find((r: any) => String(r.run_id) === runFilter);
        if (run) {
          const windows = windowsMap.get(Number(runFilter)) || [];
          // 检查设备是否在该 run 的任何窗口中
          const deviceInRun = windows.some((w: any) =>
            (w.device_ids || []).includes(d.device_id)
          );
          if (!deviceInRun) return false;
        }
      }

      // status filter
      const state = getOnlineState(d.last_seen_at);
      if (statusFilter !== "all" && state !== statusFilter) return false;

      // alerts (O2 + Temp) —— 不再假设每台设备一定有且仅有一个温度/氧气
      const tempChs = (d.channels || []).filter((ch: any) => normalizeMetric(ch.metric) === "temperature");
      const o2Chs = (d.channels || []).filter((ch: any) => normalizeMetric(ch.metric) === "o2");

      // 过滤掉数据质量差的通道
      const validTempChs = tempChs.filter((ch: any) => !getQualityInfo(ch).isBad);
      const validO2Chs = o2Chs.filter((ch: any) => !getQualityInfo(ch).isBad);

      const tempV = maxLatest(validTempChs.length > 0 ? validTempChs : tempChs); // 多路温度：取最大值更保守
      const o2V = minLatest(validO2Chs.length > 0 ? validO2Chs : o2Chs); // 多路氧气：取最小值更保守

      const tA = evalTemp(tempV);
      const oA = evalO2(o2V);

      const overall = overallSev(tA.sev, oA.sev);
      if (alertFilter !== "all" && overall !== alertFilter) return false;

      // keyword filter
      if (!qq) return true;
      const hay = `${d.name || ""} ${d.code || ""}`.toLowerCase();
      return hay.includes(qq);
    });
  }, [devices, q, statusFilter, alertFilter, runFilter, runs, windowsMap]);

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
      title="仪表盘"
      extra={
        <Space wrap>
          <Input.Search
            placeholder="搜索设备（name / code）"
            allowClear
            style={{ width: isMobile ? "100%" : 320 }}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <Select
            style={{ width: isMobile ? "100%" : 150 }}
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
            style={{ width: isMobile ? "100%" : 180 }}
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
          <Select
            style={{ width: isMobile ? "100%" : 200 }}
            value={runFilter}
            onChange={setRunFilter}
            placeholder="按批次筛选设备"
            allowClear
            options={[
              { value: "", label: "全部批次" },
              ...runs.map((r: any) => ({
                value: String(r.run_id),
                label: r.name,
              })),
            ]}
          />
        </Space>
      }
    >
      {/* KPI */}
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}>
          <Card style={{ borderRadius: 6 }}>
            <Text type="secondary">设备总数</Text>
            <div style={{ fontSize: 24, fontWeight: 600 }}>{kpi.total}</div>
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card style={{ borderRadius: 6 }}>
            <Text type="secondary">Online</Text>
            <div style={{ fontSize: 24, fontWeight: 600 }}>{kpi.online}</div>
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card style={{ borderRadius: 6 }}>
            <Text type="secondary">危险告警</Text>
            <div style={{ fontSize: 24, fontWeight: 600 }}>{kpi.danger}</div>
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card style={{ borderRadius: 6 }}>
            <Text type="secondary">当前展示</Text>
            <div style={{ fontSize: 24, fontWeight: 600 }}>{filtered.length}</div>
          </Card>
        </Col>
      </Row>

      {/* Cards */}
      <Row gutter={[12, 12]}>
        {filtered.map((d) => {
          const st = onlineTag(getOnlineState(d.last_seen_at));

			// 多路指标（如多点温度）支持：告警用"最保守"的 maxTemp / minO2
			const tempChs = (d.channels || []).filter((ch: any) => normalizeMetric(ch.metric) === "temperature");
			const o2Chs = (d.channels || []).filter((ch: any) => normalizeMetric(ch.metric) === "o2");

			// 过滤掉数据质量差的通道
			const validTempChs = tempChs.filter((ch: any) => {
				const q = getQualityInfo(ch);
				return !q.isBad;
			});
			const validO2Chs = o2Chs.filter((ch: any) => {
				const q = getQualityInfo(ch);
				return !q.isBad;
			});

			const maxTemp = maxLatest(validTempChs.length > 0 ? validTempChs : tempChs);
			const minO2 = minLatest(validO2Chs.length > 0 ? validO2Chs : o2Chs);

			const tA = evalTemp(maxTemp);
			const oA = evalO2(minO2);
          const ov = overallSev(tA.sev, oA.sev);

			const ovTagColor = ov === "danger" ? "red" : ov === "warn" ? "orange" : ov === "ok" ? "green" : "default";
			const ovText = ov === "danger" ? "Danger" : ov === "warn" ? "Warn" : ov === "ok" ? "OK" : "No Data";

			// 按metric分组
			const metricGroups = groupChannelsByMetric(d.channels || []);

			// show metrics present - 使用metricGroups的顺序，确保与下方显示一致
          const ms = metricGroups.map((g) => g.key).filter((m) => m !== "unknown") as MetricKey[];

          return (
            <Col key={d.device_id} xs={24} md={12} lg={8}>
              <Link href={`/devices/${d.device_id}`} style={{ display: "block" }}>
                <Card hoverable style={{ borderRadius: 6, height: "100%" }}>
                  {/* header */}
                  <div style={{ marginBottom: 12 }}>
                    <div
                      style={{
                        fontSize: 16,
                        fontWeight: 600,
                        marginBottom: 8,
                      }}
                    >
                      {d.name || d.code}
                    </div>
                    <Space size={4} wrap>
                      <Tag color={st.color}>{st.text}</Tag>
                      <Tag color="blue">{d.code}</Tag>
                      <Tag color={ovTagColor}>{ovText}</Tag>
                    </Space>
                  </div>

                  {/* metrics chips */}
                  <div style={{ marginBottom: 8 }}>
                    {ms.length ? ms.map((m) => <Tag key={m}>{metricLabel(m)}</Tag>) : <Tag>未分类</Tag>}
                  </div>

                          {/* values (dynamic) */}
                  <div style={{ marginTop: 8 }}>
                    {metricGroups.length ? (
                      <div>
                        {metricGroups.map((group, idx) => (
                          <div key={group.key}>
                            {/* 不同metric分组之间加分隔线 */}
                            {idx > 0 && <div style={{ height: 1, background: '#f0f0f0', margin: '8px 0' }} />}
                            {/* 该metric下的所有channels */}
                            {sortChannels(group.channels).map((ch: any) => {
                              const mk = normalizeMetric(ch.metric) as MetricKey;
                              const v = latestNumber(ch);
                              const isTemp = mk === "temperature";
                              const isO2 = mk === "o2";
                              const a = isTemp ? evalTemp(v) : isO2 ? evalO2(v) : null;
                              const qualityInfo = getQualityInfo(ch);
                              const tag = ch?.latest
                                ? `${ch.latest.value ?? "-"} ${ch.unit || ""}`
                                : "-";
                              const displayName = getChannelDisplayName(ch);
                              return (
                                <div
                                  key={ch.code}
                                  style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "center",
                                    padding: "3px 0",
                                  }}
                                >
                                  <Text type="secondary" style={{ fontSize: 13 }}>
                                    {displayName}
                                  </Text>
                                  <Space size={6}>
                                    <Tag color={a ? sevToColor(a.sev) : undefined} style={{ fontSize: 12 }}>{tag}</Tag>
                                    <Tag color={qualityInfo.color} style={{ fontSize: 11 }}>
                                      {qualityInfo.quality}
                                    </Tag>
                                    {a && a.sev !== "ok" && a.sev !== "none" && !qualityInfo.isBad && (
                                      <Tooltip title={a.tip}>
                                        {a.sev === "danger" ? (
                                          <ExclamationCircleOutlined
                                            style={{
                                              color: "#ff4d4f",
                                              fontSize: 15,
                                              cursor: "help"
                                            }}
                                          />
                                        ) : (
                                          <InfoCircleOutlined
                                            style={{
                                              color: "#faad14",
                                              fontSize: 15,
                                              cursor: "help"
                                            }}
                                          />
                                        )}
                                      </Tooltip>
                                    )}
                                    </Space>
                                </div>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <Text type="secondary">暂无通道数据</Text>
                    )}
                  </div>

                  {/* last_seen_at */}
                  {d.last_seen_at && (
                    <div style={{ marginTop: 8, paddingTop: 6, borderTop: '1px solid #f0f0f0' }}>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        最后更新：{d.last_seen_at}
                      </Text>
                    </div>
                  )}
                </Card>
              </Link>
            </Col>
          );
        })}
      </Row>
    </Page>
  );
}
