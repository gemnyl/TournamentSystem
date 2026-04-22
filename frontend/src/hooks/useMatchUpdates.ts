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

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      retryDelay.current = 1000; // скидаємо backoff
      optionsRef.current?.onConnect?.();
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as { type: string; data: Match };
        if (msg.type === "match_update") {
          onUpdateRef.current(msg.data);
        }
      } catch {
        // ігноруємо невалідні повідомлення
      }
    };

    ws.onclose = () => {
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
      wsRef.current?.close();
    };
  }, [connect]);
}
