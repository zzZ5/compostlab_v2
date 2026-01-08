import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Channel, DeviceChannelsResp } from "@/types/api";
import { deviceKeys } from "@/features/devices/keys";

export function useDeviceChannels(deviceId: number) {
	return useQuery<Channel[]>({
		queryKey: deviceKeys.channels(deviceId),
		queryFn: async () => {
			const res = await api.get<DeviceChannelsResp>(`/devices/${deviceId}/channels`);
			return res.data.data;
		},
		enabled: Number.isFinite(deviceId),
	});
}
