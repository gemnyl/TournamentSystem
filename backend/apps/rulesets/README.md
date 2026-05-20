# Ruleset Engine

Strategy pattern для ігрової логіки бойових мистецтв.

## Архітектура

```
base.py          — абстрактні класи (BaseRuleSet, PointsRuleSet, FlagsRuleSet)
registry.py      — реєстр рулсетів (_REGISTRY, register_ruleset, get_ruleset, list_rulesets)
karate_wkf.py    — реалізація WKF Kumite
shobu_ippon.py   — реалізація Shobu Ippon
```

## Додавання нового рулсету

1. Створити файл `my_ruleset.py`, успадкувати `PointsRuleSet` або `FlagsRuleSet`.
2. Викликати `register_ruleset(MyRuleSet)` в кінці файлу.
3. Додати side-effect import у `apps.py → ready()`.

## API

```python
from apps.rulesets.registry import get_ruleset, list_rulesets

ruleset = get_ruleset("karate_wkf")
state = ruleset.apply_score_event(state, ScoreEvent(corner="aka", action_key="ippon"))
state = ruleset.check_auto_finish(state)
```
