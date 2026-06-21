import { useAuthStore } from "@/store/authStore";

/**
 * Зручний хук — обгортка над authStore.
 * Надає user, helpers для перевірки ролей.
 */
export function useAuth() {
  const {
    user,
    isLoading,
    isInitialized,
    login,
    logout,
    register,
    confirmEmail,
    resendConfirmation,
    updateProfile,
    changePassword,
    googleLogin,
    fetchMe,
  } = useAuthStore();

  return {
    user,
    isLoading,
    isInitialized,
    isAuthenticated: !!user,
    isOrganizer: user?.role === "organizer",
    isCoach: user?.role === "coach",
    isJudge: user?.role === "judge",
    isStaff: user?.role === "staff",
    login,
    logout,
    register,
    confirmEmail,
    resendConfirmation,
    updateProfile,
    changePassword,
    googleLogin,
    fetchMe,
  };
}
