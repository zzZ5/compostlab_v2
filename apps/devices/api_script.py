# apps/devices/api_script.py
# -*- coding: utf-8 -*-
"""
控制脚本管理 API
"""

from __future__ import annotations

import json
import re

from django.conf import settings
from django.http import JsonResponse
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views import View
from django.views.decorators.csrf import csrf_exempt

from apps.accounts.models import AuditLog
from apps.accounts.utils import log_audit
from apps.api.mixins import BasicAuthMixin, JsonBodyMixin
from apps.devices.models import Device, ScriptExecution, ScriptRuntimeState, ScriptTemplate
from apps.devices.services.script_executor import (
    ScheduleMonitor,
    ScriptExecutor,
    ThresholdMonitor,
)
from apps.permissions.config import ActionType, ResourceType
from apps.permissions.mixins import ReadOrWritePermissionMixin, ResourcePermissionMixin


def _dt_local_str(dt) -> str:
    if not dt:
        return ""
    return timezone.localtime(dt).strftime("%Y-%m-%d %H:%M:%S")


def _json_object_field(data: dict, key: str, default: dict | None = None) -> dict:
    value = data.get(key, default if default is not None else {})
    if value is None:
        return {}
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except Exception as exc:
            raise ValueError(f"{key} is not valid JSON: {exc}") from exc
    if not isinstance(value, dict):
        raise ValueError(f"{key} must be a JSON object")
    return value


def _validate_command_template(command_template: dict) -> dict:
    def _validate_command_list(items: object, field_name: str) -> None:
        if not isinstance(items, list):
            raise ValueError(f"command_template.{field_name} must be a list")

        for index, item in enumerate(items, start=1):
            if not isinstance(item, dict):
                raise ValueError(f"command_template.{field_name}[{index}] must be an object")

            command = item.get("command")
            action = item.get("action")
            duration = item.get("duration")
            config = item.get("config")

            if not isinstance(command, str) or not command.strip():
                raise ValueError(f"command_template.{field_name}[{index}].command is required")

            if command == "config_update":
                if not isinstance(config, dict):
                    raise ValueError(f"command_template.{field_name}[{index}].config must be an object")
            elif not isinstance(action, str) or not action.strip():
                raise ValueError(f"command_template.{field_name}[{index}].action is required")

            if duration is not None and (not isinstance(duration, (int, float)) or duration < 0):
                raise ValueError(f"command_template.{field_name}[{index}].duration must be >= 0")

    _validate_command_list(command_template.get("commands"), "commands")
    if "else_commands" in command_template:
        _validate_command_list(command_template.get("else_commands"), "else_commands")

    return command_template


def _is_valid_cron_expression(value: str) -> bool:
    parts = value.strip().split()
    return 5 <= len(parts) <= 6


def _extract_min_check_interval_from_python_code(python_code: str) -> int | None:
    """Parse optional interval from top-level ``MIN_CHECK_INTERVAL_SECONDS = N`` assignment."""
    if not python_code or not str(python_code).strip():
        return None
    text = str(python_code)
    m = re.search(
        r"(?m)^\s*MIN_CHECK_INTERVAL_SECONDS\s*=\s*(\d+)\s*(?:#.*)?$",
        text,
    )
    if m:
        return int(m.group(1))
    return None


def _finalize_python_script_threshold_config(
    threshold_config: dict, python_code: str
) -> dict:
    tc = dict(threshold_config) if isinstance(threshold_config, dict) else {}
    extracted = _extract_min_check_interval_from_python_code(python_code)
    if extracted is None or extracted == 0:
        tc.pop("min_check_interval_seconds", None)
    else:
        tc["min_check_interval_seconds"] = extracted
    return tc


