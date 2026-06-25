import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Trophy, Mail, ArrowRight, Loader2, RefreshCw, ArrowLeft, KeyRound } from "lucide-react";
import { authApi, formatAxiosError, AxiosError, ErrorDetail } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";

export default function PasswordResetPage() {
  const navigate = useNavigate();
  const [stage, setStage] = useState<1 | 2>(1); // 1: request code, 2: reset password
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [isLoading, setIsLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [isResending, setIsResending] = useState(false);

  // Timer for resending code
  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  const handleRequestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      toast({
        variant: "destructive",
        title: "Помилка",
        description: "Будь ласка, введіть ваш email.",
      });
      return;
    }

    setIsLoading(true);
    try {
      await authApi.post(
        "/password-reset-request/",
        { email: email.trim() },
        { skipGlobalToast: true }
      );
      toast({
        title: "Код надіслано!",
        description: "Код для скидання пароля надіслано на вашу пошту (перевірте також консоль сервера).",
      });
      setStage(2);
      setCountdown(60);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Помилка запиту коду",
        description: formatAxiosError(err as AxiosError<ErrorDetail>),
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendCode = async () => {
    if (!email.trim()) return;
    setIsResending(true);
    try {
      await authApi.post(
        "/password-reset-request/",
        { email: email.trim() },
        { skipGlobalToast: true }
      );
      setCountdown(60);
      toast({
        title: "Код надіслано повторно",
        description: "Будь ласка, перевірте вашу скриньку або консоль сервера.",
      });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Помилка надсилання коду",
        description: formatAxiosError(err as AxiosError<ErrorDetail>),
      });
    } finally {
      setIsResending(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length !== 6) {
      toast({
        variant: "destructive",
        title: "Помилка",
        description: "Код має складатися з 6 цифр.",
      });
      return;
    }
    if (newPassword.length < 6) {
      toast({
        variant: "destructive",
        title: "Помилка",
        description: "Пароль має містити щонайменше 6 символів.",
      });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({
        variant: "destructive",
        title: "Помилка",
        description: "Паролі не збігаються.",
      });
      return;
    }

    setIsLoading(true);
    try {
      await authApi.post(
        "/password-reset-confirm/",
        {
          email: email.trim(),
          code,
          new_password: newPassword,
        },
        { skipGlobalToast: true }
      );
      toast({
        title: "Пароль змінено!",
        description: "Ви можете увійти в систему з новим паролем.",
      });
      navigate("/login");
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Помилка скидання пароля",
        description: formatAxiosError(err as AxiosError<ErrorDetail>),
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-md bg-card border border-border/60 p-8 rounded-2xl shadow-xl relative overflow-hidden">
        {/* Decorative background gradients */}
        <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/5 blur-3xl rounded-full" />
        <div className="absolute bottom-0 left-0 w-24 h-24 bg-amber-500/5 blur-2xl rounded-full" />

        <div className="flex items-center justify-between mb-8 relative z-10">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-500 flex items-center justify-center shadow-lg shadow-amber-500/20">
              <Trophy className="w-4 h-4 text-slate-900" />
            </div>
            <span className="font-display font-bold text-xl">
              TOURNAMENT<span className="text-amber-500">APP</span>
            </span>
          </div>

          <Link
            to="/login"
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Назад
          </Link>
        </div>

        {stage === 1 ? (
          /* STAGE 1: Request Code Form */
          <div className="relative z-10 animate-in fade-in-50 duration-200">
            <div className="mb-6">
              <div className="w-12 h-12 bg-amber-500/10 border border-amber-500/20 rounded-full flex items-center justify-center mb-4">
                <Mail className="w-6 h-6 text-amber-500" />
              </div>
              <h2 className="font-display text-2xl font-bold text-foreground tracking-tight">
                Відновлення пароля
              </h2>
              <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                Введіть ваш email, і ми надішлемо вам 6-значний код для підтвердження скидання пароля.
              </p>
            </div>

            <form onSubmit={handleRequestCode} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Ваш Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="email@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              </div>

              <Button
                type="submit"
                variant="sport"
                size="lg"
                className="w-full mt-2"
                disabled={isLoading || !email.trim()}
              >
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    Надіслати код <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </Button>
            </form>
          </div>
        ) : (
          /* STAGE 2: Confirm & Reset Password Form */
          <div className="relative z-10 animate-in fade-in-50 duration-200">
            <div className="mb-6">
              <div className="w-12 h-12 bg-amber-500/10 border border-amber-500/20 rounded-full flex items-center justify-center mb-4">
                <KeyRound className="w-6 h-6 text-amber-500 animate-pulse" />
              </div>
              <h2 className="font-display text-2xl font-bold text-foreground tracking-tight">
                Встановлення пароля
              </h2>
              <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                Код надіслано на <span className="font-semibold text-foreground">{email}</span>. Введіть його разом з новим паролем.
              </p>
            </div>

            <form onSubmit={handleResetPassword} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="code" className="font-bold">Код підтвердження</Label>
                <Input
                  id="code"
                  type="text"
                  placeholder="123456"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  className="text-center text-2xl font-mono tracking-[0.75em] pl-[0.75em] h-12 border-slate-800 focus:border-amber-500 focus:ring-amber-500/10"
                  autoFocus
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="newPassword">Новий пароль</Label>
                <Input
                  id="newPassword"
                  type="password"
                  placeholder="••••••••"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="confirmPassword">Підтвердіть пароль</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </div>

              <Button
                type="submit"
                variant="sport"
                size="lg"
                className="w-full mt-2"
                disabled={isLoading || code.length !== 6 || !newPassword || !confirmPassword}
              >
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    Скинути пароль <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </Button>
            </form>

            <div className="mt-6 text-center border-t border-border/40 pt-4 flex flex-col gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleResendCode}
                disabled={countdown > 0 || isResending}
                className="text-amber-500 hover:text-amber-400 hover:bg-amber-500/10 text-xs font-bold self-center"
              >
                {isResending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                ) : countdown > 0 ? (
                  <>Надіслати код повторно через {countdown} сек</>
                ) : (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Надіслати код повторно
                  </>
                )}
              </Button>

              <button
                type="button"
                onClick={() => setStage(1)}
                className="text-xs text-muted-foreground hover:text-foreground font-medium underline mt-1"
              >
                Змінити email
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
