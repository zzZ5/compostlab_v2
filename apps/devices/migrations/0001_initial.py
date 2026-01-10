from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="Device",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("code", models.CharField(max_length=64, db_index=True, unique=True)),
                ("name", models.CharField(blank=True, default="", max_length=128)),
                (
                    "api_token",
                    models.CharField(
                        blank=True,
                        default="",
                        editable=False,
                        max_length=128,
                        unique=True,
                    ),
                ),
                ("is_active", models.BooleanField(db_index=True, default=True)),
                (
                    "post_topic",
                    models.CharField(blank=True, default="", max_length=256),
                ),
                (
                    "response_topic",
                    models.CharField(blank=True, default="", max_length=256),
                ),
                ("note", models.TextField(blank=True, default="")),
                ("meta", models.JSONField(blank=True, default=dict)),
                (
                    "last_seen_at",
                    models.DateTimeField(blank=True, db_index=True, null=True),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "ordering": ["id"],
                "indexes": [
                    models.Index(fields=["code"]),
                    models.Index(fields=["is_active", "last_seen_at"]),
                ],
            },
        ),
        migrations.CreateModel(
            name="Channel",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("code", models.CharField(max_length=64)),
                ("name", models.CharField(blank=True, default="", max_length=128)),
                ("unit", models.CharField(blank=True, default="", max_length=32)),
                ("is_active", models.BooleanField(db_index=True, default=True)),
                (
                    "metric",
                    models.CharField(
                        blank=True, default="", max_length=32, db_index=True
                    ),
                ),
                (
                    "role",
                    models.CharField(
                        blank=True, default="", max_length=32, db_index=True
                    ),
                ),
                (
                    "display_name",
                    models.CharField(blank=True, default="", max_length=128),
                ),
                ("meta", models.JSONField(blank=True, default=dict)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "device",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="channels",
                        to="devices.device",
                    ),
                ),
            ],
            options={
                "ordering": ["device_id", "code"],
                "indexes": [
                    models.Index(fields=["device", "code"]),
                    models.Index(fields=["code"]),
                    models.Index(fields=["device", "is_active"]),
                ],
                "constraints": [
                    models.UniqueConstraint(
                        fields=["device", "code"], name="uq_channel_device_code"
                    ),
                ],
            },
        ),
        migrations.CreateModel(
            name="DeviceCommand",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("command", models.CharField(blank=True, default="", max_length=64)),
                ("payload", models.JSONField(default=dict)),
                (
                    "status",
                    models.CharField(
                        db_index=True,
                        choices=[
                            ("queued", "Queued"),
                            ("sent", "Sent"),
                            ("acked", "Acked"),
                            ("failed", "Failed"),
                        ],
                        default="queued",
                        max_length=16,
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                ("sent_at", models.DateTimeField(blank=True, db_index=True, null=True)),
                (
                    "acked_at",
                    models.DateTimeField(blank=True, db_index=True, null=True),
                ),
                ("result", models.JSONField(blank=True, default=dict)),
                (
                    "created_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="device_commands",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "device",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="commands",
                        to="devices.device",
                    ),
                ),
            ],
            options={
                "ordering": ["-id"],
                "indexes": [models.Index(fields=["device", "status", "created_at"])],
            },
        ),
        migrations.CreateModel(
            name="ControlTemplate",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("name", models.CharField(max_length=128)),
                (
                    "description",
                    models.CharField(blank=True, default="", max_length=256),
                ),
                ("payload", models.JSONField(default=dict)),
                ("is_active", models.BooleanField(default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "created_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="control_templates",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "device",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        help_text="关联设备（可选）",
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="control_templates",
                        to="devices.device",
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at"],
                "indexes": [
                    models.Index(fields=["device", "is_active"]),
                    models.Index(fields=["is_active"]),
                ],
            },
        ),
    ]