def _validate_script_payload(
    script_type: str,
    threshold_config: dict,
    schedule_config: dict,
    python_code: str,
) -> None:
    def _validate_threshold_condition(condition: dict, prefix: str) -> None:
        metric = condition.get("metric")
        operator = condition.get("operator")
        value = condition.get("value")
        if not metric:
            raise ValueError(f"{prefix}.metric is required")
        if not operator:
            raise ValueError(f"{prefix}.operator is required")
        if value is None:
            raise ValueError(f"{prefix}.value is required")

    if script_type in {
        ScriptTemplate.ScriptType.THRESHOLD,
        ScriptTemplate.ScriptType.HYBRID,
    }:
        conditions = threshold_config.get("conditions")
        if isinstance(conditions, list) and conditions:
            for index, condition in enumerate(conditions, start=1):
                if not isinstance(condition, dict):
                    raise ValueError(f"threshold_config.conditions[{index}] must be an object")
                _validate_threshold_condition(condition, f"threshold_config.conditions[{index}]")
        else:
            _validate_threshold_condition(threshold_config, "threshold_config")

    raw_interval = threshold_config.get("min_check_interval_seconds")
    if raw_interval is not None and raw_interval != "":
        try:
            n = int(raw_interval)
        except (TypeError, ValueError) as exc:
            raise ValueError(
                "threshold_config.min_check_interval_seconds must be an integer"
            ) from exc
        if n < 0:
            raise ValueError("threshold_config.min_check_interval_seconds must be >= 0")
        if n > 0 and n < 5:
            raise ValueError(
                "threshold_config.min_check_interval_seconds must be >= 5 when nonzero"
            )
        if n > 86400 * 7:
            raise ValueError(
                "threshold_config.min_check_interval_seconds is too large (max 604800)"
            )

    if script_type in {
        ScriptTemplate.ScriptType.SCHEDULE,
        ScriptTemplate.ScriptType.HYBRID,
    }:
        cron = str(schedule_config.get("cron", "")).strip()
        if not cron:
            raise ValueError("schedule_config.cron is required")
        if not _is_valid_cron_expression(cron):
            raise ValueError("schedule_config.cron must contain 5 or 6 parts")

    if script_type == ScriptTemplate.ScriptType.PYTHON:
        if not python_code.strip():
            raise ValueError("python_code is required for python scripts")
        if "commands" not in python_code and "actions" not in python_code:
            raise ValueError("python_code must define commands or actions")
        cron = str(schedule_config.get("cron", "")).strip()
        if cron and not _is_valid_cron_expression(cron):
            raise ValueError("schedule_config.cron must contain 5 or 6 parts")


def _script_to_dict(script: ScriptTemplate) -> dict:
    return {
        "id": script.id,
        "name": script.name,
        "description": script.description,
        "script_type": script.script_type,
        "script_type_display": script.get_script_type_display(),
        "threshold_config": script.threshold_config,
        "schedule_config": script.schedule_config,
        "python_code": script.python_code,
        "command_template": script.command_template,
        "device_ids": list(script.devices.values_list("id", flat=True)),
        "run_id": script.run.id if script.run else None,
        "is_active": script.is_active,
        "priority": script.priority,
        "created_by": script.created_by.username if script.created_by else None,
        "created_at": _dt_local_str(script.created_at),
        "updated_at": _dt_local_str(script.updated_at),
    }


def _execution_to_dict(execution: ScriptExecution) -> dict:
    return {
        "execution_id": execution.id,
        "script_id": execution.script.id,
        "script_name": execution.script.name,
        "device_id": execution.device.id,
        "device_code": execution.device.code,
        "status": execution.status,
        "status_display": execution.get_status_display(),
        "trigger_reason": execution.trigger_reason,
        "commands": execution.commands,
        "result": execution.result,
        "error_message": execution.error_message,
        "scheduled_at": _dt_local_str(execution.scheduled_at),
        "started_at": _dt_local_str(execution.started_at),
        "completed_at": _dt_local_str(execution.completed_at),
        "created_by": execution.created_by.username if execution.created_by else None,
        "created_at": _dt_local_str(execution.created_at),
    }


def _runtime_state_to_dict(state: ScriptRuntimeState) -> dict:
    return {
        "id": state.id,
        "script_id": state.script_id,
        "device_id": state.device_id,
        "device_code": state.device.code,
        "state": state.state,
        "updated_at": _dt_local_str(state.updated_at),
    }


