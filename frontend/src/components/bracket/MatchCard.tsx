import { cn, formatRegistrationName, formatRegistrationClub, formatAthleteName } from "@/lib/utils";
import type { Match, Registration } from "@/types/api";

interface MatchCardProps {
  match: Match;
  /** Якщо true — менший режим (у списку) */
  compact?: boolean;
  onClick?: (match: Match) => void;
}

function participantName(reg: Registration | null, roundIndex: number): string {
  if (!reg) {
    const isFirstRound = roundIndex === 0 || roundIndex === 1 || roundIndex === 100 || roundIndex === 101;
    return isFirstRound ? "BYE" : "Очікується переможець";
  }
  return formatRegistrationName(reg) || "TBD";
}

/** Назва клубу */
function participantClub(reg: Registration | null): string {
  return formatRegistrationClub(reg);
}


/** Повертає значок призового місця */
function getPlaceBadge(place: number | null | undefined): string {
  if (!place) return "";
  if (place === 1) return "🥇";
  if (place === 2) return "🥈";
  if (place === 3) return "🥉";
  return `(${place})`;
}

/** Повертає колір лівого бордера відповідно до рівня (поясу) атлета */
function getBeltColorClass(skillLevel?: string): string {
  if (!skillLevel) return "border-l-transparent";
  const belt = skillLevel.toLowerCase();
  if (belt.includes("білий") || belt.includes("жовтий") || belt.includes("white") || belt.includes("yellow")) {
    return "border-l-yellow-400";
  }
  if (belt.includes("помаранч") || belt.includes("зелен") || belt.includes("orange") || belt.includes("green")) {
    return "border-l-green-400";
  }
  if (belt.includes("синій") || belt.includes("blue")) {
    return "border-l-blue-400";
  }
  if (belt.includes("коричн") || belt.includes("brown")) {
    return "border-l-amber-700";
  }
  if (belt.includes("чорн") || belt.includes("black")) {
    return "border-l-zinc-800";
  }
  return "border-l-transparent";
}

