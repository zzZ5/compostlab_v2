# Generated manually for index optimization
# Optimizes TelemetryKV indexes for better query performance

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('telemetry', '0001_initial'),
    ]

    operations = [
        # 删除旧索引（这些索引已在 0001_initial 中创建，但名称会不同）
        migrations.RemoveIndex(
            model_name='telemetrykv',
            name='telemetry_t_device__06d1d9_idx',  # device, code, ts
        ),
        migrations.RemoveIndex(
            model_name='telemetrykv',
            name='telemetry_t_code_e9f803_idx',  # code, ts
        ),
        migrations.RemoveIndex(
            model_name='telemetrykv',
            name='telemetry_t_device__cbdb7d_idx',  # device, ts
        ),
        
        # 添加新的优化索引
        migrations.AddIndex(
            model_name='telemetrykv',
            index=models.Index(
                fields=['device', 'code', 'ts'],
                name='idx_device_code_ts'
            ),
        ),
        migrations.AddIndex(
            model_name='telemetrykv',
            index=models.Index(
                fields=['device', 'code', 'ts', 'value'],
                name='idx_device_code_ts_value'
            ),
        ),
        migrations.AddIndex(
            model_name='telemetrykv',
            index=models.Index(
                fields=['code', 'ts'],
                name='idx_code_ts'
            ),
        ),
        migrations.AddIndex(
            model_name='telemetrykv',
            index=models.Index(
                fields=['device', 'ts'],
                name='idx_device_ts'
            ),
        ),
        migrations.AddIndex(
            model_name='telemetrykv',
            index=models.Index(
                fields=['device', 'code', '-ts'],
                name='idx_device_code_ts_desc'
            ),
        ),
        migrations.AddIndex(
            model_name='telemetrykv',
            index=models.Index(
                fields=['ts', 'device', 'code'],
                name='idx_ts_device_code'
            ),
        ),
    ]
