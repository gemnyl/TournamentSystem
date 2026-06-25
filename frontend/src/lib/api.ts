import axios, { InternalAxiosRequestConfig, AxiosError } from "axios";
export { AxiosError };
import { getCsrfToken } from "./csrf";
import { toast } from "@/hooks/use-toast";

declare module "axios" {
  export interface AxiosRequestConfig {
    skipGlobalToast?: boolean;
  }
}

export interface ErrorDetail {
  detail?: string;
  non_field_errors?: string[];
  [key: string]: unknown;
}

export const FIELD_TRANSLATIONS: Record<string, string> = {
  email: "Електронна пошта",
  password: "Пароль",
  phone: "Телефон",
  first_name: "Ім'я",
  last_name: "Прізвище",
  patronymic: "По-батькові",
  base_weight: "Базова вага",
  recorded_weight: "Вага при зважуванні",
  birth_date: "Дата народження",
  gender: "Стать",
  photo: "Фотографія",
  club: "Клуб",
  coach: "Тренер",
  title: "Назва",
  start_date: "Дата початку",
  end_date: "Дата закінчення",
  location: "Місце проведення",
  capacity: "Місткість",
  iban: "IBAN реквізити",
  recipient_name: "Отримувач",
  recipient_code: "Код отримувача (ЄДРПОУ/ІПН)",
  purpose: "Призначення платежу",
  amount: "Сума",
};

export const ERROR_MESSAGE_TRANSLATIONS: Record<string, string> = {
  "token is invalid": "Токен недійсний або його termін дії закінчився.",
  "invalid signature": "Недійсний підпис безпеки.",
  "this field may not be blank": "Це поле не може бути порожнім.",
  "this field is required": "Це поле є обов'язковим.",
  "user with this email already exists": "Користувач з такою електронною поштою вже існує.",
  "invalid password": "Неправильний пароль.",
  "user is inactive": "Користувач неактивний.",
  "authentication credentials were not provided": "Необхідно авторизуватися.",
  "not the organizer": "Ви не є організатором цього турніру.",
  "tournament is completed": "Турнір завершено.",
  "category is full": "Категорія вже заповнена.",
  "monobank api refund error": "Помилка повернення коштів через Monobank API.",
  "monobank api status error": "Помилка отримання статусу платежу від Monobank.",
  "invalid bank details": "Некоректні банківські реквізити.",
  "withdrawal is only available": "Виведення коштів доступне лише для завершених турнірів.",
  "is already paid": "Ця реєстрація вже оплачена.",
  "is rejected": "Цю реєстрацію відхилено.",
  "no permission": "У вас немає прав для виконання цієї дії.",
  "method not allowed": "Метод не дозволено.",
};

export function formatAxiosError(error: AxiosError<ErrorDetail>): string {
  const response = error.response;
  if (!response) {
    if (error.message === "Network Error") {
      return "Помилка мережі. Перевірте з'єднання з інтернетом.";
    }
    return error.message || "Не вдалося встановити зв'язок із сервером.";
  }

  const status = response.status;
  const data = response.data as unknown;

  // 1. Handle HTML responses (502 Bad Gateway, 500 Server Error pages)
  if (typeof data === "string" && data.trim().startsWith("<!DOCTYPE html>")) {
    if (status === 502) return "Сервер тимчасово недоступний (Bad Gateway).";
    if (status === 504) return "Час очікування відповіді від сервера вичерпано (Gateway Timeout).";
    return `Помилка сервера (Код ${status}).`;
  }

  // 2. Handle structured JSON error responses
  if (data && typeof data === "object") {
    const dataObj = data as Record<string, unknown>;
    let rawMsg = "";
    if (typeof dataObj.detail === "string") {
      rawMsg = dataObj.detail;
    } else if (Array.isArray(dataObj.non_field_errors)) {
      rawMsg = (dataObj.non_field_errors as unknown[]).join(", ");
    } else {
      // Collect field validation errors
      const fieldErrors: string[] = [];
      for (const [key, value] of Object.entries(dataObj)) {
        if (key === "detail" || key === "non_field_errors") continue;

        const fieldLabel = FIELD_TRANSLATIONS[key] || (key.charAt(0).toUpperCase() + key.slice(1));

        if (Array.isArray(value)) {
          fieldErrors.push(`${fieldLabel}: ${value.join(", ")}`);
        } else if (typeof value === "string") {
          fieldErrors.push(`${fieldLabel}: ${value}`);
        } else if (value && typeof value === "object") {
          fieldErrors.push(`${fieldLabel}: ${JSON.stringify(value)}`);
        }
      }
      if (fieldErrors.length > 0) {
        rawMsg = fieldErrors.join("\n");
      }
    }

    if (rawMsg) {
      // Apply substring translation mapping
      const lowerMsg = rawMsg.toLowerCase();
      for (const [englishKey, ukrainianTranslation] of Object.entries(ERROR_MESSAGE_TRANSLATIONS)) {
        if (lowerMsg.includes(englishKey)) {
          return ukrainianTranslation;
        }
      }
      return rawMsg;
    }
  }

  // 3. Default fallbacks
  if (status === 400) return "Некоректний запит (Помилка валідації).";
  if (status === 401) return "Необхідно авторизуватися.";
  if (status === 403) return "Доступ заборонено.";
  if (status === 404) return "Ресурс не знайдено.";
  if (status === 500) return "Внутрішня помилка сервера.";

  return error.message || "Невідома помилка.";
}

/**
 * Central axios instance for all REST requests.
 */
const api = axios.create({
  baseURL: "/api",
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json",
  },
});

const UNSAFE_METHODS = new Set(["post", "put", "patch", "delete"]);

const csrfInterceptor = (config: InternalAxiosRequestConfig): InternalAxiosRequestConfig => {
  if (config.method && UNSAFE_METHODS.has(config.method.toLowerCase())) {
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      config.headers["X-CSRFToken"] = csrfToken;
    }
  }
  return config;
};

const responseErrorInterceptor = (error: AxiosError<ErrorDetail>) => {
  const skipGlobalToast = error.config?.skipGlobalToast;
  const status = error.response?.status;
  const detail = formatAxiosError(error);

  console.error("API Error:", error);

  if (!skipGlobalToast && status !== 401 && status !== 403 && detail !== "email_not_verified") {
    toast({
      variant: "destructive",
      title: "Помилка запиту",
      description: detail,
    });
  }

  return Promise.reject(error);
};

api.interceptors.request.use(csrfInterceptor);
api.interceptors.response.use((r) => r, responseErrorInterceptor);

export const authApi = axios.create({
  baseURL: "/api/auth",
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json",
  },
});

authApi.interceptors.request.use(csrfInterceptor);
authApi.interceptors.response.use((r) => r, responseErrorInterceptor);

export default api;
