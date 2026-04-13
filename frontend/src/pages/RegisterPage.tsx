import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Trophy, ArrowRight, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const registerSchema = z.object({
  first_name:       z.string().min(1, "Введіть ім'я"),
  last_name:        z.string().min(1, "Введіть прізвище"),
  email:            z.string().email("Введіть коректний email"),
  password:         z.string().min(8, "Мінімум 8 символів"),
  password_confirm: z.string().min(1, "Підтвердіть пароль"),
  role:             z.enum(["organizer", "coach", "judge", "spectator"]).default("spectator"),
}).refine((d) => d.password === d.password_confirm, {
  message: "Паролі не збігаються",
  path: ["password_confirm"],
});
type RegisterForm = z.infer<typeof registerSchema>;

export default function RegisterPage() {
  const { register: registerUser } = useAuth();
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { register, handleSubmit, setValue, formState: { errors } } = useForm<RegisterForm>({
    resolver: zodResolver(registerSchema),
    defaultValues: { role: "spectator" },
  });

  const onSubmit = async (data: RegisterForm) => {
    setIsSubmitting(true);
    try {
      await registerUser(data);
      navigate("/tournaments");
    } catch {
      // toast через interceptor
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
            <Select defaultValue="spectator" onValueChange={(v) => setValue("role", v as any)}>
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
    </div>
  );
}