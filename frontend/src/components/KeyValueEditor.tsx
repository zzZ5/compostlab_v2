"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Input, InputNumber, Select, Space, Switch, Tag, Tooltip, Typography } from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";

import type { KVRow, KVType } from "@/lib/kv";
import { kvPairsToObject, objectToKVPairs } from "@/lib/kv";

const { Text } = Typography;

type Props = {
	value?: Record<string, any> | null;
	onChange?: (next?: Record<string, any>) => void;
	placeholderKey?: string;
	placeholderValue?: string;
	minRows?: number;
};

function uid() {
	return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

export default function KeyValueEditor({
	value,
	onChange,
	placeholderKey = "key",
	placeholderValue = "value",
	minRows = 0,
}: Props) {
	const [rows, setRows] = useState<KVRow[]>(() => objectToKVPairs(value));
	const [warnings, setWarnings] = useState<string[]>([]);

	// sync when external value changes (modal open / edit switch)
	useEffect(() => {
		setRows(objectToKVPairs(value));
		setWarnings([]);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [JSON.stringify(value || {})]);

	// keep at least minRows empty rows
	useEffect(() => {
		if (minRows <= 0) return;
		setRows((prev) => {
			const p = prev || [];
			if (p.length >= minRows) return p;
			const fill = Array.from({ length: minRows - p.length }).map(() => ({
				id: uid(),
				key: "",
				type: "string" as KVType,
				value: "",
			}));
			return [...p, ...fill];
		});
	}, [minRows]);

	const preview = useMemo(() => {
		const { obj, warnings } = kvPairsToObject(rows);
		return { obj, warnings };
	}, [rows]);

	useEffect(() => {
		setWarnings(preview.warnings);
		onChange?.(preview.obj);
	}, [preview.obj, preview.warnings, onChange]);

	function updateRow(id: string, patch: Partial<KVRow>) {
		setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
	}

	function removeRow(id: string) {
		setRows((prev) => prev.filter((r) => r.id !== id));
	}

	function addRow() {
		setRows((prev) => [
			...prev,
			{ id: uid(), key: "", type: "string", value: "" },
		]);
	}

	return (
		<Space orientation="vertical" style={{ width: "100%" }} size={8}>
			{rows.length === 0 && (
				<Text type="secondary" style={{ fontSize: 12 }}>
					暂无配置（可点击“添加键值”）
				</Text>
			)}

			{rows.map((r) => (
				<div
					key={r.id}
					style={{
						display: "grid",
						gridTemplateColumns: "1.2fr 120px 2fr 32px",
						gap: 8,
						alignItems: "start",
					}}
				>
					<Input
						value={r.key}
						onChange={(e) => updateRow(r.id, { key: e.target.value })}
						placeholder={placeholderKey}
					/>

					<Select
						value={r.type}
						onChange={(t: KVType) => {
							// reset value by type
							if (t === "boolean") updateRow(r.id, { type: t, value: !!r.value });
							else if (t === "number") updateRow(r.id, { type: t, value: typeof r.value === "number" ? r.value : Number(r.value) || 0 });
							else if (t === "null") updateRow(r.id, { type: t, value: null });
							else if (t === "json") updateRow(r.id, { type: t, value: typeof r.value === "string" ? r.value : JSON.stringify(r.value ?? {}, null, 2) });
							else updateRow(r.id, { type: t, value: r.value ?? "" });
						}}
						options={[
							{ value: "string", label: "string" },
							{ value: "number", label: "number" },
							{ value: "boolean", label: "boolean" },
							{ value: "json", label: "json" },
							{ value: "null", label: "null" },
						]}
					/>

					<div>
						{r.type === "boolean" ? (
							<Switch checked={!!r.value} onChange={(v) => updateRow(r.id, { value: v })} />
						) : r.type === "number" ? (
							<InputNumber
								value={typeof r.value === "number" ? r.value : Number(r.value)}
								onChange={(v) => updateRow(r.id, { value: v })}
								style={{ width: "100%" }}
							/>
						) : r.type === "null" ? (
							<Tag>NULL</Tag>
						) : r.type === "json" ? (
							<Input.TextArea
								value={typeof r.value === "string" ? r.value : JSON.stringify(r.value ?? {}, null, 2)}
								onChange={(e) => updateRow(r.id, { value: e.target.value })}
								autoSize={{ minRows: 2, maxRows: 8 }}
								placeholder={placeholderValue}
								style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}
							/>
						) : (
							<Input
								value={r.value as any}
								onChange={(e) => updateRow(r.id, { value: e.target.value })}
								placeholder={placeholderValue}
							/>
						)}
					</div>

					<Tooltip title="删除">
						<Button
							type="text"
							icon={<DeleteOutlined />}
							onClick={() => removeRow(r.id)}
						/>
					</Tooltip>
				</div>
			))}

			<Space wrap>
				<Button icon={<PlusOutlined />} onClick={addRow}>
					添加键值
				</Button>
				{warnings.length > 0 && (
					<Tag color="orange">{warnings.length} 个 JSON 解析警告</Tag>
				)}
			</Space>

			{warnings.length > 0 && (
				<div style={{ fontSize: 12, color: "rgba(0,0,0,.45)" }}>
					{warnings.slice(0, 5).map((w, i) => (
						<div key={i}>• {w}</div>
					))}
					{warnings.length > 5 && <div>…</div>}
				</div>
			)}
		</Space>
	);
}
