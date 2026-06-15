/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, react-hooks/exhaustive-deps */
import { useEffect, useState, useMemo } from "react";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn, formatSportType, formatRegistrationName } from "@/lib/utils";
import type { Athlete, Tournament, Category, Registration, Team, PaginatedResponse } from "@/types/api";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useSearchParams, Link } from "react-router-dom";

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

// Calculate age as of reference date
const getAgeAsOf = (birthDateStr: string, refDateStr: string) => {
  const birthDate = new Date(birthDateStr);
  const refDate = new Date(refDateStr);
  let age = refDate.getFullYear() - birthDate.getFullYear();
  const m = refDate.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && refDate.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
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

  // Active sub-tab state
  const [activeTab, setActiveTabState] = useState<"roster" | "register" | "billing" | "active" | "leaderboard" | "live">(initialTab);

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

  const setActiveTab = (tab: "roster" | "register" | "billing" | "active" | "leaderboard" | "live") => {
    setActiveTabState(tab);
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
  const [selectedTournamentId, setSelectedTournamentIdState] = useState<string>(initialRegTournamentId);
  const [tournamentCategories, setTournamentCategories] = useState<Category[]>([]);
  const [regSubTab, setRegSubTabState] = useState<"mass" | "team">(initialRegSubTab);
  const [massSelectedCategories, setMassSelectedCategories] = useState<Record<number, number[]>>({});
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>("");
  const [liabilityWaiver, setLiabilityWaiver] = useState(false);
  const [isSubmittingReg, setIsSubmittingReg] = useState(false);
  const [isTournamentDropdownOpen, setIsTournamentDropdownOpen] = useState(false);
  const [tournamentSearch, setTournamentSearch] = useState("");

  // Search, sort & registration states
  const [rosterSearch, setRosterSearchState] = useState(initialRosterSearch);
  const [rosterSort, setRosterSortState] = useState(initialRosterSort);
  const [regSearch, setRegSearch] = useState("");
  const [teamSearch, setTeamSearch] = useState("");
  const [teamCategorySearch, setTeamCategorySearch] = useState("");
  const [showAutofillWarning, setShowAutofillWarning] = useState(false);

  const setRosterSearch = (val: string) => {
    setRosterSearchState(val);
    updateQueryParam("rosterSearch", val);
  };

  const setRosterSort = (val: string) => {
    setRosterSortState(val);
    updateQueryParam("rosterSort", val);
  };

  const setSelectedTournamentId = (val: string) => {
    setSelectedTournamentIdState(val);
    updateQueryParam("regTournamentId", val);
  };

  const setRegSubTab = (val: "mass" | "team") => {
    setRegSubTabState(val);
    updateQueryParam("regSubTab", val);
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
  const [showPayModal, setShowPayModal] = useState<Tournament | null>(null);

  // Active registrations states
  const [activeRegistrations, setActiveRegistrations] = useState<Registration[]>([]);

  // Tournament filter states
  const [billingTournamentFilter, setBillingTournamentFilter] = useState<string>("all");
  const [activeTournamentFilter, setActiveTournamentFilterState] = useState(initialActiveTournamentFilter);
  const [activeSearch, setActiveSearchState] = useState(initialActiveSearch);
  const [activeSort, setActiveSortState] = useState(initialActiveSort);

  const setActiveSearch = (val: string) => {
    setActiveSearchState(val);
    updateQueryParam("activeSearch", val);
  };

  const setActiveSort = (val: string) => {
    setActiveSortState(val);
    updateQueryParam("activeSort", val);
  };

  const setActiveTournamentFilter = (val: string) => {
    setActiveTournamentFilterState(val);
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

  const handleImportAthletes = async (e: React.FormEvent) => {
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
  const [liveSearch, setLiveSearchState] = useState(initialLiveSearch);
  const [massCategorySearch, setMassCategorySearch] = useState("");

  const setLiveSearch = (val: string) => {
    setLiveSearchState(val);
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
      const { data } = await api.get<PaginatedResponse<Registration> | Registration[]>("/registrations/?page_size=1000");
      const list = Array.isArray(data) ? data : data.results;
      // Filter unpaid coach registrations (exclude completed tournaments)
      setUnpaidRegistrations(list.filter((r: Registration) => r.payment_status === "unpaid" && r.tournament_status !== "completed"));
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoadingBilling(false);
    }
  };

  // Fetch all registrations for active registrations tab
  const fetchActiveRegistrations = async () => {
    setIsLoadingActiveRegs(true);
    try {
      const { data } = await api.get<PaginatedResponse<Registration> | Registration[]>("/registrations/?page_size=1000");
      const list = Array.isArray(data) ? data : data.results;
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
    if (activeTab === "billing") fetchBilling();
    if (activeTab === "active") fetchActiveRegistrations();
    if (activeTab === "live") {
      fetchLiveMatches();
      const interval = setInterval(fetchLiveMatches, 10000);
      return () => clearInterval(interval);
    }
  }, [activeTab]);

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
        setSelectedTournamentId("");
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

  // Settle invoice simulator
  const handleSimulatePayment = async () => {
    if (!showPayModal) return;
    setIsPayingInvoice(true);
    try {
      const targetTournamentId = showPayModal.id;
      const regsToPay = unpaidRegistrations.filter((r) => r.tournament_id === targetTournamentId);
      const regIds = regsToPay.map((r) => r.id);

      await api.post("/registrations/bulk_pay/", {
        registration_ids: regIds,
      });

      toast({ title: "Оплату зараховано!", description: `Сума успішно перерахована організатору.` });
      setShowPayModal(null);
      fetchBilling();
    } catch {
      // handled by interceptor
    } finally {
      setIsPayingInvoice(false);
    }
  };

  // Cancel registration
  const handleWithdrawRegistration = async (regId: number) => {
    setWithdrawingRegId(regId);
    try {
      await api.delete(`/registrations/${regId}/`);
      toast({ title: "Заявку відкликано!" });
      fetchActiveRegistrations();
    } catch {
      // handled by interceptor
    } finally {
      setWithdrawingRegId(null);
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
          <Button variant={activeTab === "roster" ? "sport" : "ghost"} size="sm" onClick={() => setActiveTab("roster")}>
            <Users className="w-4 h-4 mr-1.5" /> Реєстр клубу
          </Button>
          <Button variant={activeTab === "register" ? "sport" : "ghost"} size="sm" onClick={() => setActiveTab("register")}>
            <Plus className="w-4 h-4 mr-1.5" /> Реєстрація на турнір
          </Button>
          <Button variant={activeTab === "billing" ? "sport" : "ghost"} size="sm" onClick={() => setActiveTab("billing")}>
            <CreditCard className="w-4 h-4 mr-1.5" /> Рахунки та оплата
          </Button>
          <Button variant={activeTab === "active" ? "sport" : "ghost"} size="sm" onClick={() => setActiveTab("active")}>
            <FileText className="w-4 h-4 mr-1.5" /> Активні заявки
          </Button>
          <Button variant={activeTab === "leaderboard" ? "sport" : "ghost"} size="sm" onClick={() => setActiveTab("leaderboard")}>
            <Trophy className="w-4 h-4 mr-1.5" /> Рейтинг заліку
          </Button>
          <Button variant={activeTab === "live" ? "sport" : "ghost"} size="sm" onClick={() => setActiveTab("live")}>
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
                onChange={(e) => setRosterSearch(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2 w-full md:w-auto shrink-0 justify-end">
              <span className="text-xs text-muted-foreground whitespace-nowrap">Сортувати за:</span>
              <Select value={rosterSort} onValueChange={setRosterSort}>
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
                    className="fixed inset-0 z-40 bg-transparent"
                    onClick={() => setIsTournamentDropdownOpen(false)}
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
                                  setSelectedTournamentId(t.id.toString());
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
                      onClick={() => setRegSubTab("mass")}
                      className="rounded-xl text-xs h-8"
                    >
                      <Users className="w-3.5 h-3.5 mr-1" /> Масова реєстрація
                    </Button>
                    <Button
                      variant={regSubTab === "team" ? "sport" : "outline"}
                      size="sm"
                      onClick={() => setRegSubTab("team")}
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
                                              onClick={() => {
                                                if (isSelected) {
                                                  setMassSelectedCategories((prev) => ({
                                                    ...prev,
                                                    [ath.id]: (prev[ath.id] || []).filter((id) => id !== c.id),
                                                  }));
                                                } else {
                                                  setMassSelectedCategories((prev) => ({
                                                    ...prev,
                                                    [ath.id]: [...(prev[ath.id] || []), c.id],
                                                  }));
                                                }
                                              }}
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
                                                if (teamRegAthleteIds.length < selectedCategory.team_size) {
                                                  setTeamRegAthletes((prev) => [...prev, ath]);
                                                }
                                              } else {
                                                setTeamRegAthletes((prev) => prev.filter((a) => a.id !== ath.id));
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
              <Select value={billingTournamentFilter} onValueChange={setBillingTournamentFilter}>
                <SelectTrigger className="w-full md:w-[220px] h-9 rounded-xl text-xs">
                  <SelectValue placeholder="Фільтр за турніром" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Всі турніри</SelectItem>
                  {billingTournamentsList.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      {t.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" className="h-9 rounded-xl" onClick={fetchBilling} disabled={isLoadingBilling}>
                Оновити
              </Button>
            </div>
          </div>

          {isLoadingBilling && unpaidRegistrations.length === 0 ? (
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
                const subtotal = getSubtotalFor(tournamentRegs);
                const serviceFee = getServiceFeeFor(tournamentRegs);
                const grandTotal = getGrandTotalFor(tournamentRegs);

                return (
                  <div key={tid} className="p-6 border border-border bg-card/10 rounded-2xl space-y-4 shadow-sm">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border/20 pb-4">
                      <div>
                        <h3 className="font-bold text-lg">{tournamentTitle}</h3>
                        <p className="text-xs text-muted-foreground">Неоплачені заявки на цей турнір та комісія платіжного шлюзу.</p>
                      </div>
                      {group.onlinePaymentEnabled ? (
                        <Button variant="sport" onClick={() => setShowPayModal({ id: tid, title: tournamentTitle } as any)}>
                          <CreditCard className="w-4 h-4 mr-1.5" /> Сплатити онлайн
                        </Button>
                      ) : (
                        <div className="px-3 py-1.5 rounded-xl border border-amber-500/20 bg-amber-500/5 text-amber-500 text-xs font-semibold flex items-center gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 animate-pulse text-amber-500" /> Онлайн-оплату вимкнено
                        </div>
                      )}
                    </div>

                    {group.paymentDetails && (
                      <div className="p-4 border border-border/30 bg-muted/5 rounded-xl space-y-1 text-xs">
                        <div className="font-semibold text-muted-foreground flex items-center gap-1">
                          <Info className="w-3.5 h-3.5 text-amber-500" /> Реквізити для оплати (IBAN / опис):
                        </div>
                        <div className="text-muted-foreground whitespace-pre-wrap pl-4.5 mt-1">{group.paymentDetails}</div>
                      </div>
                    )}

                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Спортсмен</TableHead>
                          <TableHead>Категорія</TableHead>
                          <TableHead className="text-right">Сума внеску</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {tournamentRegs.map((reg) => (
                          <TableRow key={reg.id}>
                            <TableCell className="font-semibold">{formatRegistrationName(reg)}</TableCell>
                            <TableCell className="text-muted-foreground text-sm">{reg.category_name}</TableCell>
                            <TableCell className="text-right font-mono font-bold">{reg.fee || 500} UAH</TableCell>
                          </TableRow>
                        ))}
                        {/* Subtotal calculations */}
                        <TableRow className="bg-muted/10 font-semibold">
                          <TableCell colSpan={2} className="text-right">Сума внесків:</TableCell>
                          <TableCell className="text-right font-mono">{subtotal} UAH</TableCell>
                        </TableRow>
                        <TableRow className="bg-muted/10 font-semibold">
                          <TableCell colSpan={2} className="text-right">Комісія сервісу (5%):</TableCell>
                          <TableCell className="text-right font-mono">{serviceFee.toFixed(0)} UAH</TableCell>
                        </TableRow>
                        <TableRow className="bg-amber-500/10 font-bold text-amber-500 text-base">
                          <TableCell colSpan={2} className="text-right">Разом до сплати:</TableCell>
                          <TableCell className="text-right font-mono">{grandTotal.toFixed(0)} UAH</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                );
              })}
            </div>
          )}

          {/* Діалог симуляції Stripe / LiqPay */}
          <Dialog open={!!showPayModal} onOpenChange={() => setShowPayModal(null)}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <CreditCard className="w-5 h-5 text-amber-500" /> Симуляція платіжного шлюзу (Stripe / LiqPay)
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="p-4 border border-amber-500/20 bg-amber-500/5 text-amber-500 text-xs rounded-lg flex items-start gap-2">
                  <Info className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold">Тестовий платіж (TODO заглушка)</p>
                    <p className="mt-1 leading-relaxed">
                      Ви сплачуєте внески за участь у турнірі <strong>{showPayModal?.title}</strong>.
                      Оплата здійснюється в симуляційному режимі. Жодні реальні кошти з вашої картки списані не будуть.
                    </p>
                  </div>
                </div>

                <div className="p-4 bg-muted/20 border border-border rounded-xl space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Турнір:</span>
                    <span className="font-medium text-right max-w-[240px] truncate">{showPayModal?.title}</span>
                  </div>
                  <div className="flex justify-between font-semibold border-t border-border/40 pt-2 text-base text-amber-500">
                    <span>Сума до сплати:</span>
                    <span>{showPayModal ? getGrandTotalFor(unpaidRegistrations.filter(r => r.tournament_id === showPayModal.id)).toFixed(0) : 0} UAH</span>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowPayModal(null)}>Скасувати</Button>
                <Button variant="sport" onClick={handleSimulatePayment} disabled={isPayingInvoice}>
                  {isPayingInvoice ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : null}
                  Підтвердити оплату
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
                onChange={(e) => setActiveSearch(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap items-center gap-4 w-full md:w-auto shrink-0 justify-end">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground whitespace-nowrap">Турнір:</span>
                <Select value={activeTournamentFilter} onValueChange={setActiveTournamentFilter}>
                  <SelectTrigger className="w-[180px] h-9 rounded-xl text-xs">
                    <SelectValue placeholder="Всі турніри" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Всі турніри</SelectItem>
                    {activeTournamentsList.map((t) => (
                      <SelectItem key={t.id} value={String(t.id)}>
                        {t.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground whitespace-nowrap">Сортувати за:</span>
                <Select value={activeSort} onValueChange={setActiveSort}>
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
                            : "bg-amber-500/10 text-amber-500 border-amber-500/20"
                        )}>
                          {reg.status === "confirmed" ? "Зважено (OK)" : "Очікує зважування"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className={cn(
                          "px-2.5 py-0.5 rounded-full text-xs font-semibold border",
                          reg.payment_status === "paid"
                            ? "bg-green-500/10 text-green-500 border-green-500/20"
                            : "bg-red-500/10 text-red-500 border-red-500/20"
                        )}>
                          {reg.payment_status === "paid" ? "Сплачено" : "Не сплачено"}
                        </span>
                      </TableCell>
                      <TableCell className="text-right flex items-center justify-end gap-1.5">
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
                          disabled={withdrawingRegId === reg.id}
                          onClick={() => handleWithdrawRegistration(reg.id)}
                          className="text-destructive hover:text-destructive hover:bg-destructive/10 text-xs h-8 font-semibold"
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
                onChange={(e) => setLiveSearch(e.target.value)}
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

            <div className="space-y-1.5 p-3 border border-border rounded-lg bg-muted/20">
              <Label>Фото профілю</Label>
              <Input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const files = e.target.files;
                  if (files && files.length > 0) {
                    setSelectedFile(files[0]);
                  }
                }}
              />
              {(selectedFile || editingAthlete?.photo) && (
                <div className="flex items-center gap-3 mt-3">
                  <div className="w-12 h-12 rounded-full overflow-hidden border border-border bg-muted">
                    <img
                      src={selectedFile ? URL.createObjectURL(selectedFile) : editingAthlete?.photo ?? ""}
                      alt="Preview"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {selectedFile ? "Нове фото обрано" : "Поточне фото профілю"}
                  </span>
                </div>
              )}
            </div>

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
                                  : "bg-amber-500/10 text-amber-500 border-amber-500/20"
                              )}>
                                {reg.status === "confirmed" ? "Зважено" : "Очікує зважування"}
                              </span>
                              <span className={cn(
                                "px-2 py-0.5 rounded-full text-[10px] font-semibold border shrink-0",
                                reg.payment_status === "paid"
                                  ? "bg-green-500/10 text-green-500 border-green-500/20"
                                  : "bg-red-500/10 text-red-500 border-red-500/20"
                              )}>
                                {reg.payment_status === "paid" ? "Сплачено" : "Борг"}
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