def _model_registry_summary() -> list[dict]:
    registry = getattr(settings, "CONTROL_MODEL_REGISTRY", None)
    if not isinstance(registry, dict):
        return []

    items: list[dict] = []
    for name, config in registry.items():
        if not isinstance(config, dict):
            continue
        items.append(
            {
                "name": str(name),
                "kind": str(config.get("kind", "")),
                "rule_type": str(config.get("rule_type", "")),
                "thresholds": config.get("thresholds") if isinstance(config.get("thresholds"), dict) else {},
                "suggestions": config.get("suggestions") if isinstance(config.get("suggestions"), dict) else {},
                "features": config.get("features") if isinstance(config.get("features"), list) else [],
                "path": str(config.get("path", "")) if config.get("path") else "",
                "decision_map": config.get("decision_map") if isinstance(config.get("decision_map"), dict) else {},
            }
        )
    items.sort(key=lambda item: item.get("name", ""))
    return items


def _model_health_summary(name_filter: str | None = None) -> list[dict]:
    registry = getattr(settings, "CONTROL_MODEL_REGISTRY", None)
    if not isinstance(registry, dict):
        return []

    executor = ScriptExecutor()
    target_name = str(name_filter or "").strip().lower()
    items: list[dict] = []

    for raw_name, raw_config in registry.items():
        name = str(raw_name)
        if target_name and name.lower() != target_name:
            continue

        if not isinstance(raw_config, dict):
            items.append(
                {
                    "name": name,
                    "kind": "unknown",
                    "healthy": False,
                    "status": "invalid",
                    "detail": "model config must be an object",
                }
            )
            continue

        kind = str(raw_config.get("kind", "rule")).lower()
        if kind == "rule":
            rule_type = str(raw_config.get("rule_type", "")).strip()
            items.append(
                {
                    "name": name,
                    "kind": kind,
                    "healthy": bool(rule_type),
                    "status": "ready" if rule_type else "invalid",
                    "detail": f"rule_type={rule_type}" if rule_type else "rule_type is required",
                }
            )
            continue

        if kind in ("sklearn", "ml", "model"):
            model_path = str(raw_config.get("path", "")).strip()
            feature_names = raw_config.get("features")
            if not model_path:
                items.append(
                    {
                        "name": name,
                        "kind": kind,
                        "healthy": False,
                        "status": "invalid",
                        "detail": "path is required",
                    }
                )
                continue
            if not isinstance(feature_names, list) or not feature_names:
                items.append(
                    {
                        "name": name,
                        "kind": kind,
                        "healthy": False,
                        "status": "invalid",
                        "detail": "features must be a non-empty list",
                    }
                )
                continue
            try:
                resolved = executor._resolve_model_path(model_path)
                if not resolved.exists():
                    items.append(
                        {
                            "name": name,
                            "kind": kind,
                            "healthy": False,
                            "status": "missing",
                            "detail": f"model file not found: {model_path}",
                        }
                    )
                    continue
                executor._load_sklearn_model(model_path)
                items.append(
                    {
                        "name": name,
                        "kind": kind,
                        "healthy": True,
                        "status": "ready",
                        "detail": f"loaded: {model_path}",
                    }
                )
            except Exception as exc:
                items.append(
                    {
                        "name": name,
                        "kind": kind,
                        "healthy": False,
                        "status": "load_failed",
                        "detail": str(exc),
                    }
                )
            continue

        items.append(
            {
                "name": name,
                "kind": kind,
                "healthy": False,
                "status": "unsupported",
                "detail": f"unsupported kind: {kind}",
            }
        )

    items.sort(key=lambda item: item.get("name", ""))
    return items


