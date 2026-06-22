/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, useState, useMemo, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { Search, Loader2, Check, Award, Calendar, MapPin, RefreshCw, Trophy } from "lucide-react";
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
import { MatchCard } from "@/components/bracket/MatchCard";
import type { Tournament, Registration, Category, Match, BracketResponse, RoleRequest } from "@/types/api";

const ROLE_LABELS: Record<string, string> = {
  organizer: "Організатор",
  coach:     "Тренер",
  judge:     "Суддя",
  spectator: "Глядач",
  staff:     "Персонал",
};

function getStatusBadgeClass(status: string) {
  switch (status) {
    case "confirmed":
      return "bg-emerald-600/20 text-emerald-400 border border-emerald-500/20";
    case "withdrawn":
      return "bg-rose-600/20 text-rose-400 border border-rose-500/20";
    default:
      return "bg-yellow-600/20 text-yellow-400 border border-yellow-500/20";
  }
}

function getCategoryStatusLabel(status: string) {
  if (status === "registration") return "Реєстрація";
  if (status === "active") return "Активний";
  return "Завершено";
}

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

  const [activeTab, setActiveTab] = useState(initialTab);
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
  const [searchQuery, setSearchQuery] = useState(initialSearch);
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState(initialCategory);
  const [paymentFilter, setPaymentFilter] = useState(initialPayment);
  const [statusFilter, setStatusFilter] = useState(initialStatus);

  // Weigh-in dialog
  const [weighInReg, setWeighInReg] = useState<Registration | null>(null);
  const [weighInValue, setWeighInValue] = useState("");
  const [submittingWeighIn, setSubmittingWeighIn] = useState(false);

  // Role verification states
  const [roleRequests, setRoleRequests] = useState<RoleRequest[]>([]);
  const [loadingRoleRequests, setLoadingRoleRequests] = useState(false);
  const [reviewDialogReq, setReviewDialogReq] = useState<RoleRequest | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [reviewStatus, setReviewStatus] = useState<"approved" | "rejected" | "">("");
  const [activeReviewReq, setActiveReviewReq] = useState<RoleRequest | null>(null);

  useEffect(() => {
    if (reviewDialogReq) {
      setActiveReviewReq(reviewDialogReq);
    }
  }, [reviewDialogReq]);

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

  const handleActiveTabChange = (val: string) => {
    setActiveTab(val);
    updateQueryParam("tab", val);
  };

  const handleSearchQueryChange = (val: string) => {
    setSearchQuery(val);
    updateQueryParam("search", val);
  };

  const handleCategoryFilterChange = (val: string) => {
    setSelectedCategoryFilter(val);
    updateQueryParam("category", val);
  };

  const handlePaymentFilterChange = (val: string) => {
    setPaymentFilter(val);
    updateQueryParam("payment", val);
  };

  const handleStatusFilterChange = (val: string) => {
    setStatusFilter(val);
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
        } else {
          setActiveTab("role_requests");
        }
      } catch (err) {
        console.error("fetchTournaments error:", err);
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

  const fetchPendingRoleRequests = async () => {
    try {
      setLoadingRoleRequests(true);
      const res = await api.get<RoleRequest[] | { results: RoleRequest[] }>("/auth/role-requests/pending/");
      const list = Array.isArray(res.data) ? res.data : (res.data as { results?: RoleRequest[] }).results || [];
      setRoleRequests(list);
    } catch (err) {
      console.error("Error fetching role requests", err);
    } finally {
      setLoadingRoleRequests(false);
    }
  };

  const handleReviewRoleRequest = async (reqId: number, status: "approved" | "rejected") => {
    try {
      await api.post(`/auth/role-requests/${reqId}/review/`, {
        status,
        review_notes: reviewNotes,
      });
      toast({
        title: status === "approved" ? "Запит схвалено" : "Запит відхилено",
        description: `Запит успішно ${status === "approved" ? "схвалено" : "відхилено"}.`,
      });
      setReviewDialogReq(null);
      setReviewNotes("");
      fetchPendingRoleRequests();
    } catch (err) {
      console.error("Error reviewing role request", err);
      toast({
        variant: "destructive",
        title: "Помилка",
        description: "Не вдалося зберегти рішення щодо запиту.",
      });
    }
  };

  useEffect(() => {
    fetchPendingRoleRequests();
  }, []);

  const renderRoleRequestsCard = () => {
    return (
      <Card className="border-slate-800 bg-slate-900/40 backdrop-blur">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <div>
            <CardTitle className="text-lg font-bold">Очікуючі заявки на верифікацію</CardTitle>
            <CardDescription>Розгляньте та підтвердіть або відхиліть ролі користувачів.</CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchPendingRoleRequests}
            disabled={loadingRoleRequests}
            className="border-slate-800 hover:bg-slate-800 text-slate-300"
          >
            {loadingRoleRequests ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          </Button>
        </CardHeader>
        <CardContent>
          {loadingRoleRequests ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
            </div>
          ) : roleRequests.length === 0 ? (
            <div className="text-center py-12 text-slate-500 text-sm">
              Немає очікуючих заявок на верифікацію ролей.
            </div>
          ) : (
            <div className="overflow-x-auto border border-slate-800 rounded-xl">
              <Table>
                <TableHeader className="bg-slate-900 border-slate-800">
                  <TableRow className="border-slate-800 text-slate-300">
                    <TableHead className="w-[180px]">Користувач</TableHead>
                    <TableHead className="w-[150px]">Бажана роль</TableHead>
                    <TableHead>Деталі</TableHead>
                    <TableHead className="w-[150px]">Дата подачі</TableHead>
                    <TableHead className="w-[180px] text-right">Дії</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="text-slate-300">
                  {roleRequests.map((req) => (
                    <TableRow key={req.id} className="border-slate-800 hover:bg-slate-950/20">
                      <TableCell className="font-semibold">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-xs font-bold text-indigo-400">
                            {req.user?.photo ? (
                              <img src={req.user.photo} alt="Avatar" className="w-full h-full object-cover rounded-full" />
                            ) : (
                              req.user?.first_name?.[0]?.toUpperCase() || "?"
                            )}
                          </div>
                          <div>
                            <p className="text-sm font-bold text-white">
                              {req.user?.last_name} {req.user?.first_name}
                            </p>
                            <p className="text-xs text-slate-400 font-mono">{req.user?.email}</p>
                            {req.user?.phone && (
                              <p className="text-[11px] text-slate-500 font-sans mt-0.5">
                                Тел: {req.user.phone}
                              </p>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {req.requested_role === "coach" && (
                          <Badge className="bg-amber-500/15 text-amber-400 border border-amber-500/20 hover:bg-amber-500/15">Тренер</Badge>
                        )}
                        {req.requested_role === "judge" && (
                          <Badge className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/15">Суддя</Badge>
                        )}
                        {req.requested_role === "organizer" && (
                          <Badge className="bg-purple-500/15 text-purple-400 border border-purple-500/20 hover:bg-purple-500/15">Організатор</Badge>
                        )}
                        {req.requested_role === "spectator" && (
                          <Badge className="bg-slate-500/15 text-slate-400 border border-slate-500/20 hover:bg-slate-500/15">Глядач</Badge>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[300px]">
                        {req.requested_role === "coach" && req.club && (
                          <div className="mb-1 text-xs">
                            <span className="text-slate-500 font-medium">Клуб:</span>{" "}
                            <span className="text-amber-400 font-bold">{req.club.name}{req.club.region ? ` (${req.club.region})` : ""}</span>
                          </div>
                        )}
                        {req.requested_role === "judge" && req.referee_category && (
                          <div className="mb-1 text-xs">
                            <span className="text-slate-500 font-medium">Суддівська категорія:</span>{" "}
                            <span className="text-emerald-400 font-bold">{req.referee_category}</span>
                          </div>
                        )}
                        {req.details && (
                          <div className="text-xs text-slate-400 italic mt-0.5 line-clamp-2" title={req.details}>
                            &ldquo;{req.details}&rdquo;
                          </div>
                        )}
                        {req.document && (
                          <div className="mt-1.5">
                            <a
                              href={req.document}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 underline font-semibold"
                            >
                              📎 Дивитись документ
                            </a>
                          </div>
                        )}
                        {req.photo_with_id && (
                          <div className="mt-1.5">
                            <a
                              href={req.photo_with_id}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 underline font-semibold"
                            >
                              📸 Фото з посвідченням
                            </a>
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-slate-400">
                        {new Date(req.created_at).toLocaleDateString("uk-UA", {
                          hour: "2-digit",
                          minute: "2-digit"
                        })}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 text-xs font-semibold"
                            onClick={() => {
                              setReviewStatus("rejected");
                              setReviewDialogReq(req);
                              setReviewNotes("");
                            }}
                          >
                            Відхилити
                          </Button>
                          <Button
                            size="sm"
                            className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold"
                            onClick={() => {
                              setReviewStatus("approved");
                              setReviewDialogReq(req);
                              setReviewNotes("");
                            }}
                          >
                            Схвалити
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  // Connect to WebSocket for real-time registration sync
  useTournamentSocket(
    selectedTournament?.id || 0,
    (updatedReg) => {
      console.log("WS registration update received:", updatedReg);
      // Live update the updated registration
      setRegistrations((prev) => {
        const index = prev.findIndex((r) => r.id === updatedReg.id);
        if (index === -1) {
          return [updatedReg, ...prev];
        } else {
          const next = [...prev];
          next[index] = updatedReg;
          return next;
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
    let weightVal = 0;
    if (!weighInReg.team) {
      weightVal = Number.parseFloat(weighInValue);
      if (Number.isNaN(weightVal) || weightVal <= 0) {
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
        payment_method: "offline",
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
        selectedCategoryFilter === "all" || reg.category?.toString() === selectedCategoryFilter;

      const matchesPayment =
        paymentFilter === "all" || reg.payment_status === paymentFilter;

      const matchesStatus =
        statusFilter === "all" || reg.status === statusFilter;

      return matchesSearch && matchesCategory && matchesPayment && matchesStatus;
    });
  }, [registrations, searchQuery, selectedCategoryFilter, paymentFilter, statusFilter]);

  const renderRegistrationsTableBody = () => {
    if (!selectedTournament) return null;
    const colSpanCount = selectedTournament.use_check_in ? 9 : 8;
    if (loadingData) {
      return (
        <TableRow>
          <TableCell colSpan={colSpanCount} className="h-40 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-indigo-500" />
            <p className="mt-2 text-sm text-slate-400">Завантаження реєстрацій...</p>
          </TableCell>
        </TableRow>
      );
    }
    if (filteredRegistrations.length === 0) {
      return (
        <TableRow>
          <TableCell colSpan={colSpanCount} className="h-32 text-center text-slate-500">
            Не знайдено реєстрацій за вказаними фільтрами.
          </TableCell>
        </TableRow>
      );
    }
    return filteredRegistrations.map((reg) => {
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
            <Badge className={getStatusBadgeClass(reg.status)}>
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
    });
  };

  const getWeighInSubmitContent = () => {
    if (submittingWeighIn) {
      return (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Збереження...
        </>
      );
    }
    return weighInReg?.team ? "Допустити команду" : "Підтвердити";
  };

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
            <Tabs value={activeTab} onValueChange={handleActiveTabChange} className="w-full space-y-4">
              <TabsList className="bg-slate-900 border border-slate-800 p-1">
                <TabsTrigger value="registrations" className="data-[state=active]:bg-indigo-600 data-[state=active]:text-white">
                  Реєстрації ({filteredRegistrations.length})
                </TabsTrigger>
                <TabsTrigger value="categories" className="data-[state=active]:bg-indigo-600 data-[state=active]:text-white">
                  Категорії змагань ({categories.length})
                </TabsTrigger>
                <TabsTrigger value="role_requests" className="data-[state=active]:bg-indigo-600 data-[state=active]:text-white">
                  Заявки на ролі ({roleRequests.length})
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
                      onChange={(e) => handleSearchQueryChange(e.target.value)}
                    />
                  </div>

                  <div className="flex flex-wrap gap-3 w-full md:w-auto">
                    {/* Category Filter */}
                    <Select value={selectedCategoryFilter} onValueChange={handleCategoryFilterChange}>
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
                    <Select value={statusFilter} onValueChange={handleStatusFilterChange}>
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
                    <Select value={paymentFilter} onValueChange={handlePaymentFilterChange}>
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
                      {renderRegistrationsTableBody()}
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
                            {getCategoryStatusLabel(cat.status)}
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

              <TabsContent value="role_requests" className="outline-none space-y-4">
                {renderRoleRequestsCard()}
              </TabsContent>
            </Tabs>
          </div>
        ) : (
          <div className="space-y-6">
            <Tabs value={activeTab} onValueChange={handleActiveTabChange} className="w-full space-y-4">
              <TabsList className="bg-slate-900 border border-slate-800 p-1">
                <TabsTrigger value="role_requests" className="data-[state=active]:bg-indigo-600 data-[state=active]:text-white">
                  Заявки на ролі ({roleRequests.length})
                </TabsTrigger>
              </TabsList>

              <TabsContent value="role_requests" className="outline-none space-y-4">
                {renderRoleRequestsCard()}
              </TabsContent>
            </Tabs>
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
                  <label htmlFor="weigh-in-weight-input" className="text-sm font-medium text-slate-300">
                    Фактична вага спортсмена (кг):
                  </label>
                  <Input
                    id="weigh-in-weight-input"
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
              {getWeighInSubmitContent()}
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

      {/* Role Request Review Dialog */}
      <Dialog open={reviewDialogReq !== null} onOpenChange={(open) => !open && setReviewDialogReq(null)}>
        <DialogContent className="bg-slate-900 border-slate-800 text-slate-100">
          <DialogHeader>
            <DialogTitle>
              {reviewStatus === "approved" ? "Схвалення запиту на роль" : "Відхилення запиту на роль"}
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              {reviewStatus === "approved"
                ? `Ви підтверджуєте зміну ролі для ${activeReviewReq?.user?.last_name} ${activeReviewReq?.user?.first_name} на ${ROLE_LABELS[activeReviewReq?.requested_role || ""] || activeReviewReq?.requested_role}.`
                : `Ви відхиляєте запит на роль ${ROLE_LABELS[activeReviewReq?.requested_role || ""] || activeReviewReq?.requested_role} для користувача ${activeReviewReq?.user?.last_name} ${activeReviewReq?.user?.first_name}.`}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-3">
            <div className="space-y-2">
              <label htmlFor="review-notes-textarea" className="text-sm font-medium text-slate-300">
                Коментар секретаря/адміністратора (необов'язково для схвалення, бажано для відхилення):
              </label>
              <textarea
                id="review-notes-textarea"
                rows={3}
                placeholder="Введіть причину відхилення або додаткові вказівки для схвалення..."
                value={reviewNotes}
                onChange={(e) => setReviewNotes(e.target.value)}
                className="flex min-h-[80px] w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 text-slate-200"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              className="border-slate-800 hover:bg-slate-800 bg-slate-950 text-slate-300"
              onClick={() => setReviewDialogReq(null)}
            >
              Скасувати
            </Button>
            <Button
              onClick={() => {
                if (reviewDialogReq && reviewStatus) {
                  handleReviewRoleRequest(reviewDialogReq.id, reviewStatus as "approved" | "rejected");
                }
              }}
              className={reviewStatus === "approved" ? "bg-indigo-600 hover:bg-indigo-700 text-white" : "bg-rose-600 hover:bg-rose-700 text-white"}
            >
              Підтвердити
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function updateMatchInRounds(rounds: Match[][], updatedMatch: Match): Match[][] {
  return rounds.map(round =>
    round.map(m => m.id === updatedMatch.id ? updatedMatch : m)
  );
}

interface CategoryBracketDialogProps {
  categoryId: number;
  onClose: () => void;
}

function CategoryBracketDialog({ categoryId, onClose }: Readonly<CategoryBracketDialogProps>) {
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
        rounds: updateMatchInRounds(prev.rounds, updatedMatch),
      };
    });
  }, [fetchBracket]);

  useMatchUpdates(Number(categoryId), handleMatchUpdate, {
    onConnect: () => {
      fetchBracket(true);
    },
  });

  const renderBracketContent = () => {
    if (isLoading && !bracket) {
      return (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
        </div>
      );
    }
    if (bracket && bracket.rounds.length > 0) {
      return (
        <div className="w-full space-y-6">
          <BracketView bracket={bracket} />
          {bracket.format === "single_repechage" && (
            <div className="mt-8 border-t border-slate-800 pt-6 space-y-4">
              <h2 className="text-sm font-bold tracking-tight text-white flex items-center gap-2 select-none">
                <Trophy className="w-4 h-4 text-amber-500" /> Втішні поєдинки (Репешаж)
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Пул А */}
                <div className="space-y-3">
                  <div className="text-xs font-bold text-slate-400 uppercase tracking-widest border-b border-slate-800 pb-2 select-none">
                    Пул А (Верхня половина сітки)
                  </div>
                  <div className="flex flex-col items-center gap-4">
                    {bracket.rounds
                      .flat()
                      .filter((m) => m.round_index >= 300 && m.match_order === 1)
                      .sort((a, b) => a.round_index - b.round_index)
                      .map((match) => (
                        <div key={match.id} className="relative flex items-center justify-center w-full">
                          <MatchCard match={match} />
                        </div>
                      ))}
                    {bracket.rounds.flat().filter((m) => m.round_index >= 300 && m.match_order === 1).length === 0 && (
                      <div className="text-xs text-slate-500 italic py-4 select-none">Очікує результатів півфіналів...</div>
                    )}
                  </div>
                </div>

                {/* Пул Б */}
                <div className="space-y-3">
                  <div className="text-xs font-bold text-slate-400 uppercase tracking-widest border-b border-slate-800 pb-2 select-none">
                    Пул Б (Нижня половина сітки)
                  </div>
                  <div className="flex flex-col items-center gap-4">
                    {bracket.rounds
                      .flat()
                      .filter((m) => m.round_index >= 300 && m.match_order === 2)
                      .sort((a, b) => a.round_index - b.round_index)
                      .map((match) => (
                        <div key={match.id} className="relative flex items-center justify-center w-full">
                          <MatchCard match={match} />
                        </div>
                      ))}
                    {bracket.rounds.flat().filter((m) => m.round_index >= 300 && m.match_order === 2).length === 0 && (
                      <div className="text-xs text-slate-500 italic py-4 select-none">Очікує результатів півфіналів...</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      );
    }
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-slate-500 text-sm">Сітка порожня або виникла помилка завантаження.</p>
      </div>
    );
  };

  return (
    <Dialog open={true} onOpenChange={(o) => !o && onClose()}>
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

        <div className="py-2 min-h-[300px] flex flex-col justify-start">
          {renderBracketContent()}
        </div>
      </DialogContent>
    </Dialog>
  );
}
