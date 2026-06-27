import { create } from "zustand";
import { authApi } from "@/lib/api";
import type { User, LoginCredentials, RegisterData } from "@/types/api";

interface AuthState {
  user: User | null;
  isLoading: boolean;
  isInitialized: boolean;  // чи вже виконали fetchMe при старті

  // Дії
  login: (credentials: LoginCredentials) => Promise<void>;
  logout: () => Promise<void>;
  register: (data: RegisterData) => Promise<{ email: string }>;
  confirmEmail: (email: string, code: string) => Promise<void>;
  resendConfirmation: (email: string) => Promise<void>;
  updateProfile: (formData: FormData) => Promise<void>;
  changePassword: (data: Record<string, string>) => Promise<void>;
  googleLogin: (token: string, email: string, firstName: string, lastName: string) => Promise<void>;
  fetchMe: () => Promise<void>;
}

/**
 * Zustand store для аутентифікації.
 * Використовує Django session auth через cookie (sessionid).
 * fetchMe() викликається один раз при монтуванні App.
 */
export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: false,
  isInitialized: false,

  login: async (credentials) => {
    set({ isLoading: true });
    try {
      await authApi.post("/login/", credentials);
      // Після логіну зчитуємо профіль
      const { data } = await authApi.get<User>("/me/");
      set({ user: data, isLoading: false });
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  logout: async () => {
    set({ isLoading: true });
    try {
      await authApi.post("/logout/");
    } finally {
      // Очищаємо стан навіть якщо запит провалився
      set({ user: null, isLoading: false });
    }
  },

  register: async (data) => {
    set({ isLoading: true });
    try {
      const response = await authApi.post<{ detail: string; email: string }>("/register/", data);
      set({ isLoading: false });
      return { email: response.data.email };
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  confirmEmail: async (email, code) => {
    set({ isLoading: true });
    try {
      const { data } = await authApi.post<User>("/confirm-email/", { email, code });
      set({ user: data, isLoading: false });
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  resendConfirmation: async (email) => {
    set({ isLoading: true });
    try {
      await authApi.post("/resend-confirmation/", { email });
      set({ isLoading: false });
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  updateProfile: async (formData) => {
    set({ isLoading: true });
    try {
      // Використовуємо multipart/form-data для завантаження файлів (фото)
      const { data } = await authApi.patch<User>("/me/", formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });
      set({ user: data, isLoading: false });
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  changePassword: async (data) => {
    set({ isLoading: true });
    try {
      await authApi.post("/change-password/", data);
      set({ isLoading: false });
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  googleLogin: async (token, email, firstName, lastName) => {
    set({ isLoading: true });
    try {
      await authApi.post("/google-login/", { token, email, first_name: firstName, last_name: lastName });
      // Після логіну зчитуємо профіль
      const { data } = await authApi.get<User>("/me/");
      set({ user: data, isLoading: false });
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  fetchMe: async () => {
    set({ isLoading: true });
    try {
      const { data } = await authApi.get<User>("/me/");
      set({ user: data, isLoading: false, isInitialized: true });
    } catch (error: unknown) {
      // Django DRF повертає 403 для неавторизованих (не 401).
      // За будь-якої помилки (неавторизований чи мережева помилка) скидаємо користувача та завершуємо ініціалізацію.
      set({ user: null, isLoading: false, isInitialized: true });
    }
  },
}));
