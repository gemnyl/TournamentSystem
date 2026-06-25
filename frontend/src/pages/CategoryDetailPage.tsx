/* eslint-disable @typescript-eslint/no-unused-vars */
import { useEffect, useState, useMemo } from "react";
import { useParams, Link, useSearchParams } from "react-router-dom";
import {
  ArrowLeft, GitBranch, Plus, Loader2, CheckCircle, Scale, Trash2, Clock, Trophy, Award, Unlock
} from "lucide-react";
import { estimateSchedule } from "@/lib/scheduler";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import api from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useMatchUpdates } from "@/hooks/useMatchUpdates";
import { toast } from "@/hooks/use-toast";
import { cn, formatSportType, formatRegistrationName, formatRegistrationClub, getAgeAsOf, normalizeSportType } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/tournament/StatusBadge";

function getWeightRange(minWeight: number | null, maxWeight: number | null): string {
  if (minWeight !== null && maxWeight !== null) {
    return `${minWeight}–${maxWeight} кг`;
  } else if (minWeight !== null) {
    return `від ${minWeight} кг`;
  } else if (maxWeight !== null) {
    return `до ${maxWeight} кг`;
  }
  return "без обмежень";
}

interface CategoryResultRowProps {
  res: CategoryResult;
  resultsPersisted: boolean;
  canFinalizeOrUnlock: boolean | undefined;
  placeOverrides: Record<number, number | null>;
  onPlaceOverrideChange: (regId: number, val: number | null) => void;
}

function CategoryResultRow({
  res,
  resultsPersisted,
  canFinalizeOrUnlock,
  placeOverrides,
  onPlaceOverrideChange,
}: Readonly<CategoryResultRowProps>) {
  const placeVal = resultsPersisted ? res.registration?.place : placeOverrides[res.registration.id];
  let medal = "—";
  if (placeVal === 1) {
    medal = "🥇";
  } else if (placeVal === 2) {
    medal = "🥈";
  } else if (placeVal === 3) {
    medal = "🥉";
  } else if (placeVal != null) {
    medal = String(placeVal);
  }

  const clubContent = (() => {
    if (res.registration.athlete?.club) {
      return (
        <span>
          {res.registration.athlete.club.name}
          {res.registration.athlete.club.region && (
            <span className="text-xs text-muted-foreground/60 ml-2 px-1.5 py-0.5 rounded bg-muted">
              {res.registration.athlete.club.region}
            </span>
          )}
        </span>
      );
    }
    if (res.registration.team?.club) {
      return (
        <span>
          {res.registration.team.club.name}
          {res.registration.team.club.region && (
            <span className="text-xs text-muted-foreground/60 ml-2 px-1.5 py-0.5 rounded bg-muted">
              {res.registration.team.club.region}
            </span>
          )}
        </span>
      );
    }
    return "—";
  })();

  return (
    <TableRow className="hover:bg-muted/10">
      <TableCell className="text-center py-2">
        {resultsPersisted ? (
          <span
            className={cn(
              "font-black text-lg",
              placeVal === 1 && "text-yellow-400 scale-110",
              placeVal === 2 && "text-slate-300 scale-105",
              placeVal === 3 && "text-amber-600",
              (placeVal ?? 0) > 3 && "text-muted-foreground text-sm font-normal"
            )}
          >
            {medal}
          </span>
        ) : canFinalizeOrUnlock ? (
          <select
            value={placeOverrides[res.registration.id] ?? ""}
            onChange={(e) => {
              const val = e.target.value === "" ? null : Number(e.target.value);
              onPlaceOverrideChange(res.registration.id, val);
            }}
            className="bg-background text-foreground border border-input rounded px-2 py-1 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-amber-500 w-16 text-center"
          >
            <option value="">—</option>
            <option value="1">1</option>
            <option value="2">2</option>
            <option value="3">3</option>
            <option value="5">5</option>
          </select>
        ) : (
          <span className="text-muted-foreground text-sm font-semibold">
            {medal}
          </span>
        )}
      </TableCell>
      <TableCell className="font-bold text-foreground">
        {formatRegistrationName(res.registration)}
      </TableCell>
      <TableCell className="text-muted-foreground text-sm">
        {clubContent}
      </TableCell>
      <TableCell className="text-center font-semibold text-sm">
        <span className="text-green-500 font-bold">{res.wins}</span>
        <span className="text-muted-foreground mx-1">/</span>
        <span className="text-amber-500 font-bold">{res.draws}</span>
        <span className="text-muted-foreground mx-1">/</span>
        <span className="text-red-500 font-bold">{res.losses}</span>
      </TableCell>
      <TableCell className="text-center font-black text-amber-500 bg-amber-500/5">
        {res.points}
      </TableCell>
      <TableCell className="text-center font-mono text-xs text-muted-foreground">
        {res.scores_scored} : {res.scores_conceded}
      </TableCell>
    </TableRow>
  );
}
import type { Category, Registration, Athlete, PaginatedResponse, Tournament, Tatami, Match, CategoryResult } from "@/types/api";

const weighInSchema = z.object({ weight: z.coerce.number().min(20).max(300) });
type WeighInForm = z.infer<typeof weighInSchema>;

interface RulesetOption {
  key: string;
  label?: string;
  name?: string;
  sport_type?: string;
}

const editCategorySchema = z.object({
  name:                   z.string().min(2, "Введіть назву"),
  allowed_gender:         z.enum(["male", "female", "mixed"]),
  min_age:                z.coerce.number().min(5).max(100),
  max_age:                z.coerce.number().min(5).max(100),
  min_weight: z.preprocess(
    (val) => (val === "" || val === null || val === undefined) ? undefined : Number(val),
    z.number().min(1, "Мін. 1 кг").max(500, "Макс. 500 кг").optional()
  ),
  max_weight: z.preprocess(
    (val) => (val === "" || val === null || val === undefined) ? undefined : Number(val),
    z.number().min(1, "Мін. 1 кг").max(500, "Макс. 500 кг").optional()
  ),
  bracket_format:         z.enum(["single_elimination", "round_robin", "single_repechage", "double_elimination", "swiss"]),
  ruleset_key:            z.string().min(1, "Оберіть правила"),
  match_duration_seconds: z.preprocess(
    (val) => (val === "" || val === null || val === undefined) ? undefined : Number(val),
    z.number().positive().optional()
  ),
  allowed_skill_level:    z.string().optional(),
  two_third_places:       z.boolean().default(true),
});
type EditCategoryForm = z.infer<typeof editCategorySchema>;

