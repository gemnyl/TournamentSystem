import { useEffect, useState, useMemo } from "react";
import { Search, Loader2, UserRound, Plus, Info, Edit2, Trash2, LayoutGrid, List } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import api from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
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
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { Athlete, Club, PaginatedResponse } from "@/types/api";
import { cn } from "@/lib/utils";

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

// Схема для організатора (вибирає клуб)
const athleteSchemaOrganizer = z.object({
  first_name:    z.string().min(1, "Введіть ім'я"),
  last_name:     z.string().min(1, "Введіть прізвище"),
  patronymic:    z.string().optional(),
  date_of_birth: z.string().min(1, "Введіть дату народження"),
  gender:        z.enum(["M", "F"]),
  weight:        z.coerce.number().min(10).max(300),
  club:          z.coerce.number().min(1, "Оберіть клуб"),
  skill_level:   z.string().optional(),
});

// Схема для тренера (клуб підставляється автоматично)
const athleteSchemaCoach = z.object({
  first_name:    z.string().min(1, "Введіть ім'я"),
  last_name:     z.string().min(1, "Введіть прізвище"),
  patronymic:    z.string().optional(),
  date_of_birth: z.string().min(1, "Введіть дату народження"),
  gender:        z.enum(["M", "F"]),
  weight:        z.coerce.number().min(10).max(300),
  skill_level:   z.string().optional(),
});

type AthleteFormOrganizer = z.infer<typeof athleteSchemaOrganizer>;
type AthleteForm = AthleteFormOrganizer | z.infer<typeof athleteSchemaCoach>;

