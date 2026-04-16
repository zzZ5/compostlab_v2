# -*- coding: utf-8 -*-
# docstring removed
import json
import logging
from copy import deepcopy
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta
from django.utils import timezone
from django.db.models import Q

from apps.devices.models import Device, ScriptTemplate, ScriptExecution
from apps.devices.services.mqtt_pub import publish_json, MqttPublishError
from apps.telemetry.models import TelemetryKV

logger = logging.getLogger(__name__)


def _min_auto_check_interval_seconds(script: ScriptTemplate) -> int:
    cfg = script.threshold_config if isinstance(script.threshold_config, dict) else {}
    raw = cfg.get("min_check_interval_seconds")
    if raw is None or raw == "":
        return 0
    try:
        n = int(raw)
    except (TypeError, ValueError):
        return 0
    return max(0, n)


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
    # docstring removed

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

    def _resolve_device_ref(
        self,
        default_device: Device,
        device_id: Optional[int] = None,
        device_code: Optional[str] = None,
    ) -> Device:
        if isinstance(device_id, int):
            return Device.objects.filter(id=device_id, is_active=True).first() or default_device

        code = str(device_code or "").strip()
        if code:
            return Device.objects.filter(code__iexact=code, is_active=True).first() or default_device

        return default_device

    def execute_script(
        self,
        script: ScriptTemplate,
        device: Device,
        trigger_reason: str = "manual",
        scheduled_at: Optional[datetime] = None,
        created_by=None
    ) -> ScriptExecution:
        # docstring removed
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
            action_plan = None
            commands: List[Dict[str, Any]] = []
            allow_else = trigger_reason != "threshold_check"

            if script.script_type == ScriptTemplate.ScriptType.THRESHOLD:
                commands = self._execute_threshold_script(script, source_device, allow_else=allow_else)
            elif script.script_type == ScriptTemplate.ScriptType.SCHEDULE:
                commands = self._execute_schedule_script(script)
            elif script.script_type == ScriptTemplate.ScriptType.PYTHON:
                python_result = self._execute_python_script(script, source_device)
                if isinstance(python_result, dict) and isinstance(python_result.get("actions"), list):
                    action_plan = python_result.get("actions") or []
                else:
                    commands = python_result if isinstance(python_result, list) else []
            else:
                commands = self._execute_hybrid_script(script, source_device, allow_else=allow_else)

            if action_plan:
                success, result, executed_commands = self._send_action_plan(target_device, action_plan)
                execution.commands = executed_commands
                execution.result = {
                    **result,
                    "source_device": source_device.code,
                    "target_device": target_device.code,
                }
                execution.status = ScriptExecution.Status.SUCCESS if success else ScriptExecution.Status.FAILED
            elif commands:
                effective_commands, skipped_config_updates = self._filter_noop_config_updates(target_device, commands)
                if effective_commands:
                    success, result = self._send_commands(target_device, effective_commands)
                    execution.commands = effective_commands
                    execution.result = {
                        **result,
                        "source_device": source_device.code,
                        "target_device": target_device.code,
                        **(
                            {"skipped_commands": skipped_config_updates}
                            if skipped_config_updates
                            else {}
                        ),
                    }
                    execution.status = ScriptExecution.Status.SUCCESS if success else ScriptExecution.Status.FAILED
                else:
                    execution.status = ScriptExecution.Status.SKIPPED
                    execution.result = {
                        "message": "No effective commands generated",
                        "source_device": source_device.code,
                        "target_device": target_device.code,
                        "skipped_commands": skipped_config_updates,
                    }
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
        self, script: ScriptTemplate, device: Device, allow_else: bool = True
    ) -> List[Dict[str, Any]]:
        config = script.threshold_config or {}
        condition_mode = "any" if config.get("condition_mode") == "any" else "all"
        conditions = config.get("conditions") if isinstance(config.get("conditions"), list) else None
        if not conditions:
            conditions = [
                {
                    "metric": config.get("metric"),
                    "channel_code": config.get("channel_code"),
                    "operator": config.get("operator"),
                    "value": config.get("value"),
                }
            ]

        matches: List[bool] = []
        for condition in conditions:
            metric = condition.get("metric")
            channel_code = condition.get("channel_code")
            operator = condition.get("operator")
            threshold_value = condition.get("value")

            if not all([metric, operator, threshold_value is not None]):
                logger.warning(f"Invalid threshold condition for script {script.name}")
                return []

            latest_value = self._get_latest_metric_value(device, metric, channel_code)
            if latest_value is None:
                logger.warning(f"No data found for metric {metric} on device {device.code}")
                matches.append(False)
                continue

            matches.append(self._check_threshold(latest_value, operator, threshold_value))

        if not matches:
            return []

        should_execute = any(matches) if condition_mode == "any" else all(matches)
        if should_execute:
            logger.info(
                "Threshold triggered for %s: %s conditions matched",
                device.code,
                "any" if condition_mode == "any" else "all",
            )
            return script.command_template.get("commands", [])
        if allow_else:
            return script.command_template.get("else_commands", []) or []
        return []

    def _execute_schedule_script(
        self, script: ScriptTemplate
    ) -> List[Dict[str, Any]]:
        return script.command_template.get("commands", [])

    def _execute_python_script(
        self, script: ScriptTemplate, device: Device
    ) -> Any:
        if not script.python_code:
            return []

        try:
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
                "get_latest_value": lambda metric, channel_code=None, device_id=None, device_code=None: self._get_latest_metric_value(
                    self._resolve_device_ref(device, device_id, device_code),
                    metric,
                    channel_code,
                ),
                "get_latest_channel_value": lambda channel_code, device_id=None, device_code=None: self._get_latest_channel_value(
                    self._resolve_device_ref(device, device_id, device_code),
                    channel_code,
                ),
                "device": device,
                "datetime": datetime,
                "timedelta": timedelta,
            }

            exec_result = {}
            exec(script.python_code, exec_globals, exec_result)

            if "actions" in exec_result:
                return {"actions": exec_result["actions"]}
            if "commands" in exec_result:
                return exec_result["commands"]
            logger.warning(f"Python script {script.name} did not return 'commands' or 'actions'")
            return []

        except Exception as e:
            logger.error(f"Python script execution failed: {e}", exc_info=True)
            raise Exception(f"Python script error: {str(e)}")

    def _execute_hybrid_script(
        self, script: ScriptTemplate, device: Device, allow_else: bool = True
    ) -> List[Dict[str, Any]]:
        commands = self._execute_threshold_script(script, device, allow_else=allow_else)
        if commands:
            logger.info(f"Hybrid script {script.name} triggered by threshold")
            return commands

        if script.schedule_config:
            logger.info(f"Hybrid script {script.name} using schedule config")
            return script.command_template.get("commands", [])

        return []

    def _get_latest_metric_value(
        self, device: Device, metric: str, channel_code: Optional[str] = None
    ) -> Optional[float]:
        try:
            if channel_code:
                return self._get_latest_channel_value(device, channel_code)

            channel = device.channels.filter(metric__iexact=metric).first()
            if not channel:
                return None

            latest = TelemetryKV.objects.filter(device=device, code=channel.code).order_by("-ts").first()
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

            latest = TelemetryKV.objects.filter(device=device, code=channel.code).order_by("-ts").first()
            if latest:
                return float(latest.value)
            return None
        except Exception as e:
            logger.error(f"Failed to get latest channel value: {e}")
            return None

    def _check_threshold(
        self, value: float, operator: str, threshold: float
    ) -> bool:
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

    def _merge_config_patch(self, base: Optional[dict], patch: Optional[dict]) -> dict:
        """Merge partial config patch with same semantics as device API."""
        if patch is None:
            return {}
        if not isinstance(base, dict):
            base = {}
        result = deepcopy(base)
        for key, value in patch.items():
            if value is None:
                result.pop(key, None)
                continue
            if isinstance(value, dict) and isinstance(result.get(key), dict):
                result[key] = self._merge_config_patch(result.get(key), value)
                continue
            result[key] = deepcopy(value)
        return result

    def _extract_config_patch(self, command: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        cfg = command.get("config")
        if isinstance(cfg, dict):
            return cfg
        raw_text = command.get("config_text")
        if isinstance(raw_text, str) and raw_text.strip():
            try:
                parsed = json.loads(raw_text)
                if isinstance(parsed, dict):
                    return parsed
            except Exception:
                return None
        return None

    def _filter_noop_config_updates(
        self, device: Device, commands: List[Dict[str, Any]]
    ) -> tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        current_config = getattr(device, "configuration", {}) or {}
        if not isinstance(current_config, dict):
            current_config = {}

        effective_commands: List[Dict[str, Any]] = []
        skipped: List[Dict[str, Any]] = []

        for command in commands:
            if not isinstance(command, dict) or command.get("command") != "config_update":
                effective_commands.append(command)
                continue

            patch = self._extract_config_patch(command)
            if not isinstance(patch, dict):
                effective_commands.append(command)
                continue

            expected_config = self._merge_config_patch(current_config, patch)
            if expected_config == current_config:
                skipped.append(
                    {
                        "command": "config_update",
                        "reason": "no_configuration_change",
                        "config": patch,
                    }
                )
                continue

            effective_commands.append(command)
            current_config = expected_config

        return effective_commands, skipped


    def _send_commands(
        self, device: Device, commands: List[Dict[str, Any]]
    ) -> tuple[bool, Dict[str, Any]]:
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
                "command_count": len(commands),
            }
        except MqttPublishError as e:
            return False, {"detail": str(e)}
        except Exception as e:
            return False, {"detail": f"Unexpected: {str(e)}"}

    def _send_action_plan(
        self,
        default_target_device: Device,
        actions: List[Dict[str, Any]],
    ) -> tuple[bool, Dict[str, Any], List[Dict[str, Any]]]:
        targets_result = []
        executed_commands: List[Dict[str, Any]] = []
        overall_success = True

        for item in actions:
            if not isinstance(item, dict):
                overall_success = False
                targets_result.append({"detail": "Invalid action item"})
                continue

            target_device = self._resolve_device_ref(
                default_target_device,
                item.get("target_device_id"),
                item.get("target_device_code"),
            )
            commands = item.get("commands")
            if not isinstance(commands, list) or not commands:
                overall_success = False
                targets_result.append(
                    {
                        "target_device": target_device.code,
                        "detail": "No commands for target device",
                    }
                )
                continue

            effective_commands, skipped_config_updates = self._filter_noop_config_updates(target_device, commands)
            if not effective_commands:
                targets_result.append(
                    {
                        "target_device": target_device.code,
                        "success": True,
                        "skipped": True,
                        "detail": "No effective commands for target device",
                        "skipped_commands": skipped_config_updates,
                    }
                )
                continue

            success, result = self._send_commands(target_device, effective_commands)
            overall_success = overall_success and success
            executed_commands.extend(effective_commands)
            targets_result.append(
                {
                    "target_device": target_device.code,
                    "success": success,
                    "commands": effective_commands,
                    **(
                        {"skipped_commands": skipped_config_updates}
                        if skipped_config_updates
                        else {}
                    ),
                    "result": result,
                }
            )

        return overall_success, {"targets": targets_result}, executed_commands


