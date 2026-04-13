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
  register: (data: RegisterData) => Promise<void>;
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
      await authApi.post("/register/", data);
      // Після реєстрації логінимо
      const { data: user } = await authApi.get<User>("/me/");
      set({ user, isLoading: false });
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
      // Django DRF повертає 403 для неавторизованих (не 401)
      // Обидва коди означають "не залогінений"
      const status = (error as { response?: { status?: number } })?.response?.status;
      if (status === 401 || status === 403) {
        set({ user: null, isLoading: false, isInitialized: true });
      } else {
        // Мережева помилка або щось інше — теж ініціалізуємо
        set({ user: null, isLoading: false, isInitialized: true });
      }
    }
  },
}));