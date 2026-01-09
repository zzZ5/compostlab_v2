import type { Channel } from "@/types/api";

export type MetricKey = "temperature" | "o2" | "co2" | "moisture" | "ph" | "pressure" | "wind_speed" | "wind_direction" | "unknown";

export function normalizeMetric(m?: string | null): MetricKey {
	const x = (m || "").trim().toLowerCase();
	if (!x) return "unknown";
	// 温度相关
	if (["temp", "temperature", "t", "t1", "t2", "t3", "rt", "roomtemp", "at", "airtemp", "ambient_temp", "env_temp"].includes(x)) return "temperature";
	// 氧气相关
	if (["o2", "oxygen", "oxygen_level"].includes(x)) return "o2";
	// 二氧化碳相关
	if (["co2", "carbon_dioxide", "carbondioxide", "carbon_dio", "c_dioxide"].includes(x)) return "co2";
	// 水分/湿度相关
	if (["mois", "moisture", "humidity", "water", "rh", "relative_humidity", "airhumidity", "ah", "humid"].includes(x)) return "moisture";
	// pH 值
	if (["ph", "ph_value", "acidity", "alkalinity"].includes(x)) return "ph";
	// 压力相关
	if (["press", "pressure", "pa", "kpa", "bar", "psi", "air_pressure", "gas_pressure"].includes(x)) return "pressure";
	// 风速
	if (["wind", "wind_speed", "ws", "airflow", "flow"].includes(x)) return "wind_speed";
	// 风向
	if (["wind_dir", "wind_direction", "wd", "direction"].includes(x)) return "wind_direction";
	return "unknown";
}

export function metricLabel(k: MetricKey) {
	switch (k) {
		case "temperature": return "温度";
		case "o2": return "氧气";
		case "co2": return "二氧化碳";
		case "moisture": return "含水率";
		case "ph": return "pH值";
		case "pressure": return "压力";
		case "wind_speed": return "风速";
		case "wind_direction": return "风向";
		default: return "未分类";
	}
}

/**
 * 获取 channel 的展示名称，优先级：
 * 1. channel.display_name (最高优先级 - 用户显式设置的展示名称)
 * 2. channel.name
 * 3. 根据 metric + code 自动推断
 */
export function getChannelDisplayName(ch: Channel): string {
	// 1. 优先使用 display_name (用户显式设置的展示名称)
	if (ch.display_name && ch.display_name.trim()) return ch.display_name.trim();

	// 2. 其次使用 name
	if (ch.name && ch.name.trim()) return ch.name.trim();

	// 3. 根据 metric + code 自动推断
	const metric = normalizeMetric(ch.metric);
	const code = (ch.code || "").trim().toUpperCase();

	if (metric !== "unknown") {
		return metricLabel(metric);
	}

	// 如果 metric 是 unknown，尝试从 code 推断
	if (code) {
		// 常见 code 模式推断
		const codeLower = code.toLowerCase();
		if (codeLower.includes("temp") || codeLower.includes("t1") || codeLower.includes("t2") || codeLower.includes("t3")) {
			return "温度";
		}
		if (codeLower.includes("o2") || codeLower.includes("oxygen")) {
			return "氧气";
		}
		if (codeLower.includes("co2") || codeLower.includes("carbon")) {
			return "二氧化碳";
		}
		if (codeLower.includes("mois") || codeLower.includes("humid") || codeLower.includes("rh")) {
			return "含水率";
		}
		if (codeLower.includes("ph")) {
			return "pH值";
		}
		if (codeLower.includes("press") || codeLower.includes("pa")) {
			return "压力";
		}
		if (codeLower.includes("wind") || codeLower.includes("ws")) {
			return "风速";
		}
		if (codeLower.includes("dir") || codeLower.includes("wd")) {
			return "风向";
		}
	}

	// 4. 最后回退到 code 本身
	return code || "未分类";
}

/**
 * 根据 metric 或 code 推断标签（用于 fallback 展示）
 */
export function inferChannelLabel(metric?: string | null, code?: string | null): string {
	const metricNorm = normalizeMetric(metric);
	if (metricNorm !== "unknown") {
		return metricLabel(metricNorm);
	}

	const codeClean = (code || "").trim().toUpperCase();
	if (!codeClean) return "未分类";

	const codeLower = codeClean.toLowerCase();
	if (codeLower.includes("temp") || codeLower.includes("t1") || codeLower.includes("t2") || codeLower.includes("t3")) {
		return "温度";
	}
	if (codeLower.includes("o2") || codeLower.includes("oxygen")) {
		return "氧气";
	}
	if (codeLower.includes("co2") || codeLower.includes("carbon")) {
		return "二氧化碳";
	}
	if (codeLower.includes("mois") || codeLower.includes("humid") || codeLower.includes("rh")) {
		return "含水率";
	}
	if (codeLower.includes("ph")) {
		return "pH值";
	}
	if (codeLower.includes("press") || codeLower.includes("pa")) {
		return "压力";
	}
	if (codeLower.includes("wind") || codeLower.includes("ws")) {
		return "风速";
	}
	if (codeLower.includes("dir") || codeLower.includes("wd")) {
		return "风向";
	}

	return codeClean;
}
