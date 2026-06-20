import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Trophy, Users, Award, ShieldAlert, Clock, Search, MapPin } from "lucide-react";
import api from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

interface ClubStanding {
  club_id: number;
  club_name: string;
  region: string;
  region_name: string;
  gold: number;
  silver: number;
  bronze: number;
  total_medals: number;
  points: number;
  athletes_count: number;
}

interface RegionStanding {
  region_code: string;
  region_name: string;
  gold: number;
  silver: number;
  bronze: number;
  total_medals: number;
  points: number;
  athletes_count: number;
  clubs_count: number;
}

interface GenderSplitInfo {
  count: number;
  percentage: number;
}

interface CategorySplitInfo {
  category_id: number;
  category_name: string;
  count: number;
}

interface WinMethodCount {
  method: string;
  label: string;
  count: number;
}

interface TournamentStats {
  club_standings: ClubStanding[];
  region_standings: RegionStanding[];
  general_stats: {
    total_athletes: number;
    total_clubs: number;
    total_regions: number;
    gender_split: {
      male: GenderSplitInfo;
      female: GenderSplitInfo;
    };
    category_split: CategorySplitInfo[];
  };
  match_stats: {
    total_matches: number;
    completed_matches: number;
    average_duration_seconds: number;
    win_methods: WinMethodCount[];
  };
}

