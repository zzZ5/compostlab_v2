"use client";

import { useState } from "react";
import {
    Button,
    Card,
    Form,
    Input,
    Select,
    Modal,
    Space,
    Table,
    Tag,
    Typography,
    message,
    Switch,
    InputNumber,
    Tooltip,
    Alert,
    Divider,
} from "antd";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Page from "@/components/Page";
import { api } from "@/lib/api";

const { Title, Text } = Typography;

const scriptTypeOptions = [
    { value: "threshold", label: "阈值触发" },
    { value: "schedule", label: "定时执行" },
    { value: "hybrid", label: "混合模式" },
    { value: "python", label: "Python脚本" },
];

const operatorOptions = [
    { value: ">", label: ">" },
    { value: ">=", label: ">=" },
    { value: "<", label: "<" },
    { value: "<=", label: "<=" },
    { value: "==", label: "=" },
    { value: "!=", label: "!=" },
];

function ScriptModal({ open, script, devices, onClose, onSubmit, loading }) {
    const [form] = Form.useForm();
    const [scriptType, setScriptType] = useState("threshold");
    const isEdit = !!script;

    return (
        <Modal
            open={open}
            title={isEdit ? "编辑脚本" : "新建脚本"}
            onCancel={onClose}
            onOk={() => form.submit()}
            width={800}
            destroyOnClose
        >
            <Form
                form={form}
                layout="vertical"
                initialValues={isEdit ? {
                    name: script.name,
                    description: script.description,
                    script_type: script.script_type,
                    is_active: script.is_active,
                    priority: script.priority,
                    threshold_config: script.threshold_config || {},
                    schedule_config: script.schedule_config || {},
                    python_code: script.python_code || "",
                    command_template: script.command_template || {},
                    device_ids: script.device_ids || [],
                } : {
                    name: "",
                    description: "",
                    script_type: "threshold",
                    is_active: true,
                    priority: 0,
                    threshold_config: { metric: "temperature", operator: ">=", value: 75 },
                    schedule_config: {},
                    python_code: "",
                    command_template: { commands: [] },
                    device_ids: [],
                }}
                onFinish={(values) => onSubmit({ ...values, script_type })}
            >
                <Form.Item
                    label="脚本名称"
                    name="name"
                    rules={[{ required: true, message: "请输入脚本名称" }]}
                >
                    <Input placeholder="例如：高温自动降温" />
                </Form.Item>

                <Form.Item label="脚本描述" name="description">
                    <Input.TextArea rows={2} placeholder="可选，描述脚本的作用" />
                </Form.Item>

                <Form.Item
                    label="脚本类型"
                    name="script_type"
                    rules={[{ required: true, message: "请选择脚本类型" }]}
                >
                    <Select
                        options={scriptTypeOptions}
                        onChange={(value) => setScriptType(value)}
                    />
                </Form.Item>

                <Form.Item label="是否启用" name="is_active" valuePropName="checked">
                    <Switch />
                </Form.Item>
                <Text type="secondary">禁用后脚本不会自动触发，但仍可手动执行</Text>

                <Form.Item label="优先级" name="priority">
                    <InputNumber min={0} max={100} placeholder="数字越大越优先执行" />
                </Form.Item>
                <Text type="secondary">当多个脚本同时触发时，优先级高的先执行（0-100）</Text>

                <Form.Item label="关联设备" name="device_ids">
                    <Select
                        mode="multiple"
                        placeholder="选择要应用的设备（留空表示应用到所有）"
                        options={devices?.map((d) => ({ value: d.device_id, label: `${d.name || d.code} (${d.device_id})` }))}
                    />
                </Form.Item>
                <Text type="secondary">留空表示应用到所有设备，也可选择特定设备</Text>

                {scriptType === "threshold" && (
                    <>
                        <Title level={5}>阈值配置</Title>
                        <Alert
                            message="阈值触发说明"
                            description="当设备监测的指标达到设定的阈值时，系统会自动执行下方配置的命令模板。例如：温度≥75℃时自动开启降温设备。"
                            type="info"
                            showIcon
                            style={{ marginBottom: 16 }}
                        />
                        <Form.Item label="监控指标" name={["threshold_config", "metric"]}>
                            <Select
                                placeholder="选择要监控的指标"
                                options={[
                                    { value: "temperature", label: "温度" },
                                    { value: "o2", label: "氧气" },
                                    { value: "humidity", label: "湿度" },
                                ]}
                            />
                        </Form.Item>
                        <Space>
                            <Form.Item label="操作符" name={["threshold_config", "operator"]} noStyle>
                                <Select style={{ width: 100 }} options={operatorOptions} />
                            </Form.Item>
                            <Form.Item label="阈值" name={["threshold_config", "value"]} noStyle>
                                <InputNumber style={{ width: 150 }} placeholder="阈值数值" />
                            </Form.Item>
                        </Space>
                    </>
                )}

                {scriptType === "schedule" && (
                    <>
                        <Title level={5}>定时配置</Title>
                        <Alert
                            message="定时执行说明"
                            description="使用 cron 表达式定义脚本执行时间，系统会按照设定的时间周期自动执行命令。"
                            type="info"
                            showIcon
                            style={{ marginBottom: 16 }}
                        />
                        <Form.Item label="Cron表达式" name={["schedule_config", "cron"]}>
                            <Input placeholder="例如：0 9 * * * (每天9点)" />
                        </Form.Item>
                        <Text type="secondary">
                            常用示例：0 9 * * * (每天9点) | 0 0 * * 1 (每周一0点) | 0 */6 * * * (每6小时)
                        </Text>
                    </>
                )}

                {scriptType === "python" && (
                    <>
                        <Title level={5}>Python脚本</Title>
                        <Alert
                            message="Python脚本说明"
                            description="编写自定义 Python 代码实现复杂的控制逻辑。可以使用预定义的函数获取设备数据，并返回要执行的命令列表。"
                            type="info"
                            showIcon
                            style={{ marginBottom: 16 }}
                        />
                        <Form.Item
                            label="脚本代码"
                            name="python_code"
                            rules={[{ required: true, message: "请输入Python代码" }]}
                        >
                            <Input.TextArea
                                rows={10}
                                placeholder={`示例代码：
# 获取最新温度值
temp = get_latest_value("temperature")

# 根据温度控制设备
if temp > 75:
    commands = [{"command": "pump", "action": "on"}]
elif temp < 60:
    commands = [{"command": "pump", "action": "off"}]
else:
    commands = []`}
                                style={{ fontFamily: "monospace" }}
                            />
                        </Form.Item>
                        <Text type="secondary">
                            可用函数：get_latest_value(metric) - 获取指定指标的最新值<br />
                            可用变量：device (当前设备信息)、datetime (日期时间)、timedelta (时间差)<br />
                            必须返回：commands 变量（命令列表，格式：[{"command": "pump", "action": "on"}]）
                        </Text>
                    </>
                )}

                <Title level={5}>命令模板</Title>
                <Alert
                    message="命令模板说明"
                    description="定义当脚本触发时要发送给设备的控制命令。使用 JSON 格式配置，支持多个命令组合。"
                    type="info"
                    showIcon
                    style={{ marginBottom: 16 }}
                />
                <Form.Item label="命令JSON" name="command_template">
                    <Input.TextArea
                        rows={5}
                        placeholder={`示例：开启水泵
{"commands": [{"command": "pump", "action": "on"}]}

示例：组合控制
{"commands": [{"command": "pump", "action": "on"}, {"command": "fan", "action": "on"}]}`}
                        style={{ fontFamily: "monospace" }}
                    />
                </Form.Item>
            </Form>
        </Modal>
    );
}