class ThresholdMonitor:
    def __init__(self):
        self.executor = ScriptExecutor()

    def check_and_execute_all(self) -> Dict[str, Any]:
        results = {"checked": 0, "executed": 0, "skipped": 0, "failed": 0}
        scripts = ScriptTemplate.objects.filter(
            is_active=True,
            script_type__in=[ScriptTemplate.ScriptType.THRESHOLD, ScriptTemplate.ScriptType.HYBRID],
        ).order_by("-priority", "-created_at")

        for script in scripts:
            results["checked"] += 1

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
                interval = _min_auto_check_interval_seconds(script)
                if interval > 0:
                    target_device = self.executor._resolve_target_device(script, device)
                    last_start = (
                        ScriptExecution.objects.filter(
                            script=script,
                            device=target_device,
                            trigger_reason="threshold_check",
                        )
                        .order_by("-started_at")
                        .values_list("started_at", flat=True)
                        .first()
                    )
                    if last_start:
                        elapsed = (timezone.now() - last_start).total_seconds()
                        if elapsed < interval:
                            results["skipped"] += 1
                            continue

                try:
                    execution = self.executor.execute_script(script, device, trigger_reason="threshold_check")
                    if execution.status == ScriptExecution.Status.SUCCESS:
                        results["executed"] += 1
                    elif execution.status == ScriptExecution.Status.SKIPPED:
                        results["skipped"] += 1
                    else:
                        results["failed"] += 1
                except Exception as exc:
                    logger.error(f"Failed to execute threshold script {script.name} on device {device.code}: {exc}")
                    results["failed"] += 1

        return results


