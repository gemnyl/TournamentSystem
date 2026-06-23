/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, react-hooks/exhaustive-deps */
import { useEffect, useState, useMemo } from "react";
import type { FormEvent } from "react";
import {
  Users,
  Trophy,
  Activity,
  CreditCard,
  FileText,
  CheckCircle,
  Plus,
  Loader2,
  Trash2,
  Printer,
  TrendingUp,
  Info,
  Edit2,
  LayoutGrid,
  List,
  Upload,
  Download,
  FileSpreadsheet,
  AlertTriangle,
  Search,
  Layers,
  ChevronDown,
} from "lucide-react";
import api from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useTournamentSocket } from "@/hooks/useTournamentSocket";
import { useMatchUpdates } from "@/hooks/useMatchUpdates";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn, formatSportType, formatRegistrationName, getAgeAsOf } from "@/lib/utils";
import { PhotoUploadField } from "@/components/ui/photo-upload-field";
import type { Athlete, Tournament, Category, Registration, Team, PaginatedResponse } from "@/types/api";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useSearchParams, Link } from "react-router-dom";
import { InvoiceDetailsDialog } from "@/components/tournament/InvoiceDetailsDialog";

const UKRAINIAN_REGIONS = [
  { value: "vinnytsia", label: "Вінницька область" },
  { value: "volyn", label: "Волинська область" },
  { value: "dnipro", label: "Дніпропетровська область" },
  { value: "donetsk", label: "Донецька область" },
  { value: "zhytomyr", label: "Житомирська область" },
  { value: "zakarpattia", label: "Закарпатська область" },
  { value: "zaporizhzhia", label: "Запорізька область" },
  { value: "ivano-frankivsk", label: "Івано-Франківська область" },
  { value: "kyiv_oblast", label: "Київська область" },
  { value: "kyiv_city", label: "м. Київ" },
  { value: "kirovohrad", label: "Кіровоградська область" },
  { value: "luhansk", label: "Луганська область" },
  { value: "lviv", label: "Львівська область" },
  { value: "mykolaiv", label: "Миколаївська область" },
  { value: "odesa", label: "Одеська область" },
  { value: "poltava", label: "Полтавська область" },
  { value: "rivne", label: "Рівненська область" },
  { value: "sumy", label: "Сумська область" },
  { value: "ternopil", label: "Тернопільська область" },
  { value: "kharkiv", label: "Харківська область" },
  { value: "kherson", label: "Херсонська область" },
  { value: "khmelnytskyi", label: "Хмельницька область" },
  { value: "cherkasy", label: "Черкаська область" },
  { value: "chernivtsi", label: "Чернівецька область" },
  { value: "chernihiv", label: "Чернігівська область" },
  { value: "crimea", label: "АР Крим" },
  { value: "sevastopol", label: "м. Севастополь" },
];

// Helper to get relative path from absolute URL returned by django backend
const getRelativePathForApi = (url: string | null) => {
  if (!url) return null;
  let path = url;
  try {
    const parsed = new URL(url);
    path = parsed.pathname + parsed.search;
  } catch {
    // already relative
  }
  if (path.startsWith("/api")) {
    path = path.slice(4);
  }
  return path;
};

const athleteSchema = z.object({
  first_name: z.string().min(1, "Ім'я обов'язкове"),
  last_name: z.string().min(1, "Прізвище обов'язкове"),
  patronymic: z.string().optional(),
  date_of_birth: z.string().min(1, "Введіть дату народження"),
  gender: z.enum(["M", "F"]),
  weight: z.coerce.number().min(20, "Мінімальна вага 20 кг").max(300, "Максимальна вага 300 кг"),
  skill_level: z.string().optional(),
});


type AthleteForm = z.infer<typeof athleteSchema>;

