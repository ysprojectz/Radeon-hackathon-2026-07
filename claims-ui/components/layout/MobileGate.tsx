"use client";

import type { ReactNode } from "react";

export function MobileGate({ children }: { children: ReactNode }) {
  // Mobile access is now enabled.
  return <>{children}</>;
}
