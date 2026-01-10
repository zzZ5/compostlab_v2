import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildQuery } from "@/lib/api";
import type {
	ControlTemplate,
	ControlTemplateCreateBody,
	ControlTemplateListResp,
	ControlTemplateDetailResp,
} from "@/types/api";

// Query Keys
export const templateKeys = {
	all: ["control-templates"] as const,
	lists: () => [...templateKeys.all, "list"] as const,
	list: (filters: string) => [...templateKeys.lists(), filters] as const,
	detail: (id: number) => [...templateKeys.all, "detail", id] as const,
};

// Queries
export function useControlTemplates(deviceId?: number, isActive?: boolean) {
	const qs = buildQuery({
		device_id: deviceId,
		is_active: isActive !== undefined ? (isActive ? 1 : 0) : undefined,
	});
	return useQuery<ControlTemplateListResp>({
		queryKey: templateKeys.list(qs),
		queryFn: async () => {
			const res = await api.get<ControlTemplateListResp>(`/control-templates${qs}`);
			return res.data;
		},
	});
}

export function useControlTemplate(id: number) {
	return useQuery<ControlTemplateDetailResp>({
		queryKey: templateKeys.detail(id),
		queryFn: async () => {
			const res = await api.get<ControlTemplateDetailResp>(`/control-templates/${id}`);
			return res.data;
		},
		enabled: Number.isFinite(id),
	});
}

// Mutations
export function useCreateControlTemplate() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (data: ControlTemplateCreateBody) => {
			const res = await api.post<ControlTemplateDetailResp>("/control-templates", data);
			return res.data;
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: templateKeys.lists() });
		},
	});
}

export function useUpdateControlTemplate(id: number) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (data: Partial<ControlTemplateCreateBody>) => {
			const res = await api.patch<ControlTemplateDetailResp>(`/control-templates/${id}`, data);
			return res.data;
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: templateKeys.lists() });
			queryClient.invalidateQueries({ queryKey: templateKeys.detail(id) });
		},
	});
}

export function useDeleteControlTemplate() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (id: number) => {
			await api.delete(`/control-templates/${id}`);
			return id;
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: templateKeys.lists() });
		},
	});
}