export default function CoachDashboardPage() {
  const { user } = useAuth();

  const [searchParams, setSearchParams] = useSearchParams();

  // Read initial states from URL search parameters, with fallback to default values
  const initialTab = (searchParams.get("tab") as any) || "roster";
  const initialRosterSearch = searchParams.get("rosterSearch") || "";
  const initialRosterSort = searchParams.get("rosterSort") || "last_name";
  const initialActiveSearch = searchParams.get("activeSearch") || "";
  const initialActiveSort = searchParams.get("activeSort") || "name_asc";
  const initialActiveTournamentFilter = searchParams.get("activeTournamentFilter") || "all";
  const initialRegTournamentId = searchParams.get("regTournamentId") || "";
  const initialRegSubTab = (searchParams.get("regSubTab") as any) || "mass";
  const initialLiveSearch = searchParams.get("liveSearch") || "";
  const initialBillingSubTab = (searchParams.get("billingSubTab") as any) || "unpaid";
  const initialBillingViewMode = (searchParams.get("billingViewMode") as any) || "athlete";
  const initialHistoryTournamentFilter = searchParams.get("historyTournamentFilter") || "all";
  const initialHistorySubTab = (searchParams.get("historySubTab") as any) || "summary";

  // Active sub-tab state
  const [activeTab, setActiveTab] = useState<"roster" | "register" | "billing" | "active" | "leaderboard" | "live">(initialTab);

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

  const handleActiveTabChange = (tab: "roster" | "register" | "billing" | "active" | "leaderboard" | "live") => {
    setActiveTab(tab);
    updateQueryParam("tab", tab);
  };

  // Roster states
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [nextAthletesUrl, setNextAthletesUrl] = useState<string | null>(null);
  const [isLoadingAthletes, setIsLoadingAthletes] = useState(false);
  const [selectedAthleteProfile, setSelectedAthleteProfile] = useState<Athlete | null>(null);
  const [selectedAthleteRegs, setSelectedAthleteRegs] = useState<Athlete | null>(null); // New state for registration dialog

  // Weight History real state
  const [weightHistory, setWeightHistory] = useState<{ date: string; weight: number; notes: string }[]>([]);
  const [isLoadingWeightHistory, setIsLoadingWeightHistory] = useState(false);
  const [newLogWeight, setNewLogWeight] = useState("");
  const [newLogNotes, setNewLogNotes] = useState("");
  const [isSavingWeightLog, setIsSavingWeightLog] = useState(false);

  // Excel/CSV import states
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importInputKey, setImportInputKey] = useState(0);

  useEffect(() => {
    if (!isImportDialogOpen) {
      setImportFile(null);
      setImportErrors([]);
      setImportInputKey((prev) => prev + 1);
    }
  }, [isImportDialogOpen]);

  // Smart mass registration states
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [hasLoadedTournaments, setHasLoadedTournaments] = useState(false);
  const [selectedTournamentId, setSelectedTournamentId] = useState<string>(initialRegTournamentId);
  const [tournamentCategories, setTournamentCategories] = useState<Category[]>([]);
  const [regSubTab, setRegSubTab] = useState<"mass" | "team">(initialRegSubTab);
  const [massSelectedCategories, setMassSelectedCategories] = useState<Record<number, number[]>>({});
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>("");
  const [liabilityWaiver, setLiabilityWaiver] = useState(false);
  const [isSubmittingReg, setIsSubmittingReg] = useState(false);
  const [isTournamentDropdownOpen, setIsTournamentDropdownOpen] = useState(false);
  const [tournamentSearch, setTournamentSearch] = useState("");

  // Search, sort & registration states
  const [rosterSearch, setRosterSearch] = useState(initialRosterSearch);
  const [rosterSort, setRosterSort] = useState(initialRosterSort);
  const [regSearch, setRegSearch] = useState("");
  const [teamSearch, setTeamSearch] = useState("");
  const [teamCategorySearch, setTeamCategorySearch] = useState("");
  const [showAutofillWarning, setShowAutofillWarning] = useState(false);

  const handleRosterSearchChange = (val: string) => {
    setRosterSearch(val);
    updateQueryParam("rosterSearch", val);
  };

  const handleRosterSortChange = (val: string) => {
    setRosterSort(val);
    updateQueryParam("rosterSort", val);
  };

  const handleSelectedTournamentIdChange = (val: string) => {
    setSelectedTournamentId(val);
    updateQueryParam("regTournamentId", val);
  };

  const handleRegSubTabChange = (val: "mass" | "team") => {
    setRegSubTab(val);
    updateQueryParam("regSubTab", val);
  };

  const handleMassCategoryClick = (athleteId: number, categoryId: number, isSelected: boolean) => {
    setMassSelectedCategories((prev) => {
      const current = prev[athleteId] || [];
      const updated = isSelected ? current.filter((id) => id !== categoryId) : [...current, categoryId];
      return { ...prev, [athleteId]: updated };
    });
  };

  const handleSelectTeamAthlete = (athlete: Athlete, teamSize: number) => {
    setTeamRegAthletes((prev) => {
      if (prev.length < teamSize) {
        return [...prev, athlete];
      }
      return prev;
    });
  };

  const handleDeselectTeamAthlete = (athlete: Athlete) => {
    setTeamRegAthletes((prev) => prev.filter((a) => a.id !== athlete.id));
  };

  // Simplified team registration states (on-the-fly)
  const [teamRegName, setTeamRegName] = useState("");
  const [teamRegAthletes, setTeamRegAthletes] = useState<Athlete[]>([]);
  const teamRegAthleteIds = useMemo(() => teamRegAthletes.map(a => a.id), [teamRegAthletes]);

  const filteredTournamentsForSelect = useMemo(() => {
    const query = tournamentSearch.toLowerCase().trim();
    if (!query) return tournaments;
    return tournaments.filter((t) =>
      t.title.toLowerCase().includes(query) ||
      (t.sport_type && t.sport_type.toLowerCase().includes(query))
    );
  }, [tournaments, tournamentSearch]);

  useEffect(() => {
    if (user?.club?.name) {
      setTeamRegName(user.club.name);
    }
  }, [user]);

  // Invoices & billing states
  const [unpaidRegistrations, setUnpaidRegistrations] = useState<Registration[]>([]);
  const [isLoadingBilling, setIsLoadingBilling] = useState(false);
  const [isPayingInvoice, setIsPayingInvoice] = useState(false);
  const [showPayModal, setShowPayModal] = useState<any | null>(null);
  const [billingClubScope, setBillingClubScope] = useState<"coach" | "club">("coach");
  const [transactions, setTransactions] = useState<any[]>([]);
  const [isLoadingTransactions, setIsLoadingTransactions] = useState(false);
  const [billingSubTab, setBillingSubTab] = useState<"unpaid" | "history">(initialBillingSubTab);
  const [billingViewMode, setBillingViewMode] = useState<"athlete" | "list">(initialBillingViewMode);

  const handleBillingSubTabChange = (val: "unpaid" | "history") => {
    setBillingSubTab(val);
    updateQueryParam("billingSubTab", val);
  };

  const handleBillingViewModeChange = (val: "athlete" | "list") => {
    setBillingViewMode(val);
    updateQueryParam("billingViewMode", val);
  };

  const [selectedBillingRegIds, setSelectedBillingRegIds] = useState<number[]>([]);
  const [collapsedAthletes, setCollapsedAthletes] = useState<Record<string, boolean>>({});
  const [withdrawWarningReg, setWithdrawWarningReg] = useState<Registration | null>(null);
  const [withdrawAllCategories, setWithdrawAllCategories] = useState(false);
  const [confirmingRefundId, setConfirmingRefundId] = useState<number | null>(null);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [isLoadingInvoices, setIsLoadingInvoices] = useState(false);
  const [isSyncingInvoiceId, setIsSyncingInvoiceId] = useState<number | null>(null);
  const [selectedInvoiceForModal, setSelectedInvoiceForModal] = useState<any | null>(null);
  const [isInvoiceModalOpen, setIsInvoiceModalOpen] = useState(false);

  const handleOpenInvoiceModal = (invoice: any) => {
    setSelectedInvoiceForModal(invoice);
    setIsInvoiceModalOpen(true);
  };

  const [historyTournamentFilter, setHistoryTournamentFilter] = useState<string>(initialHistoryTournamentFilter);
  const [historySubTab, setHistorySubTab] = useState<"summary" | "athlete" | "category" | "transactions">(initialHistorySubTab);

  const handleHistoryTournamentFilterChange = (val: string) => {
    setHistoryTournamentFilter(val);
    updateQueryParam("historyTournamentFilter", val);
  };

  const handleHistorySubTabChange = (val: "summary" | "athlete" | "category" | "transactions") => {
    setHistorySubTab(val);
    updateQueryParam("historySubTab", val);
  };

  // Active registrations states
  const [activeRegistrations, setActiveRegistrations] = useState<Registration[]>([]);
  const [allRegistrations, setAllRegistrations] = useState<Registration[]>([]);

  // Tournament filter states
  const [billingTournamentFilter, setBillingTournamentFilter] = useState<string>("all");
  const [activeTournamentFilter, setActiveTournamentFilter] = useState(initialActiveTournamentFilter);
  const [activeSearch, setActiveSearch] = useState(initialActiveSearch);
  const [activeSort, setActiveSort] = useState(initialActiveSort);

  const handleActiveSearchChange = (val: string) => {
    setActiveSearch(val);
    updateQueryParam("activeSearch", val);
  };

  const handleActiveSortChange = (val: string) => {
    setActiveSort(val);
    updateQueryParam("activeSort", val);
  };

  const handleActiveTournamentFilterChange = (val: string) => {
    setActiveTournamentFilter(val);
    updateQueryParam("activeTournamentFilter", val);
  };

  interface TournamentWebSocketListenerProps {
    tournamentId: number;
    onUpdate: () => void;
  }

  function TournamentWebSocketListener({ tournamentId, onUpdate }: TournamentWebSocketListenerProps) {
    useTournamentSocket(tournamentId, onUpdate);
    return null;
  }

  const fetchWeightHistory = async (athleteId: number) => {
    setIsLoadingWeightHistory(true);
    try {
      const { data } = await api.get<{ id: number; weight: number; logged_at: string; notes: string }[]>(`/athletes/${athleteId}/weight_history/`);
      const formatted = data.map(log => ({
        date: new Date(log.logged_at).toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit" }),
        weight: Number(log.weight),
        notes: log.notes
      }));
      setWeightHistory(formatted);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoadingWeightHistory(false);
    }
  };

  useEffect(() => {
    if (selectedAthleteProfile) {
      fetchWeightHistory(selectedAthleteProfile.id);
    } else {
      setWeightHistory([]);
    }
  }, [selectedAthleteProfile]);

  useEffect(() => {
    if (!withdrawWarningReg) {
      setWithdrawAllCategories(false);
    }
  }, [withdrawWarningReg]);

  const otherRegsToWithdraw = useMemo(() => {
    if (!withdrawWarningReg) return [];
    const athleteId = withdrawWarningReg.athlete?.id;
    const teamId = withdrawWarningReg.team?.id;
    const tournamentId = withdrawWarningReg.tournament_id;

    return activeRegistrations.filter((r) => {
      if (r.id === withdrawWarningReg.id) return false;
      if (r.tournament_id !== tournamentId) return false;
      if (athleteId && r.athlete?.id === athleteId) return true;
      if (teamId && r.team?.id === teamId) return true;
      return false;
    });
  }, [withdrawWarningReg, activeRegistrations]);

  const otherRegsCount = otherRegsToWithdraw.length;

  const regsToWithdraw = useMemo(() => {
    if (!withdrawWarningReg) return [];
    return [withdrawWarningReg, ...(withdrawAllCategories ? otherRegsToWithdraw : [])].filter(Boolean);
  }, [withdrawWarningReg, withdrawAllCategories, otherRegsToWithdraw]);

  const hasPaidRegs = useMemo(() => {
    return regsToWithdraw.some((r) => r.payment_status === "paid");
  }, [regsToWithdraw]);

  const onlinePaidRegs = useMemo(() => {
    return regsToWithdraw.filter((r) => r.payment_status === "paid" && r.payment_method === "online");
  }, [regsToWithdraw]);

  const offlinePaidRegs = useMemo(() => {
    return regsToWithdraw.filter((r) => r.payment_status === "paid" && r.payment_method !== "online");
  }, [regsToWithdraw]);

  const onlineBaseFee = useMemo(() => {
    return onlinePaidRegs.reduce((sum, r) => sum + (r.fee || 0), 0);
  }, [onlinePaidRegs]);

  const onlineTotalPaid = useMemo(() => {
    return onlinePaidRegs.reduce((sum, r) => {
      const base = r.fee || 0;
      return sum + (r.commission_payer === "buyer" ? Math.round(base * 1.05) : base);
    }, 0);
  }, [onlinePaidRegs]);

  const onlineCommission = useMemo(() => {
    return onlinePaidRegs
      .filter((r) => r.refund_policy === "refundable")
      .reduce((sum, r) => sum + Math.round((r.fee || 0) * 0.05), 0);
  }, [onlinePaidRegs]);

  const onlineRefund = useMemo(() => {
    return onlinePaidRegs.reduce((sum, r) => {
      const base = r.fee || 0;
      if (r.refund_policy === "refundable") {
        return sum + (r.commission_payer === "buyer" ? base : Math.round(base * 0.95));
      }
      return sum;
    }, 0);
  }, [onlinePaidRegs]);

  const offlineBaseFee = useMemo(() => {
    return offlinePaidRegs.reduce((sum, r) => sum + (r.fee || 0), 0);
  }, [offlinePaidRegs]);

  const offlineRefund = useMemo(() => {
    return offlinePaidRegs.reduce((sum, r) => {
      const base = r.fee || 0;
      if (r.refund_policy === "refundable") {
        return sum + base;
      }
      return sum;
    }, 0);
  }, [offlinePaidRegs]);

  const handleAddWeightLog = async () => {
    if (!selectedAthleteProfile || !newLogWeight) return;
    setIsSavingWeightLog(true);
    try {
      await api.post(`/athletes/${selectedAthleteProfile.id}/log_weight/`, {
        weight: Number(newLogWeight),
        notes: newLogNotes
      });
      toast({ title: "Замір ваги додано успішно!" });
      setNewLogWeight("");
      setNewLogNotes("");
      fetchWeightHistory(selectedAthleteProfile.id);
      fetchRoster(true); // refresh athletes list to update base weight on cards
    } catch (e) {
      // handled by interceptor
    } finally {
      setIsSavingWeightLog(false);
    }
  };

  const handleImportAthletes = async (e: FormEvent) => {
    e.preventDefault();
    if (!importFile) return;
    setIsImporting(true);
    setImportErrors([]);
    const formData = new FormData();
    formData.append("file", importFile);
    try {
      const { data } = await api.post<{ detail: string; imported_count: number }>("/athletes/import_athletes/", formData, {
        headers: { "Content-Type": "multipart/form-data" }
      });
      toast({ title: "Імпорт завершено!", description: data.detail });
      setIsImportDialogOpen(false);
      setImportFile(null);
      fetchRoster(true); // reload roster
    } catch (err: any) {
      if (err.response?.data?.errors) {
        setImportErrors(err.response.data.errors);
      } else {
        const isNetworkError = !err.response;
        const msg = isNetworkError
          ? "Файл був змінений на диску після вибору або виникла помилка мережі. Будь ласка, оберіть файл заново."
          : (err.response?.data?.detail || "Щось пішло не так");
        toast({ title: "Помилка імпорту", description: msg, variant: "destructive" });
      }
      setImportFile(null);
      setImportInputKey((prev) => prev + 1);
    } finally {
      setIsImporting(false);
    }
  };

  const uniqueTournamentIds = useMemo(() => {
    const ids = new Set<number>();
    activeRegistrations.forEach((r) => {
      if (r.tournament_id) ids.add(r.tournament_id);
    });
    unpaidRegistrations.forEach((r) => {
      if (r.tournament_id) ids.add(r.tournament_id);
    });
    return Array.from(ids);
  }, [activeRegistrations, unpaidRegistrations]);

  const filteredRegAthletes = useMemo(() => {
    if (!regSearch) return athletes;
    const term = regSearch.toLowerCase();
    return athletes.filter((ath) => {
      const fullName = `${ath.last_name} ${ath.first_name} ${ath.patronymic || ""}`.toLowerCase();
      return fullName.includes(term);
    });
  }, [athletes, regSearch]);

  const handleWebSocketUpdate = () => {
    fetchBilling();
    fetchActiveRegistrations();
  };
  const [isLoadingActiveRegs, setIsLoadingActiveRegs] = useState(false);
  const [withdrawingRegId, setWithdrawingRegId] = useState<number | null>(null);

  // Live monitor states
  const [liveMatches, setLiveMatches] = useState<any[]>([]);
  const [liveSearch, setLiveSearch] = useState(initialLiveSearch);
  const [massCategorySearch, setMassCategorySearch] = useState("");

  const handleLiveSearchChange = (val: string) => {
    setLiveSearch(val);
    updateQueryParam("liveSearch", val);
  };

  const uniqueCategoryIds = useMemo(() => {
    const ids = new Set<number>();
    liveMatches.forEach((m) => {
      if (m.category) ids.add(m.category);
    });
    return Array.from(ids);
  }, [liveMatches]);

  const filteredLiveMatches = useMemo(() => {
    const query = liveSearch.trim().toLowerCase();
    if (!query) return liveMatches;
    return liveMatches.filter((m) => {
      // 1. Aka corner
      const akaName = (formatRegistrationName(m.reg_first) || m.athlete_first?.last_name || "").toLowerCase();
      // 2. Ao corner
      const aoName = (formatRegistrationName(m.reg_second) || m.athlete_second?.last_name || "").toLowerCase();
      // 3. Category / Tournament names
      const category = (m.category_name || "").toLowerCase();
      const tournament = (m.tournament_title || "").toLowerCase();

      if (akaName.includes(query) || aoName.includes(query) || category.includes(query) || tournament.includes(query)) {
        return true;
      }

      // 4. Sub-bout athletes
      if (m.team_bouts && m.team_bouts.length > 0) {
        return m.team_bouts.some((bout: any) => {
          const akaBout = bout.athlete_first ? `${bout.athlete_first.last_name} ${bout.athlete_first.first_name}`.toLowerCase() : "";
          const aoBout = bout.athlete_second ? `${bout.athlete_second.last_name} ${bout.athlete_second.first_name}`.toLowerCase() : "";
          return akaBout.includes(query) || aoBout.includes(query);
        });
      }
      return false;
    });
  }, [liveMatches, liveSearch]);

  // Athlete CRUD states
  const [isAthleteDialogOpen, setIsAthleteDialogOpen] = useState(false);
  const [editingAthlete, setEditingAthlete] = useState<Athlete | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedGender, setSelectedGender] = useState<"M" | "F">("M");
  const [isSavingAthlete, setIsSavingAthlete] = useState(false);
  const [athleteViewMode, setAthleteViewMode] = useState<"cards" | "list">("cards");
  const [athleteToDelete, setAthleteToDelete] = useState<Athlete | null>(null);
  const [isDeletingAthlete, setIsDeletingAthlete] = useState(false);

  const { register: regAthlete, handleSubmit: handleAthleteSubmit, setValue: setAthleteValue, reset: resetAthlete, formState: { errors: athleteErrors } } = useForm<AthleteForm>({
    resolver: zodResolver(athleteSchema),
    defaultValues: { gender: "M" }
  });

  const startEditAthlete = (a: Athlete) => {
    setEditingAthlete(a);
    setSelectedFile(null);
    const birthDate = a.birth_date ? a.birth_date.substring(0, 10) : "";
    const genderKey = a.gender === "female" ? "F" : "M";
    setSelectedGender(genderKey);

    resetAthlete({
      first_name: a.first_name,
      last_name: a.last_name,
      patronymic: a.patronymic || "",
      date_of_birth: birthDate,
      gender: genderKey,
      weight: Number(a.base_weight),
      skill_level: a.skill_level || "",
    });

    setIsAthleteDialogOpen(true);
  };

  const handleSaveAthlete = async (data: AthleteForm) => {
    setIsSavingAthlete(true);
    try {
      const genderMap = { M: "male", F: "female" };
      const formData = new FormData();
      formData.append("first_name", data.first_name);
      formData.append("last_name", data.last_name);
      formData.append("patronymic", data.patronymic || "");
      formData.append("birth_date", data.date_of_birth);
      formData.append("gender", genderMap[data.gender]);
      formData.append("base_weight", String(data.weight));
      formData.append("skill_level", data.skill_level || "");

      if (user?.club?.id) {
        formData.append("club_id", String(user.club.id));
      }

      if (selectedFile) {
        formData.append("photo", selectedFile);
      }

      const headers = { "Content-Type": "multipart/form-data" };

      if (editingAthlete) {
        await api.patch(`/athletes/${editingAthlete.id}/`, formData, { headers });
        toast({ title: "Дані атлета оновлено!" });
      } else {
        await api.post("/athletes/", formData, { headers });
        toast({ title: "Атлета успішно додано!" });
      }

      setIsAthleteDialogOpen(false);
      resetAthlete();
      setEditingAthlete(null);
      setSelectedFile(null);
      setSelectedGender("M");
      fetchRoster(true);
    } catch {
      // handled by api interceptor
    } finally {
      setIsSavingAthlete(false);
    }
  };

  const handleConfirmDeleteAthlete = async () => {
    if (!athleteToDelete) return;
    setIsDeletingAthlete(true);
    try {
      await api.delete(`/athletes/${athleteToDelete.id}/`);
      toast({ title: "Спортсмена успішно видалено з реєстру!" });
      setAthleteToDelete(null);
      fetchRoster(true);
    } catch {
      // handled by api interceptor
    } finally {
      setIsDeletingAthlete(false);
    }
  };

  const printBadges = (items: Array<{ athlete: Athlete | null; registration?: Registration }>) => {
    const validItems = items.filter(item => item.athlete || (item.registration && item.registration.team));
    if (validItems.length === 0) return;

    const REGIONS_MAP: Record<string, string> = {
      vinnytsia: "Вінницька обл.",
      volyn: "Волинська обл.",
      dnipro: "Дніпропетровська обл.",
      donetsk: "Донецька обл.",
      zhytomyr: "Житомирська обл.",
      zakarpattia: "Закарпатська обл.",
      zaporizhzhia: "Запорізька обл.",
      "ivano-frankivsk": "Івано-Франківська обл.",
      kyiv_oblast: "Київська обл.",
      kyiv_city: "м. Київ",
      kirovohrad: "Кіровоградська обл.",
      luhansk: "Луганська обл.",
      lviv: "Львівська обл.",
      mykolaiv: "Миколаївська обл.",
      odesa: "Одеська обл.",
      poltava: "Poltava Oblast",
      rivne: "Рівненська обл.",
      sumy: "Сумська обл.",
      ternopil: "Тернопільська обл.",
      kharkiv: "Харківська обл.",
      kherson: "Херсонська обл.",
      khmelnytskyi: "Хмельницька обл.",
      cherkasy: "Черкаська обл.",
      chernivtsi: "Чернівецька обл.",
      chernihiv: "Чернігівська обл.",
      crimea: "АР Крим",
      sevastopol: "м. Севастополь"
    };

    // 1. Expand and separate base profile passes vs registrations
    const flatRegistrations: Array<{ athlete: Athlete; registration: Registration }> = [];
    const baseAthletePasses: Athlete[] = [];
    const teamOnlyRegistrations: Registration[] = []; // fallback if team has no athletes

    validItems.forEach(({ athlete: a, registration: reg }) => {
      if (reg) {
        if (reg.team) {
          if (reg.team.athletes && reg.team.athletes.length > 0) {
            reg.team.athletes.forEach(member => {
              flatRegistrations.push({
                athlete: member,
                registration: reg
              });
            });
          } else {
            teamOnlyRegistrations.push(reg);
          }
        } else if (a) {
          flatRegistrations.push({
            athlete: a,
            registration: reg
          });
        } else if (reg.athlete) {
          flatRegistrations.push({
            athlete: reg.athlete,
            registration: reg
          });
        }
      } else if (a) {
        baseAthletePasses.push(a);
      }
    });

    // 2. Group registrations by athlete ID
    const groupedRegistrations: Map<number, { athlete: Athlete; registrations: Registration[] }> = new Map();
    flatRegistrations.forEach(({ athlete, registration }) => {
      const athleteId = athlete.id;
      if (!groupedRegistrations.has(athleteId)) {
        groupedRegistrations.set(athleteId, { athlete, registrations: [] });
      }
      const group = groupedRegistrations.get(athleteId)!;
      if (!group.registrations.some(r => r.id === registration.id)) {
        group.registrations.push(registration);
      }
    });

    let cardsHtml = "";

    // 3. Render grouped tournament passes
    groupedRegistrations.forEach(({ athlete: a, registrations: regs }) => {
      const firstName = `${a.first_name || ""} ${a.patronymic || ""}`.trim();
      const lastName = a.last_name || "";
      const photoHtml = a.photo
        ? `<img src="${a.photo}" alt="" onerror="this.style.display='none'" />`
        : `<span>${a.first_name?.[0] || ""}${a.last_name?.[0] || ""}</span>`;

      const clubName = a.club?.name || user?.club?.name || "Без клубу";
      const clubRegionCode = a.club?.region;
      const clubRegion = clubRegionCode ? (REGIONS_MAP[clubRegionCode] || clubRegionCode) : "";
      const clubLabelText = clubRegion ? `${clubName} (${clubRegion})` : clubName;

      const ageVal = a.birth_date ? `${getAgeAsOf(a.birth_date, new Date().toISOString())} р.` : "—";
      const weightVal = a.base_weight ? `${a.base_weight} кг` : "—";
      const genderVal = a.gender === "female" ? "Ж / F" : "Ч / M";

      let token = a.qr_token || "";
      let qrType = "athlete";
      if (!token && regs.length > 0) {
        token = regs[0].qr_token || "";
        qrType = "registration";
      }
      const qrData = token ? `${window.location.origin}/verify/${qrType}/${token}` : "unknown";

      let regHtml = "";
      if (regs.length > 0) {
        const tournamentGroups: Map<string, string[]> = new Map();
        regs.forEach(r => {
          const tTitle = r.tournament_title || "Турнір";
          if (!tournamentGroups.has(tTitle)) {
            tournamentGroups.set(tTitle, []);
          }
          let catName = r.category_name;
          if (r.team) {
            catName += ` [${r.team.name}]`;
          }
          tournamentGroups.get(tTitle)!.push(catName);
        });

        let tournamentHtml = "";
        tournamentGroups.forEach((categories, tTitle) => {
          tournamentHtml += `
            <div class="tournament-group">
              <div class="details-title">${tTitle}</div>
              <div class="details-categories">
                ${categories.map(c => `<div class="details-category">${c}</div>`).join("")}
              </div>
            </div>
          `;
        });

        regHtml = `
          <div class="details-box">
            ${tournamentHtml}
          </div>
        `;
      }

      cardsHtml += `
        <div class="pass-card">
          <div class="lanyard-slot"></div>

          <div class="badge-header-band">
            <div class="badge-title">Tournament Pass</div>
          </div>

          <div class="avatar-frame">
            ${photoHtml}
          </div>

          <div class="name-block">
            <div class="last-name">${lastName}</div>
            <div class="first-name">${firstName}</div>
          </div>

          <div class="club-label">${clubLabelText}</div>

          ${regHtml}

          <div class="meta-row">
            <div>
              <div class="meta-val">${ageVal}</div>
              <div class="meta-lbl">Вік / Age</div>
            </div>
            <div>
              <div class="meta-val">${weightVal}</div>
              <div class="meta-lbl">Вага / Weight</div>
            </div>
            <div>
              <div class="meta-val">${genderVal}</div>
              <div class="meta-lbl">Стать / Sex</div>
            </div>
          </div>

          <div class="footer-section">
            <div class="qr-box">
              <img src="https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(qrData)}" />
            </div>
          </div>
        </div>
      `;
    });

    // 4. Render base profile passes (roster passes)
    baseAthletePasses.forEach(a => {
      const firstName = `${a.first_name || ""} ${a.patronymic || ""}`.trim();
      const lastName = a.last_name || "";
      const photoHtml = a.photo
        ? `<img src="${a.photo}" alt="" onerror="this.style.display='none'" />`
        : `<span>${a.first_name?.[0] || ""}${a.last_name?.[0] || ""}</span>`;

      const clubName = a.club?.name || user?.club?.name || "Без клубу";
      const clubRegionCode = a.club?.region;
      const clubRegion = clubRegionCode ? (REGIONS_MAP[clubRegionCode] || clubRegionCode) : "";
      const clubLabelText = clubRegion ? `${clubName} (${clubRegion})` : clubName;

      const ageVal = a.birth_date ? `${getAgeAsOf(a.birth_date, new Date().toISOString())} р.` : "—";
      const weightVal = a.base_weight ? `${a.base_weight} кг` : "—";
      const genderVal = a.gender === "female" ? "Ж / F" : "Ч / M";

      const token = a.qr_token || "";
      const qrData = token ? `${window.location.origin}/verify/athlete/${token}` : "unknown";

      cardsHtml += `
        <div class="pass-card">
          <div class="lanyard-slot"></div>

          <div class="badge-header-band">
            <div class="badge-title">Competitor Pass</div>
          </div>

          <div class="avatar-frame">
            ${photoHtml}
          </div>

          <div class="name-block">
            <div class="last-name">${lastName}</div>
            <div class="first-name">${firstName}</div>
          </div>

          <div class="club-label">${clubLabelText}</div>

          <div class="meta-row">
            <div>
              <div class="meta-val">${ageVal}</div>
              <div class="meta-lbl">Вік / Age</div>
            </div>
            <div>
              <div class="meta-val">${weightVal}</div>
              <div class="meta-lbl">Вага / Weight</div>
            </div>
            <div>
              <div class="meta-val">${genderVal}</div>
              <div class="meta-lbl">Стать / Sex</div>
            </div>
          </div>

          <div class="footer-section">
            <div class="qr-box">
              <img src="https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(qrData)}" />
            </div>
          </div>
        </div>
      `;
    });

    // 5. Fallback team passes (if team has no athletes)
    teamOnlyRegistrations.forEach(reg => {
      const lastName = reg.team?.name || "Команда";
      const photoHtml = `<span>T</span>`;

      const clubName = reg.team?.club?.name || user?.club?.name || "Без клубу";
      const clubRegionCode = reg.team?.club?.region;
      const clubRegion = clubRegionCode ? (REGIONS_MAP[clubRegionCode] || clubRegionCode) : "";
      const clubLabelText = clubRegion ? `${clubName} (${clubRegion})` : clubName;

      const token = reg.qr_token || "";
      const qrData = token ? `${window.location.origin}/verify/registration/${token}` : "unknown";

      let catName = reg.category_name;
      if (reg.team) {
        catName += ` [${reg.team.name}]`;
      }

      cardsHtml += `
        <div class="pass-card">
          <div class="lanyard-slot"></div>

          <div class="badge-header-band">
            <div class="badge-title">Tournament Pass</div>
          </div>

          <div class="avatar-frame">
            ${photoHtml}
          </div>

          <div class="name-block">
            <div class="last-name">${lastName}</div>
            <div class="first-name"></div>
          </div>

          <div class="club-label">${clubLabelText}</div>

          <div class="details-box">
            <div class="tournament-group">
              <div class="details-title">${reg.tournament_title || "Турнір"}</div>
              <div class="details-categories">
                <div class="details-category">${catName}</div>
              </div>
            </div>
          </div>

          <div class="meta-row">
            <div>
              <div class="meta-val">—</div>
              <div class="meta-lbl">Вік / Age</div>
            </div>
            <div>
              <div class="meta-val">—</div>
              <div class="meta-lbl">Вага / Weight</div>
            </div>
            <div>
              <div class="meta-val">—</div>
              <div class="meta-lbl">Стать / Sex</div>
            </div>
          </div>

          <div class="footer-section">
            <div class="qr-box">
              <img src="https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(qrData)}" />
            </div>
          </div>
        </div>
      `;
    });

    const printWindow = window.open("", "_blank");
    if (printWindow) {
      printWindow.document.write(`
        <html>
          <head>
            <title>Бейджі учасників</title>
            <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700;900&display=swap" rel="stylesheet">
            <style>
              body {
                font-family: 'Outfit', sans-serif;
                margin: 0;
                background: #020617;
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
              }
              .content-container {
                margin-top: 60px;
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 40px;
                width: 100%;
                min-height: calc(100vh - 60px);
                box-sizing: border-box;
                padding: 40px 20px;
              }
              .pass-card {
                width: 378px;
                height: 529px;
                background: #0f172a;
                border: 2px solid #f59e0b;
                border-radius: 20px;
                display: flex;
                flex-direction: column;
                align-items: center;
                position: relative;
                box-sizing: border-box;
                padding: 12px 16px;
                text-align: center;
                justify-content: space-between;
                box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 40px 0 rgba(245, 158, 11, 0.15);
                overflow: hidden;
                color: #f8fafc;
              }
              .lanyard-slot {
                width: 40px;
                height: 8px;
                background: #1e293b;
                border: 2px dashed #475569;
                border-radius: 4px;
                position: absolute;
                top: 8px;
                left: 50%;
                transform: translateX(-50%);
                z-index: 10;
              }
              .badge-header-band {
                background: #090d16;
                width: calc(100% + 32px);
                margin: -12px -16px 8px -16px;
                padding: 24px 16px 8px 16px;
                box-sizing: border-box;
                border-top-left-radius: 18px;
                border-top-right-radius: 18px;
                border-bottom: 2px solid #f59e0b;
                flex-shrink: 0;
              }
              .badge-title {
                font-size: 11px;
                text-transform: uppercase;
                letter-spacing: 2px;
                font-weight: 900;
                color: #f59e0b;
                margin: 0;
              }
              .avatar-frame {
                width: 90px;
                height: 90px;
                border-radius: 50%;
                border: 3px solid #f59e0b;
                background: #090d16;
                overflow: hidden;
                display: flex;
                justify-content: center;
                align-items: center;
                font-size: 28px;
                font-weight: 900;
                color: #94a3b8;
                position: relative;
                flex-shrink: 0;
              }
              .avatar-frame img {
                width: 100%;
                height: 100%;
                object-fit: cover;
              }
              .name-block {
                margin: 4px 0 2px 0;
                flex-shrink: 0;
              }
              .last-name {
                font-size: 18px;
                font-weight: 900;
                text-transform: uppercase;
                color: #ffffff;
                line-height: 1.1;
              }
              .first-name {
                font-size: 14px;
                font-weight: 700;
                color: #cbd5e1;
                line-height: 1.1;
                margin-top: 4px;
              }
              .club-label {
                font-size: 10px;
                font-weight: 700;
                text-transform: uppercase;
                color: #f59e0b;
                letter-spacing: 1px;
                margin-bottom: 4px;
                max-width: 100%;
                flex-shrink: 0;
              }
              .details-box {
                background: #090d16;
                border: 1px solid #1e293b;
                border-radius: 12px;
                padding: 4px 8px;
                width: 100%;
                box-sizing: border-box;
                margin-bottom: 4px;
                flex-shrink: 0;
              }
              .details-title {
                font-size: 10px;
                font-weight: 800;
                color: #ffffff;
                margin-bottom: 4px;
                text-align: center;
              }
              .details-category {
                font-size: 9px;
                font-weight: 700;
                color: #ffffff;
                background: #090d16;
                border: 1px solid #f59e0b;
                padding: 2px 6px;
                border-radius: 9999px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                text-align: center;
              }
              .details-category::before {
                content: "";
                display: inline-block;
                width: 4px;
                height: 4px;
                background-color: #f59e0b;
                transform: rotate(45deg);
                margin-right: 6px;
                flex-shrink: 0;
              }
              .details-categories {
                display: flex;
                flex-flow: row wrap;
                gap: 4px 6px;
                justify-content: center;
                align-items: center;
                width: 100%;
                box-sizing: border-box;
              }
              .tournament-group {
                width: 100%;
                box-sizing: border-box;
              }
              .tournament-group:not(:last-child) {
                margin-bottom: 6px;
                border-bottom: 1px dashed #1e293b;
                padding-bottom: 4px;
              }
              .meta-row {
                display: flex;
                justify-content: space-around;
                width: 100%;
                border-top: 1px solid #1e293b;
                border-bottom: 1px solid #1e293b;
                padding: 3px 0;
                margin-bottom: 4px;
                flex-shrink: 0;
              }
              .meta-val {
                font-size: 11px;
                font-weight: 700;
                color: #ffffff;
              }
              .meta-lbl {
                font-size: 7.5px;
                text-transform: uppercase;
                color: #64748b;
                font-weight: 800;
                letter-spacing: 0.5px;
              }
              .footer-section {
                display: flex;
                align-items: center;
                justify-content: center;
                width: 100%;
                flex-shrink: 0;
              }
              .qr-box {
                width: 80px;
                height: 80px;
                border: 1px solid #e2e8f0;
                padding: 4px;
                background: #ffffff;
                border-radius: 8px;
              }
              .qr-box img {
                width: 100%;
                height: 100%;
              }
              .last-name, .first-name, .club-label, .details-title, .details-category {
                white-space: normal !important;
                word-wrap: break-word !important;
                overflow-wrap: break-word !important;
                text-overflow: clip !important;
              }
              .toolbar {
                display: flex;
                align-items: center;
                gap: 12px;
                background: #0f172a;
                padding: 12px 24px;
                width: 100%;
                box-sizing: border-box;
                position: fixed;
                top: 0;
                left: 0;
                z-index: 1000;
                border-bottom: 1px solid #1e293b;
              }
              .toolbar button {
                font-family: 'Outfit', sans-serif;
                font-size: 12px;
                font-weight: 700;
                padding: 8px 16px;
                border: none;
                border-radius: 8px;
                cursor: pointer;
                transition: all 0.2s ease;
              }
              .btn-print {
                background: #f59e0b;
                color: #0f172a;
              }
              .btn-print:hover {
                background: #d97706;
              }
              .btn-close {
                background: #334155;
                color: #f8fafc;
              }
              .btn-close:hover {
                background: #475569;
              }
              .instructions {
                color: #94a3b8;
                font-size: 11px;
                font-weight: 600;
                margin-left: 10px;
              }
              @media print {
                .no-print {
                  display: none !important;
                }
                .content-container {
                  margin-top: 0 !important;
                  height: auto !important;
                  background: none !important;
                  padding: 0 !important;
                  gap: 0 !important;
                }
                @page {
                  size: 100mm 140mm;
                  margin: 0;
                }
                body {
                  margin: 0;
                  background: #020617;
                }
                .pass-card {
                  border: none;
                  border-radius: 0;
                  width: 100mm;
                  height: 140mm;
                  box-shadow: none;
                  page-break-inside: avoid;
                  page-break-after: always;
                  margin: 0;
                  padding: 12px 16px;
                  background: #0f172a;
                }
                .pass-card:last-child {
                  page-break-after: avoid;
                }
                .badge-header-band {
                  border-top-left-radius: 0;
                  border-top-right-radius: 0;
                  margin: -12px -16px 8px -16px;
                  width: calc(100% + 32px);
                  background: #090d16;
                }
              }
            </style>
          </head>
          <body>
            <div class="toolbar no-print">
              <button class="btn-print" onclick="window.print()">Друк / Зберегти як PDF</button>
              <button class="btn-close" onclick="window.close()">Закрити</button>
              <div class="instructions">💡 Порада: щоб завантажити бейджі окремим PDF файлом, у вікні друку оберіть «Зберегти як PDF» (Save as PDF).</div>
            </div>

            <div class="content-container">
              ${cardsHtml}
            </div>
          </body>
        </html>
      `);
      printWindow.document.close();
    }
  };

  const printBadge = (a: Athlete | null, reg?: Registration) => {
    printBadges([{ athlete: a, registration: reg }]);
  };

  // Fetch initial Roster data
  const fetchRoster = async (reset = true) => {
    setIsLoadingAthletes(true);
    try {
      let endpoint = reset ? "/athletes/" : getRelativePathForApi(nextAthletesUrl);
      if (!endpoint) return;

      if (reset) {
        const params = new URLSearchParams();
        if (activeTab === "roster") {
          if (rosterSearch) params.append("search", rosterSearch);
          if (rosterSort) params.append("ordering", rosterSort);
        } else if (activeTab === "register") {
          params.append("ordering", "last_name,first_name");
          const searchVal = regSubTab === "team" ? teamSearch : regSearch;
          if (searchVal) params.append("search", searchVal);
        }
        const queryString = params.toString();
        if (queryString) {
          endpoint = `/athletes/?${queryString}`;
        }
      }

      const { data } = await api.get<PaginatedResponse<Athlete> | Athlete[]>(endpoint);
      if (Array.isArray(data)) {
        setAthletes(data);
        setNextAthletesUrl(null);
      } else {
        setAthletes((prev) => (reset ? data.results : [...prev, ...data.results]));
        setNextAthletesUrl(data.next);
      }
    } catch (e) {
      console.error("Failed to load athletes", e);
    } finally {
      setIsLoadingAthletes(false);
    }
  };

  // Fetch tournaments for registration
  const fetchTournaments = async () => {
    setHasLoadedTournaments(false);
    try {
      const { data } = await api.get<PaginatedResponse<Tournament> | Tournament[]>("/tournaments/?page_size=1000");
      const list = Array.isArray(data) ? data : data.results;
      // Filter only active registration tournaments (considering registration period dates)
      const now = new Date();
      setTournaments(list.filter((t: Tournament) => {
        if (t.status !== "registration") return false;
        if (t.registration_start && now < new Date(t.registration_start)) return false;
        if (t.registration_end && now > new Date(t.registration_end)) return false;
        return true;
      }));
    } catch (e) {
      console.error(e);
    } finally {
      setHasLoadedTournaments(true);
    }
  };

  // Fetch categories when tournament is selected
  const fetchCategories = async (tid: string) => {
    try {
      const { data } = await api.get<Category[] | PaginatedResponse<Category>>(`/categories/?tournament=${tid}`);
      const list = Array.isArray(data) ? data : data.results;
      setTournamentCategories(list || []);
      setSelectedCategoryId("");
    } catch (e) {
      console.error(e);
    }
  };

  // Fetch unpaid registrations for billing tab
  const fetchBilling = async () => {
    setIsLoadingBilling(true);
    try {
      let url = "/registrations/?page_size=1000";
      if (billingClubScope === "club") {
        url += "&club_scope=true";
      }
      const { data } = await api.get<PaginatedResponse<Registration> | Registration[]>(url);
      const list = Array.isArray(data) ? data : data.results;
      // Filter unpaid coach registrations (exclude completed tournaments and withdrawn entries)
      setUnpaidRegistrations(list.filter((r: Registration) => r.payment_status === "unpaid" && r.status !== "withdrawn" && r.tournament_status !== "completed"));
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoadingBilling(false);
    }
  };

  // Fetch billing transactions
  const fetchTransactions = async () => {
    setIsLoadingTransactions(true);
    try {
      const { data } = await api.get<any>("/billing/transactions/?page_size=1000");
      const list = Array.isArray(data) ? data : data.results || [];
      setTransactions(list);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoadingTransactions(false);
    }
  };

  const fetchInvoices = async () => {
    setIsLoadingInvoices(true);
    try {
      const { data } = await api.get<any>("/billing/invoices/?page_size=1000");
      const list = Array.isArray(data) ? data : data.results || [];
      setInvoices(list);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoadingInvoices(false);
    }
  };

  const handleSyncInvoice = async (invoiceId: number) => {
    setIsSyncingInvoiceId(invoiceId);
    try {
      const { data } = await api.post(`/billing/invoices/${invoiceId}/sync/`);
      toast({
        title: "Синхронізація успішна",
        description: data.detail || "Статус рахунку успішно оновлено.",
      });
      fetchInvoices();
      fetchTransactions();
      fetchBilling();
      fetchActiveRegistrations();
    } catch (e: any) {
      toast({
        title: "Помилка синхронізації",
        description: e.response?.data?.detail || "Не вдалося синхронізувати статус рахунку.",
        variant: "destructive",
      });
    } finally {
      setIsSyncingInvoiceId(null);
    }
  };

  // Fetch all registrations for active registrations tab
  const fetchActiveRegistrations = async () => {
    setIsLoadingActiveRegs(true);
    try {
      let url = "/registrations/?page_size=1000";
      if (activeTab === "billing" && billingClubScope === "club") {
        url += "&club_scope=true";
      }
      const { data } = await api.get<PaginatedResponse<Registration> | Registration[]>(url);
      const list = Array.isArray(data) ? data : data.results;
      setAllRegistrations(list);
      // Filter out registrations belonging to completed tournaments
      setActiveRegistrations(list.filter((r: Registration) => r.tournament_status !== "completed"));
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoadingActiveRegs(false);
    }
  };


  // Fetch matches involving the coach's athletes/club for live monitor
  const fetchLiveMatches = async () => {
    try {
      const { data } = await api.get<any[] | PaginatedResponse<any>>("/matches/");
      const list = Array.isArray(data) ? data : data.results || [];
      if (user?.club?.id) {
        const clubId = user.club.id;
        const filtered = list.filter((m: any) => {
          // Exclude sub-bouts from the main scoreboard list to avoid duplicate cards
          if (m.parent_team_match !== null) return false;

          const isOngoingOrScheduled = m.status === "ongoing" || m.status === "scheduled";
          if (!isOngoingOrScheduled) return false;

          const reg1ClubId = m.reg_first?.athlete?.club?.id || m.reg_first?.team?.club?.id || m.athlete_first?.club?.id;
          const reg2ClubId = m.reg_second?.athlete?.club?.id || m.reg_second?.team?.club?.id || m.athlete_second?.club?.id;

          return reg1ClubId === clubId || reg2ClubId === clubId;
        });
        setLiveMatches(filtered);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleMatchUpdate = (updatedMatch: any) => {
    setLiveMatches((prev) => {
      // 1. If it is a sub-bout update
      if (updatedMatch.parent_team_match) {
        return prev.map((m) => {
          if (m.id === updatedMatch.parent_team_match) {
            const updatedBouts = m.team_bouts
              ? m.team_bouts.map((bout: any) => bout.id === updatedMatch.id ? { ...bout, ...updatedMatch } : bout)
              : [updatedMatch];
            return {
              ...m,
              team_bouts: updatedBouts
            };
          }
          return m;
        });
      }

      // 2. If it is a parent match update
      return prev.map((m) => {
        if (m.id === updatedMatch.id) {
          return {
            ...m,
            ...updatedMatch,
            team_bouts: updatedMatch.team_bouts && updatedMatch.team_bouts.length > 0
              ? updatedMatch.team_bouts
              : m.team_bouts
          };
        }
        return m;
      });
    });
  };


  useEffect(() => {
    if (activeTab === "roster") fetchRoster(true);
  }, [activeTab, rosterSearch, rosterSort]);

  useEffect(() => {
    if (activeTab === "register") {
      fetchTournaments();
      fetchRoster(true);
      fetchActiveRegistrations();
    }
    if (activeTab === "billing") {
      fetchActiveRegistrations();
      if (billingSubTab === "unpaid") {
        fetchBilling();
      } else {
        fetchTransactions();
        fetchInvoices();
      }
    }
    if (activeTab === "active") fetchActiveRegistrations();
    if (activeTab === "live") {
      fetchLiveMatches();
      const interval = setInterval(fetchLiveMatches, 10000);
      return () => clearInterval(interval);
    }
  }, [activeTab, billingClubScope, billingSubTab]);

  useEffect(() => {
    if (activeTab === "register") {
      fetchRoster(true);
    }
  }, [regSubTab, regSearch, teamSearch]);

  useEffect(() => {
    if (selectedAthleteRegs) {
      fetchActiveRegistrations();
    }
  }, [selectedAthleteRegs]);

  useEffect(() => {
    if (activeTab === "register" && selectedTournamentId) {
      fetchCategories(selectedTournamentId);
    }
  }, [activeTab, selectedTournamentId]);

  useEffect(() => {
    if (hasLoadedTournaments && selectedTournamentId) {
      const exists = tournaments.some((t) => t.id.toString() === selectedTournamentId);
      if (!exists) {
        handleSelectedTournamentIdChange("");
      }
    }
  }, [hasLoadedTournaments, tournaments, selectedTournamentId]);

  const selectedTournament = tournaments.find((t) => t.id === Number(selectedTournamentId));
  const selectedCategory = tournamentCategories.find((c) => c.id === Number(selectedCategoryId));



  // Submit registrations handler
  const handleRegisterAthletes = async () => {
    if (!selectedTournamentId || !liabilityWaiver) return;

    setIsSubmittingReg(true);
    try {
      if (regSubTab === "team") {
        const requiredTeamSize = selectedCategory?.team_size || 3;
        if (!teamRegName.trim() || teamRegAthleteIds.length !== requiredTeamSize) {
          toast({
            title: `Введіть назву команди та оберіть рівно ${requiredTeamSize} спортсменів`,
            variant: "destructive",
          });
          setIsSubmittingReg(false);
          return;
        }

        // 1. Create team on-the-fly
        const teamPayload: any = {
          name: teamRegName.trim(),
          athlete_ids: teamRegAthleteIds,
        };
        if (user?.club?.id) {
          teamPayload.club_id = user.club.id;
        }

        const teamRes = await api.post<Team>("/teams/", teamPayload);

        // 2. Register team for category
        await api.post("/registrations/", {
          category: Number(selectedCategoryId),
          team_id: teamRes.data.id,
        });

        toast({ title: `Команду "${teamRes.data.name}" успішно зареєстровано!` });
        setSelectedCategoryId("");
        setTeamRegAthletes([]);
      } else {
        // Mass registration
        const registerList: { athleteId: number; categoryId: number }[] = [];
        Object.entries(massSelectedCategories).forEach(([athId, catIds]) => {
          catIds.forEach((catId) => {
            registerList.push({ athleteId: Number(athId), categoryId: catId });
          });
        });

        if (registerList.length === 0) {
          toast({ title: "Будь ласка, оберіть хоча б одну категорію для спортсмена", variant: "destructive" });
          setIsSubmittingReg(false);
          return;
        }

        await Promise.all(
          registerList.map((entry) =>
            api.post("/registrations/", {
              category: entry.categoryId,
              athlete_id: entry.athleteId,
            })
          )
        );
        toast({ title: `Успішно зареєстровано ${registerList.length} заявок!` });
        setMassSelectedCategories({});
      }
      setLiabilityWaiver(false);
      fetchBilling();
      fetchActiveRegistrations();
    } catch (e) {
      // handled by interceptor
    } finally {
      setIsSubmittingReg(false);
    }
  };

  const handleAutofillCategories = () => {
    if (!selectedTournament) return;
    const newMassSelected: Record<number, number[]> = {};
    athletes.forEach((ath) => {
      const athleteAge = getAgeAsOf(ath.birth_date, selectedTournament.start_date);
      const eligibleCats = tournamentCategories.filter((c) => {
        if (c.is_team) return false;
        const genderMatches = c.allowed_gender === "mixed" ||
          (c.allowed_gender === "male" && ath.gender === "male") ||
          (c.allowed_gender === "female" && ath.gender === "female");
        const ageMatches = athleteAge >= c.min_age && athleteAge <= c.max_age;
        const weightMatches = (!c.min_weight || ath.base_weight >= c.min_weight) &&
          (!c.max_weight || ath.base_weight <= c.max_weight);

        const isRegistered = activeRegistrations.some(
          (r) => r.athlete?.id === ath.id && r.category === c.id
        );
        return genderMatches && ageMatches && weightMatches && !isRegistered;
      });
      if (eligibleCats.length > 0) {
        newMassSelected[ath.id] = eligibleCats.map(c => c.id);
      }
    });
    setMassSelectedCategories(newMassSelected);
    setShowAutofillWarning(false);
    toast({ title: "Категорії автоматично підібрано!" });
  };

  // Monobank acquiring checkout flow
  const handleSimulatePayment = async () => {
    if (!showPayModal) return;
    setIsPayingInvoice(true);
    try {
      const regIds = showPayModal.registrationIds;
      const redirectUrl = window.location.origin + "/coach/dashboard?tab=billing";

      const { data } = await api.post("/billing/invoices/", {
        payment_type: "registrations",
        registration_ids: regIds,
        redirect_url: redirectUrl,
      });

      toast({ title: "Платіж ініційовано!", description: `Перенаправлення на платіжну систему Monobank...` });
      setShowPayModal(null);

      let paymentUrl = data.payment_url;
      if (paymentUrl && paymentUrl.includes("/billing/mock-pay")) {
        const urlObj = new URL(paymentUrl);
        paymentUrl = `/billing/mock-pay${urlObj.search}`;
      }
      window.location.href = paymentUrl;
    } catch (e: any) {
      toast({
        title: "Помилка оплати",
        description: e.response?.data?.detail || "Не вдалося ініціювати платіж.",
        variant: "destructive"
      });
    } finally {
      setIsPayingInvoice(false);
    }
  };

  // Cancel registration
  const handleWithdrawRegistration = async (regId: number, otherRegsIds: number[] = []) => {
    setWithdrawingRegId(regId);
    try {
      const idsToWithdraw = [regId, ...otherRegsIds];

      await api.post("/registrations/bulk_withdraw/", {
        registration_ids: idsToWithdraw
      });

      toast({ title: idsToWithdraw.length > 1 ? "Заявки відкликано!" : "Заявку відкликано!" });
      fetchActiveRegistrations();
      if (typeof fetchBilling === "function") {
        fetchBilling();
      }
    } catch (e: any) {
      console.error(e);
      toast({
        title: "Помилка при скасуванні",
        description: e.response?.data?.detail || "Не вдалося скасувати деякі заявки.",
        variant: "destructive",
      });
    } finally {
      setWithdrawingRegId(null);
    }
  };

  const handleConfirmOfflineRefundReceived = async (regId: number) => {
    setConfirmingRefundId(regId);
    try {
      await api.post("/registrations/bulk_confirm_offline_refund_received/", {
        registration_ids: [regId],
      });
      toast({ title: "Отримання коштів підтверджено успішно!" });
      fetchActiveRegistrations();
    } catch (e: any) {
      console.error(e);
      toast({
        title: "Помилка підтвердження",
        description: e.response?.data?.detail || "Не вдалося підтвердити отримання коштів.",
        variant: "destructive"
      });
    } finally {
      setConfirmingRefundId(null);
    }
  };

  const billingTournamentsList = useMemo(() => {
    const map = new Map<number, string>();
    unpaidRegistrations.forEach((reg) => {
      const tid = reg.tournament_id;
      if (tid) {
        map.set(tid, reg.tournament_title || `Турнір #${tid}`);
      }
    });
    return Array.from(map.entries()).map(([id, title]) => ({ id, title }));
  }, [unpaidRegistrations]);

  const activeTournamentsList = useMemo(() => {
    const map = new Map<number, string>();
    activeRegistrations.forEach((reg) => {
      const tid = reg.tournament_id;
      if (tid) {
        map.set(tid, reg.tournament_title || `Турнір #${tid}`);
      }
    });
    return Array.from(map.entries()).map(([id, title]) => ({ id, title }));
  }, [activeRegistrations]);

  const billingTournamentOptions = useMemo(() => [
    { value: "all", label: "Всі турніри" },
    ...billingTournamentsList.map((t) => ({ value: String(t.id), label: t.title }))
  ], [billingTournamentsList]);

  const activeTournamentOptions = useMemo(() => [
    { value: "all", label: "Всі турніри" },
    ...activeTournamentsList.map((t) => ({ value: String(t.id), label: t.title }))
  ], [activeTournamentsList]);

  const getInvoiceTournamentId = (inv: any) => {
    if (inv.tournament) return inv.tournament;
    if (inv.registrations && inv.registrations.length > 0) {
      const regId = inv.registrations[0];
      const matchedReg = allRegistrations.find(r => r.id === regId);
      if (matchedReg) {
        return matchedReg.tournament_id;
      }
    }
    return null;
  };

  const historyTournamentsList = useMemo(() => {
    const map = new Map<number, string>();
    allRegistrations.forEach((reg) => {
      const tid = reg.tournament_id;
      if (tid) {
        map.set(tid, reg.tournament_title || `Турнір #${tid}`);
      }
    });
    // also check invoices
    invoices.forEach((inv) => {
      const tid = getInvoiceTournamentId(inv);
      if (tid && !map.has(tid)) {
        const foundTourn = tournaments.find(t => t.id === tid);
        map.set(tid, foundTourn ? foundTourn.title : `Турнір #${tid}`);
      }
    });
    return Array.from(map.entries()).map(([id, title]) => ({ id, title }));
  }, [allRegistrations, invoices, tournaments]);

  const historyTournamentOptions = useMemo(() => [
    { value: "all", label: "Всі турніри" },
    ...historyTournamentsList.map((t) => ({ value: String(t.id), label: t.title }))
  ], [historyTournamentsList]);

  const filteredActiveRegistrations = useMemo(() => {
    let result = [...activeRegistrations];

    // 1. Tournament filter
    if (activeTournamentFilter !== "all") {
      result = result.filter(r => String(r.tournament_id) === activeTournamentFilter);
    }

    // 2. Search filter
    const query = activeSearch.trim().toLowerCase();
    if (query) {
      result = result.filter(r => {
        const name = formatRegistrationName(r).toLowerCase();
        const category = (r.category_name || "").toLowerCase();
        const tournament = (r.tournament_title || "").toLowerCase();
        return name.includes(query) || category.includes(query) || tournament.includes(query);
      });
    }

    // 3. Sorting
    result.sort((a, b) => {
      if (activeSort === "name_asc") {
        return formatRegistrationName(a).localeCompare(formatRegistrationName(b));
      }
      if (activeSort === "name_desc") {
        return formatRegistrationName(b).localeCompare(formatRegistrationName(a));
      }
      if (activeSort === "tournament") {
        const comp = (a.tournament_title || "").localeCompare(b.tournament_title || "");
        if (comp !== 0) return comp;
        return formatRegistrationName(a).localeCompare(formatRegistrationName(b));
      }
      if (activeSort === "category") {
        const comp = (a.category_name || "").localeCompare(b.category_name || "");
        if (comp !== 0) return comp;
        return formatRegistrationName(a).localeCompare(formatRegistrationName(b));
      }
      if (activeSort === "payment") {
        const payA = a.payment_status === "paid" ? 1 : 0;
        const payB = b.payment_status === "paid" ? 1 : 0;
        if (payA !== payB) return payA - payB; // unpaid first
        return formatRegistrationName(a).localeCompare(formatRegistrationName(b));
      }
      if (activeSort === "weigh_in") {
        const weighA = a.status === "confirmed" ? 1 : 0;
        const weighB = b.status === "confirmed" ? 1 : 0;
        if (weighA !== weighB) return weighA - weighB; // pending first
        return formatRegistrationName(a).localeCompare(formatRegistrationName(b));
      }
      return 0;
    });

    return result;
  }, [activeRegistrations, activeTournamentFilter, activeSearch, activeSort]);

  const athleteRegs = useMemo(() => {
    if (!selectedAthleteRegs) return [];
    return activeRegistrations.filter(r => {
      if (r.athlete && r.athlete.id === selectedAthleteRegs.id) {
        return true;
      }
      if (r.team && r.team.athletes && r.team.athletes.some(member => member.id === selectedAthleteRegs.id)) {
        return true;
      }
      return false;
    });
  }, [selectedAthleteRegs, activeRegistrations]);

  const groupedBilling = useMemo(() => {
    const groups: Record<number, {
      tournamentTitle: string;
      onlinePaymentEnabled: boolean;
      paymentDetails: string;
      registrations: Registration[];
    }> = {};
    unpaidRegistrations.forEach((reg) => {
      const tid = reg.tournament_id || 0;
      if (billingTournamentFilter !== "all" && String(tid) !== billingTournamentFilter) {
        return;
      }
      if (!groups[tid]) {
        groups[tid] = {
          tournamentTitle: reg.tournament_title || `Турнір #${tid}`,
          onlinePaymentEnabled: reg.online_payment_enabled ?? true,
          paymentDetails: reg.payment_details || "",
          registrations: [],
        };
      }
      groups[tid].registrations.push(reg);
    });
    return groups;
  }, [unpaidRegistrations, billingTournamentFilter]);

  const getSubtotalFor = (regs: Registration[]) => {
    return regs.reduce((sum, reg) => sum + (reg.fee || 500), 0);
  };
  const getServiceFeeFor = (regs: Registration[]) => {
    return regs.reduce((sum, reg) => {
      if (reg.commission_payer === "buyer") {
        return sum + (reg.fee || 500) * 0.05;
      }
      return sum;
    }, 0);
  };
  const getGrandTotalFor = (regs: Registration[]) => {
    return getSubtotalFor(regs) + getServiceFeeFor(regs);
  };

  const filteredHistoryRegs = useMemo(() => {
    if (historyTournamentFilter === "all") {
      return allRegistrations;
    }
    return allRegistrations.filter(r => String(r.tournament_id) === historyTournamentFilter);
  }, [allRegistrations, historyTournamentFilter]);

  const filteredHistoryInvoices = useMemo(() => {
    if (historyTournamentFilter === "all") {
      return invoices;
    }
    return invoices.filter(inv => {
      const tid = getInvoiceTournamentId(inv);
      return tid && String(tid) === historyTournamentFilter;
    });
  }, [invoices, historyTournamentFilter, allRegistrations]);

  const filteredHistoryTransactions = useMemo(() => {
    const invoiceMap = new Map(invoices.map(inv => [inv.id, inv]));
    if (historyTournamentFilter === "all") {
      return transactions;
    }
    return transactions.filter(tx => {
      const inv = invoiceMap.get(tx.invoice);
      if (!inv) return false;
      const tid = getInvoiceTournamentId(inv);
      return tid && String(tid) === historyTournamentFilter;
    });
  }, [transactions, invoices, historyTournamentFilter, allRegistrations]);

  const getRegFeesBreakdown = (reg: Registration) => {
    if (reg.status === "withdrawn" && reg.payment_status !== "paid") {
      return { onlinePaid: 0, offlinePaid: 0, unpaid: 0, total: 0 };
    }
    const baseFee = reg.fee || 500;
    const finalFee = baseFee * (reg.commission_payer === "buyer" ? 1.05 : 1.0);
    const isPaid = reg.payment_status === "paid";
    const isOnline = reg.payment_method === "online";
    return {
      onlinePaid: isPaid && isOnline ? finalFee : 0,
      offlinePaid: isPaid && !isOnline ? baseFee : 0,
      unpaid: !isPaid ? finalFee : 0,
      total: isPaid ? (isOnline ? finalFee : baseFee) : 0
    };
  };

  const historyAthleteGroups = useMemo(() => {
    const groups: Record<string, {
      athleteName: string;
      registrations: Registration[];
      onlinePaid: number;
      offlinePaid: number;
      unpaid: number;
      total: number;
    }> = {};

    filteredHistoryRegs.forEach((reg) => {
      const key = reg.athlete
        ? `athlete-${reg.athlete.id}`
        : (reg.team ? `team-${reg.team.id}` : `reg-${reg.id}`);

      if (!groups[key]) {
        groups[key] = {
          athleteName: formatRegistrationName(reg),
          registrations: [],
          onlinePaid: 0,
          offlinePaid: 0,
          unpaid: 0,
          total: 0,
        };
      }
      groups[key].registrations.push(reg);

      const breakdown = getRegFeesBreakdown(reg);
      groups[key].onlinePaid += breakdown.onlinePaid;
      groups[key].offlinePaid += breakdown.offlinePaid;
      groups[key].unpaid += breakdown.unpaid;
      groups[key].total += breakdown.total;
    });

    return Object.values(groups);
  }, [filteredHistoryRegs]);

  const historyCategoryGroups = useMemo(() => {
    const groups: Record<string, {
      categoryName: string;
      regCount: number;
      onlinePaid: number;
      offlinePaid: number;
      unpaid: number;
      total: number;
    }> = {};

    filteredHistoryRegs.forEach((reg) => {
      const key = reg.category_name || "Інші";
      if (!groups[key]) {
        groups[key] = {
          categoryName: key,
          regCount: 0,
          onlinePaid: 0,
          offlinePaid: 0,
          unpaid: 0,
          total: 0,
        };
      }
      groups[key].regCount += 1;

      const breakdown = getRegFeesBreakdown(reg);
      groups[key].onlinePaid += breakdown.onlinePaid;
      groups[key].offlinePaid += breakdown.offlinePaid;
      groups[key].unpaid += breakdown.unpaid;
      groups[key].total += breakdown.total;
    });

    return Object.values(groups);
  }, [filteredHistoryRegs]);

  // Club Leaderboard calculations
  const getLeaderboard = () => {
    const scores: Record<string, { athlete: Athlete; points: number; medals: { gold: number; silver: number; bronze: number } }> = {};
    activeRegistrations.forEach((r) => {
      if (!r.athlete) return;
      const key = `${r.athlete.last_name} ${r.athlete.first_name}`;
      if (!scores[key]) {
        scores[key] = { athlete: r.athlete, points: 0, medals: { gold: 0, silver: 0, bronze: 0 } };
      }
      if (r.place === 1) {
        scores[key].points += 3;
        scores[key].medals.gold += 1;
      } else if (r.place === 2) {
        scores[key].points += 2;
        scores[key].medals.silver += 1;
      } else if (r.place === 3) {
        scores[key].points += 1;
        scores[key].medals.bronze += 1;
      }
    });

    return Object.values(scores).sort((a, b) => b.points - a.points);
  };

  return (
    <div className="container py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border/30 pb-6">
        <div>
          <h1 className="font-display text-4xl font-bold tracking-tight">Панель тренера</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Тренер: <strong className="text-amber-500">{user?.last_name} {user?.first_name} {user?.patronymic || ""}</strong>
          </p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Клуб: <span className="font-semibold text-foreground/80">{user?.club?.name || "Без клубу"}</span> ({UKRAINIAN_REGIONS.find(r => r.value === user?.club?.region)?.label || user?.club?.region})
          </p>
        </div>

        {/* Dashboard Navigation Tabs */}
        <div className="flex flex-wrap gap-2 bg-muted/30 p-1 rounded-xl border border-border/20">
          <Button variant={activeTab === "roster" ? "sport" : "ghost"} size="sm" onClick={() => handleActiveTabChange("roster")}>
            <Users className="w-4 h-4 mr-1.5" /> Реєстр клубу
          </Button>
          <Button variant={activeTab === "register" ? "sport" : "ghost"} size="sm" onClick={() => handleActiveTabChange("register")}>
            <Plus className="w-4 h-4 mr-1.5" /> Реєстрація на турнір
          </Button>
          <Button variant={activeTab === "billing" ? "sport" : "ghost"} size="sm" onClick={() => handleActiveTabChange("billing")}>
            <CreditCard className="w-4 h-4 mr-1.5" /> Рахунки та оплата
          </Button>
          <Button variant={activeTab === "active" ? "sport" : "ghost"} size="sm" onClick={() => handleActiveTabChange("active")}>
            <FileText className="w-4 h-4 mr-1.5" /> Активні заявки
          </Button>
          <Button variant={activeTab === "leaderboard" ? "sport" : "ghost"} size="sm" onClick={() => handleActiveTabChange("leaderboard")}>
            <Trophy className="w-4 h-4 mr-1.5" /> Рейтинг заліку
          </Button>
          <Button variant={activeTab === "live" ? "sport" : "ghost"} size="sm" onClick={() => handleActiveTabChange("live")}>
            <Activity className="w-4 h-4 mr-1.5" /> Live Scoreboard
          </Button>
        </div>
      </div>

      {/* ────────────────── ТАБ: РЕЄСТР КЛУБУ ────────────────── */}
      {activeTab === "roster" && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/20 pb-4">
            <div className="flex items-center gap-4">
              <h2 className="text-2xl font-bold tracking-tight">Реєстр спортсменів</h2>
              <p className="text-sm text-muted-foreground">{athletes.length} атлетів</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center bg-muted/40 border border-border/30 rounded-xl p-0.5 shrink-0">
                <Button
                  variant={athleteViewMode === "cards" ? "sport" : "ghost"}
                  size="sm"
                  className="h-8 text-xs px-3 rounded-lg"
                  onClick={() => setAthleteViewMode("cards")}
                >
                  <LayoutGrid className="w-3.5 h-3.5 mr-1.5" /> Картки
                </Button>
                <Button
                  variant={athleteViewMode === "list" ? "sport" : "ghost"}
                  size="sm"
                  className="h-8 text-xs px-3 rounded-lg"
                  onClick={() => setAthleteViewMode("list")}
                >
                  <List className="w-3.5 h-3.5 mr-1.5" /> Список
                </Button>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-9 px-4 rounded-xl text-xs font-semibold flex items-center gap-1.5 border-amber-500/20 text-amber-500 hover:bg-amber-500/10"
                onClick={() => {
                  setImportFile(null);
                  setImportErrors([]);
                  setIsImportDialogOpen(true);
                }}
              >
                <Upload className="w-4 h-4" /> Імпорт з CSV/Excel
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-9 px-4 rounded-xl text-xs font-semibold flex items-center gap-1.5 border-amber-500/20 text-amber-500 hover:bg-amber-500/10"
                onClick={() => printBadges(athletes.map(a => ({ athlete: a })))}
                disabled={athletes.length === 0}
              >
                <Printer className="w-4 h-4" /> Експорт усіх бейджів
              </Button>
              <Button
                variant="sport"
                size="sm"
                className="h-9 px-4 rounded-xl text-xs font-semibold"
                onClick={() => {
                  setEditingAthlete(null);
                  setSelectedFile(null);
                  setSelectedGender("M");
                  resetAthlete({
                    first_name: "",
                    last_name: "",
                    patronymic: "",
                    date_of_birth: "",
                    gender: "M",
                    weight: 60,
                    skill_level: "",
                  });
                  setIsAthleteDialogOpen(true);
                }}
              >
                <Plus className="w-4 h-4 mr-1.5" /> Додати атлета
              </Button>
            </div>
          </div>

          {/* Фільтри та пошук для реєстру */}
          <div className="flex flex-col md:flex-row gap-4 items-center justify-between bg-card/5 border border-border/20 p-4 rounded-2xl">
            <div className="relative w-full md:max-w-xs">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Пошук спортсмена..."
                className="pl-9 h-9 rounded-xl text-xs"
                value={rosterSearch}
                onChange={(e) => handleRosterSearchChange(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2 w-full md:w-auto shrink-0 justify-end">
              <span className="text-xs text-muted-foreground whitespace-nowrap">Сортувати за:</span>
              <Select value={rosterSort} onValueChange={handleRosterSortChange}>
                <SelectTrigger className="w-full md:w-[180px] h-9 rounded-xl text-xs">
                  <SelectValue placeholder="Сортування" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="last_name">Прізвищем (А-Я)</SelectItem>
                  <SelectItem value="-last_name">Прізвищем (Я-А)</SelectItem>
                  <SelectItem value="first_name">Ім'ям (А-Я)</SelectItem>
                  <SelectItem value="-first_name">Ім'ям (Я-А)</SelectItem>
                  <SelectItem value="birth_date">Віком (спочатку старші)</SelectItem>
                  <SelectItem value="-birth_date">Віком (спочатку молодші)</SelectItem>
                  <SelectItem value="-base_weight">Вагою (спочатку важчі)</SelectItem>
                  <SelectItem value="base_weight">Вагою (спочатку легші)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {isLoadingAthletes && athletes.length === 0 ? (
            <div className="flex justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
            </div>
          ) : athletes.length === 0 ? (
            <div className="text-center py-20 border border-dashed border-border rounded-xl">
              <Users className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
              <p className="text-muted-foreground">Реєстр вашого клубу порожній. Натисніть кнопку "Додати атлета", щоб розпочати.</p>
            </div>
          ) : athleteViewMode === "cards" ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {athletes.map((a) => (
                <div key={a.id} className="p-4 border border-border/50 bg-card/15 hover:bg-card/30 rounded-xl flex flex-col justify-between gap-4 transition-all group relative">
                  <div className="flex gap-3 items-start">
                    <div className="w-12 h-12 rounded-full overflow-hidden border border-border bg-muted shrink-0 flex items-center justify-center font-bold text-amber-500 relative">
                      <span>{a.first_name[0]}{a.last_name[0]}</span>
                      {a.photo && (
                        <img
                          src={a.photo}
                          alt=""
                          className="absolute inset-0 w-full h-full object-cover"
                          onError={(e) => {
                            e.currentTarget.style.display = "none";
                          }}
                        />
                      )}
                    </div>
                    <div>
                      <h3 className="font-bold text-base line-clamp-1">{a.last_name} {a.first_name}</h3>
                      {a.patronymic && <span className="text-[10px] text-muted-foreground block">{a.patronymic}</span>}
                      <span className="text-xs text-muted-foreground block mt-1">{a.skill_level || "Без розряду"}</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs py-2 border-t border-b border-border/20">
                    <div>
                      <span className="text-muted-foreground block">Вага:</span>
                      <strong className="font-mono">{a.base_weight} кг</strong>
                    </div>
                    <div>
                      <span className="text-muted-foreground block">Вік:</span>
                      <strong>{a.birth_date ? getAgeAsOf(a.birth_date, new Date().toISOString()) : "—"} років</strong>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <div className="flex gap-1">
                      <Button variant="outline" size="sm" className="flex-1 text-[11px] h-8 px-2" onClick={() => setSelectedAthleteProfile(a)}>
                        <TrendingUp className="w-3.5 h-3.5 mr-1" /> Динаміка ваги
                      </Button>
                      <Button variant="outline" size="sm" className="flex-1 text-[11px] h-8 px-2 hover:text-amber-500 hover:bg-amber-500/10" onClick={() => setSelectedAthleteRegs(a)}>
                        <Layers className="w-3.5 h-3.5 mr-1" /> Заявки
                      </Button>
                    </div>
                    <div className="flex gap-1">
                      <Button variant="outline" size="sm" className="flex-1 h-8 text-[11px]" title="Друк перепустки" onClick={() => printBadge(a)}>
                        <Printer className="w-3.5 h-3.5 mr-1" /> Перепустка
                      </Button>
                      <Button variant="outline" size="sm" className="h-8 px-3 text-xs hover:text-amber-500 hover:bg-amber-500/10" title="Редагувати" onClick={() => startEditAthlete(a)}>
                        <Edit2 className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="outline" size="sm" className="h-8 px-3 text-xs hover:text-destructive hover:bg-destructive/10" title="Вилучити" onClick={() => setAthleteToDelete(a)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-border overflow-hidden bg-card/10">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">Фото</TableHead>
                    <TableHead>Прізвище, Ім'я</TableHead>
                    <TableHead>По батькові</TableHead>
                    <TableHead>Стать</TableHead>
                    <TableHead className="text-right">Вага</TableHead>
                    <TableHead className="text-right">Вік</TableHead>
                    <TableHead>Рівень / Пояс</TableHead>
                    <TableHead className="w-48 text-right">Дії</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {athletes.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>
                        <div className="w-8 h-8 rounded-full overflow-hidden border border-border bg-muted flex items-center justify-center font-bold text-amber-500 text-xs shrink-0 relative">
                          <span>{a.first_name[0]}{a.last_name[0]}</span>
                          {a.photo && (
                            <img
                              src={a.photo}
                              alt=""
                              className="absolute inset-0 w-full h-full object-cover"
                              onError={(e) => {
                                e.currentTarget.style.display = "none";
                              }}
                            />
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="font-semibold">{a.last_name} {a.first_name}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{a.patronymic || "—"}</TableCell>
                      <TableCell className="text-sm">{a.gender === "male" ? "Чоловік" : "Жінка"}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{a.base_weight} кг</TableCell>
                      <TableCell className="text-right text-sm">{a.birth_date ? getAgeAsOf(a.birth_date, new Date().toISOString()) : "—"} р.</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{a.skill_level || "—"}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button variant="ghost" size="icon" className="w-8 h-8 hover:text-amber-500" title="Динаміка ваги" onClick={() => { setSelectedAthleteProfile(a); fetchWeightHistory(a.id); }}>
                            <TrendingUp className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="w-8 h-8 hover:text-amber-500" title="Заявки" onClick={() => setSelectedAthleteRegs(a)}>
                            <Layers className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="w-8 h-8" title="Друк перепустки" onClick={() => printBadge(a)}>
                            <Printer className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="w-8 h-8 hover:text-amber-500" title="Редагувати" onClick={() => startEditAthlete(a)}>
                            <Edit2 className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="w-8 h-8 hover:text-destructive" title="Вилучити" onClick={() => setAthleteToDelete(a)}>
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Load More Button */}
          {nextAthletesUrl && (
            <div className="flex justify-center pt-6">
              <Button variant="outline" onClick={() => fetchRoster(false)} disabled={isLoadingAthletes}>
                {isLoadingAthletes && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                Завантажити ще
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Діалог перегляду графіка ваги */}
      <Dialog open={!!selectedAthleteProfile} onOpenChange={() => setSelectedAthleteProfile(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Динаміка ваги спортсмена</DialogTitle>
          </DialogHeader>
          {selectedAthleteProfile && (
            <div className="space-y-6 py-4">
              <div>
                <h3 className="font-bold text-lg">{selectedAthleteProfile.last_name} {selectedAthleteProfile.first_name}</h3>
                <p className="text-xs text-muted-foreground">Спортивний розряд: {selectedAthleteProfile.skill_level || "Немає"}</p>
              </div>

              {/* Weight Sparkline Chart */}
              <div className="p-4 border border-border rounded-xl bg-muted/10 space-y-3">
                <Label className="text-xs font-semibold text-muted-foreground">Історія контрольних зважувань</Label>
                {isLoadingWeightHistory ? (
                  <div className="flex justify-center py-6">
                    <Loader2 className="w-6 h-6 animate-spin text-amber-500" />
                  </div>
                ) : weightHistory.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-6">Історія зважувань порожня.</p>
                ) : (
                  <div className="space-y-4">
                    {/* Sparkline Graph */}
                    <div className="flex items-end gap-2 h-24 border-b border-border/30 pb-1 pt-6">
                      {weightHistory.map((h, i) => {
                        const minW = Math.min(...weightHistory.map((x) => x.weight));
                        const maxW = Math.max(...weightHistory.map((x) => x.weight));
                        const range = maxW - minW || 1;
                        const pct = ((h.weight - minW) / range) * 50 + 20; // Scale height from 20% to 70%
                        return (
                          <div key={i} className="flex-1 flex flex-col items-center gap-1 group relative">
                            <div
                              className="w-full bg-amber-500 hover:bg-amber-400 rounded-t transition-all cursor-pointer"
                              style={{ height: `${pct}px` }}
                            />
                            <span className="text-[10px] text-muted-foreground mt-1">{h.date}</span>
                            <div className="absolute -top-7 bg-popover text-popover-foreground text-[10px] px-1.5 py-0.5 rounded border border-border shadow-md pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-50">
                              {h.weight.toFixed(1)} кг {h.notes ? `(${h.notes})` : ""}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Values list */}
                    <div className="grid gap-2 text-center text-xs font-semibold text-muted-foreground" style={{ gridTemplateColumns: `repeat(${weightHistory.length}, minmax(0, 1fr))` }}>
                      {weightHistory.map((h, i) => (
                        <div key={i} title={h.notes}>
                          <span className="block text-[10px] text-muted-foreground/60">{h.date}</span>
                          <span className="text-foreground">{h.weight.toFixed(1)} кг</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Add manual weight entry */}
              <div className="p-4 border border-border rounded-xl space-y-3">
                <Label className="text-xs font-semibold text-muted-foreground">Додати новий замір ваги</Label>
                <div className="grid grid-cols-3 gap-2">
                  <Input
                    type="number"
                    step="0.1"
                    placeholder="Вага (кг)"
                    value={newLogWeight}
                    onChange={(e) => setNewLogWeight(e.target.value)}
                    className="col-span-1"
                  />
                  <Input
                    type="text"
                    placeholder="Примітка (напр. До тренування)"
                    value={newLogNotes}
                    onChange={(e) => setNewLogNotes(e.target.value)}
                    className="col-span-2"
                  />
                </div>
                <Button
                  onClick={handleAddWeightLog}
                  disabled={isSavingWeightLog || !newLogWeight}
                  className="w-full h-8 text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-foreground"
                >
                  {isSavingWeightLog ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
                  Зафіксувати вагу
                </Button>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedAthleteProfile(null)}>Закрити</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      {/* ────────────────── ТАБ: РЕЄСТРАЦІЯ НА ТУРНІР ────────────────── */}
      {activeTab === "register" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Form Side */}
          <div className="lg:col-span-2 space-y-6 bg-card/10 p-6 border border-border/30 rounded-2xl">
            <h2 className="text-2xl font-bold tracking-tight">Заявка на участь</h2>

            <div className="space-y-4">
              {/* Select Tournament */}
              <div className="space-y-1.5 relative">
                <Label>Оберіть турнір</Label>

                {/* Backdrop to close dropdown */}
                {isTournamentDropdownOpen && (
                  <div
                    className="fixed inset-0 z-40 bg-transparent cursor-default"
                    role="button"
                    tabIndex={-1}
                    onClick={() => setIsTournamentDropdownOpen(false)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape" || e.key === "Enter" || e.key === " ") {
                        setIsTournamentDropdownOpen(false);
                      }
                    }}
                  />
                )}

                {/* Custom Trigger */}
                <div className="relative z-50">
                  <button
                    type="button"
                    onClick={() => setIsTournamentDropdownOpen(!isTournamentDropdownOpen)}
                    className="flex h-10 w-full items-center justify-between rounded-xl border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 text-left border-border/60 hover:bg-muted/30 transition-colors"
                  >
                    <span className="truncate">
                      {selectedTournament
                        ? `${selectedTournament.title} (${formatSportType(selectedTournament.sport_type)})`
                        : "Оберіть турнір для реєстрації..."}
                    </span>
                    <span className="text-muted-foreground opacity-50 ml-2 text-[10px]">▼</span>
                  </button>

                  {/* Dropdown Content */}
                  {isTournamentDropdownOpen && (
                    <div className="absolute left-0 mt-1.5 w-full z-50 rounded-xl border border-border bg-popover text-popover-foreground shadow-xl animate-in fade-in-0 zoom-in-95 duration-100 p-2 space-y-2 max-h-72 flex flex-col">
                      {/* Search Input */}
                      <div className="relative flex items-center shrink-0">
                        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground/60" />
                        <Input
                          type="text"
                          placeholder="Пошук турніру за назвою чи видом спорту..."
                          className="pl-9 h-9 text-xs rounded-lg bg-background/50"
                          value={tournamentSearch}
                          onChange={(e) => setTournamentSearch(e.target.value)}
                          autoFocus
                        />
                      </div>

                      {/* Scrollable list */}
                      <div className="overflow-y-auto flex-1 divide-y divide-border/20 max-h-48 custom-scrollbar pr-1">
                        {filteredTournamentsForSelect.length === 0 ? (
                          <div className="text-xs text-muted-foreground py-4 text-center">
                            Нічого не знайдено
                          </div>
                        ) : (
                          filteredTournamentsForSelect.map((t) => {
                            const isSelected = t.id.toString() === selectedTournamentId;
                            return (
                              <button
                                key={t.id}
                                type="button"
                                onClick={() => {
                                  handleSelectedTournamentIdChange(t.id.toString());
                                  setTeamCategorySearch("");
                                  setIsTournamentDropdownOpen(false);
                                  setTournamentSearch("");
                                }}
                                className={cn(
                                  "w-full text-left px-3 py-2 text-xs rounded-lg transition-colors flex flex-col gap-0.5",
                                  isSelected
                                    ? "bg-accent text-accent-foreground font-semibold"
                                    : "hover:bg-muted/50 text-foreground/80"
                                )}
                              >
                                <span className="font-medium line-clamp-1">{t.title}</span>
                                <span className="text-[10px] text-muted-foreground">
                                  {formatSportType(t.sport_type)} • Реєстрація до {t.registration_end ? new Date(t.registration_end).toLocaleDateString("uk-UA") : "—"}
                                </span>
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Select Category */}
              {selectedTournamentId && (
                <>
                  <div className="flex gap-2 border-b border-border/20 pb-3 mt-4">
                    <Button
                      variant={regSubTab === "mass" ? "sport" : "outline"}
                      size="sm"
                      onClick={() => handleRegSubTabChange("mass")}
                      className="rounded-xl text-xs h-8"
                    >
                      <Users className="w-3.5 h-3.5 mr-1" /> Масова реєстрація
                    </Button>
                    <Button
                      variant={regSubTab === "team" ? "sport" : "outline"}
                      size="sm"
                      onClick={() => handleRegSubTabChange("team")}
                      className="rounded-xl text-xs h-8"
                    >
                      <Trophy className="w-3.5 h-3.5 mr-1" /> Реєстрація команд
                    </Button>
                  </div>

                  {regSubTab === "mass" ? (
                    <div className="space-y-4 mt-4 animate-in fade-in duration-200">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <Label className="text-sm font-semibold">Оберіть індивідуальні категорії для спортсменів</Label>
                        <div className="flex items-center gap-3 w-full sm:w-auto">
                          <div className="relative w-full sm:max-w-xs">
                            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                              placeholder="Пошук у списку..."
                              className="pl-9 h-9 rounded-xl text-xs"
                              value={regSearch}
                              onChange={(e) => setRegSearch(e.target.value)}
                            />
                          </div>
                          <div className="relative w-full sm:max-w-xs">
                            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                              placeholder="Фільтр категорій..."
                              className="pl-9 h-9 rounded-xl text-xs bg-background/80"
                              value={massCategorySearch}
                              onChange={(e) => setMassCategorySearch(e.target.value)}
                            />
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-9 px-4 rounded-xl text-xs font-semibold border-amber-500/20 text-amber-500 hover:bg-amber-500/10 flex items-center gap-1.5 shrink-0"
                            onClick={() => setShowAutofillWarning(true)}
                          >
                            <Activity className="w-4 h-4" /> Авто-заповнення
                          </Button>
                        </div>
                      </div>


                      <div className="border border-border/40 rounded-xl divide-y divide-border/20 overflow-hidden bg-background/50">
                        <Table>
                          <TableHeader className="bg-muted/30">
                            <TableRow>
                              <TableHead className="w-[180px]">Спортсмен</TableHead>
                              <TableHead className="w-[120px] text-center">Параметри</TableHead>
                              <TableHead>Доступні категорії</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {filteredRegAthletes.map((ath) => {
                              const athleteAge = selectedTournament ? getAgeAsOf(ath.birth_date, selectedTournament.start_date) : 0;
                              const eligibleCats = tournamentCategories.filter((c) => {
                                if (c.is_team) return false;

                                if (massCategorySearch) {
                                  const query = massCategorySearch.toLowerCase();
                                  if (!c.name.toLowerCase().includes(query) && !c.ruleset_key.toLowerCase().includes(query)) {
                                    return false;
                                  }
                                }

                                const genderMatches = c.allowed_gender === "mixed" ||
                                  (c.allowed_gender === "male" && ath.gender === "male") ||
                                  (c.allowed_gender === "female" && ath.gender === "female");
                                const ageMatches = athleteAge >= c.min_age && athleteAge <= c.max_age;
                                const weightMatches = (!c.min_weight || ath.base_weight >= c.min_weight) &&
                                  (!c.max_weight || ath.base_weight <= c.max_weight);
                                return genderMatches && ageMatches && weightMatches;
                              });


                              const selectedForAthlete = massSelectedCategories[ath.id] || [];

                              return (
                                <TableRow key={ath.id}>
                                  <TableCell className="font-bold py-2.5">
                                    {ath.last_name} {ath.first_name}
                                    {ath.patronymic && <span className="text-[10px] text-muted-foreground block font-normal">{ath.patronymic}</span>}
                                  </TableCell>
                                  <TableCell className="text-center py-2.5">
                                    <span className="text-[10px] text-muted-foreground font-mono whitespace-nowrap">
                                      {ath.gender === "male" ? "♂" : "♀"} • {ath.base_weight} кг • {athleteAge} р.
                                    </span>
                                  </TableCell>
                                  <TableCell className="py-2.5">
                                    {eligibleCats.length === 0 ? (
                                      <span className="text-[10px] text-muted-foreground bg-muted border border-border/30 px-2 py-0.5 rounded">
                                        Немає підходящих категорій за віком/вагою
                                      </span>
                                    ) : (
                                      <div className="flex flex-wrap gap-1.5 max-h-[120px] overflow-y-auto pr-1 scrollbar-thin">
                                        {eligibleCats.map((c) => {
                                          const isSelected = selectedForAthlete.includes(c.id);
                                          const isRegistered = activeRegistrations.some(
                                            (r) => r.athlete?.id === ath.id && r.category === c.id
                                          );

                                          return (
                                            <button
                                              key={c.id}
                                              type="button"
                                              disabled={isRegistered}
                                              onClick={() => handleMassCategoryClick(ath.id, c.id, isSelected)}
                                              className={cn(
                                                "text-[10px] font-semibold px-2.5 py-1 rounded-lg border transition-all",
                                                isRegistered
                                                  ? "bg-green-500/10 text-green-500 border-green-500/20 cursor-default opacity-80"
                                                  : isSelected
                                                  ? "bg-amber-500 text-foreground border-amber-500 font-bold"
                                                  : "bg-background hover:bg-muted text-muted-foreground border-border/40"
                                              )}
                                            >
                                              {c.name} ({c.athlete_fee} UAH) {isRegistered ? "✓ (Зареєстровано)" : ""}
                                            </button>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>

                      {nextAthletesUrl && (
                        <div className="flex justify-center pt-4">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => fetchRoster(false)}
                            disabled={isLoadingAthletes}
                            className="text-xs h-8"
                          >
                            {isLoadingAthletes && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />}
                            Показати більше спортсменів
                          </Button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-4 mt-4 animate-in fade-in duration-200">
                      <div className="space-y-3">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <Label className="text-sm font-semibold">Оберіть командну категорію</Label>
                          <div className="relative w-full sm:max-w-xs">
                            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                              placeholder="Пошук командної категорії..."
                              className="pl-9 h-9 rounded-xl text-xs bg-background/80"
                              value={teamCategorySearch}
                              onChange={(e) => setTeamCategorySearch(e.target.value)}
                            />
                          </div>
                        </div>

                        {(() => {
                          const filteredTeamCats = tournamentCategories.filter(c => {
                            if (!c.is_team) return false;
                            if (!teamCategorySearch) return true;
                            return c.name.toLowerCase().includes(teamCategorySearch.toLowerCase());
                          });

                          if (filteredTeamCats.length === 0) {
                            return (
                              <p className="text-xs text-muted-foreground py-4 text-center">Немає командних категорій, які відповідають умовам пошуку.</p>
                            );
                          }

                          return (
                            <div className="flex flex-wrap gap-2 max-h-[180px] overflow-y-auto p-1.5 border border-border/20 rounded-xl bg-background/30 pr-2 scrollbar-thin">
                              {filteredTeamCats.map((c) => {
                                const isSelected = selectedCategoryId === c.id.toString();
                                return (
                                  <button
                                    key={c.id}
                                    type="button"
                                    onClick={() => {
                                      if (isSelected) {
                                        setSelectedCategoryId("");
                                        setTeamRegAthletes([]);
                                      } else {
                                        setSelectedCategoryId(c.id.toString());
                                        setTeamRegAthletes([]);
                                      }
                                    }}
                                    className={cn(
                                      "text-xs font-semibold px-3 py-2 rounded-xl border text-left transition-all duration-200 flex flex-col gap-0.5 w-full sm:w-auto",
                                      isSelected
                                        ? "bg-amber-500 text-foreground border-amber-500 font-bold shadow-md shadow-amber-500/10"
                                        : "bg-background hover:bg-muted text-muted-foreground border-border/40 hover:text-foreground"
                                    )}
                                  >
                                    <span className="font-bold">{c.name}</span>
                                    <span className={cn(
                                      "text-[9px] block font-normal",
                                      isSelected ? "text-foreground/85" : "text-muted-foreground"
                                    )}>
                                      Команда {c.team_size} чол. • {c.athlete_fee} UAH/учасник (всього {c.athlete_fee * c.team_size} UAH)
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          );
                        })()}
                      </div>

                      {selectedCategoryId && selectedCategory && (
                        <div className="space-y-4 p-4 border border-amber-500/20 bg-amber-500/5 rounded-xl">
                          <div className="space-y-1.5">
                            <Label>Назва команди</Label>
                            <Input
                              placeholder="Назва команди"
                              value={teamRegName}
                              onChange={(e) => setTeamRegName(e.target.value)}
                            />
                          </div>

                          <div className="space-y-1.5">
                            <Label className="text-xs font-semibold">
                              Оберіть рівно {selectedCategory.team_size} учасників ({teamRegAthleteIds.length}/{selectedCategory.team_size} обрано) • Вартість: {selectedCategory.athlete_fee} UAH/учасник (всього {selectedCategory.athlete_fee * selectedCategory.team_size} UAH за команду)
                            </Label>

                            {/* Selected athletes summary list */}
                            {teamRegAthletes.length > 0 && (
                              <div className="mb-3 p-3 border border-amber-500/20 bg-amber-500/5 rounded-xl space-y-2">
                                <Label className="text-[11px] font-bold text-amber-500 flex items-center gap-1.5 uppercase tracking-wider">
                                  Обраний склад команди ({teamRegAthletes.length}/{selectedCategory.team_size})
                                </Label>
                                <div className="flex flex-wrap gap-1.5">
                                  {teamRegAthletes.map((ath) => (
                                    <div
                                      key={ath.id}
                                      className="flex items-center gap-1.5 bg-background border border-amber-500/20 text-foreground px-2.5 py-1 rounded-xl text-[10px] font-semibold transition-all duration-150 hover:border-amber-500/40"
                                    >
                                      <span>{ath.last_name} {ath.first_name}</span>
                                      <span className="text-muted-foreground font-mono text-[9px]">({selectedTournament ? getAgeAsOf(ath.birth_date, selectedTournament.start_date) : 0} р.)</span>
                                      <button
                                        type="button"
                                        onClick={() => setTeamRegAthletes((prev) => prev.filter((a) => a.id !== ath.id))}
                                        className="text-amber-500 hover:text-amber-600 font-bold ml-1 text-xs focus:outline-none"
                                      >
                                        ×
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Search input for team athletes */}
                            <div className="relative w-full mb-2">
                              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                              <Input
                                placeholder="Пошук спортсмена для команди..."
                                className="pl-9 h-9 rounded-xl text-xs bg-background/80"
                                value={teamSearch}
                                onChange={(e) => setTeamSearch(e.target.value)}
                              />
                            </div>

                            {(() => {
                              const eligibleTeamAthletes = athletes.filter((ath) => {
                                const athleteAge = selectedTournament ? getAgeAsOf(ath.birth_date, selectedTournament.start_date) : 0;
                                const genderMatches = selectedCategory.allowed_gender === "mixed" ||
                                  (selectedCategory.allowed_gender === "male" && ath.gender === "male") ||
                                  (selectedCategory.allowed_gender === "female" && ath.gender === "female");
                                const ageMatches = athleteAge >= selectedCategory.min_age && athleteAge <= selectedCategory.max_age;

                                // Local search filter
                                const matchesSearch = !teamSearch ||
                                  ath.first_name.toLowerCase().includes(teamSearch.toLowerCase()) ||
                                  ath.last_name.toLowerCase().includes(teamSearch.toLowerCase()) ||
                                  (ath.patronymic && ath.patronymic.toLowerCase().includes(teamSearch.toLowerCase()));

                                return genderMatches && ageMatches && matchesSearch;
                              });

                              if (eligibleTeamAthletes.length === 0) {
                                return (
                                  <p className="text-xs text-muted-foreground py-4 text-center">Немає спортсменів у реєстрі, які відповідають вимогам категорії або умовам пошуку.</p>
                                );
                              }

                              return (
                                <div className="space-y-3">
                                  <div className="border border-border/40 rounded-xl divide-y divide-border/20 max-h-[200px] overflow-y-auto bg-background/50">
                                    {eligibleTeamAthletes.map((ath) => {
                                      const isChecked = teamRegAthleteIds.includes(ath.id);
                                      const isLimitReached = teamRegAthleteIds.length >= selectedCategory.team_size;

                                      return (
                                        <label key={ath.id} className="p-2.5 flex items-center gap-3 hover:bg-muted/30 cursor-pointer transition-colors">
                                          <input
                                            type="checkbox"
                                            checked={isChecked}
                                            disabled={!isChecked && isLimitReached}
                                            onChange={(e) => {
                                              if (e.target.checked) {
                                                handleSelectTeamAthlete(ath, selectedCategory.team_size);
                                              } else {
                                                handleDeselectTeamAthlete(ath);
                                              }
                                            }}
                                            className="rounded text-amber-500 focus:ring-amber-500 focus:ring-opacity-50"
                                          />
                                          <div className="flex flex-col">
                                            <span className="text-xs font-bold">{ath.last_name} {ath.first_name}</span>
                                            <span className="text-[10px] text-muted-foreground">
                                              {ath.gender === "male" ? "Ч" : "Ж"} • {ath.base_weight} кг • {selectedTournament ? getAgeAsOf(ath.birth_date, selectedTournament.start_date) : 0} р.
                                            </span>
                                          </div>
                                        </label>
                                      );
                                    })}
                                  </div>

                                  {nextAthletesUrl && (
                                    <div className="flex justify-center pt-1">
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => fetchRoster(false)}
                                        disabled={isLoadingAthletes}
                                        className="text-[10px] h-7 px-3 rounded-lg"
                                      >
                                        {isLoadingAthletes && <Loader2 className="w-3 h-3 animate-spin mr-1.5" />}
                                        Показати більше спортсменів
                                      </Button>
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}

              {/* Liability Waiver & Submission */}
              {((regSubTab === "mass" && Object.values(massSelectedCategories).some(cats => cats.length > 0)) || (regSubTab === "team" && selectedCategoryId && teamRegAthleteIds.length === (selectedCategory?.team_size || 3))) && (
                <div className="space-y-4 mt-6 pt-4 border-t border-border/20">
                  <div className="space-y-1.5 p-4 border border-border/40 rounded-xl bg-background/30 flex gap-3 items-start">
                    <input
                      type="checkbox"
                      checked={liabilityWaiver}
                      onChange={(e) => setLiabilityWaiver(e.target.checked)}
                      className="w-4 h-4 rounded text-amber-500 focus:ring-amber-500 focus:ring-opacity-50 mt-1 cursor-pointer"
                    />
                    <div>
                      <Label className="text-xs text-foreground font-semibold cursor-pointer">Декларація про звільнення від відповідальності (Liability Waiver)</Label>
                      <p className="text-[10px] text-muted-foreground mt-1 leading-tight">
                        Я підтверджую, що всі вказані спортсмени є здоровими та мають медичний допуск. Я беру на себе відповідальність за здоров'я учасників та звільняю організаторів від претензій за будь-які травми, отримані під час проведення змагань.
                      </p>
                    </div>
                  </div>

                  <Button
                    type="button"
                    variant="sport"
                    className="w-full mt-4"
                    disabled={isSubmittingReg || !liabilityWaiver}
                    onClick={handleRegisterAthletes}
                  >
                    {isSubmittingReg ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : null}
                    Зареєструвати обраних
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* Quick instructions side */}
          <div className="space-y-6">
            <div className="p-5 border border-border/30 bg-muted/10 rounded-2xl space-y-4">
              <h3 className="font-bold text-lg">💡 Правила подачі заявок</h3>
              <ul className="space-y-3 text-xs text-muted-foreground list-disc pl-4">
                <li>Усі спортсмени перевіряються автоматичною системою аудиту на відповідність віку, статі та вазі згідно з регламентом категорії.</li>
                <li>Вік спортсмена розраховується як кількість повних років <strong>на момент старту турніру</strong>.</li>
                <li>Для командних категорій необхідно вказати назву команди та обрати необхідну кількість учасників безпосередньо у формі (команда створюється та реєструється автоматично).</li>
                <li>Після генерації турнірної сітки (брекету) скасування заявок або додавання нових стає неможливим.</li>
              </ul>
            </div>
          </div>

          {/* Діалог-попередження перед авто-підбором категорій */}
          <Dialog open={showAutofillWarning} onOpenChange={setShowAutofillWarning}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-amber-500">
                  <AlertTriangle className="w-5 h-5 animate-pulse" />
                  Увага: Автоматичний підбір категорій
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3 py-2 text-sm leading-relaxed">
                <p>
                  Система автоматично проаналізує вік, стать та вагу всіх завантажених спортсменів і вибере для них <strong>усі підходящі індивідуальні категорії</strong>.
                </p>
                <p className="text-muted-foreground text-xs font-semibold">
                  * Попередній вибір у таблиці буде перезаписано. Ви зможете вручну змінити вибір перед надсиланням заявок.
                </p>
              </div>
              <DialogFooter className="gap-2 sm:gap-0">
                <Button variant="outline" onClick={() => setShowAutofillWarning(false)}>
                  Скасувати
                </Button>
                <Button
                  variant="sport"
                  onClick={handleAutofillCategories}
                >
                  Підтвердити авто-підбір
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      )}


      {/* ────────────────── ТАБ: РАХУНКИ ТА ОПЛАТА ────────────────── */}
      {activeTab === "billing" && (
        <div className="space-y-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <h2 className="text-2xl font-bold tracking-tight">Розрахункові рахунки та оплати</h2>
            <div className="flex items-center gap-2">
              {billingSubTab === "unpaid" ? (
                <SearchableSelect
                  options={billingTournamentOptions}
                  value={billingTournamentFilter}
                  onValueChange={setBillingTournamentFilter}
                  placeholder="Фільтр за турніром"
                  searchPlaceholder="Пошук турніру..."
                  className="w-full md:w-[220px]"
                  triggerClassName="h-9 rounded-xl text-xs border border-border bg-background"
                />
              ) : (
                <SearchableSelect
                  options={historyTournamentOptions}
                  value={historyTournamentFilter}
                  onValueChange={handleHistoryTournamentFilterChange}
                  placeholder="Фільтр за турніром"
                  searchPlaceholder="Пошук турніру..."
                  className="w-full md:w-[220px]"
                  triggerClassName="h-9 rounded-xl text-xs border border-border bg-background"
                />
              )}
              <Button
                variant="outline"
                size="sm"
                className="h-9 rounded-xl font-semibold border-amber-500/20 text-amber-500 hover:bg-amber-500/10"
                onClick={() => {
                  if (billingSubTab === "unpaid") {
                    fetchBilling();
                    fetchActiveRegistrations();
                  } else {
                    fetchActiveRegistrations();
                    fetchTransactions();
                    fetchInvoices();
                  }
                }}
                disabled={isLoadingBilling || isLoadingTransactions || isLoadingInvoices || isLoadingActiveRegs}
              >
                Оновити
              </Button>
            </div>
          </div>

          {/* Sub-tab selection and Club Scope Toggle */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/20 pb-4">
            <div className="flex bg-muted/30 p-1 rounded-xl border border-border/10 shrink-0">
              <Button
                variant={billingSubTab === "unpaid" ? "sport" : "ghost"}
                size="sm"
                className="h-8 text-xs px-3 rounded-lg"
                onClick={() => handleBillingSubTabChange("unpaid")}
              >
                Неоплачені внески
              </Button>
              <Button
                variant={billingSubTab === "history" ? "sport" : "ghost"}
                size="sm"
                className="h-8 text-xs px-3 rounded-lg"
                onClick={() => handleBillingSubTabChange("history")}
              >
                Фінансова історія
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {billingSubTab === "unpaid" && (
                <div className="flex items-center bg-muted/40 border border-border/30 rounded-xl p-0.5 shrink-0">
                  <Button
                    variant={billingViewMode === "list" ? "sport" : "ghost"}
                    size="sm"
                    className="h-8 text-xs px-3 rounded-lg"
                    onClick={() => handleBillingViewModeChange("list")}
                  >
                    Список
                  </Button>
                  <Button
                    variant={billingViewMode === "athlete" ? "sport" : "ghost"}
                    size="sm"
                    className="h-8 text-xs px-3 rounded-lg"
                    onClick={() => handleBillingViewModeChange("athlete")}
                  >
                    По спортсменах
                  </Button>
                </div>
              )}

              {billingSubTab === "unpaid" && user?.is_club_leader && (
                <div className="flex items-center bg-muted/40 border border-border/30 rounded-xl p-0.5 shrink-0">
                  <Button
                    variant={billingClubScope === "coach" ? "sport" : "ghost"}
                    size="sm"
                    className="h-8 text-xs px-3 rounded-lg"
                    onClick={() => setBillingClubScope("coach")}
                  >
                    Мої спортсмени
                  </Button>
                  <Button
                    variant={billingClubScope === "club" ? "sport" : "ghost"}
                    size="sm"
                    className="h-8 text-xs px-3 rounded-lg"
                    onClick={() => setBillingClubScope("club")}
                  >
                    Спортсмени клубу
                  </Button>
                </div>
              )}
            </div>
          </div>

          {billingSubTab === "unpaid" ? (
            isLoadingBilling && unpaidRegistrations.length === 0 ? (
              <div className="flex justify-center py-20">
                <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
              </div>
            ) : unpaidRegistrations.length === 0 ? (
              <div className="text-center py-20 border border-dashed border-border rounded-xl bg-green-500/5 border-green-500/20">
                <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
                <h3 className="font-bold text-lg text-green-500">Усі заявки оплачено!</h3>
                <p className="text-muted-foreground text-xs mt-1">Немає заборгованостей перед організаторами турнірів.</p>
              </div>
            ) : Object.keys(groupedBilling).length === 0 ? (
              <div className="text-center py-20 border border-dashed border-border rounded-xl bg-muted/5">
                <CheckCircle className="w-12 h-12 text-green-500/40 mx-auto mb-4" />
                <h3 className="font-bold text-lg text-muted-foreground">Немає рахунків</h3>
                <p className="text-muted-foreground text-xs mt-1">Для вибраного турніру немає неоплачених внесків.</p>
              </div>
            ) : (
              <div className="space-y-6">
                {Object.entries(groupedBilling).map(([tidStr, group]) => {
                  const tid = Number(tidStr);
                  const tournamentRegs = group.registrations;
                  const tournamentTitle = group.tournamentTitle;

                  const tournamentGrandTotal = getGrandTotalFor(tournamentRegs);

                  // Group tournament registrations by athlete/team for athlete view mode
                  const athleteGroups: Record<string, {
                    athleteName: string;
                    registrations: Registration[];
                  }> = {};

                  tournamentRegs.forEach((reg) => {
                    const athleteKey = reg.athlete
                      ? `athlete-${reg.athlete.id}`
                      : (reg.team ? `team-${reg.team.id}` : `reg-${reg.id}`);

                    if (!athleteGroups[athleteKey]) {
                      athleteGroups[athleteKey] = {
                        athleteName: formatRegistrationName(reg),
                        registrations: [],
                      };
                    }
                    athleteGroups[athleteKey].registrations.push(reg);
                  });

                  // For list view mode, calculate selected registrations total
                  const tournamentSelectedRegs = tournamentRegs.filter(r => selectedBillingRegIds.includes(r.id));
                  const selectedGrandTotal = getGrandTotalFor(tournamentSelectedRegs);

                  return (
                    <div key={tid} className="p-6 border border-border bg-card/10 rounded-2xl space-y-6 shadow-sm">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/20 pb-4">
                        <div>
                          <h3 className="font-bold text-lg">{tournamentTitle}</h3>
                          <p className="text-xs text-muted-foreground">
                            {billingViewMode === "athlete"
                              ? "Неоплачені заявки на цей турнір, згруповані за спортсменами."
                              : "Неоплачені заявки на цей турнір у вигляді загального списку."
                            }
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {billingViewMode === "list" && group.onlinePaymentEnabled && tournamentSelectedRegs.length > 0 && (
                            <Button
                              variant="sport"
                              size="sm"
                              className="h-9 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white"
                              onClick={() => setShowPayModal({
                                tournamentId: tid,
                                tournamentTitle: tournamentTitle,
                                athleteName: `${tournamentSelectedRegs.length} вибраних заявок`,
                                registrationIds: tournamentSelectedRegs.map(r => r.id),
                                registrations: tournamentSelectedRegs
                              })}
                            >
                              <CreditCard className="w-3.5 h-3.5 mr-1.5" /> Сплатити вибрані ({selectedGrandTotal.toFixed(0)} UAH)
                            </Button>
                          )}
                          {group.onlinePaymentEnabled && tournamentGrandTotal > 0 && (
                            <Button
                              variant="sport"
                              size="sm"
                              className="h-9 rounded-xl text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-black border-none"
                              onClick={() => setShowPayModal({
                                tournamentId: tid,
                                tournamentTitle: tournamentTitle,
                                athleteName: "Всі неоплачені заявки турніру",
                                registrationIds: tournamentRegs.map(r => r.id),
                                registrations: tournamentRegs
                              })}
                            >
                              <CreditCard className="w-4 h-4 mr-1.5" /> Сплатити за весь турнір ({tournamentGrandTotal.toFixed(0)} UAH)
                            </Button>
                          )}
                          {!group.onlinePaymentEnabled && (
                            <span className="text-xs px-2.5 py-1 rounded-md border border-amber-500/20 bg-amber-500/5 text-amber-500 font-semibold">
                              Онлайн-оплату вимкнено
                            </span>
                          )}
                        </div>
                      </div>

                      {group.paymentDetails && (
                        <div className="p-4 border border-border/30 bg-muted/5 rounded-xl space-y-1 text-xs">
                          <div className="font-semibold text-muted-foreground flex items-center gap-1">
                            <Info className="w-3.5 h-3.5 text-amber-500" /> Реквізити для оплати (IBAN / опис):
                          </div>
                          <div className="text-muted-foreground whitespace-pre-wrap pl-4.5 mt-1">{group.paymentDetails}</div>
                        </div>
                      )}

                      {billingViewMode === "athlete" ? (
                        <div className="space-y-4">
                          {Object.entries(athleteGroups).map(([athKey, athGroup]) => {
                            const athSubtotal = getSubtotalFor(athGroup.registrations);
                            const athServiceFee = getServiceFeeFor(athGroup.registrations);
                            const athGrandTotal = getGrandTotalFor(athGroup.registrations);
                            const isCollapsed = collapsedAthletes[athKey] ?? false;

                            return (
                              <div key={athKey} className="border border-border bg-card/5 rounded-xl overflow-hidden shadow-sm transition-all duration-200">
                                {/* Collapsible Header */}
                                <div
                                  role="button"
                                  tabIndex={0}
                                  className="p-4 bg-muted/10 flex items-center justify-between cursor-pointer hover:bg-muted/20 select-none"
                                  onClick={() => setCollapsedAthletes(prev => ({ ...prev, [athKey]: !isCollapsed }))}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault();
                                      setCollapsedAthletes(prev => ({ ...prev, [athKey]: !isCollapsed }));
                                    }
                                  }}
                                >
                                  <div className="flex items-center gap-3">
                                    <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform duration-200", isCollapsed && "-rotate-90")} />
                                    <div>
                                      <h4 className="font-semibold text-sm text-slate-250">{athGroup.athleteName}</h4>
                                      <p className="text-xs text-muted-foreground mt-0.5">
                                        {athGroup.registrations.length} {athGroup.registrations.length === 1 ? 'заявка' : athGroup.registrations.length < 5 ? 'заявки' : 'заявок'} • Разом до сплати: <strong className="text-amber-500">{athGrandTotal.toFixed(0)} UAH</strong>
                                      </p>
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-3">
                                    {group.onlinePaymentEnabled ? (
                                      <Button
                                        variant="sport"
                                        size="sm"
                                        className="h-8 rounded-xl text-xs font-semibold"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setShowPayModal({
                                            tournamentId: tid,
                                            tournamentTitle: tournamentTitle,
                                            athleteName: athGroup.athleteName,
                                            registrationIds: athGroup.registrations.map(r => r.id),
                                            registrations: athGroup.registrations
                                          });
                                        }}
                                      >
                                        <CreditCard className="w-3.5 h-3.5 mr-1.5" /> Сплатити онлайн ({athGrandTotal.toFixed(0)} UAH)
                                      </Button>
                                    ) : (
                                      <span className="text-[10px] px-2 py-0.5 rounded-md border border-amber-500/20 bg-amber-500/5 text-amber-500 font-medium">
                                        Онлайн-оплату вимкнено
                                      </span>
                                    )}
                                  </div>
                                </div>

                                {/* Collapsible Body */}
                                {!isCollapsed && (
                                  <div className="p-4 border-t border-border/20 bg-card/10">
                                    <Table>
                                      <TableHeader>
                                        <TableRow className="hover:bg-transparent">
                                          <TableHead className="h-8 text-xs">Категорія</TableHead>
                                          <TableHead className="h-8 text-right text-xs">Внесок</TableHead>
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {athGroup.registrations.map((reg) => (
                                          <TableRow key={reg.id} className="hover:bg-slate-900/10">
                                            <TableCell className="py-2 text-xs text-muted-foreground">{reg.category_name}</TableCell>
                                            <TableCell className="py-2 text-right font-mono text-xs">{reg.fee || 500} UAH</TableCell>
                                          </TableRow>
                                        ))}
                                        <TableRow className="hover:bg-transparent border-t border-border/10">
                                          <TableCell className="py-1.5 text-right text-xs text-muted-foreground">Сума внесків:</TableCell>
                                          <TableCell className="py-1.5 text-right font-mono text-xs">{athSubtotal} UAH</TableCell>
                                        </TableRow>
                                        {athServiceFee > 0 && (
                                          <TableRow className="hover:bg-transparent">
                                            <TableCell className="py-1.5 text-right text-xs text-muted-foreground">Комісія сервісу (5%):</TableCell>
                                            <TableCell className="py-1.5 text-right font-mono text-xs">{athServiceFee.toFixed(0)} UAH</TableCell>
                                          </TableRow>
                                        )}
                                        <TableRow className="hover:bg-transparent bg-amber-500/5 font-bold text-amber-500">
                                          <TableCell className="py-2 text-right text-xs">Разом до сплати:</TableCell>
                                          <TableCell className="py-2 text-right font-mono text-sm">{athGrandTotal.toFixed(0)} UAH</TableCell>
                                        </TableRow>
                                      </TableBody>
                                    </Table>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="border border-border rounded-xl overflow-hidden bg-card/5">
                          <Table>
                            <TableHeader className="bg-muted/10">
                              <TableRow>
                                {group.onlinePaymentEnabled && (
                                  <TableHead className="w-[50px] text-center">
                                    <input
                                      type="checkbox"
                                      className="rounded border-border bg-background text-primary w-4 h-4 cursor-pointer"
                                      checked={
                                        tournamentRegs.length > 0 &&
                                        tournamentRegs.every((r) => selectedBillingRegIds.includes(r.id))
                                      }
                                      onChange={(e) => {
                                        if (e.target.checked) {
                                          setSelectedBillingRegIds(prev => [
                                            ...prev.filter(id => !tournamentRegs.some(r => r.id === id)),
                                            ...tournamentRegs.map(r => r.id)
                                          ]);
                                        } else {
                                          setSelectedBillingRegIds(prev => prev.filter(id => !tournamentRegs.some(r => r.id === id)));
                                        }
                                      }}
                                    />
                                  </TableHead>
                                )}
                                <TableHead className="text-xs">Спортсмен</TableHead>
                                <TableHead className="text-xs">Категорія</TableHead>
                                <TableHead className="text-right text-xs">Внесок</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {tournamentRegs.map((reg) => (
                                <TableRow key={reg.id} className="hover:bg-slate-900/10">
                                  {group.onlinePaymentEnabled && (
                                    <TableCell className="text-center py-2">
                                      <input
                                        type="checkbox"
                                        className="rounded border-border bg-background text-primary w-4 h-4 cursor-pointer"
                                        checked={selectedBillingRegIds.includes(reg.id)}
                                        onChange={(e) => {
                                          if (e.target.checked) {
                                            setSelectedBillingRegIds(prev => [...prev, reg.id]);
                                          } else {
                                            setSelectedBillingRegIds(prev => prev.filter(id => id !== reg.id));
                                          }
                                        }}
                                      />
                                    </TableCell>
                                  )}
                                  <TableCell className="py-2 text-sm font-semibold text-slate-200">
                                    {formatRegistrationName(reg)}
                                  </TableCell>
                                  <TableCell className="py-2 text-xs text-muted-foreground">
                                    {reg.category_name}
                                  </TableCell>
                                  <TableCell className="py-2 text-right font-mono text-xs">
                                    {reg.fee || 500} UAH
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )
          ) : (
            <div className="space-y-6">
              {/* History Sub-tabs Selector */}
              <div className="flex bg-muted/20 p-1 rounded-xl border border-border/10 w-fit shrink-0">
                <Button
                  variant={historySubTab === "summary" ? "sport" : "ghost"}
                  size="sm"
                  className="h-8 text-xs px-3 rounded-lg font-semibold"
                  onClick={() => handleHistorySubTabChange("summary")}
                >
                  Загальне
                </Button>
                <Button
                  variant={historySubTab === "athlete" ? "sport" : "ghost"}
                  size="sm"
                  className="h-8 text-xs px-3 rounded-lg font-semibold"
                  onClick={() => handleHistorySubTabChange("athlete")}
                >
                  По спортсменах
                </Button>
                <Button
                  variant={historySubTab === "category" ? "sport" : "ghost"}
                  size="sm"
                  className="h-8 text-xs px-3 rounded-lg font-semibold"
                  onClick={() => handleHistorySubTabChange("category")}
                >
                  По категоріях
                </Button>
                <Button
                  variant={historySubTab === "transactions" ? "sport" : "ghost"}
                  size="sm"
                  className="h-8 text-xs px-3 rounded-lg font-semibold"
                  onClick={() => handleHistorySubTabChange("transactions")}
                >
                  Рахунки та транзакції
                </Button>
              </div>

              {historySubTab === "summary" && (() => {
                const totalRegsCount = filteredHistoryRegs.length;
                const paidRegsCount = filteredHistoryRegs.filter(r => r.payment_status === "paid").length;
                const totalOnlinePaid = filteredHistoryRegs.reduce((sum, r) => r.payment_status === "paid" && r.payment_method === "online" ? sum + (r.fee || 500) * (r.commission_payer === "buyer" ? 1.05 : 1) : sum, 0);
                const totalOfflinePaid = filteredHistoryRegs.reduce((sum, r) => r.payment_status === "paid" && r.payment_method !== "online" ? sum + (r.fee || 500) : sum, 0);
                const totalUnpaid = filteredHistoryRegs.reduce((sum, r) => r.payment_status !== "paid" ? sum + (r.fee || 500) * (r.commission_payer === "buyer" ? 1.05 : 1) : sum, 0);
                const grandTotal = totalOnlinePaid + totalOfflinePaid + totalUnpaid;
                const paidPercentage = grandTotal > 0 ? ((totalOnlinePaid + totalOfflinePaid) / grandTotal) * 100 : 0;

                return (
                  <div className="space-y-6">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                      <div className="p-5 border border-border bg-card/10 rounded-2xl space-y-2 shadow-sm">
                        <div className="flex items-center justify-between text-muted-foreground text-[10px] uppercase font-bold tracking-wider">
                          <span>Всього заявок</span>
                          <Users className="w-4 h-4 text-indigo-500" />
                        </div>
                        <div className="text-3xl font-extrabold tracking-tight">{totalRegsCount}</div>
                        <div className="text-xs text-muted-foreground">
                          Оплачено: <strong className="text-emerald-500">{paidRegsCount}</strong> з {totalRegsCount}
                        </div>
                      </div>

                      <div className="p-5 border border-border bg-card/10 rounded-2xl space-y-2 shadow-sm">
                        <div className="flex items-center justify-between text-muted-foreground text-[10px] uppercase font-bold tracking-wider">
                          <span>Оплачено Онлайн</span>
                          <CreditCard className="w-4 h-4 text-emerald-500" />
                        </div>
                        <div className="text-3xl font-extrabold tracking-tight font-mono text-emerald-400">
                          {totalOnlinePaid.toFixed(0)} <span className="text-sm">UAH</span>
                        </div>
                        <div className="text-[10px] text-emerald-500 font-semibold flex items-center gap-1">
                          <CheckCircle className="w-3.5 h-3.5 shrink-0" /> З урахуванням комісії сервісу
                        </div>
                      </div>

                      <div className="p-5 border border-border bg-card/10 rounded-2xl space-y-2 shadow-sm">
                        <div className="flex items-center justify-between text-muted-foreground text-[10px] uppercase font-bold tracking-wider">
                          <span>Оплачено Готівкою</span>
                          <Trophy className="w-4 h-4 text-amber-500" />
                        </div>
                        <div className="text-3xl font-extrabold tracking-tight font-mono text-amber-400">
                          {totalOfflinePaid.toFixed(0)} <span className="text-sm">UAH</span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Офлайн-розрахунок (секретар)
                        </div>
                      </div>

                      <div className="p-5 border border-border bg-card/10 rounded-2xl space-y-2 shadow-sm">
                        <div className="flex items-center justify-between text-muted-foreground text-[10px] uppercase font-bold tracking-wider">
                          <span>Борг (Неоплачено)</span>
                          <AlertTriangle className="w-4 h-4 text-rose-500" />
                        </div>
                        <div className="text-3xl font-extrabold tracking-tight font-mono text-rose-500">
                          {totalUnpaid.toFixed(0)} <span className="text-sm">UAH</span>
                        </div>
                        <div className="text-[10px] text-rose-450 font-semibold">
                          Очікують підтвердження / оплати
                        </div>
                      </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="p-6 border border-border bg-card/10 rounded-2xl space-y-4 shadow-sm">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-bold text-slate-200">Прогрес оплати внесків</span>
                        <span className="font-mono font-black text-amber-500 text-base">{paidPercentage.toFixed(1)}%</span>
                      </div>
                      <div className="w-full h-3 bg-muted/60 rounded-full overflow-hidden p-[2px] border border-border/10">
                        <div
                          className="h-full bg-gradient-to-r from-amber-500 via-orange-500 to-emerald-500 rounded-full transition-all duration-500"
                          style={{ width: `${paidPercentage}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-xs text-muted-foreground pt-1">
                        <span>Загалом сплачено: <strong className="text-emerald-400 font-mono">{(totalOnlinePaid + totalOfflinePaid).toFixed(0)} UAH</strong></span>
                        <span>Необхідно сплатити: <strong className="text-foreground font-mono">{grandTotal.toFixed(0)} UAH</strong></span>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {historySubTab === "athlete" && (
                <div className="border border-border rounded-2xl overflow-hidden bg-card/10 shadow-sm">
                  <Table>
                    <TableHeader className="bg-muted/20">
                      <TableRow>
                        <TableHead className="text-xs font-bold uppercase text-muted-foreground">Спортсмен / Команда</TableHead>
                        <TableHead className="text-center text-xs font-bold uppercase text-muted-foreground">Заявки</TableHead>
                        <TableHead className="text-right text-xs font-bold uppercase text-muted-foreground">Оплачено Онлайн</TableHead>
                        <TableHead className="text-right text-xs font-bold uppercase text-muted-foreground">Оплачено Готівкою</TableHead>
                        <TableHead className="text-right text-xs font-bold uppercase text-muted-foreground">Неоплачено</TableHead>
                        <TableHead className="text-right text-xs font-bold uppercase text-foreground">Всього</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {historyAthleteGroups.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center py-10 text-muted-foreground text-xs">
                            Немає даних про спортсменів.
                          </TableCell>
                        </TableRow>
                      ) : (
                        historyAthleteGroups.map((ath, idx) => (
                          <TableRow key={idx} className="hover:bg-slate-900/10 border-b border-border/10 last:border-0">
                            <TableCell className="py-3 text-sm font-semibold text-slate-200">
                              {ath.athleteName}
                            </TableCell>
                            <TableCell className="py-3 text-center font-mono text-xs text-muted-foreground">
                              {ath.registrations.length}
                            </TableCell>
                            <TableCell className="py-3 text-right font-mono text-xs text-emerald-450 font-medium">
                              {ath.onlinePaid > 0 ? `${ath.onlinePaid.toFixed(0)} UAH` : "—"}
                            </TableCell>
                            <TableCell className="py-3 text-right font-mono text-xs text-slate-350">
                              {ath.offlinePaid > 0 ? `${ath.offlinePaid.toFixed(0)} UAH` : "—"}
                            </TableCell>
                            <TableCell className={`py-3 text-right font-mono text-xs font-medium ${ath.unpaid > 0 ? "text-rose-450" : "text-muted-foreground"}`}>
                              {ath.unpaid > 0 ? `${ath.unpaid.toFixed(0)} UAH` : "—"}
                            </TableCell>
                            <TableCell className="py-3 text-right font-mono text-xs font-bold text-foreground">
                              {ath.total.toFixed(0)} UAH
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              )}

              {historySubTab === "category" && (
                <div className="border border-border rounded-2xl overflow-hidden bg-card/10 shadow-sm">
                  <Table>
                    <TableHeader className="bg-muted/20">
                      <TableRow>
                        <TableHead className="text-xs font-bold uppercase text-muted-foreground">Категорія змагань</TableHead>
                        <TableHead className="text-center text-xs font-bold uppercase text-muted-foreground">Кількість заявок</TableHead>
                        <TableHead className="text-right text-xs font-bold uppercase text-muted-foreground">Оплачено Онлайн</TableHead>
                        <TableHead className="text-right text-xs font-bold uppercase text-muted-foreground">Оплачено Готівкою</TableHead>
                        <TableHead className="text-right text-xs font-bold uppercase text-muted-foreground">Неоплачено</TableHead>
                        <TableHead className="text-right text-xs font-bold uppercase text-foreground">Всього</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {historyCategoryGroups.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center py-10 text-muted-foreground text-xs">
                            Немає даних по категоріях.
                          </TableCell>
                        </TableRow>
                      ) : (
                        historyCategoryGroups.map((cat, idx) => (
                          <TableRow key={idx} className="hover:bg-slate-900/10 border-b border-border/10 last:border-0">
                            <TableCell className="py-3 text-sm text-slate-300 font-medium">
                              {cat.categoryName}
                            </TableCell>
                            <TableCell className="py-3 text-center font-mono text-xs text-muted-foreground">
                              {cat.regCount}
                            </TableCell>
                            <TableCell className="py-3 text-right font-mono text-xs text-emerald-450 font-medium">
                              {cat.onlinePaid > 0 ? `${cat.onlinePaid.toFixed(0)} UAH` : "—"}
                            </TableCell>
                            <TableCell className="py-3 text-right font-mono text-xs text-slate-350">
                              {cat.offlinePaid > 0 ? `${cat.offlinePaid.toFixed(0)} UAH` : "—"}
                            </TableCell>
                            <TableCell className={`py-3 text-right font-mono text-xs font-medium ${cat.unpaid > 0 ? "text-rose-450" : "text-muted-foreground"}`}>
                              {cat.unpaid > 0 ? `${cat.unpaid.toFixed(0)} UAH` : "—"}
                            </TableCell>
                            <TableCell className="py-3 text-right font-mono text-xs font-bold text-foreground">
                              {cat.total.toFixed(0)} UAH
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              )}

              {historySubTab === "transactions" && (
                <div className="space-y-8">
                  {/* Invoices List */}
                  <div className="space-y-4">
                    <h3 className="text-lg font-bold flex items-center gap-2">
                      <CreditCard className="w-5 h-5 text-amber-500" /> Рахунки на оплату (Monobank)
                    </h3>
                    {isLoadingInvoices && invoices.length === 0 ? (
                      <div className="flex justify-center py-10">
                        <Loader2 className="w-6 h-6 animate-spin text-amber-500" />
                      </div>
                    ) : invoices.length === 0 ? (
                      <div className="text-center py-10 border border-dashed border-border rounded-xl bg-muted/5 text-sm text-muted-foreground">
                        Немає згенерованих рахунків.
                      </div>
                    ) : (
                      <div className="border border-border rounded-2xl overflow-hidden bg-card/10 shadow-sm">
                        <Table>
                          <TableHeader className="bg-muted/30">
                            <TableRow>
                              <TableHead>Дата створення</TableHead>
                              <TableHead>Тип оплати</TableHead>
                              <TableHead>Сума</TableHead>
                              <TableHead>Статус</TableHead>
                              <TableHead className="text-right">Дії</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {filteredHistoryInvoices.map((inv) => (
                              <TableRow key={inv.id} className="border-b border-border/10 last:border-0">
                                <TableCell className="text-xs text-muted-foreground">
                                  {new Date(inv.created_at).toLocaleString("uk-UA")}
                                </TableCell>
                                <TableCell
                                  className="text-sm font-semibold text-indigo-400 hover:text-indigo-300 cursor-pointer hover:underline"
                                  onClick={() => handleOpenInvoiceModal(inv)}
                                >
                                  {inv.payment_type === "registrations" ? "Стартові внески" : "Комісія платформи"}
                                </TableCell>
                                <TableCell className="font-mono font-bold">{inv.amount} UAH</TableCell>
                                <TableCell>
                                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                                    inv.status === "paid"
                                      ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                                      : inv.status === "pending"
                                      ? "bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse"
                                      : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                                  }`}>
                                    {inv.status === "paid" ? "Сплачено" : inv.status === "pending" ? "Очікує оплати" : "Скасовано/Помилка"}
                                  </span>
                                </TableCell>
                                <TableCell className="text-right space-x-2">
                                  {inv.status === "pending" && (
                                    <>
                                      {inv.payment_url && (
                                        <Button
                                          size="sm"
                                          variant="sport"
                                          className="h-7 text-xs px-2.5 rounded-lg"
                                          onClick={() => window.open(inv.payment_url, "_blank")}
                                        >
                                          Сплатити
                                        </Button>
                                      )}
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-7 text-xs px-2.5 rounded-lg border-border hover:bg-muted"
                                        onClick={() => handleSyncInvoice(inv.id)}
                                        disabled={isSyncingInvoiceId === inv.id}
                                      >
                                        {isSyncingInvoiceId === inv.id ? (
                                          <Loader2 className="w-3 h-3 animate-spin mr-1" />
                                        ) : null}
                                        Синхронізувати
                                      </Button>
                                    </>
                                  )}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </div>

                  {/* Transactions List */}
                  <div className="space-y-4">
                    <h3 className="text-lg font-bold flex items-center gap-2">
                      <FileText className="w-5 h-5 text-amber-500" /> Історія транзакцій (Успішні оплати)
                    </h3>
                    {isLoadingTransactions ? (
                      <div className="flex justify-center py-10">
                        <Loader2 className="w-6 h-6 animate-spin text-amber-500" />
                      </div>
                    ) : transactions.length === 0 ? (
                      <div className="text-center py-10 border border-dashed border-border rounded-xl bg-muted/5 text-sm text-muted-foreground">
                        Ви ще не проводили транзакцій через платформу.
                      </div>
                    ) : (
                      <div className="border border-border rounded-2xl overflow-hidden bg-card/10 shadow-sm">
                        <Table>
                          <TableHeader className="bg-muted/30">
                            <TableRow>
                              <TableHead>Дата</TableHead>
                              <TableHead>ID / Референс</TableHead>
                              <TableHead>Призначення</TableHead>
                              <TableHead>Метод</TableHead>
                              <TableHead className="text-right">Сума</TableHead>
                              <TableHead className="text-center">Квитанція</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {filteredHistoryTransactions.map((tx) => (
                              <TableRow key={tx.id} className="border-b border-border/10 last:border-0">
                                <TableCell className="text-xs text-muted-foreground">
                                  {new Date(tx.created_at).toLocaleString("uk-UA")}
                                </TableCell>
                                <TableCell className="font-mono text-xs max-w-[120px] truncate" title={tx.reference}>
                                  {tx.reference}
                                </TableCell>
                                <TableCell className="text-sm">
                                  <span
                                    role="button"
                                    tabIndex={0}
                                    className="font-medium text-indigo-400 hover:text-indigo-300 cursor-pointer hover:underline focus:outline-none focus:ring-1 focus:ring-indigo-500 rounded"
                                    onClick={() => {
                                      const inv = invoices.find(i => i.id === tx.invoice);
                                      if (inv) handleOpenInvoiceModal(inv);
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter" || e.key === " ") {
                                        e.preventDefault();
                                        const inv = invoices.find(i => i.id === tx.invoice);
                                        if (inv) handleOpenInvoiceModal(inv);
                                      }
                                    }}
                                  >
                                    {tx.payment_type_display}
                                  </span>
                                  <span className="text-xs text-muted-foreground block">
                                    {tx.transaction_type_display}
                                  </span>
                                </TableCell>
                                <TableCell className="text-xs font-semibold text-foreground">
                                  {tx.method_display}
                                </TableCell>
                                <TableCell className={`text-right font-mono font-bold ${tx.amount < 0 ? "text-rose-500" : "text-emerald-500"}`}>
                                  {tx.amount} UAH
                                </TableCell>
                                <TableCell className="text-center">
                                  {!tx.receipt_url || tx.receipt_url.includes("demo-sandbox-receipt") ? (
                                    <span className="text-xs text-muted-foreground italic">Локальний режим (квитанція недоступна)</span>
                                  ) : (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-7 text-xs px-2.5 rounded-lg border-border hover:bg-muted"
                                      onClick={() => window.open(tx.receipt_url, "_blank")}
                                    >
                                      Офіційна квитанція
                                    </Button>
                                  )}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Діалог підтвердження оплати Monobank */}
          <Dialog open={!!showPayModal} onOpenChange={() => setShowPayModal(null)}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <CreditCard className="w-5 h-5 text-amber-500" /> Оплата стартових внесків Monobank Checkout
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="p-4 border border-amber-500/20 bg-amber-500/5 text-amber-500 text-xs rounded-lg flex items-start gap-2">
                  <Info className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold">Платіжна система Monobank Acquiring</p>
                    <p className="mt-1 leading-relaxed text-muted-foreground">
                      Ви сплачуєте внески за участь у турнірі <strong>{showPayModal?.tournamentTitle}</strong> для спортсмена/команди <strong>{showPayModal?.athleteName}</strong>.
                      Вас буде перенаправлено на безпечну сторінку еквайрингу Monobank для проведення платежу.
                    </p>
                  </div>
                </div>

                <div className="p-4 bg-muted/20 border border-border rounded-xl space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Турнір:</span>
                    <span className="font-medium text-right max-w-[240px] truncate">{showPayModal?.tournamentTitle}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Учасник:</span>
                    <span className="font-medium text-right max-w-[240px] truncate">{showPayModal?.athleteName}</span>
                  </div>
                  <div className="flex justify-between font-semibold border-t border-border/40 pt-2 text-base text-amber-500">
                    <span>Сума до сплати:</span>
                    <span>{showPayModal ? getGrandTotalFor(showPayModal.registrations).toFixed(0) : 0} UAH</span>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowPayModal(null)}>Скасувати</Button>
                <Button variant="sport" onClick={handleSimulatePayment} disabled={isPayingInvoice}>
                  {isPayingInvoice ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : null}
                  Сплатити через Monobank
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      )}


      {/* ────────────────── ТАБ: АКТИВНІ ЗАЯВКИ ────────────────── */}
      {activeTab === "active" && (
        <div className="space-y-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <h2 className="text-2xl font-bold tracking-tight">Ваші поточні заявки</h2>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-9 px-3 rounded-xl text-xs font-semibold flex items-center gap-1.5 border-amber-500/20 text-amber-500 hover:bg-amber-500/10 shrink-0"
                onClick={() => printBadges(filteredActiveRegistrations.map(r => ({ athlete: r.athlete, registration: r })))}
                disabled={filteredActiveRegistrations.length === 0}
              >
                <Printer className="w-4 h-4" /> Експорт усіх бейджів
              </Button>
              <p className="text-xs text-muted-foreground font-semibold px-2 shrink-0">
                Всього: {filteredActiveRegistrations.length} заявок
              </p>
            </div>
          </div>

          {/* Фільтри, пошук та сортування для активних заявок */}
          <div className="flex flex-col md:flex-row gap-4 items-center justify-between bg-card/5 border border-border/20 p-4 rounded-2xl">
            <div className="relative w-full md:max-w-md">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Пошук за ім'ям, категорією або турніром..."
                className="pl-9 h-9 rounded-xl text-xs"
                value={activeSearch}
                onChange={(e) => handleActiveSearchChange(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap items-center gap-4 w-full md:w-auto shrink-0 justify-end">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground whitespace-nowrap">Турнір:</span>
                <SearchableSelect
                  options={activeTournamentOptions}
                  value={activeTournamentFilter}
                  onValueChange={handleActiveTournamentFilterChange}
                  placeholder="Всі турніри"
                  searchPlaceholder="Пошук турніру..."
                  className="w-[180px]"
                  triggerClassName="h-9 rounded-xl text-xs border border-border bg-background"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground whitespace-nowrap">Сортувати за:</span>
                <Select value={activeSort} onValueChange={handleActiveSortChange}>
                  <SelectTrigger className="w-[180px] h-9 rounded-xl text-xs">
                    <SelectValue placeholder="Сортування" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="name_asc">Ім'ям / Назвою (А-Я)</SelectItem>
                    <SelectItem value="name_desc">Ім'ям / Назвою (Я-А)</SelectItem>
                    <SelectItem value="tournament">Турніром</SelectItem>
                    <SelectItem value="category">Категорією</SelectItem>
                    <SelectItem value="payment">Статусом оплати</SelectItem>
                    <SelectItem value="weigh_in">Статусом зважування</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {isLoadingActiveRegs && activeRegistrations.length === 0 ? (
            <div className="flex justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
            </div>
          ) : activeRegistrations.length === 0 ? (
            <div className="text-center py-20 border border-dashed border-border rounded-xl">
              <FileText className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
              <p className="text-muted-foreground text-xs">Немає зареєстрованих заявок. Зареєструйтеся на турніри у вкладці "Реєстрація на турнір".</p>
            </div>
          ) : filteredActiveRegistrations.length === 0 ? (
            <div className="text-center py-20 border border-dashed border-border rounded-xl bg-muted/5">
              <FileText className="w-12 h-12 text-muted-foreground/20 mx-auto mb-4" />
              <p className="text-muted-foreground text-xs">Немає заявок для вибраного турніру.</p>
            </div>
          ) : (
            <div className="rounded-xl border border-border overflow-hidden bg-card/10">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Учасник (Атлет / Команда)</TableHead>
                    <TableHead>Турнір</TableHead>
                    <TableHead>Категорія</TableHead>
                    <TableHead>Статус зважування</TableHead>
                    <TableHead>Оплата</TableHead>
                    <TableHead className="w-32 text-right">Дії</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredActiveRegistrations.map((reg) => (
                    <TableRow key={reg.id}>
                      <TableCell className="font-semibold">{formatRegistrationName(reg)}</TableCell>
                      <TableCell className="text-sm font-medium">{reg.tournament_title || "—"}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{reg.category_name || "—"}</TableCell>
                      <TableCell>
                        <span className={cn(
                          "px-2.5 py-0.5 rounded-full text-xs font-semibold border",
                          reg.status === "confirmed"
                            ? "bg-green-500/10 text-green-500 border-green-500/20"
                            : reg.status === "withdrawn"
                              ? "bg-rose-500/10 text-rose-500 border-rose-500/20"
                              : "bg-amber-500/10 text-amber-500 border-amber-500/20"
                        )}>
                          {reg.status === "withdrawn"
                            ? "Знято"
                            : reg.status === "confirmed"
                              ? "Зважено (OK)"
                              : "Очікує зважування"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className={cn(
                          "px-2.5 py-0.5 rounded-full text-xs font-semibold border",
                          reg.status === "withdrawn"
                            ? reg.payment_status === "paid"
                              ? "bg-amber-500/10 text-amber-500 border-amber-500/20"
                              : "bg-slate-500/10 text-slate-400 border-slate-500/20"
                            : reg.payment_status === "paid"
                              ? "bg-green-500/10 text-green-500 border-green-500/20"
                              : "bg-red-500/10 text-red-500 border-red-500/20"
                        )}>
                          {reg.status === "withdrawn"
                            ? reg.payment_status === "paid"
                              ? reg.payment_method === "offline"
                                ? reg.offline_refund_status === "pending"
                                  ? "Знято (Підтвердьте отримання)"
                                  : "Знято (Оч. пов. готівки)"
                                : "Знято (Повернення після завершення)"
                              : reg.offline_refund_status === "confirmed"
                                ? "Скасовано (Повернено)"
                                : "Скасовано"
                            : reg.payment_status === "paid"
                              ? "Сплачено"
                              : "Не сплачено"}
                        </span>
                      </TableCell>
                      <TableCell className="text-right flex items-center justify-end gap-1.5">
                        {reg.status === "withdrawn" && reg.payment_method === "offline" && reg.offline_refund_status === "pending" && (
                          <Button
                            variant="sport"
                            size="sm"
                            className="h-8 px-2.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white border-none"
                            onClick={() => handleConfirmOfflineRefundReceived(reg.id)}
                            disabled={confirmingRefundId === reg.id}
                          >
                            {confirmingRefundId === reg.id ? (
                              <Loader2 className="w-3 h-3 animate-spin mr-1" />
                            ) : (
                              <CheckCircle className="w-3.5 h-3.5 mr-1" />
                            )}
                            Отримав готівку
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 px-2.5 text-xs font-semibold"
                          onClick={() => printBadge(reg.athlete, reg)}
                        >
                          <Printer className="w-3.5 h-3.5 mr-1" />
                          Друк
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={
                            withdrawingRegId === reg.id ||
                            reg.tournament_status === "active" ||
                            reg.tournament_status === "completed" ||
                            reg.status === "withdrawn"
                          }
                          onClick={() => {
                            const hasOtherRegs = activeRegistrations.some(
                              (r) =>
                                r.id !== reg.id &&
                                r.tournament_id === reg.tournament_id &&
                                ((reg.athlete && r.athlete?.id === reg.athlete.id) ||
                                  (reg.team && r.team?.id === reg.team.id))
                            );
                            if (reg.payment_status === "paid" || hasOtherRegs) {
                              setWithdrawWarningReg(reg);
                            } else {
                              handleWithdrawRegistration(reg.id);
                            }
                          }}
                          className="text-destructive hover:text-destructive hover:bg-destructive/10 text-xs h-8 font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {withdrawingRegId === reg.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><Trash2 className="w-3.5 h-3.5 mr-1" /> Вилучити</>}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Dialog confirmation for paid registration withdrawal */}
          <Dialog open={!!withdrawWarningReg} onOpenChange={() => setWithdrawWarningReg(null)}>
            <DialogContent className="sm:max-w-md bg-slate-900 border-slate-800 text-slate-100">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-rose-500">
                  <AlertTriangle className="w-5 h-5 text-rose-500" /> Підтвердження вилучення та повернення
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <p className="text-sm text-slate-300 leading-relaxed">
                  Ви намагаєтеся вилучити спортсмена <strong>{withdrawWarningReg ? formatRegistrationName(withdrawWarningReg) : ""}</strong> з категорії <strong>{withdrawWarningReg?.category_name}</strong>.
                </p>

                {otherRegsCount > 0 && (
                  <div className="flex items-center gap-3 p-3 bg-slate-950/40 border border-slate-800 rounded-xl">
                    <input
                      type="checkbox"
                      id="withdrawAllCategories"
                      checked={withdrawAllCategories}
                      onChange={(e) => setWithdrawAllCategories(e.target.checked)}
                      className="w-4 h-4 rounded text-rose-500 focus:ring-rose-500 focus:ring-opacity-50 cursor-pointer"
                    />
                    <div>
                      <Label htmlFor="withdrawAllCategories" className="text-xs text-foreground font-semibold cursor-pointer select-none">
                        Зняти також з усіх інших категорій ({otherRegsCount})
                      </Label>
                      <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
                        {otherRegsToWithdraw.map((r) => r.category_name).join(", ")}
                      </p>
                    </div>
                  </div>
                )}

                {hasPaidRegs ? (
                  <>
                    {onlinePaidRegs.some((r) => r.refund_policy === "refundable") && (
                      <div className="p-3 bg-amber-500/10 border border-amber-500/20 text-amber-500 text-xs rounded-lg flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                        <div>
                          <strong>Увага:</strong> Комісія сервісу (5%) у разі скасування сплачених онлайн-реєстрацій та повернення коштів не повертається!
                        </div>
                      </div>
                    )}

                    <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-xl text-xs space-y-2.5">
                      {onlinePaidRegs.length > 0 && (
                        <div className="space-y-2">
                          <div className="flex justify-between pb-1 border-b border-slate-850 font-semibold text-emerald-400">
                            <span>Онлайн-оплата:</span>
                            <span>{onlinePaidRegs.length} кат.</span>
                          </div>
                          <div className="flex justify-between pl-3 pb-1 border-b border-slate-850">
                            <span className="text-slate-400">Стартовий внесок (онлайн):</span>
                            <span className="font-mono text-slate-200">{onlineBaseFee} UAH</span>
                          </div>
                          <div className="flex justify-between pl-3 pb-1 border-b border-slate-850">
                            <span className="text-slate-400">Сплачено всього (онлайн):</span>
                            <span className="font-mono text-slate-200">{onlineTotalPaid} UAH</span>
                          </div>
                          {onlineCommission > 0 && (
                            <div className="flex justify-between pl-3 pb-1 border-b border-slate-850">
                              <span className="text-slate-400">Комісія сервісу (5% - не повертається):</span>
                              <span className="font-mono text-rose-400">-{onlineCommission} UAH</span>
                            </div>
                          )}
                          <div className="flex justify-between pl-3 pb-1 border-b border-slate-850">
                            <span className="text-slate-400">Повернення на карту (Monobank):</span>
                            <span className="font-mono text-emerald-400 font-semibold">{onlineRefund} UAH</span>
                          </div>
                        </div>
                      )}

                      {offlinePaidRegs.length > 0 && (
                        <div className="space-y-2 mt-2">
                          <div className="flex justify-between pb-1 border-b border-slate-850 font-semibold text-amber-400">
                            <span>Оплата готівкою (офлайн):</span>
                            <span>{offlinePaidRegs.length} кат.</span>
                          </div>
                          <div className="flex justify-between pl-3 pb-1 border-b border-slate-850">
                            <span className="text-slate-400">Сплачено всього (готівка):</span>
                            <span className="font-mono text-slate-200">{offlineBaseFee} UAH</span>
                          </div>
                          <div className="flex justify-between pl-3 pb-1 border-b border-slate-850">
                            <span className="text-slate-400">Повернення готівкою (через організатора):</span>
                            <span className="font-mono text-emerald-400 font-semibold">{offlineRefund} UAH</span>
                          </div>
                        </div>
                      )}

                      <div className="flex justify-between pb-1 border-b border-slate-850">
                        <span className="text-slate-400">Правила повернення:</span>
                        <span className="font-semibold text-slate-200">
                          {regsToWithdraw.every((r) => r.payment_status !== "paid" || r.refund_policy === "refundable")
                            ? "Повернення дозволено (Refundable)"
                            : regsToWithdraw.every((r) => r.payment_status !== "paid" || r.refund_policy === "non_refundable")
                            ? "Внески не повертаються (Non-refundable)"
                            : "Часткове повернення"}
                        </span>
                      </div>
                      <div className="flex justify-between pt-1.5 text-sm font-bold text-slate-100">
                        <span className="text-slate-350">Сума до повернення (Всього):</span>
                        <span className="font-mono text-emerald-400 font-bold">
                          {onlineRefund + offlineRefund} UAH
                        </span>
                      </div>
                    </div>

                    {onlinePaidRegs.length > 0 && (
                      onlineRefund > 0 ? (
                        <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs rounded-lg flex items-start gap-2">
                          <Info className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
                          <div>
                            Сума онлайн-оплати <strong>{onlineRefund} UAH</strong> буде автоматично повернута на карту покупця через Monobank Refund API.
                          </div>
                        </div>
                      ) : (
                        <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs rounded-lg flex items-start gap-2">
                          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
                          <div>
                            <strong>Увага:</strong> Для онлайн-оплат правила турніру не передбачають повернення коштів. Онлайн-внесок буде анульовано!
                          </div>
                        </div>
                      )
                    )}

                    {offlinePaidRegs.length > 0 && (
                      offlineRefund > 0 ? (
                        <div className="p-3 bg-amber-500/10 border border-amber-500/20 text-amber-500 text-xs rounded-lg flex items-start gap-2">
                          <Info className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
                          <div>
                            Оплата здійснювалася готівкою поза платформою. Для повернення суми <strong>{offlineRefund} UAH</strong> зверніться безпосередньо до організатора турніру.
                          </div>
                        </div>
                      ) : (
                        <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs rounded-lg flex items-start gap-2">
                          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
                          <div>
                            <strong>Увага:</strong> Для оплачених готівкою реєстрацій правила турніру не передбачають повернення коштів. Внесок буде анульовано!
                          </div>
                        </div>
                      )
                    )}
                  </>
                ) : (
                  <div className="p-3 bg-slate-950/60 border border-slate-800 rounded-xl text-xs space-y-2.5">
                    <div className="flex justify-between pb-1 border-b border-slate-850">
                      <span className="text-slate-400">Статус оплати:</span>
                      <span className="font-semibold text-slate-400">Не сплачено</span>
                    </div>
                    <p className="text-slate-350 leading-relaxed text-xs">
                      Ці реєстрації не були сплачені, тому вони будуть просто видалені без фінансових транзакцій.
                    </p>
                  </div>
                )}
              </div>
              <DialogFooter className="gap-2 sm:gap-0">
                <Button variant="outline" onClick={() => setWithdrawWarningReg(null)} className="border-slate-800 text-slate-300 hover:bg-slate-800">
                  Скасувати
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => {
                    if (withdrawWarningReg) {
                      const otherIds = withdrawAllCategories ? otherRegsToWithdraw.map((r) => r.id) : [];
                      handleWithdrawRegistration(withdrawWarningReg.id, otherIds);
                      setWithdrawWarningReg(null);
                    }
                  }}
                  className="bg-rose-600 hover:bg-rose-700 text-white border-none"
                >
                  Підтвердити вилучення
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      )}


      {/* ────────────────── ТАБ: РЕЙТИНГ ЗАЛІКУ ────────────────── */}
      {activeTab === "leaderboard" && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold tracking-tight">Рейтинг заліку клубу</h2>
            <p className="text-xs text-muted-foreground">Розрахунок: 🥇 1 місце - 3 очка, 🥈 2 місце - 2 очка, 🥉 3 місце - 1 очко.</p>
          </div>

          {getLeaderboard().length === 0 ? (
            <div className="text-center py-20 border border-dashed border-border rounded-xl">
              <Trophy className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
              <p className="text-muted-foreground text-xs">Немає призерів для розрахунку рейтингу заліку.</p>
            </div>
          ) : (
            <div className="rounded-xl border border-border overflow-hidden bg-card/10">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16 text-center">Місце</TableHead>
                    <TableHead>Спортсмен</TableHead>
                    <TableHead className="text-center">Золото 🥇</TableHead>
                    <TableHead className="text-center">Срібло 🥈</TableHead>
                    <TableHead className="text-center">Бронза 🥉</TableHead>
                    <TableHead className="text-center font-bold">Загальна кількість очок</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {getLeaderboard().map((row, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="text-center font-black">{idx + 1}</TableCell>
                      <TableCell className="font-semibold">{row.athlete.last_name} {row.athlete.first_name}</TableCell>
                      <TableCell className="text-center font-mono text-base">{row.medals.gold}</TableCell>
                      <TableCell className="text-center font-mono text-base">{row.medals.silver}</TableCell>
                      <TableCell className="text-center font-mono text-base">{row.medals.bronze}</TableCell>
                      <TableCell className="text-center font-black text-amber-500 bg-amber-500/5">{row.points}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}


      {/* ────────────────── ТАБ: LIVE SCOREBOARD ────────────────── */}
      {activeTab === "live" && (
        <div className="space-y-6 animate-in fade-in duration-300">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/20 pb-4">
            <div>
              <h2 className="text-2xl font-bold tracking-tight">Live Scoreboard Tracker</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Відстежуйте результати поєдинків вашого клубу в реальному часі</p>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[11px] font-semibold text-emerald-500 shadow-sm self-start sm:self-center">
              <span className="w-2 h-2 bg-emerald-500 rounded-full animate-ping" />
              <span>Режим автооновлення активовано</span>
            </div>
          </div>

          {/* Пошук для Live Scoreboard */}
          <div className="flex flex-col md:flex-row gap-4 items-center justify-between bg-card/5 border border-border/20 p-4 rounded-2xl">
            <div className="relative w-full md:max-w-md">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Пошук за учасником, категорією або турніром..."
                className="pl-9 h-9 rounded-xl text-xs"
                value={liveSearch}
                onChange={(e) => handleLiveSearchChange(e.target.value)}
              />
            </div>
            {liveMatches.length > 0 && (
              <div className="text-xs text-muted-foreground font-semibold px-2 shrink-0">
                Всього: {filteredLiveMatches.length} поєдинків
              </div>
            )}
          </div>

          {liveMatches.length === 0 ? (
            <div className="text-center py-24 border border-dashed border-border/60 rounded-3xl bg-muted/5">
              <Activity className="w-14 h-14 text-muted-foreground/30 mx-auto mb-4 animate-pulse" />
              <h3 className="font-bold text-lg text-foreground/90">Немає активних поєдинків</h3>
              <p className="text-muted-foreground text-xs mt-1.5 max-w-sm mx-auto leading-normal">
                Зараз на татамі не проходять поєдинки за участю спортсменів вашого клубу.
              </p>
            </div>
          ) : filteredLiveMatches.length === 0 ? (
            <div className="text-center py-24 border border-dashed border-border/60 rounded-3xl bg-muted/5">
              <Search className="w-14 h-14 text-muted-foreground/30 mx-auto mb-4 animate-pulse" />
              <h3 className="font-bold text-lg text-foreground/90">Нічого не знайдено</h3>
              <p className="text-muted-foreground text-xs mt-1.5 max-w-sm mx-auto leading-normal">
                Не знайдено активних поєдинків за запитом "{liveSearch}". Спробуйте інший запит.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
              {filteredLiveMatches.map((m) => {
                const isOngoing = m.status === "ongoing" || (m.team_bouts && m.team_bouts.some((b: any) => b.status === "ongoing"));
                return (
                  <div
                    key={m.id}
                    className={cn(
                      "p-6 border rounded-3xl space-y-4 transition-all duration-300 shadow-sm relative overflow-hidden",
                      isOngoing
                        ? "bg-gradient-to-br from-card to-destructive/[0.01] border-destructive/30 shadow-[0_0_20px_rgba(239,68,68,0.06)]"
                        : "bg-card border-border/60"
                    )}
                  >
                    {isOngoing && (
                      <div className="absolute top-0 right-0 w-24 h-24 bg-red-500/[0.02] rounded-full blur-2xl pointer-events-none" />
                    )}

                    <div className="flex flex-col gap-2 border-b border-border/20 pb-3">
                      <div className="flex items-start justify-between gap-4">
                        <Link
                          to={`/tournaments/${m.tournament_id}`}
                          className="text-xs font-semibold text-muted-foreground hover:text-amber-500 hover:underline leading-normal line-clamp-1 block transition-colors"
                        >
                          {m.tournament_title || `Турнір #${m.tournament_id}`}
                        </Link>
                        <div className="flex gap-1.5 shrink-0">
                          <span className="px-2 py-0.5 rounded-md bg-muted text-foreground font-bold text-[10px]">
                            Татамі {m.tatami_number || "—"}
                          </span>
                        </div>
                      </div>
                      <Link
                        to={`/categories/${m.category}`}
                        className="text-xs font-bold text-foreground/80 hover:text-amber-500 hover:underline line-clamp-1 block transition-colors mt-0.5"
                      >
                        {m.category_name || "Категорія"}
                      </Link>
                    </div>

                    <div className="grid grid-cols-2 gap-4 items-stretch">
                      {/* Aka (Red) */}
                      <div className="space-y-2 text-center p-4 rounded-2xl bg-red-500/[0.02] border border-red-500/10 flex flex-col justify-between">
                        <div>
                          <strong className="text-red-500 text-[10px] font-black tracking-widest uppercase block">AKA</strong>
                          <span className="font-bold text-xs block whitespace-normal break-words leading-tight mt-1 min-h-[2rem] flex items-center justify-center">
                            {formatRegistrationName(m.reg_first) || m.athlete_first?.last_name || "—"}
                          </span>
                        </div>
                        <span className="font-mono text-4xl font-extrabold text-red-500 block select-none mt-2">
                          {m.score_first ?? 0}
                        </span>
                      </div>

                      {/* Ao (Blue) */}
                      <div className="space-y-2 text-center p-4 rounded-2xl bg-blue-500/[0.02] border border-blue-500/10 flex flex-col justify-between">
                        <div>
                          <strong className="text-blue-500 text-[10px] font-black tracking-widest uppercase block">AO</strong>
                          <span className="font-bold text-xs block whitespace-normal break-words leading-tight mt-1 min-h-[2rem] flex items-center justify-center">
                            {formatRegistrationName(m.reg_second) || m.athlete_second?.last_name || "—"}
                          </span>
                        </div>
                        <span className="font-mono text-4xl font-extrabold text-blue-500 block select-none mt-2">
                          {m.score_second ?? 0}
                        </span>
                      </div>
                    </div>

                    {m.category_is_team && m.team_bouts && m.team_bouts.length > 0 && (
                      <div className="border-t border-border/20 pt-3 mt-3 space-y-2">
                        <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Сутички:</div>
                        <div className="space-y-1.5">
                          {m.team_bouts.map((bout: any) => {
                            const firstAthleteName = bout.athlete_first
                              ? `${bout.athlete_first.last_name} ${bout.athlete_first.first_name[0]}.`
                              : "—";
                            const secondAthleteName = bout.athlete_second
                              ? `${bout.athlete_second.last_name} ${bout.athlete_second.first_name[0]}.`
                              : "—";
                            const isBoutOngoing = bout.status === "ongoing";
                            const isBoutCompleted = bout.status === "completed";

                            return (
                              <div
                                key={bout.id}
                                className={cn(
                                  "grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-xs p-2.5 rounded-xl border transition-all duration-300",
                                  isBoutOngoing
                                    ? "border-red-500/40 bg-red-500/[0.03] font-bold shadow-[0_0_12px_rgba(239,68,68,0.04)]"
                                    : isBoutCompleted
                                    ? "border-border/10 bg-background/20 opacity-70"
                                    : "border-border/20 bg-background/40"
                                )}
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  {isBoutOngoing && (
                                    <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse shrink-0" />
                                  )}
                                  <span className={cn("font-semibold truncate", isBoutOngoing ? "text-red-500 font-extrabold" : "text-red-500/90")}>
                                    {firstAthleteName}
                                  </span>
                                </div>
                                <div className="flex items-center gap-1.5 px-2 py-0.5 bg-background border border-border/50 rounded font-mono text-[10px] shrink-0 font-bold justify-center min-w-[50px]">
                                  <span className={cn(isBoutOngoing && "text-red-500")}>
                                    {bout.judging_mode === "flags" ? bout.flags_aka ?? 0 : bout.score_first ?? 0}
                                  </span>
                                  <span className="text-muted-foreground">:</span>
                                  <span className={cn(isBoutOngoing && "text-blue-500")}>
                                    {bout.judging_mode === "flags" ? bout.flags_ao ?? 0 : bout.score_second ?? 0}
                                  </span>
                                </div>
                                <div className="flex items-center justify-end gap-2 min-w-0">
                                  <span className={cn("font-semibold truncate text-right", isBoutOngoing ? "text-blue-500 font-extrabold" : "text-blue-500/90")}>
                                    {secondAthleteName}
                                  </span>
                                  {isBoutOngoing && (
                                    <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse shrink-0" />
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div className="flex items-center justify-between text-xs pt-1">
                      <span className="text-muted-foreground flex items-center gap-1.5">
                        Статус:
                        <strong className={cn(
                          "font-bold",
                          isOngoing ? "text-red-500" : m.status === "scheduled" ? "text-amber-500" : "text-muted-foreground"
                        )}>
                          {isOngoing ? "Йде бій" : m.status === "scheduled" ? "Очікує" : m.status_display || m.status}
                        </strong>
                      </span>
                      {isOngoing && (
                        <span className="font-mono bg-red-500/10 text-red-500 border border-red-500/20 px-2 py-0.5 rounded-md font-bold animate-pulse">
                          LIVE
                        </span>
                      )}

                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Діалог додавання/редагування спортсмена */}
      <Dialog open={isAthleteDialogOpen} onOpenChange={(open) => {
        setIsAthleteDialogOpen(open);
        if (!open) {
          setEditingAthlete(null);
          setSelectedFile(null);
          resetAthlete();
        }
      }}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingAthlete ? "Редагувати спортсмена" : "Новий спортсмен"}</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleAthleteSubmit(handleSaveAthlete)} className="space-y-4">
            <input type="hidden" {...regAthlete("gender")} />
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Ім'я</Label>
                <Input placeholder="Іван" {...regAthlete("first_name")} />
                {athleteErrors.first_name && <p className="text-xs text-destructive">{athleteErrors.first_name.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Прізвище</Label>
                <Input placeholder="Петренко" {...regAthlete("last_name")} />
                {athleteErrors.last_name && <p className="text-xs text-destructive">{athleteErrors.last_name.message}</p>}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>По батькові</Label>
              <Input placeholder="Васильович" {...regAthlete("patronymic")} />
              {athleteErrors.patronymic && <p className="text-xs text-destructive">{athleteErrors.patronymic.message}</p>}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Дата народження</Label>
                <Input type="date" {...regAthlete("date_of_birth")} />
                {athleteErrors.date_of_birth && <p className="text-xs text-destructive">{athleteErrors.date_of_birth.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Стать</Label>
                <Select
                  value={selectedGender}
                  onValueChange={(v) => { setSelectedGender(v as "M" | "F"); setAthleteValue("gender", v as "M" | "F"); }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="M">Чоловік</SelectItem>
                    <SelectItem value="F">Жінка</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Вага (кг)</Label>
                <Input type="number" step="0.1" placeholder="68.5" {...regAthlete("weight")} />
                {athleteErrors.weight && <p className="text-xs text-destructive">{athleteErrors.weight.message}</p>}
              </div>

              <div className="space-y-1.5">
                <Label>Рівень / Пояс</Label>
                <Input placeholder="Напр. 1 дан, КМС" {...regAthlete("skill_level")} />
                {athleteErrors.skill_level && <p className="text-xs text-destructive">{athleteErrors.skill_level.message}</p>}
              </div>
            </div>

            <PhotoUploadField
              selectedFile={selectedFile}
              onFileChange={setSelectedFile}
              currentPhotoUrl={editingAthlete?.photo}
            />

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setIsAthleteDialogOpen(false);
                  setEditingAthlete(null);
                  setSelectedFile(null);
                }}
              >
                Скасувати
              </Button>
              <Button type="submit" variant="sport" disabled={isSavingAthlete}>
                {isSavingAthlete ? <Loader2 className="w-4 h-4 animate-spin" /> : (editingAthlete ? "Зберегти" : "Додати")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Діалог підтвердження видалення спортсмена */}
      <Dialog open={athleteToDelete !== null} onOpenChange={(open) => !open && setAthleteToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">Вилучити спортсмена</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground font-semibold">
            Ви впевнені, що хочете видалити спортсмена {athleteToDelete?.last_name} {athleteToDelete?.first_name} з реєстру вашого клубу?
          </p>
          <p className="text-xs text-muted-foreground/80 mt-1 leading-normal">
            Усі поточні заявки цього спортсмена на турніри також будуть відкликані автоматично. Ця дія незворотна.
          </p>
          <DialogFooter className="gap-2 sm:gap-0 mt-4">
            <Button variant="outline" onClick={() => setAthleteToDelete(null)}>
              Скасувати
            </Button>
            <Button variant="destructive" onClick={handleConfirmDeleteAthlete} disabled={isDeletingAthlete}>
              {isDeletingAthlete ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : null}
              Вилучити
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Діалог перегляду активних заявок спортсмена */}
      <Dialog open={selectedAthleteRegs !== null} onOpenChange={(open) => !open && setSelectedAthleteRegs(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl font-bold">
              <Layers className="w-5 h-5 text-amber-500" />
              Активні заявки спортсмена
            </DialogTitle>
          </DialogHeader>

          {selectedAthleteRegs && (
            <div className="space-y-4 py-2">
              <div>
                <h3 className="font-bold text-lg">{selectedAthleteRegs.last_name} {selectedAthleteRegs.first_name}</h3>
                {selectedAthleteRegs.patronymic && (
                  <p className="text-xs text-muted-foreground">{selectedAthleteRegs.patronymic}</p>
                )}
                <p className="text-xs text-muted-foreground mt-1">
                  Рівень / Пояс: {selectedAthleteRegs.skill_level || "Без розряду"} • Вага: {selectedAthleteRegs.base_weight} кг
                </p>
              </div>

              {isLoadingActiveRegs ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
                </div>
              ) : athleteRegs.length === 0 ? (
                <div className="text-center py-12 border border-dashed border-border rounded-xl">
                  <FileText className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-muted-foreground text-xs font-medium">Спортсмен не зареєстрований на жоден активний турнір.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="text-xs text-muted-foreground font-semibold px-1">
                    Знайдено: {athleteRegs.length} активних заявок
                  </div>
                  <div className="divide-y divide-border border border-border rounded-xl overflow-hidden bg-card/5">
                    {athleteRegs.map((reg) => {
                      const isTeam = !!reg.team;
                      return (
                        <div key={reg.id} className="p-4 flex flex-col sm:flex-row sm:items-start justify-between gap-4 hover:bg-card/10 transition-colors">
                          <div className="flex-1 space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-bold text-foreground leading-snug">
                                {reg.tournament_title || `Турнір #${reg.tournament_id}`}
                              </span>
                              {isTeam && (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 shrink-0">
                                  Команда: {reg.team?.name}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground font-medium">
                              Категорія: <span className="text-foreground">{reg.category_name || "—"}</span>
                            </p>
                          </div>
                          <div className="flex flex-row sm:flex-col items-center sm:items-end gap-2 shrink-0 self-start sm:self-auto w-full sm:w-auto justify-between sm:justify-start">
                            <div className="flex items-center gap-1.5 flex-wrap justify-end">
                              <span className={cn(
                                "px-2 py-0.5 rounded-full text-[10px] font-semibold border shrink-0",
                                reg.status === "confirmed"
                                  ? "bg-green-500/10 text-green-500 border-green-500/20"
                                  : reg.status === "withdrawn"
                                    ? "bg-rose-500/10 text-rose-500 border-rose-500/20"
                                    : "bg-amber-500/10 text-amber-500 border-amber-500/20"
                              )}>
                                {reg.status === "withdrawn"
                                  ? "Знято"
                                  : reg.status === "confirmed"
                                    ? "Зважено"
                                    : "Очікує зважування"}
                              </span>
                              <span className={cn(
                                "px-2 py-0.5 rounded-full text-[10px] font-semibold border shrink-0",
                                reg.status === "withdrawn"
                                  ? reg.payment_status === "paid"
                                    ? "bg-amber-500/10 text-amber-500 border-amber-500/20"
                                    : "bg-slate-500/10 text-slate-400 border-slate-500/20"
                                  : reg.payment_status === "paid"
                                    ? "bg-green-500/10 text-green-500 border-green-500/20"
                                    : "bg-red-500/10 text-red-500 border-red-500/20"
                              )}>
                                {reg.status === "withdrawn"
                                  ? reg.payment_status === "paid"
                                    ? "Знято (Повернення після завершення)"
                                    : "Скасовано"
                                  : reg.payment_status === "paid"
                                    ? "Сплачено"
                                    : "Борг"}
                              </span>
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 px-2.5 text-xs font-semibold shrink-0"
                              onClick={() => printBadge(reg.athlete || selectedAthleteRegs, reg)}
                            >
                              <Printer className="w-3.5 h-3.5 mr-1" />
                              Бейдж
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setSelectedAthleteRegs(null)}>
              Закрити
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Діалог імпорту спортсменів */}
      <Dialog open={isImportDialogOpen} onOpenChange={setIsImportDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl font-bold">
              <FileSpreadsheet className="w-5 h-5 text-amber-500" />
              Імпорт реєстру спортсменів
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleImportAthletes} className="space-y-6 py-2">
            {/* Download Templates Area */}
            <div className="p-4 border border-amber-500/20 bg-amber-500/5 rounded-2xl space-y-3">
              <h4 className="text-sm font-bold text-amber-500 flex items-center gap-1.5">
                <Download className="w-4 h-4" /> Шаблони таблиць для заповнення
              </h4>
              <p className="text-xs text-muted-foreground leading-normal">
                Завантажте готовий шаблон, заповніть дані та завантажте файл назад для швидкої реєстрації всього клубу:
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <a
                  href="/templates/athletes_template.xlsx"
                  download="athletes_template.xlsx"
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl bg-card border border-border/50 text-foreground hover:bg-muted/50 transition-all"
                >
                  <FileSpreadsheet className="w-4 h-4 text-green-500" />
                  Шаблон Excel (.xlsx)
                </a>
                <a
                  href="/templates/athletes_template.csv"
                  download="athletes_template.csv"
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl bg-card border border-border/50 text-foreground hover:bg-muted/50 transition-all"
                >
                  <FileText className="w-4 h-4 text-amber-500" />
                  Шаблон CSV (.csv)
                </a>
              </div>
            </div>

            {/* Column instructions */}
            <div className="space-y-2">
              <Label className="text-xs font-bold text-muted-foreground">Вимоги до колонок у файлі:</Label>
              <div className="text-[11px] text-muted-foreground bg-muted/30 border border-border/20 p-3 rounded-xl space-y-1">
                <p>• <strong>Обов'язкові</strong>: Прізвище, Ім'я, Стать (Ч/Ж або male/female), Дата народження (РРРР-ММ-ДД або ДД.ММ.РРРР), Вага (число).</p>
                <p>• <strong>Необов'язкові</strong>: По батькові, Розряд/Пояс.</p>
              </div>
            </div>

            {/* File input */}
            <div className="space-y-2">
              <Label htmlFor="importFile" className="text-sm font-semibold">Оберіть файл для імпорту</Label>
              <Input
                key={importInputKey}
                id="importFile"
                type="file"
                accept=".csv, .xlsx, .xls"
                onChange={(e) => {
                  const files = e.target.files;
                  if (files && files.length > 0) {
                    setImportFile(files[0]);
                    setImportErrors([]);
                  }
                }}
                className="cursor-pointer file:text-amber-500 file:font-semibold"
              />
              {importFile && (
                <div className="flex items-center gap-2 p-2.5 rounded-xl border border-amber-500/20 bg-amber-500/5 text-xs text-amber-500 font-semibold mt-1">
                  <FileSpreadsheet className="w-4 h-4 shrink-0" />
                  <span className="truncate">Обрано: {importFile.name} ({(importFile.size / 1024).toFixed(1)} KB)</span>
                </div>
              )}
            </div>

            {/* Error alerts */}
            {importErrors.length > 0 && (
              <div className="p-4 border border-destructive/20 bg-destructive/5 text-destructive rounded-xl space-y-2">
                <h4 className="text-xs font-bold flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4" />
                  Помилка імпорту. Жодного спортсмена не було додано:
                </h4>
                <div className="max-h-[150px] overflow-y-auto divide-y divide-destructive/10 text-[10px] space-y-1 font-mono">
                  {importErrors.map((err, idx) => (
                    <div key={idx} className="pt-1">{err}</div>
                  ))}
                </div>
              </div>
            )}

            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setIsImportDialogOpen(false);
                  setImportFile(null);
                  setImportErrors([]);
                }}
              >
                Скасувати
              </Button>
              <Button type="submit" variant="sport" disabled={isImporting || !importFile}>
                {isImporting ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <Upload className="w-4 h-4 mr-1.5" />}
                Імпортувати
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {uniqueTournamentIds.map((tid) => (
        <TournamentWebSocketListener
          key={tid}
          tournamentId={tid}
          onUpdate={handleWebSocketUpdate}
        />
      ))}
      {uniqueCategoryIds.map((catId) => (
        <MatchUpdatesListener
          key={catId}
          categoryId={catId}
          onUpdate={handleMatchUpdate}
        />
      ))}

      <InvoiceDetailsDialog
        invoice={selectedInvoiceForModal}
        isOpen={isInvoiceModalOpen}
        onClose={() => {
          setIsInvoiceModalOpen(false);
          setSelectedInvoiceForModal(null);
        }}
      />
    </div>
  );
}

interface MatchUpdatesListenerProps {
  categoryId: number;
  onUpdate: (match: any) => void;
}

function MatchUpdatesListener({ categoryId, onUpdate }: MatchUpdatesListenerProps) {
  useMatchUpdates(categoryId, onUpdate);
  return null;
}