export default function CategoryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user, isOrganizer, isCoach, isJudge } = useAuth();

  const [category, setCategory] = useState<Category | null>(null);
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [generatingBracket, setGeneratingBracket] = useState(false);
  const [generatingNextRound, setGeneratingNextRound] = useState(false);
  const [regDialogOpen, setRegDialogOpen] = useState(false);
  const [weighInDialog, setWeighInDialog] = useState<Registration | null>(null);
  const [selectedAthlete, setSelectedAthlete] = useState<string>("");
  const [isRegistering, setIsRegistering] = useState(false);

  // Edit / Delete category states
  const [editCatDialogOpen, setEditCatDialogOpen] = useState(false);
  const [deleteCatDialogOpen, setDeleteCatDialogOpen] = useState(false);
  const [deleteBracketDialogOpen, setDeleteBracketDialogOpen] = useState(false);
  const [generateBracketDialogOpen, setGenerateBracketDialogOpen] = useState(false);
  const [chosenFormat, setChosenFormat] = useState<string>("single_elimination");
  const [chosenDoubleElimType, setChosenDoubleElimType] = useState<string>("full");
  const [isEditingCat, setIsEditingCat] = useState(false);
  const [isDeletingCat, setIsDeletingCat] = useState(false);
  const [isDeletingBracket, setIsDeletingBracket] = useState(false);
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [tatamis, setTatamis] = useState<Tatami[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [selectedTatamiId, setSelectedTatamiId] = useState<string>("");
  const [assigningTatami, setAssigningTatami] = useState(false);
  const confirmedPaidTeamsCount = useMemo(() => {
    return registrations.filter(
      (r) => r.status === "confirmed" && r.payment_status === "paid"
    ).length;
  }, [registrations]);

  const [rulesets, setRulesets] = useState<RulesetOption[]>([]);

  const categoryMatches = matches.filter((m: Match) => m.category === Number(id));

  const swissCurrentRound = useMemo(() => {
    if (category?.bracket_format !== "swiss" || categoryMatches.length === 0) return 0;
    return Math.max(...categoryMatches.map((m) => m.round_index), 0);
  }, [category, categoryMatches]);

  const swissMaxRounds = useMemo(() => {
    const activeRegs = registrations.filter(r => r.status === "confirmed").length;
    return activeRegs > 1 ? Math.ceil(Math.log2(activeRegs)) : 1;
  }, [registrations]);

  const canGenerateNextSwissRound = useMemo(() => {
    if (category?.bracket_format !== "swiss") return false;
    if (categoryMatches.length === 0) return false;
    if (swissCurrentRound >= swissMaxRounds) return false;

    const currentRoundMatches = categoryMatches.filter((m) => m.round_index === swissCurrentRound);
    return currentRoundMatches.length > 0 && currentRoundMatches.every((m) => m.status === "completed");
  }, [category, categoryMatches, swissCurrentRound, swissMaxRounds]);

  const firstMatchWithTatami = categoryMatches?.find((m: Match) => m.tatami !== null);
  const categoryTatami = (firstMatchWithTatami && Array.isArray(tatamis))
    ? tatamis.find((t: Tatami) => t.id === firstMatchWithTatami.tatami)
    : undefined;
  const isCompleted = tournament?.status === "completed";
  const isChiefJudge = tournament?.chief_judge === user?.id;
  const canFinalizeOrUnlock = !isCompleted && (isOrganizer || isChiefJudge || (isJudge && categoryTatami && categoryTatami.assigned_judge === user?.id));

  // Delete registration state
  const [deleteRegDialog, setDeleteRegDialog] = useState<Registration | null>(null);
  const [isDeletingReg, setIsDeletingReg] = useState(false);

  const [targetCategoryId, setTargetCategoryId] = useState<string>("");
  const [isTransferring, setIsTransferring] = useState(false);

  // Tab states and results engine states
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get("tab") as "registrations" | "results") || "registrations";

  const setActiveTab = (tab: "registrations" | "results") => {
    setSearchParams((prev) => {
      prev.set("tab", tab);
      return prev;
    }, { replace: true });
  };

  const [results, setResults] = useState<CategoryResult[]>([]);
  const [isLoadingResults, setIsLoadingResults] = useState(false);
  const [isSavingResults, setIsSavingResults] = useState(false);
  const [placeOverrides, setPlaceOverrides] = useState<Record<number, number | null>>({});

  const editCategoryForm = useForm<EditCategoryForm>({
    resolver: zodResolver(editCategorySchema),
  });

  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<WeighInForm>({
    resolver: zodResolver(weighInSchema),
  });

  const fetchAll = async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      const [catRes, regRes] = await Promise.all([
        api.get<Category>(`/categories/${id}/`),
        api.get<PaginatedResponse<Registration> | Registration[]>(`/registrations/?category=${id}`),
      ]);
      setCategory(catRes.data);
      setRegistrations(Array.isArray(regRes.data) ? regRes.data : regRes.data.results);

      const [tatamiRes, tournRes, matchRes] = await Promise.all([
        api.get<Tatami[] | { results: Tatami[] }>(`/tatamis/?tournament=${catRes.data.tournament}`),
        api.get<Tournament>(`/tournaments/${catRes.data.tournament}/`),
        api.get<Match[] | { results: Match[] }>(`/matches/?tournament=${catRes.data.tournament}`),
      ]);
      const tatamiData = tatamiRes.data;
      setTatamis(Array.isArray(tatamiData) ? tatamiData : (tatamiData.results ?? []));
      setTournament(tournRes.data);

      const matchData = matchRes.data;
      const allMatches = Array.isArray(matchData) ? matchData : (matchData.results ?? []);
      setMatches(allMatches);

      const categoryMatches = allMatches.filter((m: Match) => m.category === Number(id));
      const firstMatchWithTatami = categoryMatches?.find((m: Match) => m.tatami !== null);
      if (firstMatchWithTatami) {
        setSelectedTatamiId(String(firstMatchWithTatami.tatami));
      } else {
        setSelectedTatamiId("");
      }
    } finally {
      if (!silent) setIsLoading(false);
    }
  };

  // WebSocket: real-time updates for category details page
  useMatchUpdates(Number(id), () => {
    fetchAll(true);
    fetchResults(true);
  }, {
    onConnect: () => {
      fetchAll(true);
      fetchResults(true);
    }
  });

  const handleAssignTatami = async (tatamiIdStr: string) => {
    if (!tatamiIdStr) return;
    setAssigningTatami(true);
    try {
      await api.post(`/categories/${id}/assign_tatami/`, { tatami_id: Number(tatamiIdStr) });
      toast({ title: "Татамі успішно призначено!" });
      fetchAll();
    } catch {
      toast({ title: "Помилка призначення татамі", variant: "destructive" });
    } finally {
      setAssigningTatami(false);
    }
  };

  const fetchAthletes = async () => {
    const { data } = await api.get<PaginatedResponse<Athlete> | Athlete[]>("/athletes/");
    setAthletes(Array.isArray(data) ? data : data.results);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchAll(); }, [id]);
  useEffect(() => { if (regDialogOpen) fetchAthletes(); }, [regDialogOpen]);

  // Генерація сітки
  const handleGenerateBracket = async () => {
    setGeneratingBracket(true);
    try {
      const payload: Record<string, string> = { bracket_format: chosenFormat };
      if (chosenFormat === "double_elimination") {
        payload.double_elim_type = chosenDoubleElimType;
      }
      await api.post(`/categories/${id}/generate_bracket/`, payload);
      toast({ title: "Сітку згенеровано!" });
      setGenerateBracketDialogOpen(false);
      fetchAll();
    } catch {
      // toast з interceptor
    } finally {
      setGeneratingBracket(false);
    }
  };

  const handleOpenGenerateBracket = () => {
    if (category?.is_team) {
      const suggested = confirmedPaidTeamsCount >= 6 ? "single_elimination" : "round_robin";
      setChosenFormat(suggested);
    } else {
      setChosenFormat(category?.bracket_format ?? "single_elimination");
      setChosenDoubleElimType(category?.double_elim_type ?? "full");
    }
    setGenerateBracketDialogOpen(true);
  };

  const handleOpenEditCat = async () => {
    if (!category) return;
    try {
      const { data } = await api.get<RulesetOption[]>("/rulesets/");
      setRulesets(data);
    } catch {
      // intentionally empty
    }
    editCategoryForm.reset({
      name: category.name,
      allowed_gender: category.allowed_gender,
      min_age: category.min_age,
      max_age: category.max_age,
      min_weight: category.min_weight ?? undefined,
      max_weight: category.max_weight ?? undefined,
      bracket_format: category.bracket_format as EditCategoryForm["bracket_format"],
      ruleset_key: category.ruleset_key,
      match_duration_seconds: category.match_duration_seconds ?? undefined,
      allowed_skill_level: category.allowed_skill_level ?? "",
      two_third_places: category.two_third_places ?? true,
    });
    setEditCatDialogOpen(true);
  };

  const onEditCatSubmit = async (data: EditCategoryForm) => {
    setIsEditingCat(true);
    try {
      const payload = {
        ...data,
        tournament: category?.tournament,
        min_weight: data.min_weight ?? null,
        max_weight: data.max_weight ?? null,
      };
      const { data: updated } = await api.put<Category>(`/categories/${id}/`, payload);
      setCategory(updated);
      toast({ title: "Категорію успішно оновлено!" });
      setEditCatDialogOpen(false);
      fetchAll();
    } catch {
      toast({ title: "Помилка оновлення категорії", variant: "destructive" });
    } finally {
      setIsEditingCat(false);
    }
  };

  const onDeleteCat = async () => {
    setIsDeletingCat(true);
    try {
      await api.delete(`/categories/${id}/`);
      toast({ title: "Категорію вилучено!" });
      setDeleteCatDialogOpen(false);
      window.location.href = `/tournaments/${category?.tournament}`;
    } catch {
      toast({ title: "Помилка вилучення категорії", variant: "destructive" });
    } finally {
      setIsDeletingCat(false);
    }
  };

  const handleDeleteBracket = async () => {
    setIsDeletingBracket(true);
    try {
      await api.post(`/categories/${id}/delete_bracket/`);
      toast({ title: "Сітку успішно вилучено!" });
      setDeleteBracketDialogOpen(false);
      fetchAll();
    } catch {
      toast({ title: "Помилка видалення сітки", variant: "destructive" });
    } finally {
      setIsDeletingBracket(false);
    }
  };

  const handleGenerateNextRound = async () => {
    setGeneratingNextRound(true);
    try {
      await api.post(`/categories/${id}/generate_next_swiss_round/`);
      toast({ title: "Наступний тур успішно згенеровано!" });
      fetchAll();
    } catch {
      // toast з interceptor
    } finally {
      setGeneratingNextRound(false);
    }
  };

  // Реєстрація атлета
  const handleRegister = async () => {
    if (!selectedAthlete) return;
    setIsRegistering(true);
    try {
      await api.post("/registrations/", { category: Number(id), athlete_id: Number(selectedAthlete) });
      toast({ title: "Атлета зареєстровано!" });
      setRegDialogOpen(false);
      setSelectedAthlete("");
      fetchAll();
    } finally {
      setIsRegistering(false);
    }
  };

  // Зважування
  const handleWeighIn = async (data: WeighInForm) => {
    if (!weighInDialog) return;
    try {
      await api.post(`/registrations/${weighInDialog.id}/confirm_weigh_in/`, data);
      toast({ title: "Зважування підтверджено!" });
      setWeighInDialog(null);
      reset();
      fetchAll();
    } catch {
      // toast з interceptor
    }
  };

  const getMatchingCategories = (reg: Registration, _enteredWeight: number) => {
    if (!tournament?.categories || !reg.athlete) return [];
    const athlete = reg.athlete;

    const athleteAge = getAgeAsOf(athlete.birth_date, tournament.start_date);

    return (tournament.categories || []).filter((cat: Category) => {
      if (cat.id === category?.id) return false;

      const genderMatches = cat.allowed_gender === "mixed" ||
        (cat.allowed_gender === "male" && athlete.gender === "male") ||
        (cat.allowed_gender === "female" && athlete.gender === "female");

      const ageMatches = athleteAge >= cat.min_age && athleteAge <= cat.max_age;

      return genderMatches && ageMatches;
    });
  };

  const handleTransfer = async () => {
    if (!weighInDialog || !targetCategoryId) return;
    setIsTransferring(true);
    try {
      await api.patch(`/registrations/${weighInDialog.id}/`, {
        category: Number(targetCategoryId),
      });
      toast({ title: "Спортсмена перенесено в іншу категорію!" });
      setWeighInDialog(null);
      setTargetCategoryId("");
      reset();
      fetchAll();
    } catch {
      // toast з interceptor
    } finally {
      setIsTransferring(false);
    }
  };

  // Видалення заявки
  const handleDeleteRegistration = async () => {
    if (!deleteRegDialog) return;
    setIsDeletingReg(true);
    try {
      await api.delete(`/registrations/${deleteRegDialog.id}/`);
      toast({ title: "Заявку успішно видалено!" });
      setDeleteRegDialog(null);
      fetchAll();
    } catch {
      toast({ title: "Помилка видалення заявки", variant: "destructive" });
    } finally {
      setIsDeletingReg(false);
    }
  };

  const fetchResults = async (silent = false) => {
    if (!silent) setIsLoadingResults(true);
    try {
      const [resultsRes, regRes] = await Promise.all([
        api.get<CategoryResult[]>(`/categories/${id}/results/`),
        api.get<PaginatedResponse<Registration> | Registration[]>(`/registrations/?category=${id}`),
      ]);
      setResults(resultsRes.data);
      setRegistrations(Array.isArray(regRes.data) ? regRes.data : regRes.data.results);

      const initialOverrides: Record<number, number | null> = {};
      resultsRes.data.forEach((res) => {
        initialOverrides[res.registration.id] = res.place;
      });
      setPlaceOverrides(initialOverrides);
    } catch {
      toast({ title: "Помилка завантаження результатів", variant: "destructive" });
    } finally {
      if (!silent) setIsLoadingResults(false);
    }
  };

  const handleSaveResults = async () => {
    setIsSavingResults(true);
    try {
      await api.post(`/categories/${id}/save_results/`, { overrides: placeOverrides });
      toast({ title: "Результати успішно зафіксовані!" });
      fetchResults();
      fetchAll();
    } catch {
      toast({ title: "Помилка фіксації результатів", variant: "destructive" });
    } finally {
      setIsSavingResults(false);
    }
  };

  const handleUnlockResults = async () => {
    setIsSavingResults(true);
    try {
      await api.post(`/categories/${id}/unlock_results/`);
      toast({ title: "Фіксацію результатів скасовано!" });
      fetchResults();
      fetchAll();
    } catch {
      toast({ title: "Помилка скасування фіксації", variant: "destructive" });
    } finally {
      setIsSavingResults(false);
    }
  };


  useEffect(() => {
    if (activeTab === "results") {
      fetchResults();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, id]);

  if (isLoading) {
    return (
      <div className="container py-8 flex justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
      </div>
    );
  }
  if (!category) return null;

  const canGenerateBracket = !isCompleted && (isOrganizer || isChiefJudge) && category.status !== "completed" && registrations.some(r => r.status === "confirmed");
  const canRegister = !isCompleted && (isOrganizer || isChiefJudge || isCoach) && category.status === "registration";

  // Обчислюємо оцінку розкладу для поточної категорії
  let estimateBanner = null;
  if (category && tatamis.length > 0 && matches.length > 0) {
    const { categoryEstimates } = estimateSchedule(tatamis, matches, [category]);
    const estimate = categoryEstimates[category.id];
    if (estimate) {
      const timeStr = new Date(estimate.startTime).toLocaleTimeString("uk-UA", {
        hour: "2-digit",
        minute: "2-digit",
      });
      if (!estimate.isTatamiActive) {
        estimateBanner = (
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-slate-500/10 text-slate-400 border border-slate-500/20 mt-3 w-fit">
            <Clock className="w-3.5 h-3.5" />
            Роботу татамі №{estimate.tatamiNumber} призупинено (черга не активна)
          </div>
        );
      } else if (estimate.isLive) {
        estimateBanner = (
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-green-500/10 text-green-400 border border-green-500/20 mt-3 w-fit animate-pulse">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />
            ТРИВАЄ ЗАРАЗ НА ТАТАМІ №{estimate.tatamiNumber}
          </div>
        );
      } else {
        estimateBanner = (
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-500/10 text-amber-500 border border-amber-500/20 mt-3 w-fit">
            <Clock className="w-3.5 h-3.5" />
            Очікуваний час початку: {timeStr} {estimate.tatamiNumber ? `(Татамі №${estimate.tatamiNumber})` : ""}
          </div>
        );
      }
    }
  }

  return (
    <div className="container py-8 space-y-6">
      <Link to={`/tournaments/${category.tournament}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="w-4 h-4" /> До турніру
      </Link>

      {/* Заголовок */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h1 className="font-display text-3xl font-bold tracking-tight">{category.name}</h1>
            <StatusBadge status={category.status} type="category" />
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">
              {category.confirmed_registrations_count} учасників · {getWeightRange(category.min_weight, category.max_weight)} · {category.min_age}–{category.max_age} р.
            </p>
          {/* estimateBanner placement */}
            {estimateBanner}
          </div>
          {(isOrganizer || isChiefJudge) && tatamis.length > 0 && category.has_bracket && !isCompleted && (
            <div
              className="flex items-center gap-2 mt-3 border rounded-lg px-3 py-1.5 w-fit shadow-md text-zinc-100"
              style={{ backgroundColor: '#18181b', borderColor: '#27272a' }}
            >
              <span className="text-xs font-bold text-zinc-400">Призначений татамі:</span>
              <Select
                value={selectedTatamiId}
                onValueChange={(v) => {
                  setSelectedTatamiId(v);
                  handleAssignTatami(v);
                }}
                disabled={assigningTatami}
              >
                <SelectTrigger
                  className="h-7 w-36 text-xs hover:bg-zinc-800 hover:text-zinc-50 focus:ring-0 focus:ring-offset-0"
                  style={{ backgroundColor: '#09090b', borderColor: '#27272a', color: '#e4e4e7' }}
                >
                  <SelectValue placeholder="Оберіть татамі" />
                </SelectTrigger>
                <SelectContent className="bg-zinc-950 border-zinc-800 text-zinc-200">
                  {tatamis.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)} className="hover:bg-zinc-900 focus:bg-zinc-900 focus:text-zinc-100 cursor-pointer">
                      Татамі №{t.number} {t.name ? `(${t.name})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {canRegister && (
            <Button variant="outline" size="sm" onClick={() => setRegDialogOpen(true)}>
              <Plus className="w-4 h-4" /> Зареєструвати атлета
            </Button>
          )}
          {canGenerateBracket && !category.has_bracket && (
            <Button variant="sport" size="sm" onClick={handleOpenGenerateBracket}>
              <GitBranch className="w-4 h-4" />
              Згенерувати сітку
            </Button>
          )}
          {(isOrganizer || isChiefJudge) && category.has_bracket && !isCompleted && (
            <Button variant="destructive" size="sm" onClick={() => setDeleteBracketDialogOpen(true)}>
              Вилучити сітку
            </Button>
          )}
          {canFinalizeOrUnlock && canGenerateNextSwissRound && (
            <Button
              variant="sport"
              size="sm"
              disabled={generatingNextRound}
              onClick={handleGenerateNextRound}
            >
              {generatingNextRound ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Plus className="w-4 h-4 mr-1" />}
              Згенерувати наступний тур ({swissCurrentRound + 1}/{swissMaxRounds})
            </Button>
          )}
          {category.has_bracket ? (
            <Button asChild variant="outline" size="sm">
              <Link to={`/categories/${id}/bracket`}>
                <GitBranch className="w-4 h-4" /> Переглянути сітку
              </Link>
            </Button>
          ) : null}
          {(isOrganizer || isChiefJudge) && !isCompleted && (
            <>
              <Button variant="outline" size="sm" onClick={handleOpenEditCat}>
                Редагувати
              </Button>
              <Button variant="destructive" size="sm" onClick={() => setDeleteCatDialogOpen(true)}>
                Вилучити категорію
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Вкладки: Учасники та Результати */}
      <div className="flex border-b border-border gap-6">
        <button
          onClick={() => setActiveTab("registrations")}
          className={cn(
            "pb-3 text-sm font-bold tracking-wide uppercase transition-all relative border-b-2",
            activeTab === "registrations"
              ? "text-amber-500 border-amber-500"
              : "text-muted-foreground hover:text-foreground border-transparent"
          )}
        >
          Реєстрації ({registrations.length})
        </button>
        <button
          onClick={() => setActiveTab("results")}
          className={cn(
            "pb-3 text-sm font-bold tracking-wide uppercase transition-all relative border-b-2",
            activeTab === "results"
              ? "text-amber-500 border-amber-500"
              : "text-muted-foreground hover:text-foreground border-transparent"
          )}
        >
          Результати
        </button>
      </div>

      {activeTab === "registrations" ? (
        /* Таблиця реєстрацій */
        <div className="rounded-xl border border-border overflow-hidden bg-card/25 backdrop-blur-md">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Атлет</TableHead>
                <TableHead>Клуб</TableHead>
                {(isOrganizer || isCoach || isJudge) && <TableHead className="text-center">Вага (факт.)</TableHead>}
                <TableHead className="text-center">Статус</TableHead>
                <TableHead className="text-center">Оплата</TableHead>
                {(isOrganizer || isCoach || (user && tournament?.staff_members?.includes(user.id))) && !isCompleted && (
                  <TableHead className="w-56 text-right">Дії</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {registrations.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={
                      5 +
                      (((isOrganizer || isCoach || (user && tournament?.staff_members?.includes(user.id))) && !isCompleted) ? 1 : 0)
                    }
                    className="text-center text-muted-foreground py-8"
                  >
                    Реєстрацій поки немає
                  </TableCell>
                </TableRow>
              ) : (
                (() => {
                  const isStaffOrOrg = user && (
                    user.id === tournament?.organizer ||
                    tournament?.staff_members?.includes(user.id) ||
                    user.role === "admin"
                  );
                  return registrations.map((reg) => {
                    const canDeleteReg = !isCompleted && (isOrganizer || (
                      isCoach && (
                        reg.athlete?.coach?.id === user?.id ||
                        reg.team?.coach?.id === user?.id
                      )
                    ));
                    const showActionsCell = (isOrganizer || isCoach || isStaffOrOrg) && !isCompleted;

                    return (
                      <TableRow key={reg.id}>
                        <TableCell className="font-medium">
                          {formatRegistrationName(reg)}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {formatRegistrationClub(reg) || "—"}
                        </TableCell>
                        {(isOrganizer || isCoach || isJudge) && (
                          <TableCell className="text-center font-mono text-sm">
                            {reg.recorded_weight != null ? `${reg.recorded_weight} кг` : "—"}
                          </TableCell>
                        )}
                        <TableCell className="text-center">
                          <StatusBadge status={reg.status} type="registration" />
                        </TableCell>
                        <TableCell className="text-center">
                          {reg.payment_status === "paid" ? (
                            <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-green-500/10 text-green-500 border border-green-500/20">
                              Сплачено
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-red-500/10 text-red-500 border border-red-500/20">
                              Не сплачено
                            </span>
                          )}
                        </TableCell>
                        {showActionsCell && (
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              {/* Кнопка зважування для організатора/персоналу */}
                              {isStaffOrOrg && !isCompleted && reg.status === "pending" && tournament?.weigh_in_required !== false && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 text-xs"
                                  onClick={() => setWeighInDialog(reg)}
                                >
                                  <Scale className="w-3.5 h-3.5 mr-1" /> Зважити
                                </Button>
                              )}

                              {/* Підтвердження оплати для організатора/персоналу */}
                              {isStaffOrOrg && !isCompleted && reg.payment_status === "unpaid" && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 text-xs text-green-500 hover:text-green-400 hover:bg-green-500/10"
                                  onClick={async () => {
                                    try {
                                      await api.post("/registrations/bulk_pay/", {
                                        registration_ids: [reg.id],
                                      });
                                      toast({ title: "Оплату підтверджено!" });
                                      fetchAll();
                                    } catch {
                                      // handled by interceptor
                                    }
                                  }}
                                >
                                  <CheckCircle className="w-3.5 h-3.5 mr-1" /> Сплачено
                                </Button>
                              )}

                              {/* Кнопка видалення/вилучення */}
                              {canDeleteReg && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                                  disabled={category?.has_bracket}
                                  onClick={() => setDeleteRegDialog(reg)}
                                >
                                  <Trash2 className="w-3.5 h-3.5 mr-1" />
                                  {isOrganizer ? "Видалити" : "Вилучити"}
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  });
                })()
              )}
            </TableBody>
          </Table>
        </div>
      ) : (
        /* Вкладка Результати */
        <div className="space-y-6">
          {isLoadingResults ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
            </div>
          ) : (
            (() => {
              const hasMatches = categoryMatches.length > 0;
              const allMatchesCompleted = hasMatches && categoryMatches.every((m: Match) => m.status === "completed");
              const resultsPersisted = category.results_finalized ?? false;

              if (!hasMatches) {
                return (
                  <div className="flex flex-col items-center justify-center p-12 text-center rounded-2xl border border-dashed border-border/80 bg-card/25 backdrop-blur-md">
                    <Trophy className="w-12 h-12 text-muted-foreground/30 mb-4" />
                    <h3 className="text-lg font-bold text-foreground">Залік відсутній</h3>
                    <p className="text-sm text-muted-foreground max-w-md mt-1">
                      Турнірна сітка ще не згенерована. Створіть сітку та проведіть сутички, щоб сформувати залік.
                    </p>
                  </div>
                );
              }

              return (
                <div className="space-y-4">
                  {/* Банери статусу */}
                  {canFinalizeOrUnlock && (
                    <>
                      {allMatchesCompleted ? (
                        resultsPersisted ? (
                          <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 text-emerald-500 text-sm font-semibold select-none">
                            <div className="flex items-center gap-3">
                              <CheckCircle className="w-5 h-5 shrink-0" />
                              <span>Результати змагань зафіксовано в базі даних та внесено до загального заліку.</span>
                            </div>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={handleUnlockResults}
                              disabled={isSavingResults}
                              className="shadow-sm"
                            >
                              {isSavingResults ? (
                                <Loader2 className="w-4 h-4 animate-spin mr-1" />
                              ) : (
                                <Unlock className="w-4 h-4 mr-1" />
                              )}
                              Скасувати фіксацію
                            </Button>
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl border border-amber-500/20 bg-amber-500/5 text-amber-500 text-sm font-semibold select-none">
                            <div className="flex items-center gap-3">
                              <Award className="w-5 h-5 shrink-0" />
                              <span>Всі сутички завершено! Організатор або призначений суддя може зафіксувати результати.</span>
                            </div>
                            <Button
                              size="sm"
                              variant="sport"
                              onClick={handleSaveResults}
                              disabled={isSavingResults}
                              className="shadow-sm shadow-amber-500/10"
                            >
                              {isSavingResults ? (
                                <Loader2 className="w-4 h-4 animate-spin mr-1" />
                              ) : (
                                <Trophy className="w-4 h-4 mr-1" />
                              )}
                              Зафіксувати результати
                            </Button>
                          </div>
                        )
                      ) : (
                        <div className="flex items-center gap-3 p-4 rounded-xl border border-amber-500/20 bg-amber-500/5 text-amber-500 text-sm font-semibold select-none">
                          <Clock className="w-5 h-5 shrink-0" />
                          <span>Сутички в категорії ще тривають. Відображено поточні проміжні результати.</span>
                        </div>
                      )}
                    </>
                  )}

                  {/* Таблиця результатів */}
                  <div className="rounded-xl border border-border overflow-hidden bg-card/25 backdrop-blur-md">
                    <Table>
                      <TableHeader className="bg-muted/40">
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="w-24 text-center font-bold">Місце</TableHead>
                          <TableHead className="font-bold">Атлет</TableHead>
                          <TableHead className="font-bold">Клуб / Регіон</TableHead>
                          <TableHead className="text-center w-28 font-bold">В / Н / П</TableHead>
                          <TableHead className="text-center w-24 font-bold">Очки</TableHead>
                          <TableHead className="text-center w-32 font-bold">Співвідношення балів</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {results.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                              Немає даних для заліку
                            </TableCell>
                          </TableRow>
                        ) : results.map((res: CategoryResult) => (
                          <CategoryResultRow
                            key={res.registration.id}
                            res={res}
                            resultsPersisted={resultsPersisted}
                            canFinalizeOrUnlock={canFinalizeOrUnlock}
                            placeOverrides={placeOverrides}
                            onPlaceOverrideChange={(regId, val) => {
                              setPlaceOverrides((prev) => ({ ...prev, [regId]: val }));
                            }}
                          />
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              );
            })()
          )}
        </div>
      )}

      {/* Діалог реєстрації атлета */}
      <Dialog open={regDialogOpen} onOpenChange={setRegDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Реєстрація атлета</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Label>Оберіть атлета</Label>
            <Select value={selectedAthlete} onValueChange={setSelectedAthlete}>
              <SelectTrigger>
                <SelectValue placeholder="Пошук атлета..." />
              </SelectTrigger>
              <SelectContent>
                {athletes.map((a) => (
                  <SelectItem key={a.id} value={String(a.id)}>
                    {a.full_name ?? `${a.first_name} ${a.last_name}`} — {a.club?.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRegDialogOpen(false)}>Скасувати</Button>
            <Button variant="sport" onClick={handleRegister} disabled={!selectedAthlete || isRegistering}>
              {isRegistering ? <Loader2 className="w-4 h-4 animate-spin" /> : "Зареєструвати"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Діалог зважування */}
      <Dialog open={!!weighInDialog} onOpenChange={(o) => !o && setWeighInDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Підтвердити зважування</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{weighInDialog?.athlete?.full_name}</p>
          <form onSubmit={handleSubmit(handleWeighIn)} className="space-y-3">
            <div className="space-y-1.5">
              <Label>Фактична вага (кг)</Label>
              <Input type="number" step="0.1" placeholder="49.8" {...register("weight")} />
              {errors.weight && <p className="text-xs text-destructive">{errors.weight.message}</p>}
            </div>

            {/* Валідація ваги та перенесення в іншу категорію */}
            {(() => {
              const watchedWeight = watch("weight");
              const weightNum = watchedWeight ? Number.parseFloat(String(watchedWeight)) : Number.NaN;
              const isWeightOutOfRange = !Number.isNaN(weightNum) && category && (
                (category.min_weight && weightNum < category.min_weight) ||
                (category.max_weight && weightNum > category.max_weight)
              );

              if (!isWeightOutOfRange || !weighInDialog) return null;

              return (
                <div className="space-y-3 p-3 border border-destructive/20 bg-destructive/5 text-destructive rounded-lg">
                  <p className="text-xs font-semibold flex items-center gap-1.5">
                    ⚠️ Невідповідність ваговій категорії!
                  </p>
                  <p className="text-[11px] leading-tight">
                    Фактична вага ({weightNum} кг) не вкладається у встановлені ліміти категорії ({category.min_weight || 0} - {category.max_weight || "∞"} кг).
                  </p>

                  {/* Секція перенесення */}
                  {(() => {
                    const matchingCats = getMatchingCategories(weighInDialog, weightNum);
                    if (matchingCats.length === 0) {
                      return (
                        <p className="text-[10px] text-muted-foreground">
                          Немає інших відповідних категорій для цього віку та статі.
                        </p>
                      );
                    }
                    return (
                      <div className="space-y-1.5 pt-2 border-t border-destructive/10">
                        <Label className="text-xs text-foreground font-semibold">Перенести в іншу категорію:</Label>
                        <div className="flex gap-2">
                          <Select value={targetCategoryId} onValueChange={setTargetCategoryId}>
                            <SelectTrigger className="h-8 text-xs bg-background text-foreground border-input">
                              <SelectValue placeholder="Оберіть категорію..." />
                            </SelectTrigger>
                            <SelectContent>
                              {matchingCats.map((c: Category) => {
                                const fitsWeight = (!c.min_weight || weightNum >= c.min_weight) && (!c.max_weight || weightNum <= c.max_weight);
                                return (
                                  <SelectItem key={c.id} value={c.id.toString()} className="text-xs">
                                    {c.name} ({c.min_weight || 0}-{c.max_weight || "∞"} кг) {fitsWeight ? "✓" : ""}
                                  </SelectItem>
                                );
                              })}
                            </SelectContent>
                          </Select>
                          <Button
                            type="button"
                            variant="sport"
                            size="sm"
                            className="h-8 text-xs px-3"
                            disabled={!targetCategoryId || isTransferring}
                            onClick={handleTransfer}
                          >
                            {isTransferring ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Перенести"}
                          </Button>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              );
            })()}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setWeighInDialog(null)}>Скасувати</Button>
              <Button type="submit" variant="sport">Підтвердити</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Діалог вибору формату сітки */}
      <Dialog open={generateBracketDialogOpen} onOpenChange={setGenerateBracketDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Згенерувати сітку змагань</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {category?.is_team ? (
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3.5 space-y-2 select-none">
                <span className="text-xs font-bold text-amber-500 uppercase tracking-wider block">Автоматичний вибір системи (WKF)</span>
                <p className="text-xs leading-relaxed text-zinc-300">
                  Згідно з правилами WKF/УФК, формат сітки для командних категорій визначається автоматично за кількістю підтверджених команд:
                </p>
                <ul className="list-disc list-inside text-[11px] text-zinc-400 space-y-1">
                  <li>Кругова система — від 2 до 5 команд (зараз: {confirmedPaidTeamsCount} команд)</li>
                  <li>Олімпійська система — 6 і більше команд</li>
                </ul>
                <p className="text-xs font-semibold text-white mt-1">
                  Обрано формат: <span className="text-amber-400 font-bold">{confirmedPaidTeamsCount >= 6 ? "Олімпійська сітка (на вибування)" : "Кругова система (кожен з кожним)"}</span>
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Формат турнірної сітки</Label>
                  <Select value={chosenFormat} onValueChange={(v) => { setChosenFormat(v); if (v !== "double_elimination") setChosenDoubleElimType("full"); }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="single_elimination">Олімпійська (на вибування)</SelectItem>
                      <SelectItem value="round_robin">Кругова (кожен з кожним)</SelectItem>
                      <SelectItem value="single_repechage">Олімпійська з репешажем (з доріжками)</SelectItem>
                      <SelectItem value="double_elimination">Double Elimination</SelectItem>
                      <SelectItem value="swiss">Швейцарська система</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {chosenFormat === "double_elimination" && (
                  <div className="space-y-1.5">
                    <Label>Тип Double Elimination</Label>
                    <Select value={chosenDoubleElimType} onValueChange={setChosenDoubleElimType}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="full">Класичний (з Bracket Reset)</SelectItem>
                        <SelectItem value="short">Спрощений (один фінал)</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      {chosenDoubleElimType === "full"
                        ? "Переможець нижньої частини може перемогти у фіналі та ініціювати Bracket Reset — вирішальний матч-реванш."
                        : "Єдиний Гранд Фінал між переможцями верхньої та нижньої частин — без можливості Bracket Reset."}
                    </p>
                  </div>
                )}

                {chosenFormat === "single_repechage" && (
                  <div className="p-3 rounded-lg border border-blue-500/20 bg-blue-500/5 text-[11px] text-blue-300 leading-relaxed">
                    ℹ️ <strong>Олімпійська з репешажем</strong>: після виявлення фіналістів для кожного з них автоматично генерується окрема доріжка змагань між учасниками, яких він переміг. Переможець доріжки отримує 3-є місце.
                  </div>
                )}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Формат сітки визначить спосіб розподілу поєдинків та просування переможців. Переконайтеся, що всі спортсмени пройшли зважування перед генерацією.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGenerateBracketDialogOpen(false)}>Скасувати</Button>
            <Button variant="sport" onClick={handleGenerateBracket} disabled={generatingBracket}>
              {generatingBracket ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              Згенерувати
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Діалог видалення сітки */}
      <Dialog open={deleteBracketDialogOpen} onOpenChange={setDeleteBracketDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">Вилучити турнірну сітку</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Ви впевнені, що хочете видалити згенеровану сітку поєдинків для категорії <span className="font-bold text-foreground">{category.name}</span>? Це видалить всі створені матчі. Ця дія є незворотною.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteBracketDialogOpen(false)}>Скасувати</Button>
            <Button variant="destructive" onClick={handleDeleteBracket} disabled={isDeletingBracket}>
              {isDeletingBracket ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              Вилучити сітку
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Діалог видалення категорії */}
      <Dialog open={deleteCatDialogOpen} onOpenChange={setDeleteCatDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">Вилучити категорію</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Ви впевнені, що хочете вилучити категорію <span className="font-bold text-foreground">{category.name}</span>? Ця дія повністю видалить категорію та всі пов'язані з нею реєстрації та поєдинки.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteCatDialogOpen(false)}>Скасувати</Button>
            <Button variant="destructive" onClick={onDeleteCat} disabled={isDeletingCat}>
              {isDeletingCat ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              Вилучити
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Діалог редагування категорії */}
      <Dialog open={editCatDialogOpen} onOpenChange={setEditCatDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Редагувати категорію</DialogTitle>
          </DialogHeader>
          <form onSubmit={editCategoryForm.handleSubmit(onEditCatSubmit)} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Назва категорії</Label>
              <Input placeholder="Кадети до 50 кг..." {...editCategoryForm.register("name")} />
              {editCategoryForm.formState.errors.name && (
                <p className="text-xs text-destructive">{editCategoryForm.formState.errors.name.message}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Стать</Label>
                <Select
                  value={editCategoryForm.watch("allowed_gender") || "male"}
                  onValueChange={(v) => editCategoryForm.setValue("allowed_gender", v as "male" | "female" | "mixed")}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="male">Чоловіча</SelectItem>
                    <SelectItem value="female">Жіноча</SelectItem>
                    <SelectItem value="mixed">Змішана</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Вік від</Label>
                <Input type="number" placeholder="14" {...editCategoryForm.register("min_age")} />
                {editCategoryForm.formState.errors.min_age && (
                  <p className="text-xs text-destructive">{editCategoryForm.formState.errors.min_age.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Вік до</Label>
                <Input type="number" placeholder="17" {...editCategoryForm.register("max_age")} />
                {editCategoryForm.formState.errors.max_age && (
                  <p className="text-xs text-destructive">{editCategoryForm.formState.errors.max_age.message}</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Вага від (кг, <span className="text-muted-foreground text-xs font-normal">необов'язково</span>)</Label>
                <Input type="number" placeholder="45" {...editCategoryForm.register("min_weight")} />
                {editCategoryForm.formState.errors.min_weight && (
                  <p className="text-xs text-destructive">{editCategoryForm.formState.errors.min_weight.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Вага до (кг, <span className="text-muted-foreground text-xs font-normal">необов'язково</span>)</Label>
                <Input type="number" placeholder="50" {...editCategoryForm.register("max_weight")} />
                {editCategoryForm.formState.errors.max_weight && (
                  <p className="text-xs text-destructive">{editCategoryForm.formState.errors.max_weight.message}</p>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Правила (Рулсет)</Label>
              <Select
                value={editCategoryForm.watch("ruleset_key") || ""}
                onValueChange={(v) => editCategoryForm.setValue("ruleset_key", v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Оберіть правила..." />
                </SelectTrigger>
                <SelectContent>
                  {rulesets.filter(r => {
                    const tSport = normalizeSportType(tournament?.sport_type);
                    const rSport = normalizeSportType(r.sport_type);
                    return !tSport || rSport === tSport;
                  }).map((r) => (
                    <SelectItem key={r.key} value={r.key}>
                      {r.name} ({formatSportType(r.sport_type)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Тривалість поєдинку (сек, опціонально)</Label>
              <Input type="number" placeholder="180" {...editCategoryForm.register("match_duration_seconds")} />
            </div>

            <div className="space-y-1.5">
              <Label>Допустимий рівень майстерності (опціонально)</Label>
              <Input placeholder="напр. Чорний пояс" {...editCategoryForm.register("allowed_skill_level")} />
            </div>

            <div className="flex items-center space-x-2 py-2">
              <input
                type="checkbox"
                id="edit_two_third_places"
                className="w-4 h-4 rounded border-gray-300 text-amber-500 focus:ring-amber-500"
                {...editCategoryForm.register("two_third_places")}
              />
              <Label htmlFor="edit_two_third_places" className="cursor-pointer">
                Два третіх місця (обидва півфіналісти отримують бронзу)
              </Label>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditCatDialogOpen(false)}>Скасувати</Button>
              <Button type="submit" variant="sport" disabled={isEditingCat}>
                {isEditingCat ? <Loader2 className="w-4 h-4 animate-spin" /> : "Зберегти"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Діалог підтвердження видалення заявки */}
      <Dialog open={deleteRegDialog !== null} onOpenChange={(open) => !open && setDeleteRegDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">Вилучити заявку</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Ви впевнені, що хочете видалити реєстрацію{" "}
            <span className="font-bold text-foreground">{deleteRegDialog ? formatRegistrationName(deleteRegDialog) : "учасника"}</span>?
            Ця дія незворотна.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteRegDialog(null)}>
              Скасувати
            </Button>
            <Button variant="destructive" onClick={handleDeleteRegistration} disabled={isDeletingReg}>
              {isDeletingReg ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              Вилучити
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
