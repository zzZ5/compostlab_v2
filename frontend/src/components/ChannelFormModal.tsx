import React, { useEffect, useMemo } from "react";
import { Modal, Form, Input, Switch } from "antd";
import { KeyValueEditor } from "@/components/KeyValueEditor";
import { emptyObjectToUndefined, kvPairsToObject, objectToKVPairs } from "@/lib/kv";

export type ChannelFormValues = {
	code: string;
	name?: string;
	metric?: string;
	unit?: string;
	role?: string;
	display_name?: string;
	is_active?: boolean;
	meta?: Record<string, any>;
};

type Props = {
	open: boolean;
	title: string;
	okText?: string;
	initialValues?: Partial<ChannelFormValues> | null;
	loading?: boolean;
	onCancel: () => void;
	onSubmit: (values: ChannelFormValues) => Promise<void> | void;
};

export function ChannelFormModal({
	open,
	title,
	okText = "保存",
	initialValues,
	loading,
	onCancel,
	onSubmit,
}: Props) {
	const [form] = Form.useForm<ChannelFormValues>();

	// Key-Value Editor 使用 pairs 作为受控状态更稳（避免直接在 Form 内放 object）
	const initialMetaPairs = useMemo(
		() => objectToKVPairs(initialValues?.meta ?? {}),
		[initialValues?.meta]
	);

	useEffect(() => {
		if (!open) return;
		form.resetFields();
		form.setFieldsValue({
			code: initialValues?.code ?? "",
			name: initialValues?.name ?? "",
			metric: initialValues?.metric ?? "",
			unit: initialValues?.unit ?? "",
			role: initialValues?.role ?? "",
			display_name: initialValues?.display_name ?? "",
			is_active: initialValues?.is_active ?? true,
			// meta 不直接 set 进 Form，交给 KeyValueEditor（见下方 Form.Item）
		});
	}, [open, initialValues, form]);

	return (
		<Modal
			open={open}
			title={title}
			okText={okText}
			confirmLoading={loading}
			onCancel={onCancel}
			onOk={() => form.submit()}
			destroyOnClose
		>
			<Form
				form={form}          // ✅ 关键：绑定 form
				layout="vertical"
				onFinish={(values) => {
					// 从隐藏字段里拿 metaPairs，转成 object
					const metaPairs = form.getFieldValue(["__metaPairs"]) ?? [];
					const metaObj = emptyObjectToUndefined(kvPairsToObject(metaPairs));

					return onSubmit({
						...values,
						meta: metaObj,
					});
				}}
			>
				<Form.Item name="code" label="Code" rules={[{ required: true, message: "请输入 code" }]}>
					<Input />
				</Form.Item>

				<Form.Item name="name" label="Name">
					<Input />
				</Form.Item>

				<Form.Item name="metric" label="Metric">
					<Input />
				</Form.Item>

				<Form.Item name="unit" label="Unit">
					<Input />
				</Form.Item>

				<Form.Item name="role" label="Role">
					<Input />
				</Form.Item>

				<Form.Item name="display_name" label="Display Name">
					<Input />
				</Form.Item>

				<Form.Item name="is_active" label="Active" valuePropName="checked">
					<Switch />
				</Form.Item>

				{/* metaPairs 用隐藏字段承载，KeyValueEditor 直接写入这个字段 */}
				<Form.Item
					name="__metaPairs"
					label="Meta"
					initialValue={initialMetaPairs}
					valuePropName="value"
					getValueFromEvent={(v) => v}
				>
					<KeyValueEditor />
				</Form.Item>
			</Form>
		</Modal>
	);
}