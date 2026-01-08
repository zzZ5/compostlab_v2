export type MetricKey = "temperature" | "o2" | "co2" | "moisture" | "unknown";

export function normalizeMetric(m?: string | null): MetricKey {
	const x = (m || "").trim().toLowerCase();
	if (!x) return "unknown";
	if (["temp", "temperature", "t", "t1", "t2", "t3"].includes(x)) return "temperature";
	if (["o2", "oxygen"].includes(x)) return "o2";
	if (["co2", "carbon_dioxide", "carbondioxide"].includes(x)) return "co2";
	if (["mois", "moisture", "humidity", "water"].includes(x)) return "moisture";
	return "unknown";
}

export function metricLabel(k: MetricKey) {
	switch (k) {
		case "temperature": return "温度";
		case "o2": return "氧气";
		case "co2": return "二氧化碳";
		case "moisture": return "含水率";
		default: return "未分类";
	}
}