class ScheduleMonitor:
    def __init__(self):
        self.executor = ScriptExecutor()

    def check_and_execute_all(self, now: Optional[datetime] = None) -> Dict[str, Any]:
        current = now or timezone.localtime(timezone.now())
        scheduled_at = current.replace(second=0, microsecond=0)
        results = {"checked": 0, "matched": 0, "executed": 0, "skipped": 0, "failed": 0}

        scripts = ScriptTemplate.objects.filter(
            is_active=True,
            script_type__in=[
                ScriptTemplate.ScriptType.SCHEDULE,
                ScriptTemplate.ScriptType.HYBRID,
                ScriptTemplate.ScriptType.PYTHON,
            ],
        ).order_by("-priority", "-created_at")

        for script in scripts:
            results["checked"] += 1
            schedule_config = script.schedule_config or {}
            cron_expr = str(schedule_config.get("cron") or "").strip()
            if not cron_expr or not _cron_matches_now(cron_expr, current):
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
                interval = _min_auto_check_interval_seconds(script)
                if interval > 0:
                    target_device = self.executor._resolve_target_device(script, device)
                    last_start = (
                        ScriptExecution.objects.filter(
                            script=script,
                            device=target_device,
                            trigger_reason="schedule_check",
                        )
                        .order_by("-started_at")
                        .values_list("started_at", flat=True)
                        .first()
                    )
                    if last_start:
                        elapsed = (timezone.now() - last_start).total_seconds()
                        if elapsed < interval:
                            results["skipped"] += 1
                            continue

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
