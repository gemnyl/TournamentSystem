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
  patronymic:       z.string().optional(),
  email:            z.string().email("Введіть коректний email"),
  password:         z.string().min(8, "Мінімум 8 символів"),
  password_confirm: z.string().min(1, "Підтвердіть пароль"),
  phone:            z.string().min(10, "Номер телефону має бути не менше 10 символів"),
  birth_date:       z.string().min(1, "Введіть дату народження"),
  gender:           z.enum(["male", "female"], { required_error: "Оберіть стать" }),
  accept_privacy:   z.boolean().refine((val) => val === true, "Ви повинні погодитись з обробкою персональних даних"),
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
    defaultValues: { accept_privacy: false },
  });

  const onSubmit = async (data: RegisterForm) => {
    setIsSubmitting(true);
    try {
      const res = await registerUser({
        ...data,
        role: "spectator", // За замовчуванням всі реєструються як глядачі
      });
      navigate("/confirm-email", { state: { email: res.email } });
    } catch {
      // Помилка відображається через axios response interceptor
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-lg bg-card border border-border/60 p-8 rounded-2xl shadow-xl relative overflow-hidden">
        {/* Декоративний фон */}
        <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/5 blur-3xl rounded-full" />
        <div className="absolute bottom-0 left-0 w-24 h-24 bg-amber-500/5 blur-2xl rounded-full" />

        <div className="flex items-center gap-3 mb-8 relative z-10">
          <div className="w-8 h-8 rounded-lg bg-amber-500 flex items-center justify-center shadow-lg shadow-amber-500/20">
            <Trophy className="w-4 h-4 text-slate-900" />
          </div>
          <span className="font-display font-bold text-xl">
            TOURNAMENT<span className="text-amber-500">APP</span>
          </span>
        </div>

        <div className="mb-6 relative z-10">
          <h2 className="font-display text-3xl font-bold text-foreground tracking-tight">
            Реєстрація профілю
          </h2>
          <p className="text-muted-foreground mt-1.5 text-sm">
            Заповніть форму для створення особистого кабінету.
          </p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 relative z-10">
          {/* Блок імені та прізвища */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="first_name">Ім'я</Label>
              <Input
                id="first_name" placeholder="Іван"
                className={cn(errors.first_name && "border-destructive")}
                {...register("first_name")}
              />
              {errors.first_name && <p className="text-[11px] text-destructive">{errors.first_name.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="last_name">Прізвище</Label>
              <Input
                id="last_name" placeholder="Петренко"
                className={cn(errors.last_name && "border-destructive")}
                {...register("last_name")}
              />
              {errors.last_name && <p className="text-[11px] text-destructive">{errors.last_name.message}</p>}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="patronymic">По батькові (необов'язково)</Label>
            <Input
              id="patronymic" placeholder="Васильович"
              className={cn(errors.patronymic && "border-destructive")}
              {...register("patronymic")}
            />
            {errors.patronymic && <p className="text-[11px] text-destructive">{errors.patronymic.message}</p>}
          </div>

          {/* Телефон та дата народження */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="phone">Телефон</Label>
              <Input
                id="phone" placeholder="+380991234567"
                className={cn(errors.phone && "border-destructive")}
                {...register("phone")}
              />
              {errors.phone && <p className="text-[11px] text-destructive">{errors.phone.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="birth_date">Дата народження</Label>
              <Input
                id="birth_date" type="date"
                className={cn(errors.birth_date && "border-destructive")}
                {...register("birth_date")}
              />
              {errors.birth_date && <p className="text-[11px] text-destructive">{errors.birth_date.message}</p>}
            </div>
          </div>

          {/* Стать та Email */}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5 col-span-1">
              <Label>Стать</Label>
              <Select onValueChange={(v) => setValue("gender", v as "male" | "female")}>
                <SelectTrigger className={cn(errors.gender && "border-destructive")}>
                  <SelectValue placeholder="Оберіть..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="male">Чоловік</SelectItem>
                  <SelectItem value="female">Жінка</SelectItem>
                </SelectContent>
              </Select>
              {errors.gender && <p className="text-[11px] text-destructive">{errors.gender.message}</p>}
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email" type="email" placeholder="ivan@example.com"
                className={cn(errors.email && "border-destructive")}
                {...register("email")}
              />
              {errors.email && <p className="text-[11px] text-destructive">{errors.email.message}</p>}
            </div>
          </div>

          {/* Пароль та підтвердження */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="password">Пароль</Label>
              <Input
                id="password" type="password" placeholder="Мінімум 8 символів"
                autoComplete="new-password"
                className={cn(errors.password && "border-destructive")}
                {...register("password")}
              />
              {errors.password && <p className="text-[11px] text-destructive">{errors.password.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password_confirm">Підтвердження пароля</Label>
              <Input
                id="password_confirm" type="password" placeholder="Повторіть пароль"
                autoComplete="new-password"
                className={cn(errors.password_confirm && "border-destructive")}
                {...register("password_confirm")}
              />
              {errors.password_confirm && <p className="text-[11px] text-destructive">{errors.password_confirm.message}</p>}
            </div>
          </div>

          {/* Згода на обробку персональних даних */}
          <div className="space-y-2 pt-2 border-t border-border/40">
            <div className="flex items-start gap-2">
              <input
                id="accept_privacy"
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border-slate-800 bg-slate-950 text-amber-500 focus:ring-amber-500/20 cursor-pointer"
                {...register("accept_privacy")}
              />
              <Label htmlFor="accept_privacy" className="text-xs text-muted-foreground leading-normal cursor-pointer">
                Я даю згоду на обробку моїх персональних даних відповідно до{" "}
                <Link to="/privacy-policy" className="text-amber-500 hover:text-amber-400 font-semibold underline">
                  Політики конфіденційності
                </Link>{" "}
                та використання файлів cookie.
              </Label>
            </div>
            {errors.accept_privacy && <p className="text-[11px] text-destructive">{errors.accept_privacy.message}</p>}
          </div>

          <Button type="submit" variant="sport" size="lg" className="w-full mt-4" disabled={isSubmitting}>
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
