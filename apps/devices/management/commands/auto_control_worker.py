import os
import time

from django.core.management.base import BaseCommand

from apps.devices.services.script_executor import ScheduleMonitor, ThresholdMonitor


class Command(BaseCommand):
    help = "Periodically check threshold and scheduled control scripts."

    def handle(self, *args, **options):
        interval_seconds = max(5, int(os.getenv("AUTO_CONTROL_INTERVAL_SECONDS", "30")))
        run_thresholds = os.getenv("AUTO_CONTROL_ENABLE_THRESHOLDS", "1").strip().lower() not in {
            "0",
            "false",
            "no",
        }
        run_schedules = os.getenv("AUTO_CONTROL_ENABLE_SCHEDULES", "1").strip().lower() not in {
            "0",
            "false",
            "no",
        }

        self.stdout.write(
            self.style.SUCCESS(
                f"[AUTO] worker started, interval={interval_seconds}s, "
                f"thresholds={run_thresholds}, schedules={run_schedules}"
            )
        )

        threshold_monitor = ThresholdMonitor()
        schedule_monitor = ScheduleMonitor()

        while True:
            try:
                if run_thresholds:
                    threshold_result = threshold_monitor.check_and_execute_all()
                    self.stdout.write(
                        "[AUTO] threshold "
                        f"checked={threshold_result.get('checked', 0)} "
                        f"executed={threshold_result.get('executed', 0)} "
                        f"skipped={threshold_result.get('skipped', 0)} "
                        f"failed={threshold_result.get('failed', 0)}"
                    )

                if run_schedules:
                    schedule_result = schedule_monitor.check_and_execute_all()
                    self.stdout.write(
                        "[AUTO] schedule "
                        f"checked={schedule_result.get('checked', 0)} "
                        f"matched={schedule_result.get('matched', 0)} "
                        f"executed={schedule_result.get('executed', 0)} "
                        f"skipped={schedule_result.get('skipped', 0)} "
                        f"failed={schedule_result.get('failed', 0)}"
                    )
            except Exception as exc:
                self.stdout.write(self.style.ERROR(f"[AUTO] worker error: {exc}"))

            time.sleep(interval_seconds)
