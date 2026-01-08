import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Device } from "@/types/api";
import { deviceKeys } from "./keys";

export type CreateDeviceBody = {
	code: string;
	name?: string;
	post_topic?: string | null;
	response_topic?: string | null;
	note?: string;
	meta?: any;
	is_active?: boolean;
};

export type UpdateDeviceBody = Partial<{
	code: string;
	name: string;
	post_topic: string | null;
	response_topic: string | null;
	note: string;
	meta: any;
	is_active: boolean;
}>;

export function useCreateDevice() {
	const qc = useQueryClient();
	return useMutation<Device, any, CreateDeviceBody>({
		mutationFn: async (body) => {
			const res = await api.post<Device>(`/devices`, body);
			return res.data;
		},
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: deviceKeys.all });
		},
	});
}

export function useUpdateDevice(deviceId: number) {
	const qc = useQueryClient();
	return useMutation<Device, any, UpdateDeviceBody>({
		mutationFn: async (body) => {
			const res = await api.patch<Device>(`/devices/${deviceId}`, body);
			return res.data;
		},
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: deviceKeys.all });
			qc.invalidateQueries({ queryKey: deviceKeys.detail(deviceId) });
		},
	});
}

export function useDeleteDevice() {
	const qc = useQueryClient();
	return useMutation<{ detail: string; device_id: number }, any, { device_id: number }>({
		mutationFn: async ({ device_id }) => {
			const res = await api.delete(`/devices/${device_id}`);
			return res.data;
		},
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: deviceKeys.all });
		},
	});
}

export function useSendDeviceCommand(deviceId: number) {
	const qc = useQueryClient();

	return useMutation({
		mutationFn: async (body: { commands: any[] }) => {
			const res = await api.post(`/devices/${deviceId}/commands`, body);
			return res.data;
		},
		onSuccess: () => {
			// 发送成功后刷新命令历史
			qc.invalidateQueries({ queryKey: deviceKeys.commands(deviceId) });
		},
	});
}
