"use client";

import { useEffect, useRef, useState } from "react";
import NextImage from "next/image";
import { Bot } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChatBotIconProps {
  /** Icon size in pixels (width and height) */
  size?: number;
  /** Additional CSS classes */
  className?: string;
  /** Whether the icon should animate (default: true) */
  animated?: boolean;
  /** Alt text for accessibility */
  alt?: string;
  /** Show a subtle pulse glow around the icon */
  glow?: boolean;
}

/**
 * ChatBotIcon - Enhanced animated chatbot avatar
 *
 * Uses the custom animated GIF chatbot icon with optional
 * performance optimizations and visual enhancements.
 *
 * Features:
 * - Animated GIF playback
 * - Optional glow effect around the icon
 * - Accessible with proper ARIA labels
 * - Supports multiple sizes via pixel prop
 * - Lazy loading for performance
 * - Falls back to Lucide Bot icon on error
 */
export function ChatBotIcon({
  size = 80,
  className,
  alt = "AI Assistant - animated chatbot",
  glow = true,
}: ChatBotIconProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState(false);

  // Preload the GIF for smoother first render
  useEffect(() => {
    const img = new Image();
    img.src = "/chatbot-assets/original-264e9058a6750494b88514c0a4a72919.gif";
  }, []);

  return (
    <div
      className={cn(
        "relative inline-flex items-center justify-center",
        glow && "after:absolute after:inset-[-15%] after:rounded-full",
        glow && "after:bg-gradient-to-br after:from-cyan-400/25 after:to-blue-500/15 after:blur-2xl after:animate-pulse",
        className
      )}
      style={{
        width: size,
        height: size,
      }}
      aria-label={alt}
      role="img"
    >
      {error ? (
        /* Fallback to simple bot icon */
        <Bot
          size={size * 0.75}
          className="text-cyan-400 drop-shadow-[0_0_12px_rgba(6,182,212,0.5)]"
          strokeWidth={1.8}
        />
      ) : (
        <>
          {/* Main animated GIF icon */}
          <NextImage
            ref={imgRef}
            src="/chatbot-assets/original-264e9058a6750494b88514c0a4a72919.gif"
            alt={alt}
            className={cn(
              "h-full w-full object-contain transition-opacity duration-300",
              !isLoaded && "opacity-0 scale-95 blur-[2px]"
            )}
            unoptimized
            loading="lazy"
            onLoad={() => setIsLoaded(true)}
            onError={() => setError(true)}
            width={size}
            height={size}
            sizes={`${size}px`}
          />

          {/* Loading placeholder shown while GIF loads */}
          {!isLoaded && (
            <div
              className="absolute inset-0 flex items-center justify-center bg-black/20 rounded-full"
              aria-hidden="true"
            >
              <Bot size={size * 0.4} className="text-white/30" strokeWidth={1.5} />
            </div>
          )}
        </>
      )}

      {/* Reflection/shine overlay for depth */}
      <div
        className="pointer-events-none absolute inset-0 rounded-full"
        style={{
          background: "linear-gradient(135deg, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0) 45%)",
          mixBlendMode: "overlay",
        }}
      />
    </div>
  );
}

/**
 * ChatBotIconSmall - Compact version for inline/compact display (32px)
 */
export function ChatBotIconSmall({ className }: { className?: string }) {
  return <ChatBotIcon size={32} className={className} glow={false} animated={true} />;
}

/**
 * ChatBotIconLarge - Prominent version for hero/header areas (120px)
 */
export function ChatBotIconLarge({ className }: { className?: string }) {
  return (
    <ChatBotIcon
      size={120}
      className={className}
      glow={true}
      animated={true}
    />
  );
}

/**
 * ChatBotIconMedium - Standard size for chat widget (56px)
 */
export function ChatBotIconMedium({ className }: { className?: string }) {
  return <ChatBotIcon size={56} className={className} glow={true} animated={true} />;
}
