/**
 * Google's own product icons — the 2026 set, the current one.
 *
 * Inline SVG rather than files in `public/`: these sit next to a card title at
 * 32px, and an `<img>` for each is three requests plus a flash of nothing on
 * a cold load.
 *
 * Every path is the published one, unaltered — including the gradients and the
 * blurred inner highlight. Re-encoding a path by hand (absolute to relative,
 * or rounded) is how a logo ends up subtly wrong, so don't: take the current
 * mark and change only the ids and the viewBox, for the two reasons below.
 *
 * Two things to keep in mind when editing.
 *
 * **Every id is prefixed.** All three ship with masks and gradients called
 * `a`, `b`, `c`. Inline them together with those names and the browser
 * resolves `url(#a)` to whichever icon rendered first, which shows up as one
 * card's artwork bleeding into another's. The prefixes are load-bearing.
 *
 * **The viewBoxes are padded to square.** The marks are three different
 * shapes — Sheets is wide, Calendar is tall — so a shared box height would
 * render them at three different optical sizes. Each viewBox is centred in a
 * square instead, which is why the y origins are negative.
 */

type IconProps = { className?: string };

export function GoogleSheetsIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 -109.0909 800 800"
      className={className}
      fill="none"
      role="img"
      aria-label="Google Sheets"
    >
      <defs>
        <linearGradient
          id="gs-sheen"
          x1="122.24"
          x2="20.76"
          y1="43.31"
          y2="43.31"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#0ebc5f" />
          <stop offset=".95" stopColor="#78c9ff" />
        </linearGradient>
        <filter
          id="gs-blur"
          width="168"
          height="126"
          x="-4"
          y="33"
          colorInterpolationFilters="sRGB"
          filterUnits="userSpaceOnUse"
        >
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feBlend
            in="SourceGraphic"
            in2="BackgroundImageFix"
            result="shape"
            mode="normal"
          />
          <feGaussianBlur result="blur" stdDeviation="6" />
        </filter>
        <mask
          id="gs-card"
          width="160"
          height="128"
          x="24"
          y="32"
          maskUnits="userSpaceOnUse"
        >
          <rect width="160" height="128" x="24" y="32" fill="#fff" rx="20" />
        </mask>
      </defs>
      {/* The August 2026 revision turned the mark through half a turn. */}
      <g transform="rotate(180,400,290.9091)">
        <path
          fill="#009954"
          d="M0 193.6364c0-40.65 0-60.9773 6.3818-77.1a90.91 90.91 0 0 1 51.0637-51.0591c16.1227-6.3864 36.4454-6.3864 77.1-6.3864H410.909c40.65 0 60.9773 0 77.1 6.3818a90.91 90.91 0 0 1 51.0636 51.0637c6.3818 16.1227 6.3818 36.4454 6.3818 77.1v194.5454c0 40.65 0 60.9773-6.3818 77.1a90.91 90.91 0 0 1-51.0636 51.0637c-16.1227 6.3818-36.45 6.3818-77.1 6.3818H134.5454c-40.65 0-60.9772 0-77.1045-6.3818a90.91 90.91 0 0 1-51.059-51.0637C0 449.1591 0 428.8318 0 388.1818Z"
        />
        <g
          mask="url(#gs-card)"
          transform="matrix(4.5454545,0,0,4.5454545,-36.363636,-145.45454)"
        >
          <path fill="#0ebc5f" d="M24 32h160v128H24Z" />
          <g filter="url(#gs-blur)">
            <rect
              width="144"
              height="102"
              fill="url(#gs-sheen)"
              rx="25.6"
              transform="matrix(1,0,0,-1,8,147)"
            />
          </g>
        </g>
        <path
          stroke="#fff"
          strokeLinecap="round"
          strokeWidth="54.5455"
          d="M327.2727 404.5455H709.091m-90.909 86.3636v-290.909"
        />
      </g>
    </svg>
  );
}