export default function AthletesPage() {
  const { user, isOrganizer, isCoach } = useAuth();
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [clubs,    setClubs]    = useState<Club[]>([]);
  const [isLoading, setIsLoading]   = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [selectedGender, setSelectedGender] = useState<"M" | "F">("M");
  const [selectedClub,   setSelectedClub]   = useState<string>("");

  // Нові стани для CRUD, пагінації та фото
  const [editingAthlete, setEditingAthlete] = useState<Athlete | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [athleteToDelete, setAthleteToDelete] = useState<Athlete | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [nextUrl, setNextUrl] = useState<string | null>(null);

  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.get("search") ?? "";
  const view = (searchParams.get("view") as "cards" | "list") ?? "cards";

  const handleSetSearch = (val: string) => {
    const newParams = new URLSearchParams(searchParams);
    if (val) {
      newParams.set("search", val);
    } else {
      newParams.delete("search");
    }
    setSearchParams(newParams, { replace: true });
  };

  const handleSetView = (val: "cards" | "list") => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set("view", val);
    setSearchParams(newParams, { replace: true });
  };

  const schema = isOrganizer ? athleteSchemaOrganizer : athleteSchemaCoach;

  const { register, handleSubmit, setValue, reset, formState: { errors } } =
    useForm<AthleteForm>({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      resolver: zodResolver(schema as any),
      defaultValues: { gender: "M" },
    });

  const fetchData = async (resetList = true) => {
    if (resetList) {
      setIsLoading(true);
    }
    try {
      const endpoint = resetList ? "/athletes/" : getRelativePathForApi(nextUrl);
      if (!endpoint) return;

      const promises: Promise<unknown>[] = [
        api.get<PaginatedResponse<Athlete> | Athlete[]>(endpoint),
      ];
      // Клуби потрібні тільки організатору для вибору
      if (isOrganizer && resetList) {
        promises.push(api.get<PaginatedResponse<Club> | Club[]>("/auth/clubs/"));
      }
      const [aRes, cRes] = await Promise.all(promises) as [
        { data: PaginatedResponse<Athlete> | Athlete[] },
        { data: PaginatedResponse<Club>   | Club[]    } | undefined,
      ];

      const athletesData = aRes.data;
      if (Array.isArray(athletesData)) {
        setAthletes(athletesData);
        setNextUrl(null);
      } else {
        setAthletes((prev) => (resetList ? athletesData.results : [...prev, ...athletesData.results]));
        setNextUrl(athletesData.next);
      }

      if (cRes) {
        setClubs(Array.isArray(cRes.data) ? cRes.data : cRes.data.results);
      }
    } finally {
      setIsLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchData(true); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return athletes.filter((a) => {
      const name = `${a.first_name} ${a.last_name} ${a.patronymic ?? ""} ${a.full_name ?? ""}`.toLowerCase();
      return name.includes(q) || (a.club?.name ?? "").toLowerCase().includes(q);
    });
  }, [athletes, search]);

  const startEdit = (athlete: Athlete) => {
    setEditingAthlete(athlete);
    reset({
      first_name: athlete.first_name,
      last_name: athlete.last_name,
      patronymic: athlete.patronymic || "",
      date_of_birth: athlete.birth_date,
      gender: athlete.gender === "male" ? "M" : "F",
      weight: athlete.base_weight,
      skill_level: athlete.skill_level || "",
      club: athlete.club?.id || 0,
    });
    setSelectedGender(athlete.gender === "male" ? "M" : "F");
    setSelectedClub(athlete.club?.id ? String(athlete.club.id) : "");
    setSelectedFile(null);
    setDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!athleteToDelete) return;
    setIsDeleting(true);
    try {
      await api.delete(`/athletes/${athleteToDelete.id}/`);
      toast({ title: "Атлета видалено!" });
      setDeleteConfirmOpen(false);
      setAthleteToDelete(null);
      fetchData(true);
    } finally {
      setIsDeleting(false);
    }
  };

  const onSubmit = async (data: AthleteForm) => {
    setIsCreating(true);
    try {
      const genderMap = { M: "male", F: "female" };
      const isCoachOnly = isCoach && !isOrganizer;
      const clubId = isCoachOnly ? user?.club?.id : ("club" in data ? data.club : undefined);

      const formData = new FormData();
      formData.append("first_name", data.first_name);
      formData.append("last_name", data.last_name);
      if (data.patronymic) {
        formData.append("patronymic", data.patronymic);
      }
      formData.append("birth_date", data.date_of_birth);
      formData.append("gender", genderMap[data.gender as "M" | "F"]);
      formData.append("base_weight", String(data.weight));
      formData.append("skill_level", data.skill_level || "");
      if (clubId) {
        formData.append("club_id", String(clubId));
      }

      if (selectedFile) {
        formData.append("photo", selectedFile);
      }

      const headers = {
        "Content-Type": "multipart/form-data",
      };

      if (editingAthlete) {
        await api.patch(`/athletes/${editingAthlete.id}/`, formData, { headers });
        toast({ title: "Дані атлета оновлено!" });
      } else {
        await api.post("/athletes/", formData, { headers });
        toast({ title: "Атлета додано!" });
      }

      setDialogOpen(false);
      reset();
      setEditingAthlete(null);
      setSelectedFile(null);
      setSelectedGender("M");
      setSelectedClub("");
      fetchData(true);
    } finally {
      setIsCreating(false);
    }
  };

  const canManageAthletes = isCoach || user?.role === "admin";

  return (
    <div className="container py-8 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl font-bold tracking-tight">Атлети</h1>
          <p className="text-muted-foreground mt-1 text-sm">{athletes.length} атлетів у клубі</p>
        </div>
        {canManageAthletes && (
          <Button
            variant="sport"
            onClick={() => {
              setEditingAthlete(null);
              setSelectedFile(null);
              reset({
                first_name: "",
                last_name: "",
                patronymic: "",
                date_of_birth: "",
                gender: "M",
                weight: 0,
                skill_level: "",
                club: 0,
              });
              setSelectedGender("M");
              setSelectedClub("");
              setDialogOpen(true);
            }}
          >
            <Plus className="w-4 h-4" /> Додати атлета
          </Button>
        )}
      </div>

      {/* Панель пошуку та вигляду */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl border border-border/80 bg-zinc-900/50 backdrop-blur-md">
        <div className="relative w-full md:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Пошук за ім'ям або клубом..."
            className="pl-9 h-9 bg-zinc-950 border-zinc-800 text-zinc-100 placeholder:text-zinc-500 focus-visible:ring-amber-500/50"
            value={search}
            onChange={(e) => handleSetSearch(e.target.value)}
          />
        </div>

        {/* Перемикач виглядів */}
        <div className="flex items-center border border-zinc-800 rounded-lg p-0.5 bg-zinc-950 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleSetView("cards")}
            className={cn(
              "h-7 px-3 text-xs font-semibold rounded-md transition-all flex items-center gap-1",
              view === "cards"
                ? "bg-zinc-800 text-zinc-100 shadow-sm"
                : "text-zinc-400 hover:text-zinc-200"
            )}
          >
            <LayoutGrid className="w-3.5 h-3.5" /> Картки
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleSetView("list")}
            className={cn(
              "h-7 px-3 text-xs font-semibold rounded-md transition-all flex items-center gap-1",
              view === "list"
                ? "bg-zinc-800 text-zinc-100 shadow-sm"
                : "text-zinc-400 hover:text-zinc-200"
            )}
          >
            <List className="w-3.5 h-3.5" /> Список
          </Button>
        </div>
      </div>

      {isLoading && athletes.length === 0 ? (
        <div className="flex justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
          <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
            <UserRound className="w-8 h-8 text-muted-foreground" />
          </div>
          <p className="text-muted-foreground text-sm">
            {search ? "Атлетів не знайдено" : "База атлетів порожня"}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {view === "cards" ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filtered.map((a) => (
                <Card key={a.id} className="transition-all duration-200 hover:border-amber-500/40 hover:shadow-lg hover:shadow-amber-500/5 bg-zinc-900/40 border-zinc-800">
                  <CardContent className="p-4 flex gap-4">
                    {/* Фото / Заглушка */}
                    <div className="w-16 h-16 rounded-full overflow-hidden border border-zinc-800 bg-zinc-950 shrink-0 flex items-center justify-center text-lg text-amber-500 font-bold uppercase relative shadow-inner">
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

                    {/* Інформація */}
                    <div className="flex-1 min-w-0 flex flex-col justify-between">
                      <div>
                        <h3 className="font-bold text-zinc-100 truncate">
                          {a.last_name} {a.first_name}
                        </h3>
                        {a.patronymic && (
                          <p className="text-[10px] text-muted-foreground truncate">{a.patronymic}</p>
                        )}
                        <p className="text-xs text-muted-foreground truncate mt-1">
                          Клуб: <span className="text-zinc-300 font-semibold">{a.club?.name || "—"}</span>
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-xs text-muted-foreground border-t border-zinc-800/40 pt-2">
                        <span>{a.gender === "male" ? "♂ Чоловік" : "♀ Жінка"}</span>
                        <span>·</span>
                        <span>{a.base_weight} кг</span>
                        <span>·</span>
                        <span className="truncate">{a.skill_level || "—"}</span>
                        <span>·</span>
                        <span>{a.birth_date ? new Date(a.birth_date).getFullYear() : "—"} р.н.</span>
                      </div>
                    </div>

                    {/* Дії (тільки для тих хто має доступ) */}
                    {canManageAthletes && (
                      <div className="flex flex-col gap-1 self-start">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="w-7 h-7 text-muted-foreground hover:text-amber-500 hover:bg-zinc-800"
                          onClick={() => startEdit(a)}
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="w-7 h-7 text-muted-foreground hover:text-destructive hover:bg-zinc-800"
                          onClick={() => {
                            setAthleteToDelete(a);
                            setDeleteConfirmOpen(true);
                          }}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-zinc-800 overflow-hidden bg-zinc-950/20 backdrop-blur-md">
              <Table>
                <TableHeader className="bg-zinc-950/50 border-b border-zinc-800">
                  <TableRow className="hover:bg-transparent border-zinc-800">
                    <TableHead className="text-zinc-400">Ім'я</TableHead>
                    <TableHead className="text-zinc-400">Клуб</TableHead>
                    <TableHead className="text-center text-zinc-400">Стать</TableHead>
                    <TableHead className="text-center text-zinc-400">Вага</TableHead>
                    <TableHead className="text-center text-zinc-400">Рівень / Пояс</TableHead>
                    <TableHead className="text-center text-zinc-400">Дата нар.</TableHead>
                    {canManageAthletes && <TableHead className="text-center w-[100px] text-zinc-400">Дії</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((a) => (
                    <TableRow key={a.id} className="border-b border-zinc-800/60 hover:bg-zinc-900/30">
                      <TableCell className="font-medium flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full overflow-hidden border border-zinc-800 bg-zinc-950 shrink-0 flex items-center justify-center text-xs text-amber-500 font-bold uppercase relative">
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
                          <div className="text-zinc-200">{a.last_name} {a.first_name}</div>
                          {a.patronymic && <span className="text-[10px] text-muted-foreground block">{a.patronymic}</span>}
                        </div>
                      </TableCell>
                      <TableCell className="text-zinc-300">{a.club?.name || "—"}</TableCell>
                      <TableCell className="text-center text-zinc-300">
                        {a.gender === "male" ? "Чоловік (♂)" : "Жінка (♀)"}
                      </TableCell>
                      <TableCell className="text-center font-mono text-zinc-300">{a.base_weight} кг</TableCell>
                      <TableCell className="text-center text-zinc-300">{a.skill_level || "—"}</TableCell>
                      <TableCell className="text-center text-zinc-300">
                        {a.birth_date ? new Date(a.birth_date).toLocaleDateString("uk-UA") : "—"}
                      </TableCell>
                      {canManageAthletes && (
                        <TableCell className="text-center">
                          <div className="flex items-center justify-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="w-8 h-8 text-muted-foreground hover:text-amber-500 hover:bg-zinc-800"
                              onClick={() => startEdit(a)}
                            >
                              <Edit2 className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="w-8 h-8 text-muted-foreground hover:text-destructive hover:bg-zinc-800"
                              onClick={() => {
                                setAthleteToDelete(a);
                                setDeleteConfirmOpen(true);
                              }}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Пагінація "Завантажити ще" */}
          {nextUrl && (
            <div className="flex justify-center pt-6">
              <Button
                variant="outline"
                onClick={() => fetchData(false)}
                disabled={isLoading}
              >
                {isLoading && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                Завантажити ще
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Діалог додавання/редагування */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingAthlete ? "Редагувати атлета" : "Новий атлет"}</DialogTitle>
          </DialogHeader>

          {/* Підказка для тренера */}
          {isCoach && !isOrganizer && !editingAthlete && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2">
              <Info className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-200">
                Атлет буде доданий до вашого клубу автоматично.
              </p>
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Ім'я</Label>
                <Input placeholder="Іван" {...register("first_name")} />
                {errors.first_name && <p className="text-xs text-destructive">{errors.first_name.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Прізвище</Label>
                <Input placeholder="Петренко" {...register("last_name")} />
                {errors.last_name && <p className="text-xs text-destructive">{errors.last_name.message}</p>}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>По батькові</Label>
              <Input placeholder="Васильович" {...register("patronymic")} />
              {errors.patronymic && <p className="text-xs text-destructive">{errors.patronymic.message}</p>}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Дата народження</Label>
                <Input type="date" {...register("date_of_birth")} />
                {errors.date_of_birth && <p className="text-xs text-destructive">{errors.date_of_birth.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Стать</Label>
                <Select
                  value={selectedGender}
                  onValueChange={(v) => { setSelectedGender(v as "M"|"F"); setValue("gender", v as "M"|"F"); }}
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
                <Input type="number" step="0.1" placeholder="68.5" {...register("weight")} />
                {errors.weight && <p className="text-xs text-destructive">{errors.weight.message}</p>}
              </div>

              <div className="space-y-1.5">
                <Label>Рівень / Пояс</Label>
                <Input placeholder="Напр. 1 дан, КМС" {...register("skill_level")} />
                {errors.skill_level && <p className="text-xs text-destructive">{errors.skill_level.message}</p>}
              </div>
            </div>

            {/* Клуб — тільки для організатора */}
            {isOrganizer && (
              <div className="space-y-1.5">
                <Label>Клуб</Label>
                <Select
                  value={selectedClub}
                  onValueChange={(v) => { setSelectedClub(v); setValue("club", Number(v)); }}
                >
                  <SelectTrigger><SelectValue placeholder="Оберіть клуб..." /></SelectTrigger>
                  <SelectContent>
                    {clubs.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {"club" in errors && errors.club && (
                  <p className="text-xs text-destructive">{errors.club.message}</p>
                )}
              </div>
            )}

            {/* Завантаження фото */}
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
                  setDialogOpen(false);
                  setEditingAthlete(null);
                  setSelectedFile(null);
                }}
              >
                Скасувати
              </Button>
              <Button type="submit" variant="sport" disabled={isCreating}>
                {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : (editingAthlete ? "Зберегти" : "Додати")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Діалог підтвердження видалення */}
      <ConfirmDialog
        isOpen={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        onConfirm={handleDelete}
        title="Видалити спортсмена?"
        description={`Ви дійсно бажаєте видалити атлета ${athleteToDelete?.last_name} ${athleteToDelete?.first_name}? Цю дію неможливо буде скасувати.`}
        confirmText="Видалити"
        cancelText="Скасувати"
        variant="destructive"
        isLoading={isDeleting}
      />
    </div>
  );
}
