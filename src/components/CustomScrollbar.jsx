import React, { useEffect, useState, useRef } from "react";

/**
 * CustomScrollbar – globaler Custom-Scrollbar (Desktop-Drag, iOS-Bounce-Simulation).
 * Wird in main.jsx parallel zu <App/> gemountet und gilt dadurch für jede Seite/Tab.
 */
const CustomScrollbar = () => {
  const [isScrolling, setIsScrolling] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const thumbRef = useRef(null);
  const scrollTimeoutRef = useRef(null);
  const dragStartYRef = useRef(0);
  const dragStartScrollTopRef = useRef(0);

  // Zentrale Rechenfunktion für Slider-Höhe und Position
  const updateScrollbar = () => {
    const scrollTop = window.scrollY;
    const windowHeight = window.innerHeight;
    const docHeight = document.documentElement.scrollHeight;
    const maxScroll = docHeight - windowHeight;

    // Falls die Seite zu kurz ist und kein Scrollen nötig ist, Slider verstecken
    if (maxScroll <= 0) {
      if (thumbRef.current) thumbRef.current.style.opacity = "0";
      return;
    }

    // Slider-Höhe proportional berechnen (wird automatisch kleiner bei mehr Content)
    const thumbHeight = Math.max((windowHeight / docHeight) * windowHeight, 50);
    const clampedScroll = Math.max(0, Math.min(scrollTop, maxScroll));
    const scrollPercent = clampedScroll / maxScroll;
    const maxThumbTop = windowHeight - thumbHeight - 12;
    let thumbTop = 6 + scrollPercent * maxThumbTop;

    let scaleY = 1;

    // iOS Native Bounce Abfrage
    if (scrollTop < 0) {
      const bounceAmt = Math.abs(scrollTop);
      scaleY = Math.max(0.5, 1 - (bounceAmt / windowHeight) * 2);
      thumbTop = 6;
    } else if (scrollTop > maxScroll) {
      const bounceAmt = scrollTop - maxScroll;
      scaleY = Math.max(0.5, 1 - (bounceAmt / windowHeight) * 2);
      thumbTop = windowHeight - thumbHeight * scaleY - 6;
    }

    if (thumbRef.current) {
      thumbRef.current.style.height = `${thumbHeight}px`;
      thumbRef.current.style.transform = `translateY(${thumbTop}px) scaleY(${scaleY})`;
    }
  };

  useEffect(() => {
    // 1. Native Scrollbars global via CSS-Inject verstecken
    const styleId = "hide-native-scrollbar-style";
    if (!document.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.innerHTML = `
        html, body { scrollbar-width: none !important; -ms-overflow-style: none !important; }
        html::-webkit-scrollbar, body::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }
      `;
      document.head.appendChild(style);
    }

    // 2. Scroll-Handler
    const handleScroll = () => {
      if (dragStartYRef.current !== 0) return;
      setIsScrolling(true);
      updateScrollbar();

      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = setTimeout(() => {
        setIsScrolling(false);
      }, 400);
    };

    // 3. Desktop Bounce-Simulation bei hartem Anschlag
    const handleWheel = (e) => {
      const scrollTop = window.scrollY;
      const windowHeight = window.innerHeight;
      const docHeight = document.documentElement.scrollHeight;
      const maxScroll = docHeight - windowHeight;

      if ((scrollTop <= 0 && e.deltaY < 0) || (scrollTop >= maxScroll && e.deltaY > 0)) {
        setIsScrolling(true);
        const thumbHeight = Math.max((windowHeight / docHeight) * windowHeight, 50);
        const thumbTop = scrollTop <= 0 ? 6 : windowHeight - thumbHeight - 6;

        if (thumbRef.current) {
          thumbRef.current.style.transform = `translateY(${thumbTop}px) scaleY(0.7)`;
          setTimeout(() => {
            if (thumbRef.current) {
              thumbRef.current.style.transform = `translateY(${thumbTop}px) scaleY(1)`;
            }
          }, 150);
        }
      }
    };

    // 4. INFINITE SCROLL & CONTENT TRACKER
    // Beobachtet das gesamte HTML-Dokument: Wächst die Seite (z. B. durch
    // asynchron geladenen Content), triggert das ein Update.
    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(updateScrollbar);
    });
    resizeObserver.observe(document.documentElement);

    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("wheel", handleWheel, { passive: true });
    window.addEventListener("resize", updateScrollbar);

    // Initiale Berechnung beim Laden
    updateScrollbar();

    return () => {
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("wheel", handleWheel);
      window.removeEventListener("resize", updateScrollbar);
      resizeObserver.disconnect();
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    };
  }, []);

  // 5. Drag & Drop Logik für den Desktop
  const handleMouseDown = (e) => {
    e.preventDefault();
    setIsDragging(true);
    dragStartYRef.current = e.clientY;
    dragStartScrollTopRef.current = window.scrollY;

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const handleMouseMove = (e) => {
    if (dragStartYRef.current === 0) return;

    const deltaY = e.clientY - dragStartYRef.current;
    const windowHeight = window.innerHeight;
    const docHeight = document.documentElement.scrollHeight;
    const maxScroll = docHeight - windowHeight;
    const thumbHeight = Math.max((windowHeight / docHeight) * windowHeight, 50);

    const maxThumbTop = windowHeight - thumbHeight - 12;
    const scrollPerThumbPixel = maxScroll / maxThumbTop;

    const targetScrollTop = dragStartScrollTopRef.current + deltaY * scrollPerThumbPixel;
    window.scrollTo(0, targetScrollTop);

    const clampedScroll = Math.max(0, Math.min(window.scrollY, maxScroll));
    const scrollPercent = clampedScroll / maxScroll;
    const thumbTop = 6 + scrollPercent * maxThumbTop;

    if (thumbRef.current) {
      thumbRef.current.style.transform = `translateY(${thumbTop}px) scaleY(1)`;
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    dragStartYRef.current = 0;
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", handleMouseUp);

    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    scrollTimeoutRef.current = setTimeout(() => {
      setIsScrolling(false);
    }, 400);
  };

  const isActive = isScrolling || isDragging || isHovered;

  return (
    <div
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="fixed right-0 top-0 w-5 h-full z-50 pointer-events-auto flex justify-end"
    >
      <div
        ref={thumbRef}
        onMouseDown={handleMouseDown}
        className={`
          mr-1 rounded-full origin-center bg-[#111111]
          transition-[opacity,width] duration-250 ease-[cubic-bezier(0.25,1,0.5,1)]
          ${isActive ? "opacity-100 w-2.5 cursor-grab active:cursor-grabbing" : "opacity-0 w-1"}
        `}
      />
    </div>
  );
};

export default CustomScrollbar;