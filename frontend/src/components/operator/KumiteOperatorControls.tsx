import { useState, useRef } from "react";
import { Play, Pause, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, getOptimisticTimerUpdate } from "@/lib/utils";
import api from "@/lib/api";
import type { Match, ScoreAction } from "@/types/api";
import type { TimerState } from "@/hooks/useTimer";
import { formatTimer } from "@/hooks/useTimer";

interface KumiteOperatorControlsProps {
  match: Match;
  rulesetActions: ScoreAction[];
  timerState: TimerState;
  remainingMs: number;
  serverTimeOffset: number;
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
  serverTimeOffset,
  onMatchUpdate,
}: Readonly<KumiteOperatorControlsProps>) {
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [undoMode, setUndoMode] = useState(false);
  const customTimeInputRef = useRef<HTMLInputElement>(null);
  const absoluteTimeInputRef = useRef<HTMLInputElement>(null);

  const post = async (url: string, body?: Record<string, unknown>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const { data } = await api.post<Match>(url, body ?? {});
      onMatchUpdate(data);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const scoreAction = (corner: "ao" | "aka", action_key: string) => {
    const is_undo = undoMode;
    if (undoMode) {
      setUndoMode(false);
    }
    post(`/matches/${match.id}/update_score/`, { corner, action_key, is_undo });
  };

  const setSenshu = (value: "ao" | "aka" | "none") =>
    post(`/matches/${match.id}/set_senshu/`, { value });

  const timerAction = (path: string, body?: Record<string, unknown>) => {
    const { updatedMatch, reqBody } = getOptimisticTimerUpdate(
      path,
      timerState,
      serverTimeOffset,
      match
    );
    if (updatedMatch) {
      onMatchUpdate(updatedMatch);
    }
    return post(`/matches/${match.id}/timer/${path}/`, {
      ...body,
      ...reqBody,
    });
  };

  const isCompleted = match.status === "completed";
  const { status } = timerState;

  // ── Senshu display ──
  const aoSenshu = match.senshu === "ao";
  const akaSenshu = match.senshu === "aka";

  return (
    <div className="flex flex-col gap-4 w-full">
      {/* Undo Action Toggle & Alert */}
      <div className="flex flex-col items-center gap-1 bg-zinc-950/40 p-2.5 rounded-xl border border-border/40">
        <Button
          variant={undoMode ? "destructive" : "outline"}
          size="sm"
          disabled={isCompleted || busy}
          onClick={() => setUndoMode(!undoMode)}
          className={cn(
            "gap-1.5 font-bold transition-all duration-200 text-xs px-4 h-8",
            undoMode && "animate-pulse"
          )}
        >
          ⟲ {undoMode ? "Скасування... Оберіть бал" : "Скасувати дію (Undo)"}
        </Button>
        {undoMode && (
          <div className="text-[11px] font-bold text-destructive animate-pulse mt-1">
            ⚠ Режим скасування активний! Натисніть кнопку відповідного балу або попередження нижче, щоб зняти його.
          </div>
        )}
      </div>

      <div className="grid grid-cols-[1fr_170px_1fr] gap-3 items-start">

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
          <span className={cn(
            "font-mono text-7xl font-black leading-none transition-all duration-300",
            match.status === "completed" && match.winner === match.reg_second?.id
              ? "animate-pulse text-green-400"
              : "text-blue-300"
          )}>
            {match.score_second}
          </span>
        </div>

        <div className="flex items-center justify-center gap-1 text-sm text-muted-foreground">
          {Array.from({ length: match.warnings_second }, (_, i) => i + 1).map((n) => (
            <span key={`w-ao-${n}`} className="text-amber-400">⚠</span>
          ))}
          {match.warnings_second === 0 && <span className="text-xs opacity-40">0 попер.</span>}
        </div>

        {/* Senshu */}
        {match.ruleset_key === "karate_wkf" && (
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
        )}

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
            </>
          )}
          {status === "finished" && (
            <Button size="sm" variant="outline" className="w-full"
              disabled={busy}
              onClick={() => timerAction("reset")}>
              <RotateCcw className="w-3 h-3" /> Reset
            </Button>
          )}

          {/* Time adjustments active when timer is paused or not yet started */}
          {(status === "paused" || status === "not_started") && !isCompleted && (
            <>
              {/* ±10s and ±30s buttons */}
              <div className="grid grid-cols-2 gap-1 w-full mt-1">
                <Button size="sm" variant="outline" className="h-7 text-[10px] font-bold"
                  disabled={busy}
                  onClick={() => timerAction("add_time", { delta_ms: 10000 })}>
                  +10s
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-[10px] font-bold"
                  disabled={busy}
                  onClick={() => timerAction("add_time", { delta_ms: -10000 })}>
                  -10s
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-[10px] font-bold"
                  disabled={busy}
                  onClick={() => timerAction("add_time", { delta_ms: 30000 })}>
                  +30s
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-[10px] font-bold"
                  disabled={busy}
                  onClick={() => timerAction("add_time", { delta_ms: -30000 })}>
                  -30s
                </Button>
              </div>

              {/* Relative adjustment (delta input) */}
              <div className="flex gap-1 items-center w-full mt-1">
                <input
                  type="number"
                  placeholder="± сек"
                  ref={customTimeInputRef}
                  disabled={busy}
                  className="w-full h-7 text-xs px-1 border border-input rounded bg-zinc-950 text-white text-center font-mono"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const val = Number.parseInt((e.target as HTMLInputElement).value || "0");
                      if (val !== 0) {
                        timerAction("add_time", { delta_ms: val * 1000 });
                        (e.target as HTMLInputElement).value = "";
                      }
                    }
                  }}
                />
                <Button size="sm" variant="secondary" className="h-7 text-xs font-bold shrink-0 px-2.5"
                  disabled={busy}
                  onClick={() => {
                    const val = Number.parseInt(customTimeInputRef.current?.value || "0");
                    if (val !== 0) {
                      timerAction("add_time", { delta_ms: val * 1000 });
                      if (customTimeInputRef.current) customTimeInputRef.current.value = "";
                    }
                  }}>
                  ОК
                </Button>
              </div>

              {/* Absolute adjustment (manual input) */}
              <div className="flex gap-1 items-center w-full mt-0.5">
                <input
                  type="number"
                  placeholder="Задати сек"
                  ref={absoluteTimeInputRef}
                  disabled={busy}
                  className="w-full h-7 text-xs px-1 border border-input rounded bg-zinc-950 text-white text-center font-mono"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const val = Number.parseInt((e.target as HTMLInputElement).value || "0");
                      if (val > 0) {
                        timerAction("set_duration", { duration_ms: val * 1000 });
                        (e.target as HTMLInputElement).value = "";
                      }
                    }
                  }}
                />
                <Button size="sm" variant="secondary" className="h-7 text-xs font-bold shrink-0 px-2.5"
                  disabled={busy}
                  onClick={() => {
                    const val = Number.parseInt(absoluteTimeInputRef.current?.value || "0");
                    if (val > 0) {
                      timerAction("set_duration", { duration_ms: val * 1000 });
                      if (absoluteTimeInputRef.current) absoluteTimeInputRef.current.value = "";
                    }
                  }}>
                  Задати
                </Button>
              </div>

              {/* Set total duration select (presets) */}
              <select
                disabled={busy}
                onChange={(e) => {
                  const val = Number.parseInt(e.target.value);
                  if (val > 0) {
                    timerAction("set_duration", { duration_ms: val * 1000 });
                  }
                }}
                defaultValue=""
                className="w-full h-7 text-xs px-1 border border-input rounded bg-zinc-950 text-white mt-1 cursor-pointer"
              >
                <option value="" disabled>Оберіть час...</option>
                <option value="90">1:30</option>
                <option value="120">2:00</option>
                <option value="180">3:00</option>
                <option value="240">4:00</option>
              </select>
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
          <span className={cn(
            "font-mono text-7xl font-black leading-none transition-all duration-300",
            match.status === "completed" && match.winner === match.reg_first?.id
              ? "animate-pulse text-green-400"
              : "text-red-300"
          )}>
            {match.score_first}
          </span>
        </div>

        <div className="flex items-center justify-center gap-1 text-sm text-muted-foreground">
          {Array.from({ length: match.warnings_first }, (_, i) => i + 1).map((n) => (
            <span key={`w-aka-${n}`} className="text-amber-400">⚠</span>
          ))}
          {match.warnings_first === 0 && <span className="text-xs opacity-40">0 попер.</span>}
        </div>

        {/* Senshu */}
        {match.ruleset_key === "karate_wkf" && (
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
        )}

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
    </div>
  );
}
