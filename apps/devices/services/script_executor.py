"""
控制脚本执行引擎
支持阈值触发、定时执行、Python脚本等多种控制模式
"""
import json
import logging
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta
from django.utils import timezone
from django.db.models import Q

from apps.devices.models import Device, ScriptTemplate, ScriptExecution
from apps.devices.services.mqtt_pub import publish_json, MqttPublishError
from apps.telemetry.models import TelemetryKV

logger = logging.getLogger(__name__)


def _cron_field_matches(field: str, value: int) -> bool:
    field = (field or "").strip()
    if not field or field == "*":
        return True

    for part in field.split(","):
        token = part.strip()
        if not token:
            continue

        if token == "*":
            return True

        if "/" in token:
            base, step_text = token.split("/", 1)
            try:
                step = int(step_text)
            except ValueError:
                continue
            if step <= 0:
                continue
            if base in ("", "*"):
                if value % step == 0:
                    return True
                continue
            if "-" in base:
                try:
                    start_text, end_text = base.split("-", 1)
                    start = int(start_text)
                    end = int(end_text)
                except ValueError:
                    continue
                if start <= value <= end and (value - start) % step == 0:
                    return True
                continue
            try:
                start = int(base)
            except ValueError:
                continue
            if value >= start and (value - start) % step == 0:
                return True
            continue

        if "-" in token:
            try:
                start_text, end_text = token.split("-", 1)
                start = int(start_text)
                end = int(end_text)
            except ValueError:
                continue
            if start <= value <= end:
                return True
            continue

        try:
            if int(token) == value:
                return True
        except ValueError:
            continue

    return False


def _cron_matches_now(expr: str, dt: datetime) -> bool:
    parts = [part.strip() for part in str(expr or "").split() if part.strip()]
    if len(parts) == 5:
        minute, hour, day, month, weekday = parts
        return (
            _cron_field_matches(minute, dt.minute)
            and _cron_field_matches(hour, dt.hour)
            and _cron_field_matches(day, dt.day)
            and _cron_field_matches(month, dt.month)
            and _cron_field_matches(weekday, (dt.weekday() + 1) % 7)
        )

    if len(parts) == 6:
        second, minute, hour, day, month, weekday = parts
        return (
            _cron_field_matches(second, dt.second)
            and _cron_field_matches(minute, dt.minute)
            and _cron_field_matches(hour, dt.hour)
            and _cron_field_matches(day, dt.day)
            and _cron_field_matches(month, dt.month)
            and _cron_field_matches(weekday, (dt.weekday() + 1) % 7)
        )

    return False


