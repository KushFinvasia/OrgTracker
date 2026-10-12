import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";

import { api, ApiError } from "@/api/client";

/** GET with a cache key equal to the path. */
export function useApiQuery<T>(path: string | null, options?: Partial<UseQueryOptions<T, ApiError>>) {
  return useQuery<T, ApiError>({
    queryKey: [path],
    queryFn: () => api.get<T>(path as string),
    enabled: !!path,
    ...options,
  });
}

/** POST/PATCH/PUT mutation that refreshes all cached queries on success. */
export function useApiMutation<TBody, TResult = unknown>(method: "post" | "patch" | "put", path: string | ((body: TBody) => string)) {
  const qc = useQueryClient();
  return useMutation<TResult, ApiError, TBody>({
    mutationFn: (body: TBody) => {
      const p = typeof path === "function" ? path(body) : path;
      return api[method]<TResult>(p, body);
    },
    onSuccess: () => qc.invalidateQueries(),
  });
}

/** Recoverable draft kept in sessionStorage so a closed drawer or failed save doesn't lose input. */
export function useDraft<T>(key: string, initial: T) {
  const storageKey = `orgtrack.draft.${key}`;
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      return raw ? { ...initial, ...JSON.parse(raw) } : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  }, [storageKey, value]);
  const clear = useCallback(() => {
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
  }, [storageKey]);
  const dirty = JSON.stringify(value) !== JSON.stringify(initial);
  return { value, setValue, clear, dirty } as const;
}

export function useQueryParam(name: string): [string | null, (v: string | null) => void] {
  const read = () => new URLSearchParams(window.location.search).get(name);
  const [value, setValue] = useState<string | null>(read);
  useEffect(() => {
    const onPop = () => setValue(read());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const update = (v: string | null) => {
    const params = new URLSearchParams(window.location.search);
    if (v === null) params.delete(name);
    else params.set(name, v);
    const qs = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
    setValue(v);
  };
  return [value, update];
}
