"use client";

import { useEffect, useMemo, useState } from "react";
import {
	Alert,
	Button,
	Card,
	Col,
	Divider,
	Empty,
	Form,
	Input,
	InputNumber,
	Modal,
	Row,
	Select,
	Space,
	Switch,
	Table,
	Tabs,
	Tag,
	Typography,
	message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import Page from "@/components/Page";
import { api } from "@/lib/api";
import { detectChannelMetric, normalizeMetric } from "@/lib/metrics";

const { Paragraph, Text, Title } = Typography;

type ScriptType = "threshold" | "schedule" | "hybrid" | "python";
type DeviceProfile = "cp500-v3" | "smart-compost" | "mmcgs" | "generic";

type Device = {
	device_id: number;
	name?: string;
	code?: string;
	meta?: Record<string, unknown> | null;
	configuration?: Record<string, unknown> | null;
	channels?: Channel[];
};

type Channel = {
	channel_id?: number;
	code?: string;
	name?: string;
	display_name?: string;
	unit?: string;
	metric?: string | null;
};

type CommandRow = {
	command: string;
	action?: string;
	duration?: number;
	configText?: string;
};

type Script = {
	id?: number;
	name: string;
	description?: string;
	script_type: ScriptType;
	script_type_display: string;
	is_active: boolean;
	priority: number;
	threshold_config?: Record<string, unknown>;
	schedule_config?: Record<string, unknown>;
	python_code?: string;
	command_template?: Record<string, unknown>;
	device_ids: number[];
};

type ScriptExecution = {
	execution_id: number;
	script_name?: string;
	device_code: string;
	status: string;
	status_display: string;
	trigger_reason: string;
	result?: Record<string, unknown> | null;
	error_message?: string | null;
	started_at?: string;
};

type ExecutionFilter = "all" | "manual" | "threshold_check" | "schedule_check" | "failed";
type RuleStatusFilter = "all" | "active" | "inactive";

type ScriptFormValues = {
	name: string;
	description?: string;
	script_type: ScriptType;
	is_active: boolean;
	priority: number;
	threshold_config?: {
		condition_mode?: "all" | "any";
		metric?: string;
		channel_code?: string;
		operator?: string;
		value?: number;
		conditions?: Array<{
			metric?: string;
			channel_code?: string;
			operator?: string;
			value?: number;
		}>;
	};
	schedule_config?: {
		cron?: string;
	};
	python_code?: string;
	command_template: string;
	target_device_id?: number;
};

type LinkageFormValues = {
	name: string;
	description?: string;
	linkage_type: ScriptType;
	is_active: boolean;
	priority: number;
	sourceDeviceId?: number;
	sourceMetric?: string;
	sourceChannelCode?: string;
	operator?: string;
	threshold?: number;
	conditions?: Array<{
		metric?: string;
		channel_code?: string;
		operator?: string;
		value?: number;
	}>;
	conditionMode?: "all" | "any";
	scheduleCron?: string;
	pythonCode?: string;
	targetDeviceId?: number;
	actionCommand?: string;
	actionType?: string;
	duration?: number;
	actionConfigText?: string;
	elseCommands?: CommandRow[];
	elseActionCommand?: string;
	elseActionType?: string;
	elseDuration?: number;
};

const typeOptions = [
	{ value: "threshold", label: "阈值触发" },
	{ value: "schedule", label: "定时执行" },
	{ value: "hybrid", label: "混合模式" },
	{ value: "python", label: "脚本模式" },
] as const;

const typeColor: Record<ScriptType, string> = {
	threshold: "blue",
	schedule: "green",
	hybrid: "orange",
	python: "purple",
};

const operatorOptions = [">", ">=", "<", "<=", "==", "!="].map((value) => ({
	value,
	label: value,
}));

const conditionModeOptions = [
	{ value: "all", label: "全部满足" },
	{ value: "any", label: "任一满足" },
] as const;

const fallbackMetricOptions = [
	{ value: "temperature", label: "温度" },
	{ value: "humidity", label: "湿度" },
	{ value: "o2", label: "氧气" },
	{ value: "co2", label: "二氧化碳" },
	{ value: "ch4", label: "甲烷" },
	{ value: "co", label: "一氧化碳" },
	{ value: "h2s", label: "硫化氢" },
	{ value: "nh3", label: "氨气" },
	{ value: "moisture", label: "含水率" },
	{ value: "ph", label: "pH" },
	{ value: "flow", label: "流量" },
	{ value: "switch", label: "开关状态" },
] as const;

const commandExamples: Record<ScriptType, string> = {
	threshold: `{
  "commands": [
    { "command": "fan", "action": "on", "duration": 300000 }
  ],
  "else_commands": [
    { "command": "fan", "action": "off" }
  ]
}`,
	schedule: `{
  "commands": [
    { "command": "pump", "action": "on", "duration": 60000 }
  ]
}`,
	hybrid: `{
  "commands": [
    { "command": "pump", "action": "on", "duration": 60000 },
    { "command": "fan", "action": "on", "duration": 120000 }
  ],
  "else_commands": [
    { "command": "fan", "action": "off" }
  ]
}`,
	python: `{
  "commands": [
    { "command": "fan", "action": "on", "duration": 180000 }
  ]
}`,
};

const pythonExample = `temp = get_latest_value("temperature")
commands = []

if temp is not None and temp >= 75:
    commands.append({"command": "fan", "action": "on", "duration": 300000})
else:
    commands.append({"command": "fan", "action": "off"})`;

const linkagePythonExample = `source_temp = get_latest_value("temperature", device_code="CP500-01")
actions = []

if source_temp is not None and source_temp >= 75:
    actions.append({
        "target_device_code": "SMART-01",
        "commands": [{"command": "exhaust", "action": "on", "duration": 300000}]
    })
else:
    actions.append({
        "target_device_code": "SMART-01",
        "commands": [{"command": "exhaust", "action": "off"}]
    })`;

const orchestrationPythonExample = `reactor_temp = get_latest_value("temperature", "TempIn", device_code="CP500-01")
o2_value = get_latest_value("o2", device_code="SMART-01")
humidity = get_latest_value("humidity", device_code="SMART-01")

actions = []

if reactor_temp is not None and reactor_temp >= 70 and o2_value is not None and o2_value <= 8:
    actions.append({
        "target_device_code": "SMART-01",
        "commands": [
            {"command": "exhaust", "action": "on", "duration": 300000}
        ]
    })

if humidity is not None and humidity >= 85:
    actions.append({
        "target_device_code": "CP500-01",
        "commands": [
            {"command": "aeration", "action": "on", "duration": 180000},
            {"command": "pump", "action": "on", "duration": 120000}
        ]
    })`;

const pythonScriptTemplates = [
	{
		key: "single-threshold",
		label: "单设备阈值控制",
		code: pythonExample,
	},
	{
		key: "single-multi-command",
		label: "单设备多动作联动",
		code: `temp = get_latest_value("temperature", "TempIn")
o2_value = get_latest_value("o2")
commands = []

if temp is not None and temp >= 70:
    commands.append({"command": "aeration", "action": "on", "duration": 180000})

if o2_value is not None and o2_value <= 8:
    commands.append({"command": "pump", "action": "on", "duration": 120000})`,
	},
	{
		key: "multi-device-orchestration",
		label: "多设备综合编排",
		code: orchestrationPythonExample,
	},
] as const;

const linkagePythonTemplates = [
	{
		key: "basic-linkage",
		label: "基础跨设备联动",
		code: linkagePythonExample,
	},
	{
		key: "multi-device-orchestration",
		label: "多设备综合编排",
		code: orchestrationPythonExample,
	},
] as const;

function getRecordValue(record: Record<string, unknown> | null | undefined, key: string): string {
	const value = record?.[key];
	return typeof value === "string" ? value : "";
}

function isDeviceProfile(value: string): value is DeviceProfile {
	return value === "cp500-v3" || value === "smart-compost" || value === "mmcgs" || value === "generic";
}

function inferDeviceProfile(device?: Device | null): DeviceProfile {
	const text = [
		device?.code,
		device?.name,
		getRecordValue(device?.meta || undefined, "profile"),
		getRecordValue(device?.meta || undefined, "model"),
		getRecordValue(device?.meta || undefined, "device_type"),
	]
		.filter(Boolean)
		.join(" ")
		.toLowerCase();

	if (isDeviceProfile(getRecordValue(device?.meta || undefined, "profile"))) {
		return getRecordValue(device?.meta || undefined, "profile") as DeviceProfile;
	}
	if (isDeviceProfile(getRecordValue(device?.meta || undefined, "device_type"))) {
		return getRecordValue(device?.meta || undefined, "device_type") as DeviceProfile;
	}
	if (text.includes("mmcgs")) return "mmcgs";
	if (text.includes("cp500")) return "cp500-v3";
	if (text.includes("smartcompost") || text.includes("smart-compost")) return "smart-compost";
	return "generic";
}

function getProfileLabel(profile: DeviceProfile): string {
	switch (profile) {
		case "cp500-v3":
			return "CP500 控制器";
		case "smart-compost":
			return "Smart Compost";
		case "mmcgs":
			return "MMCGS";
		default:
			return "通用设备";
	}
}

function scriptMetricLabel(metric: string) {
	switch (normalizeMetric(metric)) {
		case "temperature":
			return "温度";
		case "humidity":
			return "湿度";
		case "o2":
			return "氧气";
		case "co2":
			return "二氧化碳";
		case "ch4":
			return "甲烷";
		case "co":
			return "一氧化碳";
		case "h2s":
			return "硫化氢";
		case "nh3":
			return "氨气";
		case "moisture":
			return "含水率";
		case "ph":
			return "pH";
		case "flow":
			return "流量";
		case "switch":
			return "开关状态";
		default:
			return metric || "未识别指标";
	}
}

function deviceLabel(device?: Device) {
	return device ? `${device.name || device.code || `设备 ${device.device_id}`} (${device.device_id})` : "-";
}

function safeArray<T>(value: unknown): T[] {
	return Array.isArray(value) ? (value as T[]) : [];
}

function safeRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function getMetricOptionsForDevice(device?: Device | null) {
	const channels = safeArray<Channel>(device?.channels);
	const map = new Map<string, string[]>();
	for (const channel of channels) {
		const metric = detectChannelMetric({
			code: channel.code || "",
			name: channel.name || "",
			display_name: channel.display_name || "",
			unit: channel.unit || "",
			metric: channel.metric || "",
		});
		if (metric === "unknown") continue;
		const codes = map.get(metric) || [];
		const code = String(channel.display_name || channel.name || channel.code || "").trim();
		if (code && !codes.includes(code)) codes.push(code);
		map.set(metric, codes);
	}
	if (!map.size) {
		return fallbackMetricOptions.map((item) => ({ value: item.value, label: item.label }));
	}
	return Array.from(map.entries()).map(([metric, codes]) => ({
		value: metric,
		label: `${scriptMetricLabel(metric)}${codes.length ? ` · ${codes.slice(0, 3).join(" / ")}${codes.length > 3 ? " 等" : ""}` : ""}`,
	}));
}

function getMetricGuideForDevice(device?: Device | null) {
	const channels = safeArray<Channel>(device?.channels);
	const rows = new Map<string, string[]>();
	for (const channel of channels) {
		const metric = detectChannelMetric({
			code: channel.code || "",
			name: channel.name || "",
			display_name: channel.display_name || "",
			unit: channel.unit || "",
			metric: channel.metric || "",
		});
		if (metric === "unknown") continue;
		const key = scriptMetricLabel(metric);
		const code = String(channel.display_name || channel.name || channel.code || "").trim();
		if (!rows.has(key)) rows.set(key, []);
		if (code && !rows.get(key)?.includes(code)) {
			rows.get(key)?.push(code);
		}
	}
	return Array.from(rows.entries());
}

function getChannelOptionsForMetric(device: Device | null | undefined, metricValue?: string) {
	const normalized = normalizeMetric(metricValue || "");
	const channels = safeArray<Channel>(device?.channels);
	if (!channels.length || normalized === "unknown") return [];
	return channels
		.filter((channel) => {
			const metric = detectChannelMetric({
				code: channel.code || "",
				name: channel.name || "",
				display_name: channel.display_name || "",
				unit: channel.unit || "",
				metric: channel.metric || "",
			});
			return metric === normalized;
		})
		.map((channel) => ({
			value: String(channel.code || ""),
			label: `${channel.display_name || channel.name || channel.code || "未命名通道"}${channel.unit ? ` (${channel.unit})` : ""}`,
		}))
		.filter((item) => item.value);
}

function normalizeThresholdConditions(
	config:
		| {
				metric?: string;
				channel_code?: string;
				operator?: string;
				value?: number;
				conditions?: Array<{
					metric?: string;
					channel_code?: string;
					operator?: string;
					value?: number;
				}>;
		  }
		| undefined,
) {
	const rawConditions = Array.isArray(config?.conditions) ? config.conditions : [];
	const list = rawConditions.filter(
		(item) =>
			item &&
			typeof item === "object" &&
			(item.metric || item.channel_code || item.operator || item.value !== undefined),
	);
	if (list.length) return list;
	if (config?.metric || config?.channel_code || config?.operator || config?.value !== undefined) {
		return [
			{
				metric: config.metric,
				channel_code: config.channel_code,
				operator: config.operator,
				value: config.value,
			},
		];
	}
	return [];
}

function typeLabel(type: ScriptType) {
	return typeOptions.find((item) => item.value === type)?.label || type;
}

function parseCommandTemplate(text: string) {
	const parsed = JSON.parse(text);
	if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
		throw new Error("命令模板必须是 JSON 对象");
	}
	if (!Array.isArray((parsed as Record<string, unknown>).commands)) {
		throw new Error("命令模板必须包含 commands 数组");
	}
	return parsed as Record<string, unknown>;
}

