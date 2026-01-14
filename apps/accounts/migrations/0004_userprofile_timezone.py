# Generated migration for adding timezone field to UserProfile

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('accounts', '0003_add_announcement_actions'),
    ]

    operations = [
        migrations.AddField(
            model_name='userprofile',
            name='timezone',
            field=models.CharField(
                default='Asia/Shanghai',
                help_text='用户时区，如 Asia/Shanghai, UTC, America/New_York',
                max_length=50
            ),
        ),
    ]
