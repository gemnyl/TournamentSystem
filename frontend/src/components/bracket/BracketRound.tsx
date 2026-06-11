import { MatchCard } from "./MatchCard";
import { cn } from "@/lib/utils";
import type { Match } from "@/types/api";

interface BracketRoundProps {
  roundIndex: number;
  totalRounds: number;
  matches: Match[];
  onMatchClick?: (match: Match) => void;
}

/**
 * Розраховує точні математичні відступи для вирівнювання сітки.
 * Використовує рекурентні співвідношення:
 * gap_r = 2 * gap_{r-1} + H
 * paddingTop_r = paddingTop_{r-1} + (gap_{r-1} + H) / 2
 */
function getRoundSpacing(roundIndex: number, cardHeight: number, baseGap: number) {
  let gap = baseGap;
  let paddingTop = 0;
  for (let r = 1; r <= roundIndex; r++) {
    paddingTop = paddingTop + (cardHeight + gap) / 2;
    gap = 2 * gap + cardHeight;
  }
  return { gap, paddingTop };
}

/**
 * Колонка одного раунду в single-elimination сітці.
 * Вертикальний відступ між матчами збільшується в міру просування по раундах,
 * щоб переможці "зливались" до центру, з елегантними CSS-лініями конекторів.
 */
export function BracketRound({ roundIndex, totalRounds, matches, onMatchClick }: BracketRoundProps) {
  // Назва раунду
  const roundLabel = () => {
    const fromEnd = totalRounds - 1 - roundIndex;
    if (fromEnd === 0) return "Фінал";
    if (fromEnd === 1) return "Півфінал";
    if (fromEnd === 2) return "Чвертьфінал";
    return `Раунд ${roundIndex + 1}`;
  };

  // Висота картки H = 108px, базовий проміжок g0 = 16px
  const cardHeight = 108;
  const baseGap = 16;
  const { gap: gapBetween, paddingTop } = getRoundSpacing(roundIndex, cardHeight, baseGap);

  return (
    <div className="flex flex-col items-center w-56 select-none">
      {/* Заголовок раунду */}
      <div className="mb-6 px-4 py-1.5 rounded-full bg-card/60 border border-border/80 shadow-sm backdrop-blur-md">
        <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
          {roundLabel()}
        </span>
      </div>

      {/* Матчі */}
      <div className="flex flex-col w-full" style={{ gap: gapBetween, paddingTop }}>
        {matches.map((match, idx) => {
          const isLastRound = roundIndex === totalRounds - 1;
          const isEven = idx % 2 === 0;
          const isByeInRound1 = roundIndex === 0 && (!match.reg_first || !match.reg_second);

          // Малюємо конектори для всіх раундів, окрім фінального
          const nextMatchExists = idx + 1 < matches.length;
          const prevMatchExists = idx - 1 >= 0;
          const shouldDrawConnector = !isLastRound && ((isEven && nextMatchExists) || (!isEven && prevMatchExists)) && !isByeInRound1;

          // Висота лінії = половина відступу між картками + половина висоти картки
          const connectorHeight = (gapBetween + cardHeight) / 2;

          return (
            <div
              key={match.id}
              className={cn(
                "relative flex items-center justify-center w-full",
                isByeInRound1 && "invisible pointer-events-none"
              )}
            >
              <MatchCard match={match} onClick={onMatchClick} />

              {shouldDrawConnector && (
                isEven ? (
                  <div className="absolute left-full w-12 pointer-events-none" style={{ height: `${connectorHeight}px`, top: '50%' }}>
                    <div className="absolute left-0 top-0 w-6 h-full border-t-2 border-r-2 border-amber-500/35 rounded-tr-xl" />
                    <div className="absolute left-6 bottom-0 w-6 border-b-2 border-amber-500/35" />
                  </div>
                ) : (
                  <div className="absolute left-full w-12 pointer-events-none" style={{ height: `${connectorHeight}px`, bottom: '50%' }}>
                    <div className="absolute left-0 bottom-0 w-6 h-full border-b-2 border-r-2 border-amber-500/35 rounded-br-xl" />
                    <div className="absolute left-6 top-0 w-6 border-t-2 border-amber-500/35" />
                  </div>
                )
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
