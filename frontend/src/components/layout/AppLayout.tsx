import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { Trophy, Users, LogOut, ChevronDown, Menu, X, LogIn, Loader2 } from "lucide-react";
import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { Tatami } from "@/types/api";

const ROLE_LABELS: Record<string, string> = {
  organizer: "Організатор",
  coach:     "Тренер",
  judge:     "Суддя",
  spectator: "Глядач",
  staff:     "Персонал",
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
  const [judgeTatamis, setJudgeTatamis] = useState<Tatami[]>([]);

  // Перевіряємо сесію один раз при старті
  useEffect(() => {
    fetchMe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isAuthenticated && user?.role === "judge") {
      api.get<Tatami[]>("/tatamis/")
        .then((res) => {
          const list = Array.isArray(res.data) ? res.data : (res.data as { results: Tatami[] }).results || [];
          const assigned = list.filter((t: Tatami) => t.assigned_judge === user.id && t.tournament_status !== "completed");
          // Сортуємо активні турніри спочатку
          const sorted = [...assigned].sort((a, b) => {
            if (a.tournament_status === "active" && b.tournament_status !== "active") return -1;
            if (b.tournament_status === "active" && a.tournament_status !== "active") return 1;
            return 0;
          });
          setJudgeTatamis(sorted);
        })
        .catch(() => {});
    } else {
      setJudgeTatamis([]);
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
            <NavItem to="/ratings">Рейтинги</NavItem>
            {isAuthenticated && <NavItem to="/athletes">Атлети</NavItem>}
            {isAuthenticated && user?.role === "coach" && (
              <NavItem to="/coach/dashboard">Панель тренера</NavItem>
            )}
            {isAuthenticated && (user?.role === "staff" || user?.role === "organizer") && (
              <NavItem to="/staff">Панель секретаря</NavItem>
            )}
            {judgeTatamis.length === 1 && (
              <NavItem to={`/operator/tournament/${judgeTatamis[0].tournament}/tatami/${judgeTatamis[0].number}`}>
                Мій татамі ({judgeTatamis[0].number})
              </NavItem>
            )}
            {judgeTatamis.length > 1 && (
              <DropdownMenu>
                <DropdownMenuTrigger className="relative px-1 py-0.5 text-sm font-medium transition-colors text-muted-foreground hover:text-foreground flex items-center gap-1 focus-visible:outline-none">
                  Мої татамі <ChevronDown className="w-3.5 h-3.5" />
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56" align="start">
                  <DropdownMenuLabel>Ваші призначення</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {judgeTatamis.map((t) => (
                    <DropdownMenuItem key={t.id} asChild>
                      <Link to={`/operator/tournament/${t.tournament}/tatami/${t.number}`} className="flex items-center justify-between w-full">
                        <span className="truncate max-w-[160px] font-medium">
                          {t.tournament_title ?? `Турнір ${t.tournament}`}
                        </span>
                        <Badge variant="outline" className="ml-1 font-mono text-[10px] shrink-0">
                          Т. {t.number}
                        </Badge>
                      </Link>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
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
                      <Link to="/tournaments?my=true"><Trophy className="w-4 h-4" />Мої турніри</Link>
                    </DropdownMenuItem>
                  )}
                  {user?.role === "coach" && (
                    <DropdownMenuItem asChild>
                      <Link to="/coach/dashboard"><Users className="w-4 h-4" />Панель тренера</Link>
                    </DropdownMenuItem>
                  )}
                  {(user?.role === "staff" || user?.role === "organizer") && (
                    <DropdownMenuItem asChild>
                      <Link to="/staff"><Users className="w-4 h-4" />Панель секретаря</Link>
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
            <NavLink to="/ratings" className="text-sm font-medium py-1" onClick={() => setMobileOpen(false)}>
              Рейтинги
            </NavLink>
            {isAuthenticated && (
              <NavLink to="/athletes" className="text-sm font-medium py-1" onClick={() => setMobileOpen(false)}>
                Атлети
              </NavLink>
            )}
            {isAuthenticated && user?.role === "coach" && (
              <NavLink to="/coach/dashboard" className="text-sm font-medium py-1" onClick={() => setMobileOpen(false)}>
                Панель тренера
              </NavLink>
            )}
            {isAuthenticated && (user?.role === "staff" || user?.role === "organizer") && (
              <NavLink to="/staff" className="text-sm font-medium py-1" onClick={() => setMobileOpen(false)}>
                Панель секретаря
              </NavLink>
            )}
            {judgeTatamis.length === 1 && (
              <NavLink
                to={`/operator/tournament/${judgeTatamis[0].tournament}/tatami/${judgeTatamis[0].number}`}
                className="text-sm font-medium py-1 text-amber-500 font-bold"
                onClick={() => setMobileOpen(false)}
              >
                Мій татамі ({judgeTatamis[0].number})
              </NavLink>
            )}
            {judgeTatamis.length > 1 && (
              <div className="flex flex-col gap-1.5 pl-3 border-l border-amber-500/20 py-1">
                <span className="text-xs text-muted-foreground font-semibold">Мої татамі:</span>
                {judgeTatamis.map((t) => (
                  <NavLink
                    key={t.id}
                    to={`/operator/tournament/${t.tournament}/tatami/${t.number}`}
                    className="text-sm font-medium text-amber-500/80 hover:text-amber-500 truncate"
                    onClick={() => setMobileOpen(false)}
                  >
                    {t.tournament_title ?? `Турнір ${t.tournament}`} (Т. {t.number})
                  </NavLink>
                ))}
              </div>
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
