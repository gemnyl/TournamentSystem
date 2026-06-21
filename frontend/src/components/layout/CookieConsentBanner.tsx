import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Cookie, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function CookieConsentBanner() {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const consent = localStorage.getItem("cookie_consent_accepted");
    if (!consent) {
      // Показуємо банер з невеликою затримкою для кращого UX
      const timer = setTimeout(() => setIsVisible(true), 1500);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleAccept = () => {
    localStorage.setItem("cookie_consent_accepted", "true");
    setIsVisible(false);
  };

  if (!isVisible) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-6 md:max-w-md z-50 animate-in fade-in slide-in-from-bottom-5 duration-500">
      <div className="bg-slate-900/95 backdrop-blur-md border border-slate-800 rounded-2xl p-5 shadow-2xl shadow-black/80 flex flex-col gap-4 relative overflow-hidden">
        {/* Glow light effect */}
        <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/5 blur-2xl rounded-full pointer-events-none" />

        <div className="flex gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0 text-amber-500">
            <Cookie className="w-5 h-5 animate-bounce" />
          </div>
          <div className="space-y-1">
            <h4 className="font-display font-semibold text-white text-sm">Використання файлів Cookie</h4>
            <p className="text-slate-400 text-xs leading-relaxed">
              Ми використовуємо файли cookie для підтримки вашої сесії (протягом 7 днів) та забезпечення кращого досвіду користування. Продовжуючи перегляд, ви погоджуєтеся з нашою{" "}
              <Link to="/privacy-policy" className="text-amber-500 hover:underline hover:text-amber-400 font-semibold">
                Політикою конфіденційності
              </Link>
              .
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsVisible(false)}
            className="text-slate-400 hover:text-white text-xs"
          >
            Закрити
          </Button>
          <Button
            variant="sport"
            size="sm"
            onClick={handleAccept}
            className="text-xs font-semibold px-4"
          >
            Погодитись
          </Button>
        </div>

        <button
          onClick={() => setIsVisible(false)}
          className="absolute top-3 right-3 text-slate-500 hover:text-slate-300 transition-colors"
          aria-label="Закрити повідомлення"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
