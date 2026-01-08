import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Channel } from "@/types/api";
import { deviceKeys } from "@/features/devices/keys";

export type CreateChannelBody = {
	code: string;
	name?: string;
	unit?: string;
	metric?: string;
	role?: string;
	display_name?: string;
	meta?: any;
	is_active?: boolean;
};

export type UpdateChannelBody = Partial<{
	code: string;
	name: string;
	unit: string;
	metric: string;
	role: string;
	display_name: string;
	meta: any;
	is_active: boolean;
}>;

export function useCreateChannel(deviceId: number) {
	const qc = useQueryClient();
	return useMutation<Channel, any, CreateChannelBody>({
		mutationFn: async (body) => {
			const res = await api.post<Channel>(`/devices/${deviceId}/channels`, body);
			return res.data;
		},
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: deviceKeys.all });
			qc.invalidateQueries({ queryKey: deviceKeys.channels(deviceId) });
		},
	});
}

export function useUpdateChannel(deviceId: number, channelId: number) {
	const qc = useQueryClient();
	return useMutation<Channel, any, UpdateChannelBody>({
		mutationFn: async (body) => {
			const res = await api.patch<Channel>(
				`/devices/${deviceId}/channels/${channelId}`,
				body
			);
			return res.data;
		},
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: deviceKeys.all });
			qc.invalidateQueries({ queryKey: deviceKeys.channels(deviceId) });
		},
	});
}

export function useDeleteChannel(deviceId: number) {
	const qc = useQueryClient();
	return useMutation<
		{ detail: string; device_id: number; channel_id: number },
		any,
		{ channel_id: number }
	>({
		mutationFn: async ({ channel_id }) => {
			const res = await api.delete(`/devices/${deviceId}/channels/${channel_id}`);
			return res.data;
		},
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: deviceKeys.all });
			qc.invalidateQueries({ queryKey: deviceKeys.channels(deviceId) });
		},
	});
}
