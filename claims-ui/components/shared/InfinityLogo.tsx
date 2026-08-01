/**
 * InfinityLogo — Insurance Engine brand mark
 *
 * Uses the official PNG logo (IPS mark + "Infinie Solution" wordmark).
 * The PNG is black content on a transparent background with subtle 3D shadows.
 *
 * Blend modes ensure the logo looks clean on any background:
 *   colorScheme="light"  → mix-blend-mode: multiply
 *                          Black content stays black; grey shadow halos
 *                          multiply with the background color and vanish.
 *                          Works perfectly on white, cream, yellow, etc.
 *
 *   colorScheme="dark"   → filter: invert(1) + mix-blend-mode: screen
 *                          Inverts to white content; screen blend makes it
 *                          glow naturally against any dark background.
 */

/* eslint-disable @next/next/no-img-element */

interface InfinityLogoProps {
  className?: string;
  colorScheme?: "dark" | "light";
  /**
   * true  → full logo with IPS mark + wordmark (default)
   * false → mark-only (cropped to the top symbol area)
   */
  showWordmark?: boolean;
}

export function InfinityLogo({
  className = "",
  colorScheme = "light",
  showWordmark = true,
}: InfinityLogoProps) {
  const isDark = colorScheme === "dark";

  const imgStyle: React.CSSProperties = {
    display: "block",
    // Light bg: multiply blend removes all grey halos — only pure black remains
    // Dark bg:  invert to white, then screen-blend onto dark background
    filter: isDark ? "invert(1) brightness(10)" : "none",
    mixBlendMode: isDark ? "screen" : "multiply",
  };

  if (showWordmark) {
    return (
      <img
        src="/logo-infinie.png"
        alt="IE - Insurance Engine"
        className={className}
        style={imgStyle}
        draggable={false}
      />
    );
  }

  // Mark-only mode: clip to the IPS symbol (top ~68% of image)
  return (
    <span
      className={className}
      style={{ display: "inline-block", overflow: "hidden", position: "relative" }}
      aria-label="IE - Insurance Engine"
      role="img"
    >
      <img
        src="/logo-infinie.png"
        alt=""
        aria-hidden="true"
        style={{
          ...imgStyle,
          // The IPS mark occupies the top ~68% — scale up so the mark fills the container
          height: "147%",
          width: "auto",
          position: "relative",
          top: 0,
        }}
        draggable={false}
      />
    </span>
  );
}
