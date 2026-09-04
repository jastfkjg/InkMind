import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";

const MENU_PAGE_PATHS = ["/settings", "/usage", "/tasks", "/admin"];

function isMenuPage(pathname: string): boolean {
  return MENU_PAGE_PATHS.some((path) => pathname.startsWith(path));
}

type NavigationState = {
  lastValidPage: string | null;
  currentPath: string;
  goBackSmart: () => void;
  registerLeaveGuard: (guard: () => Promise<boolean>) => () => void;
  beforeLeave: () => Promise<boolean>;
};

const NavigationContext = createContext<NavigationState | null>(null);

export function NavigationProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const nav = useNavigate();
  const leaveGuard = useRef<(() => Promise<boolean>) | null>(null);
  const registerLeaveGuard = useCallback((guard: () => Promise<boolean>) => {
    leaveGuard.current = guard;
    return () => { if (leaveGuard.current === guard) leaveGuard.current = null; };
  }, []);
  const beforeLeave = useCallback(async () => leaveGuard.current ? leaveGuard.current() : true, []);
  const [lastValidPage, setLastValidPage] = useState<string | null>(null);
  const [currentPath, setCurrentPath] = useState(location.pathname);

  useEffect(() => {
    const pathname = location.pathname;
    setCurrentPath(pathname);

    if (!isMenuPage(pathname)) {
      setLastValidPage(pathname);
    }
  }, [location]);

  const goBackSmart = useCallback(() => {
    if (lastValidPage) {
      nav(lastValidPage);
    } else {
      nav("/");
    }
  }, [lastValidPage, nav]);

  const value = useMemo(
    () => ({
      lastValidPage,
      currentPath,
      goBackSmart,
      registerLeaveGuard,
      beforeLeave,
    }),
    [lastValidPage, currentPath, goBackSmart, registerLeaveGuard, beforeLeave]
  );

  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

export function useNavigation() {
  const ctx = useContext(NavigationContext);
  if (!ctx) {
    throw new Error("useNavigation must be used within a NavigationProvider");
  }
  return ctx;
}
