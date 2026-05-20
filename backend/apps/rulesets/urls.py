from django.urls import path

from apps.rulesets.views import ruleset_list

urlpatterns = [
    path("rulesets/", ruleset_list, name="ruleset-list"),
]