export function GoogleCalendarIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="-29.5477 0 859.0954 859.0954"
      className={className}
      fill="none"
      role="img"
      aria-label="Google Calendar"
    >
      <defs>
        <linearGradient
          id="gc-body"
          x1="83"
          x2="83"
          y1="76"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#4fa0ff" />
          <stop offset="1" stopColor="#3186ff" />
        </linearGradient>
        <linearGradient
          id="gc-sheen"
          x1="89.06"
          x2="89.06"
          y1="21.75"
          y2="96.39"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#a9a8ff" />
          <stop offset=".8" stopColor="#3c90ff" />
        </linearGradient>
        <filter
          id="gc-blur"
          width="152"
          height="112"
          x="20"
          y="-4"
          colorInterpolationFilters="sRGB"
          filterUnits="userSpaceOnUse"
        >
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feBlend
            in="SourceGraphic"
            in2="BackgroundImageFix"
            result="shape"
            mode="normal"
          />
          <feGaussianBlur result="blur" stdDeviation="6" />
        </filter>
        <mask
          id="gc-page"
          width="154"
          height="152"
          x="19"
          y="20"
          maskUnits="userSpaceOnUse"
        >
          <path
            fill="#fff"
            d="M 19.867,49.392 C 17.818,33.82 29.94,20 45.645,20 h 100.71 c 15.706,0 27.827,13.82 25.778,29.392 L 166,96 l 6.133,46.608 C 174.182,158.18 162.061,172 146.355,172 H 45.645 C 29.939,172 17.818,158.18 19.867,142.608 L 26,96 Z"
          />
        </mask>
      </defs>
      <path
        fill="#bbe2ff"
        d="M 64.743253,150.86554 C 64.743253,67.543758 132.28701,0 215.60879,0 h 368.78242 c 83.32178,0 150.86554,67.543758 150.86554,150.86554 v 159.24695 c 0,83.32178 -67.54376,150.86554 -150.86554,150.86554 H 215.60879 c -83.32178,0 -150.865537,-67.54376 -150.865537,-150.86554 z"
      />
      <path
        fill="#3c90ff"
        d="M 1.1859076,216.8273 C -9.5475474,135.25514 53.952176,62.86064 136.22104,62.86064 h 527.55792 c 82.2741,0 145.76859,72.3945 135.03513,153.96666 l -32.12702,244.15073 32.12702,244.15072 c 10.73346,81.57216 -52.76103,153.96666 -135.03513,153.96666 H 136.22104 c -82.274102,0 -145.7685874,-72.3945 -135.0351324,-153.96666 L 33.312933,460.97803 Z"
      />
      <g
        mask="url(#gc-page)"
        transform="matrix(5.2383867,0,0,5.2383867,-102.88512,-41.907093)"
      >
        <path
          fill="url(#gc-body)"
          d="M 0,0 H 166 V 76 H 0 Z"
          transform="matrix(1,0,0,-1,13,172)"
        />
      </g>
      <g
        mask="url(#gc-page)"
        transform="matrix(5.2383867,0,0,5.2383867,-102.88512,-41.907093)"
      >
        <path
          fill="url(#gc-sheen)"
          d="M 32,27.2 C 32,16.596 40.596,8 51.2,8 h 89.6 C 151.404,8 160,16.596 160,27.2 V 96 H 32 Z"
          filter="url(#gc-blur)"
        />
      </g>
      {/* The date numeral. One path, straight from the mark. */}
      <path
        fill="#fff"
        d="m 291.84303,656.55843 q -32.90754,0 -56.45409,-10.70202 -23.54655,-10.70203 -39.86412,-28.62779 -16.05566,-18.19815 -22.74508,-35.58436 -6.68942,-17.3862 -5.34839,-21.13689 a 10.84346,10.84346 0 0 1 5.34839,-5.88794 l 29.70165,-11.77066 q 3.74021,-1.8701 7.4909,-0.53431 3.74021,1.06863 8.82668,12.30497 5.35363,11.23634 14.98178,23.8137 a 74.908929,74.908929 0 0 0 23.54655,19.52871 q 13.65124,6.95658 33.70902,6.95658 32.37323,0 51.37286,-18.72724 19.26155,-18.72723 19.26155,-47.62217 0,-31.3046 -20.33542,-48.16173 Q 321.00513,473.283 287.55803,473.283 H 259.4698 a 9.9529347,9.9529347 0 0 1 -6.95657,-2.67158 q -2.67158,-2.94397 -2.67682,-6.68942 v -28.62778 q 0,-4.01785 2.67158,-6.68942 a 9.5338637,9.5338637 0 0 1 6.96181,-2.94398 h 24.34279 q 29.96881,0 48.16172,-16.32281 18.19292,-16.32281 18.19292,-42.27378 0,-25.67857 -16.32281,-41.46707 -16.32282,-15.7885 -44.94536,-15.7885 -16.05566,0 -27.82631,5.35364 a 60.241447,60.241447 0 0 0 -20.33542,14.98178 118.91138,118.91138 0 0 0 -14.71463,19.8011 q -6.14986,10.16771 -9.90055,11.23634 -3.7402,0.80148 -7.22373,-1.33579 l -28.09347,-13.64599 q -3.47829,-1.87535 -4.54692,-5.88795 -1.06863,-4.0126 6.42226,-18.72723 7.75805,-14.98179 23.54131,-30.50313 a 110.00612,110.00612 0 0 1 36.92539,-24.08086 q 21.13689,-8.56476 49.23036,-8.55953 52.17433,0 82.67222,27.55392 30.50312,27.29199 30.50312,72.24259 0,31.03744 -14.98178,53.77728 -14.71987,22.7346 -41.73947,32.11131 v 1.06863 q 32.64039,9.62815 51.36762,35.31196 18.99963,25.42189 18.99439,60.73386 0,50.57138 -35.3172,82.94461 -35.30673,32.37323 -92.03846,32.37323 z m 268.46732,-6.1551 q -4.54692,0 -8.03045,-3.47829 a 11.78637,11.78637 0 0 1 -3.20589,-8.29237 V 341.11326 l -60.19954,43.34241 q -3.21637,2.40966 -7.49613,1.60819 a 10.267238,10.267238 0 0 1 -6.41702,-4.0126 l -17.39145,-24.62042 a 10.372006,10.372006 0 0 1 -1.87534,-7.4909 q 0.80147,-4.27452 4.27976,-6.68418 l 106.75308,-76.25519 q 1.34103,-1.06863 2.94398,-1.60295 1.60818,-0.80147 3.74544,-0.80147 h 22.47792 q 4.54692,0 7.22374,3.21113 2.94397,2.9335 2.94397,7.49089 v 363.3345 q 0,4.81932 -3.47829,8.29237 a 10.476773,10.476773 0 0 1 -8.03045,3.47829 z"
      />
    </svg>
  );
}

