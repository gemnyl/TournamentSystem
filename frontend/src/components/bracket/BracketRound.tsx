import { MatchCard } from "./MatchCard";
import { cn } from "@/lib/utils";
import type { Match } from "@/types/api";

interface BracketRoundProps {
  roundIndex: number;
  totalRounds: number;
  matches: Match[];
  onMatchClick?: (match: Match) => void;
  /** Для Losers Bracket: явно задані відступи (рівна висота колонок). */
  customGap?: number;
  customPaddingTop?: number;
  /** Вимикає приховування BYE-матчів і SE-конектори (для LB). */
  isLosers?: boolean;
  /** Позначає швейцарську систему (без конекторів, рівномірні відступи). */
  isSwiss?: boolean;
  showPlaceholders?: boolean;
  virtualRoundIndex?: number;
  customRoundLabel?: string;
  forcePrintMode?: boolean;
}

/**
 * Розраховує точні математичні відступи для Single-Elimination сітки.
 * Рекурентні співвідношення:
 *   gap_r = 2 * gap_{r-1} + H
 *   paddingTop_r = paddingTop_{r-1} + (gap_{r-1} + H) / 2
 */
function getSESpacing(roundIndex: number, cardHeight: number, baseGap: number) {
  let gap = baseGap;
  let paddingTop = 0;
  for (let r = 1; r <= roundIndex; r++) {
    paddingTop = paddingTop + (cardHeight + gap) / 2;
    gap = 2 * gap + cardHeight;
  }
  return { gap, paddingTop };
}

/**
 * Колонка одного раунду в сітці.
 *
 * Режим SE (default): exponential spacing через getSESpacing — переможці «зливаються»
 * до центру з CSS-конекторами.
 *
 * Режим LB (customGap/customPaddingTop): рівна висота всіх колонок — без конекторів,
 * без приховування BYE. Мітки раундів: «Раунд N».
 */
