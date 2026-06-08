import { useEffect, useRef, useCallback } from "react";
import type { Match } from "@/types/api";

interface UseMatchUpdatesOptions {
  onConnect?:    () => void;
  onDisconnect?: () => void;
}

/**
 * Хук підписки на WebSocket-оновлення матчів категорії.
 *
 * Підключається до ws://localhost:8000/ws/category/{categoryId}/
 * через Vite proxy (/ws → ws://localhost:8000/ws).
 * При розриві повторно підключається з exponential backoff (до 30с).
 *
 * @param categoryId  — id категорії
 * @param onUpdate    — callback при надходженні оновлення матчу
 * @param options     — опційні колбеки connect/disconnect
 */
export function useMatchUpdates(
  categoryId: number,
  onUpdate: (match: Match) => void,
  options?: UseMatchUpdatesOptions,
) {
  const wsRef       = useRef<WebSocket | null>(null);
  const retryRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryDelay  = useRef(1000);   // початкова затримка 1с
  const isMounted   = useRef(true);
  const onUpdateRef = useRef(onUpdate);
  const optionsRef  = useRef(options);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Тримаємо актуальні посилання без re-subscribe
  useEffect(() => { onUpdateRef.current = onUpdate; }, [onUpdate]);
  useEffect(() => { optionsRef.current = options; },   [options]);

  const connect = useCallback(() => {
    if (!isMounted.current) return;
    if (!categoryId) return; // Не підключатись до /ws/category/0/

    // URL через Vite proxy
    const url = `/ws/category/${categoryId}/`;
    // Перетворюємо на ws:// — window.location.host вже відомий
    const wsUrl = `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}${url}`;

    // Явно закриваємо попередній сокет і очищуємо обробники, якщо він є
    if (wsRef.current) {
      const oldWs = wsRef.current;
      oldWs.onopen = null;
      oldWs.onmessage = null;
      oldWs.onerror = null;
      oldWs.onclose = null;
      try {
        oldWs.close();
      } catch (e) {
        // ігноруємо помилки
      }
      wsRef.current = null;
    }

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    let pongTimeout: ReturnType<typeof setTimeout> | null = null;

    const sendPing = () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "ping" }));

        if (pongTimeout) clearTimeout(pongTimeout);
        pongTimeout = setTimeout(() => {
          console.warn("WebSocket category ping timeout, closing connection...");
          ws.close();
        }, 5000);
      }
    };

    ws.onopen = () => {
      retryDelay.current = 1000; // скидаємо backoff
      optionsRef.current?.onConnect?.();

      sendPing(); // перший пінг одразу при підключенні
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = setInterval(sendPing, 15000);
    };

    ws.onmessage = (event) => {
      if (pongTimeout) {
        clearTimeout(pongTimeout);
        pongTimeout = null;
      }
      try {
        const msg = JSON.parse(event.data as string) as { type: string; match: Match };
        if (msg.type === "pong") {
          return;
        }
        if (msg.type === "match.event") {
          onUpdateRef.current(msg.match);
        }
      } catch {
        // ігноруємо невалідні повідомлення
      }
    };

    ws.onclose = () => {
      if (pongTimeout) {
        clearTimeout(pongTimeout);
        pongTimeout = null;
      }
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
      optionsRef.current?.onDisconnect?.();
      if (!isMounted.current) return;

      // Exponential backoff: 1s → 2s → 4s … до 30s
      const delay = Math.min(retryDelay.current, 30_000);
      retryDelay.current = Math.min(retryDelay.current * 2, 30_000);

      retryRef.current = setTimeout(connect, delay);
    };

    ws.onerror = () => {
      ws.close(); // onclose запустить retry
    };
  }, [categoryId]);

  useEffect(() => {
    isMounted.current = true;
    connect();

    return () => {
      isMounted.current = false;
      if (retryRef.current) clearTimeout(retryRef.current);
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      if (wsRef.current) {
        const oldWs = wsRef.current;
        oldWs.onopen = null;
        oldWs.onmessage = null;
        oldWs.onerror = null;
        oldWs.onclose = null;
        try {
          oldWs.close();
        } catch (e) {
          // ігноруємо помилки
        }
        wsRef.current = null;
      }
    };
  }, [connect]);
}