class ScriptExecutor:
    """脚本执行引擎"""

    def __init__(self):
        self.result_cache = {}

    def _resolve_source_device(self, script: ScriptTemplate, fallback_device: Device) -> Device:
        source_device_id = None
        if isinstance(script.threshold_config, dict):
            source_device_id = script.threshold_config.get("source_device_id")
        if not source_device_id and isinstance(script.schedule_config, dict):
            source_device_id = script.schedule_config.get("source_device_id")

        if isinstance(source_device_id, int):
            return Device.objects.filter(id=source_device_id, is_active=True).first() or fallback_device
        return fallback_device

    def _resolve_target_device(self, script: ScriptTemplate, fallback_device: Device) -> Device:
        target_device_id = None
        if isinstance(script.command_template, dict):
            target_device_id = script.command_template.get("target_device_id")

        if isinstance(target_device_id, int):
            return Device.objects.filter(id=target_device_id, is_active=True).first() or fallback_device
        return fallback_device

    def execute_script(
        self,
        script: ScriptTemplate,
        device: Device,
        trigger_reason: str = "manual",
        scheduled_at: Optional[datetime] = None,
        created_by=None
    ) -> ScriptExecution:
        """
        执行脚本并返回执行记录
        """
        source_device = self._resolve_source_device(script, device)
        target_device = self._resolve_target_device(script, device)

        # 创建执行记录
        execution = ScriptExecution.objects.create(
            script=script,
            device=target_device,
            status=ScriptExecution.Status.RUNNING,
            trigger_reason=trigger_reason,
            scheduled_at=scheduled_at,
            started_at=timezone.now(),
            created_by=created_by
        )

        try:
            # 根据脚本类型选择执行方式
            if script.script_type == ScriptTemplate.ScriptType.THRESHOLD:
                commands = self._execute_threshold_script(script, source_device)
            elif script.script_type == ScriptTemplate.ScriptType.SCHEDULE:
                commands = self._execute_schedule_script(script)
            elif script.script_type == ScriptTemplate.ScriptType.PYTHON:
                commands = self._execute_python_script(script, source_device)
            else:
                # 混合模式：先执行阈值检查，满足条件则执行
                commands = self._execute_hybrid_script(script, source_device)

            if commands:
                # 下发命令到设备
                success, result = self._send_commands(target_device, commands)
                execution.commands = commands
                execution.result = {
                    **result,
                    "source_device": source_device.code,
                    "target_device": target_device.code,
                }
                execution.status = ScriptExecution.Status.SUCCESS if success else ScriptExecution.Status.FAILED
            else:
                execution.status = ScriptExecution.Status.SKIPPED
                execution.result = {
                    "message": "No commands generated",
                    "source_device": source_device.code,
                    "target_device": target_device.code,
                }

            execution.completed_at = timezone.now()
            execution.save()

            return execution

        except Exception as e:
            logger.error(f"Script execution failed: {e}", exc_info=True)
            execution.status = ScriptExecution.Status.FAILED
            execution.error_message = str(e)
            execution.completed_at = timezone.now()
            execution.save()
            return execution

    def _execute_threshold_script(
        self, script: ScriptTemplate, device: Device
    ) -> List[Dict[str, Any]]:
        """
        执行阈值触发脚本
        根据当前数据判断是否满足阈值条件
        """
        config = script.threshold_config
        metric = config.get("metric")
        channel_code = config.get("channel_code")
        operator = config.get("operator")  # >, >=, <, <=, ==, !=
        threshold_value = config.get("value")

        if not all([metric, operator, threshold_value is not None]):
            logger.warning(f"Invalid threshold config for script {script.name}")
            return []

        # 获取设备的最新数据
        latest_value = self._get_latest_metric_value(device, metric, channel_code)

        if latest_value is None:
            logger.warning(f"No data found for metric {metric} on device {device.code}")
            return []

        # 检查是否满足阈值条件
        should_execute = self._check_threshold(latest_value, operator, threshold_value)

        if should_execute:
            logger.info(
                f"Threshold triggered for {device.code}: {metric}={latest_value} {operator} {threshold_value}"
            )
            return script.command_template.get("commands", [])
        else:
            return []

    def _execute_schedule_script(
        self, script: ScriptTemplate
    ) -> List[Dict[str, Any]]:
        """
        执行定时脚本
        直接返回预定义的命令
        """
        config = script.schedule_config
        return script.command_template.get("commands", [])

    def _execute_python_script(
        self, script: ScriptTemplate, device: Device
    ) -> List[Dict[str, Any]]:
        """
        执行Python脚本
        在安全沙箱环境中执行Python代码
        """
        if not script.python_code:
            return []

        try:
            # 准备执行环境
            exec_globals = {
                "__builtins__": {
                    "print": print,
                    "len": len,
                    "range": range,
                    "int": int,
                    "float": float,
                    "str": str,
                    "list": list,
                    "dict": dict,
                    "True": True,
                    "False": False,
                    "None": None,
                },
                "get_latest_value": lambda metric, channel_code=None: self._get_latest_metric_value(device, metric, channel_code),
                "get_latest_channel_value": lambda channel_code: self._get_latest_channel_value(device, channel_code),
                "device": device,
                "datetime": datetime,
                "timedelta": timedelta,
            }

            # 执行脚本
            exec_result = {}
            exec(script.python_code, exec_globals, exec_result)

            # 检查脚本是否定义了 commands 变量
            if "commands" in exec_result:
                return exec_result["commands"]
            else:
                logger.warning(f"Python script {script.name} did not return 'commands'")
                return []

        except Exception as e:
            logger.error(f"Python script execution failed: {e}", exc_info=True)
            raise Exception(f"Python script error: {str(e)}")

    def _execute_hybrid_script(
        self, script: ScriptTemplate, device: Device
    ) -> List[Dict[str, Any]]:
        """
        执行混合模式脚本
        先检查阈值条件，满足则执行命令
        """
        # 先执行阈值检查
        commands = self._execute_threshold_script(script, device)

        if commands:
            logger.info(f"Hybrid script {script.name} triggered by threshold")
            return commands
        else:
            # 检查定时条件（简化版：只检查是否到达执行时间）
            schedule_config = script.schedule_config
            if schedule_config:
                # 这里可以集成 APScheduler 等定时任务
                # 简化实现：直接返回命令，由外部调度器决定何时执行
                logger.info(f"Hybrid script {script.name} using schedule config")
                return script.command_template.get("commands", [])

            return []

    def _get_latest_metric_value(
        self, device: Device, metric: str, channel_code: Optional[str] = None
    ) -> Optional[float]:
        """
        ???????????????????
        """
        try:
            if channel_code:
                return self._get_latest_channel_value(device, channel_code)

            channel = device.channels.filter(
                metric__iexact=metric
            ).first()

            if not channel:
                return None

            latest = TelemetryKV.objects.filter(
                device=device,
                code=channel.code
            ).order_by("-ts").first()

            if latest:
                return float(latest.value)
            return None

        except Exception as e:
            logger.error(f"Failed to get latest value: {e}")
            return None

    def _get_latest_channel_value(
        self, device: Device, channel_code: str
    ) -> Optional[float]:
        try:
            code = str(channel_code or "").strip()
            if not code:
                return None

            channel = device.channels.filter(code__iexact=code).first()
            if not channel:
                return None

            latest = TelemetryKV.objects.filter(
                device=device,
                code=channel.code
            ).order_by("-ts").first()

            if latest:
                return float(latest.value)
            return None

        except Exception as e:
            logger.error(f"Failed to get latest channel value: {e}")
            return None

    def _check_threshold(
        self, value: float, operator: str, threshold: float
    ) -> bool:
        """检查值是否满足阈值条件"""
        try:
            if operator == ">":
                return value > threshold
            elif operator == ">=":
                return value >= threshold
            elif operator == "<":
                return value < threshold
            elif operator == "<=":
                return value <= threshold
            elif operator == "==":
                return value == threshold
            elif operator == "!=":
                return value != threshold
            else:
                return False
        except Exception:
            return False

    def _send_commands(
        self, device: Device, commands: List[Dict[str, Any]]
    ) -> tuple[bool, Dict[str, Any]]:
        """
        发送命令到设备
        返回 (success, result)
        """
        if not commands or not device.response_topic:
            return False, {"detail": "No commands or topic"}

        payload = {
            "device": device.code,
            "commands": commands,
            "server_ts": timezone.now().strftime("%Y-%m-%d %H:%M:%S"),
        }

        try:
            publish_json(device.response_topic, payload, qos=1, retain=False)
            return True, {
                "mqtt": "published",
                "topic": device.response_topic,
                "command_count": len(commands)
            }
        except MqttPublishError as e:
            return False, {"detail": str(e)}
        except Exception as e:
            return False, {"detail": f"Unexpected: {str(e)}"}


