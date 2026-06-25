import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Trophy, ArrowRight, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useAuthStore } from "@/store/authStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { GoogleLogin } from "@react-oauth/google";
import { toast } from "@/hooks/use-toast";

const loginSchema = z.object({
  email: z.string().email("Введіть коректний email"),
  password: z.string().min(1, "Введіть пароль"),
});
type LoginForm = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const { login, googleLogin } = useAuth();
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { register, handleSubmit, formState: { errors } } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginForm) => {
    setIsSubmitting(true);
    try {
      await login(data);
      const user = useAuthStore.getState().user;
      if (user?.role === "coach") {
        navigate("/coach/dashboard");
      } else if (user?.role === "staff") {
        navigate("/staff");
      } else {
        navigate("/tournaments");
      }
    } catch (err) {
      const axiosErr = err as { response?: { data?: { non_field_errors?: string[]; detail?: string } } };
      const errorMsg = axiosErr.response?.data?.non_field_errors?.[0] || axiosErr.response?.data?.detail;
      if (errorMsg === "email_not_verified") {
        toast({
          title: "Email не підтверджено",
          description: "Будь ласка, введіть код підтвердження, надісланий на вашу пошту.",
        });
        navigate("/confirm-email", { state: { email: data.email } });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex">
      {/* Ліва декоративна панель */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden bg-slate-900 items-center justify-center">
        <div className="absolute inset-0">
          <div className="absolute top-1/4 left-1/4 w-80 h-80 rounded-full bg-amber-500/5 blur-3xl" />
          <div className="absolute bottom-1/3 right-1/4 w-60 h-60 rounded-full bg-amber-500/10 blur-2xl" />
          <div
            className="absolute inset-0 opacity-5"
            style={{
              backgroundImage:
                "linear-gradient(hsl(var(--border)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--border)) 1px, transparent 1px)",
              backgroundSize: "40px 40px",
            }}
          />
        </div>
        <div className="relative z-10 text-center px-12">
          <div className="w-20 h-20 rounded-2xl bg-amber-500 flex items-center justify-center mx-auto mb-8 shadow-2xl shadow-amber-500/30">
            <Trophy className="w-10 h-10 text-slate-900" />
          </div>
          <h1 className="font-display text-5xl font-bold text-white tracking-tight mb-4">
            TOURNAMENT<br /><span className="text-amber-500">APP</span>
          </h1>
          <p className="text-slate-400 text-lg leading-relaxed max-w-sm mx-auto">
            Система проведення турнірних змагань з єдиноборств
          </p>
        </div>
      </div>

      {/* Права панель — форма */}
      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex items-center gap-3 mb-8">
            <div className="w-8 h-8 rounded-lg bg-amber-500 flex items-center justify-center">
              <Trophy className="w-4 h-4 text-slate-900" />
            </div>
            <span className="font-display font-bold text-xl">
              TOURNAMENT<span className="text-amber-500">APP</span>
            </span>
          </div>

          <div className="mb-8">
            <h2 className="font-display text-3xl font-bold text-foreground tracking-tight">
              Вхід до системи
            </h2>
            <p className="text-muted-foreground mt-2 text-sm">Введіть ваші облікові дані</p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email" type="email" placeholder="organizer@demo.local"
                autoComplete="email"
                className={cn(errors.email && "border-destructive")}
                {...register("email")}
              />
              {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Пароль</Label>
                <Link to="/password-reset" className="text-xs text-amber-500 hover:text-amber-400 font-medium">
                  Забули пароль?
                </Link>
              </div>
              <Input
                id="password" type="password" placeholder="••••••••"
                autoComplete="current-password"
                className={cn(errors.password && "border-destructive")}
                {...register("password")}
              />
              {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
            </div>

            <Button type="submit" variant="sport" size="lg" className="w-full mt-2" disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Увійти <ArrowRight className="w-4 h-4" /></>}
            </Button>
          </form>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">або увійти за допомогою</span>
            </div>
          </div>

          <div className="flex justify-center">
            <GoogleLogin
              onSuccess={async (credentialResponse) => {
                if (credentialResponse.credential) {
                  try {
                    const token = credentialResponse.credential;
                    const base64Url = token.split('.')[1];
                    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
                    const jsonPayload = decodeURIComponent(window.atob(base64).split('').map(function(c) {
                        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
                    }).join(''));
                    const decoded = JSON.parse(jsonPayload);

                    await googleLogin(
                      token,
                      decoded.email,
                      decoded.given_name || "",
                      decoded.family_name || ""
                    );

                    toast({
                      title: "Успішний вхід",
                      description: "Ви успішно увійшли через Google!",
                    });

                    const user = useAuthStore.getState().user;
                    if (user?.role === "coach") {
                      navigate("/coach/dashboard");
                    } else if (user?.role === "staff") {
                      navigate("/staff");
                    } else {
                      navigate("/tournaments");
                    }
                  } catch (err) {
                    console.error("Google login failed", err);
                  }
                }
              }}
              onError={() => {
                console.log("Login Failed");
              }}
              theme="filled_black"
            />
          </div>

          <p className="text-center text-sm text-muted-foreground mt-6">
            Немає акаунту?{" "}
            <Link to="/register" className="text-amber-500 hover:text-amber-400 font-medium">
              Зареєструватись
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
