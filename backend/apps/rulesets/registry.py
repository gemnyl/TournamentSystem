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
    return [
        {
            "key": cls.key,
            "name": cls.name,
            "sport_type": cls.sport_type,
            "judging_mode": cls.judging_mode,
        }
        for cls in _REGISTRY.values()
    ]
