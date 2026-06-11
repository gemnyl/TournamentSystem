import { useEffect, useRef, useState } from "react";
import type { TimerStatus } from "@/types/api";

export interface TimerState {
  status: TimerStatus;
  started_at_ms: number | null;
  elapsed_ms: number;
  duration_ms: number;
}

export function useTimer(initial: TimerState, serverTimeOffset: number) {
  const [state, setState] = useState<TimerState>(initial);
  const [remainingMs, setRemainingMs] = useState(
    initial.duration_ms - initial.elapsed_ms,
  );

  const stateRef = useRef(state);
  const offsetRef = useRef(serverTimeOffset);
  const lastSecondRef = useRef<number | null>(null);
  // Зберігає останнє відображене значення, щоб запобігти стрибкам вгору під час running.
  // Скидається при будь-якій легітимній зміні стану таймера (start/pause/resume/reset).
  const lastDisplayedRef = useRef<number | null>(null);

  // Зберігає високоточну локальну шкалу часу для усунення стрибків через мережеві лаги або зсуви годинника (наприклад, у WSL/Docker).
  const localTimelineRef = useRef<{
    localStart: number;      // performance.now() на момент синхронізації
    elapsedAtSync: number;   // розрахований elapsed_ms на момент синхронізації
    startedAtMs: number;     // started_at_ms з сервера
    durationMs: number;      // duration_ms з сервера
    offsetAtSync: number;    // serverTimeOffset на момент синхронізації
  } | null>(null);

  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { offsetRef.current = serverTimeOffset; }, [serverTimeOffset]);

  const lastStateRef = useRef<TimerState>(state);

  useEffect(() => {
    const prev = lastStateRef.current;

    const durationChanged = prev.duration_ms !== state.duration_ms;
    const elapsedChangedNotRunning =
      prev.status !== "running" &&
      prev.elapsed_ms !== state.elapsed_ms &&
      Math.abs(prev.elapsed_ms - state.elapsed_ms) > 1000;

    // Only reset the visual monotonic guard and timeline when the duration changes,
    // when the timer is reset to not_started, or when the elapsed time is manually adjusted.
    // We do NOT reset them on running <-> paused transitions to prevent visual jumps.
    const isLegitReset =
      durationChanged ||
      elapsedChangedNotRunning ||
      state.status === "not_started" ||
      (prev.status === "not_started" && state.status === "running");

    if (isLegitReset) {
      lastDisplayedRef.current = null;
      localTimelineRef.current = null;
      lastSecondRef.current = null;
    }

    // Zero-frame visual update for pauses or resets using authoritative server time
    if (state.status !== "running") {
      const officialRemaining = Math.max(0, state.duration_ms - state.elapsed_ms);
      lastDisplayedRef.current = officialRemaining;
      setRemainingMs(officialRemaining);
    }

    lastStateRef.current = state;
  }, [state]);

  const setTimerState = (next: TimerState | ((prev: TimerState) => TimerState)) => {
    setState(prev => {
      const newState = typeof next === "function" ? next(prev) : next;

      const startedAtSame =
        prev.started_at_ms === newState.started_at_ms ||
        (prev.started_at_ms !== null &&
          newState.started_at_ms !== null &&
          Math.abs(prev.started_at_ms - newState.started_at_ms) <= 10);

      // Skip update only if timer is running and continues to run with same params
      if (
        prev.status === "running" &&
        newState.status === "running" &&
        startedAtSame &&
        prev.duration_ms === newState.duration_ms
      ) {
        return prev;
      }
      return newState;
    });
  };

  useEffect(() => {
    if (state.status !== "running" || state.started_at_ms === null) {
      localTimelineRef.current = null;
      lastSecondRef.current = null;
      return;
    }

    let raf: number;

    const tick = () => {
      const s = stateRef.current;
      if (s.status === "running" && s.started_at_ms !== null) {
        const localNow = performance.now();
        const serverNow = Date.now() + offsetRef.current;
        const elapsedSinceStart = Math.max(0, serverNow - s.started_at_ms);
        const serverElapsed = s.elapsed_ms + elapsedSinceStart;

        const hasValidTimeline =
          localTimelineRef.current !== null &&
          localTimelineRef.current.startedAtMs === s.started_at_ms &&
          localTimelineRef.current.durationMs === s.duration_ms &&
          Math.abs(localTimelineRef.current.offsetAtSync - offsetRef.current) <= 200 &&
          Math.abs(
            (localTimelineRef.current.elapsedAtSync + (localNow - localTimelineRef.current.localStart)) -
            serverElapsed
          ) < 5000;

        let elapsed: number;
        if (hasValidTimeline && localTimelineRef.current) {
          const delta = localNow - localTimelineRef.current.localStart;
          elapsed = localTimelineRef.current.elapsedAtSync + delta;
        } else {
          localTimelineRef.current = {
            localStart: localNow,
            elapsedAtSync: serverElapsed,
            startedAtMs: s.started_at_ms,
            durationMs: s.duration_ms,
            offsetAtSync: offsetRef.current,
          };
          elapsed = serverElapsed;
        }

        const raw = Math.max(0, s.duration_ms - elapsed);
        const last = lastDisplayedRef.current;
        const displayed = last === null ? raw : Math.min(raw, last);
        lastDisplayedRef.current = displayed;

        // Only update remainingMs and trigger a re-render when the second boundary changes
        const currentSecond = Math.ceil(displayed / 1000);
        if (lastSecondRef.current !== currentSecond) {
          lastSecondRef.current = currentSecond;
          setRemainingMs(displayed);
        }

        raf = requestAnimationFrame(tick);
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [state.status, state.started_at_ms]);

  return { state, setState: setTimerState, remainingMs };
}

export function formatTimer(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