function parseConfigText(value: string | undefined) {
	if (!value?.trim()) return {};
	const parsed = JSON.parse(value);
	if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
		throw new Error("配置补丁必须是 JSON 对象");
	}
	return parsed as Record<string, unknown>;
}

function parseCommandRowsForKey(text: string, key: "commands" | "else_commands"): CommandRow[] {
	try {
		const parsed = parseCommandTemplate(text);
		return safeArray<unknown>(parsed[key])
			.filter((item) => item && typeof item === "object" && !Array.isArray(item))
			.map((item) => {
				const row = item as Record<string, unknown>;
				const isConfigUpdate = row.command === "config_update";
				return {
					command: typeof row.command === "string" ? row.command : "pump",
					action: isConfigUpdate ? undefined : typeof row.action === "string" ? row.action : "on",
					duration: typeof row.duration === "number" ? row.duration : undefined,
					configText:
						isConfigUpdate && row.config && typeof row.config === "object" && !Array.isArray(row.config)
							? JSON.stringify(row.config, null, 2)
							: undefined,
				};
			});
	} catch {
		return [];
	}
}

function rowsToText(rows: CommandRow[], extra?: Record<string, unknown>) {
	return rowsToTextForKey(rows, "commands", extra);
}

function rowsToTextForKey(
	rows: CommandRow[],
	key: "commands" | "else_commands",
	extra?: Record<string, unknown>,
) {
	return JSON.stringify(
		{
			...(extra || {}),
			[key]: rows,
		},
		null,
		2,
	);
}

function updateCommandTemplateRows(
	text: string,
	key: "commands" | "else_commands",
	rows: CommandRow[],
) {
	let parsed: Record<string, unknown>;
	try {
		parsed = parseCommandTemplate(text);
	} catch {
		parsed = { commands: [] };
	}
	return JSON.stringify(
		{
			...parsed,
			[key]: rows.map((row) => {
				if (row.command === "config_update") {
					return {
						command: "config_update",
						config: parseConfigText(row.configText),
					};
				}
				return {
					command: row.command,
					action: row.action,
					...(row.duration !== undefined ? { duration: row.duration } : {}),
				};
			}),
		},
		null,
		2,
	);
}

function getDeviceCommandCatalog(profile: DeviceProfile) {
	switch (profile) {
		case "cp500-v3":
			return [
				{ value: "heater", label: "加热器" },
				{ value: "pump", label: "循环泵" },
				{ value: "aeration", label: "曝气" },
				{ value: "config_update", label: "修改设备配置" },
				{ value: "emergency", label: "急停" },
			];
		case "smart-compost":
			return [
				{ value: "aeration", label: "曝气" },
				{ value: "exhaust", label: "排气" },
				{ value: "config_update", label: "修改设备配置" },
				{ value: "restart", label: "重启设备" },
			];
		case "mmcgs":
			return [
				{ value: "config_update", label: "修改设备配置" },
				{ value: "point1", label: "P1 采样" },
				{ value: "point2", label: "P2 采样" },
				{ value: "point3", label: "P3 采样" },
				{ value: "point4", label: "P4 采样" },
				{ value: "point5", label: "P5 采样" },
				{ value: "point6", label: "P6 采样" },
				{ value: "purge", label: "清洗泵" },
				{ value: "restart", label: "重启设备" },
			];
		default:
			return [
				{ value: "config_update", label: "修改设备配置" },
				{ value: "pump", label: "泵" },
				{ value: "fan", label: "风机" },
				{ value: "heater", label: "加热" },
				{ value: "valve", label: "阀门" },
				{ value: "light", label: "灯光" },
				{ value: "mixer", label: "搅拌" },
			];
	}
}

function getCommandActionOptions(command?: string) {
	if (command === "config_update") {
		return [];
	}
	if (command === "restart") {
		return [{ value: "run", label: "执行" }];
	}
	if (command === "emergency") {
		return [
			{ value: "on", label: "进入急停" },
			{ value: "off", label: "解除急停" },
		];
	}
	return [
		{ value: "on", label: "开启" },
		{ value: "off", label: "关闭" },
	];
}

function getDefaultCommandForProfile(profile: DeviceProfile) {
	return getDeviceCommandCatalog(profile)[0]?.value || "pump";
}

function getDefaultActionForCommand(command?: string) {
	return command === "config_update" ? "" : getCommandActionOptions(command)[0]?.value || "on";
}

function toScriptPayload(values: ScriptFormValues) {
	if (
		(values.script_type === "threshold" || values.script_type === "hybrid") &&
		!normalizeThresholdConditions(values.threshold_config).length
	) {
		throw new Error("请补全阈值条件");
	}
	if (
		(values.script_type === "schedule" || values.script_type === "hybrid") &&
		!values.schedule_config?.cron?.trim()
	) {
		throw new Error("请填写 Cron 表达式");
	}
	if (
		values.script_type === "python" &&
		!(values.python_code || "").includes("commands") &&
		!(values.python_code || "").includes("actions")
	) {
		throw new Error("Python 脚本中至少需要定义 commands 或 actions");
	}
	return {
		...values,
		schedule_config:
			values.script_type === "python"
				? values.schedule_config?.cron?.trim()
					? { cron: values.schedule_config.cron.trim() }
					: {}
				: values.schedule_config,
		command_template: parseCommandTemplate(values.command_template),
		device_ids: values.target_device_id ? [values.target_device_id] : [],
	};
}

function toLinkagePayload(values: LinkageFormValues) {
	if (!values.name.trim()) {
		throw new Error("请输入联动名称");
	}
	if (
		values.linkage_type !== "python" &&
		(!values.targetDeviceId ||
			!values.actionCommand ||
			(values.actionCommand !== "config_update" && !values.actionType))
	) {
		throw new Error("请补全联动动作");
	}
	if (
		(values.linkage_type === "threshold" || values.linkage_type === "hybrid") &&
		(!values.sourceDeviceId || !normalizeThresholdConditions({
			conditions: values.conditions,
			metric: values.sourceMetric,
			channel_code: values.sourceChannelCode,
			operator: values.operator,
			value: values.threshold,
		}).length)
	) {
		throw new Error("请补全联动的阈值条件");
	}
	if (
		(values.linkage_type === "schedule" || values.linkage_type === "hybrid") &&
		!(values.scheduleCron || "").trim()
	) {
		throw new Error("请填写联动的定时表达式");
	}
	if (values.linkage_type === "python" && !(values.pythonCode || "").trim()) {
		throw new Error("请填写联动脚本");
	}

	const threshold_config: Record<string, unknown> = {};
	const schedule_config: Record<string, unknown> = {};

	if (values.linkage_type === "threshold" || values.linkage_type === "hybrid") {
		threshold_config.source_device_id = values.sourceDeviceId;
		threshold_config.condition_mode = values.conditionMode || "all";
		const conditions = normalizeThresholdConditions({
			conditions: values.conditions,
			metric: values.sourceMetric,
			channel_code: values.sourceChannelCode,
			operator: values.operator,
			value: values.threshold,
		});
		threshold_config.conditions = conditions;
		if (conditions.length === 1) {
			threshold_config.metric = conditions[0].metric;
			threshold_config.channel_code = conditions[0].channel_code;
			threshold_config.operator = conditions[0].operator;
			threshold_config.value = conditions[0].value;
		}
	}

	if (values.linkage_type === "schedule" || values.linkage_type === "hybrid" || values.linkage_type === "python") {
		if (values.linkage_type !== "python" || (values.scheduleCron || "").trim()) {
		schedule_config.cron = values.scheduleCron;
		}
		if (values.sourceDeviceId) {
			schedule_config.source_device_id = values.sourceDeviceId;
		}
	}

	if (values.linkage_type === "python" && values.sourceDeviceId) {
		threshold_config.source_device_id = values.sourceDeviceId;
	}

	const command_template =
		values.linkage_type === "python"
			? {
					...(values.targetDeviceId ? { target_device_id: values.targetDeviceId } : {}),
					commands: [],
			  }
			: {
					target_device_id: values.targetDeviceId,
					commands: [
						{
							command: values.actionCommand,
							...(values.actionCommand === "config_update"
								? { config: parseConfigText(values.actionConfigText) }
								: { action: values.actionType }),
							...(values.actionCommand !== "config_update" && values.duration !== undefined
								? { duration: values.duration }
								: {}),
						},
					],
					...(safeArray<CommandRow>(values.elseCommands).filter((item) => item.command && item.action).length
						? {
								else_commands: safeArray<CommandRow>(values.elseCommands)
									.filter((item) => item.command && item.action)
									.map((item) => ({
										command: item.command,
										action: item.action,
										...(item.duration !== undefined ? { duration: item.duration } : {}),
									})),
						  }
						: {}),
			  };

	return {
		name: values.name.trim(),
		description: (values.description || "").trim(),
		script_type: values.linkage_type,
		is_active: values.is_active,
		priority: values.priority,
		threshold_config,
		schedule_config,
		python_code: values.linkage_type === "python" ? values.pythonCode || "" : "",
		command_template,
		device_ids: values.targetDeviceId ? [values.targetDeviceId] : [],
	};
}

function indentLines(text: string, spaces = 4) {
	const pad = " ".repeat(spaces);
	return text
		.split("\n")
		.map((line) => (line ? `${pad}${line}` : line))
		.join("\n");
}

function commandRowsToPython(commandTemplateText?: string) {
	return commandRowsToPythonByKey(commandTemplateText, "commands", "commands");
}

function commandRowsToPythonByKey(
	commandTemplateText: string | undefined,
	key: "commands" | "else_commands",
	variableName: string,
) {
	try {
		const parsed = commandTemplateText ? parseCommandTemplate(commandTemplateText) : { commands: [] };
		const commands = safeArray<Record<string, unknown>>(parsed[key]);
		if (!commands.length) return `${variableName} = []`;
		return `${variableName} = ${JSON.stringify(commands, null, 2)}`;
	} catch (error) {
		return `# 当前命令预览无法生成\n# ${error instanceof Error ? error.message : "命令模板格式不正确"}\n${variableName} = []`;
	}
}

function toPythonVarName(value: string, fallback: string) {
	const sanitized = String(value || "")
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");
	return sanitized || fallback;
}

function buildConditionPreview(
	conditions: Array<{
		metric?: string;
		channel_code?: string;
		operator?: string;
		value?: number;
	}>,
	options?: {
		deviceId?: number;
		deviceCode?: string;
	},
) {
	const lines: string[] = [];
	const checks: string[] = [];
	const sourceArgs = options?.deviceCode
		? `, device_code=${JSON.stringify(options.deviceCode)}`
		: typeof options?.deviceId === "number"
		? `, device_id=${options.deviceId}`
		: "";

	(conditions.length ? conditions : [{ metric: "temperature", operator: ">=", value: 0 }]).forEach((condition, index) => {
		const metric = String(condition.metric || "temperature");
		const channelCode = typeof condition.channel_code === "string" ? condition.channel_code : "";
		const variableName = toPythonVarName(channelCode || metric, `value_${index + 1}`);
		const valueExpr = channelCode
			? `get_latest_value(${JSON.stringify(metric)}, ${JSON.stringify(channelCode)}${sourceArgs})`
			: `get_latest_value(${JSON.stringify(metric)}, None${sourceArgs})`;
		lines.push(`${variableName} = ${valueExpr}`);
		checks.push(
			`${variableName} is not None and ${variableName} ${condition.operator || ">="} ${condition.value ?? 0}`,
		);
	});

	return {
		assignments: lines.join("\n"),
		checks,
	};
}

function buildActionPlanPreview(
	targetDevice?: Device | null,
	commandTemplateText?: string,
	variableName = "actions",
) {
	try {
		const parsed = commandTemplateText ? parseCommandTemplate(commandTemplateText) : { commands: [] };
		const commands = safeArray<Record<string, unknown>>(parsed.commands);
		const target: Record<string, unknown> = {
			commands,
		};
		if (typeof targetDevice?.device_id === "number") {
			target.target_device_id = targetDevice.device_id;
		}
		if (targetDevice?.code) {
			target.target_device_code = targetDevice.code;
		}
		return `${variableName} = ${JSON.stringify([target], null, 2)}`;
	} catch (error) {
		return `# 当前动作预览无法生成\n# ${error instanceof Error ? error.message : "动作模板格式不正确"}\n${variableName} = []`;
	}
}

