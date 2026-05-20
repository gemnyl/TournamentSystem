import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ("matches", "0003_add_match_event"),
        ("tournaments", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="Tatami",
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
                (
                    "number",
                    models.PositiveSmallIntegerField(verbose_name="Номер татамі"),
                ),
                (
                    "name",
                    models.CharField(blank=True, max_length=50, verbose_name="Назва"),
                ),
                (
                    "is_active",
                    models.BooleanField(default=True, verbose_name="Активне"),
                ),
                (
                    "current_match",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="+",
                        to="matches.match",
                        verbose_name="Поточний матч",
                    ),
                ),
                (
                    "tournament",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="tatamis",
                        to="tournaments.tournament",
                        verbose_name="Турнір",
                    ),
                ),
            ],
            options={
                "verbose_name": "Татамі",
                "verbose_name_plural": "Татамі",
                "db_table": "tatami",
                "ordering": ["tournament", "number"],
                "unique_together": {("tournament", "number")},
            },
        ),
    ]
