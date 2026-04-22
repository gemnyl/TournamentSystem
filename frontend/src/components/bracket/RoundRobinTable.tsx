import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import type { Match } from "@/types/api";

interface RoundRobinTableProps {
  matches: Match[];
}

interface ParticipantStats {
  regId: number;
  name: string;
  wins: number;
  losses: number;
  points: number;
}

/**
 * Таблиця round-robin — показує учасників, їх W/L та очки.
 * Також рендерить сітку результатів (матриця учасник × учасник).
 */
export function RoundRobinTable({ matches }: RoundRobinTableProps) {
  // Збираємо унікальних учасників
  const participantsMap = new Map<number, string>();
  matches.forEach((m) => {
    if (m.reg_first)  participantsMap.set(m.reg_first.id,  m.reg_first.athlete?.full_name ?? `#${m.reg_first.id}`);
    if (m.reg_second) participantsMap.set(m.reg_second.id, m.reg_second.athlete?.full_name ?? `#${m.reg_second.id}`);
  });
  const participants = Array.from(participantsMap.entries()).map(([id, name]) => ({ id, name }));

  // Статистика
  const stats: Record<number, ParticipantStats> = {};
  participants.forEach(({ id, name }) => {
    stats[id] = { regId: id, name, wins: 0, losses: 0, points: 0 };
  });
  matches.forEach((m) => {
    if (m.status !== "completed" || !m.winner) return;
    const loserId = m.winner === m.reg_first?.id ? m.reg_second?.id : m.reg_first?.id;
    if (m.winner && stats[m.winner]) { stats[m.winner].wins++;  stats[m.winner].points += 2; }
    if (loserId   && stats[loserId])  { stats[loserId].losses++; stats[loserId].points += 0; }
  });

  const sorted = Object.values(stats).sort((a, b) => b.points - a.points || b.wins - a.wins);

  // Матриця результатів
  const resultMatrix: Record<string, string> = {};
  matches.forEach((m) => {
    if (!m.reg_first || !m.reg_second) return;
    const key = `${m.reg_first.id}-${m.reg_second.id}`;
    if (m.status === "completed") {
      if (m.winner === m.reg_first.id) {
        resultMatrix[key] = `${m.score_first}:${m.score_second}`;
        resultMatrix[`${m.reg_second.id}-${m.reg_first.id}`] = `${m.score_second}:${m.score_first}`;
      } else if (m.winner === m.reg_second.id) {
        resultMatrix[key] = `${m.score_first}:${m.score_second}`;
        resultMatrix[`${m.reg_second.id}-${m.reg_first.id}`] = `${m.score_second}:${m.score_first}`;
      }
    }
  });

  return (
    <div className="space-y-6">
      {/* Турнірна таблиця */}
      <div>
        <h3 className="font-display text-lg font-semibold mb-3">Залікова таблиця</h3>
        <div className="rounded-xl border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-8">#</TableHead>
                <TableHead>Учасник</TableHead>
                <TableHead className="text-center w-16">П</TableHead>
                <TableHead className="text-center w-16">Пр</TableHead>
                <TableHead className="text-center w-16">Очки</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((s, i) => (
                <TableRow key={s.regId}>
                  <TableCell className={i === 0 ? "font-bold text-amber-500" : "text-muted-foreground"}>
                    {i + 1}
                  </TableCell>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell className="text-center text-green-400 font-mono">{s.wins}</TableCell>
                  <TableCell className="text-center text-red-400 font-mono">{s.losses}</TableCell>
                  <TableCell className="text-center font-bold font-mono">{s.points}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Матриця результатів */}
      {participants.length <= 12 && (
        <div>
          <h3 className="font-display text-lg font-semibold mb-3">Результати матчів</h3>
          <div className="overflow-x-auto">
            <table className="text-xs border-collapse">
              <thead>
                <tr>
                  <th className="p-2 text-left text-muted-foreground border border-border bg-muted/30 min-w-[140px]">
                    Учасник
                  </th>
                  {participants.map((p) => (
                    <th key={p.id} className="p-2 text-center border border-border bg-muted/30 min-w-[80px] max-w-[80px]">
                      <span className="block truncate max-w-[76px]" title={p.name}>
                        {p.name.split(" ")[0]}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {participants.map((row) => (
                  <tr key={row.id} className="hover:bg-muted/20">
                    <td className="p-2 font-medium border border-border truncate max-w-[140px]" title={row.name}>
                      {row.name}
                    </td>
                    {participants.map((col) => {
                      if (row.id === col.id) {
                        return <td key={col.id} className="p-2 text-center border border-border bg-muted/30">—</td>;
                      }
                      const res = resultMatrix[`${row.id}-${col.id}`];
                      const won = res ? parseInt(res.split(":")[0]) > parseInt(res.split(":")[1]) : null;
                      return (
                        <td key={col.id} className={`p-2 text-center border border-border font-mono ${won === true ? "text-green-400 bg-green-500/5" : won === false ? "text-red-400" : "text-muted-foreground"}`}>
                          {res ?? "—"}
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