export function MatchCard({ match, compact = false, onClick }: MatchCardProps) {
  const isBye   = !match.reg_first || !match.reg_second;
  const isDone  = match.status === "completed";
  const isLive  = match.status === "ongoing";
  const isKata  = match.judging_mode === "flags";

  const firstWon  = isDone && match.winner === match.reg_first?.id;
  const secondWon = isDone && match.winner === match.reg_second?.id;

  const displayScoreFirst = isKata ? (match.flags_aka ?? 0) : match.score_first;
  const displayScoreSecond = isKata ? (match.flags_ao ?? 0) : match.score_second;

  const isTeam = match.category_is_team && match.team_bouts && match.team_bouts.length > 0;

  // Calculate team wins
  const winsAka = match.team_bouts
    ? match.team_bouts.filter(b => b.status === "completed" && b.winner === match.reg_first?.id).length
    : 0;
  const winsAo = match.team_bouts
    ? match.team_bouts.filter(b => b.status === "completed" && b.winner === match.reg_second?.id).length
    : 0;

  const handleClick = () => { if (onClick && !isBye) onClick(match); };

  if (isTeam && !compact) {
    return (
      <button
        type="button"
        disabled={!onClick || isBye}
        onClick={handleClick}
        className={cn(
          "rounded-xl border backdrop-blur-md bg-card/65 border-border/70 transition-all duration-300 overflow-hidden shadow-sm flex flex-col justify-between text-left outline-none focus:ring-1 focus:ring-amber-500/50",
          !isBye && onClick && "cursor-pointer hover:border-amber-500/50 hover:shadow-lg hover:shadow-amber-500/5 hover:translate-y-[-1px]",
          isLive && "border-amber-500/80 shadow-md shadow-amber-500/20 ring-2 ring-amber-500/55 bg-amber-500/5",
          "w-72 py-1.5",
          (match.team_bouts?.length ?? 0) > 3 ? "h-[180px]" : "h-[140px]"
        )}
      >
        {/* Live-indicator */}
        {isLive && (
          <div className="flex items-center gap-1.5 px-3 pt-1 pb-1">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping" />
            <span className="text-[8px] font-black text-amber-400 uppercase tracking-widest">LIVE MATCH</span>
          </div>
        )}

        {/* Team Header */}
        <div className="flex items-center justify-between px-3 py-1.5 bg-muted/15 border-b border-border/30 select-none">
          <div className="flex-1 text-left min-w-0 pr-1">
            <p className={cn(
              "text-[10px] font-black tracking-wide truncate text-red-500",
              firstWon && "text-emerald-400"
            )}>
              {firstWon && "✓ "}{match.reg_first?.team?.name ?? "TBD Aka"}
            </p>
          </div>
          <div className="font-mono text-[10px] font-black text-amber-400 shrink-0 px-1.5 bg-zinc-950/65 py-0.5 rounded border border-zinc-800/80">
            {winsAka} : {winsAo}
          </div>
          <div className="flex-1 text-right min-w-0 pl-1">
            <p className={cn(
              "text-[10px] font-black tracking-wide truncate text-blue-500",
              secondWon && "text-emerald-400"
            )}>
              {match.reg_second?.team?.name ?? "TBD Ao"}{secondWon && " ✓"}
            </p>
          </div>
        </div>

        {/* Individual sub-bouts list */}
        <div className="flex-1 py-1 divide-y divide-border/20">
          {match.team_bouts?.map((bout) => {
            const boutAka = formatAthleteName(bout.athlete_first) || "TBD";
            const boutAo = formatAthleteName(bout.athlete_second) || "TBD";
            const scoreA = bout.judging_mode === "flags" ? (bout.flags_aka ?? 0) : (bout.score_first ?? 0);
            const scoreB = bout.judging_mode === "flags" ? (bout.flags_ao ?? 0) : (bout.score_second ?? 0);
            const isBoutDone = bout.status === "completed";
            const isBoutLive = bout.status === "ongoing";
            const akaWon = isBoutDone && bout.winner === match.reg_first?.id;
            const aoWon = isBoutDone && bout.winner === match.reg_second?.id;

            return (
              <div
                key={bout.id}
                className={cn(
                  "flex items-center justify-between gap-1.5 px-3 py-1 text-[9px] transition-all",
                  isBoutLive && "bg-amber-500/10 font-bold",
                )}
              >
                {/* AKA Athlete */}
                <span className={cn(
                  "truncate w-[43%] text-left text-red-400/90 font-medium",
                  akaWon && "text-emerald-400 font-bold",
                  isBoutDone && !akaWon && "opacity-45"
                )}>
                  {akaWon && "✓ "}{boutAka}
                </span>

                {/* Bout Score */}
                <span className={cn(
                  "font-mono text-[9px] font-black w-[14%] text-center shrink-0",
                  isBoutLive ? "text-amber-400 animate-pulse" : "text-foreground/70"
                )}>
                  {bout.status === "scheduled" ? "—" : `${scoreA}:${scoreB}`}
                </span>

                {/* AO Athlete */}
                <span className={cn(
                  "truncate w-[43%] text-right text-blue-400/90 font-medium",
                  aoWon && "text-emerald-400 font-bold",
                  isBoutDone && !aoWon && "opacity-45"
                )}>
                  {boutAo}{aoWon && " ✓"}
                </span>
              </div>
            );
          })}
        </div>

        {/* Win method details if completed */}
        {isDone && match.win_method && (
          <div className="px-3 py-1 border-t border-border/30 bg-muted/10 text-center w-full">
            <span className="text-[8px] text-amber-500/90 font-bold tracking-wider uppercase">
              Перемога: {match.win_method}
            </span>
          </div>
        )}
      </button>
    );
  }

  if (isTeam && compact) {
    return (
      <button
        type="button"
        disabled={!onClick || isBye}
        onClick={handleClick}
        className={cn(
          "rounded-xl border backdrop-blur-md bg-card/65 border-border/70 transition-all duration-300 overflow-hidden shadow-sm flex flex-col justify-center text-left outline-none focus:ring-1 focus:ring-amber-500/50",
          !isBye && onClick && "cursor-pointer hover:border-amber-500/50 hover:shadow-lg hover:shadow-amber-500/5 hover:translate-y-[-1px]",
          isLive && "border-amber-500/80 shadow-md shadow-amber-500/20 ring-2 ring-amber-500/55 bg-amber-500/5",
          isBye && "opacity-30",
          "w-60 min-h-[60px] py-1"
        )}
      >
        <div className="flex items-center justify-between px-3 py-1 select-none">
          <div className="flex-1 text-left min-w-0 pr-1">
            <p className={cn(
              "text-[10px] font-black truncate text-red-500",
              firstWon && "text-emerald-400"
            )}>
              {firstWon && "✓ "}{match.reg_first?.team?.name ?? "TBD Aka"}
            </p>
          </div>
          <div className="font-mono text-[10px] font-black text-amber-400 shrink-0 px-1.5 bg-zinc-950/65 py-0.5 rounded border border-zinc-800/80">
            {winsAka} : {winsAo}
          </div>
          <div className="flex-1 text-right min-w-0 pl-1">
            <p className={cn(
              "text-[10px] font-black truncate text-blue-500",
              secondWon && "text-emerald-400"
            )}>
              {match.reg_second?.team?.name ?? "TBD Ao"}{secondWon && " ✓"}
            </p>
          </div>
        </div>
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={!onClick || isBye}
      onClick={handleClick}
      className={cn(
        "rounded-xl border backdrop-blur-md bg-card/65 border-border/70 transition-all duration-300 overflow-hidden shadow-sm text-left outline-none focus:ring-1 focus:ring-amber-500/50",
        "h-[108px] py-1.5 flex flex-col justify-center",
        !isBye && onClick && "cursor-pointer hover:border-amber-500/50 hover:shadow-lg hover:shadow-amber-500/5 hover:translate-y-[-1px]",
        isLive && "border-amber-500/80 shadow-md shadow-amber-500/20 ring-2 ring-amber-500/55 bg-amber-500/5",
        isBye && "opacity-30",
        compact ? "min-w-[220px] w-60" : "min-w-[280px] w-72"
      )}
    >
      {/* Live-індикатор */}
      {isLive && (
        <div className="flex items-center gap-1.5 px-3 pt-2.5 pb-0">
          <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
          <span className="text-[9px] font-black text-amber-400 uppercase tracking-widest">LIVE MATCH</span>
        </div>
      )}

      {/* Учасник 1 (AKA) */}
      <div className={cn(
        "flex items-center justify-between gap-2 px-3 py-1 border-l-[4px] transition-all",
        getBeltColorClass(match.reg_first?.athlete?.skill_level),
        firstWon && "bg-emerald-500/10",
        isDone && !firstWon && match.reg_first && "opacity-40 filter grayscale-[20%]",
      )}>
        <div className="min-w-0 flex-1 flex items-center gap-1.5">
          <span className="text-[8px] font-bold text-red-500 bg-red-500/10 border border-red-500/20 px-1 py-0.5 rounded shrink-0 leading-none">
            AKA
          </span>
          <div className="min-w-0 flex-1">
            <p className={cn(
              "text-xs font-semibold leading-normal text-foreground/90 truncate",
              !match.reg_first && "text-muted-foreground italic",
              firstWon && "text-emerald-400 font-bold",
            )}>
              {firstWon && <span className="text-emerald-500 font-bold mr-1">✓</span>}
              <span>{participantName(match.reg_first, match.round_index)}</span>
              {match.reg_first?.place && match.reg_first.place > 0 && (
                <span className="text-[10px] font-bold ml-1" title={`${match.reg_first.place} місце`}>
                  {getPlaceBadge(match.reg_first.place)}
                </span>
              )}
            </p>
            {!compact && match.reg_first && (
              <p className="text-[9px] text-muted-foreground truncate leading-none">{participantClub(match.reg_first)}</p>
            )}
          </div>
        </div>
        <span className={cn(
          "font-mono text-base font-black shrink-0 w-6 text-right",
          firstWon ? "text-emerald-400" : "text-foreground/80",
        )}>
          {match.reg_first ? displayScoreFirst : ""}
        </span>
      </div>

      {/* Роздільник */}
      <div className="h-px bg-border/60 mx-3" />

      {/* Учасник 2 (AO) */}
      <div className={cn(
        "flex items-center justify-between gap-2 px-3 py-1 border-l-[4px] transition-all",
        getBeltColorClass(match.reg_second?.athlete?.skill_level),
        secondWon && "bg-emerald-500/10",
        isDone && !secondWon && match.reg_second && "opacity-40 filter grayscale-[20%]",
      )}>
        <div className="min-w-0 flex-1 flex items-center gap-1.5">
          <span className="text-[8px] font-bold text-blue-500 bg-blue-500/10 border border-blue-500/20 px-1 py-0.5 rounded shrink-0 leading-none">
            AO
          </span>
          <div className="min-w-0 flex-1">
            <p className={cn(
              "text-xs font-semibold leading-normal text-foreground/90 truncate",
              !match.reg_second && "text-muted-foreground italic",
              secondWon && "text-emerald-400 font-bold",
            )}>
              {secondWon && <span className="text-emerald-500 font-bold mr-1">✓</span>}
              <span>{participantName(match.reg_second, match.round_index)}</span>
              {match.reg_second?.place && match.reg_second.place > 0 && (
                <span className="text-[10px] font-bold ml-1" title={`${match.reg_second.place} місце`}>
                  {getPlaceBadge(match.reg_second.place)}
                </span>
              )}
            </p>
            {!compact && match.reg_second && (
              <p className="text-[9px] text-muted-foreground truncate leading-none">{participantClub(match.reg_second)}</p>
            )}
          </div>
        </div>
        <span className={cn(
          "font-mono text-base font-black shrink-0 w-6 text-right",
          secondWon ? "text-emerald-400" : "text-foreground/80",
        )}>
          {match.reg_second ? displayScoreSecond : ""}
        </span>
      </div>

      {/* Метод перемоги */}
      {isDone && match.win_method && !compact && (
        <div className="px-3 pb-1.5 pt-0.5 border-t border-border/30 bg-muted/10 w-full">
          <span className="text-[9px] text-amber-500/90 font-bold tracking-wider uppercase">
            Перемога: {match.win_method}
          </span>
        </div>
      )}
    </button>
  );
}
