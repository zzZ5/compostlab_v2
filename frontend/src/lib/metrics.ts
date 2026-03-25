import type { Channel } from "@/types/api";

export type MetricKey =
	| "temperature"
	| "o2"
	| "co2"
	| "ch4"
	| "co"
	| "h2s"
	| "nh3"
	| "moisture"
	| "humidity"
	| "ph"
	| "flow"
	| "switch"
	| "unknown";

const EXACT_CODE_TO_METRIC: Record<string, MetricKey> = {
	co2: "co2",
	co: "co",
	h2s: "h2s",
	o2: "o2",
	ch4: "ch4",
	heater: "switch",
	pump: "switch",
	aeration: "switch",
};

function normalizedTokens(value?: string | null): string[] {
	const raw = (value || "").trim().toLowerCase();
	if (!raw) return [];
	return raw
		.replace(/[^a-z0-9]+/g, " ")
		.split(/\s+/)
		.filter(Boolean);
}

function textContainsMetricToken(
	value: string | null | undefined,
	patterns: RegExp[],
): boolean {
	const text = (value || "").trim().toLowerCase();
	if (!text) return false;
	return patterns.some((pattern) => pattern.test(text));
}

function inferMetricFromCodeOrText(
	code?: string | null,
	name?: string | null,
	displayName?: string | null,
	unit?: string | null,
): MetricKey {
	const codeText = (code || "").trim().toLowerCase();
	const compactCode = codeText.replace(/[^a-z0-9]+/g, "");
	const nameText = (name || "").trim().toLowerCase();
	const displayText = (displayName || "").trim().toLowerCase();
	const unitText = (unit || "").trim().toLowerCase();
	const combinedText = [displayText, nameText].filter(Boolean).join(" ");
	const combinedTokens = new Set([
		...normalizedTokens(displayText),
		...normalizedTokens(nameText),
	]);

	if (compactCode && EXACT_CODE_TO_METRIC[compactCode]) {
		return EXACT_CODE_TO_METRIC[compactCode];
	}

	if (
		textContainsMetricToken(codeText, [/\bco2\b/, /carbon[_\s-]*dioxide/]) ||
		textContainsMetricToken(combinedText, [/\bco2\b/, /carbon[_\s-]*dioxide/]) ||
		combinedTokens.has("co2")
	) {
		return "co2";
	}

	if (
		textContainsMetricToken(codeText, [/\bo2\b/, /\boxygen\b/]) ||
		textContainsMetricToken(combinedText, [/\bo2\b/, /\boxygen\b/]) ||
		combinedTokens.has("o2") ||
		combinedTokens.has("oxygen")
	) {
		return "o2";
	}

	if (
		textContainsMetricToken(codeText, [/\btemp\b/, /\btemperature\b/, /\bt[1-9]\b/]) ||
		textContainsMetricToken(combinedText, [/\btemp\b/, /\btemperature\b/]) ||
		combinedTokens.has("temp") ||
		combinedTokens.has("temperature")
	) {
		return "temperature";
	}

	if (
		textContainsMetricToken(codeText, [/\bch4\b/, /\bmethane\b/]) ||
		textContainsMetricToken(combinedText, [/\bch4\b/, /\bmethane\b/]) ||
		combinedTokens.has("ch4") ||
		combinedTokens.has("methane")
	) {
		return "ch4";
	}

	if (
		textContainsMetricToken(codeText, [/\bh2s\b/, /\bsulfide\b/, /\bsulphide\b/]) ||
		textContainsMetricToken(combinedText, [/\bh2s\b/, /\bsulfide\b/, /\bsulphide\b/]) ||
		combinedTokens.has("h2s")
	) {
		return "h2s";
	}

	if (
		textContainsMetricToken(codeText, [/\bnh3\b/, /\bammonia\b/]) ||
		textContainsMetricToken(combinedText, [/\bnh3\b/, /\bammonia\b/]) ||
		combinedTokens.has("nh3") ||
		combinedTokens.has("ammonia")
	) {
		return "nh3";
	}

	if (
		textContainsMetricToken(codeText, [/\bco\b/, /carbon[_\s-]*monoxide/]) ||
		textContainsMetricToken(combinedText, [/\bco\b/, /carbon[_\s-]*monoxide/]) ||
		combinedTokens.has("co")
	) {
		return "co";
	}

	if (
		textContainsMetricToken(codeText, [/\bmois\b/, /\bmoisture\b/, /water[_\s-]*content/, /\bmc\b/]) ||
		textContainsMetricToken(combinedText, [/\bmois\b/, /\bmoisture\b/, /water[_\s-]*content/, /\bmc\b/]) ||
		combinedTokens.has("moisture")
	) {
		return "moisture";
	}

	if (
		textContainsMetricToken(codeText, [/\bhumid\b/, /\bhumidity\b/, /\brh\b/]) ||
		textContainsMetricToken(combinedText, [/\bhumid\b/, /\bhumidity\b/, /\brh\b/]) ||
		combinedTokens.has("humidity") ||
		combinedTokens.has("humid") ||
		combinedTokens.has("rh")
	) {
		return "humidity";
	}

	if (
		textContainsMetricToken(codeText, [/\bph\b/]) ||
		textContainsMetricToken(combinedText, [/\bph\b/]) ||
		combinedTokens.has("ph")
	) {
		return "ph";
	}

	if (
		textContainsMetricToken(codeText, [/\bflow\b/]) ||
		textContainsMetricToken(combinedText, [/\bflow\b/]) ||
		combinedTokens.has("flow")
	) {
		return "flow";
	}

	if (
		textContainsMetricToken(codeText, [/\bswitch\b/, /\brelay\b/, /\bon[_\s-]*off\b/]) ||
		textContainsMetricToken(combinedText, [/\bswitch\b/, /\brelay\b/, /\bon[_\s-]*off\b/]) ||
		combinedTokens.has("switch") ||
		combinedTokens.has("relay")
	) {
		return "switch";
	}

	if (["%vol", "vol%"].includes(unitText) && compactCode === "o2") return "o2";
	if (unitText === "ppm" && compactCode === "co2") return "co2";
	if (unitText === "ppm" && compactCode === "co") return "co";
	if (unitText === "ppm" && compactCode === "h2s") return "h2s";
	if (["%lel", "lel%"].includes(unitText) && compactCode === "ch4") return "ch4";
	if (["°c", "℃", "c"].includes(unitText)) return "temperature";
	if (["%rh", "rh"].includes(unitText)) return "humidity";
	if (unitText === "ph") return "ph";

	return "unknown";
}