class ThresholdMonitor:
    """阈值监控器，定时检查所有启用的阈值脚本"""

    def __init__(self):
        self.executor = ScriptExecutor()

    def check_and_execute_all(self) -> Dict[str, Any]:
        """
        检查所有启用的阈值脚本并执行
        返回执行统计
        """
        # 获取所有启用且未运行的阈值脚本
        scripts = ScriptTemplate.objects.filter(
            is_active=True,
            script_type__in=[
                ScriptTemplate.ScriptType.THRESHOLD,
                ScriptTemplate.ScriptType.HYBRID,
            ]
        ).prefetch_related('devices')

        results = {
            "checked": 0,
            "executed": 0,
            "skipped": 0,
            "failed": 0
        }

        for script in scripts:
            results["checked"] += 1

            # 检查是否正在运行（防止重复执行）
            running = ScriptExecution.objects.filter(
                script=script,
                status=ScriptExecution.Status.RUNNING,
                created_at__gte=timezone.now() - timedelta(minutes=5)
            ).exists()

            if running:
                continue

            # 对每个关联的设备执行脚本
            devices = script.devices.filter(is_active=True)
            if not devices.exists() and script.run:
                # 如果没有指定设备但有run，使用run的所有设备
                devices = Device.objects.filter(
                    runwindow__run=script.run,
                    is_active=True
                ).distinct()

            for device in devices:
                try:
                    execution = self.executor.execute_script(
                        script,
                        device,
                        trigger_reason="threshold_check",
                        scheduled_at=None
                    )

                    if execution.status == ScriptExecution.Status.SUCCESS:
                        results["executed"] += 1
                    elif execution.status == ScriptExecution.Status.SKIPPED:
                        results["skipped"] += 1
                    else:
                        results["failed"] += 1

                except Exception as e:
                    logger.error(f"Failed to execute script {script.name} on device {device.code}: {e}")
                    results["failed"] += 1

        return results


