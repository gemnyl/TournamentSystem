from rest_framework.pagination import PageNumberPagination


class OptionalPageNumberPagination(PageNumberPagination):
    """Пагінація з підтримкою динамічного розміру сторінки через query параметр `page_size`."""

    page_size_query_param = "page_size"
    max_page_size = 1000
