import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { userKeys } from "./keys";
import type { User } from "@/types/api";

/**
 * 获取当前登录用户信息
 * GET /api/v2/auth/me
 */
export function useMe() {
	return useQuery<User>({
		queryKey: userKeys.me(),
		queryFn: async () => {
			const res = await api.get<User>("/auth/me");
			return res.data;
		},
		// 只有当 token 存在时才请求
		enabled: true, // 由 api interceptor 处理 401
		staleTime: 5 * 60 * 1000, // 5 分钟内认为数据新鲜
		retry: false,
	});
}
