export const userKeys = {
	all: ["users"] as const,
	me: () => [...userKeys.all, "me"] as const,
	list: () => [...userKeys.all, "list"] as const,
	detail: (userId: number) => [...userKeys.all, "detail", userId] as const,
};