function buildScriptPythonPreview(values: Partial<ScriptFormValues>, targetDevice?: Device | null) {
	const type = values.script_type || "threshold";
	const conditions = normalizeThresholdConditions(values.threshold_config);
	const conditionMode = values.threshold_config?.condition_mode || "all";
	const cron = values.schedule_config?.cron || "0 9 * * *";
	const target = targetDevice?.code || targetDevice?.name || "TARGET_DEVICE";
	const commandBlock = commandRowsToPython(values.command_template);
	const elseCommandBlock = commandRowsToPythonByKey(values.command_template, "else_commands", "commands");
	const hasElseBlock = !elseCommandBlock.trim().endsWith("commands = []");

	if (type === "python") {
		const cronNote = values.schedule_config?.cron?.trim()
			? `# 定时: ${values.schedule_config.cron.trim()}\n`
			: "";
		return `# 单设备规则预览\n# 目标设备: ${target}\n${cronNote}${values.python_code || orchestrationPythonExample}`;
	}

	if (type === "schedule") {
		return `# 单设备规则预览\n# 目标设备: ${target}\n# 定时: ${cron}\n# 该规则会在定时检查命中时执行下列动作\n${commandBlock}`;
	}

	const { assignments, checks } = buildConditionPreview(conditions);
	const joiner = conditionMode === "any" ? "\n    or " : "\n    and ";
	const ifExpr = checks.join(joiner);

	if (type === "hybrid") {
		return `# 单设备规则预览\n# 目标设备: ${target}\n# 条件关系: ${conditionMode === "any" ? "任一满足" : "全部满足"}\n# 定时: ${cron}\n${assignments}\n\nif ${ifExpr}:\n${indentLines(commandBlock)}\nelse:\n${indentLines(hasElseBlock ? elseCommandBlock : "# 未满足阈值条件时，等待下一次定时检查\ncommands = []")}`;
	}

	return `# 单设备规则预览\n# 目标设备: ${target}\n# 条件关系: ${conditionMode === "any" ? "任一满足" : "全部满足"}\n${assignments}\n\nif ${ifExpr}:\n${indentLines(commandBlock)}\nelse:\n${indentLines(hasElseBlock ? elseCommandBlock : "commands = []")}`;
}

function buildLinkagePythonPreview(
	values: Partial<LinkageFormValues>,
	sourceDevice?: Device | null,
	targetDevice?: Device | null,
) {
	try {
		const type = values.linkage_type || "threshold";
		const source = sourceDevice?.code || sourceDevice?.name || "SOURCE_DEVICE";
		const target = targetDevice?.code || targetDevice?.name || "TARGET_DEVICE";
		const conditionMode = values.conditionMode || "all";
		const conditions = normalizeThresholdConditions({
			conditions: values.conditions,
			metric: values.sourceMetric,
			channel_code: values.sourceChannelCode,
			operator: values.operator,
			value: values.threshold,
		});
		const cron = values.scheduleCron || "0 9 * * *";
		const commandTemplateText = rowsToText(
			values.actionCommand
				? [
						{
							command: values.actionCommand,
							action: values.actionType || "on",
							...(values.duration !== undefined ? { duration: values.duration } : {}),
						},
				  ]
				: [],
		);
		const actionBlock = buildActionPlanPreview(targetDevice, commandTemplateText);
		const elseCommandTemplateText = rowsToText(
			safeArray<CommandRow>(values.elseCommands)
				.filter((item) => item.command && item.action)
				.map((item) => ({
					command: item.command,
					action: item.action,
					...(item.duration !== undefined ? { duration: item.duration } : {}),
				})),
		);
		const elseActionBlock = buildActionPlanPreview(targetDevice, elseCommandTemplateText);
		const hasElseActionBlock = !elseActionBlock.trim().endsWith("actions = []");

		if (type === "python") {
			const cronNote = values.scheduleCron?.trim() ? `# 定时: ${values.scheduleCron.trim()}\n` : "";
			return `# 设备联动规则预览\n# 触发设备: ${source}\n# 目标设备: ${target}\n${cronNote}${values.pythonCode || orchestrationPythonExample}`;
		}

		if (type === "schedule") {
			return `# 设备联动规则预览\n# 触发设备: ${source}\n# 目标设备: ${target}\n# 定时: ${cron}\n# 定时命中时，对目标设备执行以下动作\n${actionBlock}`;
		}

		const { assignments, checks } = buildConditionPreview(conditions, {
			deviceId: sourceDevice?.device_id,
			deviceCode: sourceDevice?.code,
		});
		const joiner = conditionMode === "any" ? "\n    or " : "\n    and ";
		const ifExpr = checks.join(joiner);

		if (type === "hybrid") {
			return `# 设备联动规则预览\n# 触发设备: ${source}\n# 目标设备: ${target}\n# 条件关系: ${conditionMode === "any" ? "任一满足" : "全部满足"}\n# 定时: ${cron}\n${assignments}\n\nif ${ifExpr}:\n${indentLines(actionBlock)}\nelse:\n${indentLines(hasElseActionBlock ? elseActionBlock : "# 未满足阈值条件时，等待下一次定时检查\nactions = []")}`;
		}

		return `# 设备联动规则预览\n# 触发设备: ${source}\n# 目标设备: ${target}\n# 条件关系: ${conditionMode === "any" ? "任一满足" : "全部满足"}\n${assignments}\n\nif ${ifExpr}:\n${indentLines(actionBlock)}\nelse:\n${indentLines(hasElseActionBlock ? elseActionBlock : "actions = []")}`;
	} catch (error) {
		return `# 当前预览无法生成\n# ${error instanceof Error ? error.message : "联动配置不完整"}`;
	}
}

function getErrorMessage(error: unknown, fallback: string) {
	if (
		error &&
		typeof error === "object" &&
		"response" in error &&
		error.response &&
		typeof error.response === "object" &&
		"data" in error.response &&
		error.response.data &&
		typeof error.response.data === "object" &&
		"detail" in error.response.data &&
		typeof error.response.data.detail === "string"
	) {
		return error.response.data.detail;
	}
	return fallback;
}

function isLinkageScript(script: Script) {
	const thresholdConfig = (script.threshold_config || {}) as Record<string, unknown>;
	const scheduleConfig = (script.schedule_config || {}) as Record<string, unknown>;
	const commandTemplate = (script.command_template || {}) as Record<string, unknown>;
	return (
		typeof thresholdConfig.source_device_id === "number" ||
		typeof scheduleConfig.source_device_id === "number" ||
		typeof commandTemplate.target_device_id === "number"
	);
}

function summarizeCommands(commandTemplate?: Record<string, unknown>) {
	const commands = safeArray<Record<string, unknown>>(commandTemplate?.commands);
	const elseCommands = safeArray<Record<string, unknown>>(commandTemplate?.else_commands);
	const primary = commands.length
		? commands
				.map((item) => {
					if (item.command === "config_update") {
						const configKeys =
							item.config && typeof item.config === "object" && !Array.isArray(item.config)
								? Object.keys(item.config as Record<string, unknown>)
								: [];
						return `修改配置${configKeys.length ? `：${configKeys.join(" / ")}` : ""}`;
					}
					const duration = typeof item.duration === "number" ? `，持续 ${item.duration} ms` : "";
					return `${String(item.command || "-")} ${String(item.action || "-")}${duration}`;
				})
				.join("；")
		: "未配置动作";
	if (!elseCommands.length) return primary;
	const fallback = elseCommands
		.map((item) => {
			if (item.command === "config_update") {
				const configKeys =
					item.config && typeof item.config === "object" && !Array.isArray(item.config)
						? Object.keys(item.config as Record<string, unknown>)
						: [];
				return `修改配置${configKeys.length ? `：${configKeys.join(" / ")}` : ""}`;
			}
			const duration = typeof item.duration === "number" ? `，持续 ${item.duration} ms` : "";
			return `${String(item.command || "-")} ${String(item.action || "-")}${duration}`;
		})
		.join("；");
	return `${primary}；否则：${fallback}`;
}

function summarizeSingleCondition(script: Script) {
	const thresholdConfig = (script.threshold_config || {}) as Record<string, unknown>;
	const scheduleConfig = (script.schedule_config || {}) as Record<string, unknown>;
	const conditions = normalizeThresholdConditions(thresholdConfig as ScriptFormValues["threshold_config"]);
	const conditionMode = thresholdConfig.condition_mode === "any" ? "any" : "all";
	const conditionText = conditions.length
		? conditions
				.map((condition) => {
					const channelCode = condition.channel_code ? ` · ${String(condition.channel_code)}` : "";
					return `${String(condition.metric || "-")}${channelCode} ${String(condition.operator || "")} ${String(
						condition.value ?? "-",
					)}`;
				})
				.join(conditionMode === "any" ? " 或 " : " 且 ")
		: `${String(thresholdConfig.metric || "-")}${
				typeof thresholdConfig.channel_code === "string" && thresholdConfig.channel_code
					? ` · ${String(thresholdConfig.channel_code)}`
					: ""
		  } ${String(thresholdConfig.operator || "")} ${String(thresholdConfig.value ?? "-")}`;
	if (script.script_type === "schedule") {
		return `按 ${String(scheduleConfig.cron || "-")} 定时执行`;
	}
	if (script.script_type === "python") {
		return "按脚本逻辑判断";
	}
	if (script.script_type === "hybrid") {
		return `${conditionText}，并按 ${String(scheduleConfig.cron || "-")} 定时检查`;
	}
	return conditionText;
}

function summarizeLinkageCondition(script: Script, devices: Device[]) {
	const thresholdConfig = (script.threshold_config || {}) as Record<string, unknown>;
	const scheduleConfig = (script.schedule_config || {}) as Record<string, unknown>;
	const conditions = normalizeThresholdConditions({
		conditions: Array.isArray(thresholdConfig.conditions)
			? (thresholdConfig.conditions as Array<{ metric?: string; channel_code?: string; operator?: string; value?: number }>)
			: undefined,
		metric: typeof thresholdConfig.metric === "string" ? thresholdConfig.metric : undefined,
		channel_code: typeof thresholdConfig.channel_code === "string" ? thresholdConfig.channel_code : undefined,
		operator: typeof thresholdConfig.operator === "string" ? thresholdConfig.operator : undefined,
		value: typeof thresholdConfig.value === "number" ? thresholdConfig.value : undefined,
	});
	const conditionMode = thresholdConfig.condition_mode === "any" ? "any" : "all";
	const sourceDeviceId =
		typeof thresholdConfig.source_device_id === "number"
			? thresholdConfig.source_device_id
			: typeof scheduleConfig.source_device_id === "number"
			? scheduleConfig.source_device_id
			: undefined;
	const sourceDevice = devices.find((item) => item.device_id === sourceDeviceId);
	const sourceLabel = deviceLabel(sourceDevice);
	const conditionText = conditions.length
		? conditions
				.map((condition) => {
					const channelCode = condition.channel_code ? ` · ${String(condition.channel_code)}` : "";
					return `${String(condition.metric || "-")}${channelCode} ${String(condition.operator || "")} ${String(
						condition.value ?? "-",
					)}`;
				})
				.join(conditionMode === "any" ? " 或 " : " 且 ")
		: `${String(thresholdConfig.metric || "-")}${
				typeof thresholdConfig.channel_code === "string" && thresholdConfig.channel_code
					? ` · ${String(thresholdConfig.channel_code)}`
					: ""
		  } ${String(thresholdConfig.operator || "")} ${String(thresholdConfig.value ?? "-")}`;

	if (script.script_type === "schedule") {
		return `${sourceLabel}，按 ${String(scheduleConfig.cron || "-")} 定时触发`;
	}
	if (script.script_type === "python") {
		return `${sourceLabel}，按脚本逻辑判断`;
	}
	if (script.script_type === "hybrid") {
		return `${sourceLabel} 的 ${conditionText}，并按 ${String(scheduleConfig.cron || "-")} 定时检查`;
	}
	return `${sourceLabel} 的 ${conditionText}`;
}

function cloneScriptPayload(script: Script) {
	const commandTemplate = safeRecord(script.command_template);
	return {
		name: `${script.name}（副本）`,
		description: script.description || "",
		script_type: script.script_type,
		is_active: false,
		priority: script.priority,
		threshold_config: safeRecord(script.threshold_config),
		schedule_config: safeRecord(script.schedule_config),
		python_code: script.python_code || "",
		command_template: Array.isArray(commandTemplate.commands) ? commandTemplate : { commands: [] },
		device_ids: safeArray<number>(script.device_ids),
	};
}

