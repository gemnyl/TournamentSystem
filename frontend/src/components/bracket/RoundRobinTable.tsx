/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { cn, formatAthleteName } from "@/lib/utils";
import type { Match } from "@/types/api";
import { useDragScroll } from "@/hooks/useDragScroll";

interface RoundRobinTableProps {
  matches: Match[];
  hideMatrix?: boolean;
  forcePrintMode?: boolean;
}

interface ParticipantStats {
  regId: number;
  name: string;
  place: number | null;
  wins: number;
  draws: number;
  losses: number;
  points: number;
  scores_scored: number;
  scores_conceded: number;
}

function computeParticipantsStats(
  participants: { id: number; name: string }[],
  matches: Match[],
  placesMap: Map<number, number | null>
): Record<number, ParticipantStats> {
  const stats: Record<number, ParticipantStats> = {};
  participants.forEach(({ id, name }) => {
    stats[id] = {
      regId: id,
      name,
      place: placesMap.get(id) ?? null,
      wins: 0,
      draws: 0,
      losses: 0,
      points: 0,
      scores_scored: 0,
      scores_conceded: 0,
    };
  });

  matches.forEach((m) => {
    if (m.status !== "completed") return;

    const isKata = m.judging_mode === "flags";
    const scoreFirst = isKata ? (m.flags_aka ?? 0) : (m.score_first ?? 0);
    const scoreSecond = isKata ? (m.flags_ao ?? 0) : (m.score_second ?? 0);

    if (m.reg_first && stats[m.reg_first.id]) {
      stats[m.reg_first.id].scores_scored += scoreFirst;
      stats[m.reg_first.id].scores_conceded += scoreSecond;
    }
    if (m.reg_second && stats[m.reg_second.id]) {
      stats[m.reg_second.id].scores_scored += scoreSecond;
      stats[m.reg_second.id].scores_conceded += scoreFirst;
    }

    if (m.win_method === "draw") {
      if (m.reg_first && stats[m.reg_first.id]) {
        stats[m.reg_first.id].draws++;
        stats[m.reg_first.id].points += 1;
      }
      if (m.reg_second && stats[m.reg_second.id]) {
        stats[m.reg_second.id].draws++;
        stats[m.reg_second.id].points += 1;
      }
    } else if (m.winner) {
      const loserId = m.winner === m.reg_first?.id ? m.reg_second?.id : m.reg_first?.id;
      if (stats[m.winner]) {
        stats[m.winner].wins++;
        stats[m.winner].points += 3;
      }
      if (loserId && stats[loserId]) {
        stats[loserId].losses++;
      }
    }
  });

  return stats;
}

function resolveTies(
  sortedGroupKeys: string[],
  groups: Record<string, number[]>,
  matches: Match[],
  stats: Record<number, ParticipantStats>
): number[] {
  const sortedIds: number[] = [];
  sortedGroupKeys.forEach((key) => {
    const groupIds = groups[key];
    if (groupIds.length === 1) {
      sortedIds.push(groupIds[0]);
    } else if (groupIds.length === 2) {
      const [id1, id2] = groupIds;
      // Шукаємо особисту зустріч
      const h2h = matches.find(
        (m) =>
          m.status === "completed" &&
          ((m.reg_first?.id === id1 && m.reg_second?.id === id2) ||
            (m.reg_first?.id === id2 && m.reg_second?.id === id1))
      );
      if (h2h && h2h.winner === id1) {
        sortedIds.push(id1, id2);
      } else if (h2h && h2h.winner === id2) {
        sortedIds.push(id2, id1);
      } else {
        // Нічия або немає зустрічі. Порівнюємо різницю балів, потім набрані бали
        const diff1 = stats[id1].scores_scored - stats[id1].scores_conceded;
        const diff2 = stats[id2].scores_scored - stats[id2].scores_conceded;
        if (diff1 === diff2) {
          if (stats[id1].scores_scored >= stats[id2].scores_scored) {
            sortedIds.push(id1, id2);
          } else {
            sortedIds.push(id2, id1);
          }
        } else {
          if (diff1 > diff2) sortedIds.push(id1, id2);
          else sortedIds.push(id2, id1);
        }
      }
    } else {
      // 3 або більше учасників
      const subSorted = [...groupIds].sort((idA, idB) => {
        const diffA = stats[idA].scores_scored - stats[idA].scores_conceded;
        const diffB = stats[idB].scores_scored - stats[idB].scores_conceded;
        if (diffA === diffB) {
          return stats[idB].scores_scored - stats[idA].scores_scored;
        }
        return diffB - diffA;
      });
      sortedIds.push(...subSorted);
    }
  });
  return sortedIds;
}

