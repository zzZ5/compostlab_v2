"""
MQTT Register Worker: 订阅设备注册主题，处理设备上线注册。

设计原则
----------
1. 监听设备注册主题：compostlab/v2/+/register
2. 提取 device_code 并调用设备注册 API
3. 自动创建设备（如果不存在）并更新 IP 地址和配置信息
4. 与现有的 mqtt_worker 完全独立，互不干扰

Topic 格式
-----------
- 设备注册：compostlab/v2/{device_code}/register
- 设备遥测：compostlab/v2/{device_code}/telemetry（由 mqtt_worker 处理）

Payload 格式
-------------
{
  "schema_version": 2,
  "ip_address": "192.168.1.100",
  "timestamp": "2026-01-14T12:00:00Z",
  "configuration": {
    "sampling_interval": 5,
    "data_retention_days": 30,
    "firmware_version": "1.0.0",
    "hardware_version": "v1.2"
  }
}
"""

import os
import json
import time
import paho.mqtt.client as mqtt
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Subscribe MQTT and handle device registration."

    def handle(self, *args, **options):
        # =============================
        # MQTT 基础连接配置
        # =============================
        host = os.getenv("MQTT_HOST", "118.25.108.254")
        port = int(os.getenv("MQTT_PORT", "1883"))
        user = os.getenv("MQTT_USER", "")
        pwd = os.getenv("MQTT_PASS", "")

        # 订阅设备注册主题
        topic = os.getenv("MQTT_REGISTER_TOPIC", "compostlab/v2/+/register")

        self.stdout.write(
            self.style.SUCCESS(f"[MQTT Register] connect {host}:{port}, sub={topic}")
        )

        # 使用 paho-mqtt v2 API
        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
        if user:
            client.username_pw_set(user, pwd)

        # =============================
        # ReasonCode 兼容处理
        # =============================
        def _rc_to_int(reason) -> int:
            """
            paho-mqtt v2 中 on_connect 的 reasonCode 可能是：
            - int（某些版本/场景）
            - paho.mqtt.reasoncodes.ReasonCode（最常见）
            - str / None（异常场景）
            我们统一转换成 int，转换失败返回 -1。
            """
            if reason is None:
                return -1
            # 已经是 int
            if isinstance(reason, int):
                return reason
            # ReasonCode 对象通常有 value 属性
            v = getattr(reason, "value", None)
            if isinstance(v, int):
                return v
            # 有些实现可以 str() 后解析
            try:
                return int(str(reason))
            except Exception:
                return -1

        # =============================
        # MQTT 回调：连接成功
        # =============================
        def on_connect(c, userdata, flags, reasonCode, properties=None):
            """
            paho-mqtt v2 中：
            - reasonCode.value == 0 表示连接成功
            """
            rc = _rc_to_int(reasonCode)
            if rc == 0:
                self.stdout.write(self.style.SUCCESS("[MQTT Register] connected"))
                c.subscribe(topic, qos=1)
            else:
                # ReasonCode 也可打印名字，便于排查
                name = getattr(reasonCode, "getName", None)
                rc_name = name() if callable(name) else str(reasonCode)
                self.stdout.write(
                    self.style.ERROR(f"[MQTT Register] connect failed rc={rc} ({rc_name})")
                )

        # =============================
        # MQTT 回调：收到消息
        # =============================
        def on_message(c, userdata, msg):
            """
            收到设备注册消息后的处理流程：

            1. 解析 topic 提取 device_code
            2. 验证 payload 格式
            3. 调用 ingest service 处理注册
            """
            try:
                payload = json.loads(msg.payload.decode("utf-8"))
            except Exception:
                self.stdout.write(
                    self.style.WARNING(f"[MQTT Register] invalid JSON, topic={msg.topic}")
                )
                return

            # 提取 device_code
            parts = [p for p in msg.topic.strip().split("/") if p]
            if len(parts) != 4:
                self.stdout.write(
                    self.style.WARNING(f"[MQTT Register] invalid topic format, topic={msg.topic}")
                )
                return

            if parts[0].lower() != "compostlab" or parts[1].lower() != "v2" or parts[3].lower() != "register":
                self.stdout.write(
                    self.style.WARNING(f"[MQTT Register] invalid topic pattern, topic={msg.topic}")
                )
                return

            device_code = parts[2].strip()
            if not device_code:
                self.stdout.write(
                    self.style.WARNING(f"[MQTT Register] empty device_code, topic={msg.topic}")
                )
                return

            # 调用注册服务
            try:
                from apps.devices.services.device_register import register_device_from_payload

                result = register_device_from_payload(
                    device_code=device_code,
                    payload=payload,
                    topic=msg.topic,
                    source="mqtt"
                )

                status = "NEW" if result.get("is_new") else "UPDATED"
                self.stdout.write(
                    f"[REGISTER] device={device_code} status={status} ip={payload.get('ip_address', 'N/A')}"
                )
            except Exception as e:
                self.stdout.write(
                    self.style.ERROR(f"[REGISTER] failed: device={device_code} error={e}")
                )

        # =============================
        # 带重连的 MQTT 主循环
        # =============================
        def loop_forever_with_reconnect():
            """
            断线自动重连，指数退避（最大 60s）
            """
            backoff = 1
            while True:
                try:
                    client.connect(host, port, keepalive=60)
                    client.loop_forever()
                except Exception as e:
                    self.stdout.write(
                        self.style.ERROR(f"[MQTT Register] error: {e}, retry in {backoff}s")
                    )
                    time.sleep(backoff)
                    backoff = min(backoff * 2, 60)

        client.on_connect = on_connect
        client.on_message = on_message
        loop_forever_with_reconnect()
