/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState, useMemo } from "react";
import { useParams, Link, useSearchParams } from "react-router-dom";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  ArrowLeft, Plus, Loader2, Play, CheckCircle2, ClipboardList, GitBranch, Search
} from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import api from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useTournamentSocket } from "@/hooks/useTournamentSocket";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { StatusBadge } from "@/components/tournament/StatusBadge";
import { CategoryCard } from "@/components/tournament/CategoryCard";
import type { Tournament, Category, PaginatedResponse, RulesetInfo, Tatami, Match } from "@/types/api";
import { formatSportType, cn } from "@/lib/utils";
import { estimateSchedule } from "@/lib/scheduler";

const categorySchema = z.object({
  name:                   z.string().min(2, "Введіть назву"),
  allowed_gender:         z.enum(["male", "female", "mixed"]),
  min_age:                z.coerce.number().min(5).max(100),
  max_age:                z.coerce.number().min(5).max(100),
  min_weight:             z.string().optional().transform(v => v === "" || v === undefined || v === null ? null : Number(v)),
  max_weight:             z.string().optional().transform(v => v === "" || v === undefined || v === null ? null : Number(v)),
  ruleset_key:            z.string().min(1, "Оберіть правила"),
  match_duration_seconds: z.string().optional().transform(v => v === "" || v === undefined ? undefined : Number(v)),
  allowed_skill_level:    z.string().optional(),
  two_third_places:       z.boolean().default(true),
  is_team:                z.boolean().default(false),
  team_size:              z.coerce.number().min(2).max(10).default(3),
  registration_fee:       z.string().optional().transform(v => v === "" || v === undefined || v === null ? null : Number(v)),
}).refine((data) => {
  if (data.min_weight !== null && data.max_weight !== null) {
    return data.max_weight > data.min_weight;
  }
  return true;
}, {
  message: "Максимальна вага має бути більшою за мінімальну вагу",
  path: ["max_weight"]
});
type CategoryForm = z.infer<typeof categorySchema>;

const editTournamentSchema = z.object({
  title:                      z.string().min(3, "Мінімум 3 символи"),
  sport_type:                 z.string().min(2, "Введіть вид спорту"),
  location:                   z.string().min(2, "Введіть місце проведення"),
  start_date:                 z.string().min(1, "Оберіть дату початку"),
  end_date:                   z.string().min(1, "Оберіть дату кінця"),
  registration_start:         z.string().optional().nullable(),
  registration_end:           z.string().optional().nullable(),
  weigh_in_required:          z.boolean(),
  online_payment_enabled:     z.boolean().default(true),
  payment_details:            z.string().optional().default(""),
  base_registration_fee:      z.coerce.number().min(0).default(500),
  base_team_registration_fee: z.union([z.coerce.number().min(0), z.literal("")]).optional().nullable(),
  commission_payer:           z.enum(["buyer", "organizer"]).default("buyer"),
  staff_members:              z.array(z.number()).default([]),
  ruleset_prices:             z.record(z.coerce.number()).default({}),
  ruleset_team_prices:        z.record(z.coerce.number()).default({}),
}).refine((data) => {
  const start = new Date(data.start_date).getTime();
  const end = new Date(data.end_date).getTime();
  return end > start;
}, {
  message: "Дата кінця має бути пізнішою за дату початку",
  path: ["end_date"]
}).refine((data) => {
  if (data.registration_start && data.registration_end) {
    const regStart = new Date(data.registration_start).getTime();
    const regEnd = new Date(data.registration_end).getTime();
    return regEnd > regStart;
  }
  return true;
}, {
  message: "Кінець реєстрації має бути пізнішим за початок реєстрації",
  path: ["registration_end"]
});
type EditTournamentForm = z.infer<typeof editTournamentSchema>;

