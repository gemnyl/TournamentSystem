import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import type { UserRole } from "@/types/api";

interface ProtectedRouteProps {
  allowedRoles?: UserRole[];
}

/**
 * Захищений маршрут — тільки для залогінених.
 * AppLayout вже виконав fetchMe(), тому isInitialized тут завжди true.
 * Якщо user відсутній — редірект на /login.
 * Якщо вказано allowedRoles і роль не співпадає — редірект на /tournaments.
 * Якщо профіль не заповнений (немає телефону або дати народження) — редірект на /profile.
 */
export default function ProtectedRoute({ allowedRoles }: ProtectedRouteProps) {
  const { user, isAuthenticated, isInitialized } = useAuth();
  const location = useLocation();

  // Якщо ще не перевірили сесію — нічого не рендеримо
  // (AppLayout показує спінер поки isInitialized = false)
  if (!isInitialized) return null;

  if (!isAuthenticated || !user) {
    return <Navigate to="/login" replace />;
  }

  // Перевірка повноти профілю (наприклад, після входу через Google)
  const isIncompleteProfile = !user.phone || !user.birth_date;
  if (isIncompleteProfile && location.pathname !== "/profile") {
    return <Navigate to="/profile" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to="/tournaments" replace />;
  }

  return <Outlet />;
}
