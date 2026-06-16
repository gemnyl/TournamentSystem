import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Trophy, ArrowRight, Loader2, Plus } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { Club } from "@/types/api";

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

const registerSchema = z.object({
  first_name:       z.string().min(1, "Введіть ім'я"),
  last_name:        z.string().min(1, "Введіть прізвище"),
  patronymic:       z.string().optional(),
  email:            z.string().email("Введіть коректний email"),
  password:         z.string().min(8, "Мінімум 8 символів"),
  password_confirm: z.string().min(1, "Підтвердіть пароль"),
  role:             z.enum(["organizer", "coach", "judge", "spectator"]).default("spectator"),
  club_id:          z.coerce.number().optional().nullable(),
}).refine((d) => d.password === d.password_confirm, {
  message: "Паролі не збігаються",
  path: ["password_confirm"],
}).refine((d) => {
  if (d.role === "coach") {
    return !!d.club_id;
  }
  return true;
}, {
  message: "Оберіть або створіть новий клуб",
  path: ["club_id"],
});

type RegisterForm = z.infer<typeof registerSchema>;

export default function RegisterPage() {
  const { register: registerUser } = useAuth();
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Стан для роботи з клубами
  const [clubs, setClubs] = useState<Club[]>([]);
  const [selectedRole, setSelectedRole] = useState<string>("spectator");
  const [selectedClub, setSelectedClub] = useState<string>("");
  const [isClubDialogOpen, setIsClubDialogOpen] = useState(false);
  const [newClubName, setNewClubName] = useState("");
  const [newClubRegion, setNewClubRegion] = useState("");
  const [isCreatingClub, setIsCreatingClub] = useState(false);

  const { register, handleSubmit, setValue, formState: { errors } } = useForm<RegisterForm>({
    resolver: zodResolver(registerSchema),
    defaultValues: { role: "spectator" },
  });

  const fetchClubs = async () => {
    try {
      const res = await api.get("/auth/clubs/");
      setClubs(Array.isArray(res.data) ? res.data : res.data.results || []);
    } catch (err) {
      console.error("Failed to fetch clubs", err);
    }
  };

  useEffect(() => {
    if (selectedRole === "coach") {
      fetchClubs();
    }
  }, [selectedRole]);

  const handleCreateClub = async () => {
    if (!newClubName.trim() || !newClubRegion) return;
    setIsCreatingClub(true);
    try {
      const res = await api.post<Club>("/auth/clubs/", {
        name: newClubName.trim(),
        region: newClubRegion,
      });
      const createdClub = res.data;
      setClubs((prev) => [...prev, createdClub]);
      setValue("club_id", createdClub.id);
      setSelectedClub(createdClub.id.toString());
      setIsClubDialogOpen(false);
      setNewClubName("");
      setNewClubRegion("");
    } catch (err) {
      console.error("Failed to create club", err);
    } finally {
      setIsCreatingClub(false);
    }
  };

  const onSubmit = async (data: RegisterForm) => {
    setIsSubmitting(true);
    try {
      await registerUser(data);
      navigate("/tournaments");
    } catch {
      // toast через interceptor або локально
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-8 h-8 rounded-lg bg-amber-500 flex items-center justify-center">
            <Trophy className="w-4 h-4 text-slate-900" />
          </div>
          <span className="font-display font-bold text-xl">
            TOURNAMENT<span className="text-amber-500">APP</span>
          </span>
        </div>

        <div className="mb-8">
          <h2 className="font-display text-3xl font-bold text-foreground tracking-tight">
            Реєстрація
          </h2>
          <p className="text-muted-foreground mt-2 text-sm">
            Оберіть роль для вашого профілю під час реєстрації.
          </p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="first_name">Ім'я</Label>
              <Input
                id="first_name" placeholder="Іван"
                className={cn(errors.first_name && "border-destructive")}
                {...register("first_name")}
              />
              {errors.first_name && <p className="text-xs text-destructive">{errors.first_name.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="last_name">Прізвище</Label>
              <Input
                id="last_name" placeholder="Петренко"
                className={cn(errors.last_name && "border-destructive")}
                {...register("last_name")}
              />
              {errors.last_name && <p className="text-xs text-destructive">{errors.last_name.message}</p>}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="patronymic">По батькові (необов'язково)</Label>
            <Input
              id="patronymic" placeholder="Васильович"
              className={cn(errors.patronymic && "border-destructive")}
              {...register("patronymic")}
            />
            {errors.patronymic && <p className="text-xs text-destructive">{errors.patronymic.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email" type="email" placeholder="ivan@example.com"
              className={cn(errors.email && "border-destructive")}
              {...register("email")}
            />
            {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label>Роль</Label>
            <Select
              defaultValue="spectator"
              onValueChange={(v) => {
                setValue("role", v as RegisterForm["role"]);
                setSelectedRole(v);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Оберіть роль..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="spectator">Глядач</SelectItem>
                <SelectItem value="organizer">Організатор турнірів</SelectItem>
                <SelectItem value="coach">Тренер клубу</SelectItem>
                <SelectItem value="judge">Суддя</SelectItem>
              </SelectContent>
            </Select>
            {errors.role && <p className="text-xs text-destructive">{errors.role.message}</p>}
          </div>

          {/* Вибір клубу для тренера */}
          {selectedRole === "coach" && (
            <div className="space-y-1.5 p-3 border border-amber-500/20 bg-amber-500/5 rounded-lg">
              <div className="flex items-center justify-between">
                <Label>Спортивний клуб</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-amber-500 hover:text-amber-400 hover:bg-amber-500/10 flex items-center gap-1 px-2"
                  onClick={() => setIsClubDialogOpen(true)}
                >
                  <Plus className="w-3 h-3" /> Створити новий
                </Button>
              </div>

              <Select
                value={selectedClub}
                onValueChange={(v) => {
                  setSelectedClub(v);
                  setValue("club_id", Number(v));
                }}
              >
                <SelectTrigger className={cn(errors.club_id && "border-destructive")}>
                  <SelectValue placeholder="Оберіть ваш club..." />
                </SelectTrigger>
                <SelectContent>
                  {clubs.map((c) => (
                    <SelectItem key={c.id} value={c.id.toString()}>
                      {c.name} ({UKRAINIAN_REGIONS.find(r => r.value === c.region)?.label ?? c.region})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.club_id && <p className="text-xs text-destructive">{errors.club_id.message}</p>}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="password">Пароль</Label>
            <Input
              id="password" type="password" placeholder="Мінімум 8 символів"
              autoComplete="new-password"
              className={cn(errors.password && "border-destructive")}
              {...register("password")}
            />
            {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password_confirm">Підтвердження пароля</Label>
            <Input
              id="password_confirm" type="password" placeholder="Повторіть пароль"
              autoComplete="new-password"
              className={cn(errors.password_confirm && "border-destructive")}
              {...register("password_confirm")}
            />
            {errors.password_confirm && <p className="text-xs text-destructive">{errors.password_confirm.message}</p>}
          </div>

          <Button type="submit" variant="sport" size="lg" className="w-full mt-2" disabled={isSubmitting}>
            {isSubmitting
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <>Зареєструватись <ArrowRight className="w-4 h-4" /></>}
          </Button>
        </form>

        <p className="text-center text-sm text-muted-foreground mt-6">
          Вже маєте акаунт?{" "}
          <Link to="/login" className="text-amber-500 hover:text-amber-400 font-medium">
            Увійти
          </Link>
        </p>
      </div>

      {/* Діалог створення клубу */}
      <Dialog open={isClubDialogOpen} onOpenChange={setIsClubDialogOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Створити спортивний клуб</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="club_name">Назва клубу</Label>
              <Input
                id="club_name"
                placeholder="СК Сакура"
                value={newClubName}
                onChange={(e) => setNewClubName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Регіон (область)</Label>
              <Select value={newClubRegion} onValueChange={setNewClubRegion}>
                <SelectTrigger>
                  <SelectValue placeholder="Оберіть регіон..." />
                </SelectTrigger>
                <SelectContent>
                  {UKRAINIAN_REGIONS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setIsClubDialogOpen(false);
                setNewClubName("");
                setNewClubRegion("");
              }}
            >
              Скасувати
            </Button>
            <Button
              type="button"
              variant="sport"
              onClick={handleCreateClub}
              disabled={isCreatingClub || !newClubName.trim() || !newClubRegion}
            >
              {isCreatingClub ? <Loader2 className="w-4 h-4 animate-spin" /> : "Створити"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
