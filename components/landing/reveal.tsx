"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { cn } from "@/lib/utils";

gsap.registerPlugin(ScrollTrigger);

/**
 * Reveals its children as they come into view.
 *
 * `stagger` walks the direct children instead of animating the wrapper, which
 * is what makes a grid of cards arrive in sequence rather than as one block.
 *
 * The hidden state comes from CSS (`[data-reveal]`), not from this effect.
 * Applied here it would land a frame after first paint and the section would
 * render, blink out, then animate in. The two ways that could leave content
 * hidden are both closed: a <noscript> override in the page, and the
 * reduced-motion branch below, which reveals immediately.
 */
export function Reveal({
  children,
  className,
  stagger = false,
  /** Pixels to travel. Small — this should read as settling, not sliding in. */
  distance = 24,
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  stagger?: boolean;
  distance?: number;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    // Nothing moves, and the CSS hidden state is lifted at once.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      gsap.set(node, { opacity: 1 });
      return;
    }

    const targets = stagger
      ? Array.from(node.children)
      : ([node] as Element[]);
    if (targets.length === 0) {
      gsap.set(node, { opacity: 1 });
      return;
    }

    const timeline = gsap.timeline({
      scrollTrigger: {
        trigger: node,
        // Fires once the element is a seventh of the way up the viewport, so it
        // has been on screen for a moment before it moves. Triggering at the
        // very bottom edge animates where nobody is looking.
        start: "top 85%",
        // Once. A section that re-animates every time you scroll back past it
        // turns a page into a fairground.
        once: true,
      },
    });

    timeline
      // The wrapper carries the CSS hidden state; children carry the motion.
      // Lifting it here rather than in markup is what avoids the blink.
      .set(node, { opacity: 1 })
      .fromTo(
        targets,
        { opacity: 0, y: distance },
        {
          opacity: 1,
          y: 0,
          duration: 0.7,
          delay,
          ease: "power2.out",
          stagger: stagger ? 0.08 : 0,
        }
      );

    return () => {
      timeline.scrollTrigger?.kill();
      timeline.kill();
      // Cleared, or a fast refresh leaves the inline opacity behind.
      gsap.set(targets, { clearProps: "opacity,transform" });
    };
  }, [stagger, distance, delay]);

  return (
    <div ref={ref} data-reveal className={cn(className)}>
      {children}
    </div>
  );
}
