"use client";

// Font families loaded via CSS @import in globals.css
const oswald    = { className: "[font-family:'Oswald',sans-serif]" };
const spaceGrotesk = { className: "[font-family:'Space_Grotesk',sans-serif]" };
const ibmPlexMono = { className: "[font-family:'IBM_Plex_Mono',monospace]" };
const bebasNeue = { className: "[font-family:'Bebas_Neue',sans-serif]" };
const manrope   = { className: "[font-family:'Manrope',sans-serif]" };
const spaceMono = { className: "[font-family:'Space_Mono',monospace]" };

const previews = [
  {
    name: "Condensed Editorial",
    family: oswald.className,
    titleClass:
      "text-[1.45rem] sm:text-[1.8rem] uppercase tracking-[0.08em] leading-none",
    caption: "Tall, compressed, and high-impact.",
  },
  {
    name: "Modern Premium",
    family: spaceGrotesk.className,
    titleClass:
      "text-[1.2rem] sm:text-[1.55rem] font-bold tracking-[0.12em] leading-tight",
    caption: "Sharper product feel with cleaner geometry.",
  },
  {
    name: "Technical Operations",
    family: ibmPlexMono.className,
    titleClass:
      "text-[1rem] sm:text-[1.2rem] font-semibold uppercase tracking-[0.18em] leading-tight",
    caption: "System-like and operational.",
  },
  {
    name: "Poster Condensed",
    family: bebasNeue.className,
    titleClass:
      "text-[1.65rem] sm:text-[2rem] uppercase tracking-[0.12em] leading-none",
    caption: "Louder, cleaner, and more poster-like.",
  },
  {
    name: "Executive Sans",
    family: manrope.className,
    titleClass:
      "text-[1.18rem] sm:text-[1.48rem] font-extrabold tracking-[0.08em] leading-tight",
    caption: "Corporate, premium, and easier to scale across pages.",
  },
  {
    name: "Terminal Grid",
    family: spaceMono.className,
    titleClass:
      "text-[0.98rem] sm:text-[1.15rem] font-bold uppercase tracking-[0.14em] leading-tight",
    caption: "Sharper mono look with a retro control-room feel.",
  },
] as const;

const samples = [
  "Claims  Status  Overview",
  "Historical  Claim  Reports",
  "Claims  Submission",
] as const;

export default function TitlePreviewPage() {
  return (
    <div className="min-h-screen bg-dashboard-bg py-8 text-white">
      <div className="px-4 sm:px-6 lg:px-8">
        <div className="mx-auto mb-8 max-w-5xl rounded-[1.75rem] border border-white/[0.08] bg-white/[0.03] px-6 py-6 backdrop-blur-xl">
          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[var(--status-info)]/55">
            Title Preview
          </p>
          <h1 className="mt-3 text-2xl font-black tracking-[0.08em] text-white sm:text-3xl">
            Title  Style  Preview
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-white/50">
            Compare six different font directions for the page headers and pick one to apply.
          </p>
        </div>
      </div>

      <div className="grid gap-5 px-4 sm:px-6 lg:px-8 xl:grid-cols-3 2xl:grid-cols-3">
        {previews.map((preview, index) => (
          <section
            key={preview.name}
            className="glass-card overflow-hidden rounded-[1.75rem] border border-white/[0.08]"
          >
            <div className="border-b border-white/[0.06] bg-white/[0.03] px-5 py-4">
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-white/35">
                Option {index + 1}
              </p>
              <h2 className="mt-2 text-lg font-bold text-white">{preview.name}</h2>
              <p className="mt-1 text-sm text-white/45">{preview.caption}</p>
            </div>

            <div className="space-y-4 px-5 py-5">
              {samples.map((sample) => (
                <div
                  key={sample}
                  className="rounded-2xl border border-white/[0.06] bg-[#0d131b] px-4 py-4"
                >
                  <p className="mb-3 text-[10px] font-black uppercase tracking-[0.2em] text-cyan-200/55">
                    Preview
                  </p>
                  <div className={`${preview.family} ${preview.titleClass} text-white`}>
                    {sample}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
