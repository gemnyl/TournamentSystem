import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Trophy, Search, ShieldAlert, MapPin, ChevronRight, HelpCircle } from "lucide-react";
import api from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface ClubRating {
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
  tournaments_count: number;
}

interface RegionRating {
  region_code: string;
  region_name: string;
  gold: number;
  silver: number;
  bronze: number;
  total_medals: number;
  points: number;
  athletes_count: number;
  clubs_count: number;
  tournaments_count: number;
}

interface GlobalRatingsData {
  club_ratings: ClubRating[];
  region_ratings: RegionRating[];
}

export default function GlobalRatingsPage() {
  const [ratings, setRatings] = useState<GlobalRatingsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get("tab") as "regions" | "clubs") || "regions";

  const setActiveTab = (tab: "regions" | "clubs") => {
    setSearchParams((prev) => {
      prev.set("tab", tab);
      return prev;
    }, { replace: true });
  };

  // Фільтри
  const [clubSearch, setClubSearch] = useState("");
  const [regionSearch, setRegionSearch] = useState("");

  useEffect(() => {
    setIsLoading(true);
    api.get("/tournaments/global-ratings/")
      .then((res) => {
        setRatings(res.data);
        setError(null);
      })
      .catch((err) => {
        console.error(err);
        setError("Не вдалося завантажити глобальні рейтинги.");
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  if (isLoading) {
    return (
      <div className="container min-h-[60vh] flex flex-col items-center justify-center gap-3">
        <div className="w-10 h-10 rounded-full border-2 border-amber-500 border-t-transparent animate-spin" />
        <p className="text-sm text-muted-foreground animate-pulse">Завантаження загальних рейтингів України...</p>
      </div>
    );
  }

  if (error || !ratings) {
    return (
      <div className="container py-12 flex justify-center">
        <div className="max-w-md w-full p-6 text-center border border-zinc-800 rounded-2xl bg-zinc-950/20 space-y-4">
          <ShieldAlert className="w-12 h-12 text-red-500 mx-auto" />
          <h3 className="text-lg font-semibold text-zinc-200">Помилка завантаження</h3>
          <p className="text-sm text-muted-foreground">{error || "Будь ласка, спробуйте пізніше."}</p>
        </div>
      </div>
    );
  }

  const filteredClubs = ratings.club_ratings.filter(c =>
    c.club_name.toLowerCase().includes(clubSearch.toLowerCase()) ||
    c.region_name.toLowerCase().includes(clubSearch.toLowerCase())
  );

  const filteredRegions = ratings.region_ratings.filter(r =>
    r.region_name.toLowerCase().includes(regionSearch.toLowerCase())
  );

  const renderMedalBadge = (place: number) => {
    if (place === 1) {
      return (
        <span className="flex items-center justify-center w-6 h-6 rounded-full bg-yellow-500/20 text-yellow-500 border border-yellow-500/40 text-xs font-bold shadow-[0_0_10px_rgba(234,179,8,0.15)]">
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
    return <span className="text-xs text-muted-foreground font-semibold px-2">{place}</span>;
  };

  return (
    <div className="container py-8 space-y-8 animate-in fade-in duration-300">
      {/* ── Заголовок сторінки ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-zinc-800/60 pb-6">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-amber-500 font-medium text-sm">
            <span>Аналітика змагань</span>
            <ChevronRight className="w-3.5 h-3.5" />
            <span>Глобальний залік</span>
          </div>
          <h1 className="font-display text-3xl font-extrabold tracking-tight text-zinc-100 flex items-center gap-3">
            <Trophy className="w-8 h-8 text-amber-500" /> Рейтинг України
          </h1>
          <p className="text-sm text-muted-foreground">
            Загальнонаціональний рейтинг областей та спортивних клубів на основі медалей усіх завершених турнірів
          </p>
        </div>

        <TooltipProvider>
          <div className="flex items-center gap-2 text-xs text-muted-foreground bg-zinc-900/40 border border-zinc-800 p-2.5 rounded-lg max-w-xs shrink-0 self-start md:self-auto">
            <span>Система нарахування балів:</span>
            <Tooltip>
              <TooltipTrigger className="text-amber-500 hover:text-amber-400 focus:outline-none flex items-center gap-1 font-semibold">
                7–5–3 <HelpCircle className="w-3.5 h-3.5" />
              </TooltipTrigger>
              <TooltipContent className="bg-zinc-950 border border-zinc-800 text-zinc-300 text-xs p-3 space-y-1 max-w-[280px]">
                <p className="font-bold text-zinc-100 border-b border-zinc-800 pb-1 mb-1">Медальні очки:</p>
                <p>• Золота медаль: <strong>7 балів</strong></p>
                <p>• Срібна медаль: <strong>5 балів</strong></p>
                <p>• Бронзова медаль: <strong>3 бали</strong></p>
                <p className="text-[10px] text-muted-foreground mt-1.5 pt-1.5 border-t border-zinc-800">
                  У командних категоріях зараховується одна загальнокомандна медаль для клубу/області.
                </p>
              </TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
      </div>

      {/* ── Панель перемикання та фільтрації ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 rounded-2xl border border-zinc-800 bg-zinc-900/30 backdrop-blur-md">
        {/* Таби */}
        <div className="flex bg-zinc-950 p-1 rounded-xl w-full md:w-80 border border-zinc-800/50">
          <button
            onClick={() => setActiveTab("regions")}
            className={`flex-1 py-2 px-3 text-xs sm:text-sm font-semibold rounded-lg transition-all ${
              activeTab === "regions"
                ? "bg-zinc-800 text-amber-500 shadow-sm"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <MapPin className="w-4 h-4 inline mr-1.5 -mt-0.5" /> Рейтинг областей
          </button>
          <button
            onClick={() => setActiveTab("clubs")}
            className={`flex-1 py-2 px-3 text-xs sm:text-sm font-semibold rounded-lg transition-all ${
              activeTab === "clubs"
                ? "bg-zinc-800 text-amber-500 shadow-sm"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <Trophy className="w-4 h-4 inline mr-1.5 -mt-0.5" /> Рейтинг клубів
          </button>
        </div>

        {/* Пошук */}
        <div className="relative w-full md:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder={activeTab === "regions" ? "Пошук області..." : "Пошук клубу чи області..."}
            value={activeTab === "regions" ? regionSearch : clubSearch}
            onChange={(e) => activeTab === "regions" ? setRegionSearch(e.target.value) : setClubSearch(e.target.value)}
            className="pl-9 h-10 bg-zinc-950 border-zinc-800 text-zinc-100 placeholder:text-zinc-500 focus-visible:ring-amber-500/50"
          />
        </div>
      </div>

      {/* ── Таблиця: Рейтинг областей ── */}
      {activeTab === "regions" && (
        <div className="space-y-4">
          <div className="overflow-x-auto rounded-2xl border border-zinc-800/80 bg-zinc-950/20 backdrop-blur-md">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-950/80 text-zinc-400 font-semibold">
                  <th className="py-3.5 px-4 w-20 text-center">Місце</th>
                  <th className="py-3.5 px-4">Область України</th>
                  <th className="py-3.5 px-4 text-center">Золото (7б)</th>
                  <th className="py-3.5 px-4 text-center">Срібло (5б)</th>
                  <th className="py-3.5 px-4 text-center">Бронза (3б)</th>
                  <th className="py-3.5 px-4 text-center">Всього нагород</th>
                  <th className="py-3.5 px-4 text-center">Клуби</th>
                  <th className="py-3.5 px-4 text-center">Бійці</th>
                  <th className="py-3.5 px-4 text-center">Турніри</th>
                  <th className="py-3.5 px-4 text-right">Сума балів</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/50">
                {filteredRegions.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="py-12 text-center text-muted-foreground text-sm">
                      Області за вашим запитом не знайдені
                    </td>
                  </tr>
                ) : (
                  filteredRegions.map((reg, idx) => (
                    <tr key={reg.region_code} className="hover:bg-zinc-900/30 transition-colors">
                      <td className="py-3.5 px-4 font-semibold text-center">{renderMedalBadge(idx + 1)}</td>
                      <td className="py-3.5 px-4 font-bold text-zinc-200 text-base">{reg.region_name}</td>
                      <td className="py-3.5 px-4 text-center font-bold text-yellow-500/90 text-sm">{reg.gold || "-"}</td>
                      <td className="py-3.5 px-4 text-center font-bold text-zinc-300 text-sm">{reg.silver || "-"}</td>
                      <td className="py-3.5 px-4 text-center font-bold text-amber-600 text-sm">{reg.bronze || "-"}</td>
                      <td className="py-3.5 px-4 text-center font-semibold text-zinc-300">{reg.total_medals || "-"}</td>
                      <td className="py-3.5 px-4 text-center text-zinc-400">{reg.clubs_count}</td>
                      <td className="py-3.5 px-4 text-center text-zinc-400">{reg.athletes_count}</td>
                      <td className="py-3.5 px-4 text-center text-zinc-400">{reg.tournaments_count}</td>
                      <td className="py-3.5 px-4 text-right font-display font-extrabold text-base text-amber-500">{reg.points}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Таблиця: Рейтинг клубів ── */}
      {activeTab === "clubs" && (
        <div className="space-y-4">
          <div className="overflow-x-auto rounded-2xl border border-zinc-800/80 bg-zinc-950/20 backdrop-blur-md">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-950/80 text-zinc-400 font-semibold">
                  <th className="py-3.5 px-4 w-20 text-center">Місце</th>
                  <th className="py-3.5 px-4">Спортивний клуб</th>
                  <th className="py-3.5 px-4">Регіональна приналежність</th>
                  <th className="py-3.5 px-4 text-center">Золото (7б)</th>
                  <th className="py-3.5 px-4 text-center">Срібло (5б)</th>
                  <th className="py-3.5 px-4 text-center">Бронза (3б)</th>
                  <th className="py-3.5 px-4 text-center">Всього</th>
                  <th className="py-3.5 px-4 text-center">Бійці</th>
                  <th className="py-3.5 px-4 text-center">Турніри</th>
                  <th className="py-3.5 px-4 text-right">Сума балів</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/50">
                {filteredClubs.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="py-12 text-center text-muted-foreground text-sm">
                      Спортивні клуби за вашим запитом не знайдені
                    </td>
                  </tr>
                ) : (
                  filteredClubs.map((club, idx) => (
                    <tr key={club.club_id} className="hover:bg-zinc-900/30 transition-colors">
                      <td className="py-3.5 px-4 font-semibold text-center">{renderMedalBadge(idx + 1)}</td>
                      <td className="py-3.5 px-4 font-extrabold text-zinc-200 text-base">{club.club_name}</td>
                      <td className="py-3.5 px-4 text-zinc-400 text-xs font-medium">{club.region_name}</td>
                      <td className="py-3.5 px-4 text-center font-bold text-yellow-500/90 text-sm">{club.gold || "-"}</td>
                      <td className="py-3.5 px-4 text-center font-bold text-zinc-300 text-sm">{club.silver || "-"}</td>
                      <td className="py-3.5 px-4 text-center font-bold text-amber-600 text-sm">{club.bronze || "-"}</td>
                      <td className="py-3.5 px-4 text-center font-semibold text-zinc-300">{club.total_medals || "-"}</td>
                      <td className="py-3.5 px-4 text-center text-zinc-400">{club.athletes_count}</td>
                      <td className="py-3.5 px-4 text-center text-zinc-400">{club.tournaments_count}</td>
                      <td className="py-3.5 px-4 text-right font-display font-extrabold text-base text-amber-500">{club.points}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
