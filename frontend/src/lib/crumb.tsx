import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

/** Lets a detail page name the last breadcrumb (e.g. the person's name) without the shell knowing every page. */
const CrumbContext = createContext<{ label: string | null; setLabel: (l: string | null) => void }>({ label: null, setLabel: () => {} });

export function CrumbProvider({ children }: { children: ReactNode }) {
  const [label, setLabel] = useState<string | null>(null);
  return <CrumbContext.Provider value={{ label, setLabel }}>{children}</CrumbContext.Provider>;
}

export function useCrumb() {
  return useContext(CrumbContext).label;
}

/** Call from a detail page: useCrumbLabel(person?.name). Cleared when the page unmounts. */
export function useCrumbLabel(label: string | null | undefined) {
  const { setLabel } = useContext(CrumbContext);
  useEffect(() => {
    setLabel(label ?? null);
    return () => setLabel(null);
  }, [label, setLabel]);
}
