"use client";
import { useEffect, type ReactNode } from "react";
import { usePageHeader } from "@/components/layout/PageHeaderContext";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  const { setHeader } = usePageHeader();

  useEffect(() => {
    setHeader({ title, subtitle, actions });
    return () => setHeader(null);
  }, [actions, setHeader, subtitle, title]);

  return null;
}
