export type Sev = "danger" | "warn" | "ok" | "none";

export function sevToColor(sev: Sev) {
	if (sev === "danger") return "red";
	if (sev === "warn") return "orange";
	if (sev === "ok") return "green";
	return "default";
}

export function evalTemp(v: number | null) {
	if (v === null || v === undefined) return { sev: "none" as Sev, tip: "无温度数据" };
	if (v >= 75) return { sev: "danger" as Sev, tip: "温度过高（≥75℃）" };
	if (v >= 65) return { sev: "warn" as Sev, tip: "温度偏高（65–75℃）" };
	if (v >= 50) return { sev: "ok" as Sev, tip: "温度正常（50–65℃）" };
	return { sev: "warn" as Sev, tip: "温度偏低（<50℃）" };
}

export function evalO2(v: number | null) {
	if (v === null || v === undefined) return { sev: "none" as Sev, tip: "无氧气数据" };
	if (v < 15) return { sev: "danger" as Sev, tip: "氧气过低（<15%）" };
	if (v < 18) return { sev: "warn" as Sev, tip: "氧气偏低（15–18%）" };
	if (v <= 21) return { sev: "ok" as Sev, tip: "氧气正常（18–21%）" };
	return { sev: "warn" as Sev, tip: "氧气偏高（>21%）" };
}