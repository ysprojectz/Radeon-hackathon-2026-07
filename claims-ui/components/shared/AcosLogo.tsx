interface AcosLogoProps {
  compact?: boolean;
  iconOnly?: boolean;
  showLabel?: boolean;
  stacked?: boolean;
  classic?: boolean;
  className?: string;
}

export function AcosLogo({
  compact = false,
  iconOnly = false,
  showLabel = false,
  stacked = false,
  classic = false,
  className = "",
}: AcosLogoProps) {
  return (
    <div
      className={[
        "acos-logo",
        compact ? "acos-logo--compact" : "acos-logo--standard",
        iconOnly ? "acos-logo--icon-only" : "",
        stacked ? "acos-logo--stacked" : "",
        classic ? "acos-logo--classic" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label="ACOS - Autonomous Claims Operating System"
    >
      <div className="acos-mark">
        {!iconOnly && (
          <>
            <span className="acos-letter acos-letter-a">A</span>
            <span className="acos-letter acos-letter-c">C</span>
          </>
        )}

        {/* Orbital O — the animated centrepiece */}
        <span className="acos-orbit" aria-hidden="true">
          {/* Outer segmented ring */}
          <span className="acos-ring-outer" />
          {/* Small planet dot orbiting the outer ring */}
          <span className="acos-planet" />
          {/* Mid counter-rotating ring */}
          <span className="acos-ring-mid" />
          {/* Inner forward ring */}
          <span className="acos-ring-inner" />
          {/* Glowing core sphere */}
          <span className="acos-core" />
          <span className="acos-core-bright" />
        </span>

        {!iconOnly && (
          <>
            <span className="acos-letter acos-letter-s">S</span>
            {/* Fast traveler dot that sweeps across all letters */}
            <span className="acos-traveler" aria-hidden="true">
              <span />
            </span>
          </>
        )}
      </div>

      {showLabel && !iconOnly && (
        <div className="acos-label">
          <span className="acos-label-top">Autonomous Claims</span>
          <span className="acos-label-bottom">
            <span className="acos-label-rule" />
            Operating System
            <span className="acos-label-rule" />
          </span>
        </div>
      )}

      <style jsx>{`
        /* ── Variables — the SAME enterprise blue as tokens.css's
           --brand-primary, not a separate cyan palette. Redesigned
           2026-07-25: the previous cyan/electric-blue scheme
           (#06b6d4/#22d3ee/#00ffcc glows) was a second, undocumented
           color system that clashed with every button/link in the
           actual (blue-600) redesigned UI. One hue family now, just
           varied in tint/shade for depth. ─────────────────────────── */
        .acos-logo {
          --p:  var(--brand-primary, #2563eb);   /* blue-600 — same as every primary action in the app */
          --ps: rgba(37,99,235,0.28);            /* soft glow, same hue as --p */
          --q:  var(--brand-primary-hover, #1d4ed8); /* blue-700 — gradient depth / hover tone */
          --a:  #60a5fa;                          /* blue-400 — accent highlight, still one hue */
          --lt: #bfdbfe;                          /* blue-200 — letter gradient top / core highlight */
          --lb: #1e3a8a;                          /* blue-900 — letter gradient bottom, deepest tone */
          display: inline-flex;
          align-items: center;
          gap: 10px;
          min-width: 0;
          background: transparent;
        }

        /* ── Size tokens ────────────────────────────────────────────────── */
        .acos-logo--standard {
          --ls:  46px;   /* letter font-size */
          --os:  58px;   /* orbit diameter */
          --cs:  14px;   /* core diameter */
          --ds:   6px;   /* planet dot diameter */
          --or:  27px;   /* orbit radius for planet */
          --ts:   9px;   /* traveler size */
          --mw: 182px;
          --mh:  58px;
        }
        .acos-logo--compact {
          --ls:  22px;
          --os:  30px;
          --cs:   8px;
          --ds:   4px;
          --or:  13px;
          --ts:   6px;
          --mw:  98px;
          --mh:  30px;
        }
        .acos-logo--icon-only {
          --mw: var(--os);
          --mh: var(--os);
        }

        /* ── Mark grid ──────────────────────────────────────────────────── */
        .acos-mark {
          position: relative;
          display: grid;
          grid-template-columns: min-content min-content var(--os) min-content;
          align-items: center;
          justify-content: center;
          width: var(--mw);
          height: var(--mh);
          isolation: isolate;
        }
        .acos-logo--icon-only .acos-mark {
          display: flex;
        }

        /* ── Letters ────────────────────────────────────────────────────── */
        .acos-letter {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-family: var(--font-logo);
          font-size: var(--ls);
          font-weight: 900;
          line-height: 1;
          letter-spacing: -0.01em;
          color: transparent;
          background: linear-gradient(
            165deg,
            var(--lt)  0%,
            var(--p)  38%,
            var(--q)  68%,
            var(--lb) 100%
          );
          background-clip: text;
          -webkit-background-clip: text;
          filter: drop-shadow(0 0 8px rgba(37,99,235,0.35))
                  drop-shadow(0 2px 6px rgba(30,58,138,0.35));
          animation: acos-letter-glow 8s ease-in-out infinite;
        }
        .acos-letter-a { animation-delay:  0s; }
        .acos-letter-c { animation-delay: 1.8s; }
        .acos-letter-s { animation-delay: 4.2s; }

        /* ── Orbit container ────────────────────────────────────────────── */
        .acos-orbit {
          position: relative;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: var(--os);
          height: var(--os);
          margin: 0 1px;
        }

        /* ── Outer segmented ring ────────────────────────────────────────
           Uses conic-gradient (3 arcs, 3 gaps) + mask ring to create the
           segmented circle from the reference image.
        ──────────────────────────────────────────────────────────────────── */
        .acos-ring-outer {
          position: absolute;
          inset: 0;
          border-radius: 50%;
          background: conic-gradient(
            var(--lt)  0deg   5deg,
            var(--p)   5deg 130deg,
            transparent    130deg 155deg,
            var(--q)  155deg 310deg,
            transparent    310deg 340deg,
            var(--lt) 340deg 360deg
          );
          -webkit-mask: radial-gradient(
            farthest-side,
            transparent calc(100% - 3px),
            #000        calc(100% - 3px)
          );
          mask: radial-gradient(
            farthest-side,
            transparent calc(100% - 3px),
            #000        calc(100% - 3px)
          );
          filter: drop-shadow(0 0 5px rgba(37,99,235,0.5));
          animation: acos-spin 5s linear infinite;
        }

        /* ── Planet dot on outer ring ───────────────────────────────────── */
        .acos-planet {
          position: absolute;
          top: 50%;
          left: 50%;
          width: var(--ds);
          height: var(--ds);
          border-radius: 50%;
          background: var(--a);
          box-shadow: 0 0 8px var(--a), 0 0 18px rgba(96,165,250,0.5);
          animation: acos-planet-orbit 5s linear infinite;
        }

        /* ── Mid counter-rotating ring ─────────────────────────────────── */
        .acos-ring-mid {
          position: absolute;
          width: calc(var(--os) * 0.67);
          height: calc(var(--os) * 0.67);
          border-radius: 50%;
          border: 1.5px solid transparent;
          border-top-color: var(--a);
          border-right-color: rgba(96,165,250,0.4);
          border-bottom-color: var(--q);
          box-shadow: inset 0 0 6px rgba(37,99,235,0.08);
          animation: acos-spin 2.8s linear infinite reverse;
        }

        /* ── Inner forward ring ─────────────────────────────────────────── */
        .acos-ring-inner {
          position: absolute;
          width: calc(var(--os) * 0.42);
          height: calc(var(--os) * 0.42);
          border-radius: 50%;
          border: 1px solid transparent;
          border-top-color: var(--q);
          border-left-color: rgba(37,99,235,0.5);
          animation: acos-spin 1.6s linear infinite;
        }

        /* ── Core sphere ─────────────────────────────────────────────────── */
        .acos-core {
          position: absolute;
          width: var(--cs);
          height: var(--cs);
          border-radius: 50%;
          background: radial-gradient(
            circle,
            #fff       0%,
            var(--lt) 25%,
            var(--p)  55%,
            var(--q) 100%
          );
          box-shadow:
            0 0 0 calc(var(--cs) * 0.4) rgba(37,99,235,0.12),
            0 0 14px var(--p),
            0 0 30px var(--ps),
            0 0 50px rgba(29,78,216,0.22);
          animation: acos-core-pulse 2.2s ease-in-out infinite;
        }
        .acos-core-bright {
          position: absolute;
          width: calc(var(--cs) * 0.42);
          height: calc(var(--cs) * 0.42);
          border-radius: 50%;
          background: #fff;
          box-shadow: 0 0 4px rgba(255,255,255,0.9);
        }

        /* ── Traveler (sweeps across the mark) ──────────────────────────── */
        .acos-traveler {
          position: absolute;
          z-index: 3;
          width: var(--ts);
          height: var(--ts);
          border-radius: 50%;
          background: var(--p);
          box-shadow: 0 0 10px var(--p), 0 0 22px var(--a);
          animation: acos-traverse 9s cubic-bezier(0.42,0,0.2,1) infinite;
        }
        .acos-traveler span {
          position: absolute;
          top: 50%;
          right: 70%;
          width: 22px;
          height: 2px;
          transform: translateY(-50%);
          border-radius: 999px;
          background: linear-gradient(90deg, transparent, rgba(96,165,250,0.55), var(--p));
          filter: blur(0.3px);
        }

        /* ── Stacked layout ─────────────────────────────────────────────── */
        .acos-logo--stacked {
          flex-direction: column;
          align-items: center;
          gap: 10px;
        }

        /* ── Subtitle (showLabel) ───────────────────────────────────────── */
        .acos-label {
          display: none;
          flex-direction: column;
          align-items: center;
          gap: 5px;
          min-width: 0;
          white-space: nowrap;
        }
        .acos-label-top {
          font-family: var(--font-logo);
          font-size: 9.5px;
          font-weight: 800;
          letter-spacing: 0.3em;
          text-transform: uppercase;
          color: rgba(241,245,249,0.92);
        }
        .acos-label-bottom {
          display: flex;
          align-items: center;
          gap: 6px;
          font-family: var(--font-logo);
          font-size: 8px;
          font-weight: 700;
          letter-spacing: 0.24em;
          text-transform: uppercase;
          color: var(--p);
        }
        .acos-label-rule {
          flex: 1;
          display: inline-block;
          min-width: 18px;
          height: 1px;
          background: linear-gradient(90deg, transparent, var(--p));
          opacity: 0.65;
        }
        .acos-label-bottom .acos-label-rule:last-child {
          background: linear-gradient(270deg, transparent, var(--p));
        }

        .acos-logo--stacked .acos-label {
          display: flex;
        }

        @media (min-width: 640px) {
          .acos-label {
            display: flex;
          }
        }

        /* ── Classic mode — restores the original simple border rings ──── */
        .acos-logo--classic .acos-ring-outer {
          background: none;
          -webkit-mask: none;
          mask: none;
          border: 1.5px solid transparent;
          border-top-color: var(--p);
          border-right-color: var(--p);
          filter: none;
          animation: acos-spin 3s linear infinite;
        }
        .acos-logo--classic .acos-planet {
          display: none;
        }
        .acos-logo--classic .acos-ring-mid {
          border-top-color: var(--a);
          border-right-color: var(--a);
          border-bottom-color: transparent;
          animation: acos-spin 2.2s linear infinite reverse;
        }
        .acos-logo--classic .acos-ring-inner {
          border-top-color: var(--q);
          border-right-color: transparent;
          border-left-color: transparent;
          animation: acos-spin 1.4s linear infinite;
        }
        .acos-logo--classic .acos-core {
          box-shadow: 0 0 12px var(--p), 0 0 28px var(--ps);
        }

        /* ── Keyframes ──────────────────────────────────────────────────── */
        @keyframes acos-spin {
          to { transform: rotate(360deg); }
        }

        @keyframes acos-planet-orbit {
          from {
            transform: translate(-50%,-50%) rotate(0deg) translateY(calc(var(--or) * -1));
          }
          to {
            transform: translate(-50%,-50%) rotate(360deg) translateY(calc(var(--or) * -1));
          }
        }

        @keyframes acos-core-pulse {
          0%,100% {
            transform: scale(1);
            box-shadow:
              0 0 0 calc(var(--cs)*0.4) rgba(37,99,235,0.12),
              0 0 14px var(--p),
              0 0 30px var(--ps);
          }
          50% {
            transform: scale(1.22);
            box-shadow:
              0 0 0 calc(var(--cs)*0.55) rgba(37,99,235,0.16),
              0 0 20px var(--p),
              0 0 40px rgba(37,99,235,0.4),
              0 0 60px rgba(29,78,216,0.25);
          }
        }

        @keyframes acos-letter-glow {
          0%,100% {
            filter: drop-shadow(0 0 8px rgba(37,99,235,0.35))
                    drop-shadow(0 2px 6px rgba(30,58,138,0.3));
            transform: translateY(0);
          }
          14% {
            filter: drop-shadow(0 0 16px rgba(96,165,250,0.7)) brightness(1.1)
                    drop-shadow(0 2px 8px rgba(30,58,138,0.35));
            transform: translateY(-1.5px);
          }
          28% {
            filter: drop-shadow(0 0 8px rgba(37,99,235,0.35))
                    drop-shadow(0 2px 6px rgba(30,58,138,0.3));
            transform: translateY(0);
          }
        }

        @keyframes acos-traverse {
          0%   { left:7%;  top:72%; transform:rotate(-38deg); opacity:0; }
          8%   { opacity:1; }
          20%  { left:18%; top:20%; transform:rotate(-8deg); }
          36%  { left:43%; top:16%; transform:rotate(10deg); }
          51%  { left:58%; top:50%; transform:rotate(160deg); }
          66%  { left:58%; top:50%; transform:rotate(520deg); }
          82%  { left:82%; top:20%; transform:rotate(24deg); }
          94%  { left:91%; top:68%; transform:rotate(42deg); opacity:1; }
          100% { left:91%; top:68%; transform:rotate(42deg); opacity:0; }
        }

        @media (prefers-reduced-motion: reduce) {
          .acos-ring-outer,
          .acos-ring-mid,
          .acos-ring-inner,
          .acos-planet,
          .acos-core,
          .acos-letter,
          .acos-traveler {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}