class ScheduleMonitor:
    """定时控制检查器，按 cron 表达式触发 schedule / hybrid 脚本。"""

    def __init__(self):
        self.executor = ScriptExecutor()

    def check_and_execute_all(self, now: Optional[datetime] = None) -> Dict[str, Any]:
        check_time = now or timezone.localtime()
        scheduled_at = check_time.replace(second=0, microsecond=0)

        scripts = ScriptTemplate.objects.filter(
            is_active=True,
            script_type__in=[
                ScriptTemplate.ScriptType.SCHEDULE,
                ScriptTemplate.ScriptType.HYBRID,
            ],
        ).prefetch_related("devices")

        results = {
            "checked": 0,
            "matched": 0,
            "executed": 0,
            "skipped": 0,
            "failed": 0,
        }

        for script in scripts:
            results["checked"] += 1
            schedule_config = script.schedule_config or {}
            cron = str(schedule_config.get("cron", "")).strip()
            if not cron or not _cron_matches_now(cron, check_time):
                continue

            results["matched"] += 1

            already_executed = ScriptExecution.objects.filter(
                script=script,
                trigger_reason="schedule_check",
                scheduled_at=scheduled_at,
            ).exists()
            if already_executed:
                results["skipped"] += 1
                continue

            running = ScriptExecution.objects.filter(
                script=script,
                status=ScriptExecution.Status.RUNNING,
                created_at__gte=timezone.now() - timedelta(minutes=5),
            ).exists()
            if running:
                results["skipped"] += 1
                continue

            devices = script.devices.filter(is_active=True)
            if not devices.exists() and script.run:
                devices = Device.objects.filter(runwindow__run=script.run, is_active=True).distinct()

            if not devices.exists():
                results["skipped"] += 1
                continue

            for device in devices:
                try:
                    execution = self.executor.execute_script(
                        script,
                        device,
                        trigger_reason="schedule_check",
                        scheduled_at=scheduled_at,
                    )
                    if execution.status == ScriptExecution.Status.SUCCESS:
                        results["executed"] += 1
                    elif execution.status == ScriptExecution.Status.SKIPPED:
                        results["skipped"] += 1
                    else:
                        results["failed"] += 1
                except Exception as exc:
                    logger.error(f"Failed to execute scheduled script {script.name} on device {device.code}: {exc}")
                    results["failed"] += 1

        return results
