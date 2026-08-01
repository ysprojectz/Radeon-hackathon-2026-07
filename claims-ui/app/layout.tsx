import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Plus_Jakarta_Sans, Sora } from "next/font/google";
import "./globals.css";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { Providers } from "@/components/layout/Providers";
import { PRODUCT_DISPLAY_NAME, PRODUCT_MARKETING_TAGLINE } from "@/lib/constants";

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-plus-jakarta-sans",
  display: "swap",
});

const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

const sora = Sora({
  subsets: ["latin"],
  variable: "--font-sora",
  display: "swap",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: PRODUCT_DISPLAY_NAME,
  description: PRODUCT_MARKETING_TAGLINE,
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
      "max-image-preview": "none",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const fontVariables = [
    plusJakartaSans.variable,
    jetBrainsMono.variable,
    sora.variable,
  ].join(" ");

  return (
    <html lang="en" className={fontVariables} suppressHydrationWarning>
      <body
        className="font-sans antialiased"
      >
        <Providers>
          <AuthLayout>{children}</AuthLayout>
        </Providers>
      </body>
    </html>
  );
}
