"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export interface PageHeaderConfig {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

interface PageHeaderContextValue {
  header: PageHeaderConfig | null;
  setHeader: (header: PageHeaderConfig | null) => void;
}

const PageHeaderContext = createContext<PageHeaderContextValue | null>(null);

export function PageHeaderProvider({ children }: { children: ReactNode }) {
  const [header, setHeaderState] = useState<PageHeaderConfig | null>(null);

  const setHeader = useCallback((nextHeader: PageHeaderConfig | null) => {
    setHeaderState(nextHeader);
  }, []);

  const value = useMemo(() => ({ header, setHeader }), [header, setHeader]);

  return (
    <PageHeaderContext.Provider value={value}>
      {children}
    </PageHeaderContext.Provider>
  );
}

export function usePageHeader() {
  const context = useContext(PageHeaderContext);
  if (!context) {
    throw new Error("usePageHeader must be used within PageHeaderProvider");
  }
  return context;
}
