import { useState } from "react";
import { cn } from "@/lib/utils";
import { BracketRound } from "./BracketRound";
import { RoundRobinTable } from "./RoundRobinTable";
import { MatchCard } from "./MatchCard";
import type { BracketResponse, Match } from "@/types/api";
import { useDragScroll } from "@/hooks/useDragScroll";
import { getRoundName } from "@/lib/bracketUtils";

interface BracketViewProps {
  bracket: BracketResponse;
  onMatchClick?: (match: Match) => void;
  showPlaceholders?: boolean;
  forcePrintMode?: boolean;
}

export function BracketView({ bracket, onMatchClick, showPlaceholders = false, forcePrintMode = false }: BracketViewProps) {
  const [activeTab, setActiveTab] = useState<"winners" | "losers">("winners");
  const doubleElimScroll = useDragScroll();
  const singleElimScroll = useDragScroll();
  const swissScroll = useDragScroll();

  const getZoomForRoundCount = (roundCount: number) => {
    if (!forcePrintMode) return undefined;
    if (roundCount <= 3) return { zoom: "100%" };
    if (roundCount === 4) return { zoom: "95%" };
    if (roundCount === 5) return { zoom: "88%" };
    return { zoom: "78%" };
  };

  if (bracket.format === "round_robin") {
    const allMatches = bracket.rounds.flat();
    return <RoundRobinTable matches={allMatches} forcePrintMode={forcePrintMode} />;
  }

  if (bracket.format === "swiss") {
    const allMatches = bracket.rounds.flat();

    // Extract unique participants
    const uniqueRegs = new Set<number>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const participantsList: any[] = [];
    allMatches.forEach((m) => {
      if (m.reg_first && !uniqueRegs.has(m.reg_first.id)) {
        uniqueRegs.add(m.reg_first.id);
        participantsList.push(m.reg_first);
      }
      if (m.reg_second && !uniqueRegs.has(m.reg_second.id)) {
        uniqueRegs.add(m.reg_second.id);
        participantsList.push(m.reg_second);
      }
    });

    const displayRounds = [...bracket.rounds];
    if (forcePrintMode) {
      const targetRoundsCount = Math.max(bracket.rounds.length, Math.ceil(Math.log2(participantsList.length || 2)) || 3);
      const matchesPerRound = Math.ceil((participantsList.length || 8) / 2);

      for (let r = displayRounds.length; r < targetRoundsCount; r++) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const dummyMatches: any[] = [];
        for (let m = 0; m < matchesPerRound; m++) {
          dummyMatches.push({
            id: -(r * 100 + m + 1),
            round_index: r,
            match_index: m,
            status: "scheduled",
            reg_first: null,
            reg_second: null,
            score_first: 0,
            score_second: 0,
            category_is_team: false
          });
        }
        displayRounds.push(dummyMatches);
      }
    }

    return (
      <div className="space-y-8 w-full">
        {/* Таблиця результатів (Standings) */}
        <div className="space-y-3">
          <h3 className="font-display text-xs font-bold uppercase tracking-wider text-muted-foreground select-none">
            Поточна таблиця результатів (Швейцарська система)
          </h3>
          <RoundRobinTable matches={allMatches} hideMatrix={true} forcePrintMode={forcePrintMode} />
        </div>

        {/* Відображення турів (Rounds) */}
        <div className="space-y-3 pt-6 border-t border-border/40">
          <h3 className="font-display text-xs font-bold uppercase tracking-wider text-muted-foreground select-none">
            Розклад поєдинків по турах
          </h3>
          <div
            ref={swissScroll.ref}
            {...swissScroll.props}
            className="overflow-x-auto pb-4 cursor-grab active:cursor-grabbing select-none"
            style={getZoomForRoundCount(displayRounds.length)}
          >
            <div className="flex items-start justify-center gap-12 min-w-max px-2 py-2 mx-auto w-fit">
              {displayRounds.map((roundMatches, idx) => (
                <BracketRound
                  key={idx}
                  roundIndex={idx}
                  totalRounds={displayRounds.length}
                  matches={roundMatches}
                  onMatchClick={onMatchClick}
                  isSwiss={true}
                  showPlaceholders={showPlaceholders}
                  forcePrintMode={forcePrintMode}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (bracket.format === "double_elimination") {
    const winnersRounds: Match[][] = [];
    const losersRounds: Match[][] = [];
    const grandFinalMatches: Match[] = [];

    bracket.rounds.forEach((roundMatches) => {
      if (roundMatches.length === 0) return;
      const rIdx = roundMatches[0].round_index;
      if (rIdx < 100) {
        winnersRounds.push(roundMatches);
      } else if (rIdx >= 100 && rIdx < 200) {
        losersRounds.push(roundMatches);
      } else if (rIdx >= 200) {
        grandFinalMatches.push(...roundMatches);
      }
    });

    if (forcePrintMode) {
      return (
        <div className="space-y-12 w-full text-zinc-900 bg-white">
          {/* Winners */}
          <div className="space-y-4" style={getZoomForRoundCount(winnersRounds.length + (grandFinalMatches.length > 0 ? 1 : 0))}>
            <h3 className="text-center font-bold text-sm uppercase tracking-wider text-zinc-500">Верхня сітка (Winners)</h3>
            <div className="overflow-x-auto pb-4">
              <div className="flex items-start gap-12 min-w-max px-2 py-2">
                {winnersRounds.map((roundMatches, idx) => (
                  <BracketRound
                    key={`w-${idx}`}
                    roundIndex={idx}
                    totalRounds={winnersRounds.length}
                    matches={roundMatches}
                    onMatchClick={onMatchClick}
                    showPlaceholders={showPlaceholders}
                    customRoundLabel={roundMatches[0] ? getRoundName(roundMatches[0], bracket.rounds.flat(), bracket.format) : undefined}
                    forcePrintMode={forcePrintMode}
                  />
                ))}
                {grandFinalMatches.length > 0 && (
                  <div className={cn("flex flex-col items-center select-none border-l border-zinc-300 pl-8", forcePrintMode ? "w-[200px]" : "w-72")}>
                    <div className="mb-6 px-4 py-1.5 rounded-full bg-amber-100 border border-amber-300 shadow-sm">
                      <span className="text-[10px] font-black uppercase tracking-widest text-amber-700">
                        Гранд-Фінал
                      </span>
                    </div>
                    <div className="flex flex-col gap-8 w-full items-center">
                      {grandFinalMatches
                        .filter((m) => !m.is_bracket_reset)
                        .map((match) => (
                          <div key={match.id} className="relative flex items-center justify-center w-full">
                            <MatchCard match={match} onClick={onMatchClick} forcePrintMode={forcePrintMode} />
                          </div>
                        ))}
                      {grandFinalMatches
                        .filter((m) => m.is_bracket_reset)
                        .map((match) => (
                          <div key={match.id} className="relative flex items-center justify-center w-full">
                            <div className="absolute -top-4 text-[9px] font-bold text-red-600 uppercase tracking-widest bg-white px-2 border border-red-300 rounded">
                              Bracket Reset
                            </div>
                            <MatchCard match={match} onClick={onMatchClick} forcePrintMode={forcePrintMode} />
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div
            className="pt-8 border-t border-dashed border-zinc-300 space-y-4 no-print-break"
            style={getZoomForRoundCount(losersRounds.length)}
          >
            <h3 className="text-center font-bold text-sm uppercase tracking-wider text-zinc-500">Нижня сітка (Losers)</h3>
            <div className="overflow-x-auto pb-4">
              <div className="flex items-start gap-12 min-w-max px-2 py-2">
                {losersRounds.map((roundMatches, idx) => (
                  <BracketRound
                    key={`l-${idx}`}
                    roundIndex={idx}
                    virtualRoundIndex={Math.floor(idx / 2)}
                    totalRounds={losersRounds.length}
                    matches={roundMatches}
                    onMatchClick={onMatchClick}
                    isLosers={true}
                    showPlaceholders={showPlaceholders}
                    customRoundLabel={roundMatches[0] ? getRoundName(roundMatches[0], bracket.rounds.flat(), bracket.format) : undefined}
                    forcePrintMode={forcePrintMode}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-6">
        {/* Вкладки для Double Elimination */}
        <div className="flex items-center justify-between border-b border-zinc-800/80 pb-2">
          <div className="flex gap-2">
            <button
              onClick={() => setActiveTab("winners")}
              className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all ${
                activeTab === "winners"
                  ? "bg-amber-500/10 text-amber-500 border border-amber-500/20"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              Верхня сітка (Winners)
            </button>
            <button
              onClick={() => setActiveTab("losers")}
              className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all ${
                activeTab === "losers"
                  ? "bg-amber-500/10 text-amber-500 border border-amber-500/20"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              Нижня сітка (Losers)
            </button>
          </div>
        </div>

        {/* Відображення раундів */}
        <div
          ref={doubleElimScroll.ref}
          {...doubleElimScroll.props}
          className="overflow-x-auto pb-4 cursor-grab active:cursor-grabbing select-none"
        >
          <div className="flex items-start gap-12 min-w-max px-2 py-2">
            {activeTab === "winners" &&
              winnersRounds.map((roundMatches, idx) => (
                <BracketRound
                  key={idx}
                  roundIndex={idx}
                  totalRounds={winnersRounds.length}
                  matches={roundMatches}
                  onMatchClick={onMatchClick}
                  showPlaceholders={showPlaceholders}
                  customRoundLabel={roundMatches[0] ? getRoundName(roundMatches[0], bracket.rounds.flat(), bracket.format) : undefined}
                  forcePrintMode={forcePrintMode}
                />
              ))}

            {activeTab === "losers" &&
              losersRounds.map((roundMatches, idx) => (
                <BracketRound
                  key={idx}
                  roundIndex={idx}
                  virtualRoundIndex={Math.floor(idx / 2)}
                  totalRounds={losersRounds.length}
                  matches={roundMatches}
                  onMatchClick={onMatchClick}
                  isLosers={true}
                  showPlaceholders={showPlaceholders}
                  customRoundLabel={roundMatches[0] ? getRoundName(roundMatches[0], bracket.rounds.flat(), bracket.format) : undefined}
                  forcePrintMode={forcePrintMode}
                />
              ))}

            {/* Колонка Гранд-Фіналу — тільки для вкладки Winners */}
            {activeTab === "winners" && grandFinalMatches.length > 0 && (
              <div className="flex flex-col items-center w-72 select-none border-l border-zinc-800/40 pl-8">
                <div className="mb-6 px-4 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 shadow-sm">
                  <span className="text-[10px] font-black uppercase tracking-widest text-amber-500">
                    Гранд-Фінал
                  </span>
                </div>
                <div className="flex flex-col gap-8 w-full items-center">
                  {/* Основний Гранд-Фінал */}
                  {grandFinalMatches
                    .filter((m) => !m.is_bracket_reset)
                    .map((match) => (
                      <div
                        key={match.id}
                        className="relative flex items-center justify-center w-full"
                      >
                        <MatchCard match={match} onClick={onMatchClick} forcePrintMode={forcePrintMode} />
                      </div>
                    ))}

                  {/* Супер-Фінал (Bracket Reset) */}
                  {grandFinalMatches
                    .filter((m) => m.is_bracket_reset)
                    .map((match) => (
                      <div
                        key={match.id}
                        className="relative flex items-center justify-center w-full"
                      >
                        <div className="absolute -top-4 text-[9px] font-bold text-red-400 uppercase tracking-widest bg-zinc-950 px-2 border border-red-500/20 rounded">
                          Bracket Reset
                        </div>
                        <MatchCard match={match} onClick={onMatchClick} forcePrintMode={forcePrintMode} />
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ─── single_elimination / single_repechage ──────────────────────────────
  let rounds = bracket.rounds;
  if (bracket.format === "single_repechage") {
    rounds = bracket.rounds
      .map((roundMatches) => roundMatches.filter((m) => m.round_index < 300))
      .filter((roundMatches) => roundMatches.length > 0);
  }

  return (
    <div
      ref={singleElimScroll.ref}
      {...singleElimScroll.props}
      className="overflow-x-auto pb-4 cursor-grab active:cursor-grabbing select-none"
      style={getZoomForRoundCount(rounds.length)}
    >
      <div className="flex items-start justify-center gap-12 min-w-max px-2 py-2 mx-auto w-fit">
        {rounds.map((roundMatches, idx) => (
          <BracketRound
            key={idx}
            roundIndex={idx}
            totalRounds={rounds.length}
            matches={roundMatches}
            onMatchClick={onMatchClick}
            showPlaceholders={showPlaceholders}
            forcePrintMode={forcePrintMode}
          />
        ))}
      </div>
    </div>
  );
}
