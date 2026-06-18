import { useRef, useCallback, MouseEvent } from "react";

export function useDragScroll() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isDown = useRef(false);
  const startX = useRef(0);
  const scrollLeftStart = useRef(0);
  const wasDragged = useRef(false);

  const onMouseDown = useCallback((e: MouseEvent<HTMLDivElement>) => {
    const container = containerRef.current;
    if (!container) return;

    isDown.current = true;
    startX.current = e.pageX - container.offsetLeft;
    scrollLeftStart.current = container.scrollLeft;
    wasDragged.current = false;
  }, []);

  const onMouseMove = useCallback((e: MouseEvent<HTMLDivElement>) => {
    const container = containerRef.current;
    if (!isDown.current || !container) return;

    e.preventDefault(); // Prevents selection
    const x = e.pageX - container.offsetLeft;
    const walk = (x - startX.current) * 1.5; // multiplier
    container.scrollLeft = scrollLeftStart.current - walk;

    if (Math.abs(x - startX.current) > 5) {
      wasDragged.current = true;
    }
  }, []);

  const onMouseUp = useCallback(() => {
    isDown.current = false;
  }, []);

  const onMouseLeave = useCallback(() => {
    isDown.current = false;
  }, []);

  const onClickCapture = useCallback((e: MouseEvent) => {
    if (wasDragged.current) {
      e.stopPropagation();
      e.preventDefault();
      wasDragged.current = false;
    }
  }, []);

  return {
    ref: containerRef,
    props: {
      onMouseDown,
      onMouseMove,
      onMouseUp,
      onMouseLeave,
      onClickCapture,
    },
  };
}
