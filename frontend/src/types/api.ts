// src/types/api.ts

/* =========================
 * 基础通用
 * ========================= */

export type ID = number;

/** 后端统一输出： "YYYY-MM-DD HH:MM:SS"（不带时区） */
export type LocalDateTimeString = string;

export type JSONValue =
	| string
	| number
	| boolean
	| null
	| { [k: string]: JSONValue }
	| JSONValue[];

export type JSONObject = { [k: string]: JSONValue };

export type ListResp<T> = {
	count: number;
	data: T[];
};

export type DetailResp = { detail: string };

/* =========================
 * Devices / Channels
 * ========================= */

export type Device = {
	device_id: ID;
	code: string;
	name: string;

	last_seen_at?: LocalDateTimeString | null;
	created_at: LocalDateTimeString;
	updated_at: LocalDateTimeString;

	is_active?: boolean;

	post_topic?: string;
	response_topic?: string;

	note?: string;

	meta?: JSONObject;
};

export type ChannelLatest = {
	code: string;
	ts: LocalDateTimeString;
	value: number | null; // 后端 try float，失败会给 null
	unit: string;
	quality: string;
	source: string;
};

export type Channel = {
	channel_id: ID;
	device_id: ID;

	code: string;
	name: string;
	unit: string;

	is_active?: boolean;

	/** ✅ 语义层字段（你已新增） */
	metric?: string;        // models.Channel.metric: CharField blank->""，API里会 strip
	role?: string;          // models.Channel.role
	display_name?: string;  // models.Channel.display_name

	meta?: JSONObject;

	created_at: LocalDateTimeString;
	updated_at: LocalDateTimeString;

	/** 仅当 with_latest=1 时存在 */
	latest?: ChannelLatest | null;
};

export type DeviceTreeItem = Device & {
	channels: Channel[];
};

export type DeviceTreeResp = ListResp<DeviceTreeItem>;

/** GET /api/v2/devices/<id>/channels 返回 */
export type DeviceChannelsResp = {
	device_id: ID;
	count: number;
	data: Channel[];
};

/* =========================
 * Device Commands（下发命令）
 * ========================= */

export type DeviceCommandStatus = "queued" | "sent" | "acked" | "failed";

export type DeviceCommandRecord = {
	command_id: ID;
	device_id: ID;

	status: DeviceCommandStatus;
	command: string; // 后端从 commands[0].command 尽量提取

	payload: JSONObject; // 后端实际保存的 payload（含 device / commands / server_ts）
	result: JSONObject;  // {"mqtt":"published","topic":...} 或 failed info

	created_at: LocalDateTimeString;
	sent_at: LocalDateTimeString | null;
	acked_at: LocalDateTimeString | null;
};

/**
 * POST /api/v2/devices/<device_id>/commands 的 body
 * 后端要求：{ "commands": [ {...}, {...} ] } 且必须 non-empty list
 * 注意：后端不会要求你传 device/server_ts（会自动补全进 payload）
 */
export type DeviceCommandCreateBody = {
	commands: JSONObject[]; // 与 ESP32 结构化命令保持一致（不强制字段）
};

export type DeviceCommandListResp = ListResp<DeviceCommandRecord>;
export type DeviceCommandDetailResp = DeviceCommandRecord;

/* =========================
 * Telemetry（devices 维度）
 * ========================= */

export type TelemetryRawPoint = {
	device_id: ID;
	code: string;
	ts: LocalDateTimeString;
	value: number;
	unit: string;
	quality: string;
	source: string;
};

export type TelemetryAggPoint = {
	device_id: ID;
	code: string;
	ts: LocalDateTimeString;
	value: number;
	unit: string;
	agg: "avg";
	bucket: string;       // bucket.label
	source?: string;      // runs 聚合会写 "timescale"，device 聚合不写（但可以容错）
};

export type TelemetryPoint = TelemetryRawPoint | TelemetryAggPoint;