export default function TournamentStatistics({ tournamentId }: { tournamentId: number }) {
  const [stats, setStats] = useState<TournamentStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get("subtab") as "regions" | "clubs" | "general" | "matches") || "regions";

  const setActiveTab = (tab: "regions" | "clubs" | "general" | "matches") => {
    setSearchParams((prev) => {
      prev.set("subtab", tab);
      return prev;
    }, { replace: true });
  };

  // Фільтри
  const [clubSearch, setClubSearch] = useState("");
  const [regionSearch, setRegionSearch] = useState("");
  const [categorySearch, setCategorySearch] = useState("");

  useEffect(() => {
    setIsLoading(true);
    api.get(`/tournaments/${tournamentId}/statistics/`)
      .then((res) => {
        setStats(res.data);
        setError(null);
      })
      .catch((err) => {
        console.error(err);
        setError("Не вдалося завантажити статистику турніру.");
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [tournamentId]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <div className="w-8 h-8 rounded-full border-2 border-amber-500 border-t-transparent animate-spin" />
        <p className="text-sm text-muted-foreground animate-pulse">Завантаження статистики турніру...</p>
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3 text-center border border-zinc-800 rounded-xl bg-zinc-950/20">
        <ShieldAlert className="w-10 h-10 text-red-500" />
        <p className="text-sm text-zinc-300 font-medium">{error || "Дані статистики недоступні."}</p>
      </div>
    );
  }

  // Фільтрування списків
  const filteredClubs = stats.club_standings.filter(c =>
    c.club_name.toLowerCase().includes(clubSearch.toLowerCase()) ||
    c.region_name.toLowerCase().includes(clubSearch.toLowerCase())
  );

  const filteredRegions = stats.region_standings.filter(r =>
    r.region_name.toLowerCase().includes(regionSearch.toLowerCase())
  );

  const filteredCategories = stats.general_stats.category_split.filter(c =>
    c.category_name.toLowerCase().includes(categorySearch.toLowerCase())
  );

  // Допоміжна розмітка для медалі
  const renderMedalBadge = (place: number) => {
    if (place === 1) {
      return (
        <span className="flex items-center justify-center w-6 h-6 rounded-full bg-yellow-500/20 text-yellow-500 border border-yellow-500/40 text-xs font-bold shadow-[0_0_8px_rgba(234,179,8,0.1)]">
          1
        </span>
      );
    }
    if (place === 2) {
      return (
        <span className="flex items-center justify-center w-6 h-6 rounded-full bg-zinc-400/20 text-zinc-300 border border-zinc-400/40 text-xs font-bold">
          2
        </span>
      );
    }
    if (place === 3) {
      return (
        <span className="flex items-center justify-center w-6 h-6 rounded-full bg-amber-700/20 text-amber-600 border border-amber-700/40 text-xs font-bold">
          3
        </span>
      );
    }
    return <span className="text-xs text-muted-foreground font-medium px-2">{place}</span>;
  };

  return (
    <div className="space-y-6">
      {/* ── Загальні картки статистики ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Атлети */}
        <div className="p-4 rounded-xl border border-zinc-800/80 bg-zinc-900/20 backdrop-blur-sm relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-3 text-amber-500/10 group-hover:text-amber-500/20 transition-colors">
            <Users className="w-12 h-12" />
          </div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Учасники</p>
          <p className="text-3xl font-display font-bold text-zinc-100 mt-2">{stats.general_stats.total_athletes}</p>
          <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
            <span className="text-blue-400 font-medium">Ч: {stats.general_stats.gender_split.male.count} ({stats.general_stats.gender_split.male.percentage}%)</span>
            <span>•</span>
            <span className="text-pink-400 font-medium">Ж: {stats.general_stats.gender_split.female.count} ({stats.general_stats.gender_split.female.percentage}%)</span>
          </div>
        </div>

        {/* Клуби */}
        <div className="p-4 rounded-xl border border-zinc-800/80 bg-zinc-900/20 backdrop-blur-sm relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-3 text-amber-500/10 group-hover:text-amber-500/20 transition-colors">
            <Trophy className="w-12 h-12" />
          </div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Клуби</p>
          <p className="text-3xl font-display font-bold text-zinc-100 mt-2">{stats.general_stats.total_clubs}</p>
          <p className="text-xs text-muted-foreground mt-2">Представлено спортивних клубів</p>
        </div>

        {/* Області */}
        <div className="p-4 rounded-xl border border-zinc-800/80 bg-zinc-900/20 backdrop-blur-sm relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-3 text-amber-500/10 group-hover:text-amber-500/20 transition-colors">
            <MapPin className="w-12 h-12" />
          </div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Області</p>
          <p className="text-3xl font-display font-bold text-zinc-100 mt-2">{stats.general_stats.total_regions}</p>
          <p className="text-xs text-muted-foreground mt-2">Регіонів України на турнірі</p>
        </div>

        {/* Поєдинки */}
        <div className="p-4 rounded-xl border border-zinc-800/80 bg-zinc-900/20 backdrop-blur-sm relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-3 text-amber-500/10 group-hover:text-amber-500/20 transition-colors">
            <Clock className="w-12 h-12" />
          </div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Поєдинки</p>
          <p className="text-3xl font-display font-bold text-zinc-100 mt-2">
            {stats.match_stats.completed_matches}
            <span className="text-lg text-muted-foreground font-normal"> / {stats.match_stats.total_matches}</span>
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            {stats.match_stats.average_duration_seconds > 0
              ? `Сер. тривалість: ${Math.floor(stats.match_stats.average_duration_seconds / 60)} хв ${stats.match_stats.average_duration_seconds % 60} сек`
              : "Матчі ще не розпочались"}
          </p>
        </div>
      </div>

      {/* ── Навігація вкладками статистики ── */}
      <div className="flex flex-wrap items-center border-b border-zinc-800 bg-zinc-950 p-1 rounded-xl">
        <button
          onClick={() => setActiveTab("regions")}
          className={`flex-1 min-w-[120px] py-2 px-3 text-xs sm:text-sm font-semibold rounded-lg transition-all ${
            activeTab === "regions"
              ? "bg-zinc-800 text-amber-500 shadow-sm"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          Рейтинг областей
        </button>
        <button
          onClick={() => setActiveTab("clubs")}
          className={`flex-1 min-w-[120px] py-2 px-3 text-xs sm:text-sm font-semibold rounded-lg transition-all ${
            activeTab === "clubs"
              ? "bg-zinc-800 text-amber-500 shadow-sm"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          Клубний залік
        </button>
        <button
          onClick={() => setActiveTab("general")}
          className={`flex-1 min-w-[120px] py-2 px-3 text-xs sm:text-sm font-semibold rounded-lg transition-all ${
            activeTab === "general"
              ? "bg-zinc-800 text-amber-500 shadow-sm"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          Учасники & Категорії
        </button>
        <button
          onClick={() => setActiveTab("matches")}
          className={`flex-1 min-w-[120px] py-2 px-3 text-xs sm:text-sm font-semibold rounded-lg transition-all ${
            activeTab === "matches"
              ? "bg-zinc-800 text-amber-500 shadow-sm"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          Аналітика матчів
        </button>
      </div>

      {/* ── Контент вкладки: Рейтинг областей ── */}
      {activeTab === "regions" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <h3 className="font-semibold text-zinc-200 text-lg flex items-center gap-2">
              <Award className="w-5 h-5 text-amber-500" /> Медальний залік областей
            </h3>
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Пошук області..."
                value={regionSearch}
                onChange={(e) => setRegionSearch(e.target.value)}
                className="pl-9 h-9 bg-zinc-950 border-zinc-800 text-zinc-100 placeholder:text-zinc-500"
              />
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-950/40">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-950/80 text-zinc-400 font-semibold">
                  <th className="py-3 px-4 w-16 text-center">Місце</th>
                  <th className="py-3 px-4">Область</th>
                  <th className="py-3 px-4 text-center">Золото (7б)</th>
                  <th className="py-3 px-4 text-center">Срібло (5б)</th>
                  <th className="py-3 px-4 text-center">Бронза (3б)</th>
                  <th className="py-3 px-4 text-center">Всього медалей</th>
                  <th className="py-3 px-4 text-center">Атлети</th>
                  <th className="py-3 px-4 text-center">Клуби</th>
                  <th className="py-3 px-4 text-right">Сума балів</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {filteredRegions.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-8 text-center text-muted-foreground">
                      Немає даних для відображення
                    </td>
                  </tr>
                ) : (
                  filteredRegions.map((reg, idx) => (
                    <tr key={reg.region_code} className="hover:bg-zinc-900/30 transition-colors">
                      <td className="py-3 px-4 font-semibold text-center">{renderMedalBadge(idx + 1)}</td>
                      <td className="py-3 px-4 font-semibold text-zinc-200">{reg.region_name}</td>
                      <td className="py-3 px-4 text-center font-bold text-yellow-500/90">{reg.gold || "-"}</td>
                      <td className="py-3 px-4 text-center font-bold text-zinc-300">{reg.silver || "-"}</td>
                      <td className="py-3 px-4 text-center font-bold text-amber-600">{reg.bronze || "-"}</td>
                      <td className="py-3 px-4 text-center font-semibold text-zinc-300">{reg.total_medals || "-"}</td>
                      <td className="py-3 px-4 text-center text-zinc-400">{reg.athletes_count}</td>
                      <td className="py-3 px-4 text-center text-zinc-400">{reg.clubs_count}</td>
                      <td className="py-3 px-4 text-right font-display font-bold text-amber-500">{reg.points}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Контент вкладки: Клубний залік ── */}
      {activeTab === "clubs" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <h3 className="font-semibold text-zinc-200 text-lg flex items-center gap-2">
              <Trophy className="w-5 h-5 text-amber-500" /> Медальний залік клубів
            </h3>
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Пошук клубу..."
                value={clubSearch}
                onChange={(e) => setClubSearch(e.target.value)}
                className="pl-9 h-9 bg-zinc-950 border-zinc-800 text-zinc-100 placeholder:text-zinc-500"
              />
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-950/40">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-950/80 text-zinc-400 font-semibold">
                  <th className="py-3 px-4 w-16 text-center">Місце</th>
                  <th className="py-3 px-4">Назва клубу</th>
                  <th className="py-3 px-4">Регіон</th>
                  <th className="py-3 px-4 text-center">Золото (7б)</th>
                  <th className="py-3 px-4 text-center">Срібло (5б)</th>
                  <th className="py-3 px-4 text-center">Бронза (3б)</th>
                  <th className="py-3 px-4 text-center">Всього</th>
                  <th className="py-3 px-4 text-center">Бійці</th>
                  <th className="py-3 px-4 text-right">Сума балів</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {filteredClubs.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-8 text-center text-muted-foreground">
                      Клуби не знайдені
                    </td>
                  </tr>
                ) : (
                  filteredClubs.map((club, idx) => (
                    <tr key={club.club_id} className="hover:bg-zinc-900/30 transition-colors">
                      <td className="py-3 px-4 font-semibold text-center">{renderMedalBadge(idx + 1)}</td>
                      <td className="py-3 px-4 font-bold text-zinc-200">{club.club_name}</td>
                      <td className="py-3 px-4 text-zinc-400 text-xs">{club.region_name}</td>
                      <td className="py-3 px-4 text-center font-bold text-yellow-500/90">{club.gold || "-"}</td>
                      <td className="py-3 px-4 text-center font-bold text-zinc-300">{club.silver || "-"}</td>
                      <td className="py-3 px-4 text-center font-bold text-amber-600">{club.bronze || "-"}</td>
                      <td className="py-3 px-4 text-center font-semibold text-zinc-300">{club.total_medals || "-"}</td>
                      <td className="py-3 px-4 text-center text-zinc-400">{club.athletes_count}</td>
                      <td className="py-3 px-4 text-right font-display font-bold text-amber-500">{club.points}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Контент вкладки: Учасники та Категорії ── */}
      {activeTab === "general" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Склад за статтю та загальна зведена */}
          <div className="space-y-6">
            <div className="p-5 rounded-xl border border-zinc-800 bg-zinc-950/20 space-y-4">
              <h4 className="font-semibold text-zinc-200 text-base">Гендерний розподіл бійців</h4>
              <div className="space-y-2">
                <div className="flex justify-between text-xs font-semibold text-zinc-400">
                  <span>Чоловіки ({stats.general_stats.gender_split.male.count})</span>
                  <span>Жінки ({stats.general_stats.gender_split.female.count})</span>
                </div>
                {/* Градієнтна смуга розподілу */}
                <div className="h-3 rounded-full bg-zinc-800 flex overflow-hidden border border-zinc-700">
                  <div
                    className="bg-gradient-to-r from-blue-600 to-blue-400 transition-all duration-500"
                    style={{ width: `${stats.general_stats.gender_split.male.percentage}%` }}
                  />
                  <div
                    className="bg-gradient-to-r from-pink-400 to-pink-600 transition-all duration-500"
                    style={{ width: `${stats.general_stats.gender_split.female.percentage}%` }}
                  />
                </div>
                <div className="flex justify-between text-[11px] text-muted-foreground font-mono">
                  <span>{stats.general_stats.gender_split.male.percentage}%</span>
                  <span>{stats.general_stats.gender_split.female.percentage}%</span>
                </div>
              </div>
            </div>

            <div className="p-5 rounded-xl border border-zinc-800 bg-zinc-950/20 space-y-3">
              <h4 className="font-semibold text-zinc-200 text-base">Загальні відомості представництва</h4>
              <div className="grid grid-cols-2 gap-4">
                <div className="border border-zinc-800/50 bg-zinc-950/30 p-3 rounded-lg text-center">
                  <p className="text-xs text-muted-foreground">Бійців на клуб</p>
                  <p className="text-xl font-bold font-display text-zinc-200 mt-1">
                    {stats.general_stats.total_clubs > 0
                      ? (stats.general_stats.total_athletes / stats.general_stats.total_clubs).toFixed(1)
                      : 0}
                  </p>
                </div>
                <div className="border border-zinc-800/50 bg-zinc-950/30 p-3 rounded-lg text-center">
                  <p className="text-xs text-muted-foreground">Клубів на область</p>
                  <p className="text-xl font-bold font-display text-zinc-200 mt-1">
                    {stats.general_stats.total_regions > 0
                      ? (stats.general_stats.total_clubs / stats.general_stats.total_regions).toFixed(1)
                      : 0}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Кількість бійців по категоріях */}
          <div className="p-5 rounded-xl border border-zinc-800 bg-zinc-950/20 space-y-4 flex flex-col h-[350px]">
            <div className="flex items-center justify-between gap-4">
              <h4 className="font-semibold text-zinc-200 text-base shrink-0">Реєстрацій по категоріях</h4>
              <div className="relative w-44">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  placeholder="Фільтр категорій..."
                  value={categorySearch}
                  onChange={(e) => setCategorySearch(e.target.value)}
                  className="pl-8 h-8 bg-zinc-950 border-zinc-800 text-xs text-zinc-200"
                />
              </div>
            </div>
            <Separator className="bg-zinc-800/50" />
            <div className="flex-1 overflow-y-auto pr-1 space-y-2.5">
              {filteredCategories.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-8">Категорій не знайдено</p>
              ) : (
                filteredCategories.map((c) => (
                  <div key={c.category_id} className="flex items-center justify-between text-xs p-2 rounded bg-zinc-900/30 border border-zinc-800/40 hover:border-zinc-800 transition-colors">
                    <span className="font-medium text-zinc-300 truncate max-w-[240px]">{c.category_name}</span>
                    <Badge variant="outline" className="font-mono bg-zinc-950 border-zinc-800 text-zinc-300 shrink-0">
                      {c.count} чол.
                    </Badge>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Контент вкладки: Аналітика матчів ── */}
      {activeTab === "matches" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Статистика тривалості */}
          <div className="p-5 rounded-xl border border-zinc-800 bg-zinc-950/20 flex flex-col justify-center space-y-4">
            <h4 className="font-semibold text-zinc-200 text-base">Матчі турніру</h4>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-zinc-950/40 p-4 rounded-lg border border-zinc-800/60 text-center">
                <p className="text-xs text-zinc-400">Проведено матчів</p>
                <p className="text-3xl font-bold font-display text-amber-500 mt-2">
                  {stats.match_stats.completed_matches}
                </p>
                <p className="text-[10px] text-muted-foreground mt-1">з {stats.match_stats.total_matches} запланованих</p>
              </div>
              <div className="bg-zinc-950/40 p-4 rounded-lg border border-zinc-800/60 text-center">
                <p className="text-xs text-zinc-400">Сер. тривалість</p>
                <p className="text-3xl font-bold font-display text-zinc-100 mt-2">
                  {stats.match_stats.completed_matches > 0
                    ? `${Math.floor(stats.match_stats.average_duration_seconds / 60)}:${String(stats.match_stats.average_duration_seconds % 60).padStart(2, "0")}`
                    : "0:00"}
                </p>
                <p className="text-[10px] text-muted-foreground mt-1">хв:сек чистого часу</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground text-center">
              * Статистика оновлюється динамічно з суддівських панелей по мірі завершення двобоїв.
            </p>
          </div>

          {/* Розподіл за типом перемог */}
          <div className="p-5 rounded-xl border border-zinc-800 bg-zinc-950/20 space-y-4">
            <h4 className="font-semibold text-zinc-200 text-base">Способи завершення поєдинків</h4>
            <div className="space-y-3">
              {stats.match_stats.win_methods.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-8">Немає проведених поєдинків для аналізу</p>
              ) : (
                stats.match_stats.win_methods.map((wm) => {
                  const percentage = stats.match_stats.completed_matches > 0
                    ? Math.round((wm.count / stats.match_stats.completed_matches) * 100)
                    : 0;

                  return (
                    <div key={wm.method} className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="font-medium text-zinc-300">{wm.label}</span>
                        <span className="text-muted-foreground font-mono">{wm.count} ({percentage}%)</span>
                      </div>
                      <div className="h-2 rounded-full bg-zinc-900 overflow-hidden border border-zinc-800/50">
                        <div
                          className="bg-amber-500 h-full rounded-full transition-all duration-300"
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
