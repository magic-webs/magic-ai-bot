"use client";

import { useEffect } from "react";
import Lenis from "lenis";
// Lenis's own stylesheet. Small, and it carries the one rule that matters:
// scroll-behavior is forced back to auto while smoothing is on, so a CSS
// smooth-scroll declaration anywhere cannot fight it.
import "lenis/dist/lenis.css";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

/**
 * Lenis smooth scrolling, driven from GSAP's ticker.
 *
 * The two have to share one loop. Left to themselves Lenis runs its own
 * requestAnimationFrame while ScrollTrigger listens for native scroll events,
 * and the reveals then fire against a scroll position that is one frame stale —
 * which reads as animations lagging behind the page. So Lenis is stepped by
 * GSAP's ticker and tells ScrollTrigger where it is.
 *
 * Mounted on the landing page only. It takes over the document scroller,
 * and the dashboard scrolls inside its own panes — handing those to Lenis as
 * well would fight the layout rather than help it.
 */
export function SmoothScroll({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Someone who has asked their operating system for less motion has not
    // asked for eased, momentum-carrying scrolling either. Native scroll is
    // left completely alone for them.
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduced.matches) return;

    gsap.registerPlugin(ScrollTrigger);

    const lenis = new Lenis({
      // Just enough easing to feel deliberate. Longer and the page starts
      // fighting the wheel.
      duration: 0.9,
      // Touch devices already have momentum scrolling that people know the
      // feel of; overriding it makes a phone feel broken.
      smoothWheel: true,
      touchMultiplier: 1.6,
      // The header's #routing and #guardrails links. Without this they jump
      // instantly while everything else eases, which reads as a bug.
      anchors: true,
    });

    lenis.on("scroll", ScrollTrigger.update);

    const step = (time: number) => {
      // GSAP's ticker is in seconds, Lenis wants milliseconds.
      lenis.raf(time * 1000);
    };
    gsap.ticker.add(step);
    // Left on, GSAP's own lag smoothing lets the ticker skip time after a
    // stall, and a skipped frame here shows up as the page jumping.
    gsap.ticker.lagSmoothing(0);

    return () => {
      gsap.ticker.remove(step);
      lenis.destroy();
      ScrollTrigger.getAll().forEach((trigger) => trigger.kill());
    };
  }, []);

  return <>{children}</>;
}
