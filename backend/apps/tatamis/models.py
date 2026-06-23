from django.conf import settings
from django.db import models


class Tatami(models.Model):
    assigned_judge = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="assigned_tatamis",
        verbose_name="Призначений суддя",
    )
    tournament = models.ForeignKey(
        "tournaments.Tournament",
        on_delete=models.CASCADE,
        related_name="tatamis",
        verbose_name="Турнір",
    )
    number = models.PositiveSmallIntegerField(verbose_name="Номер татамі")
    name = models.CharField(max_length=50, blank=True, verbose_name="Назва")
    current_match = models.ForeignKey(
        "matches.Match",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
        verbose_name="Поточний матч",
    )
    active_results_category = models.ForeignKey(
        "tournaments.Category",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
        verbose_name="Категорія для відображення результатів на табло",
    )
    is_active = models.BooleanField(default=True, verbose_name="Активне")
    scoreboard_ip = models.GenericIPAddressField(
        null=True, blank=True, verbose_name="IP-адреса апаратного табло"
    )
    scoreboard_connected = models.BooleanField(
        default=False, verbose_name="Статус підключення табло"
    )

    class Meta:
        db_table = "tatami"
        verbose_name = "Татамі"
        verbose_name_plural = "Татамі"
        unique_together = [("tournament", "number")]
        ordering = ["tournament", "number"]

    def __str__(self):
        label = self.name or f"Tatami {self.number}"
        return f"{label} ({self.tournament})"