@method_decorator(csrf_exempt, name="dispatch")
class ScriptTemplateListView(BasicAuthMixin, ReadOrWritePermissionMixin, JsonBodyMixin, View):
    resource_type = ResourceType.SCRIPT

    def get(self, request):
        qs = ScriptTemplate.objects.all().order_by("-priority", "-created_at")

        device_id = request.GET.get("device_id")
        if device_id:
            qs = qs.filter(devices__id=device_id)

        is_active = request.GET.get("is_active")
        if is_active is not None:
            qs = qs.filter(is_active=is_active.lower() == "true")

        script_type = request.GET.get("script_type")
        if script_type:
            qs = qs.filter(script_type=script_type)

        items = [_script_to_dict(item) for item in qs[:100]]
        return JsonResponse({"count": len(items), "data": items}, status=200)

    def post(self, request):
        data = self.json_body(request)
        name = data.get("name", "").strip()
        if not name:
            return JsonResponse({"detail": "name is required"}, status=400)

        script_type = data.get("script_type", ScriptTemplate.ScriptType.THRESHOLD)
        valid_types = {choice[0] for choice in ScriptTemplate.ScriptType.choices}
        if script_type not in valid_types:
            return JsonResponse({"detail": f"Invalid script_type: {script_type}"}, status=400)

        try:
            threshold_config = _json_object_field(data, "threshold_config", {})
            schedule_config = _json_object_field(data, "schedule_config", {})
            command_template = _validate_command_template(
                _json_object_field(data, "command_template", {})
            )
            python_code = data.get("python_code", "")
            if script_type == ScriptTemplate.ScriptType.PYTHON:
                threshold_config = _finalize_python_script_threshold_config(
                    threshold_config, python_code
                )
            _validate_script_payload(
                script_type,
                threshold_config,
                schedule_config,
                python_code,
            )
        except ValueError as exc:
            return JsonResponse({"detail": str(exc)}, status=400)

        script = ScriptTemplate.objects.create(
            name=name,
            description=data.get("description", "").strip() or "",
            script_type=script_type,
            threshold_config=threshold_config,
            schedule_config=schedule_config,
            python_code=python_code,
            command_template=command_template,
            is_active=bool(data.get("is_active", True)),
            priority=int(data.get("priority", 0)),
            created_by=request.user if request.user.is_authenticated else None,
        )

        device_ids = data.get("device_ids", [])
        if device_ids:
            script.devices.set(device_ids)

        log_audit(
            request.user,
            AuditLog.Action.SCRIPT_CREATE,
            resource_type="script_template",
            resource_id=script.id,
            description=f"创建控制脚本：{script.name}",
            request=request,
        )

        return JsonResponse(_script_to_dict(script), status=201)


@method_decorator(csrf_exempt, name="dispatch")
class ScriptTemplateDetailView(BasicAuthMixin, ReadOrWritePermissionMixin, JsonBodyMixin, View):
    resource_type = ResourceType.SCRIPT

    def get(self, request, script_id: int):
        try:
            script = ScriptTemplate.objects.get(id=script_id)
        except ScriptTemplate.DoesNotExist:
            return JsonResponse({"detail": "Script template not found."}, status=404)
        return JsonResponse(_script_to_dict(script), status=200)

    def patch(self, request, script_id: int):
        try:
            script = ScriptTemplate.objects.get(id=script_id)
        except ScriptTemplate.DoesNotExist:
            return JsonResponse({"detail": "Script template not found."}, status=404)

        data = self.json_body(request)
        next_script_type = data.get("script_type", script.script_type)
        next_python_code = data.get("python_code", script.python_code or "")

        try:
            threshold_config = (
                _json_object_field(data, "threshold_config", script.threshold_config)
                if "threshold_config" in data
                else dict(script.threshold_config or {})
            )
            schedule_config = (
                _json_object_field(data, "schedule_config", script.schedule_config)
                if "schedule_config" in data
                else script.schedule_config
            )
            command_template = (
                _validate_command_template(
                    _json_object_field(data, "command_template", script.command_template)
                )
                if "command_template" in data
                else script.command_template
            )
            if next_script_type == ScriptTemplate.ScriptType.PYTHON:
                threshold_config = _finalize_python_script_threshold_config(
                    threshold_config, next_python_code
                )
            _validate_script_payload(
                next_script_type,
                threshold_config,
                schedule_config,
                next_python_code,
            )
        except ValueError as exc:
            return JsonResponse({"detail": str(exc)}, status=400)

        if "name" in data:
            name = data["name"].strip()
            if not name:
                return JsonResponse({"detail": "name cannot be empty"}, status=400)
            script.name = name

        if "description" in data:
            script.description = data["description"].strip() or ""

        if "script_type" in data:
            valid_types = {choice[0] for choice in ScriptTemplate.ScriptType.choices}
            if data["script_type"] in valid_types:
                script.script_type = data["script_type"]

        if "threshold_config" in data or next_script_type == ScriptTemplate.ScriptType.PYTHON:
            script.threshold_config = threshold_config

        if "schedule_config" in data:
            script.schedule_config = schedule_config

        if "python_code" in data:
            script.python_code = data["python_code"]

        if "command_template" in data:
            script.command_template = command_template

        if "is_active" in data:
            script.is_active = bool(data["is_active"])

        if "priority" in data:
            script.priority = int(data["priority"])

        if "device_ids" in data:
            script.devices.set(data["device_ids"])

        script.save()

        log_audit(
            request.user,
            AuditLog.Action.SCRIPT_UPDATE,
            resource_type="script_template",
            resource_id=script.id,
            description=f"更新控制脚本：{script.name}",
            request=request,
        )

        return JsonResponse(_script_to_dict(script), status=200)

    def put(self, request, script_id: int):
        return self.patch(request, script_id)

    def delete(self, request, script_id: int):
        try:
            script = ScriptTemplate.objects.get(id=script_id)
        except ScriptTemplate.DoesNotExist:
            return JsonResponse({"detail": "Script template not found."}, status=404)

        script_name = script.name
        script.delete()

        log_audit(
            request.user,
            AuditLog.Action.SCRIPT_DELETE,
            resource_type="script_template",
            resource_id=script_id,
            description=f"删除控制脚本：{script_name}",
            request=request,
        )

        return JsonResponse({"detail": "deleted", "id": script_id}, status=200)


