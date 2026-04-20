import { useEffect, useState } from "react";
import { Search, Loader2, UserRound, Plus, Info } from "lucide-react";
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
import type { Athlete, Club, PaginatedResponse } from "@/types/api";

// Схема для організатора (вибирає клуб)
const athleteSchemaOrganizer = z.object({
  first_name:    z.string().min(1, "Введіть ім'я"),
  last_name:     z.string().min(1, "Введіть прізвище"),
  date_of_birth: z.string().min(1, "Введіть дату народження"),
  gender:        z.enum(["M", "F"]),
  weight:        z.coerce.number().min(20).max(300),
  club:          z.coerce.number().min(1, "Оберіть клуб"),
});

// Схема для тренера (клуб підставляється автоматично)
const athleteSchemaCoach = z.object({
  first_name:    z.string().min(1, "Введіть ім'я"),
  last_name:     z.string().min(1, "Введіть прізвище"),
  date_of_birth: z.string().min(1, "Введіть дату народження"),
  gender:        z.enum(["M", "F"]),
  weight:        z.coerce.number().min(20).max(300),
});

type AthleteFormOrganizer = z.infer<typeof athleteSchemaOrganizer>;
type AthleteForm = AthleteFormOrganizer | z.infer<typeof athleteSchemaCoach>;

export default function AthletesPage() {
  const { user, isOrganizer, isCoach } = useAuth();
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [clubs,    setClubs]    = useState<Club[]>([]);
  const [isLoading, setIsLoading]   = useState(true);
  const [search, setSearch]         = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [selectedGender, setSelectedGender] = useState<"M" | "F">("M");
  const [selectedClub,   setSelectedClub]   = useState<string>("");

  const schema = isOrganizer ? athleteSchemaOrganizer : athleteSchemaCoach;

  const { register, handleSubmit, setValue, reset, formState: { errors } } =
    useForm<AthleteForm>({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      resolver: zodResolver(schema as any),
      defaultValues: { gender: "M" },
    });

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const promises: Promise<unknown>[] = [
        api.get<PaginatedResponse<Athlete> | Athlete[]>("/athletes/"),
      ];
      // Клуби потрібні тільки організатору для вибору
      if (isOrganizer) {
        promises.push(api.get<PaginatedResponse<Club> | Club[]>("/auth/clubs/"));
      }
      const [aRes, cRes] = await Promise.all(promises) as [
        { data: PaginatedResponse<Athlete> | Athlete[] },
        { data: PaginatedResponse<Club>   | Club[]    } | undefined,
      ];
      setAthletes(Array.isArray(aRes.data) ? aRes.data : aRes.data.results);
      if (cRes) setClubs(Array.isArray(cRes.data) ? cRes.data : cRes.data.results);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const filtered = athletes.filter((a) => {
    const name = `${a.first_name} ${a.last_name} ${a.full_name ?? ""}`.toLowerCase();
    return name.includes(search.toLowerCase()) ||
           (a.club?.name ?? "").toLowerCase().includes(search.toLowerCase());
  });

  const onSubmit = async (data: AthleteForm) => {
    setIsCreating(true);
    try {
      // Тренер: клуб беремо з його профілю, не питаємо
      const genderMap = { M: "male", F: "female" };
      const payload = {
        first_name: data.first_name,
        last_name: data.last_name,
        birth_date: data.date_of_birth,
        gender: genderMap[data.gender as "M" | "F"],
        base_weight: data.weight,
        club_id: isCoach && !isOrganizer ? user?.club?.id : data.club,
      };

      await api.post("/athletes/", payload);
      toast({ title: "Атлета додано!" });
      setDialogOpen(false);
      reset();
      setSelectedGender("M");
      setSelectedClub("");
      fetchData();
    } finally {
      setIsCreating(false);
    }
  };

  const canCreate = isOrganizer || isCoach;

  return (
    <div className="container py-8 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl font-bold tracking-tight">Атлети</h1>
          <p className="text-muted-foreground mt-1 text-sm">{athletes.length} атлетів у базі</p>
        </div>
        {canCreate && (
          <Button variant="sport" onClick={() => setDialogOpen(true)}>
            <Plus className="w-4 h-4" /> Додати атлета
          </Button>
        )}
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Пошук за ім'ям або клубом..."
          className="pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {isLoading ? (
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
        <div className="rounded-xl border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Ім'я</TableHead>
                <TableHead>Клуб</TableHead>
                <TableHead className="text-center">Стать</TableHead>
                <TableHead className="text-center">Вага</TableHead>
                <TableHead className="text-center">Дата нар.</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">
                    {a.full_name ?? `${a.first_name} ${a.last_name}`}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">{a.club?.name}</TableCell>
                  <TableCell className="text-center text-sm">
                    {a.gender === "male" ? "♂" : "♀"}
                  </TableCell>
                  <TableCell className="text-center font-mono text-sm">{a.base_weight} кг</TableCell>
                  <TableCell className="text-center text-sm text-muted-foreground">
                    {a.birth_date ? new Date(a.birth_date).toLocaleDateString("uk-UA") : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Діалог додавання */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Новий атлет</DialogTitle>
          </DialogHeader>

          {/* Підказка для тренера */}
          {isCoach && !isOrganizer && (
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

            <div className={isOrganizer ? "grid grid-cols-2 gap-3" : ""}>
              <div className="space-y-1.5">
                <Label>Вага (кг)</Label>
                <Input type="number" step="0.1" placeholder="68.5" {...register("weight")} />
                {errors.weight && <p className="text-xs text-destructive">{errors.weight.message}</p>}
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
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Скасувати
              </Button>
              <Button type="submit" variant="sport" disabled={isCreating}>
                {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : "Додати"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}