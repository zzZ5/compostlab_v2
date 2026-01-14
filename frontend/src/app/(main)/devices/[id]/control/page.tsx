"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button, Card, Collapse, Form, Input, InputNumber, Modal, Space, Table, Tag, Tabs, Typography, message } from "antd";
import { useSendDeviceCommand } from "@/features/devices/mutations";
import { useDeviceCommands, useDevicesTree } from "@/features/devices/queries";

const { Title, Text } = Typography;
const { TextArea } = Input;

function statusTag(status: string) {
	const color =
		status === "sent" ? "blue" :
			status === "acked" ? "green" :
				status === "failed" ? "red" :
					"default";
	return <Tag color={color}>{status}</Tag>;
}

export default function DeviceControlPage() {
	const params = useParams();
	const router = useRouter();
	const deviceId = Number(params?.id);

	const [configModalOpen, setConfigModalOpen] = useState(false);
	const [configJson, setConfigJson] = useState<string>("");

	// 获取设备信息（包含 configuration）
	const devicesQ = useDevicesTree(true);
	const device = useMemo(() => {
		return devicesQ.data?.find((d: any) => d.device_id === deviceId) || null;
	}, [devicesQ.data, deviceId]);

	const sendMut = useSendDeviceCommand(deviceId);
	const cmdQ = useDeviceCommands(deviceId, 50);

	const send = async (commands: any[]) => {
		try {
			await sendMut.mutateAsync({ commands });
			message.success("命令已下发（已发布到 MQTT）");
		} catch (e: any) {
			message.error(`下发失败：${e?.message || String(e)}`);
		}
	};

	// 打开配置编辑器
	const openConfigEditor = () => {
		const currentConfig = device?.configuration || {};
		setConfigJson(JSON.stringify(currentConfig, null, 2));
		setConfigModalOpen(true);
	};

	// 验证并应用配置
	const applyConfig = () => {
		try {
			const config = JSON.parse(configJson);
			send([{ command: "config_update", config }]);
			setConfigModalOpen(false);
			message.success("配置已下发");
		} catch (e) {
			message.error("JSON 格式错误");
		}
	};

	return (
		<div>
			<Space style={{ marginBottom: 12 }}>
				<Title level={3} style={{ margin: 0 }}>Device Control</Title>
				<Text type="secondary">#{deviceId}</Text>
				{device && (
					<>
						<Tag color="blue">{device.code}</Tag>
						{device.ip_address && <Tag color="green">IP: {device.ip_address}</Tag>}
					</>
				)}
				<Button onClick={() => router.push(`/devices/${deviceId}`)}>返回设备详情</Button>
			</Space>

			<Space orientation="vertical" style={{ width: "100%" }} size={16}>
				{/* 设备信息卡片 */}
				{device && (
					<Card size="small">
						<Tabs
							size="small"
							items={[
								{
									key: "quick",
									label: "快捷控制",
									children: (
										<>
											{/* 快捷控制 */}
											<Card title="快捷控制" style={{ marginBottom: 12 }}>
												<Space wrap>
													<Button
														type="primary"
														loading={sendMut.isPending}
														onClick={() => send([{ command: "pump", action: "on" }])}
													>
														Pump ON
													</Button>
													<Button
														danger
														loading={sendMut.isPending}
														onClick={() => send([{ command: "pump", action: "off" }])}
													>
														Pump OFF
													</Button>
												</Space>
											</Card>

											{/* 快捷配置更新 */}
											<Card title="快捷配置更新">
												<Form
													layout="inline"
													initialValues={{
														post_interval_min: 10,
														read_interval_min: 10,
														pump_run_time_s: 60,
													}}
													onFinish={(v) => {
														const post_interval = Math.round((v.post_interval_min ?? 10) * 60 * 1000);
														const read_interval = Math.round((v.read_interval_min ?? 10) * 60 * 1000);
														const pump_run_time = Math.round((v.pump_run_time_s ?? 60) * 1000);

														return send([
															{
																command: "config_update",
																config: { post_interval, read_interval, pump_run_time },
															},
														]);
													}}
												>
													<Form.Item label="post_interval (min)" name="post_interval_min">
														<InputNumber min={1} max={1440} />
													</Form.Item>
													<Form.Item label="read_interval (min)" name="read_interval_min">
														<InputNumber min={1} max={1440} />
													</Form.Item>
													<Form.Item label="pump_run_time (s)" name="pump_run_time_s">
														<InputNumber min={1} max={3600} />
													</Form.Item>

													<Form.Item>
														<Button type="primary" htmlType="submit" loading={sendMut.isPending}>
															Apply
														</Button>
													</Form.Item>
												</Form>
											</Card>
										</>
									),
								},
								{
									key: "config",
									label: "完整配置",
									children: (
										<>
											{/* 设备注册信息 */}
											<Card title="设备注册信息" style={{ marginBottom: 12 }}>
												<Space direction="vertical" size={8} style={{ width: "100%" }}>
													<Space>
														<Text type="secondary">IP 地址：</Text>
														<Text code>{device.ip_address || "-"}</Text>
													</Space>
													<Space>
														<Text type="secondary">注册时间：</Text>
														<Text>{device.register_at || "-"}</Text>
													</Space>
													<Space>
														<Text type="secondary">最后上线：</Text>
														<Text>{device.last_seen_at || "-"}</Text>
													</Space>
												</Space>
											</Card>

											{/* 当前配置 */}
											<Card
												title="当前配置"
												extra={
													<Button type="primary" onClick={openConfigEditor}>
														编辑配置
													</Button>
												}
											>
												<Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
													当前设备的完整配置。点击"编辑配置"可以修改并下发新的配置到设备。
												</Text>
												<pre style={{
													background: "#f5f5f5",
													padding: 12,
													borderRadius: 4,
													fontSize: 12,
													maxHeight: 400,
													overflow: "auto",
													margin: 0
												}}>
													{device.configuration && Object.keys(device.configuration).length > 0
														? JSON.stringify(device.configuration, null, 2)
														: "// 暂无配置信息"}
												</pre>
											</Card>
										</>
									),
								},
								{
							key: "advanced",
							label: "高级配置",
							children: (
								<>
									<Card title="当前配置结构">
										<Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
											当前设备的配置结构如下。不同设备类型可能有不同的配置字段。
											请根据实际配置进行编辑。
										</Text>
										{device?.configuration && Object.keys(device.configuration).length > 0 ? (
											<Collapse
												size="small"
												items={Object.entries(device.configuration).map(([key, value]) => ({
													key,
													label: (
														<Space>
															<Text strong>{key}</Text>
															<Tag color={typeof value === 'object' && !Array.isArray(value) ? 'blue' : 'default'}>
																{typeof value === 'object' && !Array.isArray(value) ? 'Object' :
																 Array.isArray(value) ? 'Array' : typeof value}
															</Tag>
														</Space>
													),
													children: (
														<pre style={{
															background: "#f5f5f5",
															padding: 8,
															borderRadius: 4,
															fontSize: 11,
															margin: 0,
															maxHeight: 200,
															overflow: "auto"
														}}>
															{JSON.stringify(value, null, 2)}
														</pre>
													),
												}))}
											/>
										) : (
											<Text type="secondary">暂无配置信息</Text>
										)}
									</Card>

									<Card title="快速编辑常用字段" style={{ marginTop: 12 }}>
										{device?.configuration && Object.keys(device.configuration).length > 0 && (
											<Form
												layout="vertical"
												onFinish={(v) => {
													// 只发送表单中填写的字段
													const config: any = {};
													Object.entries(v).forEach(([key, value]) => {
														if (value !== undefined && value !== null && value !== "") {
															// 尝试转换为数字
															const numValue = Number(value);
															if (!isNaN(numValue) && String(value).trim() !== "") {
																config[key] = numValue;
															} else if (value === "true" || value === "false") {
																config[key] = value === "true";
															} else {
																config[key] = value;
															}
														}
													});
													if (Object.keys(config).length > 0) {
														send([{ command: "config_update", config }]);
													} else {
														message.warning("请至少填写一个字段");
													}
												}}
											>
												<Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
													以下是当前配置中的所有字段，可以快速编辑常见配置项。
													只修改需要更新的字段，其他字段会保持不变。
												</Text>
												<Collapse
													size="small"
													items={Object.entries(device.configuration).map(([key, value]) => ({
														key,
														label: key,
														children: (
															<Space direction="vertical" style={{ width: "100%" }}>
																{typeof value === "object" && !Array.isArray(value) ? (
																	// 嵌套对象 - 递归渲染
																	<>
																		<Text type="secondary" style={{ fontSize: 12 }}>
																			{key} 是嵌套对象，请在"完整配置"标签中编辑
																		</Text>
																		<pre style={{
																			background: "#fafafa",
																			padding: 8,
																			fontSize: 11,
																			margin: 0
																		}}>
																			{JSON.stringify(value, null, 2)}
																		</pre>
																	</>
																) : Array.isArray(value) ? (
																	// 数组
																	<>
																		<Text type="secondary" style={{ fontSize: 12 }}>
																			{key} 是数组，请在"完整配置"标签中编辑
																		</Text>
																		<pre style={{
																			background: "#fafafa",
																			padding: 8,
																			fontSize: 11,
																			margin: 0
																		}}>
																			{JSON.stringify(value, null, 2)}
																		</pre>
																	</>
																) : (
																	// 简单值 - 可编辑
																	<Form.Item
																		name={key}
																		label={`${key} (当前: ${value} ${typeof value})`}
																	>
																		{typeof value === "boolean" ? (
																			<select>
																				<option value="">保持不变</option>
																				<option value="true">true</option>
																				<option value="false">false</option>
																			</select>
																		) : typeof value === "number" ? (
																			<InputNumber
																				style={{ width: "100%" }}
																				placeholder={`当前值: ${value}`}
																			/>
																		) : (
																			<Input
																				placeholder={`当前值: ${value}`}
																			/>
																		)}
																	</Form.Item>
																)}
															</Space>
														),
													}))}
												/>
												<Form.Item>
													<Button type="primary" htmlType="submit" loading={sendMut.isPending}>
														应用更改
													</Button>
												</Form.Item>
											</Form>
										)}
									</Card>
								</>
							),
								},
							]}
						/>
					</Card>
				)}

				{/* 命令历史 */}
				<Card title="命令历史（最近 50 条）">
					<Table
						rowKey="command_id"
						loading={cmdQ.isLoading}
						dataSource={cmdQ.data?.data || []}
						pagination={false}
						size="small"
						columns={[
							{ title: "ID", dataIndex: "command_id", width: 80 },
							{ title: "Status", dataIndex: "status", width: 100, render: statusTag },
							{ title: "Command", dataIndex: "command", width: 140, render: (v) => v || "-" },
							{ title: "Created", dataIndex: "created_at", width: 200, render: (v) => v || "-" },
							{ title: "Sent", dataIndex: "sent_at", width: 200, render: (v) => v || "-" },
							{
								title: "Payload",
								dataIndex: "payload",
								render: (v) => (
									<pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
										{JSON.stringify(v, null, 2)}
									</pre>
								),
							},
						]}
					/>
				</Card>
			</Space>

			{/* 配置编辑器 Modal */}
			<Modal
				open={configModalOpen}
				title="编辑设备配置"
				onCancel={() => setConfigModalOpen(false)}
				onOk={applyConfig}
				okText="下发配置"
				cancelText="取消"
				width={700}
			>
				<Space direction="vertical" style={{ width: "100%" }} size={8}>
					<Text type="secondary">
						编辑配置后点击"下发配置"，将通过 MQTT 发送 config_update 命令到设备。
						配置将合并到设备当前配置中，只更新指定的字段。
					</Text>
					<TextArea
						value={configJson}
						onChange={(e) => setConfigJson(e.target.value)}
						rows={20}
						style={{
							fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
							fontSize: 12,
						}}
						placeholder='例如：{ "post_interval": 60000, "read_interval": 120000 }'
					/>
				</Space>
			</Modal>
		</div>
	);
}
