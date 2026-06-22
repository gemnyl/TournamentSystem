import { useState } from "react";
import {
  Trophy,
  ShieldCheck,
  Database,
  Target,
  Lock,
  Users,
  Server,
  Cookie,
  Scale,
  ExternalLink,
  Mail,
  ChevronRight,
  ShieldAlert
} from "lucide-react";

export default function PrivacyPolicyPage() {
  const [activeSection, setActiveSection] = useState("section-1");

  const sections = [
    { id: "section-1", title: "1. Загальні положення", icon: ShieldCheck },
    { id: "section-2", title: "2. Які дані ми збираємо", icon: Database },
    { id: "section-3", title: "3. Мета використання", icon: Target },
    { id: "section-4", title: "4. Захист ваших даних", icon: Lock },
    { id: "section-5", title: "5. Дані неповнолітніх", icon: Users },
    { id: "section-6", title: "6. Передача та зберігання", icon: Server },
    { id: "section-7", title: "7. Файли Cookie", icon: Cookie },
    { id: "section-8", title: "8. Ваші права", icon: Scale },
  ];

  const scrollToSection = (id: string) => {
    setActiveSection(id);
    const element = document.getElementById(id);
    if (element) {
      // Offset for sticky headers
      const yOffset = -90;
      const y = element.getBoundingClientRect().top + window.pageYOffset + yOffset;
      window.scrollTo({ top: y, behavior: "smooth" });
    }
  };

  return (
    <div className="container max-w-6xl mx-auto py-10 px-4 md:px-8">
      {/* Шапка */}
      <div className="relative bg-slate-900/40 border border-slate-800/80 rounded-3xl p-6 md:p-10 mb-10 overflow-hidden shadow-xl">
        <div className="absolute top-0 right-0 w-80 h-80 bg-amber-500/5 blur-3xl rounded-full pointer-events-none" />

        <div className="flex items-center gap-3 mb-6 relative z-10">
          <div className="w-10 h-10 rounded-xl bg-amber-500 flex items-center justify-center shadow-lg shadow-amber-500/20">
            <Trophy className="w-5 h-5 text-slate-950" />
          </div>
          <span className="font-display font-bold text-xl text-white">
            TOURNAMENT<span className="text-amber-500">APP</span>
          </span>
        </div>

        <h1 className="text-3xl md:text-4xl font-display font-bold text-white mb-3">
          Політика конфіденційності та використання Cookie
        </h1>
        <p className="text-slate-400 text-sm max-w-2xl">
          Ми поважаємо вашу приватність і прагнемо забезпечити максимальний рівень безпеки ваших даних відповідно до чинного законодавства.
        </p>
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-500 border border-amber-500/20 mt-4">
          Останнє оновлення: 22 червня 2026 року
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Бокове меню (тільки для великих екранів) */}
        <div className="hidden lg:block">
          <div className="sticky top-24 bg-slate-900/20 border border-slate-800/60 rounded-2xl p-4 space-y-1">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 mb-3">Зміст</h3>
            {sections.map((s) => {
              const Icon = s.icon;
              const isActive = activeSection === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => scrollToSection(s.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left text-xs font-semibold transition-all ${
                    isActive
                      ? "bg-amber-500/10 text-amber-500 border border-amber-500/20"
                      : "text-slate-400 hover:text-white hover:bg-slate-800/30 border border-transparent"
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="line-clamp-2 leading-tight pr-1">{s.title}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Текстовий контент */}
        <div className="lg:col-span-3 space-y-8">
          {/* 1. Загальні положення */}
          <section
            id="section-1"
            className="bg-slate-900/10 border border-slate-800/80 rounded-2xl p-6 md:p-8 space-y-4 hover:border-slate-800 transition-colors"
          >
            <h2 className="flex items-center gap-2.5 text-lg md:text-xl font-display font-bold text-white">
              <ShieldCheck className="w-5 h-5 text-amber-500" />
              1. Загальні положення
            </h2>
            <p className="text-slate-300 text-sm md:text-base leading-relaxed">
              Ця Політика конфіденційності пояснює, як платформа <strong>TournamentApp</strong> збирає, використовує та захищає ваші персональні дані. Ми поважаємо вашу приватність і прагнемо забезпечити максимальний рівень безпеки ваших даних відповідно до{" "}
              <a
                href="https://zakon.rada.gov.ua/laws/show/2297-17"
                target="_blank"
                rel="noopener noreferrer"
                className="text-amber-500 hover:underline inline-flex items-center gap-1 font-semibold"
              >
                Закону України «Про захист персональних даних» <ExternalLink className="w-3 h-3" />
              </a>{" "}
              та{" "}
              <a
                href="https://zakon.rada.gov.ua/laws/show/984_011"
                target="_blank"
                rel="noopener noreferrer"
                className="text-amber-500 hover:underline inline-flex items-center gap-1 font-semibold"
              >
                Загального регламенту про захист даних (GDPR) <ExternalLink className="w-3 h-3" />
              </a>.
            </p>
          </section>

          {/* 2. Які дані ми збираємо */}
          <section
            id="section-2"
            className="bg-slate-900/10 border border-slate-800/80 rounded-2xl p-6 md:p-8 space-y-4 hover:border-slate-800 transition-colors"
          >
            <h2 className="flex items-center gap-2.5 text-lg md:text-xl font-display font-bold text-white">
              <Database className="w-5 h-5 text-amber-500" />
              2. Які дані ми збираємо
            </h2>
            <p className="text-slate-300 text-sm md:text-base leading-relaxed">
              Для того, щоб ви могли комфортно користуватися платформою, реєструватися на турніри та слідкувати за статистикою, ми збираємо такі дані:
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
              <div className="p-4 border border-slate-800/40 rounded-xl bg-slate-950/20">
                <span className="block text-xs font-bold text-slate-500 uppercase mb-2">Особиста інформація</span>
                <p className="text-xs md:text-sm text-slate-400">
                  Прізвище, ім'я, по батькові, стать та дата народження.
                </p>
              </div>
              <div className="p-4 border border-slate-800/40 rounded-xl bg-slate-950/20">
                <span className="block text-xs font-bold text-slate-500 uppercase mb-2">Контактні дані</span>
                <p className="text-xs md:text-sm text-slate-400">
                  Адреса електронної пошти та номер телефону.
                </p>
              </div>
              <div className="p-4 border border-slate-800/40 rounded-xl bg-slate-950/20">
                <span className="block text-xs font-bold text-slate-500 uppercase mb-2">Спортивні дані</span>
                <p className="text-xs md:text-sm text-slate-400">
                  Належність до спортивного клубу, рівень майстерності (пояс/дан), суддівська категорія та історія виступів.
                </p>
              </div>
              <div className="p-4 border border-slate-800/40 rounded-xl bg-slate-950/20">
                <span className="block text-xs font-bold text-slate-500 uppercase mb-2">Технічні дані</span>
                <p className="text-xs md:text-sm text-slate-400">
                  Фото профілю, файли cookie для підтримки авторизованих сесій, IP-адреси.
                </p>
              </div>
            </div>
          </section>

          {/* 3. Для чого ми використовуємо ваші дані */}
          <section
            id="section-3"
            className="bg-slate-900/10 border border-slate-800/80 rounded-2xl p-6 md:p-8 space-y-4 hover:border-slate-800 transition-colors"
          >
            <h2 className="flex items-center gap-2.5 text-lg md:text-xl font-display font-bold text-white">
              <Target className="w-5 h-5 text-amber-500" />
              3. Для чого ми використовуємо ваші дані
            </h2>
            <p className="text-slate-300 text-sm md:text-base leading-relaxed">
              Ваші дані необхідні нам виключно для забезпечення роботи платформи, а саме для:
            </p>
            <ul className="space-y-2.5 text-slate-400 text-sm md:text-base">
              {["Реєстрації учасників на змагання та автоматичного формування турнірних сіток.",
                "Верифікації ролей користувачів (Організатор, Тренер, Суддя, Спортсмен).",
                "Ведення об'єктивної турнірної статистики та публічної історії змагань.",
                "Забезпечення швидкого зворотного зв'язку та технічної підтримки."
              ].map((item, idx) => (
                <li key={idx} className="flex gap-2 items-start">
                  <ChevronRight className="w-4 h-4 text-amber-500 shrink-0 mt-1" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>

          {/* 4. Захист ваших даних */}
          <section
            id="section-4"
            className="bg-slate-900/10 border border-slate-800/80 rounded-2xl p-6 md:p-8 space-y-4 hover:border-slate-800 transition-colors"
          >
            <h2 className="flex items-center gap-2.5 text-lg md:text-xl font-display font-bold text-white">
              <Lock className="w-5 h-5 text-amber-500" />
              4. Захист ваших даних
            </h2>
            <p className="text-slate-300 text-sm md:text-base leading-relaxed">
              Ми серйозно ставимося до безпеки і використовуємо сучасні стандарти захисту:
            </p>
            <div className="space-y-4">
              <div className="flex gap-4 p-4 border border-slate-800/40 rounded-xl bg-slate-950/20">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
                  <Lock className="w-4 h-4 text-emerald-400" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white">Безпека паролів</h4>
                  <p className="text-xs md:text-sm text-slate-400 mt-1">
                    Ваші паролі надійно шифруються за допомогою сучасних криптографічних алгоритмів. Ми не зберігаємо їх у відкритому вигляді.
                  </p>
                </div>
              </div>
              <div className="flex gap-4 p-4 border border-slate-800/40 rounded-xl bg-slate-950/20">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white">Контроль доступу та приватність</h4>
                  <p className="text-xs md:text-sm text-slate-400 mt-1">
                    Чутлива інформація (наприклад, ваш номер телефону чи точна дата народження) прихована від публічного перегляду. Доступ до неї мають лише ви та авторизовані організатори турнірів у межах своїх повноважень.
                  </p>
                </div>
              </div>
              <div className="flex gap-4 p-4 border border-slate-800/40 rounded-xl bg-slate-950/20">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
                  <ShieldAlert className="w-4 h-4 text-emerald-400" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white">Захист від зломів та Throttling</h4>
                  <p className="text-xs md:text-sm text-slate-400 mt-1">
                    Платформа обладнана автоматичними системами блокування при підозрілих спробах входу, щоб надійно захистити ваш акаунт від підбору пароля (brute-force атак).
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* 5. Обробка даних неповнолітніх */}
          <section
            id="section-5"
            className="bg-slate-900/10 border border-slate-800/80 rounded-2xl p-6 md:p-8 space-y-4 hover:border-slate-800 transition-colors"
          >
            <h2 className="flex items-center gap-2.5 text-lg md:text-xl font-display font-bold text-white">
              <Users className="w-5 h-5 text-amber-500" />
              5. Обробка даних неповнолітніх
            </h2>
            <div className="p-4 border border-amber-500/10 bg-amber-500/5 rounded-xl text-slate-300 text-sm md:text-base leading-relaxed">
              Оскільки у спортивних змаганнях бере участь велика кількість дітей, TournamentApp приділяє особливу увагу їхній безпеці. Ми не збираємо дані осіб віком до 16 років без згоди їхніх законних представників.
            </div>
            <p className="text-slate-400 text-xs md:text-sm leading-relaxed">
              Реєстрацію неповнолітніх спортсменів та управління їхніми профілями здійснюють виключно їхні батьки або верифіковані Тренери, які несуть повну відповідальність за надання законної згоди на обробку цих даних.
            </p>
          </section>

          {/* 6. Передача та зберігання даних */}
          <section
            id="section-6"
            className="bg-slate-900/10 border border-slate-800/80 rounded-2xl p-6 md:p-8 space-y-4 hover:border-slate-800 transition-colors"
          >
            <h2 className="flex items-center gap-2.5 text-lg md:text-xl font-display font-bold text-white">
              <Server className="w-5 h-5 text-amber-500" />
              6. Передача та зберігання даних
            </h2>
            <p className="text-slate-300 text-sm md:text-base leading-relaxed">
              Ми <strong>не продаємо</strong> і не передаємо ваші дані стороннім маркетинговим або рекламним компаніям. Ваші дані можуть оброблятися лише нашими надійними технічними партнерами (наприклад, провайдерами захищеного хмарного хостингу), які забезпечують безперебійну роботу системи, за умови суворого дотримання угод про конфіденційність.
            </p>
            <div className="p-4 border border-slate-800/40 rounded-xl bg-slate-950/20 text-xs md:text-sm text-slate-400 space-y-2">
              <p>
                <strong>Термін зберігання:</strong> Ми зберігаємо ваші дані, поки ваш акаунт залишається активним. У разі видалення профілю персональні дані безповоротно стираються або анонімізуються.
              </p>
              <p className="italic">
                * Зверніть увагу: результати проведених турнірів (статистика, сітки) зберігаються у знеособленому вигляді для підтримки історичної цілісності результатів змагань.
              </p>
            </div>
          </section>

          {/* 7. Файли Cookie */}
          <section
            id="section-7"
            className="bg-slate-900/10 border border-slate-800/80 rounded-2xl p-6 md:p-8 space-y-4 hover:border-slate-800 transition-colors"
          >
            <h2 className="flex items-center gap-2.5 text-lg md:text-xl font-display font-bold text-white">
              <Cookie className="w-5 h-5 text-amber-500" />
              7. Файли Cookie
            </h2>
            <p className="text-slate-300 text-sm md:text-base leading-relaxed">
              Ми використовуємо файли cookie виключно для технічних потреб — щоб підтримувати вашу авторизацію на платформі та захистити вашу сесію від перехоплення сторонніми скриптами (CSRF/XSS-захист).
            </p>
            <div className="p-4 border border-slate-800/60 bg-slate-950/40 rounded-xl">
              <span className="block text-xs font-bold text-slate-500 uppercase mb-1">Термін дії сесії</span>
              <p className="text-sm text-slate-300">
                Для вашої безпеки сесія триває <strong>7 днів</strong>. Після цього терміну система автоматично попросить вас увійти знову. Ми не використовуємо cookie для відстеження вашої поведінки в інтернеті чи показу реклами.
              </p>
            </div>
          </section>

          {/* 8. Ваші права */}
          <section
            id="section-8"
            className="bg-slate-900/10 border border-slate-800/80 rounded-2xl p-6 md:p-8 space-y-4 hover:border-slate-800 transition-colors"
          >
            <h2 className="flex items-center gap-2.5 text-lg md:text-xl font-display font-bold text-white">
              <Scale className="w-5 h-5 text-amber-500" />
              8. Ваші права
            </h2>
            <p className="text-slate-300 text-sm md:text-base leading-relaxed">
              Ви маєте повний контроль над своїми даними. Згідно з вимогами GDPR та законів України, ви маєте право:
            </p>
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-3 text-slate-400 text-xs md:text-sm">
              {[
                "Отримувати доступ до своїх даних та редагувати їх в «Особистому кабінеті».",
                "Вимагати повного видалення вашого профілю («право бути забутим»).",
                "Зробити запит на експорт ваших даних у зручному структурованому форматі.",
                "Обмежити або відкликати згоду на обробку певних даних.",
                "Подати скаргу до уповноваженого органу із захисту персональних даних у разі порушення ваших прав."
              ].map((right, idx) => (
                <li key={idx} className="p-3 border border-slate-800/40 rounded-xl bg-slate-950/20 flex gap-2">
                  <span className="text-amber-500 font-bold shrink-0">{idx + 1}.</span>
                  <span>{right}</span>
                </li>
              ))}
            </ul>

            <div className="flex flex-col sm:flex-row gap-4 items-center justify-between p-4 border border-slate-800 rounded-xl bg-slate-950/40 mt-6">
              <div className="flex gap-3 items-center">
                <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0">
                  <Mail className="w-5 h-5 text-amber-500" />
                </div>
                <div className="text-left">
                  <h4 className="text-sm font-bold text-white">Служба підтримки</h4>
                  <p className="text-xs text-slate-400">З будь-яких питань щодо приватності</p>
                </div>
              </div>
              <a
                href="mailto:support@tournamentapp.local"
                className="w-full sm:w-auto px-4 py-2 text-center rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition-colors"
              >
                support@tournamentapp.local
              </a>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