function normalizeImportPayload(raw: unknown) {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		throw new Error("导入内容必须是一个 JSON 对象");
	}
	const data = raw as Record<string, unknown>;
	const name = String(data.name || "").trim();
	if (!name) {
		throw new Error("导入内容缺少 name");
	}
	return {
		name,
		description: String(data.description || ""),
		script_type: (typeof data.script_type === "string" ? data.script_type : "threshold") as ScriptType,
		is_active: Boolean(data.is_active),
		priority: typeof data.priority === "number" ? data.priority : 0,
		threshold_config: safeRecord(data.threshold_config),
		schedule_config: safeRecord(data.schedule_config),
		python_code: typeof data.python_code === "string" ? data.python_code : "",
		command_template: (() => {
			const commandTemplate = safeRecord(data.command_template);
			return Array.isArray(commandTemplate.commands) ? commandTemplate : { commands: [] };
		})(),
		device_ids: safeArray<unknown>(data.device_ids).filter((item) => typeof item === "number") as number[],
	};
}

function normalizeImportPayloads(raw: unknown) {
	if (Array.isArray(raw)) {
		if (!raw.length) {
			throw new Error("导入数组不能为空");
		}
		return raw.map((item) => normalizeImportPayload(item));
	}
	return [normalizeImportPayload(raw)];
}

function CommandEditor({
	value,
	onChange,
	commandOptions,
	fieldKey = "commands",
	title = "执行动作",
	emptyTitle = "先新增一条命令，或者直接编辑下面的 JSON。",
	addLabel = "新增命令",
}: {
	value: string;
	onChange: (value: string) => void;
	commandOptions: Array<{ value: string; label: string }>;
	fieldKey?: "commands" | "else_commands";
	title?: string;
	emptyTitle?: string;
	addLabel?: string;
}) {
	const rows = useMemo(() => parseCommandRowsForKey(value, fieldKey), [fieldKey, value]);
	const updateRows = (nextRows: CommandRow[]) => onChange(updateCommandTemplateRows(value, fieldKey, nextRows));

	return (
		<Card
			size="small"
			title={title}
			extra={
				<Button
					size="small"
					onClick={() =>
						updateRows([
							...rows,
							{
								command: commandOptions[0]?.value || "pump",
								action: getDefaultActionForCommand(commandOptions[0]?.value),
								duration: 60000,
							},
						])
					}
				>
					{addLabel}
				</Button>
			}
		>
			<Space orientation="vertical" style={{ width: "100%" }}>
				{!rows.length ? <Alert type="info" showIcon title={emptyTitle} /> : null}
				{rows.map((row, index) => {
					const actionOptions = getCommandActionOptions(row.command);
					const isConfigUpdate = row.command === "config_update";
					return (
						<Space key={`${row.command}-${index}`} wrap align="start">
							<Select
								style={{ width: 160 }}
								options={commandOptions}
								value={row.command}
								onChange={(next) =>
									updateRows(
										rows.map((item, i) =>
											i === index
												? {
														...item,
														command: next,
														action: getDefaultActionForCommand(next),
												  }
												: item,
										),
									)
								}
							/>
							{isConfigUpdate ? (
								<Input.TextArea
									style={{ width: 320 }}
									rows={4}
									value={row.configText}
									placeholder={'例如：{\n  "read_interval": 120000,\n  "pump_run_time": 80000\n}'}
									onChange={(event) =>
										updateRows(
											rows.map((item, i) =>
												i === index
													? {
															...item,
															configText: event.target.value,
													  }
													: item,
											),
										)
									}
								/>
							) : (
								<>
									<Select
										style={{ width: 120 }}
										options={actionOptions}
										value={row.action}
										onChange={(next) =>
											updateRows(rows.map((item, i) => (i === index ? { ...item, action: next } : item)))
										}
									/>
									<InputNumber
										style={{ width: 160 }}
										min={0}
										value={row.duration}
										placeholder="持续时间(ms)"
										onChange={(next) =>
											updateRows(
												rows.map((item, i) =>
													i === index
														? {
																...item,
																duration: typeof next === "number" ? next : undefined,
														  }
														: item,
												),
											)
										}
									/>
								</>
							)}
							<Button danger size="small" onClick={() => updateRows(rows.filter((_, i) => i !== index))}>
								删除
							</Button>
						</Space>
					);
				})}
			</Space>
		</Card>
	);
}
function ScriptModal({
	open,
	script,
	devices,
	loading,
	onClose,
	onSubmit,
}: {
	open: boolean;
	script: Script | null;
	devices: Device[];
	loading: boolean;
	onClose: () => void;
	onSubmit: (values: ReturnType<typeof toScriptPayload>) => void;
}) {
	const [form] = Form.useForm<ScriptFormValues>();
	const currentType = Form.useWatch("script_type", form) ?? "threshold";
	const conditionMode = Form.useWatch(["threshold_config", "condition_mode"], form) ?? "all";
	const commandText = Form.useWatch("command_template", form) ?? "";
	const formValues = Form.useWatch([], form) as Partial<ScriptFormValues> | undefined;
	const targetDeviceId = Form.useWatch("target_device_id", form);
	const targetDevice = useMemo(() => devices.find((device) => device.device_id === targetDeviceId), [devices, targetDeviceId]);
	const targetProfile = inferDeviceProfile(targetDevice);
	const commandOptions = getDeviceCommandCatalog(targetProfile);
	const metricOptions = useMemo(() => getMetricOptionsForDevice(targetDevice), [targetDevice]);
	const metricGuide = useMemo(() => getMetricGuideForDevice(targetDevice), [targetDevice]);
	const scriptPreview = useMemo(
		() => buildScriptPythonPreview(formValues || {}, targetDevice),
		[formValues, targetDevice],
	);

	useEffect(() => {
		if (!open) return;
		form.resetFields();
		const type = script?.script_type ?? "threshold";
		form.setFieldsValue({
			name: script?.name ?? "",
			description: script?.description ?? "",
			script_type: type,
			is_active: script?.is_active ?? true,
			priority: script?.priority ?? 0,
			threshold_config: (script?.threshold_config as ScriptFormValues["threshold_config"]) ?? {
				condition_mode:
					((script?.threshold_config as Record<string, unknown> | undefined)?.condition_mode as "all" | "any") || "all",
				metric: getMetricOptionsForDevice(
					script?.device_ids?.[0] ? devices.find((item) => item.device_id === script.device_ids?.[0]) : undefined,
				)[0]?.value || "temperature",
				channel_code:
					typeof (script?.threshold_config as Record<string, unknown> | undefined)?.channel_code === "string"
						? ((script?.threshold_config as Record<string, unknown>).channel_code as string)
						: undefined,
				operator: ">=",
				value: 75,
				conditions:
					normalizeThresholdConditions(script?.threshold_config as ScriptFormValues["threshold_config"]).length > 0
						? normalizeThresholdConditions(script?.threshold_config as ScriptFormValues["threshold_config"])
						: [
								{
									metric:
										getMetricOptionsForDevice(
											script?.device_ids?.[0] ? devices.find((item) => item.device_id === script.device_ids?.[0]) : undefined,
										)[0]?.value || "temperature",
									operator: ">=",
									value: 75,
								},
						  ],
			},
			schedule_config: (script?.schedule_config as ScriptFormValues["schedule_config"]) ?? {
				cron: "0 9 * * *",
			},
			python_code: script?.python_code ?? pythonExample,
			command_template: JSON.stringify(script?.command_template || parseCommandTemplate(commandExamples[type]), null, 2),
			target_device_id: script?.device_ids?.[0],
		});
	}, [devices, form, open, script, targetProfile]);

	useEffect(() => {
		if (!open || !targetDeviceId) return;
		try {
			const parsed = parseCommandTemplate(commandText || commandExamples[currentType]);
			const commands = Array.isArray(parsed.commands) ? (parsed.commands as Array<Record<string, unknown>>) : [];
			if (!commands.length) return;

			const allowedCommands = new Set(commandOptions.map((item) => item.value));
			const nextCommands = commands.map((item) => {
				const nextCommand = typeof item.command === "string" && allowedCommands.has(item.command) ? item.command : getDefaultCommandForProfile(targetProfile);
				const nextActionOptions = getCommandActionOptions(nextCommand);
				const currentAction = typeof item.action === "string" ? item.action : "";
				const nextAction = nextActionOptions.some((opt) => opt.value === currentAction) ? currentAction : getDefaultActionForCommand(nextCommand);
				return { ...item, command: nextCommand, action: nextAction };
			});

			form.setFieldValue("command_template", JSON.stringify({ ...parsed, commands: nextCommands }, null, 2));
		} catch {
			// Keep raw text untouched if user is still editing invalid JSON.
		}
	}, [commandOptions, commandText, currentType, form, open, targetDeviceId, targetProfile]);

	const content = (
		<Row gutter={[20, 20]}>
				<Col xs={24} xl={15}>
					<Form
						form={form}
						layout="vertical"
						onFinish={(values) => {
							try {
								onSubmit(toScriptPayload(values));
							} catch (error) {
								message.error(error instanceof Error ? error.message : "保存失败");
							}
						}}
					>
						<Card size="small" title="基本信息" style={{ marginBottom: 16 }}>
							<Row gutter={12}>
								<Col xs={24} md={14}>
									<Form.Item label="规则名称" name="name" rules={[{ required: true, message: "请输入规则名称" }]}> 
										<Input placeholder="例如：高温开启排风" />
									</Form.Item>
								</Col>
								<Col xs={24} md={10}>
									<Form.Item label="规则类型" name="script_type" rules={[{ required: true, message: "请选择规则类型" }]}> 
										<Select options={typeOptions as never} />
									</Form.Item>
								</Col>
							</Row>

							<Form.Item label="规则说明" name="description">
								<Input.TextArea rows={2} placeholder="写清楚这条规则的触发条件和预期动作。" />
							</Form.Item>

							<Row gutter={12}>
								<Col xs={24} md={16}>
									<Form.Item label="目标设备" name="target_device_id">
										<Select
											allowClear
											placeholder="选择执行动作的设备"
											options={devices.map((device) => ({ value: device.device_id, label: deviceLabel(device) }))}
										/>
									</Form.Item>
								</Col>
								<Col xs={12} md={4}>
									<Form.Item label="启用状态" name="is_active" valuePropName="checked">
										<Switch checkedChildren="启用" unCheckedChildren="停用" />
									</Form.Item>
								</Col>
								<Col xs={12} md={4}>
									<Form.Item label="优先级" name="priority">
										<InputNumber min={0} style={{ width: "100%" }} />
									</Form.Item>
								</Col>
							</Row>

							{targetDevice ? (
								<Paragraph type="secondary" style={{ marginBottom: 0 }}>
									目标设备：<Tag color="blue">{getProfileLabel(targetProfile)}</Tag>，动作选项已自动适配。
								</Paragraph>
							) : null}
						</Card>

						{currentType === "threshold" || currentType === "schedule" || currentType === "hybrid" ? (
							<Card size="small" title="触发条件" style={{ marginBottom: 16 }}>
								{currentType === "threshold" || currentType === "hybrid" ? (
									<>
										<Form.Item
											label="条件关系"
											name={["threshold_config", "condition_mode"]}
											initialValue="all"
											style={{ marginBottom: 8 }}
										>
											<Select style={{ width: 160 }} options={conditionModeOptions as never} />
										</Form.Item>
										<Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
											{conditionMode === "any" ? "任一条件满足即可触发。" : "默认全部条件同时满足后触发。"}
										</Text>
										<Form.List name={["threshold_config", "conditions"]}>
										{(fields, { add, remove }) => (
											<Space orientation="vertical" style={{ width: "100%" }} size={12}>
												{fields.map((field, index) => {
													const metricValue = form.getFieldValue(["threshold_config", "conditions", field.name, "metric"]);
													const channelOptions = getChannelOptionsForMetric(targetDevice, metricValue);
													return (
														<Space key={field.key} wrap align="start">
															<Form.Item label={index === 0 ? "监控指标" : " "} name={[field.name, "metric"]} rules={[{ required: true, message: "请选择指标" }]}>
																<Select style={{ width: 220 }} options={metricOptions} />
															</Form.Item>
															<Form.Item label={index === 0 ? "监控通道" : " "} name={[field.name, "channel_code"]}>
																<Select allowClear style={{ width: 260 }} options={channelOptions} placeholder="选择具体通道" />
															</Form.Item>
															<Form.Item label={index === 0 ? "比较符" : " "} name={[field.name, "operator"]} rules={[{ required: true, message: "请选择比较符" }]}>
																<Select style={{ width: 100 }} options={operatorOptions} />
															</Form.Item>
															<Form.Item label={index === 0 ? "阈值" : " "} name={[field.name, "value"]} rules={[{ required: true, message: "请输入阈值" }]}>
																<InputNumber style={{ width: 140 }} />
															</Form.Item>
															<Button danger size="small" onClick={() => remove(field.name)} disabled={fields.length <= 1}>
																删除
															</Button>
														</Space>
													);
												})}
												<Button size="small" onClick={() => add({ metric: metricOptions[0]?.value || "temperature", operator: ">=", value: 0 })}>
													新增条件
												</Button>
											</Space>
										)}
										</Form.List>
									</>
								) : null}

								{currentType === "schedule" || currentType === "hybrid" ? (
									<Form.Item
										label="Cron 表达式"
										name={["schedule_config", "cron"]}
										style={{ marginBottom: currentType === "schedule" ? 0 : undefined }}
									>
										<Input placeholder="例如：0 9 * * *" />
									</Form.Item>
								) : null}
							</Card>
						) : null}

						{currentType === "python" ? (
							<Card size="small" title="脚本逻辑（可选定时）" style={{ marginBottom: 16 }}>
								<Space wrap style={{ marginBottom: 12 }}>
									<Text type="secondary">快速模板</Text>
									{pythonScriptTemplates.map((template) => (
										<Button
											key={template.key}
											size="small"
											onClick={() => form.setFieldValue("python_code", template.code)}
										>
											{template.label}
										</Button>
									))}
								</Space>
								<Form.Item label="Python 脚本" name="python_code" rules={[{ required: true, message: "请输入 Python 脚本" }]}> 
									<Input.TextArea rows={10} style={{ fontFamily: "Consolas, monospace", fontSize: 12 }} />
								</Form.Item>
								<Form.Item label="Cron 表达式（可选）" name={["schedule_config", "cron"]} style={{ marginBottom: 0 }}>
									<Input placeholder="例如：0 */2 * * *；留空表示仅手动执行" />
								</Form.Item>
							</Card>
						) : null}

						{currentType !== "python" ? (
							<>
								<CommandEditor value={commandText} onChange={(next) => form.setFieldValue("command_template", next)} commandOptions={commandOptions} />
								<div style={{ marginTop: 12 }}>
									<CommandEditor
										value={commandText}
										onChange={(next) => form.setFieldValue("command_template", next)}
										commandOptions={commandOptions}
										fieldKey="else_commands"
										title="未满足时动作（可选）"
										emptyTitle="留空则不执行备用动作。"
										addLabel="新增 else 动作"
									/>
								</div>

								<Card
									size="small"
									title="完整动作模板"
									style={{ marginTop: 16 }}
									extra={<Button size="small" onClick={() => form.setFieldValue("command_template", commandExamples[currentType])}>填入教学示例</Button>}
								>
									<Form.Item
										label="命令 JSON"
										name="command_template"
										rules={[
											{ required: true, message: "请输入命令模板" },
											{
												validator: async (_, value?: string) => {
													if (!value?.trim()) throw new Error("请输入命令模板");
													parseCommandTemplate(value);
												},
											},
										]}
									>
										<Input.TextArea rows={12} style={{ fontFamily: "Consolas, monospace", fontSize: 12 }} />
									</Form.Item>
								</Card>
							</>
						) : null}
					</Form>
				</Col>

				<Col xs={24} xl={9}>
					<Card size="small" title="规则说明与预览">
						<Tag color={typeColor[currentType]}>{typeLabel(currentType)}</Tag>
						<Paragraph style={{ marginTop: 12 }}>
							{currentType === "threshold"
								? "适合按单个指标触发动作。"
								: currentType === "schedule"
								? "适合做固定周期任务。"
								: currentType === "hybrid"
								? "适合定时兜底加阈值保护。"
								: "适合写更复杂的判断逻辑。"}
						</Paragraph>
						<Paragraph type="secondary">
							脚本里使用的指标名是 <Text code>temperature</Text>、<Text code>humidity</Text>、<Text code>o2</Text>、<Text code>co2</Text> 这种语义指标，不是 <Text code>TempIn</Text>、<Text code>AirTemp</Text> 这类原始通道 code。
						</Paragraph>
						{currentType === "python" ? (
							<Paragraph type="secondary">
								Python 模式支持更复杂的组合判断。你可以读取多个设备、多个通道的值；如果需要控制多台设备，可以返回 <Text code>actions</Text> 列表，而不只是单个 <Text code>commands</Text>。如果再填写可选的 <Text code>Cron</Text>，这段脚本也会按定时自动执行。
							</Paragraph>
						) : null}
						{currentType !== "python" ? (
							<Paragraph type="secondary">
								结构化规则支持可选的 <Text code>else_commands</Text>。当条件不满足时，可以执行一组备用动作；如果留空，则默认不执行任何动作。
							</Paragraph>
						) : null}
						<ul style={{ paddingLeft: 18, marginBottom: 12 }}>
							<li>先选目标设备，再补触发条件和动作。</li>
							<li>建议先从单条动作开始，再逐步增加复杂度。</li>
							<li>保存后先手动执行一次，再查看执行记录。</li>
							<li>“监控指标”对应的是设备的语义指标，不是原始通道 code。</li>
							<li>如果一个指标下有多个通道，建议再明确选择“监控通道”。</li>
						</ul>
						<Divider style={{ margin: "12px 0" }} />
						<Title level={5} style={{ marginTop: 0 }}>最终 Python 脚本预览</Title>
						<pre style={{ background: "#f6f8fa", borderRadius: 8, padding: 12, fontSize: 12, overflowX: "auto", marginBottom: 12 }}>{scriptPreview}</pre>
						<Title level={5}>当前设备可用指标</Title>
						{targetDevice ? (
							metricGuide.length ? (
								<Space orientation="vertical" size={6} style={{ width: "100%" }}>
									{metricGuide.map(([metric, codes]) => (
										<Text key={metric}>{metric}：{codes.join(" / ")}</Text>
									))}
								</Space>
							) : (
								<Text type="secondary">当前设备还没有通道信息，暂时使用通用指标。</Text>
							)
						) : (
							<Text type="secondary">先选择目标设备，再查看当前设备可用指标。</Text>
						)}
					</Card>
				</Col>
			</Row>
	);

	return open ? (
		<Card
			style={{ marginBottom: 16 }}
			title={script ? "编辑单设备规则" : "新建单设备规则"}
			extra={
				<Space>
					<Button onClick={onClose}>取消</Button>
					<Button type="primary" loading={loading} onClick={() => form.submit()}>
						{script ? "保存规则" : "创建规则"}
					</Button>
				</Space>
			}
		>
			{content}
		</Card>
	) : null;
}