export function BracketRound({
  roundIndex,
  totalRounds,
  matches,
  onMatchClick,
  customGap,
  customPaddingTop,
  isLosers = false,
  isSwiss = false,
  showPlaceholders = false,
  virtualRoundIndex,
  customRoundLabel,
  forcePrintMode = false,
}: BracketRoundProps) {
  // ─── Назва раунду ──────────────────────────────────────────────────────────
  const roundLabel = () => {
    if (customRoundLabel) return customRoundLabel;
    if (isSwiss) return `Тур ${roundIndex + 1}`;
    if (isLosers) return `Раунд ${roundIndex + 1}`;
    const fromEnd = totalRounds - 1 - roundIndex;
    if (fromEnd === 0) return "Фінал";
    if (fromEnd === 1) return "Півфінал";
    if (fromEnd === 2) return "Чвертьфінал";
    return `Раунд ${roundIndex + 1}`;
  };

  // ─── Розміри картки ────────────────────────────────────────────────────────
  const isTeam = matches.some((m) => m.category_is_team);
  const maxBouts = matches.reduce((max, m) => Math.max(max, m.team_bouts?.length ?? 0), 0);
  let cardHeight = forcePrintMode ? 96 : 108;
  if (isTeam) {
    cardHeight = maxBouts > 3 ? 180 : 140;
  }
  const baseGap = 16;

  // ─── Spacing ───────────────────────────────────────────────────────────────
  let gapBetween: number;
  let paddingTop: number;

  if (isSwiss) {
    // Швейцарський режим: рівномірний відступ
    gapBetween = baseGap;
    paddingTop = 0;
  } else if (virtualRoundIndex !== undefined) {
    // LB-режим з віртуальним індексом раунду (для ялинки та утримання)
    const spacing = getSESpacing(virtualRoundIndex, cardHeight, baseGap);
    gapBetween = spacing.gap;
    paddingTop = spacing.paddingTop;
  } else if (customGap !== undefined) {
    // LB-режим: рівна висота, задана ззовні
    gapBetween = customGap;
    paddingTop = customPaddingTop ?? 0;
  } else {
    // SE-режим: exponential spacing
    const power = isLosers ? Math.floor(roundIndex / 2) : roundIndex;
    const spacing = getSESpacing(power, cardHeight, baseGap);
    gapBetween = spacing.gap;
    paddingTop = spacing.paddingTop;
  }

  return (
    <div className={cn("flex flex-col items-center select-none", forcePrintMode ? "w-[200px]" : "w-72")}>
      {/* Заголовок раунду */}
      {!isTeam && (
        <div className="mb-6 px-4 py-1.5 rounded-full bg-card/60 border border-border/80 shadow-sm backdrop-blur-md">
          <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
            {roundLabel()}
          </span>
        </div>
      )}

      {/* Матчі */}
      <div className="flex flex-col w-full" style={{ gap: gapBetween, paddingTop }}>
        {matches.map((match, idx) => {
          const isLastRound = roundIndex === totalRounds - 1;
          const isEven = idx % 2 === 0;

          // BYE-приховування тільки в SE R1 (не в LB)
          const isByeInRound1 =
            !showPlaceholders && !isLosers && roundIndex === 0 && (!match.reg_first || !match.reg_second);

          // Приховуємо лише завершені авто-проходи (BYE)
          const isPureBye = match.status === "completed" && match.win_method === "walkover";
          const shouldHideMatch = !showPlaceholders && isPureBye;

          // Порожні матчі нижньої сітки R1, які ніколи не відбудуться
          const isLosersGhostMatch =
            isLosers && roundIndex === 0 && !match.reg_first && !match.reg_second && match.status !== "completed";

          // Повністю порожні завершені матчі (ghost matches), які не мають учасників
          const isGhostCompleted = match.status === "completed" && !match.reg_first && !match.reg_second;

          // SE-конектори та конектори нижньої сітки (злиття 2-в-1 для непарних раундів лузерів)
          const nextMatchExists = idx + 1 < matches.length;
          const prevMatchExists = idx - 1 >= 0;
          const shouldDrawConnector =
            !isSwiss &&
            !isLastRound &&
            ((isEven && nextMatchExists) || (!isEven && prevMatchExists)) &&
            !isByeInRound1 &&
            !shouldHideMatch &&
            !isLosersGhostMatch &&
            !isGhostCompleted &&
            (!isLosers || (isLosers && roundIndex % 2 !== 0));

          // Прямий конектор 1-в-1 для парних раундів лузерів (R1, R3, R5 тощо)
          const shouldDrawLosersStraightConnector =
            isLosers && !isLastRound && (roundIndex % 2 === 0) && !isLosersGhostMatch && !isGhostCompleted;

          // Висота конектора = половина відступу + половина висоти картки
          const connectorHeight = (gapBetween + cardHeight) / 2;

          return (
            <div
              key={match.id}
              className={cn(
                "relative flex items-center justify-center w-full",
                (isByeInRound1 || shouldHideMatch || isLosersGhostMatch || isGhostCompleted) && "invisible pointer-events-none"
              )}
            >
              <MatchCard match={match} onClick={onMatchClick} forcePrintMode={forcePrintMode} />

              {shouldDrawConnector &&
                (isEven ? (
                  <div
                    className="absolute left-full w-12 pointer-events-none"
                    style={{ height: `${connectorHeight}px`, top: "50%" }}
                  >
                    <div className={cn("absolute left-0 top-0 w-6 h-full border-t-2 border-r-2 rounded-tr-xl", forcePrintMode ? "border-zinc-700" : "border-amber-500/35")} />
                    <div className={cn("absolute left-6 bottom-0 w-6 border-b-2", forcePrintMode ? "border-zinc-700" : "border-amber-500/35")} />
                  </div>
                ) : (
                  <div
                    className="absolute left-full w-12 pointer-events-none"
                    style={{ height: `${connectorHeight}px`, bottom: "50%" }}
                  >
                    <div className={cn("absolute left-0 bottom-0 w-6 h-full border-b-2 border-r-2 rounded-br-xl", forcePrintMode ? "border-zinc-700" : "border-amber-500/35")} />
                    <div className={cn("absolute left-6 top-0 w-6 border-t-2", forcePrintMode ? "border-zinc-700" : "border-amber-500/35")} />
                  </div>
                ))}

              {shouldDrawLosersStraightConnector && (
                <div
                  className="absolute left-full w-12 pointer-events-none"
                  style={{ height: "2px", top: "50%" }}
                >
                  <div className={cn("absolute left-0 top-0 w-12 border-b-2", forcePrintMode ? "border-zinc-700" : "border-amber-500/35")} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
