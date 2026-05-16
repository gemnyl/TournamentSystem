"""
Модель профілю спортсмена.

Сутність Athlete відокремлена від User, оскільки адміністративні дії
від імені спортсмена виконує його тренер (див. п. 2.2 записки).
"""

from datetime import date

from django.conf import settings
from django.db import models


class Athlete(models.Model):
    """Профіль спортсмена."""

    class Gender(models.TextChoices):
        MALE = "male", "Чоловік"
        FEMALE = "female", "Жінка"

    coach = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="athletes",
        verbose_name="Тренер",
        help_text="Відповідальний тренер (користувач з роллю coach)",
    )
    club = models.ForeignKey(
        "accounts.Club", on_delete=models.PROTECT, related_name="athletes", verbose_name="Клуб"
    )
    first_name = models.CharField(max_length=100, verbose_name="Ім'я")
    last_name = models.CharField(max_length=100, verbose_name="Прізвище")
    gender = models.CharField(max_length=10, choices=Gender.choices, verbose_name="Стать")
    birth_date = models.DateField(verbose_name="Дата народження")
    base_weight = models.DecimalField(
        max_digits=5, decimal_places=2, verbose_name="Базова вага (кг)"
    )
    skill_level = models.CharField(
        max_length=50,
        blank=True,
        verbose_name="Рівень майстерності",
        help_text="Напр., «Чорний пояс 1 дан»",
    )

    class Meta:
        db_table = "athlete"
        verbose_name = "Спортсмен"
        verbose_name_plural = "Спортсмени"
        ordering = ["last_name", "first_name"]
        indexes = [
            models.Index(fields=["club"], name="idx_athlete_club"),
            models.Index(fields=["coach"], name="idx_athlete_coach"),
        ]

    def __str__(self):
        return self.get_full_name()

    def get_full_name(self):
        return f"{self.last_name} {self.first_name}"

    def calculate_current_age(self, reference_date=None):
        """Обчислює вік спортсмена на опорну дату (за замовчуванням — сьогодні)."""
        ref = reference_date or date.today()
        years = ref.year - self.birth_date.year
        if (ref.month, ref.day) < (self.birth_date.month, self.birth_date.day):
            years -= 1
        return years
