export const runKeys = {
	all: ["runs"] as const,
	list: (q: string) => [...runKeys.all, "list", q] as const,
	detail: (runId: number) => [...runKeys.all, "detail", runId] as const,

	telemetryBase: (runId: number) => [...runKeys.detail(runId), "telemetry"] as const,
	telemetry: (runId: number, argsKey: string) =>
		[...runKeys.telemetryBase(runId), argsKey] as const,

	windowsBase: (runId: number) => [...runKeys.detail(runId), "windows"] as const,
	windows: (runId: number, group: string, treatment: string) =>
		[...runKeys.windowsBase(runId), group, treatment] as const,
};
