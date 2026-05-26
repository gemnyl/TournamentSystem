from apps.rulesets.base import BaseRuleSet

_REGISTRY: dict[str, type[BaseRuleSet]] = {}


def register_ruleset(cls: type[BaseRuleSet]) -> type[BaseRuleSet]:
    _REGISTRY[cls.key] = cls
    return cls


def get_ruleset(key: str) -> BaseRuleSet:
    try:
        return _REGISTRY[key]()
    except KeyError as exc:
        raise KeyError(f"Unknown ruleset: '{key}'. Available: {list(_REGISTRY)}") from exc


def list_rulesets() -> list[dict]:
    from apps.rulesets.base import PointsRuleSet

    result = []
    for cls in _REGISTRY.values():
        instance = cls()
        entry: dict = {
            "key": cls.key,
            "name": cls.name,
            "sport_type": cls.sport_type,
            "judging_mode": cls.judging_mode,
            "default_duration_seconds": instance.get_default_duration_seconds()
            if isinstance(instance, PointsRuleSet)
            else None,
            "win_methods": [{"key": w.key, "label": w.label} for w in instance.get_win_methods()],
        }
        if isinstance(instance, PointsRuleSet):
            entry["score_actions"] = [
                {
                    "key": a.key,
                    "label": a.label,
                    "points": a.points,
                    "is_warning": a.is_warning,
                }
                for a in instance.get_score_actions()
            ]
        else:
            entry["score_actions"] = []
        result.append(entry)
    return result