const formatLocalDateTime = (dateStr: string | null) => {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hh}:${mm}`;
};

interface RegistrationStatusInfo {
  status: "opened" | "not_started" | "closed";
  label: string;
}

const getRegistrationStatus = (tournament: Tournament): RegistrationStatusInfo => {
  if (!tournament.registration_start && !tournament.registration_end) {
    return { status: "opened", label: "Реєстрація відкрита (без обмежень)" };
  }
  const now = new Date().getTime();
  const start = tournament.registration_start ? new Date(tournament.registration_start).getTime() : null;
  const end = tournament.registration_end ? new Date(tournament.registration_end).getTime() : null;

  if (start && now < start) {
    return { status: "not_started", label: `Реєстрація не розпочалась (відкриється ${new Date(start).toLocaleString("uk-UA")})` };
  }
  if (end && now > end) {
    return { status: "closed", label: `Реєстрація закрита (завершилась ${new Date(end).toLocaleString("uk-UA")})` };
  }
  return { status: "opened", label: "Реєстрація відкрита" };
};

const getRegInfoClass = (status: "opened" | "not_started" | "closed") => {
  if (status === "opened") {
    return "bg-green-500/10 text-green-400 border border-green-500/20";
  }
  if (status === "not_started") {
    return "bg-yellow-500/10 text-yellow-400 border border-yellow-500/20";
  }
  return "bg-red-500/10 text-red-400 border border-red-500/20";
};

export default function TournamentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { isOrganizer, user } = useAuth();
  const isCoach = user?.role === "coach";

  const [searchParams, setSearchParams] = useSearchParams();
  const catSearch = searchParams.get("catSearch") ?? "";
  const catSort = searchParams.get("catSort") ?? "name-asc";
  const catView = (searchParams.get("catView") as "cards" | "list") ?? "cards";
  const catGroupBy = (searchParams.get("catGroupBy") as "none" | "tatami") ?? "none";
  const expandedTatamisParam = searchParams.get("expandedTatamis");

  const expandedTatamis = useMemo(() => {
    if (expandedTatamisParam === null) {
      return null;
    }
    return new Set(expandedTatamisParam.split(",").filter(Boolean));
  }, [expandedTatamisParam]);

  const isTatamiExpanded = (tatamiId: string) => {
    if (expandedTatamis === null) return true;
    return expandedTatamis.has(tatamiId);
  };

  const updateSearchParams = (updater: (params: URLSearchParams) => void) => {
    const nextParams = new URLSearchParams(searchParams);
    updater(nextParams);
    setSearchParams(nextParams, { replace: true });
  };

  const handleSetCatSearch = (val: string) => {
    updateSearchParams((params) => {
      if (val) {
        params.set("catSearch", val);
      } else {
        params.delete("catSearch");
      }
    });
  };

  const handleSetCatSort = (val: string) => {
    updateSearchParams((params) => {
      params.set("catSort", val);
    });
  };

  const handleSetCatView = (val: "cards" | "list") => {
    updateSearchParams((params) => {
      params.set("catView", val);
    });
  };

  const handleSetCatGroupBy = (val: "none" | "tatami") => {
    updateSearchParams((params) => {
      params.set("catGroupBy", val);
    });
  };

  const toggleTatamiExpand = (tatamiId: string, allTatamiIds: string[]) => {
    const currentExpanded = expandedTatamis !== null
      ? new Set(expandedTatamis)
      : new Set(allTatamiIds);

    if (currentExpanded.has(tatamiId)) {
      currentExpanded.delete(tatamiId);
    } else {
      currentExpanded.add(tatamiId);
    }
    updateSearchParams((params) => {
      params.set("expandedTatamis", Array.from(currentExpanded).join(","));
    });
  };

  const getRulesetName = (key: string) => {
    return rulesets.find((r) => r.key === key)?.name ?? key;
  };

  const resolveCategoryTatami = (cId: number) => {
    const match = matches.find((m) => m.category === cId);
    return match?.tatami;
  };

  const getTatamiGroupName = (key: string) => {
    if (key === "unassigned") return "Не призначено до татамі";
    const tatami = tatamis.find((t) => String(t.id) === key);
    return tatami ? `Татамі №${tatami.number} ${tatami.name ? `(${tatami.name})` : ""}` : `Татамі ID ${key}`;
  };

  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [tatamis, setTatamis] = useState<Tatami[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [catDialogOpen, setCatDialogOpen] = useState(false);
  const [isCreatingCat, setIsCreatingCat] = useState(false);
  const [catGender, setCatGender] = useState<"male" | "female" | "mixed">("male");

  const [rulesets, setRulesets] = useState<RulesetInfo[]>([]);

  const filteredCategories = useMemo(() => {
    const query = catSearch.trim().toLowerCase();
    if (!query) return categories;
    return categories.filter((c) => c.name.toLowerCase().includes(query));
  }, [categories, catSearch]);

  const sortedCategories = useMemo(() => {
    const list = [...filteredCategories];
    if (catSort === "name-asc") {
      list.sort((a, b) => a.name.localeCompare(b.name, "uk-UA"));
    } else if (catSort === "name-desc") {
      list.sort((a, b) => b.name.localeCompare(a.name, "uk-UA"));
    } else if (catSort === "age-asc") {
      list.sort((a, b) => (a.min_age ?? 0) - (b.min_age ?? 0));
    } else if (catSort === "participants-desc") {
      list.sort((a, b) => (b.confirmed_registrations_count ?? 0) - (a.confirmed_registrations_count ?? 0));
    }
    return list;
  }, [filteredCategories, catSort]);

  const groupedCategories = useMemo(() => {
    if (catGroupBy !== "tatami") return null;

    const groups: Record<string, Category[]> = {};
    tatamis.forEach((t) => {
      groups[String(t.id)] = [];
    });
    groups["unassigned"] = [];

    sortedCategories.forEach((c) => {
      const tatamiId = resolveCategoryTatami(c.id);
      const key = tatamiId ? String(tatamiId) : "unassigned";
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(c);
    });

    return groups;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedCategories, catGroupBy, tatamis, matches]);

  const activeGroupKeys = useMemo(() => {
    if (!groupedCategories) return [];
    return Object.keys(groupedCategories).filter((key) => groupedCategories[key].length > 0);
  }, [groupedCategories]);
  const [selectedRuleset, setSelectedRuleset] = useState<RulesetInfo | null>(null);
  const [staffSearch, setStaffSearch] = useState("");
  const [assignedStaffList, setAssignedStaffList] = useState<any[]>([]);
  const [staffSearchResults, setStaffSearchResults] = useState<any[]>([]);
  const [searchingStaff, setSearchingStaff] = useState(false);


  useEffect(() => {
    if (!staffSearch.trim()) {
      setStaffSearchResults([]);
      return;
    }
    const delayDebounce = setTimeout(async () => {
      setSearchingStaff(true);
      try {
        const res = await api.get(`/auth/users/?role=staff&search=${encodeURIComponent(staffSearch)}`);
        const list = Array.isArray(res.data) ? res.data : (res.data as any).results || [];
        setStaffSearchResults(list);
      } catch (e) {
        console.error(e);
      } finally {
        setSearchingStaff(false);
      }
    }, 300);

    return () => clearTimeout(delayDebounce);
  }, [staffSearch]);

  // Edit / Delete tournament states
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [generatingAllBrackets, setGeneratingAllBrackets] = useState(false);
  const [distributingTatamis, setDistributingTatamis] = useState(false);
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [rrMin, setRrMin] = useState(2);
  const [rrMax, setRrMax] = useState(5);
  const [seMin, setSeMin] = useState(6);
  const [seMax, setSeMax] = useState(32);
  const [bulkGenMode, setBulkGenMode] = useState<"threshold" | "custom">("threshold");
  const [thresholdVal, setThresholdVal] = useState(5);

  // Bulk import categories states
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [isImporting, setIsImporting] = useState(false);

  const editTournamentForm = useForm<EditTournamentForm>({
    resolver: zodResolver(editTournamentSchema),
  });

  const { register, handleSubmit, setValue, watch, reset, formState: { errors } } = useForm<CategoryForm>({
    resolver: zodResolver(categorySchema),
    defaultValues: {
      allowed_gender: "male",
      ruleset_key: "karate_wkf",
      two_third_places: true,
      is_team: false,
      team_size: 3,
    },
  });

  const handleOpenEditDialog = async () => {
    if (!tournament) return;
    setAssignedStaffList([]);
    setStaffSearch("");
    setStaffSearchResults([]);

    const staffIds = tournament.staff_members || [];
    if (staffIds.length > 0) {
      try {
        const res = await api.get(`/auth/users/?ids=${staffIds.join(",")}`);
        const list = Array.isArray(res.data) ? res.data : (res.data as any).results || [];
        setAssignedStaffList(list);
      } catch (e) {
        console.error("Failed to fetch assigned staff profiles", e);
      }
    }

    editTournamentForm.reset({
      title: tournament.title,
      sport_type: tournament.sport_type,
      location: tournament.location,
      start_date: formatLocalDateTime(tournament.start_date),
      end_date: formatLocalDateTime(tournament.end_date),
      registration_start: formatLocalDateTime(tournament.registration_start),
      registration_end: formatLocalDateTime(tournament.registration_end),
      weigh_in_required: tournament.weigh_in_required,
      online_payment_enabled: tournament.online_payment_enabled ?? true,
      payment_details: tournament.payment_details || "",
      base_registration_fee: tournament.base_registration_fee ?? 500,
      base_team_registration_fee: tournament.base_team_registration_fee ?? "",
      commission_payer: tournament.commission_payer || "buyer",
      staff_members: tournament.staff_members || [],
      ruleset_prices: tournament.ruleset_prices || {},
      ruleset_team_prices: tournament.ruleset_team_prices || {},
    });
    setEditDialogOpen(true);
  };

  const onEditTournamentSubmit = async (data: EditTournamentForm) => {
    setIsEditing(true);
    try {
      const cleanedPrices: Record<string, number> = {};
      if (data.ruleset_prices) {
        Object.entries(data.ruleset_prices).forEach(([key, val]) => {
          const num = Number(val);
          if (!isNaN(num) && num > 0) {
            cleanedPrices[key] = num;
          }
        });
      }
      const cleanedTeamPrices: Record<string, number> = {};
      if (data.ruleset_team_prices) {
        Object.entries(data.ruleset_team_prices).forEach(([key, val]) => {
          const num = Number(val);
          if (!isNaN(num) && num > 0) {
            cleanedTeamPrices[key] = num;
          }
        });
      }

      const payload = {
        ...data,
        registration_start: data.registration_start || null,
        registration_end: data.registration_end || null,
        ruleset_prices: cleanedPrices,
        ruleset_team_prices: cleanedTeamPrices,
        base_team_registration_fee: (data.base_team_registration_fee === "" || data.base_team_registration_fee === null || data.base_team_registration_fee === undefined)
          ? null
          : Number(data.base_team_registration_fee),
      };

      const res = await api.put<Tournament>(`/tournaments/${id}/`, payload);
      setTournament(res.data);
      toast({ title: "Турнір успішно оновлено!" });
      setEditDialogOpen(false);
    } catch {
      toast({ title: "Помилка оновлення турніру", variant: "destructive" });
    } finally {
      setIsEditing(false);
    }
  };

  const onDeleteTournament = async () => {
    setIsDeleting(true);
    try {
      await api.delete(`/tournaments/${id}/`);
      toast({ title: "Турнір успішно видалено!" });
      setDeleteDialogOpen(false);
      globalThis.window.location.href = "/tournaments";
    } catch {
      toast({ title: "Помилка видалення турніру", variant: "destructive" });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleAutoDistributeTatamis = async () => {
    setDistributingTatamis(true);
    try {
      const res = await api.post<{ detail: string }>(`/tournaments/${id}/auto_distribute_tatamis/`);
      toast({ title: "Розподіл завершено!", description: res.data.detail });
      fetchAll();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Помилка розподілу по татамі";
      toast({ title: msg, variant: "destructive" });
    } finally {
      setDistributingTatamis(false);
    }
  };

  const handleGenerateAllBracketsWithThresholds = async () => {
    setGeneratingAllBrackets(true);
    const payload = bulkGenMode === "threshold"
      ? {
          round_robin_min: 2,
          round_robin_max: thresholdVal,
          single_elimination_min: thresholdVal + 1,
          single_elimination_max: 64,
        }
      : {
          round_robin_min: rrMin,
          round_robin_max: rrMax,
          single_elimination_min: seMin,
          single_elimination_max: seMax,
        };
    try {
      const res = await api.post<{ detail: string }>(`/tournaments/${id}/generate_all_brackets/`, payload);
      toast({ title: "Генерація завершена!", description: res.data.detail });
      setBulkDialogOpen(false);
      fetchAll();
    } catch {
      toast({ title: "Помилка генерації сіток", variant: "destructive" });
    } finally {
      setGeneratingAllBrackets(false);
    }
  };

  const watchRulesetKey = watch("ruleset_key");

  // Завантаження рулсетів
  const fetchRulesets = async () => {
    try {
      const { data } = await api.get<RulesetInfo[]>("/rulesets/");
      setRulesets(data);
      if (data.length > 0) {
        const filtered = data.filter(r => r.sport_type === tournament?.sport_type);
        const defaultRuleset = filtered.length > 0 ? filtered[0] : data[0];
        setValue("ruleset_key", defaultRuleset.key);
        setSelectedRuleset(defaultRuleset);
      }
    } catch {
      // ігноруємо помилки
    }
  };

  useEffect(() => {
    if (catDialogOpen || editDialogOpen) {
      fetchRulesets();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catDialogOpen, editDialogOpen]);

  const fetchAll = async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      const [tRes, cRes, tatamiRes, matchRes] = await Promise.all([
        api.get<Tournament>(`/tournaments/${id}/`),
        api.get<PaginatedResponse<Category> | Category[]>(`/categories/?tournament=${id}`),
        api.get<Tatami[] | { results: Tatami[] }>(`/tatamis/?tournament=${id}`),
        api.get<Match[] | { results: Match[] }>(`/matches/?tournament=${id}`),
      ]);
      setTournament(tRes.data);
      setCategories(Array.isArray(cRes.data) ? cRes.data : cRes.data.results);
      setTatamis(Array.isArray(tatamiRes.data) ? tatamiRes.data : (tatamiRes.data as { results: Tatami[] }).results || []);
      setMatches(Array.isArray(matchRes.data) ? matchRes.data : (matchRes.data as { results: Match[] }).results || []);
    } finally {
      if (!silent) setIsLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchAll(); }, [id]);

  // Підписка на живі оновлення реєстрацій турніру
  useTournamentSocket(Number(id), () => {
    fetchAll(true);
  });

  // Зміна статусу турніру
  const handleAction = async (action: "open_registration" | "start" | "complete") => {
    setActionLoading(action);
    try {
      await api.post(`/tournaments/${id}/${action}/`);
      const labels = { open_registration: "Реєстрацію відкрито", start: "Турнір розпочато", complete: "Турнір завершено" };
      toast({ title: labels[action] });
      fetchAll();
    } finally {
      setActionLoading(null);
    }
  };

  // Створення категорії
  const onCreateCategory = async (data: CategoryForm) => {
    setIsCreatingCat(true);
    try {
      await api.post("/categories/", { ...data, tournament: Number(id) });
      toast({ title: "Категорію створено!" });
      setCatDialogOpen(false);
      reset();
      fetchAll();
    } finally {
      setIsCreatingCat(false);
    }
  };

  if (isLoading) {
    return (
      <div className="container py-8 flex justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
      </div>
    );
  }

  if (!tournament) return null;

  const canOpenReg  = tournament.status === "draft";
  const canStart    = tournament.status === "registration";
  const canComplete = tournament.status === "active";

  const regInfo = getRegistrationStatus(tournament);

  const isRegClosed = tournament.status === "registration" &&
    tournament.registration_end &&
    new Date() > new Date(tournament.registration_end);

  const displayStatus = isRegClosed ? "registration_closed" : tournament.status;

  return (
    <div className="container py-8 space-y-6">
      {/* Назад */}
      <Link to="/tournaments" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="w-4 h-4" /> Всі турніри
      </Link>

      {/* Заголовок */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h1 className="font-display text-4xl font-bold tracking-tight">{tournament.title}</h1>
            <StatusBadge status={displayStatus} type="tournament" />
          </div>
          <p className="text-muted-foreground text-sm">
            {tournament.location} · {new Date(tournament.start_date).toLocaleDateString("uk-UA")} — {new Date(tournament.end_date).toLocaleDateString("uk-UA")}
          </p>
          {tournament.sport_type && (
            <p className="text-sm text-muted-foreground/80 max-w-2xl">{formatSportType(tournament.sport_type)}</p>
          )}
          {isOrganizer || isCoach ? (
            <div className={cn("mt-2 inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold", getRegInfoClass(regInfo.status))}>
              {regInfo.label}
            </div>
          ) : null}
        </div>

        {/* Кнопки дій */}
        <div className="flex flex-wrap gap-2">
          {tournament.status !== "draft" && (
            <Button
              variant="outline"
              size="sm"
              asChild
              className="border-green-500/30 text-green-500 hover:bg-green-500/5 hover:text-green-400 relative"
            >
              <Link to={`/tournaments/${id}/day`} className="flex items-center gap-1.5 font-semibold">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse shrink-0" />
                Live-табло татамі
              </Link>
            </Button>
          )}

          {isOrganizer && (
            <>
              {canOpenReg && (
                <Button
                  variant="outline" size="sm"
                  disabled={actionLoading === "open_registration"}
                  onClick={() => handleAction("open_registration")}
                >
                  {actionLoading === "open_registration" ? <Loader2 className="w-4 h-4 animate-spin" /> : <ClipboardList className="w-4 h-4" />}
                  Відкрити реєстрацію
                </Button>
              )}
              {canStart && (
                <Button
                  variant="sport" size="sm"
                  disabled={actionLoading === "start"}
                  onClick={() => handleAction("start")}
                >
                  {actionLoading === "start" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                  Розпочати
                </Button>
              )}
              {canComplete && (
                <Button
                  variant="outline" size="sm"
                  disabled={actionLoading === "complete"}
                  onClick={() => handleAction("complete")}
                >
                  {actionLoading === "complete" ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  Завершити
                </Button>
              )}
              <Button variant="outline" size="sm" asChild>
                <Link to={`/tournaments/${id}/tatamis`}>Керування татамі</Link>
              </Button>
              {tournament.status === "active" && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleAutoDistributeTatamis}
                  disabled={distributingTatamis}
                >
                  {distributingTatamis ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                  Авто-розподіл по татамі
                </Button>
              )}
              {tournament.status !== "completed" && categories.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setBulkDialogOpen(true)}
                  disabled={generatingAllBrackets}
                >
                  Згенерувати всі сітки
                </Button>
              )}
              {tournament.status !== "completed" && (
                <>
                  <Button variant="outline" size="sm" onClick={handleOpenEditDialog}>
                    Редагувати
                  </Button>
                  <Button variant="destructive" size="sm" onClick={() => setDeleteDialogOpen(true)}>
                    Вилучити турнір
                  </Button>
                </>
              )}
            </>
          )}
        </div>
      </div>

      <Separator />

      {/* Категорії */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-2xl font-semibold">
            Категорії
            <span className="ml-2 text-base font-normal text-muted-foreground">({categories.length})</span>
          </h2>
          {isOrganizer && tournament?.status !== "completed" && (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setImportDialogOpen(true)}>
                Імпорт категорій
              </Button>
              <Button variant="outline" size="sm" onClick={() => setCatDialogOpen(true)}>
                <Plus className="w-4 h-4" /> Додати категорію
              </Button>
            </div>
          )}
        </div>

        {categories.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3 text-center border border-dashed border-border rounded-xl">
            <GitBranch className="w-8 h-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Категорій поки немає</p>
            {isOrganizer && tournament?.status !== "completed" && (
              <Button variant="outline" size="sm" onClick={() => setCatDialogOpen(true)}>
                <Plus className="w-4 h-4" /> Додати першу категорію
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {/* Панель керування категоріями */}
            <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl border border-border/80 bg-zinc-900/50 backdrop-blur-md">
              <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
                {/* Пошук */}
                <div className="relative w-full md:w-64">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Пошук категорій..."
                    value={catSearch}
                    onChange={(e) => handleSetCatSearch(e.target.value)}
                    className="pl-9 h-9 bg-zinc-950 border-zinc-800 text-zinc-100 placeholder:text-zinc-500 focus-visible:ring-amber-500/50"
                  />
                </div>

                {/* Сортування */}
                <Select value={catSort} onValueChange={handleSetCatSort}>
                  <SelectTrigger className="h-9 w-48 bg-zinc-950 border-zinc-800 text-zinc-100 focus:ring-amber-500/50">
                    <SelectValue placeholder="Сортувати за" />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-950 border-zinc-800 text-zinc-200">
                    <SelectItem value="name-asc" className="hover:bg-zinc-900 focus:bg-zinc-900 focus:text-zinc-100 cursor-pointer">Алфавіт (А-Я)</SelectItem>
                    <SelectItem value="name-desc" className="hover:bg-zinc-900 focus:bg-zinc-900 focus:text-zinc-100 cursor-pointer">Алфавіт (Я-А)</SelectItem>
                    <SelectItem value="age-asc" className="hover:bg-zinc-900 focus:bg-zinc-900 focus:text-zinc-100 cursor-pointer">Вік (від меншого)</SelectItem>
                    <SelectItem value="participants-desc" className="hover:bg-zinc-900 focus:bg-zinc-900 focus:text-zinc-100 cursor-pointer">Кількість учасників</SelectItem>
                  </SelectContent>
                </Select>

                {/* Групування за татамі */}
                <div className="flex items-center gap-2 border border-zinc-800 rounded-lg px-3 h-9 bg-zinc-950/50 text-sm">
                  <label htmlFor="groupByTatami" className="text-zinc-300 font-medium cursor-pointer select-none">Групувати по татамі:</label>
                  <input
                    id="groupByTatami"
                    type="checkbox"
                    checked={catGroupBy === "tatami"}
                    onChange={(e) => handleSetCatGroupBy(e.target.checked ? "tatami" : "none")}
                    className="w-4 h-4 rounded border-zinc-800 bg-zinc-950 text-amber-500 focus:ring-amber-500 focus:ring-offset-0 cursor-pointer accent-amber-500"
                  />
                </div>
              </div>

              {/* Вигляд: Картки / Список */}
              <div className="flex items-center border border-zinc-800 rounded-lg p-0.5 bg-zinc-950">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleSetCatView("cards")}
                  className={cn(
                    "h-7 px-3 text-xs font-semibold rounded-md transition-all",
                    catView === "cards"
                      ? "bg-zinc-800 text-zinc-100 shadow-sm"
                      : "text-zinc-400 hover:text-zinc-200"
                  )}
                >
                  Картки
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleSetCatView("list")}
                  className={cn(
                    "h-7 px-3 text-xs font-semibold rounded-md transition-all",
                    catView === "list"
                      ? "bg-zinc-800 text-zinc-100 shadow-sm"
                      : "text-zinc-400 hover:text-zinc-200"
                  )}
                >
                  Список
                </Button>
              </div>
            </div>

            {sortedCategories.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3 text-center border border-dashed border-border rounded-xl">
                <p className="text-sm text-muted-foreground">Категорій не знайдено за вашим запитом</p>
              </div>
            ) : catGroupBy === "tatami" ? (
              <div className="space-y-4">
                {activeGroupKeys.map((key) => {
                  const catsInGroup = groupedCategories![key];
                  const isExpanded = isTatamiExpanded(key);
                  const groupName = getTatamiGroupName(key);

                  return (
                    <div key={key} className="border border-zinc-800 rounded-xl overflow-hidden bg-zinc-900/10 backdrop-blur-md">
                      {/* Заголовок секції */}
                      <button
                        onClick={() => toggleTatamiExpand(key, activeGroupKeys)}
                        className="flex items-center justify-between w-full p-4 bg-zinc-900/30 hover:bg-zinc-900/50 transition-colors text-left border-b border-zinc-850"
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-base font-bold text-zinc-200">{groupName}</span>
                          <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-amber-500/15 text-amber-500 border border-amber-500/20">
                            Категорій: {catsInGroup.length}
                          </span>
                        </div>
                        <div className="text-zinc-400 hover:text-zinc-200 transition-colors">
                          {isExpanded ? (
                            <span className="text-xs font-semibold flex items-center gap-1">Згорнути ▲</span>
                          ) : (
                            <span className="text-xs font-semibold flex items-center gap-1">Розгорнути ▼</span>
                          )}
                        </div>
                      </button>

                      {/* Контент секції */}
                      {isExpanded && (
                        <div className="p-4">
                          {catView === "cards" ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                              {(() => {
                                const { categoryEstimates } = estimateSchedule(tatamis, matches, catsInGroup);
                                return catsInGroup.map((c) => (
                                  <CategoryCard key={c.id} category={c} estimate={categoryEstimates[c.id]} />
                                ));
                              })()}
                            </div>
                          ) : (
                            <div className="rounded-xl border border-zinc-800 bg-zinc-950/20 overflow-hidden backdrop-blur-md">
                              <Table>
                                <TableHeader className="bg-zinc-950/50">
                                  <TableRow className="border-b border-zinc-800 hover:bg-transparent">
                                    <TableHead className="text-zinc-400">Назва</TableHead>
                                    <TableHead className="text-zinc-400">Вікова група</TableHead>
                                    <TableHead className="text-zinc-400">Вага</TableHead>
                                    <TableHead className="text-zinc-400">Правила</TableHead>
                                    <TableHead className="text-center text-zinc-400">Учасники</TableHead>
                                    <TableHead className="text-center text-zinc-400">Статус</TableHead>
                                    <TableHead className="text-right text-zinc-400">Дія</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {catsInGroup.map((c) => {
                                    let weightStr = "без обмежень";
                                    if (c.min_weight !== null && c.max_weight !== null) {
                                      weightStr = `${c.min_weight}–${c.max_weight} кг`;
                                    } else if (c.min_weight !== null) {
                                      weightStr = `від ${c.min_weight} кг`;
                                    } else if (c.max_weight !== null) {
                                      weightStr = `до ${c.max_weight} кг`;
                                    }
                                    return (
                                      <TableRow key={c.id} className="border-b border-zinc-800/60 hover:bg-zinc-900/30">
                                        <TableCell className="font-semibold text-zinc-200">
                                          <Link to={`/categories/${c.id}`} className="hover:text-amber-500 transition-colors flex items-center gap-2">
                                            {c.name}
                                            {c.is_team && (
                                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-500 border border-blue-500/20">
                                                Команда
                                              </span>
                                            )}
                                            {!c.has_bracket && (
                                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-destructive/10 text-destructive border border-destructive/20">
                                                Без сітки
                                              </span>
                                            )}
                                          </Link>
                                        </TableCell>
                                        <TableCell className="text-zinc-300">{c.min_age}–{c.max_age} років</TableCell>
                                        <TableCell className="text-zinc-300">{weightStr}</TableCell>
                                        <TableCell className="text-zinc-300">{getRulesetName(c.ruleset_key)}</TableCell>
                                        <TableCell className="text-center font-semibold text-zinc-300">{c.confirmed_registrations_count}</TableCell>
                                        <TableCell className="text-center">
                                          <StatusBadge status={c.status} type="category" />
                                        </TableCell>
                                        <TableCell className="text-right">
                                          <Button variant="ghost" size="sm" asChild className="h-7 text-xs hover:bg-zinc-800 hover:text-zinc-100">
                                            <Link to={`/categories/${c.id}`}>Деталі</Link>
                                          </Button>
                                        </TableCell>
                                      </TableRow>
                                    );
                                  })}
                                </TableBody>
                              </Table>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : catView === "cards" ? (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {(() => {
                  const { categoryEstimates } = estimateSchedule(tatamis, matches, sortedCategories);
                  return sortedCategories.map((c) => (
                    <CategoryCard key={c.id} category={c} estimate={categoryEstimates[c.id]} />
                  ));
                })()}
              </div>
            ) : (
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/20 overflow-hidden backdrop-blur-md">
                <Table>
                  <TableHeader className="bg-zinc-950/50">
                    <TableRow className="border-b border-zinc-800 hover:bg-transparent">
                      <TableHead className="text-zinc-400">Назва</TableHead>
                      <TableHead className="text-zinc-400">Вікова група</TableHead>
                      <TableHead className="text-zinc-400">Вага</TableHead>
                      <TableHead className="text-zinc-400">Правила</TableHead>
                      <TableHead className="text-center text-zinc-400">Учасники</TableHead>
                      <TableHead className="text-center text-zinc-400">Статус</TableHead>
                      <TableHead className="text-right text-zinc-400">Дія</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedCategories.map((c) => {
                      let weightStr = "без обмежень";
                      if (c.min_weight !== null && c.max_weight !== null) {
                        weightStr = `${c.min_weight}–${c.max_weight} кг`;
                      } else if (c.min_weight !== null) {
                        weightStr = `від ${c.min_weight} кг`;
                      } else if (c.max_weight !== null) {
                        weightStr = `до ${c.max_weight} кг`;
                      }
                      return (
                        <TableRow key={c.id} className="border-b border-zinc-800/60 hover:bg-zinc-900/30">
                          <TableCell className="font-semibold text-zinc-200">
                            <Link to={`/categories/${c.id}`} className="hover:text-amber-500 transition-colors flex items-center gap-2">
                              {c.name}
                              {c.is_team && (
                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-500 border border-blue-500/20">
                                  Команда
                                </span>
                              )}
                              {!c.has_bracket && (
                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-destructive/10 text-destructive border border-destructive/20">
                                  Без сітки
                                </span>
                              )}
                            </Link>
                          </TableCell>
                          <TableCell className="text-zinc-300">{c.min_age}–{c.max_age} років</TableCell>
                          <TableCell className="text-zinc-300">{weightStr}</TableCell>
                          <TableCell className="text-zinc-300">{getRulesetName(c.ruleset_key)}</TableCell>
                          <TableCell className="text-center font-semibold text-zinc-300">{c.confirmed_registrations_count}</TableCell>
                          <TableCell className="text-center">
                            <StatusBadge status={c.status} type="category" />
                          </TableCell>
                          <TableCell className="text-right">
                            <Button variant="ghost" size="sm" asChild className="h-7 text-xs hover:bg-zinc-800 hover:text-zinc-100">
                              <Link to={`/categories/${c.id}`}>Деталі</Link>
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Діалог нової категорії */}
      <Dialog open={catDialogOpen} onOpenChange={setCatDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Нова категорія</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onCreateCategory)} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Назва категорії</Label>
              <Input placeholder="Кадети до 50 кг, чол." {...register("name")} />
              {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Стать</Label>
                <Select value={catGender} onValueChange={(v) => { setCatGender(v as CategoryForm["allowed_gender"]); setValue("allowed_gender", v as CategoryForm["allowed_gender"]); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="male">Чоловіки</SelectItem>
                    <SelectItem value="female">Жінки</SelectItem>
                    <SelectItem value="mixed">Мікст</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Вік від</Label>
                <Input type="number" placeholder="14" {...register("min_age")} />
                {errors.min_age && <p className="text-xs text-destructive">{errors.min_age.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Вік до</Label>
                <Input type="number" placeholder="17" {...register("max_age")} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Вага від (кг) <span className="text-muted-foreground text-xs">(необов'язково)</span></Label>
                <Input type="number" placeholder="45" {...register("min_weight")} />
                {errors.min_weight && <p className="text-xs text-destructive">{errors.min_weight.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Вага до (кг) <span className="text-muted-foreground text-xs">(необов'язково)</span></Label>
                <Input type="number" placeholder="50" {...register("max_weight")} />
                {errors.max_weight && <p className="text-xs text-destructive">{errors.max_weight.message}</p>}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Правила (Рулсет)</Label>
              <Select
                value={watchRulesetKey || ""}
                onValueChange={(v) => {
                  setValue("ruleset_key", v);
                  const r = rulesets.find((item) => item.key === v);
                  setSelectedRuleset(r || null);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Оберіть правила..." />
                </SelectTrigger>
                <SelectContent>
                  {rulesets.filter(r => r.sport_type === tournament.sport_type || !tournament.sport_type).map((r) => (
                    <SelectItem key={r.key} value={r.key}>
                      {r.name} ({formatSportType(r.sport_type)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.ruleset_key && <p className="text-xs text-destructive">{errors.ruleset_key.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>Тривалість поєдинку (сек, опціонально)</Label>
              <Input
                type="number"
                placeholder={
                  selectedRuleset?.default_duration_seconds
                    ? `${selectedRuleset.default_duration_seconds} (за замовчуванням)`
                    : "180"
                }
                {...register("match_duration_seconds")}
              />
              {errors.match_duration_seconds && <p className="text-xs text-destructive">{errors.match_duration_seconds.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>Допустимий рівень майстерності (опціонально)</Label>
              <Input placeholder="напр. Чорний пояс 1 дан" {...register("allowed_skill_level")} />
              {errors.allowed_skill_level && <p className="text-xs text-destructive">{errors.allowed_skill_level.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>Спеціальна вартість за учасника (UAH, опціонально)</Label>
              <Input
                type="number"
                placeholder="перевизначає базову вартість (напр., 400)"
                {...register("registration_fee")}
              />
              {errors.registration_fee && <p className="text-xs text-destructive">{errors.registration_fee.message}</p>}
            </div>

            <div className="flex items-center space-x-2 py-1">
              <input
                type="checkbox"
                id="is_team"
                className="w-4 h-4 rounded border-gray-300 text-amber-500 focus:ring-amber-500"
                {...register("is_team")}
              />
              <Label htmlFor="is_team" className="cursor-pointer">
                Групова (командна) категорія
              </Label>
            </div>

            {watch("is_team") && (
              <div className="space-y-1.5 p-3 rounded-lg border border-slate-800 bg-slate-950/40">
                <Label htmlFor="team_size">Кількість бійців у команді</Label>
                <select
                  id="team_size"
                  className="flex h-10 w-full rounded-md border border-slate-800 bg-slate-950 text-slate-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-500 text-sm px-3 py-2"
                  {...register("team_size")}
                >
                  <option value="3">3 на 3 (Стандарт для юніорів, кадетів, командних ката)</option>
                  <option value="5">5 на 5 (Чоловічі дорослі команди)</option>
                </select>
                <p className="text-[10px] text-slate-500">
                  Визначає кількість індивідуальних поєдинків у межах однієї командної зустрічі.
                </p>
              </div>
            )}

            <div className="flex items-center space-x-2 py-2">
              <input
                type="checkbox"
                id="two_third_places"
                className="w-4 h-4 rounded border-gray-300 text-amber-500 focus:ring-amber-500"
                {...register("two_third_places")}
              />
              <Label htmlFor="two_third_places" className="cursor-pointer">
                Два третіх місця (обидва півфіналісти отримують бронзу)
              </Label>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCatDialogOpen(false)}>Скасувати</Button>
              <Button type="submit" variant="sport" disabled={isCreatingCat}>
                {isCreatingCat ? <Loader2 className="w-4 h-4 animate-spin" /> : "Створити"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Редагувати турнір</DialogTitle>
          </DialogHeader>
          <form onSubmit={editTournamentForm.handleSubmit(onEditTournamentSubmit)} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Назва</Label>
              <Input placeholder="Відкритий чемпіонат" {...editTournamentForm.register("title")} />
              {editTournamentForm.formState.errors.title && (
                <p className="text-xs text-destructive">{editTournamentForm.formState.errors.title.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Вид спорту</Label>
              <Select
                value={editTournamentForm.watch("sport_type") || ""}
                onValueChange={(v) => editTournamentForm.setValue("sport_type", v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Оберіть вид спорту..." />
                </SelectTrigger>
                <SelectContent>
                  {Array.from(new Set(rulesets.map(r => r.sport_type).filter(Boolean))).map((sport: string) => (
                    <SelectItem key={sport} value={sport}>
                      {formatSportType(sport)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {editTournamentForm.formState.errors.sport_type && (
                <p className="text-xs text-destructive">{editTournamentForm.formState.errors.sport_type.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Місце проведення</Label>
              <Input placeholder="Спорткомплекс" {...editTournamentForm.register("location")} />
              {editTournamentForm.formState.errors.location && (
                <p className="text-xs text-destructive">{editTournamentForm.formState.errors.location.message}</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Початок турніру</Label>
                <Input type="datetime-local" {...editTournamentForm.register("start_date")} />
                {editTournamentForm.formState.errors.start_date && (
                  <p className="text-xs text-destructive">{editTournamentForm.formState.errors.start_date.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Кінець турніру</Label>
                <Input type="datetime-local" {...editTournamentForm.register("end_date")} />
                {editTournamentForm.formState.errors.end_date && (
                  <p className="text-xs text-destructive">{editTournamentForm.formState.errors.end_date.message}</p>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Початок реєстрації <span className="text-muted-foreground text-xs">(опціонально)</span></Label>
                <Input type="datetime-local" {...editTournamentForm.register("registration_start")} />
                {editTournamentForm.formState.errors.registration_start && (
                  <p className="text-xs text-destructive">{editTournamentForm.formState.errors.registration_start.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Кінець реєстрації <span className="text-muted-foreground text-xs">(опціонально)</span></Label>
                <Input type="datetime-local" {...editTournamentForm.register("registration_end")} />
                {editTournamentForm.formState.errors.registration_end && (
                  <p className="text-xs text-destructive">{editTournamentForm.formState.errors.registration_end.message}</p>
                )}
              </div>
            </div>

            <div className="flex items-center space-x-2 py-2">
              <input
                type="checkbox"
                id="weigh_in_required"
                className="w-4 h-4 rounded border-gray-300 text-amber-500 focus:ring-amber-500"
                {...editTournamentForm.register("weigh_in_required")}
              />
              <Label htmlFor="weigh_in_required" className="cursor-pointer">
                Потрібне зважування (якщо вимкнено, спортсмени підтверджуються одразу)
              </Label>
            </div>

            {/* Фінансові налаштування */}
            <div className="border-t border-border pt-4 space-y-4">
              <h4 className="text-sm font-semibold text-foreground">Фінансові налаштування</h4>

              <div className="flex items-center space-x-2 py-1">
                <input
                  type="checkbox"
                  id="online_payment_enabled"
                  className="w-4 h-4 rounded border-gray-300 text-amber-500 focus:ring-amber-500"
                  {...editTournamentForm.register("online_payment_enabled")}
                />
                <Label htmlFor="online_payment_enabled" className="cursor-pointer">
                  Увімкнути онлайн-оплату реєстраційних внесків
                </Label>
              </div>

              {editTournamentForm.watch("online_payment_enabled") && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Базова вартість внеску (UAH)</Label>
                      <Input type="number" placeholder="500" {...editTournamentForm.register("base_registration_fee")} />
                      {editTournamentForm.formState.errors.base_registration_fee && (
                        <p className="text-xs text-destructive">{editTournamentForm.formState.errors.base_registration_fee.message}</p>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label>Базова командна вартість внеску (UAH)</Label>
                      <Input type="number" placeholder="400" {...editTournamentForm.register("base_team_registration_fee")} />
                      {editTournamentForm.formState.errors.base_team_registration_fee && (
                        <p className="text-xs text-destructive">{editTournamentForm.formState.errors.base_team_registration_fee.message}</p>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5 col-span-2">
                      <Label>Хост/Платник комісії (5%)</Label>
                      <Select
                        value={editTournamentForm.watch("commission_payer") || "buyer"}
                        onValueChange={(v) => editTournamentForm.setValue("commission_payer", v as "buyer" | "organizer")}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Оберіть платника..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="buyer">Покупець (додається до суми)</SelectItem>
                          <SelectItem value="organizer">Організатор (вираховується з внеску)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label>Реквізити для оплати (IBAN / опис)</Label>
                    <textarea
                      placeholder="Вкажіть реквізити для оплати або додаткові фінансові умови..."
                      className="flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                      {...editTournamentForm.register("payment_details")}
                    />
                    {editTournamentForm.formState.errors.payment_details && (
                      <p className="text-xs text-destructive">{editTournamentForm.formState.errors.payment_details.message}</p>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Ціни за рулсети */}
            {rulesets.filter(r => r.sport_type === editTournamentForm.watch("sport_type")).length > 0 && (
              <div className="border-t border-border pt-4 space-y-3">
                <h4 className="text-sm font-semibold text-foreground">Вартість внесків за правилами (рулсетами)</h4>
                <div className="space-y-3 p-3 bg-muted/40 border border-border/50 rounded-lg">
                  {rulesets.filter(r => r.sport_type === editTournamentForm.watch("sport_type")).map((r) => (
                    <div key={r.key} className="grid grid-cols-2 gap-4 border-b border-border/20 last:border-0 pb-3 last:pb-0">
                      <div className="col-span-2">
                        <Label className="text-xs font-bold text-amber-500">{r.name}</Label>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] text-muted-foreground">Індивідуальна участь (UAH)</Label>
                        <Input
                          type="number"
                          placeholder="Базова ціна"
                          {...editTournamentForm.register(`ruleset_prices.${r.key}`)}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] text-muted-foreground">Командна участь за бійця (UAH)</Label>
                        <Input
                          type="number"
                          placeholder="Не вказано"
                          {...editTournamentForm.register(`ruleset_team_prices.${r.key}`)}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Призначення робочого персоналу */}
            <div className="border-t border-border pt-4 space-y-3">
              <h4 className="text-sm font-semibold text-foreground">Робочий персонал турніру</h4>

              {/* Selected Staff Badges */}
              <div className="flex flex-wrap gap-1.5 min-h-[2rem] p-2 border border-border/30 rounded-xl bg-background/30">
                {(() => {
                  const staffIds = editTournamentForm.watch("staff_members") || [];
                  if (staffIds.length === 0) {
                    return <span className="text-xs text-muted-foreground self-center">Персонал не призначено</span>;
                  }
                  return staffIds.map((sid: number) => {
                    const profile = assignedStaffList.find(u => u.id === sid);
                    const label = profile
                      ? `${profile.last_name} ${profile.first_name[0]}. (${profile.email})`
                      : `Користувач #${sid}`;
                    return (
                      <Badge key={sid} variant="secondary" className="gap-1 px-2.5 py-1 text-xs rounded-lg border border-border/60">
                        {label}
                        <button
                          type="button"
                          onClick={() => {
                            editTournamentForm.setValue(
                              "staff_members",
                              staffIds.filter((id: number) => id !== sid)
                            );
                          }}
                          className="hover:text-destructive text-muted-foreground font-bold shrink-0 ml-0.5"
                        >
                          ✕
                        </button>
                      </Badge>
                    );
                  });
                })()}
              </div>

              {/* Staff Search Dropdown */}
              <div className="relative space-y-1.5">
                <Label className="text-xs text-muted-foreground">Додати персонал (пошук за іменем чи email)</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="text"
                    placeholder="Введіть ім'я, прізвище або email..."
                    className="pl-9 text-xs"
                    value={staffSearch}
                    onChange={(e) => setStaffSearch(e.target.value)}
                  />
                  {searchingStaff && (
                    <Loader2 className="absolute right-3 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />
                  )}
                </div>

                {staffSearch.trim() && (
                  <div className="absolute z-50 w-full mt-1 border border-border bg-card shadow-lg rounded-xl max-h-48 overflow-y-auto divide-y divide-border/30">
                    {staffSearchResults.length === 0 ? (
                      <p className="text-xs text-muted-foreground p-3 text-center">Нічого не знайдено</p>
                    ) : (
                      staffSearchResults.map((u) => {
                        const staffList = editTournamentForm.watch("staff_members") || [];
                        const isAlreadySelected = staffList.includes(u.id);
                        return (
                          <button
                            key={u.id}
                            type="button"
                            disabled={isAlreadySelected}
                            onClick={() => {
                              // Add to staff list
                              editTournamentForm.setValue("staff_members", [...staffList, u.id]);
                              // Add to assigned staff profiles list to ensure we have the name
                              if (!assignedStaffList.some(p => p.id === u.id)) {
                                setAssignedStaffList(prev => [...prev, u]);
                              }
                              // Clear search
                              setStaffSearch("");
                            }}
                            className={cn(
                              "w-full text-left px-3 py-2 text-xs flex items-center justify-between hover:bg-muted/50 transition-colors",
                              isAlreadySelected && "opacity-50 cursor-default bg-muted/20"
                            )}
                          >
                            <div>
                              <span className="font-bold text-foreground">{u.last_name} {u.first_name} {u.patronymic || ""}</span>
                              <span className="text-[10px] text-muted-foreground block">{u.email}</span>
                            </div>
                            {isAlreadySelected ? (
                              <span className="text-[10px] text-amber-500 font-semibold">Вже додано</span>
                            ) : (
                              <span className="text-[10px] text-muted-foreground font-semibold hover:text-amber-500">+ Додати</span>
                            )}
                          </button>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            </div>


            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditDialogOpen(false)}>
                Скасувати
              </Button>
              <Button type="submit" variant="sport" disabled={isEditing}>
                {isEditing ? <Loader2 className="w-4 h-4 animate-spin" /> : "Зберегти"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Діалог видалення турніру */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">Вилучити турнір</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Ви впевнені, що хочете вилучити турнір <span className="font-bold text-foreground">{tournament.title}</span>? Ця дія повністю видалить турнір, його категорії та всі дані поєдинків.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              Скасувати
            </Button>
            <Button variant="destructive" onClick={onDeleteTournament} disabled={isDeleting}>
              {isDeleting ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              Вилучити
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Діалог групової генерації сіток */}
      <Dialog open={bulkDialogOpen} onOpenChange={setBulkDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Налаштування групової генерації сіток</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-xs text-muted-foreground">
              Виберіть спосіб автоматичного вибору формату сітки (Кругова або Олімпійська) для нестворених категорій.
            </p>

            {/* Вкладки вибору режиму */}
            <div className="flex rounded-lg border border-border p-0.5 bg-muted/30">
              <button
                type="button"
                onClick={() => setBulkGenMode("threshold")}
                className={cn(
                  "flex-1 py-1.5 text-xs font-semibold rounded-md transition-all",
                  bulkGenMode === "threshold"
                    ? "bg-amber-500 text-white shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Пороговий режим
              </button>
              <button
                type="button"
                onClick={() => setBulkGenMode("custom")}
                className={cn(
                  "flex-1 py-1.5 text-xs font-semibold rounded-md transition-all",
                  bulkGenMode === "custom"
                    ? "bg-amber-500 text-white shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Власний режим (діапазони)
              </button>
            </div>

            {bulkGenMode === "threshold" ? (
              <div className="space-y-3 pt-1">
                <div className="border border-border rounded-lg p-4 bg-muted/20 space-y-3">
                  <Label className="text-xs font-bold text-foreground">
                    Гранична кількість учасників для Кругової сітки
                  </Label>
                  <div className="flex items-center gap-3">
                    <Input
                      type="number"
                      min={2}
                      max={20}
                      value={thresholdVal}
                      onChange={(e) => setThresholdVal(Math.max(2, Number(e.target.value)))}
                      className="w-24 font-mono font-bold text-base"
                    />
                    <span className="text-xs text-muted-foreground">учасників</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed pt-3 border-t border-border/40">
                    ℹ️ Категорії з <strong className="text-amber-500">2–{thresholdVal}</strong> підтвердженими учасниками отримають <strong>Кругову сітку</strong>.<br />
                    Категорії з <strong className="text-blue-500">{thresholdVal + 1} або більше</strong> учасниками отримають <strong>Олімпійську сітку (на вибування)</strong>.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="border border-border rounded-lg p-3 bg-muted/20 space-y-3">
                  <span className="text-xs font-bold text-amber-500 uppercase tracking-widest block">Кругова сітка (Round Robin)</span>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-[11px]">Мінімум людей</Label>
                      <Input type="number" value={rrMin} onChange={(e) => setRrMin(Number(e.target.value))} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px]">Максимум людей</Label>
                      <Input type="number" value={rrMax} onChange={(e) => setRrMax(Number(e.target.value))} />
                    </div>
                  </div>
                </div>

                <div className="border border-border rounded-lg p-3 bg-muted/20 space-y-3">
                  <span className="text-xs font-bold text-blue-500 uppercase tracking-widest block">Олімпійська сітка (Single Elimination)</span>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-[11px]">Мінімум людей</Label>
                      <Input type="number" value={seMin} onChange={(e) => setSeMin(Number(e.target.value))} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px]">Максимум людей</Label>
                      <Input type="number" value={seMax} onChange={(e) => setSeMax(Number(e.target.value))} />
                    </div>
                  </div>
                </div>

                {/* Блоки валідації */}
                {(() => {
                  const hasMinMaxError = rrMin > rrMax || seMin > seMax;
                  const hasOverlap = !hasMinMaxError && rrMax >= seMin;
                  const hasGap = !hasMinMaxError && rrMax + 1 < seMin;

                  return (
                    <div className="space-y-2">
                      {hasMinMaxError && (
                        <div className="p-2.5 rounded-lg border border-red-500/20 bg-red-500/5 text-red-400 text-[11px] font-medium leading-relaxed">
                          ⚠️ Помилка: мінімальна межа не може бути більшою за максимальну!
                        </div>
                      )}
                      {hasOverlap && (
                        <div className="p-2.5 rounded-lg border border-yellow-500/20 bg-yellow-500/5 text-yellow-500 text-[11px] font-medium leading-relaxed">
                          ⚠️ Увага: діапазони перекриваються! Категорії з {seMin} до {rrMax} учасниками отримають Кругову сітку (вона має вищий пріоритет).
                        </div>
                      )}
                      {hasGap && (
                        <div className="p-2.5 rounded-lg border border-blue-500/20 bg-blue-500/5 text-blue-400 text-[11px] font-medium leading-relaxed">
                          ⚠️ Увага: виявлено прогалину! Категорії з {rrMax + 1} до {seMin - 1} учасниками не отримають жодної сітки.
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkDialogOpen(false)}>
              Скасувати
            </Button>
            <Button
              variant="sport"
              onClick={handleGenerateAllBracketsWithThresholds}
              disabled={generatingAllBrackets || (bulkGenMode === "custom" && (rrMin > rrMax || seMin > seMax))}
            >
              {generatingAllBrackets ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              Згенерувати сітки
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Діалог імпорту категорій */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Імпорт категорій</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-xs text-muted-foreground">
              Введіть назви категорій (кожна з нового рядка). Наша система автоматично визначить стать, вік та вагові межі на основі тексту!
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="text-[10px] h-7"
                onClick={() => setImportText(
                  "12-13 років, хлопці, до 40 кг\n12-13 років, дівчата, до 45 кг\n14-15 років, хлопці, понад 60 кг\n16-17 років, хлопці, 55-60 кг"
                )}
              >
                Шаблон WKF (Хлопці / Дівчата)
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-[10px] h-7"
                onClick={() => setImportText(
                  "U10, -30kg, Male\nU12, -35kg, Female\nU14, +45kg, Mixed"
                )}
              >
                Шаблон English (U10 / U12)
              </Button>
            </div>
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder="Введіть категорії..."
              rows={8}
              className="w-full text-sm p-3 border border-input rounded bg-zinc-950 text-white font-mono focus-visible:outline-none"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportDialogOpen(false)}>Скасувати</Button>
            <Button
              variant="sport"
              disabled={isImporting || !importText.trim()}
              onClick={async () => {
                setIsImporting(true);
                try {
                  const names = importText.split("\n").map(n => n.trim()).filter(Boolean);
                  await api.post(`/tournaments/${id}/import_categories/`, { names });
                  toast({ title: "Категорії успішно імпортовано!" });
                  setImportDialogOpen(false);
                  setImportText("");
                  fetchAll();
                } catch {
                  toast({ title: "Помилка імпорту категорій", variant: "destructive" });
                } finally {
                  setIsImporting(false);
                }
              }}
            >
              {isImporting ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              Імпортувати
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
