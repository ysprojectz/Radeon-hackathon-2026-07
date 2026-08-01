"use client";

import { Toaster, toast } from "sonner";
import type { ReactNode } from "react";

export { toast };

export default function ToastProvider({ children }: { children?: ReactNode }) {
  return (
    <>
      {children}
      <Toaster
        position="top-right"
        richColors
        closeButton
        duration={4000}
        theme="dark"
      />
    </>
  );
}
