/**
 * Зчитує значення cookie за ім'ям.
 * Використовується для отримання Django csrftoken.
 */
export function getCookie(name: string): string | null {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) {
    return parts.pop()?.split(";").shift() ?? null;
  }
  return null;
}

/** Повертає поточний CSRF-токен з cookie Django */
export function getCsrfToken(): string {
  return getCookie("csrftoken") ?? "";
}
