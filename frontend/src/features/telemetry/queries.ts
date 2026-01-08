import { useQuery } from "@tanstack/react-query";
import { api, buildQuery } from "@/lib/api";
import type { DeviceTelemetryResp } from "@/types/api";
import { deviceKeys } from "@/features/devices/keys";

export function useDeviceTelemetry(args: {
	deviceId: number;
	from?: string | null;
	to?: string | null;
	channels?: string[] | null; // code 列表
	bucket?: string | null;
}) {
	const { deviceId, from, to, channels, bucket } = args;
	const argsKey = [from, to, channels?.join(",") || "", bucket || ""].join("|");

	return useQuery<DeviceTelemetryResp>({
		queryKey: deviceKeys.telemetry(deviceId, argsKey),
		queryFn: async () => {
			const qs = buildQuery({
				from,
				to,
				channels: channels && channels.length ? channels : null,
				bucket,
			});
			const res = await api.get<DeviceTelemetryResp>(`/devices/${deviceId}/telemetry${qs}`);
			return res.data;
		},
		enabled: Number.isFinite(deviceId),
	});
}
