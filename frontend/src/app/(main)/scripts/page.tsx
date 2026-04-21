"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
	Segmented,
	Select,
	Space,
	Switch,
	Table,
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

const panelCardStyle = {
	borderRadius: 16,
	border: "1px solid #edf1f5",
	boxShadow: "0 8px 24px rgba(15, 23, 42, 0.04)",
};

const softCardBodyStyle = {
	background: "linear-gradient(180deg, #ffffff 0%, #fbfcfe 100%)",
	borderRadius: 16,
};

const compactMetricCardStyle = {
	borderRadius: 14,
	border: "1px solid #eef2f6",
	boxShadow: "0 4px 14px rgba(15, 23, 42, 0.03)",
};

const sectionCardStyles = {
	header: {
		padding: "16px 18px 12px",
		minHeight: "auto",
		alignItems: "center",
		borderBottom: "1px solid #edf1f5",
		background: "linear-gradient(180deg, #ffffff 0%, #fcfdff 100%)",
		borderTopLeftRadius: 16,
		borderTopRightRadius: 16,
	},
	body: {
		...softCardBodyStyle,
		padding: "18px 18px 18px",
	},
} as const;

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
	targetDeviceId?: number;
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

type MetricGuideRow = {
	label: string;
	metric: string;
	channelCodes: string[];
	channelNames: string[];
};

type ModelRegistryItem = {
	name: string;
	kind?: string;
	rule_type?: string;
	thresholds?: Record<string, unknown>;
	suggestions?: Record<string, unknown>;
	features?: string[];
	path?: string;
	decision_map?: Record<string, unknown>;
};

type ModelHealthItem = {
	name: string;
	kind?: string;
	healthy?: boolean;
	status?: string;
	detail?: string;
};

type ExecutionFilter = "all" | "manual" | "threshold_check" | "schedule_check" | "failed";
type RuleStatusFilter = "all" | "active" | "inactive";
type RuleScope = "single" | "linkage";
type FormFieldName = string | (string | number)[];
type RuleCondition = {
	metric?: string;
	channel_code?: string;
	operator?: string;
	value?: number;
	sourceDeviceId?: number;
};
type RuleConditionFormValue = RuleCondition;
type RuleDraft = {
	name: string;
	description: string;
	type: ScriptType;
	isActive: boolean;
	priority: number;
	sourceDeviceId?: number;
	targetDeviceId?: number;
	conditionMode: "all" | "any";
	conditions: RuleCondition[];
	cron?: string;
	pythonCode: string;
	commandTemplate: Record<string, unknown>;
	/** 自动阈值检查最小间隔（秒）；0 / 未设置表示不额外限制 */
	minCheckIntervalSeconds?: number;
};

type RuleFormIdentityFields = {
	name: string;
	description?: string;
	is_active: boolean;
	priority: number;
};

type RuleActionFormFields = {
	primaryActions?: CommandRow[];
	elseCommands?: CommandRow[];
};

type ThresholdConfigFormValue = {
	condition_mode?: "all" | "any";
	metric?: string;
	channel_code?: string;
	operator?: string;
	value?: number;
	conditions?: RuleConditionFormValue[];
	/** 后台自动阈值检查最小间隔（秒），与设备上报周期对齐，如 60 */
	min_check_interval_seconds?: number;
};

type ScheduleConfigFormValue = {
	cron?: string;
};

type SharedRuleDraftInput = RuleFormIdentityFields & {
	type: ScriptType;
	sourceDeviceId?: number;
	targetDeviceId?: number;
	conditionMode?: "all" | "any";
	conditions?: RuleConditionFormValue[];
	cron?: string;
	pythonCode?: string;
	commandTemplate: Record<string, unknown>;
	minCheckIntervalSeconds?: number;
};

type SharedRuleEditorValues = RuleFormIdentityFields &
	RuleActionFormFields & {
		type: ScriptType;
		sourceDeviceId?: number;
		targetDeviceId?: number;
		conditions?: RuleConditionFormValue[];
		conditionMode?: "all" | "any";
		cron?: string;
		pythonCode?: string;
		commandTemplateText?: string;
		minCheckIntervalSeconds?: number;
	};

type ScriptFormValues = RuleFormIdentityFields &
	RuleActionFormFields & {
	script_type: ScriptType;
	threshold_config?: ThresholdConfigFormValue;
	schedule_config?: ScheduleConfigFormValue;
	python_code?: string;
	command_template: string;
	target_device_id?: number;
};

type SharedStructuredActionInput = RuleActionFormFields & {
	targetDeviceId?: number;
	target_device_id?: number;
	command_template?: string;
};

type StructuredActionFormValues = {
	targetDeviceId?: number;
} & RuleActionFormFields;

type StructuredActionDraft = {
	targetDeviceId?: number;
	commandTemplate: Record<string, unknown>;
	primaryActions: CommandRow[];
	elseActions: CommandRow[];
};

type LinkageFormValues = RuleFormIdentityFields &
	RuleActionFormFields & {
	linkage_type: ScriptType;
	sourceDeviceId?: number;
	sourceDeviceIds?: number[];
	sourceMetric?: string;
	sourceChannelCode?: string;
	operator?: string;
	threshold?: number;
	conditions?: RuleConditionFormValue[];
	conditionMode?: "all" | "any";
	scheduleCron?: string;
	pythonCode?: string;
	targetDeviceId?: number;
	targetDeviceIds?: number[];
	min_check_interval_seconds?: number;
};

type RuleEditorFieldMap = {
	type: FormFieldName;
	targetDeviceId: FormFieldName;
	sourceDeviceId?: FormFieldName;
	conditionMode: FormFieldName;
	conditions: FormFieldName;
	cron: FormFieldName;
	pythonCode: FormFieldName;
	primaryActions: FormFieldName;
	elseCommands: FormFieldName;
	commandTemplateText?: FormFieldName;
};

const singleRuleFields: RuleEditorFieldMap = {
	type: "script_type",
	targetDeviceId: "target_device_id",
	conditionMode: ["threshold_config", "condition_mode"],
	conditions: ["threshold_config", "conditions"],
	cron: ["schedule_config", "cron"],
	pythonCode: "python_code",
	primaryActions: "primaryActions",
	elseCommands: "elseCommands",
	commandTemplateText: "command_template",
};

