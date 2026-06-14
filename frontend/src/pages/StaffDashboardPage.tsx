import { useEffect, useState, useMemo, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { Search, Loader2, Check, ShieldAlert, Award, Calendar, MapPin, RefreshCw } from "lucide-react";
import api from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useTournamentSocket } from "@/hooks/useTournamentSocket";
import { toast } from "@/hooks/use-toast";
import { formatRegistrationName, formatRegistrationClub, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { useMatchUpdates } from "@/hooks/useMatchUpdates";
import { BracketView } from "@/components/bracket/BracketView";
import type { Tournament, Registration, Category, Match, BracketResponse } from "@/types/api";

export default function StaffDashboardPage() {
  useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  // Read initial states from URL search parameters, with fallback to default values
  const initialTab = searchParams.get("tab") || "registrations";
  const initialTournamentId = searchParams.get("tournamentId") || "";
  const initialSearch = searchParams.get("search") || "";
  const initialCategory = searchParams.get("category") || "all";
  const initialPayment = searchParams.get("payment") || "all";
  const initialStatus = searchParams.get("status") || "all";

  const [activeTab, setActiveTabState] = useState(initialTab);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [selectedTournament, setSelectedTournament] = useState<Tournament | null>(null);
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedBracketCategoryId, setSelectedBracketCategoryId] = useState<number | null>(null);
  const [loadingTournaments, setLoadingTournaments] = useState(true);
  const [loadingData, setLoadingData] = useState(false);

  // WebSocket connection status
  const [isConnected, setIsConnected] = useState(false);

  // Filters
  const [searchQuery, setSearchQueryState] = useState(initialSearch);
  const [selectedCategoryFilter, setSelectedCategoryFilterState] = useState(initialCategory);
  const [paymentFilter, setPaymentFilterState] = useState(initialPayment);
  const [statusFilter, setStatusFilterState] = useState(initialStatus);

  // Weigh-in dialog
  const [weighInReg, setWeighInReg] = useState<Registration | null>(null);
  const [weighInValue, setWeighInValue] = useState("");
  const [submittingWeighIn, setSubmittingWeighIn] = useState(false);

  const updateQueryParam = (key: string, value: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) {
        next.set(key, value);
      } else {
        next.delete(key);
      }
      return next;
    }, { replace: true });
  };

  const setActiveTab = (val: string) => {
    setActiveTabState(val);
    updateQueryParam("tab", val);
  };

  const setSearchQuery = (val: string) => {
    setSearchQueryState(val);
    updateQueryParam("search", val);
  };

  const setSelectedCategoryFilter = (val: string) => {
    setSelectedCategoryFilterState(val);
    updateQueryParam("category", val);
  };

  const setPaymentFilter = (val: string) => {
    setPaymentFilterState(val);
    updateQueryParam("payment", val);
  };

  const setStatusFilter = (val: string) => {
    setStatusFilterState(val);
    updateQueryParam("status", val);
  };

  const handleSelectTournament = (t: Tournament | null) => {
    setSelectedTournament(t);
    updateQueryParam("tournamentId", t ? String(t.id) : "");
  };

  // Fetch staff tournaments
  useEffect(() => {
    async function fetchTournaments() {
      try {
        setLoadingTournaments(true);
        // GET /api/tournaments/?staff_member=me
        const res = await api.get<Tournament[] | { results: Tournament[] }>("/tournaments/?staff_member=me");
        const list = Array.isArray(res.data) ? res.data : (res.data.results || []);
        setTournaments(list);
        if (list.length > 0) {
          const preselected = list.find((t) => String(t.id) === initialTournamentId);
          handleSelectTournament(preselected || list[0]);
        }
      } catch (err) {
        toast({
          title: "Помилка завантаження",
          description: "Не вдалося завантажити призначені турніри.",
          variant: "destructive",
        });
      } finally {
        setLoadingTournaments(false);
      }
    }
    fetchTournaments();
  }, []);

  // Fetch registrations and categories for selected tournament
  const fetchData = async (tournamentId: number) => {
    try {
      setLoadingData(true);
      const [regRes, catRes] = await Promise.all([
        api.get<Registration[] | { results: Registration[] }>(`/registrations/?tournament=${tournamentId}`),
        api.get<Category[] | { results: Category[] }>(`/categories/?tournament=${tournamentId}`),
      ]);

      const regs = Array.isArray(regRes.data) ? regRes.data : (regRes.data.results || []);
      const cats = Array.isArray(catRes.data) ? catRes.data : (catRes.data.results || []);

      console.log("StaffDashboard loaded categories:", cats);
      console.log("StaffDashboard loaded registrations:", regs);

      setRegistrations(regs);
      setCategories(cats);
    } catch (err) {
      console.error("StaffDashboard fetchData error:", err);
      toast({
        title: "Помилка завантаження",
        description: "Не вдалося завантажити деталі турніру.",
        variant: "destructive",
      });
    } finally {
      setLoadingData(false);
    }
  };

  useEffect(() => {
    if (selectedTournament) {
      fetchData(selectedTournament.id);
    } else {
      setRegistrations([]);
      setCategories([]);
    }
  }, [selectedTournament]);

  // Connect to WebSocket for real-time registration sync
  useTournamentSocket(
    selectedTournament?.id || 0,
    (updatedReg) => {
      console.log("WS registration update received:", updatedReg);
      // Live update the updated registration
      setRegistrations((prev) => {
        const index = prev.findIndex((r) => r.id === updatedReg.id);
        if (index !== -1) {
          const next = [...prev];
          next[index] = updatedReg;
          return next;
        } else {
          return [updatedReg, ...prev];
        }
      });
    },
    {
      onConnect: () => setIsConnected(true),
      onDisconnect: () => setIsConnected(false),
    }
  );

  // Toggle check-in
  const handleCheckInToggle = async (reg: Registration) => {
    try {
      const res = await api.post<Registration>(`/registrations/${reg.id}/check_in/`);
      setRegistrations((prev) =>
        prev.map((r) => (r.id === reg.id ? res.data : r))
      );
    } catch (err) {
      console.error("Failed to toggle check-in:", err);
    }
  };

  // Open weigh-in dialog
  const openWeighIn = (reg: Registration) => {
    setWeighInReg(reg);
    setWeighInValue(reg.recorded_weight ? reg.recorded_weight.toString() : "");
  };

  // Submit weigh-in weight
  const handleWeighInSubmit = async () => {
    if (!weighInReg) return;
    let weightVal = 0.0;
    if (!weighInReg.team) {
      weightVal = parseFloat(weighInValue);
      if (isNaN(weightVal) || weightVal <= 0) {
        toast({
          title: "Некоректна вага",
          description: "Будь ласка, введіть дійсне число більше нуля.",
          variant: "destructive",
        });
        return;
      }
    }

    try {
      setSubmittingWeighIn(true);
      const res = await api.post<Registration>(`/registrations/${weighInReg.id}/confirm_weigh_in/`, {
        weight: weightVal,
      });
      setRegistrations((prev) =>
        prev.map((r) => (r.id === weighInReg.id ? res.data : r))
      );
      toast({
        title: "Зважування підтверджено",
        description: `${
          weighInReg.team
            ? `Команда: ${weighInReg.team.name}`
            : `Спортсмен: ${weighInReg.athlete?.full_name || weighInReg.athlete?.last_name}`
        }, вага: ${weightVal} кг.`,
      });
      setWeighInReg(null);
    } catch (err) {
      console.error("Failed to submit weigh-in:", err);
    } finally {
      setSubmittingWeighIn(false);
    }
  };

  // Quick status update (PATCH registrations)
  const handleStatusChange = async (regId: number, newStatus: string) => {
    try {
      const res = await api.patch<Registration>(`/registrations/${regId}/`, { status: newStatus });
      setRegistrations((prev) =>
        prev.map((r) => (r.id === regId ? res.data : r))
      );
      toast({
        title: "Статус оновлено",
        description: "Статус реєстрації було успішно змінено.",
      });
    } catch (err) {
      console.error("Failed to change registration status:", err);
    }
  };

  // Quick payment status update
  const handlePaymentStatusChange = async (regId: number, newPaymentStatus: string) => {
    try {
      const res = await api.patch<Registration>(`/registrations/${regId}/`, {
        payment_status: newPaymentStatus,
        payment_method: newPaymentStatus === "paid" ? "offline" : "offline",
      });
      setRegistrations((prev) =>
        prev.map((r) => (r.id === regId ? res.data : r))
      );
      toast({
        title: "Оплату оновлено",
        description: "Статус оплати було успішно змінено.",
      });
    } catch (err) {
      console.error("Failed to change payment status:", err);
    }
  };

  // Filtered registrations
  const filteredRegistrations = useMemo(() => {
    return registrations.filter((reg) => {
      const athleteName = reg.athlete
        ? `${reg.athlete.first_name} ${reg.athlete.last_name}`.toLowerCase()
        : reg.team?.name.toLowerCase() || "";
      const clubName = reg.athlete?.club?.name.toLowerCase() || reg.team?.club?.name.toLowerCase() || "";
      const matchesSearch =
        athleteName.includes(searchQuery.toLowerCase()) ||
        clubName.includes(searchQuery.toLowerCase());

      const matchesCategory =
        selectedCategoryFilter === "all" || (reg.category && reg.category.toString() === selectedCategoryFilter);

      const matchesPayment =
        paymentFilter === "all" || reg.payment_status === paymentFilter;

      const matchesStatus =
        statusFilter === "all" || reg.status === statusFilter;

      return matchesSearch && matchesCategory && matchesPayment && matchesStatus;
    });
  }, [registrations, searchQuery, selectedCategoryFilter, paymentFilter, statusFilter]);

  if (loadingTournaments) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950 text-white">
        <div className="text-center">
          <Loader2 className="mx-auto h-12 w-12 animate-spin text-cyan-500" />
          <p className="mt-4 text-slate-400">Завантаження призначених турнірів...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 p-6 text-slate-100">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Banner */}
        <div className="relative overflow-hidden rounded-2xl border border-slate-800 bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 p-6 shadow-xl">
          <div className="absolute right-0 top-0 h-40 w-40 bg-indigo-500/10 blur-3xl" />
          <div className="absolute left-1/3 bottom-0 h-28 w-28 bg-emerald-500/5 blur-3xl" />

          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 relative z-10">
            <div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="border-indigo-500/30 text-indigo-400 bg-indigo-500/5 px-2.5 py-0.5">
                  Панель секретаря
                </Badge>
                <div className="flex items-center gap-1.5">
                  <span className={`inline-block h-2 w-2 rounded-full ${isConnected ? "bg-emerald-500 animate-pulse" : "bg-rose-500"}`} />
                  <span className="text-xs text-slate-400">
                    {isConnected ? "WS підключено" : "WS офлайн"}
                  </span>
                </div>
              </div>
              <h1 className="mt-2 text-2xl font-bold tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-300 bg-clip-text text-transparent">
                Управління явкою та зважуванням
              </h1>
              <p className="text-sm text-slate-400 mt-1">
                Відмічайте присутність атлетів на місці та затверджуйте їхню вагу перед сіткою.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-sm text-slate-400 whitespace-nowrap">Оберіть турнір:</span>
              <Select
                value={selectedTournament?.id.toString() || ""}
                onValueChange={(val) => {
                  const found = tournaments.find((t) => t.id.toString() === val);
                  if (found) handleSelectTournament(found);
                }}
              >
                <SelectTrigger className="w-[280px] border-slate-800 bg-slate-900/90 text-slate-200">
                  <SelectValue placeholder="Немає призначених турнірів" />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-800 text-slate-200">
                  {tournaments.map((t) => (
                    <SelectItem key={t.id} value={t.id.toString()}>
                      {t.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {selectedTournament ? (
          <div className="grid grid-cols-1 gap-6">
            {/* Tournament short stats */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Card className="border-slate-800 bg-slate-900/40 backdrop-blur">
                <CardContent className="pt-6 flex items-center gap-4">
                  <div className="p-3 rounded-lg bg-indigo-500/10 text-indigo-400">
                    <Calendar className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Дата проведення</p>
                    <p className="text-sm font-semibold mt-0.5">
                      {new Date(selectedTournament.start_date).toLocaleDateString("uk-UA")}
                    </p>
                  </div>
                </CardContent>
              </Card>
              <Card className="border-slate-800 bg-slate-900/40 backdrop-blur">
                <CardContent className="pt-6 flex items-center gap-4">
                  <div className="p-3 rounded-lg bg-emerald-500/10 text-emerald-400">
                    <MapPin className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Місце</p>
                    <p className="text-sm font-semibold mt-0.5 truncate max-w-[200px]">
                      {selectedTournament.location}
                    </p>
                  </div>
                </CardContent>
              </Card>
              <Card className="border-slate-800 bg-slate-900/40 backdrop-blur">
                <CardContent className="pt-6 flex items-center gap-4">
                  <div className="p-3 rounded-lg bg-cyan-500/10 text-cyan-400">
                    <Award className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Всього заявок</p>
                    <p className="text-sm font-semibold mt-0.5">
                      {registrations.length} ({registrations.filter(r => r.checked_in).length} з'явились)
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Main Tabs */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full space-y-4">
              <TabsList className="bg-slate-900 border border-slate-800 p-1">
                <TabsTrigger value="registrations" className="data-[state=active]:bg-indigo-600 data-[state=active]:text-white">
                  Реєстрації ({filteredRegistrations.length})
                </TabsTrigger>
                <TabsTrigger value="categories" className="data-[state=active]:bg-indigo-600 data-[state=active]:text-white">
                  Категорії змагань ({categories.length})
                </TabsTrigger>
              </TabsList>

              <TabsContent value="registrations" className="space-y-4 outline-none">
                {/* Search & Filters */}
                <div className="flex flex-col md:flex-row gap-4 items-center justify-between bg-slate-900/60 p-4 rounded-xl border border-slate-800">
                  <div className="relative w-full md:w-80">
                    <Search className="absolute left-3 top-2.5 h-4.5 w-4.5 text-slate-500" />
                    <Input
                      placeholder="Пошук атлета чи клубу..."
                      className="pl-10 border-slate-800 bg-slate-950 text-slate-200 placeholder-slate-500"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                  </div>

                  <div className="flex flex-wrap gap-3 w-full md:w-auto">
                    {/* Category Filter */}
                    <Select value={selectedCategoryFilter} onValueChange={setSelectedCategoryFilter}>
                      <SelectTrigger className="w-[180px] border-slate-800 bg-slate-950 text-slate-200">
                        <SelectValue placeholder="Категорія" />
                      </SelectTrigger>
                      <SelectContent className="bg-slate-950 border-slate-800 text-slate-200">
                        <SelectItem value="all">Всі категорії</SelectItem>
                        {categories.map((cat) => (
                          <SelectItem key={cat.id} value={cat.id.toString()}>
                            {cat.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    {/* Status Filter */}
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                      <SelectTrigger className="w-[140px] border-slate-800 bg-slate-950 text-slate-200">
                        <SelectValue placeholder="Статус" />
                      </SelectTrigger>
                      <SelectContent className="bg-slate-950 border-slate-800 text-slate-200">
                        <SelectItem value="all">Всі статуси</SelectItem>
                        <SelectItem value="pending">Очікує</SelectItem>
                        <SelectItem value="confirmed">Підтверджено</SelectItem>
                        <SelectItem value="withdrawn">Знято</SelectItem>
                      </SelectContent>
                    </Select>

                    {/* Payment Filter */}
                    <Select value={paymentFilter} onValueChange={setPaymentFilter}>
                      <SelectTrigger className="w-[140px] border-slate-800 bg-slate-950 text-slate-200">
                        <SelectValue placeholder="Оплата" />
                      </SelectTrigger>
                      <SelectContent className="bg-slate-950 border-slate-800 text-slate-200">
                        <SelectItem value="all">Вся оплата</SelectItem>
                        <SelectItem value="paid">Оплачено</SelectItem>
                        <SelectItem value="unpaid">Неоплачено</SelectItem>
                      </SelectContent>
                    </Select>

                    <Button
                      variant="outline"
                      size="icon"
                      className="border-slate-800 bg-slate-950 hover:bg-slate-800 text-slate-400 hover:text-white"
                      onClick={() => fetchData(selectedTournament.id)}
                      disabled={loadingData}
                    >
                      <RefreshCw className={`h-4.5 w-4.5 ${loadingData ? "animate-spin text-cyan-400" : ""}`} />
                    </Button>
                  </div>
                </div>

                {/* Table */}
                <Card className="border-slate-800 bg-slate-900/30 overflow-hidden shadow-inner">
                  <Table>
                    <TableHeader className="bg-slate-900/70 border-b border-slate-800">
                      <TableRow className="hover:bg-slate-900/40 border-b border-slate-800">
                        <TableHead className="text-slate-400">Спортсмен</TableHead>
                        <TableHead className="text-slate-400">Клуб</TableHead>
                        <TableHead className="text-slate-400">Тренер</TableHead>
                        <TableHead className="text-slate-400">Категорія</TableHead>
                        <TableHead className="text-slate-400">Зважування</TableHead>
                        <TableHead className="text-slate-400 text-center">Оплата</TableHead>
                        <TableHead className="text-slate-400 text-center">Статус</TableHead>
                        {selectedTournament.use_check_in && (
                          <TableHead className="text-slate-400 text-center">Явка</TableHead>
                        )}
                        <TableHead className="text-slate-400 text-right">Дії</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {loadingData ? (
                        <TableRow>
                          <TableCell colSpan={selectedTournament.use_check_in ? 9 : 8} className="h-40 text-center">
                            <Loader2 className="mx-auto h-8 w-8 animate-spin text-indigo-500" />
                            <p className="mt-2 text-sm text-slate-400">Завантаження реєстрацій...</p>
                          </TableCell>
                        </TableRow>
                      ) : filteredRegistrations.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={selectedTournament.use_check_in ? 9 : 8} className="h-32 text-center text-slate-500">
                            Не знайдено реєстрацій за вказаними фільтрами.
                          </TableCell>
                        </TableRow>
                      ) : (
                        filteredRegistrations.map((reg) => {
                          const athlete = reg.athlete;
                          return (
                            <TableRow key={reg.id} className="hover:bg-slate-900/40 border-b border-slate-800/80 transition-colors">
                              <TableCell className="font-medium">
                                <div>
                                  {athlete ? (
                                    <>
                                      <p className="text-sm text-slate-200">
                                        {athlete.last_name} {athlete.first_name}
                                      </p>
                                      <p className="text-xs text-slate-400">
                                        {athlete.gender === "male" ? "Чоловік" : "Жінка"},{" "}
                                        {new Date().getFullYear() - new Date(athlete.birth_date).getFullYear()} років,{" "}
                                        Вага: {athlete.base_weight} кг
                                      </p>
                                    </>
                                  ) : (
                                    <p className="text-sm text-slate-200 font-semibold">{formatRegistrationName(reg)} (Команда)</p>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="text-sm text-slate-300">
                                {formatRegistrationClub(reg) || "Особисто"}
                              </TableCell>
                              <TableCell className="text-sm text-slate-300">
                                {reg.coach_name_short || "—"}
                              </TableCell>
                              <TableCell className="text-xs text-slate-400 max-w-[180px] truncate">
                                {reg.category_name}
                              </TableCell>
                              <TableCell>
                                {reg.recorded_weight ? (
                                  <Badge className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                    {reg.recorded_weight} кг
                                  </Badge>
                                ) : (
                                  <span className="text-xs text-slate-500">—</span>
                                )}
                              </TableCell>
                              <TableCell className="text-center">
                                <Select
                                  value={reg.payment_status}
                                  onValueChange={(val) => handlePaymentStatusChange(reg.id, val)}
                                >
                                  <SelectTrigger className="h-7 w-[100px] mx-auto text-xs border-slate-800 bg-slate-950 text-slate-300">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent className="bg-slate-950 border-slate-800 text-slate-300">
                                    <SelectItem value="paid">Сплачено</SelectItem>
                                    <SelectItem value="unpaid">Борг</SelectItem>
                                  </SelectContent>
                                </Select>
                              </TableCell>
                              <TableCell className="text-center">
                                <Badge className={
                                  reg.status === "confirmed" ? "bg-emerald-600/20 text-emerald-400 border border-emerald-500/20" :
                                  reg.status === "withdrawn" ? "bg-rose-600/20 text-rose-400 border border-rose-500/20" :
                                  "bg-yellow-600/20 text-yellow-400 border border-yellow-500/20"
                                }>
                                  {reg.status_display}
                                </Badge>
                              </TableCell>

                              {selectedTournament.use_check_in && (
                                <TableCell className="text-center">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleCheckInToggle(reg)}
                                    className={`h-7 px-2.5 text-xs rounded transition-all ${
                                      reg.checked_in
                                        ? "bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600"
                                        : "bg-slate-900 border-slate-700 text-slate-400 hover:bg-slate-800"
                                    }`}
                                  >
                                    {reg.checked_in ? (
                                      <>
                                        <Check className="mr-1 h-3.5 w-3.5" />
                                        Прибув
                                      </>
                                    ) : (
                                      "Немає"
                                    )}
                                  </Button>
                                </TableCell>
                              )}

                              <TableCell className="text-right">
                                <div className="flex justify-end gap-1.5">
                                  {/* Confirm Weigh-in Button */}
                                  {selectedTournament.weigh_in_required && (
                                    <Button
                                      size="sm"
                                      variant="secondary"
                                      className="h-7 text-xs bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-400 border border-indigo-500/10"
                                      onClick={() => openWeighIn(reg)}
                                    >
                                      {reg.team ? "Допуск" : "Зважити"}
                                    </Button>
                                  )}

                                  {/* Quick Status Select */}
                                  <Select
                                    value={reg.status}
                                    onValueChange={(val) => handleStatusChange(reg.id, val)}
                                  >
                                    <SelectTrigger className="h-7 w-[120px] text-xs border-slate-800 bg-slate-950 text-slate-300">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent className="bg-slate-950 border-slate-800 text-slate-300">
                                      <SelectItem value="pending">Очікує</SelectItem>
                                      <SelectItem value="confirmed">Підтверджено</SelectItem>
                                      <SelectItem value="withdrawn">Знято</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })
                      )}
                    </TableBody>
                  </Table>
                </Card>
              </TabsContent>

              <TabsContent value="categories" className="outline-none">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {categories.map((cat) => (
                    <Card key={cat.id} className="border-slate-800 bg-slate-900/40">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-md font-bold text-slate-200 truncate">{cat.name}</CardTitle>
                        <CardDescription className="text-xs text-slate-500">
                          {cat.bracket_format_display}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="text-sm space-y-2 text-slate-400">
                        <div className="flex justify-between">
                          <span>Всього учасників:</span>
                          <span className="text-slate-200 font-semibold">{cat.confirmed_registrations_count}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Статус:</span>
                          <Badge className="bg-slate-800 text-slate-300 hover:bg-slate-800/80">
                            {cat.status === "registration" ? "Реєстрація" : cat.status === "active" ? "Активний" : "Завершено"}
                          </Badge>
                        </div>
                        <div className="flex justify-between">
                          <span>Сітка:</span>
                          <Badge
                            className={cn(
                              cat.has_bracket
                                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 cursor-pointer hover:bg-emerald-500/20 transition-all"
                                : "bg-yellow-500/10 text-yellow-400 border border-yellow-500/20"
                            )}
                            onClick={() => {
                              if (cat.has_bracket) {
                                setSelectedBracketCategoryId(cat.id);
                              }
                            }}
                          >
                            {cat.has_bracket ? "Сформована" : "Немає сітки"}
                          </Badge>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </TabsContent>
            </Tabs>
          </div>
        ) : (
          <div className="text-center p-12 bg-slate-900/30 rounded-2xl border border-slate-800">
            <ShieldAlert className="mx-auto h-12 w-12 text-slate-500 mb-4 animate-bounce" />
            <h2 className="text-xl font-bold text-slate-300">Немає призначених турнірів</h2>
            <p className="text-slate-500 text-sm mt-2 max-w-md mx-auto">
              Організатор турніру повинен додати вас до списку робочого персоналу, щоб ви могли керувати явкою та зважуванням.
            </p>
          </div>
        )}
      </div>

      {/* Weigh-in dialog */}
      <Dialog open={weighInReg !== null} onOpenChange={(open) => !open && setWeighInReg(null)}>
        <DialogContent className="bg-slate-900 border-slate-800 text-slate-100">
          <DialogHeader>
            <DialogTitle>
              {weighInReg?.team ? "Допуск команди до змагань" : "Підтвердження зважування"}
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              {weighInReg?.team
                ? "Перевірте склад команди та підтвердьте її допуск до змагань."
                : "Введіть фактичну вагу спортсмена на вагах. Заявка автоматично перейде в статус 'Підтверджено'."}
            </DialogDescription>
          </DialogHeader>

          {weighInReg && (
            <div className="space-y-4 py-4">
              <div className="rounded-lg bg-slate-950 p-3.5 border border-slate-800">
                {weighInReg.team ? (
                  <>
                    <p className="text-sm font-semibold text-slate-300">
                      Команда: {weighInReg.team.name} ({weighInReg.team.club?.name || "Особисто"})
                    </p>
                    <p className="text-xs text-slate-400 mt-1">
                      Категорія: {weighInReg.category_name}
                    </p>
                    <div className="mt-3 space-y-1">
                      <p className="text-xs font-semibold text-slate-400">Склад команди:</p>
                      <ul className="text-xs text-slate-300 list-disc pl-4 space-y-1">
                        {weighInReg.team.athletes?.map((ath) => (
                          <li key={ath.id}>
                            {ath.last_name} {ath.first_name} (Базова вага: {ath.base_weight} кг)
                          </li>
                        ))}
                      </ul>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-semibold text-slate-300">
                      {weighInReg.athlete?.last_name} {weighInReg.athlete?.first_name}
                    </p>
                    <p className="text-xs text-slate-400 mt-1">
                      Категорія: {weighInReg.category_name}
                    </p>
                    <p className="text-xs text-slate-400">
                      Початкова вага (з профілю): {weighInReg.athlete?.base_weight} кг
                    </p>
                  </>
                )}
              </div>

              {weighInReg.team ? (
                <p className="text-xs text-amber-500 font-semibold italic bg-amber-500/10 border border-amber-500/20 rounded p-2.5 text-center">
                  Команда виступає в абсолютній категорії і не потребує фіксації ваги.
                </p>
              ) : (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">
                    Фактична вага спортсмена (кг):
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    placeholder="Наприклад: 73.4"
                    className="border-slate-800 bg-slate-950 text-slate-200 placeholder-slate-600 focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
                    value={weighInValue}
                    onChange={(e) => setWeighInValue(e.target.value)}
                  />
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" className="border-slate-800 hover:bg-slate-800 bg-slate-950 text-slate-300" onClick={() => setWeighInReg(null)}>
              Скасувати
            </Button>
            <Button onClick={handleWeighInSubmit} disabled={submittingWeighIn} className="bg-indigo-600 hover:bg-indigo-700 text-white">
              {submittingWeighIn ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Збереження...
                </>
              ) : (
                weighInReg?.team ? "Допустити команду" : "Підтвердити"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {selectedBracketCategoryId !== null && (
        <CategoryBracketDialog
          categoryId={selectedBracketCategoryId}
          onClose={() => setSelectedBracketCategoryId(null)}
        />
      )}
    </div>
  );
}

interface CategoryBracketDialogProps {
  categoryId: number;
  onClose: () => void;
}

function CategoryBracketDialog({ categoryId, onClose }: CategoryBracketDialogProps) {
  const [bracket, setBracket] = useState<BracketResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchBracket = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      const [bracketRes, catRes] = await Promise.all([
        api.get<unknown>(`/matches/bracket/?category=${categoryId}`),
        api.get<Category>(`/categories/${categoryId}/`),
      ]);

      const roundsData = bracketRes.data as {round_index: number, matches: Match[]}[];
      const rounds = roundsData.map(r => r.matches);

      setBracket({
        format: catRes.data.bracket_format,
        rounds: rounds
      });
    } catch (err) {
      console.error(err);
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, [categoryId]);

  useEffect(() => {
    fetchBracket();
  }, [fetchBracket]);

  const handleMatchUpdate = useCallback((updatedMatch: Match) => {
    if (!updatedMatch) {
      fetchBracket(true);
      return;
    }
    setBracket((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        rounds: prev.rounds.map((round) =>
          round.map((m) => m.id === updatedMatch.id ? updatedMatch : m)
        ),
      };
    });
  }, [fetchBracket]);

  useMatchUpdates(Number(categoryId), handleMatchUpdate, {
    onConnect: () => {
      fetchBracket(true);
    },
  });

  return (
    <Dialog open={categoryId !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto bg-slate-950 border-slate-800 text-slate-100">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold flex items-center gap-2">
            Турнірна сітка
            {isLoading && <Loader2 className="w-4 h-4 animate-spin text-amber-500" />}
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Відображення сітки в реальному часі. Зміни в поєдинках оновлюються автоматично.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 overflow-x-auto min-h-[300px] flex items-center justify-center">
          {isLoading && !bracket ? (
            <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
          ) : bracket && bracket.rounds.length > 0 ? (
            <div className="w-full">
              <BracketView bracket={bracket} />
            </div>
          ) : (
            <p className="text-slate-500 text-sm">Сітка порожня або виникла помилка завантаження.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