function LinkageModal({
	open,
	script,
	devices,
	loading,
	onClose,
	onSubmit,
}: {
	open: boolean;
	script: Script | null;
	devices: Device[];
	loading: boolean;
	onClose: () => void;
	onSubmit: (values: ReturnType<typeof toLinkagePayload>) => void;
}) {
	const [form] = Form.useForm<LinkageFormValues>();
	const linkageType = Form.useWatch("linkage_type", form) ?? "threshold";
	const linkageConditionMode = Form.useWatch("conditionMode", form) ?? "all";
	const formValues = Form.useWatch([], form) as Partial<LinkageFormValues> | undefined;
	const targetDeviceId = Form.useWatch("targetDeviceId", form);
	const targetDevice = useMemo(() => devices.find((device) => device.device_id === targetDeviceId), [devices, targetDeviceId]);
	const targetProfile = inferDeviceProfile(targetDevice);
	const commandOptions = getDeviceCommandCatalog(targetProfile);
	const sourceDeviceId = Form.useWatch("sourceDeviceId", form);
	const sourceDevice = useMemo(() => devices.find((device) => device.device_id === sourceDeviceId), [devices, sourceDeviceId]);
	const sourceMetricOptions = useMemo(() => getMetricOptionsForDevice(sourceDevice), [sourceDevice]);
	const sourceMetricGuide = useMemo(() => getMetricGuideForDevice(sourceDevice), [sourceDevice]);
	const currentCommand = Form.useWatch("actionCommand", form);
	const actionOptions = getCommandActionOptions(currentCommand);
	const deviceOptions = useMemo(() => devices.map((device) => ({ value: device.device_id, label: deviceLabel(device) })), [devices]);
	const linkagePreview = useMemo(
		() => buildLinkagePythonPreview(formValues || {}, sourceDevice, targetDevice),
		[formValues, sourceDevice, targetDevice],
	);

	useEffect(() => {
		if (!open) return;
		form.resetFields();
		const thresholdConfig = (script?.threshold_config || {}) as Record<string, unknown>;
		const scheduleConfig = (script?.schedule_config || {}) as Record<string, unknown>;
		const commandTemplate = (script?.command_template || {}) as Record<string, unknown>;
		const firstCommand = Array.isArray(commandTemplate.commands) ? (commandTemplate.commands[0] as Record<string, unknown> | undefined) : undefined;

		form.setFieldsValue({
			name: script?.name ?? "",
			description: script?.description ?? "",
			linkage_type: script?.script_type ?? "threshold",
			is_active: script?.is_active ?? true,
			priority: script?.priority ?? 0,
			sourceDeviceId: typeof thresholdConfig.source_device_id === "number" ? thresholdConfig.source_device_id : typeof scheduleConfig.source_device_id === "number" ? scheduleConfig.source_device_id : undefined,
			conditionMode:
				(typeof thresholdConfig.condition_mode === "string" &&
				(thresholdConfig.condition_mode === "all" || thresholdConfig.condition_mode === "any")
					? thresholdConfig.condition_mode
					: "all"),
			sourceMetric:
				typeof thresholdConfig.metric === "string"
					? thresholdConfig.metric
					: getMetricOptionsForDevice(
							typeof thresholdConfig.source_device_id === "number"
								? devices.find((item) => item.device_id === thresholdConfig.source_device_id)
								: typeof scheduleConfig.source_device_id === "number"
								? devices.find((item) => item.device_id === scheduleConfig.source_device_id)
								: undefined,
					  )[0]?.value || "temperature",
			sourceChannelCode:
				typeof thresholdConfig.channel_code === "string" ? thresholdConfig.channel_code : undefined,
			operator: typeof thresholdConfig.operator === "string" ? thresholdConfig.operator : ">=",
			threshold: typeof thresholdConfig.value === "number" ? thresholdConfig.value : 75,
			conditions:
				normalizeThresholdConditions({
					conditions: Array.isArray(thresholdConfig.conditions) ? (thresholdConfig.conditions as Array<Record<string, unknown>>) : undefined,
					metric: typeof thresholdConfig.metric === "string" ? thresholdConfig.metric : undefined,
					channel_code: typeof thresholdConfig.channel_code === "string" ? thresholdConfig.channel_code : undefined,
					operator: typeof thresholdConfig.operator === "string" ? thresholdConfig.operator : undefined,
					value: typeof thresholdConfig.value === "number" ? thresholdConfig.value : undefined,
				}).length > 0
					? normalizeThresholdConditions({
							conditions: Array.isArray(thresholdConfig.conditions) ? (thresholdConfig.conditions as Array<Record<string, unknown>>) : undefined,
							metric: typeof thresholdConfig.metric === "string" ? thresholdConfig.metric : undefined,
							channel_code: typeof thresholdConfig.channel_code === "string" ? thresholdConfig.channel_code : undefined,
							operator: typeof thresholdConfig.operator === "string" ? thresholdConfig.operator : undefined,
							value: typeof thresholdConfig.value === "number" ? thresholdConfig.value : undefined,
					  })
					: [{ metric: "temperature", operator: ">=", value: 75 }],
			scheduleCron: typeof scheduleConfig.cron === "string" ? scheduleConfig.cron : "0 9 * * *",
			pythonCode: script?.python_code || linkagePythonExample,
			targetDeviceId: typeof commandTemplate.target_device_id === "number" ? commandTemplate.target_device_id : script?.device_ids?.[0],
			actionCommand: typeof firstCommand?.command === "string" ? firstCommand.command : undefined,
			actionType: typeof firstCommand?.action === "string" ? firstCommand.action : undefined,
			duration: typeof firstCommand?.duration === "number" ? firstCommand.duration : 300000,
			actionConfigText:
				firstCommand?.command === "config_update" &&
				firstCommand.config &&
				typeof firstCommand.config === "object" &&
				!Array.isArray(firstCommand.config)
					? JSON.stringify(firstCommand.config, null, 2)
					: undefined,
			elseActionCommand:
				Array.isArray(commandTemplate.else_commands) && typeof (commandTemplate.else_commands[0] as Record<string, unknown> | undefined)?.command === "string"
					? ((commandTemplate.else_commands[0] as Record<string, unknown>).command as string)
					: undefined,
			elseActionType:
				Array.isArray(commandTemplate.else_commands) && typeof (commandTemplate.else_commands[0] as Record<string, unknown> | undefined)?.action === "string"
					? ((commandTemplate.else_commands[0] as Record<string, unknown>).action as string)
					: undefined,
			elseDuration:
				Array.isArray(commandTemplate.else_commands) && typeof (commandTemplate.else_commands[0] as Record<string, unknown> | undefined)?.duration === "number"
					? ((commandTemplate.else_commands[0] as Record<string, unknown>).duration as number)
					: undefined,
			elseCommands:
				Array.isArray(commandTemplate.else_commands)
					? safeArray<Record<string, unknown>>(commandTemplate.else_commands).map((item) => ({
							command: typeof item.command === "string" ? item.command : getDefaultCommandForProfile(targetProfile),
							action:
								typeof item.action === "string"
									? item.action
									: getDefaultActionForCommand(
											typeof item.command === "string" ? item.command : getDefaultCommandForProfile(targetProfile),
									  ),
							duration: typeof item.duration === "number" ? item.duration : undefined,
					  }))
					: [],
		});
	}, [devices, form, open, script, targetProfile]);

	useEffect(() => {
		if (!open || !targetDeviceId) return;
		const allowedCommands = new Set(commandOptions.map((item) => item.value));
		if (!currentCommand || !allowedCommands.has(currentCommand)) {
			const nextCommand = getDefaultCommandForProfile(targetProfile);
			form.setFieldValue("actionCommand", nextCommand);
			form.setFieldValue("actionType", getDefaultActionForCommand(nextCommand));
			return;
		}
		if (!actionOptions.some((item) => item.value === form.getFieldValue("actionType"))) {
			form.setFieldValue("actionType", getDefaultActionForCommand(currentCommand));
		}
	}, [actionOptions, commandOptions, currentCommand, form, open, targetDeviceId, targetProfile]);

	const content = (
		<Row gutter={[20, 20]}>
				<Col xs={24} xl={15}>
					<Form form={form} layout="vertical" onFinish={(values) => { try { onSubmit(toLinkagePayload(values)); } catch (error) { message.error(error instanceof Error ? error.message : "保存失败"); } }}>
						<Card size="small" title="基本信息" style={{ marginBottom: 16 }}>
							<Row gutter={12}>
								<Col xs={24} md={14}>
									<Form.Item label="规则名称" name="name" rules={[{ required: true, message: "请输入规则名称" }]}> 
										<Input placeholder="例如：堆体高温时开启排气" />
									</Form.Item>
								</Col>
								<Col xs={24} md={10}>
									<Form.Item label="规则类型" name="linkage_type" rules={[{ required: true, message: "请选择规则类型" }]}> 
										<Select options={typeOptions as never} />
									</Form.Item>
								</Col>
							</Row>

							<Form.Item label="规则说明" name="description">
								<Input.TextArea rows={2} placeholder="写清楚触发设备、目标设备和预期动作。" />
							</Form.Item>

							<Row gutter={12}>
								<Col xs={12} md={4}>
									<Form.Item label="启用状态" name="is_active" valuePropName="checked">
										<Switch checkedChildren="启用" unCheckedChildren="停用" />
									</Form.Item>
								</Col>
								<Col xs={12} md={4}>
									<Form.Item label="优先级" name="priority">
										<InputNumber min={0} style={{ width: "100%" }} />
									</Form.Item>
								</Col>
							</Row>
						</Card>

						<Card size="small" title="触发条件" style={{ marginBottom: 16 }}>
							<Form.Item label="触发设备" name="sourceDeviceId" rules={linkageType === "threshold" || linkageType === "hybrid" ? [{ required: true, message: "请选择触发设备" }] : undefined}>
								<Select allowClear options={deviceOptions} placeholder="选择提供条件的设备" />
							</Form.Item>

							{linkageType === "threshold" || linkageType === "hybrid" ? (
								<>
									<Form.Item label="条件关系" name="conditionMode" initialValue="all" style={{ marginBottom: 8 }}>
										<Select style={{ width: 160 }} options={conditionModeOptions as never} />
									</Form.Item>
									<Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
										{linkageConditionMode === "any" ? "任一条件满足即可触发。" : "默认全部条件同时满足后触发。"}
									</Text>
									<Form.List name="conditions">
									{(fields, { add, remove }) => (
										<Space orientation="vertical" style={{ width: "100%" }} size={12}>
											{fields.map((field, index) => {
												const metricValue = form.getFieldValue(["conditions", field.name, "metric"]);
												const channelOptions = getChannelOptionsForMetric(sourceDevice, metricValue);
												return (
													<Space key={field.key} wrap align="start">
														<Form.Item label={index === 0 ? "监控指标" : " "} name={[field.name, "metric"]} rules={[{ required: true, message: "请选择指标" }]}>
															<Select style={{ width: 220 }} options={sourceMetricOptions} />
														</Form.Item>
														<Form.Item label={index === 0 ? "监控通道" : " "} name={[field.name, "channel_code"]}>
															<Select allowClear style={{ width: 260 }} options={channelOptions} placeholder="选择具体通道" />
														</Form.Item>
														<Form.Item label={index === 0 ? "比较符" : " "} name={[field.name, "operator"]} rules={[{ required: true, message: "请选择比较符" }]}>
															<Select style={{ width: 100 }} options={operatorOptions} />
														</Form.Item>
														<Form.Item label={index === 0 ? "阈值" : " "} name={[field.name, "value"]} rules={[{ required: true, message: "请输入阈值" }]}>
															<InputNumber style={{ width: 140 }} />
														</Form.Item>
														<Button danger size="small" onClick={() => remove(field.name)} disabled={fields.length <= 1}>
															删除
														</Button>
													</Space>
												);
											})}
											<Button size="small" onClick={() => add({ metric: sourceMetricOptions[0]?.value || "temperature", operator: ">=", value: 0 })}>
												新增条件
											</Button>
										</Space>
									)}
									</Form.List>
								</>
							) : null}

							{linkageType === "schedule" || linkageType === "hybrid" ? (
								<Form.Item label="Cron 表达式" name="scheduleCron" rules={[{ required: true, message: "请输入 Cron 表达式" }]}> 
									<Input placeholder="例如：0 9 * * *" />
								</Form.Item>
							) : null}

							{linkageType === "python" ? (
								<>
									<Space wrap style={{ marginBottom: 12 }}>
										<Text type="secondary">快速模板</Text>
										{linkagePythonTemplates.map((template) => (
											<Button
												key={template.key}
												size="small"
												onClick={() => form.setFieldValue("pythonCode", template.code)}
											>
												{template.label}
											</Button>
										))}
									</Space>
									<Form.Item label="联动脚本" name="pythonCode" rules={[{ required: true, message: "请输入联动脚本" }]}> 
										<Input.TextArea rows={10} placeholder={linkagePythonExample} style={{ fontFamily: "Consolas, monospace", fontSize: 12 }} />
									</Form.Item>
									<Form.Item label="Cron 表达式（可选）" name="scheduleCron" style={{ marginBottom: 0 }}>
									<Input placeholder="例如：0 */2 * * *；留空表示仅手动执行" />
								</Form.Item>
							</>
						) : null}
						</Card>

						{linkageType !== "python" ? (
							<Card size="small" title="执行动作">
								<Form.Item label="目标设备" name="targetDeviceId" rules={[{ required: true, message: "请选择目标设备" }]}> 
									<Select options={deviceOptions} placeholder="选择真正执行动作的设备" />
								</Form.Item>

								{targetDevice ? (
									<Paragraph type="secondary" style={{ marginTop: -8, marginBottom: 16 }}>
										目标设备：<Tag color="blue">{getProfileLabel(targetProfile)}</Tag>，动作选项已自动适配。
									</Paragraph>
								) : null}

								<Space wrap>
									<Form.Item label="动作命令" name="actionCommand" rules={[{ required: true, message: "请选择动作命令" }]}> 
										<Select style={{ width: 180 }} options={commandOptions} />
									</Form.Item>
									{currentCommand === "config_update" ? (
										<Form.Item
											label="配置补丁"
											name="actionConfigText"
											rules={[{ required: true, message: "请输入配置补丁 JSON" }]}
										>
											<Input.TextArea
												style={{ width: 320 }}
												rows={4}
												placeholder={'例如：{\n  "read_interval": 120000,\n  "pump_run_time": 80000\n}'}
											/>
										</Form.Item>
									) : (
										<>
											<Form.Item label="动作" name="actionType" rules={[{ required: true, message: "请选择动作" }]}> 
												<Select style={{ width: 140 }} options={actionOptions} />
											</Form.Item>
											<Form.Item label="持续时间(ms)" name="duration">
												<InputNumber style={{ width: 180 }} min={0} />
											</Form.Item>
										</>
									)}
								</Space>

								<Divider style={{ margin: "8px 0 16px" }} />
								<Text type="secondary">未满足条件时动作（可选）</Text>
								<Form.List name="elseCommands">
									{(fields, { add, remove }) => (
										<Space orientation="vertical" style={{ width: "100%", marginTop: 12 }} size={12}>
											{fields.length ? null : <Text type="secondary">留空则不执行备用动作。</Text>}
											{fields.map((field, index) => {
												const elseCommandValue = form.getFieldValue(["elseCommands", field.name, "command"]);
												return (
													<Space key={field.key} wrap align="start">
														<Form.Item label={index === 0 ? "动作命令" : " "} name={[field.name, "command"]} rules={[{ required: true, message: "请选择动作命令" }]}>
															<Select style={{ width: 180 }} options={commandOptions} />
														</Form.Item>
														<Form.Item label={index === 0 ? "动作" : " "} name={[field.name, "action"]} rules={[{ required: true, message: "请选择动作" }]}>
															<Select style={{ width: 140 }} options={getCommandActionOptions(elseCommandValue)} />
														</Form.Item>
														<Form.Item label={index === 0 ? "持续时间(ms)" : " "} name={[field.name, "duration"]}>
															<InputNumber style={{ width: 180 }} min={0} />
														</Form.Item>
														<Button danger size="small" onClick={() => remove(field.name)}>
															删除
														</Button>
													</Space>
												);
											})}
											<Button
												size="small"
												onClick={() =>
													add({
														command: commandOptions[0]?.value || "pump",
														action: getDefaultActionForCommand(commandOptions[0]?.value),
													})
												}
											>
												新增 else 动作
											</Button>
										</Space>
									)}
								</Form.List>
							</Card>
						) : null}
					</Form>
				</Col>

				<Col xs={24} xl={9}>
					<Card size="small" title="规则说明与预览">
						<Tag color={typeColor[linkageType]}>{typeLabel(linkageType)}</Tag>
						<ul style={{ paddingLeft: 18, marginTop: 12, marginBottom: 12 }}>
							<li>先选触发设备，再选目标设备。</li>
							<li>动作命令会跟着目标设备类型自动收窄。</li>
							<li>保存后先手动执行一次，再查看执行记录。</li>
							<li>联动里的“监控指标”对应触发设备的语义指标，不是通道 code。</li>
							<li>如果同一指标下有多个通道，建议明确选择“监控通道”。</li>
						</ul>
						{linkageType === "python" ? (
							<Paragraph type="secondary" style={{ marginBottom: 12 }}>
								Python 联动支持同时读取多台设备的值，也支持返回 <Text code>actions</Text> 列表，把动作分发到多台目标设备。填写可选的 <Text code>Cron</Text> 后，这条联动也能按定时自动执行。
							</Paragraph>
						) : null}
						{linkageType !== "python" ? (
							<Paragraph type="secondary" style={{ marginBottom: 12 }}>
								联动规则也支持“未满足条件时动作”。如果需要在条件不满足时关闭设备、停止排气或切回保守状态，可以在下方单独配置。
							</Paragraph>
						) : null}
						<Divider style={{ margin: "12px 0" }} />
						<Title level={5} style={{ marginTop: 0 }}>最终 Python 脚本预览</Title>
						<pre style={{ background: "#f6f8fa", borderRadius: 8, padding: 12, fontSize: 12, overflowX: "auto", marginBottom: 12 }}>{linkagePreview}</pre>
						<Title level={5}>触发设备可用指标</Title>
						{sourceDevice ? (
							sourceMetricGuide.length ? (
								<Space orientation="vertical" size={6} style={{ width: "100%" }}>
									{sourceMetricGuide.map(([metric, codes]) => (
										<Text key={metric}>{metric}：{codes.join(" / ")}</Text>
									))}
								</Space>
							) : (
								<Text type="secondary">当前触发设备还没有通道信息，暂时使用通用指标。</Text>
							)
						) : (
							<Text type="secondary">先选择触发设备，再查看可用指标。</Text>
						)}
					</Card>
				</Col>
			</Row>
	);

	return open ? (
		<Card
			style={{ marginBottom: 16 }}
			title={script ? "编辑设备联动规则" : "新建设备联动规则"}
			extra={
				<Space>
					<Button onClick={onClose}>取消</Button>
					<Button type="primary" loading={loading} onClick={() => form.submit()}>
						{script ? "保存规则" : "创建规则"}
					</Button>
				</Space>
			}
		>
			{content}
		</Card>
	) : null;
}
function ExecutionHistoryModal({
	open,
	script,
	onClose,
}: {
	open: boolean;
	script: Script | null;
	onClose: () => void;
}) {
	const executionsQ = useQuery({
		queryKey: ["script-executions", script?.id],
		enabled: open && !!script?.id,
		queryFn: async () =>
			(await api.get(`/scripts/${script?.id}/executions`, { params: { limit: 20 } })).data as { data: ScriptExecution[] },
	});

	const columns: ColumnsType<ScriptExecution> = [
		{ title: "设备", dataIndex: "device_code", width: 160 },
		{
			title: "状态",
			width: 100,
			render: (_, row) => <Tag color={row.status === "success" ? "green" : row.status === "failed" ? "red" : "blue"}>{row.status_display || row.status}</Tag>,
		},
		{ title: "触发方式", dataIndex: "trigger_reason", width: 120, render: (value: string) => value || "-" },
		{ title: "开始时间", dataIndex: "started_at", width: 170, render: (value: string) => value || "-" },
		{
			title: "结果",
			render: (_, row) =>
				row.error_message ? <Text type="danger">{row.error_message}</Text> : typeof row.result?.detail === "string" ? row.result.detail : "已执行",
		},
	];

	return (
		<Modal open={open} title={script ? `执行记录：${script.name}` : "执行记录"} footer={null} onCancel={onClose} width={900} destroyOnHidden>
			<Table rowKey="execution_id" loading={executionsQ.isLoading} dataSource={executionsQ.data?.data || []} columns={columns} pagination={false} locale={{ emptyText: "暂无执行记录" }} scroll={{ x: 760 }} />
		</Modal>
	);
}

