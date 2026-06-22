import base64
import json
import urllib.error
import urllib.request

from django.conf import settings
from django.core.cache import cache


class MonobankService:
    @staticmethod
    def get_headers():
        return {
            "X-Token": getattr(settings, "MONOBANK_TOKEN", ""),
            "Content-Type": "application/json",
        }

    @classmethod
    def create_invoice(cls, invoice_id, amount_uah, destination, redirect_url, webhook_url):
        if getattr(settings, "MONOBANK_MOCK_PAYMENTS", True):
            return {
                "invoiceId": f"mock-{invoice_id}",
                "pageUrl": f"http://localhost:5173/billing/mock-pay?invoiceId=mock-{invoice_id}&amount={amount_uah}",
            }

        url = "https://api.monobank.ua/api/merchant/invoice/create"
        payload = {
            "amount": int(amount_uah * 100),  # в копійках
            "ccy": 980,  # UAH
            "merchantPaymInfo": {
                "reference": str(invoice_id),
                "destination": destination,
            },
            "redirectUrl": redirect_url,
            "webHookUrl": webhook_url,
            "validityTime": 1800,  # 30 хвилин
        }

        try:
            return cls._make_request(url, "POST", payload)
        except urllib.error.HTTPError as e:
            error_body = e.read().decode("utf-8")
            raise Exception(f"Monobank API error: {e.code} - {error_body}") from e

    @classmethod
    def _make_request(cls, url, method="POST", payload=None):
        data = json.dumps(payload).encode("utf-8") if payload is not None else None
        req = urllib.request.Request(
            url,
            data=data,
            headers=cls.get_headers(),
            method=method,
        )
        with urllib.request.urlopen(req) as response:
            return json.loads(response.read().decode("utf-8"))

    @classmethod
    def cancel_invoice(cls, invoice_id):
        if getattr(settings, "MONOBANK_MOCK_PAYMENTS", True) or str(invoice_id).startswith("mock-"):
            return True

        url = "https://api.monobank.ua/api/merchant/invoice/cancel"
        payload = {"invoiceId": invoice_id}
        try:
            cls._make_request(url, "POST", payload)
            return True
        except Exception:
            return False

    @classmethod
    def refund_invoice(cls, invoice_id, amount_uah, ext_ref):
        if getattr(settings, "MONOBANK_MOCK_PAYMENTS", True) or str(invoice_id).startswith("mock-"):
            return {"status": "success"}

        url = "https://api.monobank.ua/api/merchant/invoice/cancel"
        payload = {
            "invoiceId": invoice_id,
            "amount": int(amount_uah * 100),
            "extRef": str(ext_ref),
        }
        try:
            return cls._make_request(url, "POST", payload)
        except urllib.error.HTTPError as e:
            error_body = e.read().decode("utf-8")
            raise Exception(f"Monobank API refund error: {e.code} - {error_body}") from e

    @classmethod
    def get_invoice_status(cls, invoice_id):
        if getattr(settings, "MONOBANK_MOCK_PAYMENTS", True) or str(invoice_id).startswith("mock-"):
            return {"status": "success", "receiptId": f"REC-MOCK-{invoice_id}"}

        url = f"https://api.monobank.ua/api/merchant/invoice/status?invoiceId={invoice_id}"
        try:
            return cls._make_request(url, "GET")
        except urllib.error.HTTPError as e:
            error_body = e.read().decode("utf-8")
            raise Exception(f"Monobank API status error: {e.code} - {error_body}") from e

    @classmethod
    def get_public_key(cls):
        cached_key = cache.get("monobank_pubkey")
        if cached_key:
            return cached_key

        url = "https://api.monobank.ua/api/merchant/pubkey"
        try:
            data = cls._make_request(url, "GET")
            key = data["key"]
            cache.set("monobank_pubkey", key, timeout=86400)  # Кеш на 24 години
            return key
        except Exception as e:
            raise Exception(f"Failed to fetch Monobank public key: {str(e)}") from e

    @classmethod
    def verify_signature(cls, x_sign, request_body):
        if getattr(settings, "MONOBANK_MOCK_PAYMENTS", True):
            return True
        if not x_sign:
            return False
        try:
            from cryptography.hazmat.primitives import hashes
            from cryptography.hazmat.primitives.asymmetric import ec
            from cryptography.hazmat.primitives.serialization import load_pem_public_key

            pubkey_pem = cls.get_public_key()
            public_key = load_pem_public_key(pubkey_pem.encode("utf-8"))
            signature = base64.b64decode(x_sign)

            public_key.verify(signature, request_body, ec.ECDSA(hashes.SHA256()))
            return True
        except Exception:
            return False
