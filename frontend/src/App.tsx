import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "@/components/ui/toaster";
import AppLayout from "@/components/layout/AppLayout";
import ProtectedRoute from "@/components/layout/ProtectedRoute";

// Сторінки
import LoginPage from "@/pages/LoginPage";
import RegisterPage from "@/pages/RegisterPage";
import TournamentListPage from "@/pages/TournamentListPage";
import TournamentDetailPage from "@/pages/TournamentDetailPage";
import CategoryDetailPage from "@/pages/CategoryDetailPage";
import BracketPage from "@/pages/BracketPage";
import AthletesPage from "@/pages/AthletesPage";
import GlobalRatingsPage from "@/pages/GlobalRatingsPage";
import NotFoundPage from "@/pages/NotFoundPage";
import OperatorPanelPage from "@/pages/OperatorPanelPage";
import ScoreboardPage from "@/pages/ScoreboardPage";
import TatamiAdminPage from "@/pages/TatamiAdminPage";
import DayDashboardPage from "@/pages/DayDashboardPage";
import CoachDashboardPage from "@/pages/CoachDashboardPage";
import StaffDashboardPage from "@/pages/StaffDashboardPage";
import VerificationPage from "@/pages/VerificationPage";
import ConfirmEmailPage from "@/pages/ConfirmEmailPage";
import ProfilePage from "@/pages/ProfilePage";
import PrivacyPolicyPage from "@/pages/PrivacyPolicyPage";
import { GoogleOAuthProvider } from "@react-oauth/google";

export default function App() {
  const googleClientId = (import.meta as unknown as { env: { VITE_GOOGLE_CLIENT_ID?: string } }).env?.VITE_GOOGLE_CLIENT_ID || "1028308479201-placeholder.apps.googleusercontent.com";

  return (
    <GoogleOAuthProvider clientId={googleClientId}>
      <BrowserRouter>
        <Routes>
          {/* Публічні маршрути без лейауту */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/confirm-email" element={<ConfirmEmailPage />} />
          <Route path="/verify/:type/:token" element={<VerificationPage />} />
          <Route
            path="/scoreboard/tournament/:tid/tatami/:n"
            element={<ScoreboardPage />}
          />

          {/* Публічні маршрути З лейаутом (перегляд без логіну) */}
          <Route element={<AppLayout />}>
            <Route path="/" element={<Navigate to="/tournaments" replace />} />
            <Route path="/tournaments" element={<TournamentListPage />} />
            <Route path="/tournaments/:id" element={<TournamentDetailPage />} />
            <Route path="/tournaments/:tid/day" element={<DayDashboardPage />} />
            <Route path="/categories/:id" element={<CategoryDetailPage />} />
            <Route path="/categories/:id/bracket" element={<BracketPage />} />
            <Route path="/ratings" element={<GlobalRatingsPage />} />
            <Route path="/privacy-policy" element={<PrivacyPolicyPage />} />


            {/* Захищені маршрути — тільки для залогінених */}
            <Route element={<ProtectedRoute />}>
              <Route path="/athletes" element={<AthletesPage />} />
              <Route path="/profile" element={<ProfilePage />} />
            </Route>

            <Route element={<ProtectedRoute allowedRoles={["coach"]} />}>
              <Route path="/coach/dashboard" element={<CoachDashboardPage />} />
            </Route>

            <Route element={<ProtectedRoute allowedRoles={["admin", "staff", "organizer"]} />}>
              <Route path="/staff" element={<StaffDashboardPage />} />
            </Route>

            <Route element={<ProtectedRoute allowedRoles={["organizer"]} />}>
              <Route path="/tournaments/:tid/tatamis" element={<TatamiAdminPage />} />
            </Route>

            <Route element={<ProtectedRoute allowedRoles={["judge", "organizer"]} />}>
              <Route
                path="/operator/tournament/:tid/tatami/:n"
                element={<OperatorPanelPage />}
              />
            </Route>
          </Route>

          {/* 404 */}
          <Route path="*" element={<NotFoundPage />} />
        </Routes>

        <Toaster />
      </BrowserRouter>
    </GoogleOAuthProvider>
  );
}