export default function ScriptsPage() {
    const queryClient = useQueryClient();
    const [modalOpen, setModalOpen] = useState(false);
    const [editingScript, setEditingScript] = useState(null);

    const scriptsQ = useQuery({
        queryKey: ["scripts"],
        queryFn: async () => {
            const res = await api.get("/scripts");
            return res.data;
        },
    });

    const devicesQ = useQuery({
        queryKey: ["devices"],
        queryFn: async () => {
            const res = await api.get("/devices");
            return res.data;
        },
    });

    const createScript = useMutation({
        mutationFn: async (data: any) => {
            return await api.post("/scripts", data);
        },
        onSuccess: () => {
            message.success("脚本创建成功");
            setModalOpen(false);
            queryClient.invalidateQueries({ queryKey: ["scripts"] });
        },
        onError: (err: any) => {
            message.error(err?.response?.data?.detail || "创建失败");
        },
    });

    const updateScript = useMutation({
        mutationFn: async (data: any) => {
            return await api.patch(`/scripts/${editingScript.id}`, data);
        },
        onSuccess: () => {
            message.success("脚本更新成功");
            setModalOpen(false);
            setEditingScript(null);
            queryClient.invalidateQueries({ queryKey: ["scripts"] });
        },
        onError: (err: any) => {
            message.error(err?.response?.data?.detail || "更新失败");
        },
    });

    const deleteScript = useMutation({
        mutationFn: async (scriptId: number) => {
            return await api.delete(`/scripts/${scriptId}`);
        },
        onSuccess: () => {
            message.success("脚本删除成功");
            queryClient.invalidateQueries({ queryKey: ["scripts"] });
        },
        onError: (err: any) => {
            message.error(err?.response?.data?.detail || "删除失败");
        },
    });

    const executeScript = useMutation({
        mutationFn: async ({ scriptId, deviceIds }: { scriptId: number; deviceIds?: number[] }) => {
            return await api.post(`/scripts/${scriptId}/executions`, { device_ids });
        },
        onSuccess: () => {
            message.success("脚本执行成功");
            queryClient.invalidateQueries({ queryKey: ["scripts"] });
        },
        onError: (err: any) => {
            message.error(err?.response?.data?.detail || "执行失败");
        },
    });

    function openCreateModal() {
        setEditingScript(null);
        setModalOpen(true);
    }

    function openEditModal(script: any) {
        setEditingScript(script);
        setModalOpen(true);
    }

    return (
        <Page
            title="控制脚本"
            extra={<Button type="primary" onClick={openCreateModal}>新建脚本</Button>}
        >
            <Card style={{ marginBottom: 16 }}>
                <Alert
                    message="脚本说明"
                    description={
                        <div style={{ marginTop: 8 }}>
                            <p style={{ marginBottom: 8, fontWeight: 500 }}>脚本类型说明：</p>
                            <div style={{ display: 'grid', gap: 8 }}>
                                <div>
                                    <Tag color="blue">阈值触发</Tag>
                                    <Text style={{ marginLeft: 8 }}>当设备监测数据（如温度、氧气、湿度）达到设定阈值时自动执行控制命令</Text>
                                </div>
                                <div>
                                    <Tag color="green">定时执行</Tag>
                                    <Text style={{ marginLeft: 8 }}>按照 cron 表达式设定的时间定期执行控制命令（如每天 9 点自动开启设备）</Text>
                                </div>
                                <div>
                                    <Tag color="orange">混合模式</Tag>
                                    <Text style={{ marginLeft: 8 }}>结合阈值触发和定时执行，灵活控制设备</Text>
                                </div>
                                <div>
                                    <Tag color="purple">Python脚本</Tag>
                                    <Text style={{ marginLeft: 8 }}>编写自定义 Python 代码实现复杂的控制逻辑</Text>
                                </div>
                            </div>
                            <Divider style={{ margin: '12px 0' }} />
                            <p style={{ marginBottom: 8, fontWeight: 500 }}>使用建议：</p>
                            <ul style={{ marginLeft: 20, marginBottom: 0 }}>
                                <li>优先级：数字越大越优先执行，用于解决多个脚本同时触发时的执行顺序</li>
                                <li>关联设备：留空表示脚本应用到所有设备，也可以指定特定设备</li>
                                <li>命令模板：使用 JSON 格式定义要发送给设备的控制命令</li>
                                <li>执行历史：可以在执行记录中查看脚本的执行情况和结果</li>
                            </ul>
                        </div>
                    }
                    type="info"
                    showIcon
                />
            </Card>

            <Card>
                <Table
                    loading={scriptsQ.isLoading}
                    dataSource={scriptsQ.data?.data || []}
                    rowKey="id"
                    pagination={{ pageSize: 20 }}
                    columns={[
                        {
                            title: "ID",
                            dataIndex: "id",
                            width: 80,
                        },
                        {
                            title: "名称",
                            dataIndex: "name",
                            width: 150,
                        },
                        {
                            title: "描述",
                            dataIndex: "description",
                            width: 200,
                            render: (v) => v || "-",
                        },
                        {
                            title: "类型",
                            dataIndex: "script_type_display",
                            width: 120,
                            render: (v, r) => (
                                <Tag color={r.script_type === "threshold" ? "blue" : r.script_type === "python" ? "purple" : "green"}>
                                    {v}
                                </Tag>
                            ),
                        },
                        {
                            title: "状态",
                            dataIndex: "is_active",
                            width: 80,
                            render: (v) => (
                                <Tag color={v ? "green" : "red"}>{v ? "启用" : "禁用"}</Tag>
                            ),
                        },
                        {
                            title: "优先级",
                            dataIndex: "priority",
                            width: 80,
                        },
                        {
                            title: "操作",
                            key: "actions",
                            width: 250,
                            render: (_, record) => (
                                <Space size="small">
                                    <Tooltip title="执行脚本">
                                        <Button
                                            size="small"
                                            type="primary"
                                            disabled={!record.is_active}
                                            onClick={() => executeScript.mutate({ scriptId: record.id })}
                                            loading={executeScript.isPending}
                                        >
                                            执行
                                        </Button>
                                    </Tooltip>
                                    <Button
                                        size="small"
                                        onClick={() => openEditModal(record)}
                                    >
                                        编辑
                                    </Button>
                                    <Button
                                        size="small"
                                        danger
                                        onClick={() => deleteScript.mutate(record.id)}
                                        loading={deleteScript.isPending}
                                    >
                                        删除
                                    </Button>
                                </Space>
                            ),
                        },
                    ]}
                />
            </Card>

            <ScriptModal
                open={modalOpen}
                script={editingScript}
                devices={devicesQ.data?.data}
                onClose={() => {
                    setModalOpen(false);
                    setEditingScript(null);
                }}
                onSubmit={(values) => {
                    if (editingScript) {
                        updateScript.mutate(values);
                    } else {
                        createScript.mutate(values);
                    }
                }}
                loading={createScript.isPending || updateScript.isPending}
            />
        </Page>
    );
}