function buildResultMatrix(matches: Match[]): Record<string, { score: string; outcome: "win" | "loss" | "draw" }> {
  const resultMatrix: Record<string, { score: string; outcome: "win" | "loss" | "draw" }> = {};
  matches.forEach((m) => {
    if (!m.reg_first || !m.reg_second) return;
    const key = `${m.reg_first.id}-${m.reg_second.id}`;
    if (m.status === "completed") {
      const isDraw = m.win_method === "draw";
      const isKata = m.judging_mode === "flags";
      const scoreFirst = isKata ? (m.flags_aka ?? 0) : m.score_first;
      const scoreSecond = isKata ? (m.flags_ao ?? 0) : m.score_second;
      resultMatrix[key] = {
        score: `${scoreFirst}:${scoreSecond}`,
        outcome: isDraw ? "draw" : (m.winner === m.reg_first.id ? "win" : "loss"),
      };
      resultMatrix[`${m.reg_second.id}-${m.reg_first.id}`] = {
        score: `${scoreSecond}:${scoreFirst}`,
        outcome: isDraw ? "draw" : (m.winner === m.reg_second.id ? "win" : "loss"),
      };
    }
  });
  return resultMatrix;
}

function getMedalOrRank(displayRank: number): string {
  if (displayRank === 1) return "🥇";
  if (displayRank === 2) return "🥈";
  if (displayRank === 3) return "🥉";
  return `${displayRank}`;
}

/**
 * Таблиця round-robin — показує учасників, їх W/D/L та очки.
 * Також рендерить сітку результатів (матриця учасник × учасник).
 */
