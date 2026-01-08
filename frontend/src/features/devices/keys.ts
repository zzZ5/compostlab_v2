export const deviceKeys = {
	all: ["devices"] as const,
	/** 设备树（含可选 latest） */
	tree: (withLatest: boolean) => [...deviceKeys.all, "tree", withLatest] as const,
	/** 单个设备 */
	detail: (deviceId: number) => [...deviceKeys.all, "detail", deviceId] as const,
	/** 设备通道列表 */
	channels: (deviceId: number) => [...deviceKeys.detail(deviceId), "channels"] as const,
	/** 设备最新值 */
	latest: (deviceId: number, channelsKey: string) =>
		[...deviceKeys.detail(deviceId), "latest", channelsKey] as const,
	/** 设备遥测 */
	telemetry: (deviceId: number, argsKey: string) =>
		[...deviceKeys.detail(deviceId), "telemetry", argsKey] as const,
	/** 设备命令 */
	commands: (deviceId: number) => [...deviceKeys.detail(deviceId), "commands"] as const,
};
