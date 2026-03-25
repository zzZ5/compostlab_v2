"use client";

import { useEffect } from "react";
import { Alert, Form, Input, Modal, Select, Space, Switch, Tag, Typography } from "antd";

import KeyValueEditor from "@/components/KeyValueEditor";

const { Text } = Typography;

type DeviceProfile = "cp500-v3" | "smart-compost" | "mmcgs" | "generic";

function isDeviceProfile(value: string | undefined): value is DeviceProfile {
	return value === "cp500-v3" || value === "smart-compost" || value === "mmcgs" || value === "generic";
}

function inferDeviceProfile(values: { code?: string; name?: string; meta?: Record<string, any>; device_type?: string }): DeviceProfile {
	if (isDeviceProfile(values.device_type)) return values.device_type;
	const text = `${values.code || ""} ${values.name || ""} ${values.meta?.profile || ""} ${values.meta?.model || ""} ${values.meta?.device_type || ""}`.toLowerCase();
	if (text.includes("mmcgs")) return "mmcgs";
	if (text.includes("cp500")) return "cp500-v3";
	if (text.includes("smartcompost") || text.includes("smart-compost")) return "smart-compost";
	return "generic";
}

function getProfileLabel(profile: DeviceProfile): string {
	switch (profile) {
		case "cp500-v3":
			return "CP500 控制器";
		case "smart-compost":
			return "Smart Compost";
		case "mmcgs":
			return "MMCGS";
		default:
			return "通用设备";
	}
}

function getProfileColor(profile: DeviceProfile): string {
	switch (profile) {
		case "cp500-v3":
			return "blue";
		case "smart-compost":
			return "green";
		case "mmcgs":
			return "purple";
		default:
			return "default";
	}
}

function getMmcgsControllerCode(code?: string): string {
	if (!code) return "";
	return String(code).replace(/-P\d+$/i, "");
}

function getMmcgsPointIndex(code?: string): number | null {
	if (!code) return null;
	const match = String(code).match(/-P(\d+)$/i);
	return match ? Number(match[1]) : null;
}

function buildAutoMeta(values: { code?: string; name?: string; meta?: Record<string, any>; device_type?: string }) {
	const code = String(values.code || "").trim();
	const profile = inferDeviceProfile(values);
	const meta = { ...(values.meta || {}) };

	meta.profile = profile;
	meta.device_type = profile;

	if (profile === "mmcgs") {
		const pointIndex = getMmcgsPointIndex(code);
		const controllerCode = getMmcgsControllerCode(code);
		meta.parent_device_code = controllerCode;
		if (pointIndex !== null) {
			meta.point_index = pointIndex;
			meta.device_kind = "mmcgs_point";
		} else {
			meta.device_kind = "mmcgs_controller";
		}
	}

	return meta;
}

export type DeviceFormValues = {
	code: string;
	name: string;
	device_type?: DeviceProfile;
	post_topic?: string | null;
	response_topic?: string | null;
	note?: string;
	is_active: boolean;
	meta?: Record<string, any>;
};

type Props = {
	open: boolean;
	title: string;
	okText?: string;
	initialValues?: Partial<DeviceFormValues>;
	confirmLoading?: boolean;
	onCancel: () => void;
	onSubmit: (values: DeviceFormValues) => Promise<void> | void;
};

export default function DeviceFormModal(props: Props) {
	const { open, title, okText, initialValues, confirmLoading, onCancel, onSubmit } = props;
	const [form] = Form.useForm<DeviceFormValues>();
	const watchedCode = Form.useWatch("code", form);
	const watchedName = Form.useWatch("name", form);
	const watchedDeviceType = Form.useWatch("device_type", form);
	const watchedMeta = Form.useWatch("meta", form);
	const inferredProfile = inferDeviceProfile({ code: watchedCode, name: watchedName, meta: watchedMeta, device_type: watchedDeviceType });
	const autoMeta = buildAutoMeta({ code: watchedCode, name: watchedName, meta: watchedMeta, device_type: watchedDeviceType });

	useEffect(() => {
		if (!open) return;
		form.resetFields();
		form.setFieldsValue({
			code: "",
			name: "",
			device_type: undefined,
			post_topic: "",
			response_topic: "",
			note: "",
			is_active: true,
			meta: {},
			...(initialValues || {}),
		});
	}, [open, initialValues, form]);

	async function handleOk() {
		const v = await form.validateFields();
		const values: any = {
			...v,
			code: String(v.code || "").trim(),
			name: String(v.name || "").trim(),
			note: String(v.note || ""),
			is_active: !!v.is_active,
			meta: buildAutoMeta(v),
		};
		// topic 为空则不发送，后端会使用默认格式
		if (v.post_topic && v.post_topic.trim()) {
			values.post_topic = v.post_topic.trim();
		}
		if (v.response_topic && v.response_topic.trim()) {
			values.response_topic = v.response_topic.trim();
		}
		await onSubmit(values);
	}

	return (
		<Modal
			open={open}
			title={title}
			okText={okText || "保存"}
			confirmLoading={confirmLoading}
			onCancel={onCancel}
			onOk={handleOk}
			destroyOnHidden
		>
			<Form form={form} layout="vertical">
				<Form.Item
					name="code"
					label="code"
					rules={[{ required: true, message: "请输入设备 code" }]}
				>
					<Input placeholder="例如 KgSERnY2Zn" />
				</Form.Item>

				<Form.Item
					name="name"
					label="name"
					rules={[{ required: true, message: "请输入设备名称" }]}
				>
					<Input placeholder="例如 CP500 #1" />
				</Form.Item>

				<Form.Item name="device_type" label="设备类型">
					<Select
						allowClear
						placeholder="默认按 code / name 自动识别"
						options={[
							{ value: "cp500-v3", label: "CP500 控制器" },
							{ value: "smart-compost", label: "Smart Compost" },
							{ value: "mmcgs", label: "MMCGS" },
							{ value: "generic", label: "通用设备" },
						]}
					/>
				</Form.Item>

				<Alert
					type="info"
					showIcon
					message={
						<Space wrap>
							<Text>自动识别设备类型：</Text>
							<Tag color={getProfileColor(inferredProfile)}>{getProfileLabel(inferredProfile)}</Tag>
						</Space>
					}
					description={
						<Space direction="vertical" size={2}>
							<Text type="secondary">提交时会自动补充到 `meta.profile` 和 `meta.device_type`。</Text>
							{inferredProfile === "mmcgs" ? (
								<Text type="secondary">
									{getMmcgsPointIndex(String(watchedCode || "")) !== null
										? `检测到点位设备：parent_device_code=${autoMeta.parent_device_code}，point_index=${autoMeta.point_index}`
										: `检测到控制器设备：parent_device_code=${autoMeta.parent_device_code}`}
								</Text>
							) : null}
						</Space>
					}
					style={{ marginBottom: 16 }}
				/>

				<Form.Item name="post_topic" label="post_topic">
					<Input placeholder="可留空" />
				</Form.Item>

				<Form.Item name="response_topic" label="response_topic">
					<Input placeholder="可留空" />
				</Form.Item>

				<Form.Item name="note" label="note">
					<Input.TextArea rows={3} placeholder="可选" />
				</Form.Item>

				<Form.Item name="is_active" label="is_active" valuePropName="checked">
					<Switch />
				</Form.Item>

				<Form.Item name="meta" label="meta (Key-Value)" trigger="onChange">
					<KeyValueEditor />
				</Form.Item>
			</Form>
		</Modal>
	);
}
