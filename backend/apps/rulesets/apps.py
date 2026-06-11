from django.apps import AppConfig


class RulesetsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.rulesets"
    verbose_name = "Ruleset Engine"

    def ready(self):
        import apps.rulesets.karate_kata  # noqa: F401
        import apps.rulesets.karate_wkf  # noqa: F401
        import apps.rulesets.shobu_ippon  # noqa: F401
