import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Trophy, Mail, ArrowRight, Loader2, RefreshCw } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";

export default function ConfirmEmailPage() {
  const { confirmEmail, resendConfirmation, isLoading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  // Отримуємо email з роутера (state) або з пам'яті
  const stateEmail = (location.state as { email?: string })?.email;
  const [email, setEmail] = useState(stateEmail || "");
  const [code, setCode] = useState("");
  const [countdown, setCountdown] = useState(60);
  const [isResending, setIsResending] = useState(false);

  // Таймер для повторного надсилання коду
  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      toast({
        variant: "destructive",
        title: "Помилка",
        description: "Будь ласка, введіть ваш email.",
      });
      return;
    }
    if (code.length !== 6) {
      toast({
        variant: "destructive",
        title: "Помилка",
        description: "Код має складатися з 6 цифр.",
      });
      return;
    }

    try {
      await confirmEmail(email, code);
      toast({
        title: "Активація успішна!",
        description: "Ваш email підтверджено. Ласкаво просимо!",
      });
      navigate("/profile");
    } catch {
      // Помилка обробляється автоматично axios response interceptor
    }
  };

  const handleResend = async () => {
    if (!email.trim()) return;
    setIsResending(true);
    try {
      await resendConfirmation(email);
      setCountdown(60);
      toast({
        title: "Код надіслано повторно",
        description: "Будь ласка, перевірте вашу скриньку (також перевірте спам або консоль сервера).",
      });
    } catch {
      // помилка обробиться інтерцептором
    } finally {
      setIsResending(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-md bg-card border border-border/60 p-8 rounded-2xl shadow-xl relative overflow-hidden">
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
          <div className="w-12 h-12 bg-amber-500/10 border border-amber-500/20 rounded-full flex items-center justify-center mb-4">
            <Mail className="w-6 h-6 text-amber-500 animate-pulse" />
          </div>
          <h2 className="font-display text-3xl font-bold text-foreground tracking-tight">
            Підтвердження Email
          </h2>
          <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
            Ми надіслали 6-значний код підтвердження на вашу електронну адресу. Введіть його нижче для завершення реєстрації.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 relative z-10">
          {!stateEmail && (
            <div className="space-y-1.5 animate-fade-in">
              <Label htmlFor="email">Ваш Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="email@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          )}

          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <Label htmlFor="code" className="font-bold">Код активації</Label>
              {stateEmail && <span className="text-xs text-muted-foreground">{email}</span>}
            </div>
            <Input
              id="code"
              type="text"
              placeholder="123456"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className="text-center text-2xl font-mono tracking-[0.75em] pl-[0.75em] h-12 border-slate-800 focus:border-amber-500 focus:ring-amber-500/10"
              autoFocus
            />
          </div>

          <Button type="submit" variant="sport" size="lg" className="w-full mt-2" disabled={isLoading || code.length !== 6}>
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Підтвердити <ArrowRight className="w-4 h-4" /></>}
          </Button>
        </form>

        <div className="mt-8 text-center border-t border-border/40 pt-6 relative z-10">
          <p className="text-xs text-muted-foreground">Не отримали код?</p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleResend}
            disabled={countdown > 0 || isResending}
            className="text-amber-500 hover:text-amber-400 hover:bg-amber-500/10 mt-2 text-xs font-bold"
          >
            {isResending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
            ) : countdown > 0 ? (
              <>Надіслати повторно через {countdown} сек</>
            ) : (
              <>
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Надіслати код повторно
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
