import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { Trophy, Users, LogOut, ChevronDown, Menu, X, LogIn, Loader2 } from "lucide-react";
import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const ROLE_LABELS: Record<string, string> = {
  organizer: "Організатор",
  coach:     "Тренер",
  judge:     "Суддя",
  spectator: "Глядач",
};

function NavItem({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          "relative px-1 py-0.5 text-sm font-medium transition-colors",
          "after:absolute after:bottom-0 after:left-0 after:h-[2px] after:w-full",
          "after:origin-left after:scale-x-0 after:bg-amber-500 after:transition-transform",
          isActive
            ? "text-foreground after:scale-x-100"
            : "text-muted-foreground hover:text-foreground hover:after:scale-x-100"
        )
      }
    >
      {children}
    </NavLink>
  );
}

export default function AppLayout() {
  const { user, logout, isAuthenticated, isInitialized, isOrganizer, fetchMe } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [judgeTatami, setJudgeTatami] = useState<any | null>(null);

  // Перевіряємо сесію один раз при старті
  useEffect(() => {
    fetchMe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isAuthenticated && user?.role === "judge") {
      api.get<any[]>("/tatamis/")
        .then((res) => {
          const list = Array.isArray(res.data) ? res.data : (res.data as any).results;
          const assigned = list.find((t: any) => t.assigned_judge === user.id);
          if (assigned) {
            setJudgeTatami(assigned);
          }
        })
        .catch(() => {});
    } else {
      setJudgeTatami(null);
    }
  }, [isAuthenticated, user]);

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  // Поки не знаємо чи залогінений — показуємо мінімальний спінер
  // (щоб хедер не "стрибав" між станами)
  if (!isInitialized) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <header className="sticky top-0 z-40 border-b border-border/50 bg-background/80 h-14 flex items-center px-6">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded bg-amber-500 flex items-center justify-center">
              <Trophy className="w-4 h-4 text-slate-900" />
            </div>
            <span className="font-display font-bold text-lg tracking-tight hidden sm:block">
              TOURNAMENT<span className="text-amber-500">APP</span>
            </span>
          </div>
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground ml-auto" />
        </header>
        <main className="flex-1" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* ── Хедер ── */}
      <header className="sticky top-0 z-40 border-b border-border/50 bg-background/80 backdrop-blur-sm">
        <div className="container flex h-14 items-center justify-between gap-4">

          {/* Логотип */}
          <Link to="/tournaments" className="flex items-center gap-2 shrink-0">
            <div className="w-7 h-7 rounded bg-amber-500 flex items-center justify-center">
              <Trophy className="w-4 h-4 text-slate-900" />
            </div>
            <span className="font-display font-bold text-lg tracking-tight hidden sm:block">
              TOURNAMENT<span className="text-amber-500">APP</span>
            </span>
          </Link>

          <nav className="hidden md:flex items-center gap-6">
            <NavItem to="/tournaments">Турніри</NavItem>
            {isAuthenticated && <NavItem to="/athletes">Атлети</NavItem>}
            {judgeTatami && (
              <NavItem to={`/operator/tournament/${judgeTatami.tournament}/tatami/${judgeTatami.number}`}>
                Мій татамі
              </NavItem>
            )}
          </nav>

          {/* Права частина */}
          <div className="flex items-center gap-2 ml-auto">
            {isAuthenticated ? (
              /* Залогінений — dropdown */
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="gap-2">
                    <div className="w-6 h-6 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center">
                      <span className="text-amber-500 font-display font-bold text-xs">
                        {user?.first_name?.[0]?.toUpperCase() ?? "?"}
                      </span>
                    </div>
                    <span className="hidden sm:block text-sm">
                      {user?.first_name} {user?.last_name}
                    </span>
                    <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuLabel className="flex flex-col gap-0.5">
                    <span>{user?.first_name} {user?.last_name}</span>
                    <span className="text-xs font-normal text-muted-foreground">{user?.email}</span>
                    <span className="text-xs font-normal text-amber-500">
                      {ROLE_LABELS[user?.role ?? ""] ?? user?.role}
                    </span>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {isOrganizer && (
                    <DropdownMenuItem asChild>
                      <Link to="/tournaments"><Trophy className="w-4 h-4" />Мої турніри</Link>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem asChild>
                    <Link to="/athletes"><Users className="w-4 h-4" />Атлети</Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={handleLogout}
                  >
                    <LogOut className="w-4 h-4" />Вийти
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              /* Не залогінений — кнопка входу */
              <Button asChild variant="sport" size="sm">
                <Link to="/login">
                  <LogIn className="w-4 h-4" /> Увійти
                </Link>
              </Button>
            )}

            {/* Мобільне меню */}
            <Button
              variant="ghost" size="icon" className="md:hidden"
              onClick={() => setMobileOpen(!mobileOpen)}
            >
              {mobileOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </Button>
          </div>
        </div>

        {/* Мобільна навігація */}
        {mobileOpen && (
          <div className="md:hidden border-t border-border/50 bg-background px-4 py-3 flex flex-col gap-3 animate-fade-in">
            <NavLink to="/tournaments" className="text-sm font-medium py-1" onClick={() => setMobileOpen(false)}>
              Турніри
            </NavLink>
            {isAuthenticated && (
              <NavLink to="/athletes" className="text-sm font-medium py-1" onClick={() => setMobileOpen(false)}>
                Атлети
              </NavLink>
            )}
            {judgeTatami && (
              <NavLink
                to={`/operator/tournament/${judgeTatami.tournament}/tatami/${judgeTatami.number}`}
                className="text-sm font-medium py-1 text-amber-500 font-bold"
                onClick={() => setMobileOpen(false)}
              >
                Мій татамі
              </NavLink>
            )}
            {!isAuthenticated && (
              <Link to="/login" className="text-sm font-medium py-1 text-amber-500" onClick={() => setMobileOpen(false)}>
                Увійти
              </Link>
            )}
          </div>
        )}
      </header>

      {/* ── Основний контент ── */}
      <main className="flex-1 page-enter">
        <Outlet />
      </main>

      {/* ── Футер ── */}
      <footer className="border-t border-border/30 py-4">
        <div className="container text-center text-xs text-muted-foreground/50">
          TournamentApp — система проведення турнірних змагань з єдиноборств
        </div>
      </footer>
    </div>
  );
}