export function isIgnoredMetricRaw(m?: string | null): boolean {
	const x = (m || "").trim().toLowerCase();
	if (!x) return false;
	return (
		x.includes("press") ||
		x.includes("pressure") ||
		x.includes("wind") ||
		x.includes("direction") ||
		x.includes("speed") ||
		x.includes("rpm") ||
		x.includes("current") ||
		x.includes("amp") ||
		x === "a" ||
		x.includes("voltage") ||
		x.includes("volt") ||
		x === "v" ||
		x.includes("power") ||
		x.includes("watt") ||
		x === "w" ||
		x.includes("level")
	);
}

export function normalizeMetric(m?: string | null): MetricKey {
	const x = (m || "").trim().toLowerCase();
	if (!x) return "unknown";
	if (isIgnoredMetricRaw(x)) return "unknown";
	if (["temp", "temperature", "t", "t1", "t2", "t3", "rt", "roomtemp", "at", "airtemp", "ambient_temp", "env_temp"].includes(x)) return "temperature";
	if (["o2", "oxygen", "oxygen_level"].includes(x)) return "o2";
	if (["co2", "carbon_dioxide", "carbondioxide", "carbon_dio", "c_dioxide"].includes(x)) return "co2";
	if (["ch4", "methane", "methane_concentration", "ch4_concentration"].includes(x)) return "ch4";
	if (["co", "carbon_monoxide", "carbonmonoxide", "co_concentration", "co_ppm"].includes(x)) return "co";
	if (["h2s", "hydrogen_sulfide", "hydrogen_sulphide", "h2s_concentration", "h2s_ppm"].includes(x)) return "h2s";
	if (["nh3", "ammonia", "ammonia_concentration", "nh3_concentration"].includes(x)) return "nh3";
	if (["mois", "moisture", "water_content", "water_content_rate", "mc"].includes(x)) return "moisture";
	if (["humid", "humidity", "rh", "relative_humidity", "airhumidity", "ah", "air_humidity"].includes(x)) return "humidity";
	if (["ph", "ph_value", "acidity", "alkalinity"].includes(x)) return "ph";
	if (["flow", "flow_rate", "flowrate", "volume_flow", "volumetric_flow"].includes(x)) return "flow";
	if (["switch", "sw", "on_off", "onoff", "state", "status", "enable", "disable", "relay", "contact"].includes(x)) return "switch";
	return "unknown";
}

export function detectChannelMetric(
	ch: Pick<Channel, "metric" | "code" | "name" | "display_name" | "unit">,
): MetricKey {
	const metricNorm = normalizeMetric(ch.metric);
	if (metricNorm !== "unknown") return metricNorm;
	return inferMetricFromCodeOrText(ch.code, ch.name, ch.display_name, ch.unit);
}

export function metricLabel(k: MetricKey) {
	switch (k) {
		case "temperature": return "温度";
		case "o2": return "O2";
		case "co2": return "CO2";
		case "ch4": return "CH4";
		case "co": return "CO";
		case "h2s": return "H2S";
		case "nh3": return "NH3";
		case "moisture": return "含水率";
		case "humidity": return "湿度";
		case "ph": return "pH";
		case "flow": return "流量";
		case "switch": return "开关";
		default: return "未分类";
	}
}

export function getChannelDisplayName(ch: Channel): string {
	if (ch.display_name && ch.display_name.trim()) return ch.display_name.trim();
	if (ch.name && ch.name.trim()) return ch.name.trim();

	const metric = detectChannelMetric(ch);
	const code = (ch.code || "").trim().toUpperCase();

	if (metric !== "unknown") {
		return metricLabel(metric);
	}

	return code || "未分类";
}

export function inferChannelLabel(metric?: string | null, code?: string | null): string {
	const metricNorm = normalizeMetric(metric);
	if (metricNorm !== "unknown") {
		return metricLabel(metricNorm);
	}

	const inferred = inferMetricFromCodeOrText(code);
	if (inferred !== "unknown") {
		return metricLabel(inferred);
	}

	return (code || "").trim().toUpperCase() || "未分类";
}
