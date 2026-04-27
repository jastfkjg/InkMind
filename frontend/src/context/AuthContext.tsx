import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { User } from "@/types";
import { authLogin, authMe, authRegister, clearToken, getToken, patchAuthMe, setAiLanguage, setToken } from "@/api/client";

type AuthState = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName?: string) => Promise<void>;
  logout: () => void;
  updatePreferredLlm: (preferred_llm_provider: string | null) => Promise<void>;
  updateAiSettings: (settings: {
    agent_mode?: string | null;
    max_llm_iterations?: number | null;
    max_tokens_per_task?: number | null;
    enable_auto_audit?: boolean | null;
    preview_before_save?: boolean | null;
    auto_audit_min_score?: number | null;
  }) => Promise<void>;
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = getToken();
    if (!t) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const u = await authMe();
        setUser(u);
        setAiLanguage(u.ai_language || null);
      } catch {
        clearToken();
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const data = await authLogin(email, password);
    setToken(data.access_token);
    setUser(data.user);
    setAiLanguage(data.user.ai_language || null);
  }, []);

  const register = useCallback(async (email: string, password: string, displayName?: string) => {
    const data = await authRegister(email, password, displayName);
    setToken(data.access_token);
    setUser(data.user);
    setAiLanguage(data.user.ai_language || null);
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setUser(null);
    setAiLanguage(null);
  }, []);

  const updatePreferredLlm = useCallback(async (preferred_llm_provider: string | null) => {
    const u = await patchAuthMe({ preferred_llm_provider });
    setUser(u);
  }, []);

  const updateAiSettings = useCallback(
    async (settings: {
      agent_mode?: string | null;
      max_llm_iterations?: number | null;
      max_tokens_per_task?: number | null;
      enable_auto_audit?: boolean | null;
      preview_before_save?: boolean | null;
      auto_audit_min_score?: number | null;
      ai_language?: string | null;
    }) => {
      const u = await patchAuthMe(settings);
      setUser(u);
      if (settings.ai_language !== undefined) {
        setAiLanguage(settings.ai_language);
      }
    },
    []
  );

  const refreshUser = useCallback(async () => {
    const t = getToken();
    if (!t) return;
    try {
      const u = await authMe();
      setUser(u);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, register, logout, updatePreferredLlm, updateAiSettings, refreshUser }),
    [user, loading, login, register, logout, updatePreferredLlm, updateAiSettings, refreshUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside provider");
  return ctx;
}