const linkageRuleFields: RuleEditorFieldMap = {
	type: "linkage_type",
	targetDeviceId: "targetDeviceId",
	sourceDeviceId: "sourceDeviceId",
	conditionMode: "conditionMode",
	conditions: "conditions",
	cron: "scheduleCron",
	pythonCode: "pythonCode",
	primaryActions: "primaryActions",
	elseCommands: "elseCommands",
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

function getStructuredCommandExample(profile: DeviceProfile, type: ScriptType) {
	const examplesByProfile: Record<DeviceProfile, Record<Exclude<ScriptType, "python">, string>> = {
		"cp500-v3": {
			threshold: `{
  "commands": [
    { "command": "aeration", "action": "on", "duration": 300000 }
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
    { "command": "aeration", "action": "on", "duration": 180000 }
  ]
}`,
		},
		"smart-compost": {
			threshold: `{
  "commands": [
    { "command": "exhaust", "action": "on", "duration": 300000 }
  ]
}`,
			schedule: `{
  "commands": [
    { "command": "aeration", "action": "on", "duration": 60000 }
  ]
}`,
			hybrid: `{
  "commands": [
    { "command": "aeration", "action": "on", "duration": 60000 },
    { "command": "exhaust", "action": "on", "duration": 180000 }
  ]
}`,
		},
		mmcgs: {
			threshold: `{
  "commands": [
    { "command": "point1", "action": "on", "duration": 300000 }
  ]
}`,
			schedule: `{
  "commands": [
    { "command": "purge", "action": "on", "duration": 60000 }
  ]
}`,
			hybrid: `{
  "commands": [
    { "command": "purge", "action": "on", "duration": 60000 },
    { "command": "point1", "action": "on", "duration": 180000 }
  ]
}`,
		},
		generic: {
			threshold: `{
  "commands": [
    { "command": "fan", "action": "on", "duration": 300000 }
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
  ]
}`,
		},
	};

	if (type === "python") {
		return `{
  "commands": []
}`;
	}
	return examplesByProfile[profile][type];
}

function getProfileExampleDeviceCode(profile: DeviceProfile) {
	switch (profile) {
		case "cp500-v3":
			return "CP500-01";
		case "mmcgs":
			return "MMCGS-01";
		case "smart-compost":
			return "SMART-01";
		default:
			return "DEVICE-01";
	}
}

function getDeviceCodeOrExample(device: Device | null | undefined, profile?: DeviceProfile) {
	return String(device?.code || "").trim() || getProfileExampleDeviceCode(profile || inferDeviceProfile(device));
}

function getPrimaryCommandForProfile(profile: DeviceProfile) {
	switch (profile) {
		case "cp500-v3":
			return "aeration";
		case "smart-compost":
			return "aeration";
		case "mmcgs":
			return "point1";
		default:
			return "fan";
	}
}

function getSecondaryCommandForProfile(profile: DeviceProfile) {
	switch (profile) {
		case "cp500-v3":
			return "pump";
		case "smart-compost":
			return "exhaust";
		case "mmcgs":
			return "purge";
		default:
			return "pump";
	}
}

function getExampleChannelForMetric(profile: DeviceProfile, metric: string) {
	if (profile === "cp500-v3") {
		if (metric === "temperature") return "TempIn";
		if (metric === "o2") return "O2";
	}
	return undefined;
}

function buildLatestMetricRead(
	metric: string,
	profile: DeviceProfile,
	variableName: string,
	options?: { deviceCode?: string },
) {
	const channelCode = getExampleChannelForMetric(profile, metric);
	const channelArg = channelCode ? `, ${JSON.stringify(channelCode)}` : "";
	const deviceArg = options?.deviceCode ? `, device_code=${JSON.stringify(options.deviceCode)}` : "";
	return `${variableName} = get_latest_value(${JSON.stringify(metric)}${channelArg}${deviceArg})`;
}

function buildHistoryMetricRead(
	metric: string,
	profile: DeviceProfile,
	variableName: string,
	minutes: number,
	options?: { deviceCode?: string },
) {
	const channelCode = getExampleChannelForMetric(profile, metric);
	const channelArg = channelCode ? `, ${JSON.stringify(channelCode)}` : "";
	const deviceArg = options?.deviceCode ? `, device_code=${JSON.stringify(options.deviceCode)}` : "";
	return `${variableName} = get_history(${JSON.stringify(metric)}, ${minutes}${channelArg}${deviceArg})`;
}

function getMetricReadHint(profile: DeviceProfile) {
	if (profile === "cp500-v3") {
		return '# CP500 温度通道较多，这里示例固定读取 "TempIn"（堆体温度）。';
	}
	return "# 默认读取当前规则设备上的语义指标；如需精确到通道，可补 channel_code。";
}

function buildSingleModelPythonExample(
	profile: DeviceProfile,
	modelName: string,
	options?: { command?: string; maxDuration?: number },
) {
	const command = options?.command || getPrimaryCommandForProfile(profile);
	const maxDuration = options?.maxDuration ?? 180000;
	return `MIN_CHECK_INTERVAL_SECONDS = 60

${getMetricReadHint(profile)}
${buildHistoryMetricRead("temperature", profile, "temp_series", 5)}
${buildHistoryMetricRead("o2", profile, "o2_series", 5)}

FEATURES["temp_avg_5m"] = sum(temp_series) / len(temp_series) if temp_series else None
FEATURES["o2_min_5m"] = min(o2_series) if o2_series else None
FEATURES["sample_count_temp"] = len(temp_series)
FEATURES["sample_count_o2"] = len(o2_series)

pred = predict(${JSON.stringify(modelName)}, FEATURES)
commands = []

decision = pred.get("decision")
duration = int(pred.get("suggestions", {}).get("duration_ms", 60000))
duration = clamp(duration, 5000, ${maxDuration})

if decision == "on":
    commands.append({"command": ${JSON.stringify(command)}, "action": "on", "duration": duration})
elif decision == "off":
    commands.append({"command": ${JSON.stringify(command)}, "action": "off"})`;
}

function buildHeaterModelPythonExample(profile: DeviceProfile) {
	return `MIN_CHECK_INTERVAL_SECONDS = 60

${getMetricReadHint(profile)}
${buildHistoryMetricRead("temperature", profile, "temp_series", 5)}

FEATURES["temp_avg_5m"] = sum(temp_series) / len(temp_series) if temp_series else None
FEATURES["sample_count_temp"] = len(temp_series)

pred = predict("heater_v1", FEATURES)
commands = []

decision = pred.get("decision")
duration = int(pred.get("suggestions", {}).get("duration_ms", 60000))
duration = clamp(duration, 5000, 180000)

if decision == "on":
    commands.append({"command": "heater", "action": "on", "duration": duration})
elif decision == "off":
    commands.append({"command": "heater", "action": "off"})`;
}

function getDefaultLinkagePythonExample(
	profile: DeviceProfile,
	sourceDevice?: Device | null,
	targetDevice?: Device | null,
) {
	const intervalLine = "MIN_CHECK_INTERVAL_SECONDS = 60\n\n";
	const sourceProfile = inferDeviceProfile(sourceDevice);
	const sourceCode = getDeviceCodeOrExample(sourceDevice, sourceProfile);
	const targetCode = getDeviceCodeOrExample(targetDevice, profile);
	const primaryCommand = getPrimaryCommandForProfile(profile);
	return `${intervalLine}# 跨设备脚本建议显式写 device_code；如果源设备是 CP500，也建议补 TempIn / O2 这类 channel_code。
${buildLatestMetricRead("temperature", sourceProfile, "source_temp", { deviceCode: sourceCode })}
actions = []

if source_temp is not None and source_temp >= 75:
    actions.append({
        "target_device_code": ${JSON.stringify(targetCode)},
        "commands": [{"command": ${JSON.stringify(primaryCommand)}, "action": "on", "duration": 300000}]
    })
else:
    actions.append({
        "target_device_code": ${JSON.stringify(targetCode)},
        "commands": [{"command": ${JSON.stringify(primaryCommand)}, "action": "off"}]
    })`;
}

function getCrossDeviceOrchestrationExample(
	sourceDevice?: Device | null,
	targetDevice?: Device | null,
) {
	const sourceProfile = inferDeviceProfile(sourceDevice);
	const targetProfile = inferDeviceProfile(targetDevice);
	const cp500Code =
		sourceProfile === "cp500-v3"
			? getDeviceCodeOrExample(sourceDevice, "cp500-v3")
			: targetProfile === "cp500-v3"
			? getDeviceCodeOrExample(targetDevice, "cp500-v3")
			: getProfileExampleDeviceCode("cp500-v3");
	const mmcgsCode =
		sourceProfile === "mmcgs"
			? getDeviceCodeOrExample(sourceDevice, "mmcgs")
			: targetProfile === "mmcgs"
			? getDeviceCodeOrExample(targetDevice, "mmcgs")
			: getProfileExampleDeviceCode("mmcgs");

	return `MIN_CHECK_INTERVAL_SECONDS = 60

# 这个示例演示：读取 CP500 多个测点，再同时给 CP500 和 MMCGS 下发动作。
reactor_temp = get_latest_value("temperature", "TempIn", device_code="${cp500Code}")
tank_temp = get_latest_value("temperature", "TankTemp", device_code="${cp500Code}")
o2_value = get_latest_value("o2", "O2", device_code="${cp500Code}")

actions = []

if reactor_temp is not None and reactor_temp >= 70:
    actions.append({
        "target_device_code": "${cp500Code}",
        "commands": [
            {"command": "aeration", "action": "on", "duration": 180000}
        ]
    })

if reactor_temp is not None and reactor_temp >= 70 and o2_value is not None and o2_value <= 8:
    actions.append({
        "target_device_code": "${mmcgsCode}",
        "commands": [
            {"command": "point1", "action": "on", "duration": 60000},
            {"command": "purge", "action": "on", "duration": 30000}
        ]
    })

if tank_temp is not None and tank_temp >= 55:
    actions.append({
        "target_device_code": "${cp500Code}",
        "commands": [
            {"command": "pump", "action": "on", "duration": 120000}
        ]
    })`;
}

function getDefaultPythonExample(profile: DeviceProfile) {
	const intervalLine = "MIN_CHECK_INTERVAL_SECONDS = 60\n\n";
	const primaryCommand = getPrimaryCommandForProfile(profile);
	return `${intervalLine}${getMetricReadHint(profile)}
${buildLatestMetricRead("temperature", profile, "temp")}
commands = []

if temp is not None and temp >= 75:
    commands.append({"command": ${JSON.stringify(primaryCommand)}, "action": "on", "duration": 300000})
else:
    commands.append({"command": ${JSON.stringify(primaryCommand)}, "action": "off"})`;
}

const pythonExample = getDefaultPythonExample("generic");
const linkagePythonExample = getDefaultLinkagePythonExample("smart-compost");
const orchestrationPythonExample = getCrossDeviceOrchestrationExample();

const pythonScriptTemplates = [
	{
		key: "single-threshold",
		label: "单设备阈值控制",
		code: pythonExample,
	},
	{
		key: "single-time-window",
		label: "按时间窗口执行",
		code: `# 当前脚本默认面向本设备；如需跨设备下发，请改用 actions 并显式写 target_device_code。
now = datetime.now()
commands = []

if 9 <= now.hour < 11:
    commands.append({"command": "aeration", "action": "on", "duration": 180000})
else:
    commands.append({"command": "aeration", "action": "off"})`,
	},
	{
		key: "single-multi-command",
		label: "单设备多动作联动",
		code: `# 演示在同一台设备上组合两个指标做决策。
temp = get_latest_value("temperature")
o2_value = get_latest_value("o2")
commands = []

if temp is not None and temp >= 70:
    commands.append({"command": "aeration", "action": "on", "duration": 180000})

if o2_value is not None and o2_value <= 8:
    commands.append({"command": "pump", "action": "on", "duration": 120000})`,
	},
	{
		key: "single-model-aeration-v1",
		label: "算法模型控制（aeration_v1）",
		code: buildSingleModelPythonExample("generic", "aeration_v1", { command: "fan", maxDuration: 300000 }),
	},
	{
		key: "single-model-cp500-demo-v1",
		label: "示例模型控制（cp500_demo_control_v1）",
		code: buildSingleModelPythonExample("generic", "cp500_demo_control_v1", { command: "fan", maxDuration: 180000 }),
	},
	{
		key: "single-model-heater-v1",
		label: "加热器模型控制（heater_v1）",
		code: buildHeaterModelPythonExample("generic"),
	},
	{
		key: "single-time-and-threshold",
		label: "时间加阈值",
		code: `now = datetime.now()
temp = get_latest_value("temperature")
commands = []

if 13 <= now.hour < 18 and temp is not None and temp >= 70:
    commands.append({"command": "fan", "action": "on", "duration": 300000})
else:
    commands.append({"command": "fan", "action": "off"})`,
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
		key: "linkage-model-cp500-demo-v1",
		label: "联动示例模型（cp500_demo_control_v1）",
		code: `MIN_CHECK_INTERVAL_SECONDS = 60

# 跨设备模型示例：显式写 source device_code，并把动作下发给另一台设备。
temp_series = get_history("temperature", 5, "TempIn", device_code="CP500-01")
o2_series = get_history("o2", 5, "O2", device_code="CP500-01")

FEATURES["temp_avg_5m"] = sum(temp_series) / len(temp_series) if temp_series else None
FEATURES["o2_min_5m"] = min(o2_series) if o2_series else None
FEATURES["sample_count_temp"] = len(temp_series)
FEATURES["sample_count_o2"] = len(o2_series)

pred = predict("cp500_demo_control_v1", FEATURES)
actions = []

decision = pred.get("decision")
duration = int(pred.get("suggestions", {}).get("duration_ms", 60000))
duration = clamp(duration, 5000, 180000)

if decision == "on":
    actions.append({
        "target_device_code": "SMART-01",
        "commands": [{"command": "aeration", "action": "on", "duration": duration}]
    })
elif decision == "off":
    actions.append({
        "target_device_code": "SMART-01",
        "commands": [{"command": "aeration", "action": "off"}]
    })`,
	},
	{
		key: "linkage-time-window",
		label: "按时间联动",
		code: `now = datetime.now()
actions = []

if 8 <= now.hour < 20:
    actions.append({
        "target_device_code": "SMART-01",
        "commands": [{"command": "exhaust", "action": "on", "duration": 300000}]
    })
else:
    actions.append({
        "target_device_code": "SMART-01",
        "commands": [{"command": "exhaust", "action": "off"}]
    })`,
	},
	{
		key: "linkage-time-and-threshold",
		label: "时间加指标联动",
		code: `now = datetime.now()
source_temp = get_latest_value("temperature", device_code="CP500-01")
actions = []

if 9 <= now.hour < 18 and source_temp is not None and source_temp >= 75:
    actions.append({
        "target_device_code": "SMART-01",
        "commands": [{"command": "exhaust", "action": "on", "duration": 300000}]
    })
else:
    actions.append({
        "target_device_code": "SMART-01",
        "commands": [{"command": "exhaust", "action": "off"}]
    })`,
	},
	{
		key: "multi-device-orchestration",
		label: "多设备综合编排",
		code: orchestrationPythonExample,
	},
] as const;

const singleTemplatePriority = [
	"single-threshold",
	"single-multi-command",
	"single-model-cp500-demo-v1",
] as const;

const linkageTemplatePriority = [
	"basic-linkage",
	"linkage-model-cp500-demo-v1",
	"multi-device-orchestration",
] as const;

function getLinkagePythonTemplates(
	sourceDevice: Device | null | undefined,
	targetDevice: Device | null | undefined,
) {
	const targetProfile = inferDeviceProfile(targetDevice);
	const sourceProfile = inferDeviceProfile(sourceDevice);
	const sourceCode = getDeviceCodeOrExample(sourceDevice, inferDeviceProfile(sourceDevice));
	const targetCode = getDeviceCodeOrExample(targetDevice, targetProfile);
	const primaryCommand = getPrimaryCommandForProfile(targetProfile);

	return linkagePythonTemplates
		.filter((template) => linkageTemplatePriority.includes(template.key as (typeof linkageTemplatePriority)[number]))
		.map((template) => {
		if (template.key === "basic-linkage") {
			return {
				...template,
				code: getDefaultLinkagePythonExample(targetProfile, sourceDevice, targetDevice),
			};
		}
		if (template.key === "linkage-time-window") {
			return {
				...template,
				code: `# 定时联动示例：到点后把动作下发到目标设备。
now = datetime.now()
actions = []

if 8 <= now.hour < 20:
    actions.append({
        "target_device_code": "${targetCode}",
        "commands": [{"command": "${primaryCommand}", "action": "on", "duration": 300000}]
    })
else:
    actions.append({
        "target_device_code": "${targetCode}",
        "commands": [{"command": "${primaryCommand}", "action": "off"}]
    })`,
			};
		}
		if (template.key === "linkage-model-cp500-demo-v1") {
			return {
				...template,
				code: `MIN_CHECK_INTERVAL_SECONDS = 60

# 跨设备模型示例：显式写 source device_code，并按目标设备类型自动选动作。
${buildHistoryMetricRead("temperature", sourceProfile, "temp_series", 5, { deviceCode: sourceCode })}
${buildHistoryMetricRead("o2", sourceProfile, "o2_series", 5, { deviceCode: sourceCode })}

FEATURES["temp_avg_5m"] = sum(temp_series) / len(temp_series) if temp_series else None
FEATURES["o2_min_5m"] = min(o2_series) if o2_series else None
FEATURES["sample_count_temp"] = len(temp_series)
FEATURES["sample_count_o2"] = len(o2_series)

pred = predict("cp500_demo_control_v1", FEATURES)
actions = []

decision = pred.get("decision")
duration = int(pred.get("suggestions", {}).get("duration_ms", 60000))
duration = clamp(duration, 5000, 180000)

if decision == "on":
    actions.append({
        "target_device_code": "${targetCode}",
        "commands": [{"command": "${primaryCommand}", "action": "on", "duration": duration}]
    })
elif decision == "off":
    actions.append({
        "target_device_code": "${targetCode}",
        "commands": [{"command": "${primaryCommand}", "action": "off"}]
    })`,
			};
		}
		if (template.key === "multi-device-orchestration") {
			return {
				...template,
				code: getCrossDeviceOrchestrationExample(sourceDevice, targetDevice),
			};
		}
		if (template.key === "linkage-time-and-threshold") {
			return {
				...template,
				code: `now = datetime.now()
${buildLatestMetricRead("temperature", sourceProfile, "source_temp", { deviceCode: sourceCode })}
actions = []

if 9 <= now.hour < 18 and source_temp is not None and source_temp >= 75:
    actions.append({
        "target_device_code": "${targetCode}",
        "commands": [{"command": "${primaryCommand}", "action": "on", "duration": 300000}]
    })
else:
    actions.append({
        "target_device_code": "${targetCode}",
        "commands": [{"command": "${primaryCommand}", "action": "off"}]
    })`,
			};
		}
		return template;
		});
}

function getPythonTemplatesForProfile(profile: DeviceProfile) {
	const primaryCommand = getPrimaryCommandForProfile(profile);
	const secondaryCommand = getSecondaryCommandForProfile(profile);

	return pythonScriptTemplates
		.filter((template) => {
			if (!singleTemplatePriority.includes(template.key as (typeof singleTemplatePriority)[number])) {
				return false;
			}
			if (profile === "mmcgs") {
				return ![
					"single-model-aeration-v1",
					"single-model-cp500-demo-v1",
					"single-model-heater-v1",
				].includes(template.key);
			}
			if (profile === "smart-compost") {
				return template.key !== "single-model-heater-v1";
			}
			return true;
		})
		.map((template) => {
			if (template.key === "single-threshold") {
				return {
					...template,
					code: getDefaultPythonExample(profile),
				};
			}
			if (template.key === "single-time-window") {
				return {
					...template,
					code: `# 当前脚本默认面向本设备；如需跨设备下发，请改用 actions 并显式写 target_device_code。
now = datetime.now()
commands = []

if 9 <= now.hour < 11:
    commands.append({"command": "${primaryCommand}", "action": "on", "duration": 180000})
else:
    commands.append({"command": "${primaryCommand}", "action": "off"})`,
				};
			}
			if (template.key === "single-multi-command") {
				return {
					...template,
					code: `# 演示在同一台设备上组合多个指标做决策。
${buildLatestMetricRead("temperature", profile, "temp")}
${buildLatestMetricRead("o2", profile, "o2_value")}
commands = []

if temp is not None and temp >= 70:
    commands.append({"command": "${primaryCommand}", "action": "on", "duration": 180000})

if o2_value is not None and o2_value <= 8:
    commands.append({"command": "${secondaryCommand}", "action": "on", "duration": 120000})`,
				};
			}
			if (template.key === "single-model-aeration-v1") {
				return {
					...template,
					code: buildSingleModelPythonExample(profile, "aeration_v1", {
						command: primaryCommand,
						maxDuration: 300000,
					}),
				};
			}
			if (template.key === "single-model-cp500-demo-v1") {
				return {
					...template,
					code: buildSingleModelPythonExample(profile, "cp500_demo_control_v1", {
						command: primaryCommand,
						maxDuration: 180000,
					}),
				};
			}
			if (template.key === "single-model-heater-v1") {
				return {
					...template,
					code: buildHeaterModelPythonExample(profile),
				};
			}
			if (template.key === "single-time-and-threshold") {
				return {
					...template,
					code: `now = datetime.now()
${buildLatestMetricRead("temperature", profile, "temp")}
commands = []

if 13 <= now.hour < 18 and temp is not None and temp >= 70:
    commands.append({"command": "${primaryCommand}", "action": "on", "duration": 300000})
else:
    commands.append({"command": "${primaryCommand}", "action": "off"})`,
				};
			}
			return template;
		});
}

function findTemplateKeyByCode(
	templates: readonly { key: string; label: string; code: string }[],
	code: string | undefined,
) {
	const text = String(code || "");
	return templates.find((template) => template.code === text)?.key;
}

function getRecordValue(record: Record<string, unknown> | null | undefined, key: string): string {
	const value = record?.[key];
	return typeof value === "string" ? value : "";
}

function summarizeModelThresholds(ruleType: string, thresholds?: Record<string, unknown>): string {
	const t = thresholds || {};
	if (ruleType === "aeration") {
		const tempFeature = String(t.temp_feature || "temp_avg_5m");
		const tempHigh = String(t.temp_high ?? 70);
		const o2Feature = String(t.o2_feature || "o2_min_5m");
		const o2Low = String(t.o2_low ?? 8);
		return `${tempFeature} >= ${tempHigh} 或 ${o2Feature} <= ${o2Low}`;
	}
	if (ruleType === "heater") {
		const tempFeature = String(t.temp_feature || "temp_avg_5m");
		const tempLow = String(t.temp_low ?? 52);
		const tempHigh = String(t.temp_high ?? 58);
		return `${tempFeature} <= ${tempLow} 开启，>= ${tempHigh} 关闭（中间区间 hold）`;
	}
	if (!Object.keys(t).length) return "未配置阈值";
	return JSON.stringify(t);
}

function summarizeModelSuggestions(suggestions?: Record<string, unknown>): string {
	const s = suggestions || {};
	if (typeof s.on_duration_ms === "number") {
		return `on_duration_ms=${s.on_duration_ms}`;
	}
	if (!Object.keys(s).length) return "未配置建议参数";
	return JSON.stringify(s);
}

function summarizeModelFeatureList(features?: string[]): string {
	if (!Array.isArray(features) || !features.length) return "未配置特征";
	return features.join(" / ");
}

function summarizeDecisionMap(decisionMap?: Record<string, unknown>): string {
	if (!decisionMap || typeof decisionMap !== "object" || !Object.keys(decisionMap).length) {
		return "未配置映射";
	}
	return Object.entries(decisionMap)
		.map(([key, value]) => `${key} -> ${String(value)}`)
		.join("，");
}

function summarizeModelPath(path?: string): string {
	const text = String(path || "").trim();
	if (!text) return "未配置路径";
	return text.split(/[\\/]/).pop() || text;
}

function summarizeModelType(kind?: string, ruleType?: string): string {
	const normalizedKind = String(kind || "").toLowerCase();
	const normalizedRuleType = String(ruleType || "").toLowerCase();
	const domainLabel =
		normalizedRuleType === "aeration" || normalizedRuleType === "aeration_v1"
			? "曝气控制"
			: normalizedRuleType === "heater" || normalizedRuleType === "heater_v1"
			? "加热控制"
			: normalizedRuleType
			? normalizedRuleType
			: "通用";

	if (normalizedKind === "rule") {
		return `规则模型 · ${domainLabel}`;
	}
	if (["model", "ml", "sklearn"].includes(normalizedKind)) {
		return `文件模型 · ${domainLabel}`;
	}
	return domainLabel;
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
	const rows = new Map<string, { metric: string; channelCodes: string[]; channelNames: string[] }>();
	for (const channel of channels) {
		const metric = detectChannelMetric({
			code: channel.code || "",
			name: channel.name || "",
			display_name: channel.display_name || "",
			unit: channel.unit || "",
			metric: channel.metric || "",
		});
		if (metric === "unknown") continue;
		const metricKey = normalizeMetric(metric);
		const channelCode = String(channel.code || "").trim();
		const channelName = String(channel.display_name || channel.name || channel.code || "").trim();
		if (!rows.has(metricKey)) {
			rows.set(metricKey, { metric: metricKey, channelCodes: [], channelNames: [] });
		}
		const row = rows.get(metricKey)!;
		if (channelCode && !row.channelCodes.includes(channelCode)) {
			row.channelCodes.push(channelCode);
		}
		if (channelName && !row.channelNames.includes(channelName)) {
			row.channelNames.push(channelName);
		}
	}
	return Array.from(rows.values()).map((item): MetricGuideRow => ({
		label: scriptMetricLabel(item.metric),
		metric: item.metric,
		channelCodes: item.channelCodes,
		channelNames: item.channelNames,
	}));
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
				sourceDeviceId?: number;
				source_device_id?: number;
				conditions?: Array<{
					metric?: string;
					channel_code?: string;
					operator?: string;
					value?: number;
					sourceDeviceId?: number;
					source_device_id?: number;
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
	if (list.length) {
		return list.map((item) => ({
			...item,
			sourceDeviceId:
				typeof item.sourceDeviceId === "number"
					? item.sourceDeviceId
					: typeof item.source_device_id === "number"
					? item.source_device_id
					: undefined,
		}));
	}
	if (config?.metric || config?.channel_code || config?.operator || config?.value !== undefined) {
		return [
			{
				metric: config.metric,
				channel_code: config.channel_code,
				operator: config.operator,
				value: config.value,
				sourceDeviceId:
					typeof config.sourceDeviceId === "number"
						? config.sourceDeviceId
						: typeof config.source_device_id === "number"
						? config.source_device_id
						: undefined,
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
					targetDeviceId:
						typeof row.target_device_id === "number" ? row.target_device_id : undefined,
					configText:
						isConfigUpdate
							? typeof row.config_text === "string"
								? row.config_text
								: row.config && typeof row.config === "object" && !Array.isArray(row.config)
								? JSON.stringify(row.config, null, 2)
								: ""
							: undefined,
				};
			});
	} catch {
		return [];
	}
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
					// 输入过程中允许不完整 JSON，避免每次键入都抛错。
					const rawText = String(row.configText || "");
					try {
						return {
							command: "config_update",
							config: parseConfigText(rawText),
							...(typeof row.targetDeviceId === "number" ? { target_device_id: row.targetDeviceId } : {}),
						};
					} catch {
						return {
							command: "config_update",
							config_text: rawText,
							...(typeof row.targetDeviceId === "number" ? { target_device_id: row.targetDeviceId } : {}),
						};
					}
				}
				return {
					command: row.command,
					action: row.action,
					...(row.duration !== undefined ? { duration: row.duration } : {}),
					...(typeof row.targetDeviceId === "number" ? { target_device_id: row.targetDeviceId } : {}),
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

function getCommandActionOptions(command?: string, profile?: DeviceProfile) {
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
	if (
		profile === "cp500-v3" &&
		(command === "heater" || command === "pump" || command === "aeration")
	) {
		return [
			{ value: "on", label: "开启" },
			{ value: "off", label: "关闭" },
			{ value: "auto", label: "自动" },
		];
	}
	return [
		{ value: "on", label: "开启" },
		{ value: "off", label: "关闭" },
	];
}

function getDefaultCommandForProfile(profile: DeviceProfile) {
	return getPrimaryCommandForProfile(profile);
}

function getDefaultActionForCommand(command?: string, profile?: DeviceProfile) {
	return command === "config_update" ? "" : getCommandActionOptions(command, profile)[0]?.value || "on";
}

function getDefaultDurationForCommand(command?: string) {
	if (!command || command === "config_update" || command === "restart" || command === "emergency") {
		return undefined;
	}
	if (command === "pump" || command === "purge") {
		return 60000;
	}
	return 300000;
}

function getPreferredAddCommand(
	commandOptions: Array<{ value: string; label: string }>,
	profile: DeviceProfile,
) {
	return (
		commandOptions.find((item) => !["config_update", "restart", "emergency"].includes(item.value))
			?.value || getDefaultCommandForProfile(profile)
	);
}

function trimCronValue(value?: string) {
	const cron = String(value || "").trim();
	return cron || undefined;
}

const minCheckIntervalFormRule = {
	validator: async (_: unknown, value: unknown) => {
		if (value === undefined || value === null || value === "") return;
		const n = Number(value);
		if (!Number.isFinite(n) || n < 0) throw new Error("请输入有效的秒数");
		if (n > 0 && n < 5) throw new Error("至少 5 秒，或填 0 / 留空表示不限制");
		if (n > 604800) throw new Error("不能超过 604800（7 天）");
	},
};

/** 与后端一致：仅识别行首赋值 ``MIN_CHECK_INTERVAL_SECONDS = N`` */
function extractMinCheckIntervalFromPythonCode(code: string | undefined): number | undefined {
	if (!code?.trim()) return undefined;
	const assign = code.match(/^\s*MIN_CHECK_INTERVAL_SECONDS\s*=\s*(\d+)\s*(?:#.*)?$/m);
	if (assign) return parseInt(assign[1], 10);
	return undefined;
}

function isCronLike(value?: string) {
	const cron = trimCronValue(value);
	if (!cron) return false;
	const parts = cron.split(/\s+/).filter(Boolean);
	return parts.length >= 5 && parts.length <= 6;
}

function buildThresholdConfigDraft(options: {
	sourceDeviceId?: number;
	conditionMode?: "all" | "any";
	conditions: Array<{
		metric?: string;
		channel_code?: string;
		operator?: string;
		value?: number;
		sourceDeviceId?: number;
	}>;
}) {
	const thresholdConfig: Record<string, unknown> = {};
	if (typeof options.sourceDeviceId === "number") {
		thresholdConfig.source_device_id = options.sourceDeviceId;
	}
	thresholdConfig.condition_mode = options.conditionMode || "all";
	thresholdConfig.conditions = options.conditions.map((condition) => ({
		metric: condition.metric,
		channel_code: condition.channel_code,
		operator: condition.operator,
		value: condition.value,
		...(typeof condition.sourceDeviceId === "number"
			? { source_device_id: condition.sourceDeviceId }
			: {}),
	}));
	if (options.conditions.length === 1) {
		thresholdConfig.metric = options.conditions[0].metric;
		thresholdConfig.channel_code = options.conditions[0].channel_code;
		thresholdConfig.operator = options.conditions[0].operator;
		thresholdConfig.value = options.conditions[0].value;
		if (typeof options.conditions[0].sourceDeviceId === "number") {
			thresholdConfig.source_device_id = options.conditions[0].sourceDeviceId;
		}
	}
	return thresholdConfig;
}

function buildScheduleConfigDraft(options: {
	cron?: string;
	sourceDeviceId?: number;
	includeEmpty?: boolean;
}) {
	const scheduleConfig: Record<string, unknown> = {};
	const cron = trimCronValue(options.cron);
	if (cron) {
		scheduleConfig.cron = cron;
	}
	if (typeof options.sourceDeviceId === "number") {
		scheduleConfig.source_device_id = options.sourceDeviceId;
	}
	if (!Object.keys(scheduleConfig).length && !options.includeEmpty) {
		return {};
	}
	return scheduleConfig;
}

function buildStructuredCommandTemplate(
	commandText: string,
	targetDeviceId?: number,
) {
	if (!String(commandText || "").trim()) {
		return {
			...(typeof targetDeviceId === "number" ? { target_device_id: targetDeviceId } : {}),
			commands: [],
		};
	}
	const commandTemplate = parseCommandTemplate(commandText);
	return {
		...(typeof targetDeviceId === "number" ? { target_device_id: targetDeviceId } : {}),
		...commandTemplate,
	};
}

function stripCommandTemplateMeta(commandTemplate?: Record<string, unknown>) {
	const template = { ...safeRecord(commandTemplate) };
	delete template.target_device_id;
	return template;
}

function buildCommandRowPayload(row: CommandRow) {
	if (row.command === "config_update") {
		const rawText = String(row.configText || "");
		try {
			return {
				command: "config_update",
				config: parseConfigText(rawText),
				...(typeof row.targetDeviceId === "number" ? { target_device_id: row.targetDeviceId } : {}),
			};
		} catch {
			return {
				command: "config_update",
				config_text: rawText,
				...(typeof row.targetDeviceId === "number" ? { target_device_id: row.targetDeviceId } : {}),
			};
		}
	}
	return {
		command: row.command,
		action: row.action,
		...(row.duration !== undefined ? { duration: row.duration } : {}),
		...(typeof row.targetDeviceId === "number" ? { target_device_id: row.targetDeviceId } : {}),
	};
}

function buildStructuredActionDraftFromCommandTemplate(
	commandTemplate?: Record<string, unknown>,
	fallbackTargetDeviceId?: number,
): StructuredActionDraft {
	const template = safeRecord(commandTemplate);
	const primaryActions = parseCommandRowsForKey(JSON.stringify(template, null, 2), "commands");
	const targetDeviceId =
		typeof template.target_device_id === "number" ? template.target_device_id : fallbackTargetDeviceId;
	return {
		targetDeviceId,
		commandTemplate: template,
		primaryActions,
		elseActions: parseCommandRowsForKey(JSON.stringify(template, null, 2), "else_commands"),
	};
}

function buildStructuredActionDraftFromCommandText(
	commandText: string,
	targetDeviceId?: number,
): StructuredActionDraft {
	return buildStructuredActionDraftFromCommandTemplate(
		buildStructuredCommandTemplate(commandText, targetDeviceId),
		targetDeviceId,
	);
}

function buildStructuredActionFormValuesFromCommandText(
	commandText: string,
	targetDeviceId?: number,
): StructuredActionFormValues {
	if (!String(commandText || "").trim()) {
		return {
			targetDeviceId,
			primaryActions: [],
			elseCommands: [],
		};
	}
	try {
		return buildStructuredActionFormValuesFromDraft(
			buildStructuredActionDraftFromCommandText(commandText, targetDeviceId),
		);
	} catch {
		return {
			targetDeviceId,
			primaryActions: [],
			elseCommands: [],
		};
	}
}

function buildStructuredActionEditorText(values: StructuredActionFormValues) {
	return JSON.stringify(
		stripCommandTemplateMeta(buildStructuredActionCommandTemplate(values)),
		null,
		2,
	);
}

function buildRuleActionText(values: SharedStructuredActionInput) {
	return buildStructuredActionEditorText(buildStructuredActionFormValues(values));
}

function getStructuredExampleText(profile: DeviceProfile, type: ScriptType) {
	return JSON.stringify(parseCommandTemplate(getStructuredCommandExample(profile, type)), null, 2);
}

function commandRowIncludedInTemplate(row: CommandRow): boolean {
	return Boolean(row.command && (row.command === "config_update" || row.action));
}

function buildStructuredActionCommandTemplate(values: StructuredActionFormValues) {
	const buildCommandRowPayloadForEditor = (row: CommandRow) => {
		if (row.command === "config_update") {
			const rawText = String(row.configText || "");
			try {
				return {
					command: "config_update",
					config: parseConfigText(rawText),
					...(typeof row.targetDeviceId === "number" ? { target_device_id: row.targetDeviceId } : {}),
				};
			} catch {
				return {
					command: "config_update",
					config_text: rawText,
					...(typeof row.targetDeviceId === "number" ? { target_device_id: row.targetDeviceId } : {}),
				};
			}
		}
		return {
			command: row.command,
			action: row.action,
			...(row.duration !== undefined ? { duration: row.duration } : {}),
			...(typeof row.targetDeviceId === "number" ? { target_device_id: row.targetDeviceId } : {}),
		};
	};

	const primaryActions =
		safeArray<CommandRow>(values.primaryActions).filter(commandRowIncludedInTemplate).length
			? safeArray<CommandRow>(values.primaryActions)
					.filter(commandRowIncludedInTemplate)
					.map((item) => buildCommandRowPayloadForEditor(item))
			: [];
	const elseCommands = safeArray<CommandRow>(values.elseCommands)
		.filter(commandRowIncludedInTemplate)
		.map((item) => buildCommandRowPayloadForEditor(item));

	return {
		...(values.targetDeviceId ? { target_device_id: values.targetDeviceId } : {}),
		commands: primaryActions,
		...(elseCommands.length ? { else_commands: elseCommands } : {}),
	};
}

function buildStructuredActionFormValuesFromDraft(draft: StructuredActionDraft): StructuredActionFormValues {
	return {
		targetDeviceId: draft.targetDeviceId,
		primaryActions: draft.primaryActions,
		elseCommands: draft.elseActions.length ? draft.elseActions : [],
	};
}

function buildRuleActionFormValuesFromDraft(
	draft: RuleDraft,
	profile: DeviceProfile,
): StructuredActionFormValues & { commandText: string } {
	const actionDraft = buildStructuredActionDraftFromCommandTemplate(draft.commandTemplate, draft.targetDeviceId);
	const actionFormValues = buildStructuredActionFormValuesFromDraft(actionDraft);
	const fallbackText = getStructuredExampleText(profile, draft.type);
	return {
		...actionFormValues,
		commandText: Object.keys(stripCommandTemplateMeta(actionDraft.commandTemplate)).length
			? buildRuleActionText(actionFormValues)
			: fallbackText,
	};
}

function hasStructuredPrimaryActions(values: StructuredActionFormValues) {
	return safeArray<CommandRow>(values.primaryActions).some(commandRowIncludedInTemplate);
}

function getFirstActionTargetDeviceId(values?: StructuredActionFormValues) {
	const rows = [
		...safeArray<CommandRow>(values?.primaryActions),
		...safeArray<CommandRow>(values?.elseCommands),
	];
	return rows.find((row) => typeof row.targetDeviceId === "number")?.targetDeviceId;
}

function hasAnyConditionSource(conditions: RuleCondition[] | undefined, fallbackSourceDeviceId?: number) {
	return safeArray<RuleCondition>(conditions).some((item) => typeof item.sourceDeviceId === "number") || typeof fallbackSourceDeviceId === "number";
}

function normalizeActionRowsForProfile(
	actions: CommandRow[] | undefined,
	profile: DeviceProfile,
	commandOptions: Array<{ value: string; label: string }>,
) {
	const rows = safeArray<CommandRow>(actions);
	const allowedCommands = new Set(commandOptions.map((item) => item.value));
	if (!rows.length) {
		return [];
	}
	return rows.map((row) => {
		const nextCommand =
			row.command && allowedCommands.has(row.command)
				? row.command
				: getPreferredAddCommand(commandOptions, profile);
		const actionOptions = getCommandActionOptions(nextCommand, profile);
		const nextAction =
			nextCommand === "config_update"
				? undefined
				: actionOptions.length && actionOptions.some((item) => item.value === row.action)
				? row.action
				: getDefaultActionForCommand(nextCommand, profile);
		return {
			...row,
			command: nextCommand,
			action: nextAction,
			duration:
				nextCommand === "config_update" || nextCommand === "restart" || nextCommand === "emergency"
					? undefined
					: row.duration ?? getDefaultDurationForCommand(nextCommand),
			targetDeviceId: row.targetDeviceId,
		};
	});
}

function applyStructuredActionEditorChange(
	next: string,
	targetDeviceId: number | undefined,
	setFieldValue: (name: FormFieldName, value: unknown) => void,
	commandTemplateFieldName?: FormFieldName,
) {
	const nextValues = buildStructuredActionFormValuesFromCommandText(next, targetDeviceId);
	setFieldValue("primaryActions", nextValues.primaryActions || []);
	setFieldValue("elseCommands", nextValues.elseCommands || []);
	if (commandTemplateFieldName) {
		setFieldValue(commandTemplateFieldName, next);
	}
}

function buildStructuredActionFormValues(values: SharedStructuredActionInput): StructuredActionFormValues {
	if (safeArray<CommandRow>(values.primaryActions).length || safeArray<CommandRow>(values.elseCommands).length) {
		return {
			targetDeviceId: values.targetDeviceId ?? values.target_device_id,
			primaryActions: safeArray<CommandRow>(values.primaryActions),
			elseCommands: safeArray<CommandRow>(values.elseCommands),
		};
	}
	return buildStructuredActionFormValuesFromCommandText(values.command_template || "", values.targetDeviceId ?? values.target_device_id);
}

function normalizeScriptEditorValues(values: Partial<ScriptFormValues>): SharedRuleEditorValues {
	return {
		name: values.name || "",
		description: values.description || "",
		is_active: values.is_active ?? true,
		priority: values.priority ?? 0,
		type: values.script_type || "threshold",
		sourceDeviceId: values.target_device_id,
		targetDeviceId: values.target_device_id,
		conditions: normalizeThresholdConditions(values.threshold_config),
		conditionMode: values.threshold_config?.condition_mode || "all",
		cron: values.schedule_config?.cron,
		pythonCode: values.python_code || "",
		commandTemplateText: values.command_template || "",
		primaryActions: values.primaryActions,
		elseCommands: values.elseCommands,
		minCheckIntervalSeconds: (() => {
			if (values.script_type === "python" && values.python_code) {
				const fromCode = extractMinCheckIntervalFromPythonCode(values.python_code);
				if (fromCode !== undefined) return fromCode;
			}
			if (typeof values.threshold_config?.min_check_interval_seconds === "number") {
				return values.threshold_config.min_check_interval_seconds;
			}
			return undefined;
		})(),
	};
}

function normalizeLinkageEditorValues(values: Partial<LinkageFormValues>): SharedRuleEditorValues {
	const sourceDeviceIds = safeArray<number>(values.sourceDeviceIds);
	const targetDeviceIds = safeArray<number>(values.targetDeviceIds);
	return {
		name: values.name || "",
		description: values.description || "",
		is_active: values.is_active ?? true,
		priority: values.priority ?? 0,
		type: values.linkage_type || "threshold",
		sourceDeviceId: values.sourceDeviceId ?? sourceDeviceIds[0],
		targetDeviceId: values.targetDeviceId ?? targetDeviceIds[0],
		conditions: normalizeThresholdConditions({
			conditions: values.conditions,
			metric: values.sourceMetric,
			channel_code: values.sourceChannelCode,
			operator: values.operator,
			value: values.threshold,
			sourceDeviceId: values.sourceDeviceId ?? sourceDeviceIds[0],
		}),
		conditionMode: values.conditionMode || "all",
		cron: values.scheduleCron,
		pythonCode: values.pythonCode || "",
		primaryActions: values.primaryActions,
		elseCommands: values.elseCommands,
		minCheckIntervalSeconds: (() => {
			if (values.linkage_type === "python" && values.pythonCode) {
				const fromCode = extractMinCheckIntervalFromPythonCode(values.pythonCode);
				if (fromCode !== undefined) return fromCode;
			}
			if (typeof values.min_check_interval_seconds === "number") {
				return values.min_check_interval_seconds;
			}
			return undefined;
		})(),
	};
}

function buildRuleDraftFromEditorValues(values: SharedRuleEditorValues): RuleDraft {
	return buildRuleDraft({
		name: values.name,
		description: values.description,
		type: values.type,
		is_active: values.is_active,
		priority: values.priority,
		sourceDeviceId: values.sourceDeviceId,
		targetDeviceId: values.targetDeviceId,
		conditionMode: values.conditionMode || "all",
		conditions: values.conditions || [],
		cron: values.cron,
		pythonCode: values.pythonCode,
		minCheckIntervalSeconds: values.minCheckIntervalSeconds,
		commandTemplate: buildStructuredActionCommandTemplate(
			buildStructuredActionFormValues({
				targetDeviceId: values.targetDeviceId,
				command_template: values.commandTemplateText,
				primaryActions: values.primaryActions,
				elseCommands: values.elseCommands,
			}),
		),
	});
}

function buildRuleDraft(input: SharedRuleDraftInput): RuleDraft {
	return {
		name: input.name.trim(),
		description: (input.description || "").trim(),
		type: input.type,
		isActive: input.is_active,
		priority: input.priority,
		sourceDeviceId: input.sourceDeviceId,
		targetDeviceId: input.targetDeviceId,
		conditionMode: input.conditionMode || "all",
		conditions: input.conditions || [],
		cron: trimCronValue(input.cron),
		pythonCode: input.pythonCode || "",
		commandTemplate: safeRecord(input.commandTemplate),
		minCheckIntervalSeconds:
			typeof input.minCheckIntervalSeconds === "number" ? input.minCheckIntervalSeconds : undefined,
	};
}

function buildRuleDraftFromScriptValues(values: ScriptFormValues): RuleDraft {
	return buildRuleDraftFromEditorValues(normalizeScriptEditorValues(values));
}

function buildRuleDraftFromLinkageValues(values: LinkageFormValues): RuleDraft {
	return buildRuleDraftFromEditorValues(normalizeLinkageEditorValues(values));
}

function buildRuleDraftFromScopeValues(
	scope: RuleScope,
	values: Partial<ScriptFormValues> | Partial<LinkageFormValues>,
) {
	return buildRuleDraftFromEditorValues(
		scope === "single"
			? normalizeScriptEditorValues(values as Partial<ScriptFormValues>)
			: normalizeLinkageEditorValues(values as Partial<LinkageFormValues>),
	);
}

function getScriptSourceDeviceId(script?: Script | null) {
	const thresholdConfig = safeRecord(script?.threshold_config);
	const scheduleConfig = safeRecord(script?.schedule_config);
	if (typeof thresholdConfig.source_device_id === "number") return thresholdConfig.source_device_id;
	if (typeof scheduleConfig.source_device_id === "number") return scheduleConfig.source_device_id;
	return safeArray<number>(script?.device_ids)[0];
}

function getScriptTargetDeviceId(script?: Script | null) {
	const commandTemplate = safeRecord(script?.command_template);
	if (typeof commandTemplate.target_device_id === "number") return commandTemplate.target_device_id;
	return safeArray<number>(script?.device_ids)[0];
}

function buildRuleDraftFromScriptRecord(script?: Script | null): RuleDraft {
	const thresholdConfig = safeRecord(script?.threshold_config);
	const scheduleConfig = safeRecord(script?.schedule_config);
	const sourceDeviceId = getScriptSourceDeviceId(script);
	const targetDeviceId = getScriptTargetDeviceId(script);

	return buildRuleDraft({
		name: script?.name || "",
		description: script?.description || "",
		type: script?.script_type || "threshold",
		is_active: script?.is_active ?? true,
		priority: script?.priority ?? 0,
		sourceDeviceId,
		targetDeviceId,
		conditionMode: thresholdConfig.condition_mode === "any" ? "any" : "all",
		conditions: normalizeThresholdConditions({
			conditions: Array.isArray(thresholdConfig.conditions)
				? (thresholdConfig.conditions as RuleCondition[])
				: undefined,
			metric: typeof thresholdConfig.metric === "string" ? thresholdConfig.metric : undefined,
			channel_code: typeof thresholdConfig.channel_code === "string" ? thresholdConfig.channel_code : undefined,
			operator: typeof thresholdConfig.operator === "string" ? thresholdConfig.operator : undefined,
			value: typeof thresholdConfig.value === "number" ? thresholdConfig.value : undefined,
		}),
		cron: typeof scheduleConfig.cron === "string" ? scheduleConfig.cron : undefined,
		pythonCode: script?.python_code,
		commandTemplate: safeRecord(script?.command_template),
		minCheckIntervalSeconds:
			typeof thresholdConfig.min_check_interval_seconds === "number"
				? thresholdConfig.min_check_interval_seconds
				: undefined,
	});
}

function buildRuleIdentityFormValues(draft: RuleDraft): RuleFormIdentityFields {
	return {
		name: draft.name,
		description: draft.description,
		is_active: draft.isActive,
		priority: draft.priority,
	};
}

function buildDefaultConditions(defaultMetric: string): RuleConditionFormValue[] {
	return [{ metric: defaultMetric, operator: ">=", value: 75 }];
}

function buildRuleTriggerFormValues(
	draft: RuleDraft,
	defaultMetric: string,
	pythonFallback: string,
): {
	type: ScriptType;
	conditionMode: "all" | "any";
	conditions: RuleConditionFormValue[];
	cron: string;
	pythonCode: string;
} {
	return {
		type: draft.type,
		conditionMode: draft.conditionMode,
		conditions: draft.conditions.length ? draft.conditions : buildDefaultConditions(defaultMetric),
		cron: draft.cron || "0 9 * * *",
		pythonCode: draft.pythonCode || pythonFallback,
	};
}

function buildSharedEditorValuesFromDraft(
	draft: RuleDraft,
	defaultMetric: string,
	pythonFallback: string,
	profile: DeviceProfile,
) {
	const triggerFields = buildRuleTriggerFormValues(draft, defaultMetric, pythonFallback);
	const actionFormValues = buildRuleActionFormValuesFromDraft(draft, profile);
	return {
		identity: buildRuleIdentityFormValues(draft),
		triggerFields,
		conditions: triggerFields.conditions,
		actionFormValues,
	};
}

function buildScriptFormValuesFromDraft(
	draft: RuleDraft,
	defaultMetric: string,
	profile: DeviceProfile = "generic",
): ScriptFormValues {
	const { identity, triggerFields, conditions, actionFormValues } = buildSharedEditorValuesFromDraft(
		draft,
		defaultMetric,
		getDefaultPythonExample(profile),
		profile,
	);

	return {
		...identity,
		script_type: triggerFields.type,
		threshold_config: {
			condition_mode: triggerFields.conditionMode,
			metric: conditions[0]?.metric || defaultMetric,
			channel_code: conditions[0]?.channel_code,
			operator: conditions[0]?.operator || ">=",
			value: conditions[0]?.value ?? 75,
			conditions,
			...(typeof draft.minCheckIntervalSeconds === "number" && draft.minCheckIntervalSeconds > 0
				? { min_check_interval_seconds: draft.minCheckIntervalSeconds }
				: {}),
		},
		schedule_config: {
			cron: triggerFields.cron,
		},
		python_code: triggerFields.pythonCode,
		primaryActions: actionFormValues.primaryActions,
		elseCommands: actionFormValues.elseCommands,
		command_template: actionFormValues.commandText,
		target_device_id: actionFormValues.targetDeviceId,
	};
}

function buildLinkageFormValuesFromDraft(
	draft: RuleDraft,
	defaultMetric: string,
	targetProfile: DeviceProfile = "smart-compost",
): LinkageFormValues {
	const { identity, triggerFields, conditions, actionFormValues } = buildSharedEditorValuesFromDraft(
		draft,
		defaultMetric,
		getDefaultLinkagePythonExample(targetProfile),
		targetProfile,
	);

	const sourceDeviceIds = Array.from(
		new Set(
			[draft.sourceDeviceId, ...conditions
				.map((item) => item.sourceDeviceId)
				.filter((item): item is number => typeof item === "number")]
				.filter((item): item is number => typeof item === "number"),
		),
	);
	const targetDeviceIds = Array.from(
		new Set(
			[
				actionFormValues.targetDeviceId,
				...safeArray<CommandRow>(actionFormValues.primaryActions).map((item) => item.targetDeviceId),
				...safeArray<CommandRow>(actionFormValues.elseCommands).map((item) => item.targetDeviceId),
			].filter((item): item is number => typeof item === "number"),
		),
	);

	return {
		...identity,
		linkage_type: triggerFields.type,
		sourceDeviceId: draft.sourceDeviceId,
		sourceDeviceIds,
		sourceMetric: conditions[0]?.metric || defaultMetric,
		sourceChannelCode: conditions[0]?.channel_code,
		operator: conditions[0]?.operator || ">=",
		threshold: conditions[0]?.value ?? 75,
		conditions,
		conditionMode: triggerFields.conditionMode,
		scheduleCron: triggerFields.cron,
		pythonCode: triggerFields.pythonCode,
		primaryActions: actionFormValues.primaryActions,
		targetDeviceId: actionFormValues.targetDeviceId,
		targetDeviceIds,
		elseCommands: actionFormValues.elseCommands,
		...(typeof draft.minCheckIntervalSeconds === "number" && draft.minCheckIntervalSeconds > 0
			? { min_check_interval_seconds: draft.minCheckIntervalSeconds }
			: {}),
	};
}

function buildRulePayloadBase(draft: RuleDraft) {
	return {
		name: draft.name,
		description: draft.description,
		script_type: draft.type,
		is_active: draft.isActive,
		priority: draft.priority,
		command_template: draft.commandTemplate,
		device_ids: draft.targetDeviceId ? [draft.targetDeviceId] : [],
	};
}

function buildRulePayloadFromDraft(
	draft: RuleDraft,
	scope: RuleScope,
	actionValues?: StructuredActionFormValues,
) {
	validateRuleDraft(draft, {
		scope,
		requirePythonActions: scope === "single",
		requireStructuredTarget: scope === "linkage",
		requireSourceForThreshold: scope === "linkage",
	});
	if (
		scope === "linkage" &&
		draft.type !== "python" &&
		(!hasStructuredPrimaryActions(actionValues || {}) ||
			!(typeof draft.targetDeviceId === "number" || typeof getFirstActionTargetDeviceId(actionValues) === "number"))
	) {
		throw new Error("请补全联动动作");
	}

	const anchorTargetDeviceId = draft.targetDeviceId ?? getFirstActionTargetDeviceId(actionValues);
	const anchorDeviceIds =
		scope === "linkage"
			? anchorTargetDeviceId
				? [anchorTargetDeviceId]
				: draft.sourceDeviceId
				? [draft.sourceDeviceId]
				: []
			: buildRulePayloadBase(draft).device_ids;

	let threshold_config: Record<string, unknown> =
		draft.type === "threshold" || draft.type === "hybrid"
			? buildThresholdConfigDraft({
					...(scope === "linkage" ? { sourceDeviceId: draft.sourceDeviceId } : {}),
					conditionMode: draft.conditionMode,
					conditions: draft.conditions,
			  })
			: scope === "linkage" && draft.type === "python" && draft.sourceDeviceId
			? { source_device_id: draft.sourceDeviceId }
			: {};
	if (
		draft.type !== "python" &&
		typeof draft.minCheckIntervalSeconds === "number" &&
		Number.isFinite(draft.minCheckIntervalSeconds) &&
		draft.minCheckIntervalSeconds > 0
	) {
		threshold_config = {
			...threshold_config,
			min_check_interval_seconds: Math.floor(draft.minCheckIntervalSeconds),
		};
	}

	const schedule_config =
		draft.type === "schedule" || draft.type === "hybrid"
			? buildScheduleConfigDraft({
					cron: draft.cron,
					...(scope === "linkage" ? { sourceDeviceId: draft.sourceDeviceId } : {}),
			  })
			: {};

	return {
		...buildRulePayloadBase(draft),
		device_ids: anchorDeviceIds,
		command_template: {
			...draft.commandTemplate,
			...(scope === "linkage" ? { rule_scope: "linkage" } : {}),
		},
		threshold_config,
		schedule_config,
		python_code: draft.type === "python" ? draft.pythonCode : "",
	};
}

function validateRuleDraft(
	draft: RuleDraft,
	options: {
		scope: RuleScope;
		requireStructuredTarget?: boolean;
		requireSourceForThreshold?: boolean;
		requirePythonActions?: boolean;
	},
) {
	if (!draft.name) {
		throw new Error(options.scope === "linkage" ? "请输入联动名称" : "请输入规则名称");
	}
	if (options.scope === "single" && !draft.targetDeviceId) {
		throw new Error("请选择所属设备");
	}
	if ((draft.type === "threshold" || draft.type === "hybrid") && !draft.conditions.length) {
		throw new Error(options.scope === "linkage" ? "请补全联动的阈值条件" : "请补全阈值条件");
	}
	if (
		(draft.type === "threshold" || draft.type === "hybrid") &&
		options.requireSourceForThreshold &&
		!hasAnyConditionSource(draft.conditions, draft.sourceDeviceId)
	) {
		throw new Error("请补全联动的阈值条件");
	}
	if ((draft.type === "schedule" || draft.type === "hybrid") && !draft.cron) {
		throw new Error(options.scope === "linkage" ? "请填写联动的定时表达式" : "请填写 Cron 表达式");
	}
	if (draft.type === "python") {
		if (!draft.pythonCode.trim()) {
			throw new Error(options.scope === "linkage" ? "请填写联动脚本" : "请填写 Python 脚本");
		}
		if (
			options.requirePythonActions &&
			!draft.pythonCode.includes("commands") &&
			!draft.pythonCode.includes("actions")
		) {
			throw new Error("Python 脚本中至少需要定义 commands 或 actions");
		}
	}
	if (
		options.requireStructuredTarget &&
		draft.type !== "python" &&
		options.scope === "single" &&
		!draft.targetDeviceId
	) {
		throw new Error("请先选择所属设备");
	}
	let interval = draft.minCheckIntervalSeconds;
	if (draft.type === "python") {
		const fromCode = extractMinCheckIntervalFromPythonCode(draft.pythonCode);
		if (fromCode !== undefined) interval = fromCode;
	}
	if (typeof interval === "number" && Number.isFinite(interval)) {
		if (interval < 0) {
			throw new Error("自动检查最小间隔不能为负数");
		}
		if (interval > 0 && interval < 5) {
			throw new Error("自动检查最小间隔至少为 5 秒（或留空/0 表示不限制）");
		}
		if (interval > 604800) {
			throw new Error("自动检查最小间隔过大（最多 7 天）");
		}
	}
}

function toScriptPayload(values: ScriptFormValues) {
	const draft = buildRuleDraftFromScriptValues(values);
	return buildRulePayloadFromDraft(draft, "single");
}

function toLinkagePayload(values: LinkageFormValues) {
	const draft = buildRuleDraftFromLinkageValues(values);
	const actionValues = buildStructuredActionFormValues(values);
	return buildRulePayloadFromDraft(draft, "linkage", actionValues);
}

function indentLines(text: string, spaces = 4) {
	const pad = " ".repeat(spaces);
	return text
		.split("\n")
		.map((line) => (line ? `${pad}${line}` : line))
		.join("\n");
}

function wrapPythonWithCronGuard(body: string, cron?: string, fallbackComment?: string) {
	const normalized = trimCronValue(cron);
	if (!normalized) return body;
	const trimmed = body.trim() || (fallbackComment || "pass");
	return `def cron_matches(expr: str) -> bool:\n    return scheduler_matches(expr)\n\nif cron_matches(${JSON.stringify(normalized)}):\n${indentLines(trimmed)}\nelse:\n    pass`;
}

function commandTemplateToPythonByKey(
	commandTemplate: Record<string, unknown> | undefined,
	key: "commands" | "else_commands",
	variableName: string,
) {
	try {
		const commands = safeArray<Record<string, unknown>>(commandTemplate?.[key]);
		if (!commands.length) return `${variableName} = []`;
		let hasConfigDraft = false;
		const previewCommands = commands.map((item) => {
			if (item.command !== "config_update" || typeof item.config_text !== "string") {
				return item;
			}
			try {
				const parsedConfig = parseConfigText(item.config_text);
				return {
					...item,
					config: parsedConfig,
				};
			} catch {
				hasConfigDraft = true;
				return {
					...item,
					config: {},
				};
			}
		});
		const prefix = hasConfigDraft ? "# 提示：存在未完成的 config_update JSON 草稿，预览按空对象显示\n" : "";
		return `${prefix}${variableName} = ${JSON.stringify(previewCommands, null, 2)}`;
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

function findDeviceById(devices: Device[] | undefined, deviceId?: number) {
	return typeof deviceId === "number" ? (devices || []).find((item) => item.device_id === deviceId) : undefined;
}

function buildConditionPreview(
	conditions: Array<{
		metric?: string;
		channel_code?: string;
		operator?: string;
		value?: number;
		sourceDeviceId?: number;
	}>,
	options?: {
		deviceId?: number;
		deviceCode?: string;
		devices?: Device[];
	},
) {
	const lines: string[] = [];
	const checks: string[] = [];
	const defaultSourceArgs = options?.deviceCode
		? `, device_code=${JSON.stringify(options.deviceCode)}`
		: typeof options?.deviceId === "number"
		? `, device_id=${options.deviceId}`
		: "";

	(conditions.length ? conditions : [{ metric: "temperature", operator: ">=", value: 0 }]).forEach((condition, index) => {
		const metric = String(condition.metric || "temperature");
		const channelCode = typeof condition.channel_code === "string" ? condition.channel_code : "";
		const variableName = toPythonVarName(channelCode || metric, `value_${index + 1}`);
		const conditionDevice = findDeviceById(options?.devices, condition.sourceDeviceId);
		const sourceArgs =
			conditionDevice?.code
				? `, device_code=${JSON.stringify(conditionDevice.code)}`
				: typeof condition.sourceDeviceId === "number"
				? `, device_id=${condition.sourceDeviceId}`
				: defaultSourceArgs;
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

function buildActionPlanPreviewFromTemplate(
	targetDevice: Device | null | undefined,
	commandTemplate: Record<string, unknown> | undefined,
	variableName = "actions",
	options?: { devices?: Device[] },
) {
	try {
		const commands = safeArray<Record<string, unknown>>(commandTemplate?.commands);
		const hasPerCommandTarget = commands.some(
			(item) => typeof item.target_device_id === "number" || typeof item.target_device_code === "string",
		);
		if (hasPerCommandTarget) {
			const grouped = new Map<string, { target_device_id?: number; target_device_code?: string; commands: Record<string, unknown>[] }>();
			commands.forEach((item) => {
				const command = { ...item };
				const targetDeviceId = typeof command.target_device_id === "number" ? command.target_device_id : undefined;
				const targetDeviceCode =
					typeof command.target_device_code === "string"
						? command.target_device_code
						: findDeviceById(options?.devices, targetDeviceId)?.code;
				delete command.target_device_id;
				delete command.target_device_code;
				const key = `${targetDeviceId || ""}:${targetDeviceCode || ""}`;
				if (!grouped.has(key)) {
					grouped.set(key, {
						...(typeof targetDeviceId === "number" ? { target_device_id: targetDeviceId } : {}),
						...(targetDeviceCode ? { target_device_code: targetDeviceCode } : {}),
						commands: [],
					});
				}
				grouped.get(key)!.commands.push(command);
			});
			return `${variableName} = ${JSON.stringify(Array.from(grouped.values()), null, 2)}`;
		}
		const target: Record<string, unknown> = { commands };
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

/** 预览顶部与脚本模式一致的赋值；源码里已有则不再重复 */
function buildMinCheckIntervalPreviewPrefix(
	draft: RuleDraft,
	options?: { pythonSource?: string },
): string {
	const v = draft.minCheckIntervalSeconds;
	if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) {
		return "";
	}
	if (
		options?.pythonSource !== undefined &&
		extractMinCheckIntervalFromPythonCode(options.pythonSource) !== undefined
	) {
		return "";
	}
	return `MIN_CHECK_INTERVAL_SECONDS = ${Math.floor(v)}\n\n`;
}

function buildRulePythonPreview(
	draft: RuleDraft,
	options: {
		scope: RuleScope;
		sourceDevice?: Device | null;
		targetDevice?: Device | null;
		devices?: Device[];
	},
) {
	const scopeLabel = options.scope === "single" ? "单设备规则预览" : "设备联动规则预览";
	const isPython = draft.type === "python";
	const sourceLabel =
		options.scope === "single"
			? options.targetDevice?.code || options.targetDevice?.name || "TARGET_DEVICE"
			: options.sourceDevice?.code || options.sourceDevice?.name || "SOURCE_DEVICE";
	const targetLabel =
		options.targetDevice?.code ||
		options.targetDevice?.name ||
		(options.scope === "single" ? "当前规则设备" : "TARGET_DEVICE");
	const cron = draft.cron || "0 9 * * *";
	const scriptBodyForPython = isPython ? draft.pythonCode || orchestrationPythonExample : "";
	const intervalPrefix = buildMinCheckIntervalPreviewPrefix(
		draft,
		isPython ? { pythonSource: scriptBodyForPython } : undefined,
	);

	if (isPython) {
		const scriptBody = scriptBodyForPython;
		return options.scope === "single"
			? `# ${scopeLabel}\n# 所属设备: ${targetLabel}\n${intervalPrefix}${scriptBody}`
			: `# ${scopeLabel}\n# 触发设备: ${sourceLabel}\n# 目标设备: ${targetLabel}\n${intervalPrefix}${scriptBody}`;
	}

	if (draft.type === "schedule") {
		const scheduleBody =
			options.scope === "single"
				? commandTemplateToPythonByKey(draft.commandTemplate, "commands", "commands")
				: buildActionPlanPreviewFromTemplate(options.targetDevice, draft.commandTemplate);
		if (options.scope === "single") {
			return `# ${scopeLabel}\n# 所属设备: ${targetLabel}\n${intervalPrefix}${wrapPythonWithCronGuard(
				scheduleBody,
				cron,
				"commands = []",
			)}`;
		}
		return `# ${scopeLabel}\n# 触发设备: ${sourceLabel}\n# 目标设备: ${targetLabel}\n${intervalPrefix}${wrapPythonWithCronGuard(
			scheduleBody,
			cron,
			"actions = []",
		)}`;
	}

	const { assignments, checks } = buildConditionPreview(draft.conditions, {
		deviceId: options.scope === "linkage" ? options.sourceDevice?.device_id : undefined,
		deviceCode: options.scope === "linkage" ? options.sourceDevice?.code : undefined,
		devices: options.devices,
	});
	const joiner = draft.conditionMode === "any" ? "\n    or " : "\n    and ";
	const ifExpr = checks.join(joiner);

	if (options.scope === "single") {
		const commandBlock = commandTemplateToPythonByKey(draft.commandTemplate, "commands", "commands");
		const elseCommandBlock = commandTemplateToPythonByKey(draft.commandTemplate, "else_commands", "commands");
		const hasElseBlock = !elseCommandBlock.trim().endsWith("commands = []");
		if (draft.type === "hybrid") {
			const hybridBody = `${assignments}\n\nif ${ifExpr}:\n${indentLines(commandBlock)}\nelse:\n${indentLines(
				hasElseBlock ? elseCommandBlock : "commands = []",
			)}`;
			return `# ${scopeLabel}\n# 所属设备: ${targetLabel}\n# 条件关系: ${draft.conditionMode === "any" ? "任一满足" : "全部满足"}\n${intervalPrefix}${wrapPythonWithCronGuard(
				hybridBody,
				cron,
				"commands = []",
			)}`;
		}
		return `# ${scopeLabel}\n# 所属设备: ${targetLabel}\n# 条件关系: ${draft.conditionMode === "any" ? "任一满足" : "全部满足"}\n${intervalPrefix}${assignments}\n\nif ${ifExpr}:\n${indentLines(commandBlock)}\nelse:\n${indentLines(hasElseBlock ? elseCommandBlock : "commands = []")}`;
	}

	const actionBlock = buildActionPlanPreviewFromTemplate(options.targetDevice, draft.commandTemplate, "actions", {
		devices: options.devices,
	});
	const elseActionBlock = (() => {
		const elseCommands = safeArray<Record<string, unknown>>(draft.commandTemplate?.else_commands);
		return buildActionPlanPreviewFromTemplate(options.targetDevice, { commands: elseCommands }, "actions", {
			devices: options.devices,
		});
	})();
	const hasElseActionBlock = !elseActionBlock.trim().endsWith("actions = []");
	if (draft.type === "hybrid") {
		const hybridBody = `${assignments}\n\nif ${ifExpr}:\n${indentLines(actionBlock)}\nelse:\n${indentLines(
			hasElseActionBlock ? elseActionBlock : "actions = []",
		)}`;
		return `# ${scopeLabel}\n# 触发设备: ${sourceLabel}\n# 目标设备: ${targetLabel}\n# 条件关系: ${draft.conditionMode === "any" ? "任一满足" : "全部满足"}\n${intervalPrefix}${wrapPythonWithCronGuard(
			hybridBody,
			cron,
			"actions = []",
		)}`;
	}
	return `# ${scopeLabel}\n# 触发设备: ${sourceLabel}\n# 目标设备: ${targetLabel}\n# 条件关系: ${draft.conditionMode === "any" ? "任一满足" : "全部满足"}\n${intervalPrefix}${assignments}\n\nif ${ifExpr}:\n${indentLines(actionBlock)}\nelse:\n${indentLines(hasElseActionBlock ? elseActionBlock : "actions = []")}`;
}

function buildScriptPythonPreview(values: Partial<ScriptFormValues>, targetDevice?: Device | null) {
	const draft = buildRuleDraftFromScopeValues("single", values);
	return buildRulePythonPreview(draft, {
		scope: "single",
		targetDevice,
	});
}

function buildLinkagePythonPreview(
	values: Partial<LinkageFormValues>,
	sourceDevice?: Device | null,
	targetDevice?: Device | null,
	devices?: Device[],
) {
	try {
		const draft = buildRuleDraftFromScopeValues("linkage", values);
		return buildRulePythonPreview(draft, {
			scope: "linkage",
			sourceDevice,
			targetDevice,
			devices,
		});
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
		commandTemplate.rule_scope === "linkage" ||
		typeof thresholdConfig.source_device_id === "number" ||
		typeof scheduleConfig.source_device_id === "number"
	);
}

function ruleScopeLabel(script: Script) {
	return isLinkageScript(script) ? "跨设备" : "本设备";
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
	profile,
	deviceOptions,
	defaultTargetDeviceId,
	targetLabel = "执行设备",
	fieldKey = "commands",
	title = "执行动作",
	emptyTitle = "先新增一条命令，或者直接编辑下面的 JSON。",
	addLabel = "新增命令",
	embedded = false,
}: {
	value: string;
	onChange: (value: string) => void;
	commandOptions: Array<{ value: string; label: string }>;
	profile?: DeviceProfile;
	deviceOptions?: Array<{ value: number; label: string }>;
	defaultTargetDeviceId?: number;
	targetLabel?: string;
	fieldKey?: "commands" | "else_commands";
	title?: string;
	emptyTitle?: string;
	addLabel?: string;
	embedded?: boolean;
}) {
	const rows = useMemo(() => parseCommandRowsForKey(value, fieldKey), [fieldKey, value]);
	const updateRows = (nextRows: CommandRow[]) => onChange(updateCommandTemplateRows(value, fieldKey, nextRows));
	const [configDraftMap, setConfigDraftMap] = useState<Record<number, string>>({});
	const getConfigDraftValue = (index: number, fallback: string) =>
		Object.prototype.hasOwnProperty.call(configDraftMap, index) ? configDraftMap[index] : fallback;
	const clearConfigDraft = (index: number) =>
		setConfigDraftMap((prev) => {
			if (!Object.prototype.hasOwnProperty.call(prev, index)) return prev;
			const next = { ...prev };
			delete next[index];
			return next;
		});
	const commitConfigDraft = (index: number) => {
		if (!Object.prototype.hasOwnProperty.call(configDraftMap, index)) return;
		const draft = configDraftMap[index];
		updateRows(
			rows.map((item, i) =>
				i === index
					? {
							...item,
							configText: draft,
					  }
					: item,
			),
		);
		clearConfigDraft(index);
	};
	const body = (
		<Space orientation="vertical" style={{ width: "100%" }}>
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					gap: 12,
					padding: "10px 12px",
					borderRadius: 10,
					background: "#f7f9fc",
					border: "1px solid #edf1f5",
				}}
			>
				<Text strong>{title}</Text>
				<Button
					size="small"
					onClick={() =>
						updateRows([
							...rows,
							{
								command: getPreferredAddCommand(commandOptions, profile || "generic"),
								action: getDefaultActionForCommand(
									getPreferredAddCommand(commandOptions, profile || "generic"),
									profile,
								),
								duration: getDefaultDurationForCommand(
									getPreferredAddCommand(commandOptions, profile || "generic"),
								),
								...(typeof defaultTargetDeviceId === "number"
									? { targetDeviceId: defaultTargetDeviceId }
									: {}),
							},
						])
					}
				>
					{addLabel}
				</Button>
			</div>
			{!rows.length ? <Alert type="info" showIcon title={emptyTitle} style={{ borderRadius: 10 }} /> : null}
			{rows.map((row, index) => {
				const actionOptions = getCommandActionOptions(row.command, profile);
				const isConfigUpdate = row.command === "config_update";
				return (
					<Space key={`${row.command}-${index}`} wrap align="start">
						{deviceOptions?.length ? (
							<Select
								style={{ width: 220 }}
								options={deviceOptions}
								value={row.targetDeviceId}
								placeholder={`选择${targetLabel}`}
								onChange={(next) =>
									updateRows(rows.map((item, i) => (i === index ? { ...item, targetDeviceId: next } : item)))
								}
							/>
						) : null}
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
													action: getDefaultActionForCommand(next, profile),
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
								value={getConfigDraftValue(index, row.configText ?? "")}
								placeholder={'例如：{\n  "read_interval": 120000,\n  "pump_run_time": 80000\n}'}
								onChange={(event) =>
									setConfigDraftMap((prev) => ({
										...prev,
										[index]: event.target.value,
									}))
								}
								onBlur={() => commitConfigDraft(index)}
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
	);

	if (embedded) return body;

	return <Card size="small">{body}</Card>;
}

function RuleBasicCard({
	typeFieldName,
	isActiveFieldName,
	priorityFieldName,
	namePlaceholder,
	descriptionPlaceholder,
	children,
	footerHint,
	topMeta,
}: {
	typeFieldName: FormFieldName;
	isActiveFieldName: FormFieldName;
	priorityFieldName: FormFieldName;
	namePlaceholder: string;
	descriptionPlaceholder: string;
	children?: ReactNode;
	footerHint?: ReactNode;
	topMeta?: ReactNode;
}) {
	return (
		<Card size="small" title="规则信息" style={{ ...panelCardStyle, marginBottom: 16 }} styles={sectionCardStyles}>
			{topMeta ? <div style={{ marginBottom: 16 }}>{topMeta}</div> : null}
			<Row gutter={12}>
				<Col xs={24} md={14}>
					<Form.Item label="规则名称" name="name" rules={[{ required: true, message: "请输入规则名称" }]} style={{ marginBottom: 12 }}>
						<Input placeholder={namePlaceholder} />
					</Form.Item>
				</Col>
				<Col xs={24} md={10}>
					<Form.Item label="规则类型" name={typeFieldName} rules={[{ required: true, message: "请选择规则类型" }]} style={{ marginBottom: 12 }}>
						<Select options={typeOptions as never} />
					</Form.Item>
				</Col>
			</Row>

			<Form.Item label="规则说明" name="description" style={{ marginBottom: children || footerHint ? 14 : 0 }}>
				<Input.TextArea rows={2} placeholder={descriptionPlaceholder} />
			</Form.Item>

			{children}

			<Row gutter={12} style={{ marginTop: children ? 4 : 0 }}>
				<Col xs={12} md={4}>
					<Form.Item label="启用状态" name={isActiveFieldName} valuePropName="checked" style={{ marginBottom: 0 }}>
						<Switch checkedChildren="启用" unCheckedChildren="停用" />
					</Form.Item>
				</Col>
				<Col xs={12} md={4}>
					<Form.Item label="优先级" name={priorityFieldName} style={{ marginBottom: 0 }}>
						<InputNumber min={0} style={{ width: "100%" }} />
					</Form.Item>
				</Col>
			</Row>

			{footerHint ? <div style={{ marginTop: 14 }}>{footerHint}</div> : null}
		</Card>
	);
}

function RulePreviewCard({
	scopeSummary,
	type,
	pythonHint,
	structuredHint,
	bullets,
	preview,
	metricGuideTitle,
	metricGuide,
	emptyMetricText,
	unselectedMetricText,
}: {
	scopeSummary: string;
	type: ScriptType;
	pythonHint?: string;
	structuredHint?: string;
	bullets: string[];
	preview: string;
	metricGuideTitle: string;
	metricGuide: MetricGuideRow[];
	emptyMetricText: string;
	unselectedMetricText: string;
}) {
	const copyText = async (text: string, successMessage: string) => {
		try {
			await navigator.clipboard.writeText(text);
			message.success(successMessage);
		} catch {
			message.error("复制失败，请手动复制");
		}
	};

	const metricCallSnippet = (metric: string) => `get_latest_value("${metric}")`;
	const channelCallSnippet = (metric: string, channelCode: string) =>
		`get_latest_value("${metric}", "${channelCode}")`;

	return (
		<Card size="small" title="规则说明与预览" style={panelCardStyle} styles={sectionCardStyles}>
			<Tag color={typeColor[type]}>{typeLabel(type)}</Tag>
			<Paragraph
				type="secondary"
				style={{
					marginTop: 12,
					marginBottom: 12,
					padding: "10px 12px",
					background: "#f7f9fc",
					border: "1px solid #edf1f5",
					borderRadius: 10,
				}}
			>
				{scopeSummary}
			</Paragraph>
			<Paragraph>
				{type === "threshold"
					? "适合按指标阈值触发动作。"
					: type === "schedule"
					? "适合固定周期任务，预览里会直接展开时间判断和动作。"
					: type === "hybrid"
					? "适合把时间条件和指标条件放在同一条规则里。"
					: "适合更复杂的编排逻辑，比如多参数、多设备和自定义时间判断。"}
			</Paragraph>
			<Paragraph type="secondary">
				脚本里优先使用 <Text code>temperature</Text>、<Text code>humidity</Text>、<Text code>o2</Text>、<Text code>co2</Text> 这类语义指标；只有需要精确到测点时，再补 <Text code>channel_code</Text>。
			</Paragraph>
			{type === "python" && pythonHint ? <Paragraph type="secondary">{pythonHint}</Paragraph> : null}
			{type !== "python" && structuredHint ? <Paragraph type="secondary">{structuredHint}</Paragraph> : null}
			<ul style={{ paddingLeft: 18, marginBottom: 12 }}>
				{bullets.map((item) => (
					<li key={item}>{item}</li>
				))}
			</ul>
			<Divider style={{ margin: "12px 0" }} />
			<Title level={5} style={{ marginTop: 0 }}>
				最终 Python 脚本预览
			</Title>
			<pre style={{ background: "#f6f8fa", borderRadius: 8, padding: 12, fontSize: 12, overflowX: "auto", marginBottom: 12 }}>{preview}</pre>
			{type === "python" ? null : (
				<>
			<Title level={5}>{metricGuideTitle}</Title>
			<Paragraph type="secondary" style={{ marginBottom: 8 }}>
				优先按 <Text code>metric</Text> 读取；只有同一指标下有多个测点时，再补 <Text code>channel_code</Text>。
			</Paragraph>
			{metricGuide.length ? (
				<Space orientation="vertical" size={6} style={{ width: "100%" }}>
					{metricGuide.map((row) => (
						<Space key={row.metric} orientation="vertical" size={4} style={{ width: "100%" }}>
							<Space wrap size={6}>
								<Text>
									{row.label}：metric=<Text code>{row.metric}</Text>
								</Text>
								<Button
									size="small"
									onClick={() => copyText(metricCallSnippet(row.metric), `已复制 ${row.metric} 调用模板`)}
								>
									复制 metric 调用
								</Button>
							</Space>
							{row.channelCodes.length ? (
								<Space wrap size={6}>
									<Text type="secondary">channel_code：</Text>
									{row.channelCodes.map((code, index) => (
										<Button
											key={`${row.metric}-${code}`}
											size="small"
											onClick={() =>
												copyText(
													channelCallSnippet(row.metric, code),
													`已复制 ${code} 调用模板`,
												)
											}
										>
											{code}
											{row.channelNames[index] ? `（${row.channelNames[index]}）` : ""}
										</Button>
									))}
								</Space>
							) : (
								<Text type="secondary">channel_code：可不填</Text>
							)}
						</Space>
					))}
				</Space>
			) : (
				<Text type="secondary">{emptyMetricText || unselectedMetricText}</Text>
			)}
				</>
			)}
		</Card>
	);
}

function PythonDeviceLookup({
	devices,
	title = "查看设备与通道",
}: {
	devices: Device[];
	title?: string;
}) {
	const [open, setOpen] = useState(false);
	const [selectedDeviceId, setSelectedDeviceId] = useState<number | undefined>(undefined);
	const deviceOptions = useMemo(
		() => devices.map((device) => ({ value: device.device_id, label: deviceLabel(device) })),
		[devices],
	);
	const selectedDevice = useMemo(
		() => devices.find((device) => device.device_id === selectedDeviceId) || devices[0],
		[devices, selectedDeviceId],
	);
	const metricGuide = useMemo(() => getMetricGuideForDevice(selectedDevice), [selectedDevice]);
	const copyText = async (text: string, successMessage: string) => {
		try {
			await navigator.clipboard.writeText(text);
			message.success(successMessage);
		} catch {
			message.error("复制失败，请手动复制");
		}
	};
	const latestCall = (metric: string, channelCode: string, deviceCode: string) =>
		`get_latest_value(${JSON.stringify(metric)}, ${JSON.stringify(channelCode)}, device_code=${JSON.stringify(deviceCode)})`;
	const historyCall = (metric: string, channelCode: string, deviceCode: string) =>
		`get_history(${JSON.stringify(metric)}, 5, ${JSON.stringify(channelCode)}, device_code=${JSON.stringify(deviceCode)})`;

	return (
		<>
			<Button
				size="small"
				onClick={() => {
					if (!selectedDeviceId && devices[0]?.device_id) {
						setSelectedDeviceId(devices[0].device_id);
					}
					setOpen(true);
				}}
			>
				{title}
			</Button>
			<Modal
				open={open}
				title="设备与通道速查"
				onCancel={() => setOpen(false)}
				footer={null}
				width={860}
			>
				<Space orientation="vertical" size={12} style={{ width: "100%" }}>
					<Text type="secondary">
						查设备编码、指标名和通道名时用这里最快；跨设备脚本建议显式写 <Text code>device_code</Text>。
					</Text>
					{devices.length ? (
						<>
							<Form.Item label="选择设备" style={{ marginBottom: 0 }}>
								<Select
									options={deviceOptions}
									value={selectedDevice?.device_id}
									onChange={(value) => setSelectedDeviceId(value)}
									placeholder="选择要查看的设备"
								/>
							</Form.Item>
							{selectedDevice ? (
								<Card
									size="small"
									style={compactMetricCardStyle}
									title={
										<Space wrap size={8}>
											<Text strong>{deviceLabel(selectedDevice)}</Text>
											{selectedDevice.code ? <Text code>{selectedDevice.code}</Text> : null}
											<Tag color="blue">{getProfileLabel(inferDeviceProfile(selectedDevice))}</Tag>
										</Space>
									}
								>
									{metricGuide.length ? (
										<Space orientation="vertical" size={6} style={{ width: "100%" }}>
											{metricGuide.map((row) => (
												<div key={`${selectedDevice.device_id}-${row.metric}`}>
													<Text type="secondary">
														{row.label}：metric=<Text code>{row.metric}</Text>
														{row.channelCodes.length ? `，channel_code=${row.channelCodes.join(" / ")}` : ""}
													</Text>
													{selectedDevice.code && row.channelCodes.length ? (
														<Space wrap size={6} style={{ marginTop: 4 }}>
															{row.channelCodes.map((channelCode) => (
																<Space key={`${selectedDevice.device_id}-${row.metric}-${channelCode}`} wrap size={6}>
																	<Text code>{channelCode}</Text>
																	<Button
																		size="small"
																		onClick={() =>
																			copyText(
																				latestCall(row.metric, channelCode, selectedDevice.code || ""),
																				`已复制 ${channelCode} 的 latest 调用`,
																			)
																		}
																	>
																		复制 latest
																	</Button>
																	<Button
																		size="small"
																		onClick={() =>
																			copyText(
																				historyCall(row.metric, channelCode, selectedDevice.code || ""),
																				`已复制 ${channelCode} 的 history 调用`,
																			)
																		}
																	>
																		复制 history
																	</Button>
																</Space>
															))}
														</Space>
													) : null}
												</div>
											))}
										</Space>
									) : (
										<Text type="secondary">暂无通道信息</Text>
									)}
								</Card>
							) : null}
						</>
					) : (
						<Text type="secondary">暂无设备数据</Text>
					)}
				</Space>
			</Modal>
		</>
	);
}

function ConditionsEditor({
	form,
	listName,
	conditionModeName,
	conditionMode,
	metricOptions,
	getChannelOptions,
	defaultMetric,
	deviceOptions,
	sourceLabel = "触发设备",
}: {
	form: { getFieldValue: (name: unknown) => unknown };
	listName: FormFieldName;
	conditionModeName: FormFieldName;
	conditionMode: "all" | "any";
	metricOptions: Array<{ value: string; label: string }>;
	getChannelOptions: (metricValue?: string, sourceDeviceId?: number) => Array<{ value: string; label: string }>;
	defaultMetric: string;
	deviceOptions?: Array<{ value: number; label: string }>;
	sourceLabel?: string;
}) {
	return (
		<>
			<Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
				{conditionMode === "any" ? "任一条件满足后执行。" : "全部条件满足后执行。"}
			</Text>
			<Form.List name={listName}>
				{(fields, { add, remove }) => (
					<Space orientation="vertical" style={{ width: "100%" }} size={12}>
						{fields.map((field, index) => {
							const metricValue = form.getFieldValue([...((Array.isArray(listName) ? listName : [listName]) as (string | number)[]), field.name, "metric"]);
							const rowSourceDeviceId = form.getFieldValue([
								...((Array.isArray(listName) ? listName : [listName]) as (string | number)[]),
								field.name,
								"sourceDeviceId",
							]);
							const channelOptions = getChannelOptions(
								typeof metricValue === "string" ? metricValue : undefined,
								typeof rowSourceDeviceId === "number" ? rowSourceDeviceId : undefined,
							);
							return (
								<div
									key={field.key}
									style={{
										border: "1px solid #edf1f5",
										borderRadius: 12,
										padding: 12,
										background: "#fff",
									}}
								>
									<Row gutter={[8, 8]} align="middle">
										{deviceOptions?.length ? (
											<Col xs={24} md={12} xl={7}>
												<Form.Item
													label={index === 0 ? <span style={{ whiteSpace: "nowrap" }}>{sourceLabel}</span> : undefined}
													name={[field.name, "sourceDeviceId"]}
													rules={[{ required: true, message: `请选择${sourceLabel}` }]}
													style={{ marginBottom: 0 }}
												>
													<Select
														showSearch
														optionFilterProp="label"
														options={deviceOptions}
														placeholder={`选择${sourceLabel}`}
													/>
												</Form.Item>
											</Col>
										) : null}
										<Col xs={24} md={12} xl={deviceOptions?.length ? 6 : 7}>
											<Form.Item
												label={index === 0 ? <span style={{ whiteSpace: "nowrap" }}>监控指标</span> : undefined}
												name={[field.name, "metric"]}
												rules={[{ required: true, message: "请选择指标" }]}
												style={{ marginBottom: 0 }}
											>
												<Select options={metricOptions} placeholder="选择指标" />
											</Form.Item>
										</Col>
										<Col xs={24} md={12} xl={deviceOptions?.length ? 7 : 8}>
											<Form.Item
												label={index === 0 ? <span style={{ whiteSpace: "nowrap" }}>监控通道</span> : undefined}
												name={[field.name, "channel_code"]}
												style={{ marginBottom: 0 }}
											>
												<Select allowClear options={channelOptions} placeholder="按需指定通道" />
											</Form.Item>
										</Col>
										<Col xs={12} md={6} xl={2}>
											<Form.Item
												label={index === 0 ? <span style={{ whiteSpace: "nowrap" }}>比较符</span> : undefined}
												name={[field.name, "operator"]}
												rules={[{ required: true, message: "请选择比较符" }]}
												style={{ marginBottom: 0 }}
											>
												<Select options={operatorOptions} />
											</Form.Item>
										</Col>
										<Col xs={12} md={8} xl={4}>
											<Form.Item
												label={index === 0 ? <span style={{ whiteSpace: "nowrap" }}>阈值</span> : undefined}
												name={[field.name, "value"]}
												rules={[{ required: true, message: "请输入阈值" }]}
												style={{ marginBottom: 0 }}
											>
												<InputNumber style={{ width: "100%" }} />
											</Form.Item>
										</Col>
										<Col xs={24} md={4} xl={deviceOptions?.length ? 2 : 3}>
											<div style={{ display: "flex", justifyContent: "flex-end", alignItems: "end", height: "100%" }}>
												<Button danger size="small" onClick={() => remove(field.name)} disabled={fields.length <= 1}>
													删除
												</Button>
											</div>
										</Col>
									</Row>
								</div>
							);
						})}
						<Button
							size="small"
							onClick={() =>
								add({
									metric: defaultMetric,
									operator: ">=",
									value: 0,
									...(deviceOptions?.[0]?.value ? { sourceDeviceId: deviceOptions[0].value } : {}),
								})
							}
						>
							新增条件
						</Button>
					</Space>
				)}
			</Form.List>
		</>
	);
}

function PythonLogicCard({
	codeFieldName,
	codeLabel,
	codeValueName,
	templates,
	auxActions,
	scriptHint,
}: {
	codeFieldName: FormFieldName;
	codeLabel: string;
	codeValueName: "python_code" | "pythonCode";
	templates: readonly { key: string; label: string; code: string }[];
	auxActions?: ReactNode;
	scriptHint?: string;
}) {
	const form = Form.useFormInstance();
	const [showAllModels, setShowAllModels] = useState(false);
	const modelRegistryQ = useQuery({
		queryKey: ["script-model-registry"],
		queryFn: async () =>
			(await api.get("/scripts/model-registry")).data as { count: number; data: ModelRegistryItem[] },
		staleTime: 60 * 1000,
	});
	const modelHealthQ = useQuery({
		queryKey: ["script-model-health"],
		queryFn: async () =>
			(await api.get("/scripts/model-health")).data as { count: number; data: ModelHealthItem[] },
		staleTime: 30 * 1000,
	});
	const modelGuideRows = useMemo(
		() => (modelRegistryQ.data?.data || []).filter((item) => item.name.includes("_demo_")),
		[modelRegistryQ.data],
	);
	const modelHealthMap = useMemo(
		() =>
			new Map(
				(modelHealthQ.data?.data || []).map((item) => [item.name, item]),
			),
		[modelHealthQ.data],
	);
	const visibleModelGuideRows = useMemo(
		() => (showAllModels ? modelGuideRows : modelGuideRows.slice(0, 4)),
		[modelGuideRows, showAllModels],
	);

	return (
		<Card
			size="small"
			title="触发逻辑"
			extra={auxActions}
			style={{ ...panelCardStyle, marginBottom: 16 }}
			styles={sectionCardStyles}
		>
			<Space wrap style={{ marginBottom: 12 }}>
				<Text type="secondary">推荐模板</Text>
				{templates.map((template) => (
					<Button key={template.key} size="small" onClick={() => form.setFieldValue(codeValueName, template.code)}>
						{template.label}
					</Button>
				))}
			</Space>
			<Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
				{scriptHint || '脚本里可直接使用 predict、datetime、timedelta、sum、min、max、round、abs、clamp；如需限制检查频率，在顶部写 MIN_CHECK_INTERVAL_SECONDS = 60。'}
			</Text>
			<Card
				size="small"
				title="模型速览"
				extra={
					modelGuideRows.length > 4 ? (
						<Button size="small" type="link" onClick={() => setShowAllModels((value) => !value)}>
							{showAllModels ? "收起" : `展开全部（${modelGuideRows.length}）`}
						</Button>
					) : null
				}
				style={{ ...compactMetricCardStyle, marginBottom: 12 }}
				styles={{ body: { background: "#fafafa", borderRadius: 14 } }}
			>
				<Space orientation="vertical" size={8} style={{ width: "100%" }}>
					<Text type="secondary">
						通过 <Text code>predict("model_name", FEATURES)</Text> 调用；执行后可在记录里查看 <Text code>python_meta.model_trace</Text>。
					</Text>
					{modelGuideRows.length ? (
						<Row gutter={[10, 10]}>
							{visibleModelGuideRows.map((item) => {
								const health = modelHealthMap.get(item.name);
								const summaryLabel =
									item.kind === "rule"
										? "判定阈值"
										: "输入特征";
								const summaryValue =
									item.kind === "rule"
										? summarizeModelThresholds(String(item.rule_type || ""), item.thresholds)
										: summarizeModelFeatureList(item.features);
								const secondaryLabel =
									item.kind === "rule"
										? "动作建议"
										: "模型文件";
								const secondaryValue =
									item.kind === "rule"
										? summarizeModelSuggestions(item.suggestions)
										: summarizeModelPath(item.path);
								const tertiaryLabel =
									item.kind === "rule"
										? "状态"
										: "输出映射";
								const tertiaryValue =
									item.kind === "rule"
										? (health ? `${health.healthy ? "健康" : "异常"} · ${health.status || "-"}` : "待检查")
										: summarizeDecisionMap(item.decision_map);

								return (
									<Col xs={24} lg={12} key={item.name}>
										<div style={{ border: "1px solid #eceff3", borderRadius: 10, padding: 10, background: "#fff" }}>
											<Space wrap size={6} style={{ marginBottom: 8 }}>
												<Tag color="blue">{item.name}</Tag>
												<Tag>{summarizeModelType(item.kind, item.rule_type)}</Tag>
												{health ? (
													<Tag color={health.healthy ? "green" : "red"}>
														{health.healthy ? "健康" : "异常"}
													</Tag>
												) : null}
											</Space>
											<Row gutter={[8, 8]}>
												<Col span={12}>
													<Text type="secondary" style={{ fontSize: 12 }}>
														{summaryLabel}
													</Text>
													<div>
														<Text style={{ fontSize: 13 }} ellipsis={{ tooltip: summaryValue }}>
															{summaryValue}
														</Text>
													</div>
												</Col>
												<Col span={12}>
													<Text type="secondary" style={{ fontSize: 12 }}>
														{secondaryLabel}
													</Text>
													<div>
														<Text style={{ fontSize: 13 }} ellipsis={{ tooltip: secondaryValue }}>
															{secondaryValue}
														</Text>
													</div>
												</Col>
												<Col span={24}>
													<Text type="secondary" style={{ fontSize: 12 }}>
														{tertiaryLabel}
													</Text>
													<div>
														<Text type="secondary" style={{ fontSize: 12 }} ellipsis={{ tooltip: tertiaryValue }}>
															{tertiaryValue}
														</Text>
													</div>
												</Col>
												{health?.detail && !health.healthy ? (
													<Col span={24}>
														<Text type="secondary" style={{ fontSize: 12 }}>
															健康检查：{health.detail}
														</Text>
													</Col>
												) : null}
												{item.name === "cp500_demo_control_v1" ? (
													<Col span={24}>
														<Text type="secondary" style={{ fontSize: 12 }}>
															适合先跑通采样、预测和动作下发链路，再替换成自己的模型。
														</Text>
													</Col>
												) : null}
											</Row>
										</div>
									</Col>
								);
							})}
						</Row>
					) : (
						<Text type="secondary">
							{modelRegistryQ.isLoading ? "示例模型加载中..." : "暂无示例模型数据"}
						</Text>
					)}
					{modelGuideRows.length > 4 && !showAllModels ? (
						<Text type="secondary">当前仅展示前 4 个示例模型。</Text>
					) : null}
				</Space>
			</Card>
			<Form.Item label={codeLabel} name={codeFieldName} rules={[{ required: true, message: `请输入${codeLabel}` }]}>
				<Input.TextArea rows={10} style={{ fontFamily: "Consolas, monospace", fontSize: 12 }} />
			</Form.Item>
		</Card>
	);
}

function StructuredActionCard({
	title = "执行目标与动作",
	targetSelector,
	targetHint,
	mainActionEditor,
	elseActionEditor,
	extraContent,
}: {
	title?: string;
	targetSelector?: ReactNode;
	targetHint?: ReactNode;
	mainActionEditor: ReactNode;
	elseActionEditor?: ReactNode;
	extraContent?: ReactNode;
}) {
	return (
		<Card size="small" title={title} style={panelCardStyle} styles={sectionCardStyles}>
			<Space orientation="vertical" size={16} style={{ width: "100%" }}>
				{targetSelector}
				{targetHint}
				{mainActionEditor}
				{elseActionEditor}
				{extraContent}
			</Space>
		</Card>
	);
}

function StructuredActionEditorSection({
	actionText,
	onChange,
	commandOptions,
	profile,
	deviceOptions,
	defaultTargetDeviceId,
	targetLabel,
	showAdvancedJson,
	onToggleAdvancedJson,
	targetSelector,
	targetHint,
	advancedExtra,
}: {
	actionText: string;
	onChange: (value: string) => void;
	commandOptions: Array<{ value: string; label: string }>;
	profile?: DeviceProfile;
	deviceOptions?: Array<{ value: number; label: string }>;
	defaultTargetDeviceId?: number;
	targetLabel?: string;
	showAdvancedJson: boolean;
	onToggleAdvancedJson: () => void;
	targetSelector?: ReactNode;
	targetHint?: ReactNode;
	advancedExtra?: ReactNode;
}) {
	return (
		<StructuredActionCard
			title="执行目标与动作"
			targetSelector={targetSelector}
			targetHint={targetHint}
			mainActionEditor={
				<CommandEditor
					value={actionText}
					onChange={onChange}
					commandOptions={commandOptions}
					profile={profile}
					deviceOptions={deviceOptions}
					defaultTargetDeviceId={defaultTargetDeviceId}
					targetLabel={targetLabel}
					title="满足条件时动作"
					embedded
				/>
			}
			elseActionEditor={
				<CommandEditor
					value={actionText}
					onChange={onChange}
					commandOptions={commandOptions}
					profile={profile}
					deviceOptions={deviceOptions}
					defaultTargetDeviceId={defaultTargetDeviceId}
					targetLabel={targetLabel}
					fieldKey="else_commands"
					title="未满足时动作（可选）"
					emptyTitle="留空则不执行备用动作。"
					addLabel="新增 else 动作"
					embedded
				/>
			}
			extraContent={
				<Card
					size="small"
					title="高级 JSON 视图"
					style={compactMetricCardStyle}
					styles={{ body: { background: "#fbfcfe", borderRadius: 14 } }}
					extra={
						<Space>
							{advancedExtra}
							<Button size="small" onClick={onToggleAdvancedJson}>
								{showAdvancedJson ? "收起 JSON" : "展开 JSON"}
							</Button>
						</Space>
					}
				>
					{showAdvancedJson ? (
						<Input.TextArea
							value={actionText}
							rows={12}
							style={{ fontFamily: "Consolas, monospace", fontSize: 12 }}
							onChange={(event) => onChange(event.target.value)}
						/>
					) : (
						<Text type="secondary">
							常规编辑优先使用上面的动作编辑器；只有在需要批量微调或复制复杂动作时，再展开 JSON 视图。
						</Text>
					)}
				</Card>
			}
		/>
	);
}

function ScriptModal({
	open,
	script,
	devices,
	loading,
	onClose,
	onSubmit,
	embedded = false,
}: {
	open: boolean;
	script: Script | null;
	devices: Device[];
	loading: boolean;
	onClose: () => void;
	onSubmit: (values: ReturnType<typeof toScriptPayload>) => void;
	embedded?: boolean;
}) {
	const [form] = Form.useForm<ScriptFormValues>();
	const [showAdvancedJson, setShowAdvancedJson] = useState(false);
	const previousTypeRef = useRef<ScriptType | null>(null);
	const previousPythonTemplatesRef = useRef<readonly { key: string; label: string; code: string }[]>([]);
	const submitWithDraftFlush = () => {
		if (typeof document !== "undefined" && document.activeElement instanceof HTMLElement) {
			document.activeElement.blur();
		}
		form.submit();
	};
	const currentType = Form.useWatch(singleRuleFields.type, form) ?? "threshold";
	const conditionMode = Form.useWatch(singleRuleFields.conditionMode, form) ?? "all";
	const commandText = Form.useWatch(singleRuleFields.commandTemplateText!, form) ?? "";
	const targetDeviceId = Form.useWatch(singleRuleFields.targetDeviceId, form);
	const formValues = Form.useWatch([], form) as Partial<ScriptFormValues> | undefined;
	const primaryActions = safeArray<CommandRow>(Form.useWatch(singleRuleFields.primaryActions, form));
	const elseCommands = safeArray<CommandRow>(Form.useWatch(singleRuleFields.elseCommands, form));
	const targetDevice = useMemo(() => devices.find((device) => device.device_id === targetDeviceId), [devices, targetDeviceId]);
	const targetProfile = inferDeviceProfile(targetDevice);
	const commandOptions = getDeviceCommandCatalog(targetProfile);
	const pythonTemplates = useMemo(() => getPythonTemplatesForProfile(targetProfile), [targetProfile]);
	const metricOptions = useMemo(() => getMetricOptionsForDevice(targetDevice), [targetDevice]);
	const metricGuide = useMemo(() => getMetricGuideForDevice(targetDevice), [targetDevice]);
	const scriptActionText = useMemo(
		() => buildRuleActionText({ targetDeviceId, primaryActions, elseCommands }),
		[targetDeviceId, primaryActions, elseCommands],
	);
	const scriptPreview = useMemo(
		() => buildScriptPythonPreview(formValues || {}, targetDevice),
		[formValues, targetDevice],
	);

	useEffect(() => {
		if (!open) return;
		form.resetFields();
		const draft = buildRuleDraftFromScriptRecord(script);
		const draftTargetDevice = draft.targetDeviceId ? devices.find((item) => item.device_id === draft.targetDeviceId) : undefined;
		const defaultMetric = getMetricOptionsForDevice(draftTargetDevice)[0]?.value || "temperature";
		form.setFieldsValue(buildScriptFormValuesFromDraft(draft, defaultMetric, inferDeviceProfile(draftTargetDevice)));
		previousTypeRef.current = draft.type;
	}, [devices, form, open, script]);

	useEffect(() => {
		if (!open) return;
		const previousType = previousTypeRef.current;
		if (previousType === currentType) return;
		if (currentType !== "python" && !String(commandText || "").trim()) {
			form.setFieldValue(singleRuleFields.commandTemplateText! as never, getStructuredExampleText(targetProfile, currentType));
		}
		if ((currentType === "schedule" || currentType === "hybrid") && !trimCronValue(form.getFieldValue(singleRuleFields.cron as never))) {
			form.setFieldValue(singleRuleFields.cron as never, "0 9 * * *");
		}
		if (currentType === "python" && !String(form.getFieldValue(singleRuleFields.pythonCode as never) || "").trim()) {
			form.setFieldValue(singleRuleFields.pythonCode as never, getDefaultPythonExample(targetProfile));
			form.setFieldValue(singleRuleFields.cron as never, undefined);
		}
		previousTypeRef.current = currentType;
	}, [commandText, currentType, form, open, targetProfile]);

	useEffect(() => {
		if (!open || currentType === "python" || !targetDeviceId) return;
		const nextPrimaryActions = normalizeActionRowsForProfile(primaryActions, targetProfile, commandOptions);
		const nextElseActions = normalizeActionRowsForProfile(elseCommands, targetProfile, commandOptions);
		if (JSON.stringify(nextPrimaryActions) !== JSON.stringify(primaryActions)) {
			form.setFieldValue(singleRuleFields.primaryActions as never, nextPrimaryActions);
		}
		if (JSON.stringify(nextElseActions) !== JSON.stringify(elseCommands)) {
			form.setFieldValue(singleRuleFields.elseCommands as never, nextElseActions);
		}
	}, [commandOptions, currentType, elseCommands, form, open, primaryActions, targetDeviceId, targetProfile]);

	useEffect(() => {
		if (!open || currentType === "python") return;
		const currentTemplate = String(form.getFieldValue(singleRuleFields.commandTemplateText! as never) || "").trim();
		if (!currentTemplate) return;
		const genericTemplate = getStructuredExampleText("generic", currentType);
		const profileTemplate = getStructuredExampleText(targetProfile, currentType);
		if (currentTemplate === genericTemplate && currentTemplate !== profileTemplate) {
			form.setFieldValue(singleRuleFields.commandTemplateText! as never, profileTemplate);
		}
	}, [currentType, form, open, targetProfile, targetDeviceId]);

	useEffect(() => {
		if (!open || currentType !== "python") return;
		const currentCode = String(form.getFieldValue(singleRuleFields.pythonCode as never) || "");
		const previousTemplates = previousPythonTemplatesRef.current;
		previousPythonTemplatesRef.current = pythonTemplates;
		if (!currentCode.trim()) return;
		const matchedKey = findTemplateKeyByCode(previousTemplates, currentCode);
		if (matchedKey) {
			const nextTemplate = pythonTemplates.find((item) => item.key === matchedKey);
			if (nextTemplate && nextTemplate.code !== currentCode) {
				form.setFieldValue(singleRuleFields.pythonCode as never, nextTemplate.code);
			}
			return;
		}
		const genericCode = getDefaultPythonExample("generic").trim();
		const profileCode = getDefaultPythonExample(targetProfile).trim();
		if (currentCode.trim() === genericCode && currentCode.trim() !== profileCode) {
			form.setFieldValue(singleRuleFields.pythonCode as never, profileCode);
		}
	}, [currentType, form, open, pythonTemplates, targetProfile, targetDeviceId]);

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
						<Form.Item name={singleRuleFields.commandTemplateText!} hidden>
							<Input />
						</Form.Item>
						<Form.Item name={singleRuleFields.primaryActions} hidden>
							<Input />
						</Form.Item>
						<Form.Item name={singleRuleFields.elseCommands} hidden>
							<Input />
						</Form.Item>
						<RuleBasicCard
							typeFieldName={singleRuleFields.type}
							isActiveFieldName="is_active"
							priorityFieldName="priority"
							namePlaceholder="例如：高温开启排风"
							descriptionPlaceholder="写清楚这条规则的触发条件和预期动作。"
							topMeta={
								<div
									style={{
										padding: "12px 14px",
										background: "#f7f9fc",
										border: "1px solid #edf1f5",
										borderRadius: 12,
									}}
								>
									<Row gutter={[12, 12]} align="middle">
										<Col xs={24} md={16}>
											<Form.Item
												label="所属设备"
												name={singleRuleFields.targetDeviceId}
												rules={[{ required: true, message: "请选择所属设备" }]}
												style={{ marginBottom: 0 }}
											>
												<Select
													placeholder="选择这条单设备规则挂载的设备"
													options={devices.map((device) => ({ value: device.device_id, label: deviceLabel(device) }))}
												/>
											</Form.Item>
										</Col>
										<Col xs={24} md={8}>
											<div
												style={{
													height: "100%",
													display: "flex",
													alignItems: "center",
													justifyContent: "flex-start",
												}}
											>
												<Text type="secondary">
													条件读取和动作执行默认围绕所属设备展开。
												</Text>
											</div>
										</Col>
									</Row>
								</div>
							}
							footerHint={
								targetDevice ? (
									<Paragraph type="secondary" style={{ marginBottom: 0 }}>
										所属设备：<Tag color="blue">{getProfileLabel(targetProfile)}</Tag>
										{currentType === "python"
											? "。脚本默认从这台设备读数；如需跨设备下发，可显式写 target_device_code。"
											: "。条件读取和动作执行默认都围绕这台设备。"}
									</Paragraph>
								) : null
							}
						/>

						{currentType === "threshold" || currentType === "schedule" || currentType === "hybrid" ? (
							<Card size="small" title="触发逻辑" style={{ ...panelCardStyle, marginBottom: 16 }} styles={sectionCardStyles}>
								{currentType === "threshold" || currentType === "hybrid" ? (
									<ConditionsEditor
										form={form as unknown as { getFieldValue: (name: unknown) => unknown }}
										listName={singleRuleFields.conditions}
										conditionModeName={singleRuleFields.conditionMode}
										conditionMode={conditionMode}
										metricOptions={metricOptions}
										getChannelOptions={(metricValue) => getChannelOptionsForMetric(targetDevice, metricValue)}
										defaultMetric={metricOptions[0]?.value || "temperature"}
									/>
								) : null}

								{currentType === "schedule" || currentType === "hybrid" ? (
									<Form.Item
										label="Cron 表达式"
										name={singleRuleFields.cron}
										style={{ marginBottom: currentType === "schedule" ? 0 : undefined }}
										rules={[
											{
												validator: async (_, value?: string) => {
													if (!trimCronValue(value)) throw new Error("请输入 Cron 表达式");
													if (!isCronLike(value)) throw new Error("请输入 5 到 6 段的 Cron 表达式");
												},
											},
										]}
									>
										<Input placeholder="例如：0 9 * * *" />
									</Form.Item>
								) : null}
							</Card>
						) : null}

						{currentType === "python" ? (
							<PythonLogicCard
								codeFieldName={singleRuleFields.pythonCode}
								codeLabel="Python 脚本"
								codeValueName="python_code"
								templates={pythonTemplates}
								auxActions={<PythonDeviceLookup devices={devices} />}
								scriptHint='脚本默认从所属设备读取数据；如需跨设备读取可显式写 device_code，如需跨设备下发可写 target_device_code。'
							/>
						) : null}

						{currentType === "threshold" || currentType === "hybrid" || currentType === "schedule" ? (
							<Card
								size="small"
								title="自动检查间隔"
								style={{ ...panelCardStyle, marginBottom: 24 }}
								styles={{
									...sectionCardStyles,
									body: { ...sectionCardStyles.body, background: "#fafafa" },
								}}
							>
								<Paragraph
									type="secondary"
									style={{
										marginBottom: 18,
										lineHeight: 1.65,
										padding: "10px 12px",
										background: "#fff",
										border: "1px solid #edf1f5",
										borderRadius: 10,
									}}
								>
									让后台<strong>不要比这里填的秒数更频繁</strong>地自动检查这条规则。不填表示不额外限制。
								</Paragraph>
								<Row gutter={[24, 12]}>
									<Col xs={24} sm={18} md={12} lg={10}>
										<Form.Item
											label="最短间隔（秒）"
											name={["threshold_config", "min_check_interval_seconds"]}
										extra="例如数据大约每分钟才更新，可填 60。"
											style={{ marginBottom: 0 }}
											rules={[minCheckIntervalFormRule]}
										>
											<InputNumber
												min={0}
												max={604800}
												step={1}
												style={{ width: "100%", maxWidth: 320 }}
												placeholder="留空不限制"
											/>
										</Form.Item>
									</Col>
								</Row>
							</Card>
						) : null}

						{currentType !== "python" ? (
							<StructuredActionEditorSection
								actionText={commandText}
								onChange={(next) =>
									applyStructuredActionEditorChange(
										next,
										targetDeviceId,
										(name, value) => form.setFieldValue(name as never, value),
										singleRuleFields.commandTemplateText!,
									)
								}
								commandOptions={commandOptions}
								profile={targetProfile}
								showAdvancedJson={showAdvancedJson}
								onToggleAdvancedJson={() => setShowAdvancedJson((value) => !value)}
							/>
						) : null}
					</Form>
				</Col>

				<Col xs={24} xl={9}>
					<RulePreviewCard
						scopeSummary={
							currentType === "python"
								? "当前范围：本设备脚本。读取指标默认围绕所属设备；如需跨设备下发，可在代码里显式写 target_device_code。"
								: "当前范围：本设备规则。条件读取和动作执行默认都围绕所属设备。"
						}
						type={currentType}
						pythonHint="Python 模式适合更复杂的判断。可以读取多设备、多通道，也可以把定时判断直接写进脚本。"
						structuredHint="结构化规则支持备用动作；条件不满足时可以切到 else 动作，定时与混合模式也会直接体现在预览里。"
						bullets={
							currentType === "python"
								? [
										"先选所属设备；不显式写 device_code 时，脚本默认就从这台设备读取数据。",
										"需要下发到别的设备时，直接在代码里写 target_device_code。",
										"建议先从单条 commands 或 actions 开始，再逐步增加条件和分支。",
										"保存后先手动执行一次，再看执行记录。",
										"读取指标时优先用语义 metric；如果一个指标下有多个通道，再补 channel_code。",
										"多设备读取和定时判断都应直接写在脚本本体里。",
								  ]
								: [
										"先选所属设备，再补触发条件和动作。",
										"建议先从单条动作开始，再逐步增加复杂度。",
										"保存后先手动执行一次，再看执行记录。",
										"动作列表会跟着设备类型自动变化；CP500 的 heater / pump / aeration 额外支持 auto。",
										"“监控指标”对应设备语义指标，不是原始通道名。",
										"如果一个指标下有多个通道，建议再明确选择“监控通道”。",
								  ]
						}
						preview={scriptPreview}
						metricGuideTitle="所属设备可用指标"
						metricGuide={metricGuide}
						emptyMetricText={targetDevice ? "所属设备还没有通道信息，暂时使用通用指标。" : "先选择所属设备，再查看这台设备的常用指标。"}
						unselectedMetricText="先选择所属设备，再查看这台设备的常用指标。"
					/>
				</Col>
			</Row>
	);

	if (!open) return null;

	if (embedded) {
		return (
			<>
				{content}
				<div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
					<Space>
						<Button onClick={onClose}>取消</Button>
						<Button type="primary" loading={loading} onClick={submitWithDraftFlush}>
							{script ? "保存规则" : "创建规则"}
						</Button>
					</Space>
				</div>
			</>
		);
	}

	return (
		<Card
			style={{ marginBottom: 16 }}
			title={script ? "编辑单设备规则" : "新建单设备规则"}
			extra={
				<Space>
					<Button onClick={onClose}>取消</Button>
					<Button type="primary" loading={loading} onClick={submitWithDraftFlush}>
						{script ? "保存规则" : "创建规则"}
					</Button>
				</Space>
			}
		>
			{content}
		</Card>
	);
}

function LinkageModal({
	open,
	script,
	devices,
	loading,
	onClose,
	onSubmit,
	embedded = false,
}: {
	open: boolean;
	script: Script | null;
	devices: Device[];
	loading: boolean;
	onClose: () => void;
	onSubmit: (values: ReturnType<typeof toLinkagePayload>) => void;
	embedded?: boolean;
}) {
	const [form] = Form.useForm<LinkageFormValues>();
	const [showAdvancedJson, setShowAdvancedJson] = useState(false);
	const previousTypeRef = useRef<ScriptType | null>(null);
	const previousLinkageTemplatesRef = useRef<readonly { key: string; label: string; code: string }[]>([]);
	const submitWithDraftFlush = () => {
		if (typeof document !== "undefined" && document.activeElement instanceof HTMLElement) {
			document.activeElement.blur();
		}
		form.submit();
	};
	const linkageType = Form.useWatch(linkageRuleFields.type, form) ?? "threshold";
	const linkageConditionMode = Form.useWatch(linkageRuleFields.conditionMode, form) ?? "all";
	const targetDeviceIds = safeArray<number>(Form.useWatch("targetDeviceIds", form));
	const targetDeviceId = Form.useWatch(linkageRuleFields.targetDeviceId, form) ?? targetDeviceIds[0];
	const formValues = Form.useWatch([], form) as Partial<LinkageFormValues> | undefined;
	const targetDevice = useMemo(() => devices.find((device) => device.device_id === targetDeviceId), [devices, targetDeviceId]);
	const selectedTargetDevices = useMemo(
		() => devices.filter((device) => targetDeviceIds.includes(device.device_id)),
		[devices, targetDeviceIds],
	);
	const selectedTargetProfiles = useMemo(
		() => Array.from(new Set(selectedTargetDevices.map((item) => inferDeviceProfile(item)))),
		[selectedTargetDevices],
	);
	const targetProfile =
		selectedTargetProfiles.length === 1 ? selectedTargetProfiles[0] : inferDeviceProfile(targetDevice);
	const commandOptions = useMemo(() => {
		const map = new Map<string, { value: string; label: string }>();
		(selectedTargetDevices.length ? selectedTargetDevices : targetDevice ? [targetDevice] : []).forEach((device) => {
			getDeviceCommandCatalog(inferDeviceProfile(device)).forEach((item) => {
				if (!map.has(item.value)) map.set(item.value, item);
			});
		});
		if (!map.size) {
			getDeviceCommandCatalog(targetProfile).forEach((item) => map.set(item.value, item));
		}
		return Array.from(map.values());
	}, [selectedTargetDevices, targetDevice, targetProfile]);
	const sourceDeviceIds = safeArray<number>(Form.useWatch("sourceDeviceIds", form));
	const sourceDeviceId = Form.useWatch(linkageRuleFields.sourceDeviceId!, form) ?? sourceDeviceIds[0];
	const sourceDevice = useMemo(() => devices.find((device) => device.device_id === sourceDeviceId), [devices, sourceDeviceId]);
	const selectedSourceDevices = useMemo(
		() => devices.filter((device) => sourceDeviceIds.includes(device.device_id)),
		[devices, sourceDeviceIds],
	);
	const sourceMetricOptions = useMemo(() => {
		const map = new Map<string, { value: string; label: string }>();
		(selectedSourceDevices.length ? selectedSourceDevices : sourceDevice ? [sourceDevice] : []).forEach((device) => {
			getMetricOptionsForDevice(device).forEach((item) => {
				if (!map.has(item.value)) map.set(item.value, item);
			});
		});
		if (!map.size) {
			getMetricOptionsForDevice(sourceDevice).forEach((item) => map.set(item.value, item));
		}
		return Array.from(map.values());
	}, [selectedSourceDevices, sourceDevice]);
	const sourceMetricGuide = useMemo(() => getMetricGuideForDevice(sourceDevice), [sourceDevice]);
	const linkageTemplates = useMemo(
		() => getLinkagePythonTemplates(sourceDevice, targetDevice),
		[sourceDevice, targetDevice],
	);
	const primaryActions = safeArray<CommandRow>(Form.useWatch(linkageRuleFields.primaryActions, form));
	const elseCommands = safeArray<CommandRow>(Form.useWatch(linkageRuleFields.elseCommands, form));
	const linkageActionText = useMemo(
		() => buildRuleActionText({ targetDeviceId, primaryActions, elseCommands }),
		[targetDeviceId, primaryActions, elseCommands],
	);
	const syncLinkageActionEditor = (next: string) =>
		applyStructuredActionEditorChange(next, targetDeviceId, (name, value) => form.setFieldValue(name as never, value));
	const deviceOptions = useMemo(() => devices.map((device) => ({ value: device.device_id, label: deviceLabel(device) })), [devices]);
	const linkagePreview = useMemo(
		() => buildLinkagePythonPreview(formValues || {}, sourceDevice, targetDevice, devices),
		[devices, formValues, sourceDevice, targetDevice],
	);

	useEffect(() => {
		if (!open) return;
		form.resetFields();
		const draft = buildRuleDraftFromScriptRecord(script);
		const draftSourceDevice = draft.sourceDeviceId ? devices.find((item) => item.device_id === draft.sourceDeviceId) : undefined;
		const draftTargetDevice = draft.targetDeviceId ? devices.find((item) => item.device_id === draft.targetDeviceId) : undefined;
		const defaultMetric = getMetricOptionsForDevice(draftSourceDevice)[0]?.value || "temperature";
		form.setFieldsValue(buildLinkageFormValuesFromDraft(draft, defaultMetric, inferDeviceProfile(draftTargetDevice)));
		previousTypeRef.current = draft.type;
	}, [devices, form, open, script]);

	useEffect(() => {
		if (!open) return;
		const previousType = previousTypeRef.current;
		if (previousType === linkageType) return;
		if ((linkageType === "schedule" || linkageType === "hybrid") && !trimCronValue(form.getFieldValue(linkageRuleFields.cron as never))) {
			form.setFieldValue(linkageRuleFields.cron as never, "0 9 * * *");
		}
		if (linkageType === "python" && !String(form.getFieldValue(linkageRuleFields.pythonCode as never) || "").trim()) {
			form.setFieldValue(
				linkageRuleFields.pythonCode as never,
				getDefaultLinkagePythonExample(targetProfile, sourceDevice, targetDevice),
			);
			form.setFieldValue(linkageRuleFields.cron as never, undefined);
		}
		previousTypeRef.current = linkageType;
	}, [form, linkageType, open, sourceDevice, targetDevice, targetProfile]);

	useEffect(() => {
		if (!open || linkageType !== "python") return;
		const currentCode = String(form.getFieldValue(linkageRuleFields.pythonCode as never) || "");
		const previousTemplates = previousLinkageTemplatesRef.current;
		previousLinkageTemplatesRef.current = linkageTemplates;
		if (!currentCode.trim()) return;
		const matchedKey = findTemplateKeyByCode(previousTemplates, currentCode);
		if (!matchedKey) return;
		const nextTemplate = linkageTemplates.find((item) => item.key === matchedKey);
		if (!nextTemplate || nextTemplate.code === currentCode) return;
		form.setFieldValue(linkageRuleFields.pythonCode as never, nextTemplate.code);
	}, [form, linkageTemplates, linkageType, open]);

	useEffect(() => {
		if (!open) return;
		if (targetDeviceIds.length && targetDeviceId !== targetDeviceIds[0]) {
			form.setFieldValue(linkageRuleFields.targetDeviceId as never, targetDeviceIds[0]);
		}
		if (!targetDeviceIds.length && targetDeviceId !== undefined) {
			form.setFieldValue(linkageRuleFields.targetDeviceId as never, undefined);
		}
	}, [form, open, targetDeviceId, targetDeviceIds]);

	useEffect(() => {
		if (!open) return;
		if (sourceDeviceIds.length && sourceDeviceId !== sourceDeviceIds[0]) {
			form.setFieldValue(linkageRuleFields.sourceDeviceId as never, sourceDeviceIds[0]);
		}
		if (!sourceDeviceIds.length && sourceDeviceId !== undefined) {
			form.setFieldValue(linkageRuleFields.sourceDeviceId as never, undefined);
		}
	}, [form, open, sourceDeviceId, sourceDeviceIds]);

	useEffect(() => {
		if (!open) return;
		if (linkageType !== "threshold" && linkageType !== "hybrid") return;
		const currentConditions = safeArray<RuleConditionFormValue>(form.getFieldValue(linkageRuleFields.conditions as never));
		if (!sourceDeviceIds.length) return;
		if (!currentConditions.length) {
			form.setFieldValue(
				linkageRuleFields.conditions as never,
				sourceDeviceIds.map((deviceId, index) => ({
					sourceDeviceId: deviceId,
					metric: index === 0 ? sourceMetricOptions[0]?.value || "temperature" : "temperature",
					operator: ">=",
					value: 0,
				})),
			);
			return;
		}
		const normalizedConditions = currentConditions.map((item, index) => ({
			...item,
			sourceDeviceId:
				typeof item?.sourceDeviceId === "number"
					? item.sourceDeviceId
					: sourceDeviceIds[index] ?? sourceDeviceIds[0],
		}));
		if (JSON.stringify(normalizedConditions) !== JSON.stringify(currentConditions)) {
			form.setFieldValue(linkageRuleFields.conditions as never, normalizedConditions);
		}
	}, [form, linkageType, open, sourceDeviceIds, sourceMetricOptions]);

	useEffect(() => {
		if (!open) return;
		if (!targetDeviceIds.length) return;
		const normalizeTargets = (rows: CommandRow[]) =>
			rows.map((item, index) => ({
				...item,
				targetDeviceId:
					typeof item?.targetDeviceId === "number"
						? item.targetDeviceId
						: targetDeviceIds[index] ?? targetDeviceIds[0],
			}));
		const nextPrimaryActions = normalizeTargets(primaryActions);
		const nextElseActions = normalizeTargets(elseCommands);
		if (JSON.stringify(nextPrimaryActions) !== JSON.stringify(primaryActions)) {
			form.setFieldValue(linkageRuleFields.primaryActions as never, nextPrimaryActions);
		}
		if (JSON.stringify(nextElseActions) !== JSON.stringify(elseCommands)) {
			form.setFieldValue(linkageRuleFields.elseCommands as never, nextElseActions);
		}
	}, [elseCommands, form, open, primaryActions, targetDeviceIds]);

	useEffect(() => {
		if (!open || !targetDeviceId) return;
		const nextPrimaryActions = normalizeActionRowsForProfile(primaryActions, targetProfile, commandOptions);
		const nextElseActions = normalizeActionRowsForProfile(elseCommands, targetProfile, commandOptions);
		if (JSON.stringify(nextPrimaryActions) !== JSON.stringify(primaryActions)) {
			form.setFieldValue(linkageRuleFields.primaryActions as never, nextPrimaryActions);
		}
		if (JSON.stringify(nextElseActions) !== JSON.stringify(elseCommands)) {
			form.setFieldValue(linkageRuleFields.elseCommands as never, nextElseActions);
		}
	}, [commandOptions, elseCommands, form, open, primaryActions, targetDeviceId, targetProfile]);

	const content = (
		<Row gutter={[20, 20]}>
				<Col xs={24} xl={15}>
					<Form form={form} layout="vertical" onFinish={(values) => { try { onSubmit(toLinkagePayload(values)); } catch (error) { message.error(error instanceof Error ? error.message : "保存失败"); } }}>
						<Form.Item name={linkageRuleFields.primaryActions} hidden>
							<Input />
						</Form.Item>
						<Form.Item name={linkageRuleFields.elseCommands} hidden>
							<Input />
						</Form.Item>
						<RuleBasicCard
							typeFieldName={linkageRuleFields.type}
							isActiveFieldName="is_active"
							priorityFieldName="priority"
							namePlaceholder="例如：堆体高温时开启排气"
							descriptionPlaceholder="写清楚触发设备、目标设备和预期动作。"
							topMeta={
								<div
									style={{
										padding: "12px 14px",
										background: "#f7f9fc",
										border: "1px solid #edf1f5",
										borderRadius: 12,
									}}
								>
									<Row gutter={[12, 12]} align="middle">
										<Col xs={24} md={12}>
											<Form.Item
												label="触发设备"
												name="sourceDeviceIds"
												rules={linkageType === "threshold" || linkageType === "hybrid" ? [{ required: true, message: "请选择至少一台触发设备" }] : undefined}
												style={{ marginBottom: 0 }}
											>
												<Select
													mode="multiple"
													allowClear
													showSearch
													maxTagCount="responsive"
													optionFilterProp="label"
													style={{ width: "100%" }}
													options={deviceOptions}
													placeholder="选择提供条件的设备，可多选"
												/>
											</Form.Item>
										</Col>
										<Col xs={24} md={12}>
											<Form.Item
												label="执行设备"
												name="targetDeviceIds"
												rules={[{ required: true, message: "请选择至少一台执行设备" }]}
												style={{ marginBottom: 0 }}
											>
												<Select
													mode="multiple"
													showSearch
													maxTagCount="responsive"
													optionFilterProp="label"
													style={{ width: "100%" }}
													options={deviceOptions}
													placeholder="选择真正执行动作的设备，可多选"
												/>
											</Form.Item>
										</Col>
									</Row>
								</div>
							}
						/>

						{linkageType === "python" ? (
							<PythonLogicCard
								codeFieldName={linkageRuleFields.pythonCode}
								codeLabel="Python 脚本"
								codeValueName="pythonCode"
								templates={linkageTemplates}
								auxActions={<PythonDeviceLookup devices={devices} />}
								scriptHint='跨设备脚本建议显式写 device_code；如果同一指标下有多个测点，再补 channel_code，例如 get_latest_value("temperature", "TempIn", device_code="CP500-01")。'
							/>
						) : (
							<Card size="small" title="触发逻辑" style={{ ...panelCardStyle, marginBottom: 16 }} styles={sectionCardStyles}>
								<Row gutter={[12, 8]}>
									{linkageType === "threshold" || linkageType === "hybrid" ? (
										<Col xs={24} lg={10}>
											<Form.Item label="条件关系" name={linkageRuleFields.conditionMode} initialValue="all" style={{ marginBottom: 0 }}>
												<Select options={conditionModeOptions as never} />
											</Form.Item>
										</Col>
									) : null}
									{targetDeviceIds.length ? (
										<Col xs={24} lg={14}>
											<div
												style={{
													height: "100%",
													display: "flex",
													alignItems: "center",
													padding: "6px 10px",
													background: "#f7f9fc",
													border: "1px solid #edf1f5",
													borderRadius: 10,
												}}
											>
												<Text type="secondary">
													已选 {sourceDeviceIds.length || 0} 台触发设备，{targetDeviceIds.length} 台执行设备。
												</Text>
											</div>
										</Col>
									) : null}
								</Row>

								{linkageType === "threshold" || linkageType === "hybrid" ? (
									<div style={{ marginTop: 12 }}>
										<ConditionsEditor
											form={form as unknown as { getFieldValue: (name: unknown) => unknown }}
											listName={linkageRuleFields.conditions}
											conditionModeName={linkageRuleFields.conditionMode}
											conditionMode={linkageConditionMode}
											metricOptions={sourceMetricOptions}
											getChannelOptions={(metricValue, rowSourceDeviceId) =>
												getChannelOptionsForMetric(
													typeof rowSourceDeviceId === "number"
														? devices.find((item) => item.device_id === rowSourceDeviceId)
														: sourceDevice,
													metricValue,
												)
											}
											defaultMetric={sourceMetricOptions[0]?.value || "temperature"}
											deviceOptions={deviceOptions.filter((item) => sourceDeviceIds.includes(item.value))}
											sourceLabel="来源设备"
										/>
									</div>
								) : null}

								{linkageType === "schedule" || linkageType === "hybrid" ? (
									<Form.Item
										label="Cron 表达式"
										name={linkageRuleFields.cron}
										rules={[
											{
												validator: async (_, value?: string) => {
													if (!trimCronValue(value)) throw new Error("请输入 Cron 表达式");
													if (!isCronLike(value)) throw new Error("请输入 5 到 6 段的 Cron 表达式");
												},
											},
										]}
										style={{ marginTop: 12, marginBottom: 0 }}
									> 
										<Input placeholder="例如：0 9 * * *" />
									</Form.Item>
								) : null}
							</Card>
						)}

						{linkageType === "threshold" || linkageType === "hybrid" || linkageType === "schedule" ? (
							<Card
								size="small"
								title="自动检查间隔"
								style={{ ...panelCardStyle, marginBottom: 24 }}
								styles={{
									...sectionCardStyles,
									body: { ...sectionCardStyles.body, background: "#fafafa" },
								}}
							>
								<Paragraph
									type="secondary"
									style={{
										marginBottom: 18,
										lineHeight: 1.65,
										padding: "10px 12px",
										background: "#fff",
										border: "1px solid #edf1f5",
										borderRadius: 10,
									}}
								>
									限制后台自动检查的最短间隔。不填表示不额外限制。
								</Paragraph>
								<Row gutter={[24, 12]}>
									<Col xs={24} sm={18} md={12} lg={10}>
										<Form.Item
											label="最短间隔（秒）"
											name="min_check_interval_seconds"
											extra="例如数据大约每分钟才更新，可填 60。"
											style={{ marginBottom: 0 }}
											rules={[minCheckIntervalFormRule]}
										>
											<InputNumber
												min={0}
												max={604800}
												step={1}
												style={{ width: "100%", maxWidth: 320 }}
												placeholder="留空不限制"
											/>
										</Form.Item>
									</Col>
								</Row>
							</Card>
						) : null}

						{linkageType !== "python" ? (
							<StructuredActionEditorSection
								actionText={linkageActionText}
								onChange={syncLinkageActionEditor}
								commandOptions={commandOptions}
								profile={targetProfile}
								deviceOptions={deviceOptions.filter((item) => targetDeviceIds.includes(item.value))}
								defaultTargetDeviceId={targetDeviceId}
								targetLabel="执行设备"
								showAdvancedJson={showAdvancedJson}
								onToggleAdvancedJson={() => setShowAdvancedJson((value) => !value)}
								targetSelector={null}
								targetHint={
									targetDeviceIds.length ? (
										<Paragraph type="secondary" style={{ marginBottom: 0 }}>
											默认执行设备：<Tag color="blue">{getProfileLabel(targetProfile)}</Tag>。每条动作都可以单独指定执行设备。
										</Paragraph>
									) : null
								}
							/>
						) : null}
					</Form>
				</Col>

				<Col xs={24} xl={9}>
					<RulePreviewCard
						scopeSummary="当前范围：跨设备规则。条件由触发设备提供，动作发送给目标设备。"
						type={linkageType}
						pythonHint="Python 联动可以同时读取多台设备，也可以通过 actions 把动作分发到多台目标设备；定时判断直接写进脚本即可。"
						structuredHint="联动规则同样支持备用动作；条件不满足时可切到 else 动作，定时模式也会直接体现在预览里。"
						bullets={[
							"先选触发设备，再选目标设备。",
							"动作命令会跟着目标设备类型自动收窄。",
							"保存后先手动执行一次，再看执行记录。",
							"如果目标设备是 CP500，heater / pump / aeration 还会提供 auto。",
							"联动里的“监控指标”对应触发设备的语义指标，不是通道 code。",
							"如果同一指标下有多个通道，建议明确选择“监控通道”。",
						]}
						preview={linkagePreview}
						metricGuideTitle="触发设备可用指标"
						metricGuide={sourceMetricGuide}
						emptyMetricText={sourceDevice ? "当前触发设备还没有通道信息，暂时使用通用指标。" : "先选择触发设备，再查看可用指标。"}
						unselectedMetricText="先选择触发设备，再查看可用指标。"
					/>
				</Col>
			</Row>
	);

	if (!open) return null;

	if (embedded) {
		return (
			<>
				{content}
				<div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
					<Space>
						<Button onClick={onClose}>取消</Button>
						<Button type="primary" loading={loading} onClick={submitWithDraftFlush}>
							{script ? "保存规则" : "创建规则"}
						</Button>
					</Space>
				</div>
			</>
		);
	}

	return (
		<Card
			style={{ marginBottom: 16 }}
			title={script ? "编辑设备联动规则" : "新建设备联动规则"}
			extra={
				<Space>
					<Button onClick={onClose}>取消</Button>
					<Button type="primary" loading={loading} onClick={submitWithDraftFlush}>
						{script ? "保存规则" : "创建规则"}
					</Button>
				</Space>
			}
		>
			{content}
		</Card>
	);
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

export default function ScriptsPage() {
	const queryClient = useQueryClient();
	const [scriptModalOpen, setScriptModalOpen] = useState(false);
	const [linkageModalOpen, setLinkageModalOpen] = useState(false);
	const [editorScope, setEditorScope] = useState<RuleScope>("single");
	const [importModalOpen, setImportModalOpen] = useState(false);
	const [importText, setImportText] = useState("");
	const [editingScript, setEditingScript] = useState<Script | null>(null);
	const [editingLinkage, setEditingLinkage] = useState<Script | null>(null);
	const [historyScript, setHistoryScript] = useState<Script | null>(null);
	const [executionFilter, setExecutionFilter] = useState<ExecutionFilter>("all");
	const [ruleStatusFilter, setRuleStatusFilter] = useState<RuleStatusFilter>("all");
	const [ruleDeviceFilter, setRuleDeviceFilter] = useState<number | undefined>(undefined);
	const editorOpen = scriptModalOpen || linkageModalOpen;

	const closeRuleEditor = () => {
		setScriptModalOpen(false);
		setLinkageModalOpen(false);
		setEditingScript(null);
		setEditingLinkage(null);
	};

	const openRuleEditor = (script: Script | null = null, scope?: RuleScope) => {
		const nextScope = scope || (script ? (isLinkageScript(script) ? "linkage" : "single") : editorScope);
		setEditorScope(nextScope);
		if (nextScope === "single") {
			setEditingScript(script);
			setEditingLinkage(null);
			setScriptModalOpen(true);
			setLinkageModalOpen(false);
			return;
		}
		setEditingLinkage(script);
		setEditingScript(null);
		setLinkageModalOpen(true);
		setScriptModalOpen(false);
	};

	const openSingleRuleEditor = (script: Script | null = null) => {
		openRuleEditor(script, "single");
	};

	const openLinkageRuleEditor = (script: Script | null = null) => {
		openRuleEditor(script, "linkage");
	};

	const switchRuleEditorScope = (scope: RuleScope) => {
		openRuleEditor(null, scope);
	};

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
			message.success("规则创建成功");
			closeRuleEditor();
			queryClient.invalidateQueries({ queryKey: ["scripts"] });
		},
		onError: (error: unknown) => message.error(getErrorMessage(error, "规则创建失败")),
	});

	const updateScript = useMutation({
		mutationFn: async (data: ReturnType<typeof toScriptPayload>) => api.patch(`/scripts/${editingScript?.id}`, data),
		onSuccess: () => {
			message.success("规则更新成功");
			closeRuleEditor();
			queryClient.invalidateQueries({ queryKey: ["scripts"] });
		},
		onError: (error: unknown) => message.error(getErrorMessage(error, "规则更新失败")),
	});

	const createLinkage = useMutation({
		mutationFn: async (data: ReturnType<typeof toLinkagePayload>) => api.post("/scripts", data),
		onSuccess: () => {
			message.success("规则创建成功");
			closeRuleEditor();
			queryClient.invalidateQueries({ queryKey: ["scripts"] });
		},
		onError: (error: unknown) => message.error(getErrorMessage(error, "规则创建失败")),
	});

	const updateLinkage = useMutation({
		mutationFn: async (data: ReturnType<typeof toLinkagePayload>) => api.patch(`/scripts/${editingLinkage?.id}`, data),
		onSuccess: () => {
			message.success("规则更新成功");
			closeRuleEditor();
			queryClient.invalidateQueries({ queryKey: ["scripts"] });
		},
		onError: (error: unknown) => message.error(getErrorMessage(error, "规则更新失败")),
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
	const filteredRules = useMemo(
		() =>
			allScripts.filter((script) => {
				if (ruleStatusFilter === "active" && !script.is_active) return false;
				if (ruleStatusFilter === "inactive" && script.is_active) return false;
				if (ruleDeviceFilter && !(script.device_ids || []).includes(ruleDeviceFilter)) {
					const commandTemplate = (script.command_template || {}) as Record<string, unknown>;
					const thresholdConfig = (script.threshold_config || {}) as Record<string, unknown>;
					const scheduleConfig = (script.schedule_config || {}) as Record<string, unknown>;
					if (
						commandTemplate.target_device_id !== ruleDeviceFilter &&
						thresholdConfig.source_device_id !== ruleDeviceFilter &&
						scheduleConfig.source_device_id !== ruleDeviceFilter
					) {
						return false;
					}
				}
				return true;
			}),
		[allScripts, ruleDeviceFilter, ruleStatusFilter],
	);

	const statCards = [
		{ title: "全部规则", value: allScripts.length, color: "#1677ff" },
		{ title: "设备内", value: singleScripts.length, color: "#52c41a" },
		{ title: "设备协同", value: linkageScripts.length, color: "#fa8c16" },
		{ title: "启用中", value: allScripts.filter((item) => item.is_active).length, color: "#52c41a" },
	];

	const ruleColumns: ColumnsType<Script> = [
		{ title: "规则名称", dataIndex: "name", width: 180 },
		{ title: "范围", width: 90, render: (_, row) => <Tag color={isLinkageScript(row) ? "orange" : "blue"}>{ruleScopeLabel(row)}</Tag> },
		{ title: "类型", width: 120, render: (_, row) => <Tag color={typeColor[row.script_type]}>{row.script_type_display || row.script_type}</Tag> },
		{
			title: "设备上下文",
			width: 220,
			render: (_, row) => {
				if (!isLinkageScript(row)) {
					const device = devicesList.find((item) => item.device_id === row.device_ids?.[0]);
					return device ? <>{deviceLabel(device)}<Tag style={{ marginLeft: 8 }}>{getProfileLabel(inferDeviceProfile(device))}</Tag></> : "-";
				}
				const thresholdConfig = (row.threshold_config || {}) as Record<string, unknown>;
				const scheduleConfig = (row.schedule_config || {}) as Record<string, unknown>;
				const sourceDeviceId =
					typeof thresholdConfig.source_device_id === "number"
						? thresholdConfig.source_device_id
						: typeof scheduleConfig.source_device_id === "number"
						? scheduleConfig.source_device_id
						: row.device_ids?.[0];
				const source = devicesList.find((item) => item.device_id === sourceDeviceId);
				return source ? <>{deviceLabel(source)}<Tag style={{ marginLeft: 8 }}>{getProfileLabel(inferDeviceProfile(source))}</Tag></> : "-";
			},
		},
		{
			title: "动作目标",
			width: 210,
			render: (_, row) => {
				if (!isLinkageScript(row)) {
					return <Text type="secondary">默认同所属设备</Text>;
				}
				const commandTemplate = (row.command_template || {}) as Record<string, unknown>;
				const targetDeviceId =
					typeof commandTemplate.target_device_id === "number" ? commandTemplate.target_device_id : row.device_ids?.[0];
				const target = devicesList.find((item) => item.device_id === targetDeviceId);
				return target ? <>{deviceLabel(target)}<Tag style={{ marginLeft: 8 }}>{getProfileLabel(inferDeviceProfile(target))}</Tag></> : "-";
			},
		},
		{ title: "状态", width: 100, render: (_, row) => <Tag color={row.is_active ? "green" : "default"}>{row.is_active ? "启用" : "停用"}</Tag> },
		{ title: "优先级", dataIndex: "priority", width: 90 },
		{ title: "条件摘要", render: (_, row) => (isLinkageScript(row) ? summarizeLinkageCondition(row, devicesList) : summarizeSingleCondition(row)) },
		{ title: "动作摘要", render: (_, row) => summarizeCommands(row.command_template) },
		{
			title: "操作",
			width: 340,
			render: (_, row) => (
				<Space size="small" wrap>
					<Button size="small" type="primary" disabled={!row.is_active} loading={executeScript.isPending && executeScript.variables === row.id} onClick={() => executeScript.mutate(row.id || 0)}>执行</Button>
					<Button size="small" onClick={() => setHistoryScript(row)}>记录</Button>
					<Button
						size="small"
						onClick={() => openRuleEditor(row)}
					>
						编辑
					</Button>
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
						type="primary"
						onClick={() => openRuleEditor(null)}
					>
						新建规则
					</Button>
				</Space>
			}
		>
			<Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
				{statCards.map((item) => (
					<Col key={item.title} xs={12} xl={6}>
						<Card
							size="small"
							style={panelCardStyle}
							styles={{ body: { ...softCardBodyStyle, padding: 18 } }}
						>
							<Text type="secondary">{item.title}</Text>
							<Title level={3} style={{ margin: "8px 0 0", color: item.color }}>{item.value}</Title>
						</Card>
					</Col>
				))}
			</Row>

			<Card style={{ ...panelCardStyle, marginBottom: 16 }} styles={{ body: { ...softCardBodyStyle, padding: 20 } }}>
				<Row gutter={[16, 16]}>
					<Col xs={24} xl={13}>
						<Title level={5} style={{ marginTop: 0 }}>使用方式</Title>
						<ul style={{ paddingLeft: 18, marginBottom: 0 }}>
							<li>统一规则编辑器里，设备内控制和多设备协同使用同一套编辑流程。</li>
							<li>当条件来源和动作执行落在同一台设备上，它自然就是设备内规则；跨到多台设备时，就是协同规则。</li>
							<li>结构化规则适合阈值、定时和备用动作；脚本模式适合复杂判断、自定义时间和模型控制。</li>
							<li>规则的创建、复制、导入、导出、执行和结果排查都在这里完成。</li>
						</ul>
					</Col>
					<Col xs={24} xl={11}>
						<Alert type="info" showIcon title="建议从简单规则开始" description="先用一条条件加一条动作跑通整条链路，再逐步加多条件、多动作和跨设备协同。" />
					</Col>
				</Row>
			</Card>

			<Card size="small" style={{ ...panelCardStyle, marginBottom: 16 }} styles={{ body: { ...softCardBodyStyle, padding: 18 } }}>
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
						<Text type="secondary">按设备筛选</Text>
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
						<Text type="secondary">筛选结果</Text>
						<Paragraph style={{ margin: "6px 0 0" }}>
							{filteredRules.length} 条规则
						</Paragraph>
					</Col>
				</Row>
			</Card>

			<Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
				<Col xs={24} xl={15}>
					<Card
						title="最近执行"
						size="small"
						style={panelCardStyle}
						styles={{ body: { ...softCardBodyStyle, padding: 18 } }}
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
									<Row
										key={item.execution_id}
										gutter={[12, 8]}
										style={{
											padding: "12px 14px",
											border: "1px solid #eef2f6",
											borderRadius: 12,
											background: "#fff",
										}}
									>
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
					<Card title="自动控制状态" size="small" style={panelCardStyle} styles={{ body: { ...softCardBodyStyle, padding: 18 } }}>
						<Row gutter={[12, 12]}>
							<Col span={12}>
								<Card size="small" style={compactMetricCardStyle}>
									<Text type="secondary">阈值规则</Text>
									<Paragraph style={{ margin: "8px 0 0" }}>支持手动检查，也支持后台自动检查。</Paragraph>
								</Card>
							</Col>
							<Col span={12}>
								<Card size="small" style={compactMetricCardStyle}>
									<Text type="secondary">定时规则</Text>
									<Paragraph style={{ margin: "8px 0 0" }}>结构化定时规则支持后台周期执行。</Paragraph>
								</Card>
							</Col>
							<Col span={24}>
								<Alert
									type="info"
									showIcon
									title="运行提示"
									description="如果这里长期没有新记录，优先检查 auto_control_worker 是否已启动；脚本模式里的时间逻辑由脚本本体自行控制。"
								/>
							</Col>
						</Row>
					</Card>
				</Col>
			</Row>

			{editorOpen ? (
				<Card
					style={{ ...panelCardStyle, marginBottom: 16 }}
					size="small"
					styles={{
						header: {
							padding: "20px 24px 16px",
							minHeight: "auto",
							alignItems: "center",
							borderBottom: "1px solid #edf1f5",
							background: "linear-gradient(180deg, #ffffff 0%, #fbfcff 100%)",
							borderTopLeftRadius: 16,
							borderTopRightRadius: 16,
						},
						body: { ...softCardBodyStyle, padding: "20px 24px 24px" },
					}}
					title={
						<div style={{ display: "flex", flexDirection: "column", gap: 3, paddingTop: 2 }}>
							<Text strong style={{ fontSize: 16, lineHeight: 1.35, color: "#1f2937" }}>
								{editorScope === "single"
									? editingScript
										? "规则编辑"
										: "规则配置"
									: editingLinkage
									? "规则编辑"
									: "规则配置"}
							</Text>
							<Text type="secondary" style={{ fontSize: 12, lineHeight: 1.5 }}>
								配置触发条件、执行动作和脚本逻辑。
							</Text>
						</div>
					}
					extra={
						<Space wrap size={12} align="center">
							<Segmented
								value={editorScope}
								onChange={(value) => switchRuleEditorScope(value as RuleScope)}
								options={[
									{ value: "single", label: "设备内" },
									{ value: "linkage", label: "多设备协同" },
								]}
								size="middle"
							/>
							<Button onClick={closeRuleEditor}>关闭编辑器</Button>
						</Space>
					}
				>
					<Paragraph
						type="secondary"
						style={{
							marginTop: 0,
							marginBottom: 22,
							lineHeight: 1.7,
							padding: "10px 14px",
							background: "#f7f9fc",
							border: "1px solid #edf1f5",
							borderRadius: 12,
						}}
					>
						先选设备范围，再填写触发条件、动作和脚本逻辑。
					</Paragraph>
					{editorScope === "single" ? (
						<ScriptModal
							open={scriptModalOpen}
							script={editingScript}
							devices={devicesList}
							loading={createScript.isPending || updateScript.isPending}
							embedded
							onClose={closeRuleEditor}
							onSubmit={(values) => {
								if (editingScript) updateScript.mutate(values);
								else createScript.mutate(values);
							}}
						/>
					) : (
						<LinkageModal
							open={linkageModalOpen}
							script={editingLinkage}
							devices={devicesList}
							loading={createLinkage.isPending || updateLinkage.isPending}
							embedded
							onClose={closeRuleEditor}
							onSubmit={(values) => {
								if (editingLinkage) updateLinkage.mutate(values);
								else createLinkage.mutate(values);
							}}
						/>
					)}
				</Card>
			) : null}

			<Card
				title="统一规则列表"
				style={panelCardStyle}
				styles={{ body: { ...softCardBodyStyle, padding: 18 } }}
				extra={<Text type="secondary">设备内控制和多设备协同规则统一在这里查看、筛选和执行。</Text>}
			>
				<Table rowKey="id" loading={scriptsQ.isLoading} dataSource={filteredRules} columns={ruleColumns} pagination={{ pageSize: 20 }} scroll={{ x: 1480 }} />
			</Card>

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
						description="支持导入单条规则 JSON，也支持一次粘贴规则数组批量导入。导入后的内容会新增为规则，不会覆盖现有规则。"
					/>
					<Input.TextArea
						rows={16}
						value={importText}
						onChange={(event) => setImportText(event.target.value)}
						placeholder='粘贴从“导出规则”得到的 JSON，或一条单独的规则 JSON'
						style={{ fontFamily: "Consolas, monospace", fontSize: 12 }}
					/>
				</Space>
			</Modal>
		</Page>
	);
}