export function GoogleDriveIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 -29.3152 800 800"
      className={className}
      fill="none"
      role="img"
      aria-label="Google Drive"
    >
      <defs>
        <linearGradient
          id="gd-yellow"
          x1="193.6"
          x2="103.09"
          y1="165.6"
          y2="111.21"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset=".09" stopColor="#ffe921" />
          <stop offset="1" stopColor="#fec700" />
        </linearGradient>
        <linearGradient
          id="gd-blue"
          x1="114.4"
          x2="15.53"
          y1="181.61"
          y2="121.8"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset=".15" stopColor="#a9a8ff" />
          <stop offset=".33" stopColor="#6d97ff" />
          <stop offset=".48" stopColor="#3186ff" />
        </linearGradient>
        <linearGradient
          id="gd-green"
          x1="128.88"
          x2="28.7"
          y1="37.88"
          y2="84.64"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset=".55" stopColor="#0ebc5f" />
          <stop offset=".85" stopColor="#78c9ff" />
        </linearGradient>
        <mask
          id="gd-triangle"
          width="168"
          height="154"
          x="12"
          y="18"
          maskUnits="userSpaceOnUse"
        >
          <path
            fill="#fff"
            d="M63.09 37c14.626-25.333 51.193-25.334 65.819 0l45.033 78c14.626 25.334-3.657 57.001-32.91 57.001H50.967c-29.253 0-47.536-31.667-32.91-57.001Z"
          />
        </mask>
      </defs>
      <g
        mask="url(#gd-triangle)"
        transform="matrix(4.8140532,0,0,4.8140532,-62.146701,-86.652356)"
      >
        <path
          fill="url(#gd-yellow)"
          d="M206.905 172.02h-91.888l-19.015-32.934 45.944-79.578Z"
        />
        <path
          fill="url(#gd-blue)"
          d="M-14.919 172.006 50.04 59.494v.002L31.032 92.422h38.02L115 172.004l-129.918.001Z"
        />
        <path
          fill="url(#gd-green)"
          d="M96.007-20.085 141.954 59.5l-19.011 32.928H31.048Z"
        />
      </g>
    </svg>
  );
}

/** The signature G, for the connect button. */
export function GoogleGIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 256 262"
      className={className}
      role="img"
      aria-label="Google"
    >
      <path
        fill="#4285F4"
        d="M255.878,133.451 C255.878,122.717 255.007,114.884 253.122,106.761 L130.55,106.761 L130.55,155.209 L202.497,155.209 C201.047,167.249 193.214,185.381 175.807,197.565 L175.563,199.187 L214.318,229.21 L217.003,229.478 C241.662,206.704 255.878,173.196 255.878,133.451"
      />
      <path
        fill="#34A853"
        d="M130.55,261.1 C165.798,261.1 195.389,249.495 217.003,229.478 L175.807,197.565 C164.783,205.253 149.987,210.62 130.55,210.62 C96.027,210.62 66.726,187.847 56.281,156.37 L54.75,156.5 L14.452,187.687 L13.925,189.152 C35.393,231.798 79.49,261.1 130.55,261.1"
      />
      <path
        fill="#FBBC05"
        d="M56.281,156.37 C53.525,148.247 51.93,139.543 51.93,130.55 C51.93,121.556 53.525,112.853 56.136,104.73 L56.063,103 L15.26,71.312 L13.925,71.947 C5.077,89.644 0,109.517 0,130.55 C0,151.583 5.077,171.455 13.925,189.152 L56.281,156.37"
      />
      <path
        fill="#EB4335"
        d="M130.55,50.479 C155.064,50.479 171.6,61.068 181.029,69.917 L217.873,33.943 C195.245,12.91 165.798,0 130.55,0 C79.49,0 35.393,29.301 13.925,71.947 L56.136,104.73 C66.726,73.253 96.027,50.479 130.55,50.479"
      />
    </svg>
  );
}
