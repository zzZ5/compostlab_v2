"use client";

import { useMemo, useState } from "react";
import dayjs, { Dayjs } from "dayjs";
import ReactECharts from "echarts-for-react";
import {
  Button,
  Card,
  Col,
  DatePicker,
  Grid,
  Input,
  Row,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
  message,
} from "antd";

import Page from "@/components/Page";
import { useDevicesTree } from "@/features/devices/queries";
import { useDeviceTelemetry, useMultiDeviceTelemetry } from "@/features/telemetry/queries";
import { api, buildQuery, downloadBlob } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import type { DeviceTreeItem, TelemetryPoint } from "@/types/api";

const { RangePicker } = DatePicker;
const { Text } = Typography;

function fmt(d: Dayjs) {
  return d.format("YYYY-MM-DD HH:mm:ss");
}

type Opt = { value: string | number; label: string };

export default function TelemetryExplorePage() {
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;

  const [kw, setKw] = useState<string>("");
  const [deviceIds, setDeviceIds] = useState<number[]>([]);
  const [channelCodes, setChannelCodes] = useState<string[]>([]);
  const [bucket, setBucket] = useState<string>("");
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>([
    dayjs().subtract(24, "hour"),
    dayjs(),
  ]);

  const devicesQ = useDevicesTree(true);
  const devices = devicesQ.data || [];

  const deviceOptions: Opt[] = useMemo(() => {
    const list = devices
      .filter((d) => {
        if (!kw.trim()) return true;
        const k = kw.trim().toLowerCase();
        return (
          String(d.device_id).includes(k) ||
          (d.code || "").toLowerCase().includes(k) ||
          (d.name || "").toLowerCase().includes(k)
        );
      })
      .slice()
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    return list.map((d) => ({
      value: d.device_id,
      label: `${d.name || "Device"} (#${d.device_id})`,
    }));
  }, [devices, kw]);

  const selectedDevices: DeviceTreeItem[] = useMemo(() => {
    return devices.filter((d) => deviceIds.includes(d.device_id));
  }, [devices, deviceIds]);

  const channelOptions: Opt[] = useMemo(() => {
    // 收集所有选中设备的通道
    const codeSet = new Set<string>();
    for (const d of selectedDevices) {
      for (const c of d.channels) {
        codeSet.add(c.code);
      }
    }
    const uniqueCodes = Array.from(codeSet).sort();

    return uniqueCodes.map((code) => {
      // 查找第一个有该通道的设备获取 display_name 和 unit
      for (const d of selectedDevices) {
        const ch = d.channels.find((c) => c.code === code);
        if (ch) {
          return {
            value: ch.code,
            label: `${ch.display_name || ch.code}${ch.unit ? ` (${ch.unit})` : ""}`,
          };
        }
      }
      return { value: code, label: code };
    });
  }, [selectedDevices]);

  const from = range?.[0] ? fmt(range[0]) : null;
  const to = range?.[1] ? fmt(range[1]) : null;

  // 根据选择模式使用不同的查询
  const telemetryQ = useMultiDeviceTelemetry({
    deviceIds,
    from,
    to,
    bucket: bucket ? bucket : null,
    channels: channelCodes.length ? channelCodes : null,
  });

  const points: TelemetryPoint[] = telemetryQ.data?.data || [];

  const chartOption = useMemo(() => {
    // 跨设备对比：按 "device_id:code" 分组，避免不同设备的相同 code 混在一起
    const byKey = new Map<string, { name: string; data: Array<[string, number]> }>();
    for (const p of points as any[]) {
      const code = p.code || "UNKNOWN";
      const deviceId = (p as any).device_id || "unknown";
      const key = `${deviceId}:${code}`;
      const v = typeof p.value === "number" ? p.value : Number(p.value);
      if (!Number.isFinite(v)) continue;

      // 查找设备名称用于显示
      const deviceName = devices.find((d) => d.device_id === deviceId)?.name || `Device#${deviceId}`;
      const label = `${deviceName}:${code}`;

      if (!byKey.has(key)) {
        byKey.set(key, { name: label, data: [] });
      }
      byKey.get(key)!.data.push([p.ts, v]);
    }

    // sort by time (避免线段回折)
    for (const { data } of byKey.values()) {
      data.sort((a, b) => Date.parse(a[0]) - Date.parse(b[0]));
    }

    // 当数据点过少时，隐藏 slider（否则容易"挤到上面"）
    const uniqueTs = new Set<string>();
    for (const p of points as any[]) if ((p as any)?.ts) uniqueTs.add(String((p as any).ts));
    const enableSlider = uniqueTs.size >= 2;

    const series = Array.from(byKey.values());

    // 说明：默认的 slider dataZoom 会占用底部空间，若 grid.bottom 太小，
    // 会造成 x 轴时间标签与 dataZoom/legend 视觉重叠。
    const dz = enableSlider
      ? isMobile
        ? [{ type: "inside" }]
        : [{ type: "inside" }, { type: "slider", xAxisIndex: 0, height: 20, bottom: 6 }]
      : [];

    return {
      tooltip: { trigger: "axis" },
      legend: { type: "scroll", top: 8, left: 0, right: 0 },
      grid: {
        left: 52,
        right: 18,
        top: 60,
		bottom: isMobile ? 46 : enableSlider ? 58 : 46,
        containLabel: true,
      },
      xAxis: { type: "time", axisLabel: { hideOverlap: true, margin: 6 } },
      yAxis: { type: "value" },
      series: series.map((s) => ({
        name: s.name,
        type: "line",
        showSymbol: s.data.length <= 1,
        data: s.data,
      })),
      dataZoom: dz,
    };
  }, [points, isMobile, devices]);

  async function exportCsv() {
    if (!deviceIds.length) {
      message.warning("请先选择设备");
      return;
    }
    if (!channelCodes.length) {
      message.warning("请至少选择一个通道");
      return;
    }
    try {
      // 多设备导出：使用第一个设备的导出接口（或者后续可以添加多设备导出接口）
      const deviceId = deviceIds[0];
      const qs = buildQuery({ from, to, channels: channelCodes });
      await downloadBlob(
        api,
        `/devices/${deviceId}/export${qs}`,
        `devices_${deviceIds.join("_")}_export.csv`,
        "text/csv;charset=utf-8"
      );
      message.success("已开始下载");
    } catch (e) {
      message.error(getErrorMessage(e, "导出失败"));
    }
  }

  return (
    <Page
      title="数据探索"
      extra={
        <Space wrap>
          <Button onClick={exportCsv}>导出 CSV</Button>
        </Space>
      }
    >
      <Card style={{ marginBottom: 16 }}>
        <Row gutter={[12, 12]} align="middle">
          <Col xs={24} md={8}>
            <Input
              allowClear
              placeholder="搜索设备（名称 / code / ID）"
              value={kw}
              onChange={(e) => setKw(e.target.value)}
            />
          </Col>

          <Col xs={24} md={8}>
            <Select
              style={{ width: "100%" }}
              mode="multiple"
              showSearch
              optionFilterProp="label"
              placeholder="选择设备（可多选）"
              options={deviceOptions}
              value={deviceIds}
              onChange={(v) => {
                const ids = (v as number[]).map(Number).filter(Number.isFinite);
                setDeviceIds(ids);
                setChannelCodes([]);
              }}
              maxTagCount="responsive"
            />
          </Col>

          <Col xs={24} md={8}>
            <Select
              style={{ width: "100%" }}
              mode="multiple"
              placeholder="选择通道（可多选）"
              options={channelOptions}
              value={channelCodes}
              onChange={(v) => setChannelCodes(v as string[])}
              disabled={!deviceIds.length}
              maxTagCount="responsive"
            />
          </Col>

          <Col xs={24} md={12}>
            <RangePicker
              style={{ width: "100%" }}
              showTime
              value={range as any}
              onChange={(v) => setRange((v as any) || null)}
            />
          </Col>

          <Col xs={24} md={6}>
            <Select
              style={{ width: "100%" }}
              value={bucket}
              onChange={(v) => setBucket(v)}
              options={[
                { value: "", label: "raw（原始点）" },
                { value: "1m", label: "1m" },
                { value: "10m", label: "10m" },
                { value: "30m", label: "30m" },
                { value: "1h", label: "1h" },
                { value: "6h", label: "6h" },
                { value: "1d", label: "1d" },
              ]}
            />
          </Col>

          <Col xs={24} md={6}>
            <Space orientation="vertical" size={0}>
              <Text type="secondary">当前选择</Text>
              <div>
                <Tag>{deviceIds.length ? `${deviceIds.length} 个设备` : "未选择设备"}</Tag>
                <Tag>{channelCodes.length ? `${channelCodes.length} 个通道` : "未选择通道"}</Tag>
              </div>
            </Space>
          </Col>
        </Row>
      </Card>

      <Card title="曲线" style={{ marginBottom: 16 }}>
        {telemetryQ.isLoading ? (
          <div style={{ display: "grid", placeItems: "center", minHeight: 320 }}>
            <Spin />
          </div>
        ) : (
          <div style={{ height: 420 }}>
				<ReactECharts
					key={`${deviceIds.join(",")}-${channelCodes.join(",")}-${bucket}-${from || ""}-${to || ""}`}
					option={chartOption}
					notMerge
					lazyUpdate
					style={{ height: "100%", width: "100%" }}
				/>
          </div>
        )}
      </Card>

      <Card title={`数据点（${points.length}）`}>
        <Table
          size="small"
          rowKey={(r) => `${(r as any).code}-${(r as any).ts}-${(r as any).value}`}
          dataSource={points as any}
          pagination={{
            pageSize: 50,
            showSizeChanger: true,
            pageSizeOptions: [20, 50, 100],
            showTotal: (total) => `共 ${total} 条`,
          }}
          scroll={{ x: 900 }}
          columns={[
            { title: "时间", dataIndex: "ts", key: "ts", width: 180 },
            { title: "设备", dataIndex: "device_id", key: "device_id", width: 100 },
            { title: "通道", dataIndex: "code", key: "code", width: 160 },
            {
              title: "数值",
              dataIndex: "value",
              key: "value",
              width: 140,
              render: (v) => (typeof v === "number" ? v : Number(v)),
            },
            { title: "单位", dataIndex: "unit", key: "unit", width: 100 },
            {
              title: "质量",
              dataIndex: "quality",
              key: "quality",
              width: 120,
              render: (_: any, r: any) => {
                if (r && r.quality) return r.quality;
                return "-";
              },
            },
            {
              title: "来源",
              dataIndex: "source",
              key: "source",
              render: (_: any, r: any) => {
                if (r && r.source) return r.source;
                return "-";
              },
            },
          ]}
        />
      </Card>
    </Page>
  );
}
