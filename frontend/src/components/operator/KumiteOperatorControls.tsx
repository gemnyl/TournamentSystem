import { useState } from "react";
import { Play, Pause, RotateCcw, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import api from "@/lib/api";
import type { Match, ScoreAction } from "@/types/api";
import type { TimerState } from "@/hooks/useTimer";
import { formatTimer } from "@/hooks/useTimer";

interface KumiteOperatorControlsProps {
  match: Match;
  rulesetActions: ScoreAction[];
  timerState: TimerState;
  remainingMs: number;
  onMatchUpdate: (match: Match) => void;
}

// Ao = reg_second (left), Aka = reg_first (right)

function actionVariant(action: ScoreAction): string {
  if (action.is_warning) return "bg-amber-500/20 border border-amber-500 text-amber-300 hover:bg-amber-500/30";
  if (action.points >= 3) return "bg-red-600/20 border border-red-500 text-red-300 hover:bg-red-600/30";
  if (action.points === 2) return "bg-orange-500/20 border border-orange-400 text-orange-300 hover:bg-orange-500/30";
  return "bg-muted/50 border border-border text-foreground hover:bg-muted";
}

export default function KumiteOperatorControls({
  match,
  rulesetActions,
  timerState,
  remainingMs,
  onMatchUpdate,
}: Readonly<KumiteOperatorControlsProps>) {
  const [busy, setBusy] = useState(false);

  const post = async (url: string, body?: Record<string, unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      const { data } = await api.post<Match>(url, body ?? {});
      onMatchUpdate(data);
    } finally {
      setBusy(false);
    }
  };

  const scoreAction = (corner: "ao" | "aka", action_key: string) =>
    post(`/matches/${match.id}/update_score/`, { corner, action_key });

  const setSenshu = (value: "ao" | "aka" | "none") =>
    post(`/matches/${match.id}/set_senshu/`, { value });

  const timerAction = (path: string, body?: Record<string, unknown>) =>
    post(`/matches/${match.id}/timer/${path}`, body);

  const isCompleted = match.status === "completed";
  const { status } = timerState;

  // ── Senshu display ──
  const aoSenshu = match.senshu === "ao";
  const akaSenshu = match.senshu === "aka";

  return (
    <div className="grid grid-cols-[1fr_160px_1fr] gap-3 items-start">

      {/* ── AO (left, reg_second) ── */}
      <div className={cn(
        "rounded-xl border p-4 space-y-3",
        "border-blue-600/40 bg-blue-950/20"
      )}>
        <div className="text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-blue-400 mb-0.5">AO</p>
          <p className="font-semibold text-sm truncate text-white/90">
            {match.reg_second?.athlete?.full_name ?? "—"}
          </p>
          <p className="text-xs text-muted-foreground">{match.reg_second?.athlete?.club?.name}</p>
        </div>

        <div className="text-center">
          <span className="font-mono text-7xl font-black text-blue-300 leading-none">
            {match.score_second}
          </span>
        </div>

        <div className="flex items-center justify-center gap-1 text-sm text-muted-foreground">
          {Array.from({ length: match.warnings_second }).map((_, i) => (
            <span key={`w-ao-${i}`} className="text-amber-400">⚠</span>
          ))}
          {match.warnings_second === 0 && <span className="text-xs opacity-40">0 попер.</span>}
        </div>

        {/* Senshu */}
        <button
          disabled={isCompleted || busy}
          onClick={() => setSenshu(aoSenshu ? "none" : "ao")}
          className={cn(
            "w-full text-xs py-1 rounded border transition-colors",
            aoSenshu
              ? "border-blue-400 bg-blue-500/20 text-blue-300"
              : "border-border text-muted-foreground hover:border-blue-400/50"
          )}
        >
          {aoSenshu ? "S Senshu (натисни щоб зняти)" : "Senshu AO"}
        </button>

        {/* Score actions */}
        <div className="grid grid-cols-2 gap-1.5">
          {rulesetActions.map((action) => (
            <button
              key={action.key}
              disabled={isCompleted || busy}
              onClick={() => scoreAction("ao", action.key)}
              className={cn(
                "text-xs font-bold py-1.5 px-2 rounded transition-colors disabled:opacity-40",
                actionVariant(action),
              )}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── TIMER (center) ── */}
      <div className="flex flex-col items-center gap-3 pt-2">
        <div className={cn(
          "font-mono text-5xl font-black tabular-nums leading-none",
          remainingMs === 0 && status === "running" ? "text-red-400 animate-pulse" : "text-white"
        )}>
          {formatTimer(remainingMs)}
        </div>

        <div className="text-xs text-muted-foreground capitalize">{status.replace("_", " ")}</div>

        <div className="flex flex-col gap-1.5 w-full">
          {status === "not_started" && (
            <Button size="sm" className="w-full bg-green-700 hover:bg-green-600 text-white"
              disabled={busy || isCompleted}
              onClick={() => timerAction("start")}>
              <Play className="w-3 h-3" /> Start
            </Button>
          )}
          {status === "running" && (
            <Button size="sm" className="w-full bg-amber-600 hover:bg-amber-500 text-white"
              disabled={busy}
              onClick={() => timerAction("pause")}>
              <Pause className="w-3 h-3" /> Pause
            </Button>
          )}
          {status === "paused" && (
            <>
              <Button size="sm" className="w-full bg-green-700 hover:bg-green-600 text-white"
                disabled={busy}
                onClick={() => timerAction("resume")}>
                <Play className="w-3 h-3" /> Resume
              </Button>
              <Button size="sm" variant="outline" className="w-full"
                disabled={busy}
                onClick={() => timerAction("reset")}>
                <RotateCcw className="w-3 h-3" /> Reset
              </Button>
              <Button size="sm" variant="outline" className="w-full text-xs"
                disabled={busy}
                onClick={() => timerAction("add_time", { delta_ms: 30000 })}>
                <Plus className="w-3 h-3" /> +30s
              </Button>
            </>
          )}
          {status === "finished" && (
            <Button size="sm" variant="outline" className="w-full"
              disabled={busy}
              onClick={() => timerAction("reset")}>
              <RotateCcw className="w-3 h-3" /> Reset
            </Button>
          )}
        </div>
      </div>

      {/* ── AKA (right, reg_first) ── */}
      <div className={cn(
        "rounded-xl border p-4 space-y-3",
        "border-red-600/40 bg-red-950/20"
      )}>
        <div className="text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-red-400 mb-0.5">AKA</p>
          <p className="font-semibold text-sm truncate text-white/90">
            {match.reg_first?.athlete?.full_name ?? "—"}
          </p>
          <p className="text-xs text-muted-foreground">{match.reg_first?.athlete?.club?.name}</p>
        </div>

        <div className="text-center">
          <span className="font-mono text-7xl font-black text-red-300 leading-none">
            {match.score_first}
          </span>
        </div>

        <div className="flex items-center justify-center gap-1 text-sm text-muted-foreground">
          {Array.from({ length: match.warnings_first }).map((_, i) => (
            <span key={`w-aka-${i}`} className="text-amber-400">⚠</span>
          ))}
          {match.warnings_first === 0 && <span className="text-xs opacity-40">0 попер.</span>}
        </div>

        {/* Senshu */}
        <button
          disabled={isCompleted || busy}
          onClick={() => setSenshu(akaSenshu ? "none" : "aka")}
          className={cn(
            "w-full text-xs py-1 rounded border transition-colors",
            akaSenshu
              ? "border-red-400 bg-red-500/20 text-red-300"
              : "border-border text-muted-foreground hover:border-red-400/50"
          )}
        >
          {akaSenshu ? "S Senshu (натисни щоб зняти)" : "Senshu AKA"}
        </button>

        {/* Score actions */}
        <div className="grid grid-cols-2 gap-1.5">
          {rulesetActions.map((action) => (
            <button
              key={action.key}
              disabled={isCompleted || busy}
              onClick={() => scoreAction("aka", action.key)}
              className={cn(
                "text-xs font-bold py-1.5 px-2 rounded transition-colors disabled:opacity-40",
                actionVariant(action),
              )}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
