import { useQuery } from "@tanstack/react-query";
import { api, buildQuery } from "@/lib/api";
import type { DeviceTreeResp, DeviceTreeItem } from "@/types/api";
import { deviceKeys } from "./keys";

export function useDevicesTree(withLatest = true) {
	return useQuery<DeviceTreeItem[]>({
		queryKey: deviceKeys.tree(withLatest),
		queryFn: async () => {
			const qs = buildQuery({ with_latest: withLatest ? 1 : 0 });
			const res = await api.get<DeviceTreeResp>(`/devices/tree${qs}`);
			return res.data.data;
		},
	});
}

export type LatestRow = {
	code: string;
	ts: string;
	value: number;
	unit?: string;
};

type LatestResp = {
	device_id: number;
	count: number;
	data: LatestRow[];
};

export function useDeviceLatest(deviceId: number, channels: string[]) {
	const channelsKey = (channels || []).join(",");
	const qs = channels && channels.length ? `?channels=${channelsKey}` : "";
	return useQuery({
		queryKey: deviceKeys.latest(deviceId, channelsKey),
		queryFn: async () => {
			const res = await api.get<LatestResp>(`/devices/${deviceId}/latest${qs}`);
			return res.data;
		},
		enabled: Number.isFinite(deviceId),
		refetchInterval: 5000,
	});
}

export type DeviceCommand = {
	command_id: number;
	device_id: number;
	status: "queued" | "sent" | "acked" | "failed";
	command?: string;
	payload: any;
	result?: any;
	created_at?: string;
	sent_at?: string | null;
	acked_at?: string | null;
};

type ListResp<T> = { count: number; data: T[] };

export function useDeviceCommands(deviceId: number, limit = 50, status?: string) {
	const q = new URLSearchParams();
	q.set("limit", String(limit));
	if (status) q.set("status", status);

	return useQuery({
		queryKey: [...deviceKeys.commands(deviceId), q.toString()],
		queryFn: async () => {
			const res = await api.get<ListResp<DeviceCommand>>(
				`/devices/${deviceId}/commands?${q.toString()}`
			);
			return res.data;
		},
		enabled: Number.isFinite(deviceId),
		refetchInterval: 5000,
	});
}
