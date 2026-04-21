import axios from "axios";
import { getCsrfToken } from "./csrf";
import { toast } from "@/hooks/use-toast";

/**
 * Центральний axios instance для всіх REST-запитів.
 *
 * Ключові налаштування:
 * - withCredentials: true — щоб браузер надсилав Django sessionid cookie
 * - X-CSRFToken — обов'язковий заголовок для небезпечних методів (POST/PUT/PATCH/DELETE)
 * - baseURL — через Vite proxy /api → localhost:8000/api
 */
const api = axios.create({
  baseURL: "/api",
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json",
  },
});

// ─── Request interceptor: додаємо CSRF-токен для небезпечних методів ────────
const UNSAFE_METHODS = new Set(["post", "put", "patch", "delete"]);

api.interceptors.request.use((config) => {
  if (config.method && UNSAFE_METHODS.has(config.method.toLowerCase())) {
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      config.headers["X-CSRFToken"] = csrfToken;
    }
  }
  return config;
});

// ─── Response interceptor: toast для помилок ────────────────────────────────
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status: number | undefined = error.response?.status;
    const detail: string =
      error.response?.data?.detail ||
      error.response?.data?.non_field_errors?.[0] ||
      error.message ||
      "Невідома помилка";

    // 401 та 403 — не показуємо toast (403 часто приходить з auth/me якщо не залогінені)
    if (status !== 401 && status !== 403) {
      toast({
        variant: "destructive",
        title: `Помилка ${status ?? ""}`.trim(),
        description: detail,
      });
    }

    return Promise.reject(error);
  }
);

// ─── Окремий instance для auth endpoints ────────────────────────────────────
export const authApi = axios.create({
  baseURL: "/api/auth",
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json",
  },
});

authApi.interceptors.request.use((config) => {
  if (config.method && UNSAFE_METHODS.has(config.method.toLowerCase())) {
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      config.headers["X-CSRFToken"] = csrfToken;
    }
  }
  return config;
});

authApi.interceptors.response.use(
  (response) => response,
  (error) => {
    const status: number | undefined = error.response?.status;
    const detail: string =
      error.response?.data?.detail ||
      error.response?.data?.non_field_errors?.[0] ||
      error.message ||
      "Невідома помилка";

    if (status !== 401 && status !== 403) {
      toast({
        variant: "destructive",
        title: `Помилка ${status ?? ""}`.trim(),
        description: detail,
      });
    }

    return Promise.reject(error);
  }
);

export default api;