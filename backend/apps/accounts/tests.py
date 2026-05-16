from django.test import TestCase

from apps.accounts.serializers import UserRegistrationSerializer


class RegistrationSerializerTest(TestCase):
    def test_passwords_must_match(self):
        data = {
            "email": "test@test.com",
            "first_name": "Test",
            "last_name": "Test",
            "role": "coach",
            "password": "password123",  # NOSONAR
            "password_confirm": "password124",  # NOSONAR
        }
        serializer = UserRegistrationSerializer(data=data)
        self.assertFalse(serializer.is_valid())
        self.assertIn("password_confirm", serializer.errors)

    def test_valid_registration(self):
        data = {
            "email": "test2@test.com",
            "first_name": "Test2",
            "last_name": "Test2",
            "role": "coach",
            "password": "password123",  # NOSONAR
            "password_confirm": "password123",  # NOSONAR
        }
        serializer = UserRegistrationSerializer(data=data)
        self.assertTrue(serializer.is_valid(), serializer.errors)