@method_decorator(csrf_exempt, name="dispatch")
class ScriptExecutionListView(BasicAuthMixin, ReadOrWritePermissionMixin, JsonBodyMixin, View):
    resource_type = ResourceType.SCRIPT_EXECUTE

    def get(self, request, script_id: int):
        try:
            script = ScriptTemplate.objects.get(id=script_id)
        except ScriptTemplate.DoesNotExist:
            return JsonResponse({"detail": "Script template not found."}, status=404)

        qs = ScriptExecution.objects.filter(script=script).order_by("-created_at")

        device_id = request.GET.get("device_id")
        if device_id:
            qs = qs.filter(device_id=device_id)

        status = request.GET.get("status")
        if status:
            qs = qs.filter(status=status)

        limit = max(1, min(int(request.GET.get("limit", "50")), 500))
        items = [_execution_to_dict(item) for item in qs[:limit]]
        return JsonResponse({"count": len(items), "data": items}, status=200)

    def post(self, request, script_id: int):
        try:
            script = ScriptTemplate.objects.get(id=script_id)
        except ScriptTemplate.DoesNotExist:
            return JsonResponse({"detail": "Script template not found."}, status=404)

        if not script.is_active:
            return JsonResponse({"detail": "Script is not active."}, status=400)

        data = self.json_body(request)
        executor = ScriptExecutor()

        device_ids = data.get("device_ids", [])
        if device_ids:
            devices = Device.objects.filter(id__in=device_ids, is_active=True)
        else:
            devices = script.devices.filter(is_active=True)
            if not devices.exists():
                return JsonResponse({"detail": "No devices configured for this script"}, status=400)

        results = []
        for device in devices:
            execution = executor.execute_script(
                script,
                device,
                trigger_reason="manual",
                created_by=request.user if request.user.is_authenticated else None,
            )
            results.append(_execution_to_dict(execution))

        log_audit(
            request.user,
            AuditLog.Action.SCRIPT_EXECUTE,
            resource_type="script_execution",
            resource_id=script_id,
            description=f"手动执行脚本：{script.name}，设备数：{len(results)}",
            request=request,
        )

        return JsonResponse(
            {
                "script_id": script_id,
                "script_name": script.name,
                "executed_count": len(results),
                "executions": results,
            },
            status=201,
        )


@method_decorator(csrf_exempt, name="dispatch")
class ScriptExecutionGlobalListView(BasicAuthMixin, ResourcePermissionMixin, View):
    resource_type = ResourceType.SCRIPT_EXECUTE
    action_type = ActionType.READ

    def get(self, request):
        qs = ScriptExecution.objects.select_related("script", "device").order_by("-created_at")

        trigger_reason = request.GET.get("trigger_reason")
        if trigger_reason:
            qs = qs.filter(trigger_reason=trigger_reason)

        status = request.GET.get("status")
        if status:
            qs = qs.filter(status=status)

        limit = max(1, min(int(request.GET.get("limit", "50")), 200))
        items = [_execution_to_dict(item) for item in qs[:limit]]
        return JsonResponse({"count": len(items), "data": items}, status=200)


