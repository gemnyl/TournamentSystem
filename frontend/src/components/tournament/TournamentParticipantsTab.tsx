import { useEffect, useState, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import api from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Search, Loader2, ArrowUpDown, ChevronLeft, ChevronRight, Users, LayoutGrid, Building2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import type { Category, Tournament } from "@/types/api";

interface Club {
  id: number;
  name: string;
  region: string;
}

interface ParticipantRegistration {
  id: number;
  athlete?: {
    id: number;
    first_name: string;
    last_name: string;
    patronymic?: string;
    gender: "male" | "female";
    base_weight: number;
    skill_level?: string;
  };
  team?: {
    id: number;
    name: string;
    club?: {
      name: string;
    };
  };
  category: number;
  category_name: string;
  club_name: string;
  status: "pending" | "confirmed" | "rejected" | "withdrawn";
  payment_status: "unpaid" | "paid";
  offline_refund_status: "none" | "pending" | "confirmed";
  created_at: string;
}

interface TournamentParticipantsTabProps {
  tournament: Tournament;
  categories: Category[];
}

export default function TournamentParticipantsTab({ tournament, categories }: TournamentParticipantsTabProps) {
  const tournamentId = tournament.id;
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();

  const canSeeSensitiveInfo = useMemo(() => {
    if (!user) return false;
    return (
      user.role === "admin" ||
      tournament.organizer === user.id ||
      tournament.chief_judge === user.id ||
      tournament.staff_members?.includes(user.id)
    );
  }, [user, tournament]);

  // URL synced state
  const page = Number(searchParams.get("page")) || 1;
  const search = searchParams.get("search") || "";
  const ordering = searchParams.get("ordering") || "athlete__last_name";
  const filterCategory = searchParams.get("category") || "all";
  const filterClub = searchParams.get("club") || "all";
  const filterGender = searchParams.get("gender") || "all";

  // Local state
  const [localSearch, setLocalSearch] = useState(search);
  const [clubs, setClubs] = useState<Club[]>([]);
  const [registrations, setRegistrations] = useState<ParticipantRegistration[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [groupBy, setGroupBy] = useState<"none" | "club" | "category">("none");

  const pageSize = 15;

  const updateSearchParams = (updater: (params: URLSearchParams) => void) => {
    const nextParams = new URLSearchParams(searchParams);
    updater(nextParams);
    setSearchParams(nextParams, { replace: true });
  };

  // Fetch Clubs for filter list
  useEffect(() => {
    const fetchClubs = async () => {
      try {
        const { data } = await api.get<Club[] | { results: Club[] }>("/auth/clubs/");
        const list = Array.isArray(data) ? data : data.results || [];
        setClubs(list);
      } catch (err) {
        console.error("Failed to load clubs", err);
      }
    };
    fetchClubs();
  }, []);

  // Sync debounced search to URL
  useEffect(() => {
    const timer = setTimeout(() => {
      if (localSearch !== search) {
        updateSearchParams((params) => {
          if (localSearch) {
            params.set("search", localSearch);
          } else {
            params.delete("search");
          }
          params.set("page", "1"); // Reset to page 1
        });
      }
    }, 400);

    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localSearch]);

  // Sync search local state if URL changes externally
  useEffect(() => {
    setLocalSearch(search);
  }, [search]);

  // Fetch registrations from Backend
  useEffect(() => {
    const fetchRegistrations = async () => {
      setIsLoading(true);
      try {
        const queryParams = new URLSearchParams();
        queryParams.set("tournament", String(tournamentId));
        queryParams.set("page", String(page));
        queryParams.set("page_size", String(pageSize));

        if (search) queryParams.set("search", search);
        if (ordering) queryParams.set("ordering", ordering);
        if (filterCategory !== "all") queryParams.set("category", filterCategory);
        if (filterClub !== "all") queryParams.set("athlete__club", filterClub);
        if (filterGender !== "all") queryParams.set("athlete__gender", filterGender);

        const { data } = await api.get<{ count: number; results: ParticipantRegistration[] }>(
          `/registrations/?${queryParams.toString()}`
        );
        setRegistrations(data.results || []);
        setTotalCount(data.count || 0);
      } catch (err) {
        console.error("Failed to load registrations", err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchRegistrations();
  }, [tournamentId, page, search, ordering, filterCategory, filterClub, filterGender]);

  // Filters change handler
  const handleFilterChange = (key: string, value: string) => {
    updateSearchParams((params) => {
      if (value && value !== "all") {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      params.set("page", "1"); // Reset page to 1
    });
  };

  // Sorting handler
  const handleSort = (field: string) => {
    updateSearchParams((params) => {
      const currentOrdering = params.get("ordering") || "athlete__last_name";
      let nextOrdering = field;
      if (currentOrdering === field) {
        nextOrdering = `-${field}`;
      }
      params.set("ordering", nextOrdering);
    });
  };

  // Pagination helper
  const totalPages = Math.ceil(totalCount / pageSize) || 1;

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      updateSearchParams((params) => {
        params.set("page", String(newPage));
      });
    }
  };

  // Client-side grouping
  const groupedResults = useMemo(() => {
    if (groupBy === "none") return null;
    const groups: Record<string, ParticipantRegistration[]> = {};
    registrations.forEach((reg) => {
      const key = groupBy === "club" ? reg.club_name : reg.category_name;
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(reg);
    });
    return groups;
  }, [registrations, groupBy]);

  const getStatusBadge = (status: ParticipantRegistration["status"]) => {
    const configs = {
      pending: { label: "Очікує", className: "border-yellow-500/30 text-yellow-500 bg-yellow-500/5" },
      confirmed: { label: "Підтверджено", className: "border-green-500/30 text-green-500 bg-green-500/5" },
      rejected: { label: "Відхилено", className: "border-red-500/30 text-red-500 bg-red-500/5" },
      withdrawn: { label: "Знято", className: "border-zinc-500/30 text-zinc-400 bg-zinc-500/5" },
    };
    const c = configs[status] || configs.pending;
    return (
      <Badge variant="outline" className={`font-semibold rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider ${c.className}`}>
        {c.label}
      </Badge>
    );
  };

  const getPaymentBadge = (status: ParticipantRegistration["payment_status"]) => {
    return status === "paid" ? (
      <Badge variant="outline" className="border-green-500/30 text-green-500 bg-green-500/5 font-semibold rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider">
        Сплачено
      </Badge>
    ) : (
      <Badge variant="outline" className="border-red-500/30 text-red-400 bg-red-500/5 font-semibold rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider">
        Борг
      </Badge>
    );
  };

  const renderSortHeader = (label: string, field: string) => {
    const isSorted = ordering.replace("-", "") === field;
    const isDesc = ordering.startsWith("-");
    return (
      <button
        onClick={() => handleSort(field)}
        className={`inline-flex items-center gap-1 hover:text-zinc-200 transition-colors ${
          isSorted ? "text-amber-500 font-semibold" : ""
        }`}
      >
        {label}
        <ArrowUpDown className={`w-3 h-3 ${isSorted ? (isDesc ? "rotate-180" : "") : "opacity-30"}`} />
      </button>
    );
  };

  const renderTableRows = (items: ParticipantRegistration[]) => {
    return items.map((reg) => {
      const isTeam = !!reg.team;
      const participantName = isTeam
        ? reg.team?.name || "Команда"
        : reg.athlete
        ? `${reg.athlete.last_name} ${reg.athlete.first_name} ${reg.athlete.patronymic || ""}`
        : "—";

      const genderLabel = isTeam
        ? "—"
        : reg.athlete?.gender === "male"
        ? "Чоловік"
        : reg.athlete?.gender === "female"
        ? "Жінка"
        : "—";

      const weightLabel = isTeam ? "—" : reg.athlete ? `${reg.athlete.base_weight} кг` : "—";

      return (
        <TableRow key={reg.id} className="border-b border-zinc-800/60 hover:bg-zinc-900/20">
          <TableCell className="font-semibold text-zinc-200 max-w-[200px] truncate">
            {participantName}
          </TableCell>
          <TableCell className="text-zinc-300 truncate max-w-[150px]">{reg.club_name}</TableCell>
          <TableCell className="text-zinc-400 text-xs">{genderLabel}</TableCell>
          <TableCell className="text-zinc-400 text-xs font-mono">{weightLabel}</TableCell>
          <TableCell className="text-zinc-300 font-medium truncate max-w-[200px]">{reg.category_name}</TableCell>
          {canSeeSensitiveInfo && <TableCell className="text-center">{getStatusBadge(reg.status)}</TableCell>}
          {canSeeSensitiveInfo && <TableCell className="text-center">{getPaymentBadge(reg.payment_status)}</TableCell>}
        </TableRow>
      );
    });
  };

  return (
    <div className="space-y-6">
      {/* Фільтри та пошук */}
      <div className="p-4 rounded-xl border border-zinc-800/80 bg-zinc-900/30 backdrop-blur-md space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {/* Пошук */}
          <div className="relative col-span-1 md:col-span-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Пошук за ім'ям або клубом..."
              value={localSearch}
              onChange={(e) => setLocalSearch(e.target.value)}
              className="pl-9 bg-zinc-950 border-zinc-800 text-zinc-100 placeholder:text-zinc-500 focus-visible:ring-amber-500/50"
            />
          </div>

          {/* Вибір Категорії */}
          <div className="space-y-1">
            <Select value={filterCategory} onValueChange={(v) => handleFilterChange("category", v)}>
              <SelectTrigger className="bg-zinc-950 border-zinc-800 text-zinc-200 focus:ring-amber-500/50">
                <SelectValue placeholder="Всі категорії" />
              </SelectTrigger>
              <SelectContent className="bg-zinc-950 border-zinc-800 text-zinc-200 max-h-60">
                <SelectItem value="all">Всі категорії</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Вибір Статі */}
          <div className="space-y-1">
            <Select value={filterGender} onValueChange={(v) => handleFilterChange("gender", v)}>
              <SelectTrigger className="bg-zinc-950 border-zinc-800 text-zinc-200 focus:ring-amber-500/50">
                <SelectValue placeholder="Будь-яка стать" />
              </SelectTrigger>
              <SelectContent className="bg-zinc-950 border-zinc-800 text-zinc-200">
                <SelectItem value="all">Будь-яка стать</SelectItem>
                <SelectItem value="male">Чоловіки</SelectItem>
                <SelectItem value="female">Жінки</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-zinc-800/40">
          <div className="flex flex-wrap items-center gap-3">
            {/* Вибір Клубу */}
            <div className="w-56">
              <Select value={filterClub} onValueChange={(v) => handleFilterChange("club", v)}>
                <SelectTrigger className="h-8 bg-zinc-950 border-zinc-800 text-zinc-200 focus:ring-amber-500/50 text-xs">
                  <SelectValue placeholder="Всі клуби" />
                </SelectTrigger>
                <SelectContent className="bg-zinc-950 border-zinc-800 text-zinc-200 max-h-60">
                  <SelectItem value="all">Всі клуби</SelectItem>
                  {clubs.map((club) => (
                    <SelectItem key={club.id} value={String(club.id)}>
                      {club.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Групування */}
            <div className="flex items-center gap-1 bg-zinc-950 p-0.5 rounded-lg border border-zinc-800 h-8">
              <button
                onClick={() => setGroupBy("none")}
                className={`flex items-center gap-1 px-2.5 py-0.5 text-[11px] font-semibold rounded-md transition-all ${
                  groupBy === "none"
                    ? "bg-zinc-800 text-amber-500 shadow-sm"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <LayoutGrid className="w-3 h-3" />
                Без групування
              </button>
              <button
                onClick={() => setGroupBy("club")}
                className={`flex items-center gap-1 px-2.5 py-0.5 text-[11px] font-semibold rounded-md transition-all ${
                  groupBy === "club"
                    ? "bg-zinc-800 text-amber-500 shadow-sm"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <Building2 className="w-3 h-3" />
                По клубах
              </button>
              <button
                onClick={() => setGroupBy("category")}
                className={`flex items-center gap-1 px-2.5 py-0.5 text-[11px] font-semibold rounded-md transition-all ${
                  groupBy === "category"
                    ? "bg-zinc-800 text-amber-500 shadow-sm"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <Users className="w-3 h-3" />
                По категоріях
              </button>
            </div>
          </div>

          <div className="text-xs text-muted-foreground font-semibold">
            Знайдено учасників: <span className="text-zinc-200">{totalCount}</span>
          </div>
        </div>
      </div>

      {/* Таблиця учасників */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
        </div>
      ) : registrations.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3 border border-dashed border-zinc-800 rounded-xl">
          <Users className="w-10 h-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Учасників не знайдено за вказаними фільтрами</p>
        </div>
      ) : groupBy !== "none" && groupedResults ? (
        <div className="space-y-6">
          {Object.entries(groupedResults).map(([groupName, items]) => (
            <div key={groupName} className="space-y-2">
              <h4 className="text-sm font-bold text-amber-500 px-1 border-l-2 border-amber-500 flex items-center gap-2 bg-zinc-900/20 py-1.5 rounded-r-lg">
                {groupBy === "club" ? <Building2 className="w-4 h-4" /> : <Users className="w-4 h-4" />}
                {groupName || "—"} ({items.length})
              </h4>
              <div className="rounded-xl border border-zinc-800/80 overflow-hidden bg-card/10">
                <Table>
                  <TableHeader className="bg-zinc-950/40">
                    <TableRow className="hover:bg-transparent border-b border-zinc-850">
                      <TableHead>{renderSortHeader("Спортсмен", "athlete__last_name")}</TableHead>
                      <TableHead>Клуб</TableHead>
                      <TableHead>Стать</TableHead>
                      <TableHead>{renderSortHeader("Вага", "athlete__weight")}</TableHead>
                      <TableHead>{renderSortHeader("Категорія", "category__name")}</TableHead>
                      {canSeeSensitiveInfo && <TableHead className="text-center w-28">Статус</TableHead>}
                      {canSeeSensitiveInfo && <TableHead className="text-center w-28">Оплата</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>{renderTableRows(items)}</TableBody>
                </Table>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-zinc-800/80 overflow-hidden bg-card/10">
          <Table>
            <TableHeader className="bg-zinc-950/40">
              <TableRow className="hover:bg-transparent border-b border-zinc-850">
                <TableHead>{renderSortHeader("Спортсмен", "athlete__last_name")}</TableHead>
                <TableHead>Клуб</TableHead>
                <TableHead>Стать</TableHead>
                <TableHead>{renderSortHeader("Вага", "athlete__weight")}</TableHead>
                <TableHead>{renderSortHeader("Категорія", "category__name")}</TableHead>
                {canSeeSensitiveInfo && <TableHead className="text-center w-28">Статус</TableHead>}
                {canSeeSensitiveInfo && <TableHead className="text-center w-28">Оплата</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>{renderTableRows(registrations)}</TableBody>
          </Table>
        </div>
      )}

      {/* Пагінація */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2 border-t border-zinc-900">
          <p className="text-xs text-muted-foreground">
            Сторінка <span className="font-semibold text-zinc-300">{page}</span> з{" "}
            <span className="font-semibold text-zinc-300">{totalPages}</span>
          </p>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => handlePageChange(page - 1)}
              disabled={page <= 1 || isLoading}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => handlePageChange(page + 1)}
              disabled={page >= totalPages || isLoading}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