export function RoundRobinTable({ matches, hideMatrix = false, forcePrintMode = false }: RoundRobinTableProps) {
  const dragScroll = useDragScroll();
  // Збираємо унікальних учасників
  const participantsMap = new Map<number, string>();
  const placesMap = new Map<number, number | null>();

  const formatParticipantName = (reg: any) => {
    if (!reg) return "";
    if (reg.team) {
      return reg.team.name;
    }
    return reg.athlete ? formatAthleteName(reg.athlete) : `#${reg.id}`;
  };

  matches.forEach((m) => {
    if (m.reg_first) {
      participantsMap.set(m.reg_first.id, formatParticipantName(m.reg_first));
      placesMap.set(m.reg_first.id, m.reg_first.place ?? null);
    }
    if (m.reg_second) {
      participantsMap.set(m.reg_second.id, formatParticipantName(m.reg_second));
      placesMap.set(m.reg_second.id, m.reg_second.place ?? null);
    }
  });
  const participants = Array.from(participantsMap.entries()).map(([id, name]) => ({ id, name }));

  // Розраховуємо статистику через хелпер
  const stats = computeParticipantsStats(participants, matches, placesMap);

  // Групуємо за (points, wins) для точного відтворення бекенд-сортування
  const groups: Record<string, number[]> = {};
  Object.values(stats).forEach((s) => {
    const key = `${s.points}-${s.wins}`;
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(s.regId);
  });

  // Сортуємо групи за спаданням очок та перемог
  const sortedGroupKeys = Object.keys(groups).sort((a, b) => {
    const [ptsA, winsA] = a.split("-").map(Number);
    const [ptsB, winsB] = b.split("-").map(Number);
    return ptsB - ptsA || winsB - winsA;
  });

  // Вирішуємо нічиї/особисті зустрічі
  const sortedIds = resolveTies(sortedGroupKeys, groups, matches, stats);
  const sorted = sortedIds.map((id) => stats[id]);

  // Матриця результатів
  const resultMatrix = buildResultMatrix(matches);

  return (
    <div className="space-y-8 select-none">
      {/* Турнірна таблиця */}
      <div className="space-y-3">
        <h3 className={cn("font-display text-sm font-bold uppercase tracking-wider", forcePrintMode ? "text-zinc-700" : "text-muted-foreground")}>Залікова таблиця</h3>
        <div className={cn(
          "rounded-2xl border border-border/80 backdrop-blur-md bg-card/45 shadow-md overflow-hidden",
          forcePrintMode && "border-2 border-zinc-950 bg-white shadow-none text-zinc-950"
        )}>
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow className="hover:bg-transparent border-b border-border/70">
                <TableHead className="w-10 text-center font-bold">#</TableHead>
                <TableHead className="font-bold">Учасник</TableHead>
                <TableHead className="text-center w-20 font-bold">В</TableHead>
                <TableHead className="text-center w-20 font-bold">Н</TableHead>
                <TableHead className="text-center w-20 font-bold">П</TableHead>
                <TableHead className="text-center w-24 font-bold text-amber-400">Очки</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((s, i) => {
                const displayRank = s.place ?? (i + 1);
                const medal = getMedalOrRank(displayRank);

                return (
                  <TableRow key={s.regId} className="hover:bg-muted/25 border-b border-border/50 transition-colors">
                    <TableCell className={cn(
                      "text-center font-bold text-xs font-mono",
                      !forcePrintMode && displayRank === 1 && "text-yellow-400 text-sm",
                      !forcePrintMode && displayRank === 2 && "text-slate-300",
                      !forcePrintMode && displayRank === 3 && "text-amber-600",
                      !forcePrintMode && displayRank > 3 && "text-muted-foreground",
                      forcePrintMode && displayRank === 1 && "text-amber-600 text-sm",
                      forcePrintMode && displayRank === 2 && "text-zinc-600",
                      forcePrintMode && displayRank === 3 && "text-zinc-500",
                      forcePrintMode && displayRank > 3 && "text-zinc-400"
                    )}>
                      {forcePrintMode ? "" : medal}
                    </TableCell>
                    <TableCell className={cn("font-semibold text-sm", forcePrintMode ? "text-zinc-950 font-bold" : "text-foreground/90")}>{s.name}</TableCell>
                    <TableCell className={cn("text-center font-bold font-mono text-sm", forcePrintMode ? "text-emerald-700 font-black" : "text-emerald-400")}>{forcePrintMode ? "" : s.wins}</TableCell>
                    <TableCell className={cn("text-center font-semibold font-mono text-sm", forcePrintMode ? "text-zinc-700" : "text-amber-400")}>{forcePrintMode ? "" : s.draws}</TableCell>
                    <TableCell className={cn("text-center font-medium font-mono text-sm", forcePrintMode ? "text-rose-700" : "text-rose-400")}>{forcePrintMode ? "" : s.losses}</TableCell>
                    <TableCell className={cn("text-center font-black font-mono text-sm", forcePrintMode ? "text-zinc-950 bg-zinc-100 border-l border-zinc-200" : "text-amber-400 bg-amber-500/5")}>{forcePrintMode ? "" : s.points}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Матриця результатів */}
      {!hideMatrix && participants.length <= 12 && (
        <div className="space-y-3">
          <h3 className={cn("font-display text-sm font-bold uppercase tracking-wider", forcePrintMode ? "text-zinc-700" : "text-muted-foreground")}>Результати матчів (Матриця)</h3>
          <div
            ref={dragScroll.ref}
            {...dragScroll.props}
            className={cn(
              "rounded-2xl border border-border/80 bg-card/30 shadow-md overflow-x-auto cursor-grab active:cursor-grabbing select-none",
              forcePrintMode && "border-2 border-zinc-950 bg-white shadow-none text-zinc-950"
            )}
          >
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className={cn("border-b", forcePrintMode ? "border-zinc-950 bg-zinc-100" : "border-border/70 bg-muted/40")}>
                  <th className={cn("p-3 text-left font-bold border-r min-w-[150px]", forcePrintMode ? "border-zinc-950 text-zinc-950" : "border-border/50 text-muted-foreground")}>
                    Учасник
                  </th>
                  {participants.map((p) => (
                    <th key={p.id} className={cn("p-3 text-center font-bold border-r min-w-[80px] max-w-[80px] text-[10px]", forcePrintMode ? "border-zinc-950 text-zinc-950" : "border-border/30")}>
                      <span className={cn("block whitespace-normal break-words leading-tight", forcePrintMode ? "text-zinc-950 font-bold" : "text-foreground/80")} title={p.name}>
                        {p.name}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {participants.map((row) => (
                  <tr key={row.id} className={cn("border-b transition-colors", forcePrintMode ? "border-zinc-950 hover:bg-zinc-50" : "hover:bg-muted/20 border-b border-border/40")}>
                    <td className={cn("p-3 font-semibold border-r whitespace-normal break-words max-w-[220px]", forcePrintMode ? "border-zinc-950 text-zinc-950 font-bold bg-zinc-50" : "border-r border-border/50 text-foreground/90")} title={row.name}>
                      {row.name}
                    </td>
                    {participants.map((col) => {
                      if (row.id === col.id) {
                        return (
                          <td key={col.id} className={cn("p-3 text-center border-r font-bold select-none", forcePrintMode ? "border-zinc-950 bg-zinc-200 text-zinc-650" : "border-r border-border/30 bg-muted/30 text-muted-foreground/30")}>
                            —
                          </td>
                        );
                      }
                      const res = resultMatrix[`${row.id}-${col.id}`];
                      if (!res) {
                        return (
                          <td key={col.id} className={cn("p-3 text-center border-r font-mono", forcePrintMode ? "border-zinc-950 text-zinc-350" : "border-r border-border/30 text-muted-foreground/30")}>
                            {forcePrintMode ? "....." : "TBD"}
                          </td>
                        );
                      }

                      return (
                        <td
                          key={col.id}
                          className={cn("p-2 text-center border-r font-mono transition-all duration-200", forcePrintMode ? "border-zinc-950 bg-white" : "border-border/30")}
                        >
                          <span className={cn(
                            "inline-flex items-center justify-center px-2 py-1 rounded-lg text-[11px] font-bold font-mono border min-w-[44px]",
                            !forcePrintMode && res.outcome === "win" && "text-emerald-400 bg-emerald-500/10 border-emerald-500/15 shadow-sm shadow-emerald-500/5",
                            !forcePrintMode && res.outcome === "loss" && "text-rose-400 bg-rose-500/10 border-rose-500/15",
                            !forcePrintMode && res.outcome === "draw" && "text-amber-400 bg-amber-500/10 border-amber-500/15",
                            forcePrintMode && res.outcome === "win" && "text-emerald-700 bg-emerald-50 border-emerald-300 font-bold",
                            forcePrintMode && res.outcome === "loss" && "text-rose-700 bg-rose-50 border-rose-300",
                            forcePrintMode && res.outcome === "draw" && "text-amber-700 bg-amber-50 border-amber-300"
                          )}>
                            {res.score}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