function LinkagePanel({
	scripts,
	devices,
	loading,
	executingId,
	deletingId,
	onCreate,
	onEdit,
	onDuplicate,
	onExecute,
	onDelete,
	onHistory,
}: {
	scripts: Script[];
	devices: Device[];
	loading: boolean;
	executingId?: number;
	deletingId?: number;
	onCreate: () => void;
	onEdit: (script: Script) => void;
	onDuplicate: (script: Script) => void;
	onExecute: (script: Script) => void;
	onDelete: (script: Script) => void;
	onHistory: (script: Script) => void;
}) {
	const columns: ColumnsType<Script> = [
		{ title: "规则名称", dataIndex: "name", width: 180 },
		{ title: "类型", width: 120, render: (_, row) => <Tag color={typeColor[row.script_type]}>{typeLabel(row.script_type)}</Tag> },
		{
			title: "目标设备",
			width: 220,
			render: (_, row) => {
				const commandTemplate = (row.command_template || {}) as Record<string, unknown>;
				const targetDeviceId =
					typeof commandTemplate.target_device_id === "number" ? commandTemplate.target_device_id : row.device_ids?.[0];
				const targetDevice = devices.find((item) => item.device_id === targetDeviceId);
				return targetDevice ? <>{deviceLabel(targetDevice)}<Tag style={{ marginLeft: 8 }}>{getProfileLabel(inferDeviceProfile(targetDevice))}</Tag></> : "-";
			},
		},
		{
			title: "条件摘要",
			render: (_, row) => summarizeLinkageCondition(row, devices),
		},
		{ title: "状态", width: 100, render: (_, row) => <Tag color={row.is_active ? "green" : "default"}>{row.is_active ? "启用" : "停用"}</Tag> },
		{ title: "优先级", dataIndex: "priority", width: 90 },
		{ title: "动作摘要", render: (_, row) => summarizeCommands(row.command_template) },
		{
			title: "操作",
			width: 360,
			render: (_, row) => (
				<Space size="small" wrap>
					<Button size="small" type="primary" disabled={!row.is_active} loading={executingId === row.id} onClick={() => onExecute(row)}>执行</Button>
					<Button size="small" onClick={() => onHistory(row)}>记录</Button>
					<Button size="small" onClick={() => onEdit(row)}>编辑</Button>
					<Button size="small" onClick={() => onDuplicate(row)}>复制</Button>
					<Button danger size="small" loading={deletingId === row.id} onClick={() => onDelete(row)}>删除</Button>
				</Space>
			),
		},
	];

	return (
		<>
			<Card
				title="设备联动规则"
				extra={
					<Button type="primary" size="small" onClick={onCreate}>
						新建规则
					</Button>
				}
			>
				<Paragraph type="secondary" style={{ marginBottom: 16 }}>
					适合配置“由一台设备触发，另一台设备执行动作”的规则。
				</Paragraph>
				{scripts.length ? (
					<Table rowKey="id" dataSource={scripts} columns={columns} loading={loading} pagination={{ pageSize: 10 }} scroll={{ x: 1180 }} />
				) : (
					<Empty description="还没有设备联动" />
				)}
			</Card>
		</>
	);
}

