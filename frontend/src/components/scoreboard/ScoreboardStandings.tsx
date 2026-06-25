import { cn, formatRegistrationName } from "@/lib/utils";
import type { CategoryResult } from "@/types/api";

interface ScoreboardStandingsProps {
  categoryResults: CategoryResult[];
  resultsCategoryName: string;
  sportAccentClass?: string;
}

export default function ScoreboardStandings({
  categoryResults,
  resultsCategoryName,
  sportAccentClass = "bg-[#0b0f15]",
}: Readonly<ScoreboardStandingsProps>) {
  const finalStandings = categoryResults
    .filter((r): r is typeof r & { place: number } => r.place != null && r.place > 0)
    .sort((a, b) => a.place - b.place);

  return (
    <div
      className={cn(
        "col-span-3 h-full w-full flex flex-col items-center justify-center p-10 md:p-12 z-50 select-none",
        sportAccentClass
      )}
    >
      <div className="text-center space-y-3 mb-10 w-full max-w-4xl">
        <h1 className="text-white font-extrabold tracking-tight text-5xl uppercase font-scoreboard">
          {resultsCategoryName}
        </h1>
        <div className="text-amber-500 font-bold tracking-[0.2em] uppercase text-sm font-scoreboard">
          ПІДСУМКОВИЙ ЗАЛІК ЗМАГАНЬ
        </div>
        <div className="w-32 h-1 bg-gradient-to-r from-transparent via-amber-500 to-transparent mx-auto mt-2" />
      </div>

      <div className="w-full max-w-3xl bg-zinc-950/60 border border-zinc-800/60 rounded-2xl p-6 shadow-2xl backdrop-blur-md space-y-3">
        {finalStandings.map((res, index) => {
          const place = res.place;
          const name = formatRegistrationName(res.registration) || res.name || "—";
          const club =
            res.registration?.athlete?.club?.name ??
            res.registration?.team?.club?.name ??
            res.club ??
            "Без клубу";
          const region =
            res.registration?.athlete?.club?.region ?? res.registration?.team?.club?.region;

          return (
            <div
              key={res.registration?.id ?? res.name ?? index}
              className={cn(
                "flex items-center justify-between p-4 rounded-xl border transition-all duration-200",
                place === 1 && "bg-yellow-500/5 border-yellow-500/20",
                place === 2 && "bg-slate-300/5 border-slate-300/10",
                place === 3 && "bg-amber-700/5 border-amber-700/10",
                place > 3 && "bg-zinc-900/40 border-zinc-800/50"
              )}
            >
              <div className="flex items-center gap-5">
                <div
                  className={cn(
                    "w-10 h-10 rounded-lg flex items-center justify-center text-xl uppercase tracking-wider font-bold shrink-0",
                    place === 1 &&
                      "bg-gradient-to-r from-yellow-500 via-amber-400 to-yellow-600 text-black font-black shadow-[0_0_20px_rgba(234,179,8,0.25)]",
                    place === 2 &&
                      "bg-gradient-to-r from-slate-300 via-zinc-200 to-slate-400 text-black font-black shadow-[0_0_20px_rgba(203,213,225,0.2)]",
                    place === 3 &&
                      "bg-gradient-to-r from-amber-700 via-amber-600 to-amber-800 text-white font-black shadow-[0_0_15px_rgba(180,83,9,0.25)]",
                    place > 3 && "bg-zinc-800 text-zinc-400"
                  )}
                >
                  {place}
                </div>

                <div className="flex flex-col">
                  <span className="text-2xl font-bold tracking-wide uppercase text-white">
                    {name}
                  </span>
                  <span className="text-sm text-zinc-400 font-medium uppercase tracking-wider">
                    {club}
                    {region ? ` (${region})` : ""}
                  </span>
                </div>
              </div>

              <div className="text-2xl select-none">
                {place === 1 && "🥇"}
                {place === 2 && "🥈"}
                {place === 3 && "🥉"}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
