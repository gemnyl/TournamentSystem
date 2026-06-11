import axios, { InternalAxiosRequestConfig, AxiosError } from "axios";
import { getCsrfToken } from "./csrf";
import { toast } from "@/hooks/use-toast";

interface ErrorDetail {
  detail?: string;
  non_field_errors?: string[];
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