@method_decorator(csrf_exempt, name="dispatch")
class ScriptExecutionDetailView(BasicAuthMixin, ResourcePermissionMixin, View):
    resource_type = ResourceType.SCRIPT_EXECUTE
    action_type = ActionType.READ

    def get(self, request, execution_id: int):
        try:
            execution = ScriptExecution.objects.get(id=execution_id)
        except ScriptExecution.DoesNotExist:
            return JsonResponse({"detail": "Execution not found."}, status=404)
        return JsonResponse(_execution_to_dict(execution), status=200)


@method_decorator(csrf_exempt, name="dispatch")
class ScriptRuntimeStateView(BasicAuthMixin, ReadOrWritePermissionMixin, JsonBodyMixin, View):
    resource_type = ResourceType.SCRIPT

    def get(self, request, script_id: int):
        try:
            script = ScriptTemplate.objects.get(id=script_id)
        except ScriptTemplate.DoesNotExist:
            return JsonResponse({"detail": "Script template not found."}, status=404)

        qs = (
            ScriptRuntimeState.objects.filter(script=script)
            .select_related("device")
            .order_by("device__code")
        )
        device_id = request.GET.get("device_id")
        if device_id:
            qs = qs.filter(device_id=device_id)

        items = [_runtime_state_to_dict(item) for item in qs]
        return JsonResponse({"count": len(items), "data": items}, status=200)

    def delete(self, request, script_id: int):
        try:
            script = ScriptTemplate.objects.get(id=script_id)
        except ScriptTemplate.DoesNotExist:
            return JsonResponse({"detail": "Script template not found."}, status=404)

        qs = ScriptRuntimeState.objects.filter(script=script)
        device_id = request.GET.get("device_id")
        target_desc = "all devices"
        if device_id:
            qs = qs.filter(device_id=device_id)
            target_desc = f"device_id={device_id}"

        count = qs.count()
        qs.delete()

        log_audit(
            request.user,
            AuditLog.Action.SCRIPT_UPDATE,
            resource_type="script_template",
            resource_id=script.id,
            description=f"清空脚本运行变量：{script.name} ({target_desc})",
            request=request,
        )

        return JsonResponse(
            {
                "detail": "runtime state cleared",
                "script_id": script.id,
                "deleted_count": count,
                "device_id": int(device_id) if device_id else None,
            },
            status=200,
        )


@method_decorator(csrf_exempt, name="dispatch")
class ScriptModelRegistryView(BasicAuthMixin, ResourcePermissionMixin, View):
    resource_type = ResourceType.SCRIPT
    action_type = ActionType.READ

    def get(self, request):
        data = _model_registry_summary()
        return JsonResponse({"count": len(data), "data": data}, status=200)


@method_decorator(csrf_exempt, name="dispatch")
class ScriptModelHealthView(BasicAuthMixin, ResourcePermissionMixin, View):
    resource_type = ResourceType.SCRIPT
    action_type = ActionType.READ

    def get(self, request):
        name = request.GET.get("name")
        data = _model_health_summary(name)
        return JsonResponse({"count": len(data), "data": data}, status=200)


@method_decorator(csrf_exempt, name="dispatch")
class AutoControlView(BasicAuthMixin, ResourcePermissionMixin, View):
    resource_type = ResourceType.SCRIPT_EXECUTE
    action_type = ActionType.EXECUTE

    def post(self, request):
        monitor = ThresholdMonitor()
        return JsonResponse(monitor.check_and_execute_all(), status=200)


@method_decorator(csrf_exempt, name="dispatch")
class ScheduleControlView(BasicAuthMixin, ResourcePermissionMixin, View):
    resource_type = ResourceType.SCRIPT_EXECUTE
    action_type = ActionType.EXECUTE

    def post(self, request):
        monitor = ScheduleMonitor()
        return JsonResponse(monitor.check_and_execute_all(), status=200)
