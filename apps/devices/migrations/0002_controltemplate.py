# Generated migration for ControlTemplate model

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('devices', '0001_initial'),
    ]

    operations = [
        migrations.CreateModel(
            name='ControlTemplate',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(help_text='模板名称，如：曝气开启', max_length=128)),
                ('description', models.CharField(blank=True, default='', help_text='模板描述', max_length=256)),
                ('payload', models.JSONField(default=dict, help_text='命令payload')),
                ('is_active', models.BooleanField(default=True, help_text='是否启用')),
                ('created_at', models.DateTimeField(auto_now_add=True, db_index=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='control_templates', to=settings.AUTH_USER_MODEL)),
                ('device', models.ForeignKey(blank=True, help_text='关联设备（可选）', null=True, on_delete=django.db.models.deletion.CASCADE, related_name='control_templates', to='devices.device')),
            ],
            options={
                'ordering': ['-created_at'],
                'indexes': [
                    models.Index(fields=['device', 'is_active']),
                    models.Index(fields=['is_active']),
                ],
            },
        ),
    ]
