import { useCallback, useEffect, useRef } from "react";
import type { Match, TatamiSnapshot, TimerStatus } from "@/types/api";

export interface TimerStatePayload {
  status: TimerStatus;
  started_at_ms: number | null;
  elapsed_ms: number;
  duration_ms: number;
}

interface UseTatamiSocketOptions {
  onSnapshot: (data: TatamiSnapshot) => void;
  onMatchEvent: (event: { sequence: number; event_type: string; payload: unknown }, match: Match) => void;
  onTimerState: (state: TimerStatePayload, server_ts_ms: number) => void;
  onTatamiState: (data: { tatami: TatamiSnapshot["tatami"]; current_match: Match | null }) => void;
  onClockOffsetUpdate?: (offset: number) => void;
}

export function useTatamiSocket(
  tid: string | number,
  n: string | number,
  options: UseTatamiSocketOptions,
) {
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryDelay = useRef(1000);
  const isMounted = useRef(true);
  const optsRef = useRef(options);

  useEffect(() => { optsRef.current = options; }, [options]);

  const lastPingSentAtRef = useRef<number | null>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const minRttRef = useRef<number>(Infinity);

  // Clock offset: server_ts_ms - Date.now(), updated on every timer.state
  const clockOffsetRef = useRef(0);

  // Share calibrated NTP offset across all browser tabs of the same tatami
  const syncChannelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    const channelName = `tatami_time_${tid}_${n}`;
    const channel = new BroadcastChannel(channelName);
    syncChannelRef.current = channel;

    channel.onmessage = (e) => {
      const msg = e.data as { type: string; offset?: number; minRtt?: number };
      if (!msg || typeof msg !== "object") return;

      if (msg.type === "request_offset") {
        if (minRttRef.current < Infinity && clockOffsetRef.current !== 0) {
          channel.postMessage({
            type: "offset",
            offset: clockOffsetRef.current,
            minRtt: minRttRef.current,
          });
        }
      } else if (msg.type === "offset" && typeof msg.offset === "number") {
        const incomingMinRtt = msg.minRtt ?? Infinity;
        // Accept the offset if it's calibrated and has a better (or equal) RTT than ours,
        // or if we are not calibrated yet.
        if (incomingMinRtt <= minRttRef.current || minRttRef.current === Infinity) {
          if (incomingMinRtt < minRttRef.current) {
            minRttRef.current = incomingMinRtt;
          }
          if (clockOffsetRef.current !== msg.offset) {
            clockOffsetRef.current = msg.offset;
            if (optsRef.current.onClockOffsetUpdate) {
              optsRef.current.onClockOffsetUpdate(msg.offset);
            }
          }
        }
      }
    };

    // Request the calibrated offset from other tabs immediately on mount
    channel.postMessage({ type: "request_offset" });

    return () => {
      channel.close();
    };
  }, [tid, n]);

  const connect = useCallback(() => {
    if (!isMounted.current) return;

    const proto = globalThis.location.protocol === "https:" ? "wss" : "ws";
    const url = `${proto}://${globalThis.location.host}/ws/tournament/${tid}/tatami/${n}/`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    const sendPing = () => {
      if (ws.readyState === WebSocket.OPEN) {
        lastPingSentAtRef.current = Date.now();
        ws.send(JSON.stringify({ type: "ping" }));
      }
    };

    ws.onopen = () => {
      retryDelay.current = 1000;
      sendPing(); // Перший пінг одразу при з'єднанні

      // Періодично пінгуємо кожні 15 секунд для підтримки з'єднання та синхронізації годинника
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = setInterval(sendPing, 15000);
    };

    ws.onmessage = (e) => {
      let msg: { type: string; [k: string]: unknown };
      try {
        msg = JSON.parse(e.data as string);
      } catch {
        return;
      }

      switch (msg.type) {
        case "tatami.snapshot": {
          const serverTs = msg.server_ts_ms as number;
          if (serverTs && clockOffsetRef.current === 0) {
            clockOffsetRef.current = serverTs - Date.now();
            if (optsRef.current.onClockOffsetUpdate) {
              optsRef.current.onClockOffsetUpdate(clockOffsetRef.current);
            }
          }
          optsRef.current.onSnapshot(msg.data as TatamiSnapshot);
          break;
        }

        case "match.event":
          optsRef.current.onMatchEvent(
            msg.event as { sequence: number; event_type: string; payload: unknown },
            msg.match as Match,
          );
          break;

        case "pong": {
          if (lastPingSentAtRef.current !== null) {
            const now = Date.now();
            const rtt = now - lastPingSentAtRef.current;

            // RTT Throttling Guard: if RTT is abnormally high (> 150ms), it's highly likely
            // that the browser's event loop was throttled (tab in background). Ignore it for NTP.
            if (rtt > 150) {
              break;
            }

            const serverTs = msg.server_ts_ms as number;
            // NTP Algorithm: server_time - (client_send_time + RTT / 2)
            const correctedOffset = serverTs - (lastPingSentAtRef.current + rtt / 2);

            // Use minimum-RTT filter for highest stability
            if (rtt < minRttRef.current) {
              minRttRef.current = rtt;
              clockOffsetRef.current = correctedOffset;
            } else {
              // Smooth exponential moving average to track slow clock drifts
              clockOffsetRef.current = Math.round(clockOffsetRef.current * 0.9 + correctedOffset * 0.1);
            }

            // Broadcast the calibrated offset to all other tabs instantly!
            syncChannelRef.current?.postMessage({
              type: "offset",
              offset: clockOffsetRef.current,
              minRtt: minRttRef.current,
            });

            // Instantly update parent components with the robust NTP offset
            if (optsRef.current.onClockOffsetUpdate) {
              optsRef.current.onClockOffsetUpdate(clockOffsetRef.current);
            }
          }
          break;
        }

        case "timer.state": {
          const serverTs = msg.server_ts_ms as number;
          // Якщо NTP-офсет ще не пораховано (перші секунди підключення), ініціалізуємо його одностороннім
          if (clockOffsetRef.current === 0) {
            clockOffsetRef.current = serverTs - Date.now();
            if (optsRef.current.onClockOffsetUpdate) {
              optsRef.current.onClockOffsetUpdate(clockOffsetRef.current);
            }
          }

          // Передаємо батьківському компоненту скоригований високоточний timestamp
          const correctedServerTs = Date.now() + clockOffsetRef.current;
          optsRef.current.onTimerState(msg.state as TimerStatePayload, correctedServerTs);
          break;
        }

        case "tatami.state": {
          const serverTs = msg.server_ts_ms as number;
          if (serverTs && clockOffsetRef.current === 0) {
            clockOffsetRef.current = serverTs - Date.now();
            if (optsRef.current.onClockOffsetUpdate) {
              optsRef.current.onClockOffsetUpdate(clockOffsetRef.current);
            }
          }
          optsRef.current.onTatamiState(
            msg as unknown as { tatami: TatamiSnapshot["tatami"]; current_match: Match | null },
          );
          break;
        }
      }
    };

    ws.onclose = () => {
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
      if (!isMounted.current) return;
      const delay = Math.min(retryDelay.current, 30_000);
      retryDelay.current = Math.min(retryDelay.current * 2, 30_000);
      retryRef.current = setTimeout(connect, delay);
    };

    ws.onerror = () => { ws.close(); };
  }, [tid, n]);

  useEffect(() => {
    isMounted.current = true;
    connect();
    return () => {
      isMounted.current = false;
      if (retryRef.current) clearTimeout(retryRef.current);
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return clockOffsetRef;
}
