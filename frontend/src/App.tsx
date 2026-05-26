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
import NotFoundPage from "@/pages/NotFoundPage";
import OperatorPanelPage from "@/pages/OperatorPanelPage";
import ScoreboardPage from "@/pages/ScoreboardPage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Публічні маршрути без лейауту */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route
          path="/scoreboard/tournament/:tid/tatami/:n"
          element={<ScoreboardPage />}
        />

        {/* Публічні маршрути З лейаутом (перегляд без логіну — як Uventex) */}
        <Route element={<AppLayout />}>
          <Route path="/" element={<Navigate to="/tournaments" replace />} />
          <Route path="/tournaments" element={<TournamentListPage />} />
          <Route path="/tournaments/:id" element={<TournamentDetailPage />} />
          <Route path="/categories/:id" element={<CategoryDetailPage />} />
          <Route path="/categories/:id/bracket" element={<BracketPage />} />

          {/* Захищені маршрути — тільки для залогінених */}
          <Route element={<ProtectedRoute />}>
            <Route path="/athletes" element={<AthletesPage />} />
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
  );
}