export type DeviceTelemetryResp = {
	scope: "device";
	device_id: ID;

	from: LocalDateTimeString | null;
	to: LocalDateTimeString;

	/** 只有 bucket 模式存在 */
	bucket?: string;

	filters: {
		channels: string[] | null;
	};

	count: number;
	data: TelemetryPoint[];
};

/** GET /api/v2/devices/<device_id>/channels/<code>/telemetry */
export type DeviceChannelTelemetryResp = {
	scope: "channel";
	device_id: ID;
	code: string;

	from: LocalDateTimeString | null;
	to: LocalDateTimeString;

	bucket?: string;

	count: number;
	data: TelemetryPoint[];
};

/** GET /api/v2/devices/<id>/latest */
export type DeviceLatestResp = {
	scope: "device_latest";
	device_id: ID;
	filters: { channels: string[] | null };
	count: number;
	data: TelemetryRawPoint[];
};

/** GET /api/v2/devices/<id>/channels/<code>/latest */
export type DeviceChannelLatestResp = {
	scope: "channel_latest";
	device_id: ID;
	code: string;
	data: TelemetryRawPoint | null;
};

/** GET /api/v2/devices/<id>/summary */
export type DeviceSummaryResp = {
	scope: "device_summary";
	device_id: ID;

	count: number;
	min_ts: LocalDateTimeString | null;
	max_ts: LocalDateTimeString | null;

	channels: string[];
};

/**
 * GET /api/v2/devices/<id>/export
 * 后端是 Streaming CSV，不是 JSON
 */
export type DeviceExportResp = Blob;

/* =========================
 * Runs / RunWindows
 * ========================= */

export type Run = {
	run_id: ID;
	name: string;

	start_at: LocalDateTimeString;
	end_at: LocalDateTimeString | null;

	recipe?: JSONObject;
	settings?: JSONObject;

	note: string;

	created_at: LocalDateTimeString;
	updated_at: LocalDateTimeString;
};

export type RunWindow = {
	window_id: ID;
	run_id: ID;
	device_id: ID;

	group?: string | null;        // API 会给
	treatment?: string | null;
	follow_run?: boolean;

	start_at?: LocalDateTimeString | null;
	end_at?: LocalDateTimeString | null;

	/** API 额外给的“有效时间”（继承 run） */
	effective_start_at?: LocalDateTimeString | null;
	effective_end_at?: LocalDateTimeString | null;

	settings?: JSONObject;
	meta?: JSONObject;

	note: string;
};

export type RunListResp = ListResp<Run>;
export type RunDetailResp = Run;

export type RunWindowsResp = {
	run_id: ID;
	filters: { group: string | null; treatment: string | null };
	count: number;
	data: RunWindow[];
};

/* =========================
 * Run Telemetry / Summary / Export
 * ========================= */

export type RunTelemetryResp = {
	run_id: ID;

	from: LocalDateTimeString | null;
	to: LocalDateTimeString | null;

	bucket?: string;

	count: number;
	data: (TelemetryRawPoint | (TelemetryAggPoint & { source: "timescale" }))[];

	filters: {
		group: string | null;
		treatment: string | null;
		channels: string[] | null;
	};

	windows: RunWindow[];
	matched_device_ids: ID[];

	/** 当没有 windows 或无 overlap 时会带 note */
	note?: string;
};

export type RunSummaryResp = {
	scope: "run_summary";
	run_id: ID;

	filters: { group: string | null; treatment: string | null };
	windows: RunWindow[];

	count: number;
	min_ts: LocalDateTimeString | null;
	max_ts: LocalDateTimeString | null;

	codes: string[];
	matched_device_ids: ID[];
};

/** runs 导出是 CSV Streaming */
export type RunExportResp = Blob;
export type RunExportWideResp = Blob;

/* =========================
 * Errors（常见）
 * ========================= */

export type APIError =
	| { detail: string }
	| { detail: "not found" }
	| { detail: string;[k: string]: any };