export default function ScriptsPage() {
	const queryClient = useQueryClient();
	const [scriptModalOpen, setScriptModalOpen] = useState(false);
	const [linkageModalOpen, setLinkageModalOpen] = useState(false);
	const [importModalOpen, setImportModalOpen] = useState(false);
	const [importText, setImportText] = useState("");
	const [activeTab, setActiveTab] = useState("single");
	const [editingScript, setEditingScript] = useState<Script | null>(null);
	const [editingLinkage, setEditingLinkage] = useState<Script | null>(null);
	const [historyScript, setHistoryScript] = useState<Script | null>(null);
	const [executionFilter, setExecutionFilter] = useState<ExecutionFilter>("all");
	const [ruleStatusFilter, setRuleStatusFilter] = useState<RuleStatusFilter>("all");
	const [ruleDeviceFilter, setRuleDeviceFilter] = useState<number | undefined>(undefined);

	const scriptsQ = useQuery({ queryKey: ["scripts"], queryFn: async () => (await api.get("/scripts")).data as { data: Script[] } });
	const devicesQ = useQuery({
		queryKey: ["devices", "tree", "scripts-page"],
		queryFn: async () => (await api.get("/devices/tree")).data as { data: Device[] },
	});
	const recentExecutionsQ = useQuery({
		queryKey: ["recent-script-executions"],
		queryFn: async () =>
			(await api.get("/script-executions", { params: { limit: 8 } })).data as {
				data: ScriptExecution[];
			},
	});

	const createScript = useMutation({
		mutationFn: async (data: ReturnType<typeof toScriptPayload>) => api.post("/scripts", data),
		onSuccess: () => {
			message.success("脚本创建成功");
			setScriptModalOpen(false);
			setEditingScript(null);
			queryClient.invalidateQueries({ queryKey: ["scripts"] });
		},
		onError: (error: unknown) => message.error(getErrorMessage(error, "脚本创建失败")),
	});

	const updateScript = useMutation({
		mutationFn: async (data: ReturnType<typeof toScriptPayload>) => api.patch(`/scripts/${editingScript?.id}`, data),
		onSuccess: () => {
			message.success("脚本更新成功");
			setScriptModalOpen(false);
			setEditingScript(null);
			queryClient.invalidateQueries({ queryKey: ["scripts"] });
		},
		onError: (error: unknown) => message.error(getErrorMessage(error, "脚本更新失败")),
	});

	const createLinkage = useMutation({
		mutationFn: async (data: ReturnType<typeof toLinkagePayload>) => api.post("/scripts", data),
		onSuccess: () => {
			message.success("联动创建成功");
			setLinkageModalOpen(false);
			setEditingLinkage(null);
			setActiveTab("linkage");
			queryClient.invalidateQueries({ queryKey: ["scripts"] });
		},
		onError: (error: unknown) => message.error(getErrorMessage(error, "联动创建失败")),
	});

	const updateLinkage = useMutation({
		mutationFn: async (data: ReturnType<typeof toLinkagePayload>) => api.patch(`/scripts/${editingLinkage?.id}`, data),
		onSuccess: () => {
			message.success("联动更新成功");
			setLinkageModalOpen(false);
			setEditingLinkage(null);
			setActiveTab("linkage");
			queryClient.invalidateQueries({ queryKey: ["scripts"] });
		},
		onError: (error: unknown) => message.error(getErrorMessage(error, "联动更新失败")),
	});

	const duplicateScript = useMutation({
		mutationFn: async (data: ReturnType<typeof cloneScriptPayload>) => api.post("/scripts", data),
		onSuccess: () => {
			message.success("已复制为新规则");
			queryClient.invalidateQueries({ queryKey: ["scripts"] });
		},
		onError: (error: unknown) => message.error(getErrorMessage(error, "复制失败")),
	});

	const importScript = useMutation({
		mutationFn: async (data: ReturnType<typeof normalizeImportPayload>) => api.post("/scripts", data),
		onSuccess: () => {
			message.success("规则导入成功");
			setImportModalOpen(false);
			setImportText("");
			queryClient.invalidateQueries({ queryKey: ["scripts"] });
		},
		onError: (error: unknown) => message.error(getErrorMessage(error, "导入失败")),
	});

	const importScriptsBatch = async () => {
		try {
			const parsed = JSON.parse(importText);
			const items = normalizeImportPayloads(parsed);
			let successCount = 0;
			let failedCount = 0;
			const failures: string[] = [];

			for (const [index, item] of items.entries()) {
				try {
					await api.post("/scripts", item);
					successCount += 1;
				} catch (error) {
					failedCount += 1;
					failures.push(`第 ${index + 1} 条：${getErrorMessage(error, "导入失败")}`);
				}
			}

			queryClient.invalidateQueries({ queryKey: ["scripts"] });

			if (failedCount === 0) {
				message.success(`已成功导入 ${successCount} 条规则`);
				setImportModalOpen(false);
				setImportText("");
				return;
			}

			if (successCount > 0) {
				message.warning(`导入完成：成功 ${successCount} 条，失败 ${failedCount} 条`);
			} else {
				message.error(`导入失败：共 ${failedCount} 条`);
			}

			if (failures.length) {
				Modal.warning({
					title: "部分规则导入失败",
					content: (
						<Space orientation="vertical" size={8}>
							{failures.slice(0, 5).map((item) => (
								<Text key={item}>{item}</Text>
							))}
							{failures.length > 5 ? <Text type="secondary">其余失败项已省略，请按同样方式继续检查。</Text> : null}
						</Space>
					),
				});
			}
		} catch (error) {
			message.error(error instanceof Error ? error.message : "导入内容格式不正确");
		}
	};

	const deleteScript = useMutation({
		mutationFn: async (id: number) => api.delete(`/scripts/${id}`),
		onSuccess: () => {
			message.success("脚本删除成功");
			queryClient.invalidateQueries({ queryKey: ["scripts"] });
		},
		onError: (error: unknown) => message.error(getErrorMessage(error, "脚本删除失败")),
	});

	const executeScript = useMutation({
		mutationFn: async (id: number) => api.post(`/scripts/${id}/executions`, { device_ids: [] }),
		onSuccess: (_, id) => {
			message.success("脚本已执行");
			queryClient.invalidateQueries({ queryKey: ["scripts"] });
			queryClient.invalidateQueries({ queryKey: ["script-executions", id] });
		},
		onError: (error: unknown) => message.error(getErrorMessage(error, "脚本执行失败")),
	});

	const checkThresholds = useMutation({
		mutationFn: async () => (await api.post("/scripts/check-thresholds")).data as Record<string, unknown>,
		onSuccess: (data) => {
			message.success(
				`阈值检查完成：检查 ${String(data.checked ?? 0)} 条，执行 ${String(data.executed ?? 0)} 条`,
			);
			queryClient.invalidateQueries({ queryKey: ["scripts"] });
		},
		onError: (error: unknown) => message.error(getErrorMessage(error, "阈值检查失败")),
	});

	const checkSchedules = useMutation({
		mutationFn: async () => (await api.post("/scripts/check-schedules")).data as Record<string, unknown>,
		onSuccess: (data) => {
			message.success(
				`定时检查完成：匹配 ${String(data.matched ?? 0)} 条，执行 ${String(data.executed ?? 0)} 条`,
			);
			queryClient.invalidateQueries({ queryKey: ["scripts"] });
		},
		onError: (error: unknown) => message.error(getErrorMessage(error, "定时检查失败")),
	});

	const allScripts = useMemo(() => safeArray<Script>(scriptsQ.data?.data), [scriptsQ.data?.data]);
	const singleScripts = useMemo(() => allScripts.filter((item) => !isLinkageScript(item)), [allScripts]);
	const linkageScripts = useMemo(() => allScripts.filter((item) => isLinkageScript(item)), [allScripts]);
	const recentExecutions = useMemo(() => safeArray<ScriptExecution>(recentExecutionsQ.data?.data), [recentExecutionsQ.data?.data]);
	const filteredExecutions = useMemo(() => {
		if (executionFilter === "all") return recentExecutions;
		if (executionFilter === "failed") return recentExecutions.filter((item) => item.status === "failed");
		return recentExecutions.filter((item) => item.trigger_reason === executionFilter);
	}, [executionFilter, recentExecutions]);
	const devicesList = useMemo(() => safeArray<Device>(devicesQ.data?.data), [devicesQ.data?.data]);
	const deviceOptions = useMemo(
		() => devicesList.map((device) => ({ value: device.device_id, label: deviceLabel(device) })),
		[devicesList],
	);
	const filteredSingleScripts = useMemo(
		() =>
			singleScripts.filter((script) => {
				if (ruleStatusFilter === "active" && !script.is_active) return false;
				if (ruleStatusFilter === "inactive" && script.is_active) return false;
				if (ruleDeviceFilter && !(script.device_ids || []).includes(ruleDeviceFilter)) {
					const commandTemplate = (script.command_template || {}) as Record<string, unknown>;
					if (commandTemplate.target_device_id !== ruleDeviceFilter) {
						return false;
					}
				}
				return true;
			}),
		[singleScripts, ruleStatusFilter, ruleDeviceFilter],
	);
	const filteredLinkageScripts = useMemo(
		() =>
			linkageScripts.filter((script) => {
				if (ruleStatusFilter === "active" && !script.is_active) return false;
				if (ruleStatusFilter === "inactive" && script.is_active) return false;
				if (ruleDeviceFilter && !(script.device_ids || []).includes(ruleDeviceFilter)) {
					const commandTemplate = (script.command_template || {}) as Record<string, unknown>;
					if (commandTemplate.target_device_id !== ruleDeviceFilter) {
						return false;
					}
				}
				return true;
			}),
		[linkageScripts, ruleStatusFilter, ruleDeviceFilter],
	);

	const statCards = [
		{ title: "单设备规则", value: singleScripts.length, color: "#1677ff" },
		{ title: "联动规则", value: linkageScripts.length, color: "#fa8c16" },
		{ title: "启用中", value: allScripts.filter((item) => item.is_active).length, color: "#52c41a" },
		{ title: "关联设备", value: new Set(allScripts.flatMap((item) => item.device_ids || [])).size, color: "#722ed1" },
	];

	const scriptColumns: ColumnsType<Script> = [
		{ title: "规则名称", dataIndex: "name", width: 180 },
		{ title: "类型", width: 120, render: (_, row) => <Tag color={typeColor[row.script_type]}>{row.script_type_display || row.script_type}</Tag> },
		{
			title: "目标设备",
			width: 210,
			render: (_, row) => {
				const target = devicesList.find((item) => item.device_id === row.device_ids?.[0]);
				return target ? <>{deviceLabel(target)}<Tag style={{ marginLeft: 8 }}>{getProfileLabel(inferDeviceProfile(target))}</Tag></> : "-";
			},
		},
		{ title: "状态", width: 100, render: (_, row) => <Tag color={row.is_active ? "green" : "default"}>{row.is_active ? "启用" : "停用"}</Tag> },
		{ title: "优先级", dataIndex: "priority", width: 90 },
		{ title: "条件摘要", render: (_, row) => summarizeSingleCondition(row) },
		{ title: "动作摘要", render: (_, row) => summarizeCommands(row.command_template) },
		{
			title: "操作",
			width: 340,
			render: (_, row) => (
				<Space size="small" wrap>
					<Button size="small" type="primary" disabled={!row.is_active} loading={executeScript.isPending && executeScript.variables === row.id} onClick={() => executeScript.mutate(row.id || 0)}>执行</Button>
					<Button size="small" onClick={() => setHistoryScript(row)}>记录</Button>
					<Button size="small" onClick={() => { setEditingScript(row); setScriptModalOpen(true); }}>编辑</Button>
					<Button size="small" loading={duplicateScript.isPending} onClick={() => duplicateScript.mutate(cloneScriptPayload(row))}>复制</Button>
					<Button size="small" danger loading={deleteScript.isPending && deleteScript.variables === row.id} onClick={() => deleteScript.mutate(row.id || 0)}>删除</Button>
				</Space>
			),
		},
	];

	const exportAllScripts = () => {
		const payload = JSON.stringify(allScripts, null, 2);
		const blob = new Blob([payload], { type: "application/json;charset=utf-8" });
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement("a");
		anchor.href = url;
		anchor.download = `compostlab-scripts-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
		document.body.appendChild(anchor);
		anchor.click();
		document.body.removeChild(anchor);
		URL.revokeObjectURL(url);
		message.success("已导出当前规则");
	};

	return (
		<Page
			title="控制脚本"
			extra={
				<Space wrap>
					<Button onClick={exportAllScripts}>导出规则</Button>
					<Button onClick={() => setImportModalOpen(true)}>导入规则</Button>
					<Button loading={checkThresholds.isPending} onClick={() => checkThresholds.mutate()}>
						检查阈值
					</Button>
					<Button loading={checkSchedules.isPending} onClick={() => checkSchedules.mutate()}>
						检查定时
					</Button>
					<Button
						onClick={() => {
							setActiveTab("single");
							setEditingScript(null);
							setScriptModalOpen(true);
							setLinkageModalOpen(false);
						}}
					>
						新建单设备规则
					</Button>
					<Button
						type="primary"
						onClick={() => {
							setActiveTab("linkage");
							setEditingLinkage(null);
							setLinkageModalOpen(true);
							setScriptModalOpen(false);
						}}
					>
						新建设备联动规则
					</Button>
				</Space>
			}
		>
			<Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
				{statCards.map((item) => (
					<Col key={item.title} xs={12} xl={6}>
						<Card size="small">
							<Text type="secondary">{item.title}</Text>
							<Title level={3} style={{ margin: "8px 0 0", color: item.color }}>{item.value}</Title>
						</Card>
					</Col>
				))}
			</Row>

			<Card style={{ marginBottom: 16 }}>
				<Row gutter={[16, 16]}>
					<Col xs={24} xl={13}>
						<Title level={5} style={{ marginTop: 0 }}>使用方式</Title>
						<ul style={{ paddingLeft: 18, marginBottom: 0 }}>
							<li>单设备规则和设备联动使用同一套创建、编辑和执行方式。</li>
							<li>动作命令会按目标设备类型自动过滤，减少误选。</li>
							<li>规则的创建、复制、导入、导出和执行都在这里完成。</li>
							<li>保存后可以直接执行，也可以查看最近执行记录。</li>
						</ul>
					</Col>
					<Col xs={24} xl={11}>
						<Alert type="info" showIcon title="建议从简单规则开始" description="先确认设备动作和执行记录正常，再逐步叠加更复杂的条件和联动关系。" />
					</Col>
				</Row>
			</Card>

			<Card size="small" style={{ marginBottom: 16 }}>
				<Row gutter={[12, 12]} align="middle">
					<Col xs={24} md={8} xl={6}>
						<Text type="secondary">规则状态</Text>
						<Select
							style={{ width: "100%", marginTop: 6 }}
							value={ruleStatusFilter}
							onChange={(value) => setRuleStatusFilter(value)}
							options={[
								{ value: "all", label: "全部状态" },
								{ value: "active", label: "只看启用" },
								{ value: "inactive", label: "只看停用" },
							]}
						/>
					</Col>
					<Col xs={24} md={10} xl={8}>
						<Text type="secondary">目标设备</Text>
						<Select
							allowClear
							style={{ width: "100%", marginTop: 6 }}
							value={ruleDeviceFilter}
							onChange={(value) => setRuleDeviceFilter(value)}
							placeholder="全部设备"
							options={deviceOptions}
						/>
					</Col>
					<Col xs={24} md={6} xl={4}>
						<Text type="secondary">当前结果</Text>
						<Paragraph style={{ margin: "6px 0 0" }}>
							{activeTab === "single" ? filteredSingleScripts.length : filteredLinkageScripts.length} 条规则
						</Paragraph>
					</Col>
				</Row>
			</Card>

			<Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
				<Col xs={24} xl={15}>
					<Card
						title="最近执行"
						size="small"
						extra={
							<Select
								size="small"
								style={{ width: 150 }}
								value={executionFilter}
								onChange={(value) => setExecutionFilter(value)}
								options={[
									{ value: "all", label: "全部记录" },
									{ value: "manual", label: "只看手动" },
									{ value: "threshold_check", label: "只看阈值触发" },
									{ value: "schedule_check", label: "只看定时触发" },
									{ value: "failed", label: "只看失败" },
								]}
							/>
						}
					>
						{filteredExecutions.length ? (
							<Space orientation="vertical" style={{ width: "100%" }} size={12}>
								{filteredExecutions.map((item) => (
									<Row key={item.execution_id} gutter={[12, 8]} style={{ padding: "10px 0", borderBottom: "1px solid #f0f0f0" }}>
										<Col xs={24} lg={12}>
											<Space wrap>
												<Tag color={item.trigger_reason === "manual" ? "blue" : item.trigger_reason === "schedule_check" ? "green" : "orange"}>
													{item.trigger_reason === "manual"
														? "手动执行"
														: item.trigger_reason === "schedule_check"
														? "定时触发"
														: item.trigger_reason === "threshold_check"
														? "阈值触发"
														: item.trigger_reason || "未知触发"}
												</Tag>
												<Tag color={item.status === "success" ? "green" : item.status === "failed" ? "red" : "default"}>
													{item.status_display || item.status}
												</Tag>
												<Text strong>{item.script_name || "未命名脚本"}</Text>
											</Space>
										</Col>
										<Col xs={24} lg={12}>
											<Text type="secondary">设备：{item.device_code || "-"}，时间：{item.started_at || "-"}</Text>
											{item.error_message ? <div><Text type="danger">{item.error_message}</Text></div> : null}
										</Col>
									</Row>
								))}
							</Space>
						) : (
							<Empty description="最近还没有执行记录" />
						)}
					</Card>
				</Col>
				<Col xs={24} xl={9}>
					<Card title="自动控制状态" size="small">
						<Row gutter={[12, 12]}>
							<Col span={12}>
								<Card size="small">
									<Text type="secondary">阈值规则</Text>
									<Paragraph style={{ margin: "8px 0 0" }}>支持手动检查和后台自动检查</Paragraph>
								</Card>
							</Col>
							<Col span={12}>
								<Card size="small">
									<Text type="secondary">定时规则</Text>
									<Paragraph style={{ margin: "8px 0 0" }}>支持 `cron` 检查和后台周期执行</Paragraph>
								</Card>
							</Col>
							<Col span={24}>
								<Alert
									type="info"
									showIcon
									title="运行提示"
									description="如果这里长期没有新记录，优先检查 auto_control_worker 是否已启动。"
								/>
							</Col>
						</Row>
					</Card>
				</Col>
			</Row>

			{activeTab === "single" ? (
				<ScriptModal
					open={scriptModalOpen}
					script={editingScript}
				devices={devicesList}
					loading={createScript.isPending || updateScript.isPending}
					onClose={() => {
						setScriptModalOpen(false);
						setEditingScript(null);
					}}
					onSubmit={(values) => {
						if (editingScript) updateScript.mutate(values);
						else createScript.mutate(values);
					}}
				/>
			) : null}

			{activeTab === "linkage" ? (
				<LinkageModal
					open={linkageModalOpen}
					script={editingLinkage}
				devices={devicesList}
					loading={createLinkage.isPending || updateLinkage.isPending}
					onClose={() => {
						setLinkageModalOpen(false);
						setEditingLinkage(null);
					}}
					onSubmit={(values) => {
						if (editingLinkage) updateLinkage.mutate(values);
						else createLinkage.mutate(values);
					}}
				/>
			) : null}

			<Tabs
				activeKey={activeTab}
				onChange={setActiveTab}
				items={[
					{
						key: "single",
						label: `单设备规则 (${filteredSingleScripts.length})`,
						children: (
							<Card
								title="单设备规则"
								extra={
									<Button
										type="primary"
										size="small"
										onClick={() => {
											setEditingScript(null);
											setScriptModalOpen(true);
										}}
									>
										新建规则
									</Button>
								}
							>
								<Paragraph type="secondary" style={{ marginBottom: 16 }}>
									适合给单台设备配置阈值、定时和脚本规则。
								</Paragraph>
								<Table rowKey="id" loading={scriptsQ.isLoading} dataSource={filteredSingleScripts} columns={scriptColumns} pagination={{ pageSize: 20 }} scroll={{ x: 1180 }} />
							</Card>
						),
					},
				{ key: "linkage", label: `设备联动规则 (${filteredLinkageScripts.length})`, children: <LinkagePanel scripts={filteredLinkageScripts} devices={devicesList} loading={scriptsQ.isLoading} executingId={typeof executeScript.variables === "number" ? executeScript.variables : undefined} deletingId={typeof deleteScript.variables === "number" ? deleteScript.variables : undefined} onCreate={() => { setEditingLinkage(null); setLinkageModalOpen(true); }} onEdit={(script) => { setEditingLinkage(script); setLinkageModalOpen(true); }} onDuplicate={(script) => duplicateScript.mutate(cloneScriptPayload(script))} onExecute={(script) => executeScript.mutate(script.id || 0)} onDelete={(script) => deleteScript.mutate(script.id || 0)} onHistory={(script) => setHistoryScript(script)} /> },
				]}
			/>

			<ExecutionHistoryModal open={!!historyScript} script={historyScript} onClose={() => setHistoryScript(null)} />

			<Modal
				open={importModalOpen}
				title="导入规则"
				onCancel={() => setImportModalOpen(false)}
				onOk={importScriptsBatch}
				confirmLoading={importScript.isPending}
				okText="开始导入"
				width={760}
				destroyOnHidden
			>
				<Space orientation="vertical" style={{ width: "100%" }} size={12}>
					<Alert
						type="info"
						showIcon
						title="导入说明"
						description="支持导入单条规则 JSON，也支持一次粘贴一个规则数组批量导入。导入后会作为新的规则保存。"
					/>
					<Input.TextArea
						rows={16}
						value={importText}
						onChange={(event) => setImportText(event.target.value)}
						placeholder='粘贴从“导出规则”得到的 JSON，或一条单独的脚本 JSON'
						style={{ fontFamily: "Consolas, monospace", fontSize: 12 }}
					/>
				</Space>
			</Modal>
		</Page>
	);
}
