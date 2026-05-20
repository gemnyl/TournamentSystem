from rest_framework.routers import DefaultRouter

from apps.tatamis.views import TatamiViewSet

router = DefaultRouter()
router.register(r"tatamis", TatamiViewSet, basename="tatami")

urlpatterns = router.urls
