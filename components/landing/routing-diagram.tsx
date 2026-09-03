"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { MotionPathPlugin } from "gsap/MotionPathPlugin";

gsap.registerPlugin(ScrollTrigger, MotionPathPlugin);

/**
 * The routing idea, drawn.
 *
 * This is the one thing about the product that is genuinely hard to explain in
 * a sentence: a customer messages one number, a front desk works out what they
 * want, and a specialist answers — without the customer ever seeing a handover.
 * Three paragraphs were doing that job. A message travelling down a wire does
 * it in about four seconds.
 *
 * Everything is drawn with the theme's own tokens, so it follows light, dark
 * and whichever palette the page is rendered in.
 */

const SPECIALISTS = [
  { label: "Sales", y: 60 },
  { label: "Support", y: 132 },
  { label: "Payments", y: 204 },
  { label: "Accounts", y: 276 },
];

export function RoutingDiagram() {
  const root = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = root.current;
    if (!svg) return;

    const wires = Array.from(
      svg.querySelectorAll<SVGPathElement>("[data-wire]")
    );
    const pods = Array.from(svg.querySelectorAll<SVGGElement>("[data-pod]"));
    const packet = svg.querySelector<SVGCircleElement>("[data-packet]");
    const inbound = svg.querySelector<SVGPathElement>("[data-inbound]");
    if (!packet || !inbound) return;

    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    // Drawn state is the resting state, so the diagram is complete and readable
    // whether or not anything animates.
    if (reduced) {
      gsap.set([inbound, ...wires], { strokeDashoffset: 0 });
      gsap.set(packet, { opacity: 0 });
      return;
    }

    const ctx = gsap.context(() => {
      // Each wire is dashed by its own length, so offsetting by that length
      // hides it exactly and tweening to zero draws it end to end.
      for (const wire of [inbound, ...wires]) {
        const length = wire.getTotalLength();
        gsap.set(wire, { strokeDasharray: length, strokeDashoffset: length });
      }
      gsap.set(pods, { opacity: 0.35 });
      gsap.set(packet, { opacity: 0 });

      const draw = gsap.timeline({
        scrollTrigger: { trigger: svg, start: "top 80%", once: true },
      });
      draw
        .to(inbound, { strokeDashoffset: 0, duration: 0.5, ease: "power2.out" })
        .to(
          wires,
          {
            strokeDashoffset: 0,
            duration: 0.6,
            ease: "power2.out",
            stagger: 0.08,
          },
          "-=0.2"
        )
        .to(pods, { opacity: 1, duration: 0.4, stagger: 0.06 }, "-=0.4");

      // One trip per specialist, then round again: the point being made is that
      // the same inbound message can end up anywhere.
      const trip = gsap.timeline({
        repeat: -1,
        repeatDelay: 0.4,
        scrollTrigger: { trigger: svg, start: "top 80%" },
        delay: 1.1,
      });

      SPECIALISTS.forEach((_, index) => {
        const wire = wires[index];
        const pod = pods[index];
        trip
          .set(packet, { opacity: 1 })
          .to(packet, {
            duration: 0.7,
            ease: "none",
            motionPath: { path: inbound, align: inbound, alignOrigin: [0.5, 0.5] },
          })
          .to(packet, {
            duration: 0.9,
            ease: "power1.inOut",
            motionPath: { path: wire, align: wire, alignOrigin: [0.5, 0.5] },
          })
          .set(packet, { opacity: 0 })
          // The specialist that took it lights up, then settles back.
          .to(pod, { opacity: 1, duration: 0.2 }, "<")
          .fromTo(
            pod.querySelector("[data-pod-ring]"),
            { opacity: 0.9, scale: 1 },
            {
              opacity: 0,
              scale: 1.18,
              duration: 0.7,
              transformOrigin: "center",
              ease: "power2.out",
            },
            "<"
          );
      });
    }, svg);

    return () => ctx.revert();
  }, []);

  return (
    <svg
      ref={root}
      viewBox="0 0 760 340"
      role="img"
      aria-label="A customer message arrives at the front desk, which passes it to whichever specialist should answer — sales, support, payments or accounts."
      className="h-auto w-full"
    >
      {/* --- wires ------------------------------------------------------- */}
      <path
        data-inbound
        d="M156 170 H300"
        fill="none"
        stroke="var(--primary)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {SPECIALISTS.map((specialist) => (
        <path
          key={specialist.label}
          data-wire
          d={`M450 170 C512 170 540 ${specialist.y} 600 ${specialist.y}`}
          fill="none"
          stroke="var(--border)"
          strokeWidth="2"
          strokeLinecap="round"
        />
      ))}

      {/* --- customer ---------------------------------------------------- */}
      <g>
        <rect
          x="24"
          y="140"
          width="132"
          height="60"
          rx="14"
          fill="var(--card)"
          stroke="var(--border)"
        />
        <text
          x="90"
          y="166"
          textAnchor="middle"
          className="fill-foreground text-[13px] font-medium"
        >
          Customer
        </text>
        <text
          x="90"
          y="184"
          textAnchor="middle"
          className="fill-muted-foreground text-[11px]"
        >
          one number
        </text>
      </g>

      {/* --- front desk -------------------------------------------------- */}
      <g>
        <rect
          x="300"
          y="130"
          width="150"
          height="80"
          rx="18"
          fill="color-mix(in oklch, var(--primary) 10%, var(--card))"
          stroke="var(--primary)"
          strokeOpacity="0.5"
        />
        <text
          x="375"
          y="164"
          textAnchor="middle"
          className="fill-foreground text-[13px] font-medium"
        >
          Front desk
        </text>
        <text
          x="375"
          y="183"
          textAnchor="middle"
          className="fill-muted-foreground text-[11px]"
        >
          works out who
        </text>
      </g>

      {/* --- specialists ------------------------------------------------- */}
      {SPECIALISTS.map((specialist) => (
        <g key={specialist.label} data-pod>
          {/* Sits behind the pod and expands out of it when it takes a
              message. Painted first so it never covers the label. */}
          <rect
            data-pod-ring
            x="600"
            y={specialist.y - 26}
            width="136"
            height="52"
            rx="13"
            fill="none"
            stroke="var(--primary)"
            strokeWidth="2"
            opacity="0"
          />
          <rect
            x="600"
            y={specialist.y - 26}
            width="136"
            height="52"
            rx="13"
            fill="var(--card)"
            stroke="var(--border)"
          />
          <text
            x="668"
            y={specialist.y + 5}
            textAnchor="middle"
            className="fill-foreground text-[13px]"
          >
            {specialist.label}
          </text>
        </g>
      ))}

      {/* The message in flight. Positioned entirely by MotionPathPlugin. */}
      <circle
        data-packet
        r="6"
        fill="var(--primary)"
        opacity="0"
      />
    </svg>
  );
}
