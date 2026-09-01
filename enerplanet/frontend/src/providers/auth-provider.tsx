import * as React from "react";
import { useAuthStore } from "@/store/auth-store";
import {
  createContext,
  useContext,
  ReactNode,
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from "react";
import { useLocation } from "react-router-dom";
import { useAppStore } from "@/store/app-store";
import { useMapLocationStore } from "@/features/interactive-map/store/map-location";
import { updateMapToSavedLocation } from "@/features/interactive-map/store/map-store";
import { useWorkspaceStore } from "@/components/workspace/store/workspace-store";
import axios from "@/lib/axios";
import { User } from "@/types/user";

interface AuthContext {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContext | undefined>({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  refreshUser: async () => {},
});

interface AuthProviderProps {
  children: ReactNode;
}

// Fetches the current user via the session_id cookie. Returns null if the
// cookie is missing/invalid (i.e. not authenticated).
async function fetchProfile(): Promise<User | null> {
  try {
    const { data } = await axios.get("/users/profile");
    return (data?.data as User) ?? null;
  } catch {
    return null;
  }
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const { user: storeUser, init, reset } = useAuthStore();
  const location = useLocation();
  const app = useAppStore();
  const { syncFromBackend: syncMapFromBackend } = useMapLocationStore();
  const isProtectedRoute = location.pathname.startsWith("/app/");

  const [user, setUser] = useState<User | null>(storeUser);
  const [isAuthenticated, setIsAuthenticated] = useState(!!storeUser);
  const [isLoading, setIsLoading] = useState(isProtectedRoute && !storeUser);
  const previousUserIDRef = useRef(storeUser?.id == null ? null : String(storeUser.id));

  const applyUser = useCallback((next: User | null) => {
    setUser(next);
    setIsAuthenticated(!!next);
  }, []);

  const refreshUser = useCallback(async () => {
    const profile = await fetchProfile();
    if (profile) {
      await init({ user: profile });
      applyUser(profile);
    } else {
      reset();
      applyUser(null);
    }
  }, [init, reset, applyUser]);

  // Bootstrap the session from the cookie when we land on a protected route
  // without a cached user — e.g. after the SSO callback redirects to /app/map.
  useEffect(() => {
    if (!isProtectedRoute || storeUser) {
      setIsLoading(false);
      return;
    }

    let active = true;
    setIsLoading(true);

    void fetchProfile()
      .then((profile) => {
        if (!active) return;
        if (profile) {
          void init({ user: profile });
          applyUser(profile);
        } else {
          applyUser(null);
        }
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [isProtectedRoute, storeUser, init, applyUser]);

  // Mirror the persisted store user (password login sets it directly) and
  // sync per-user backend state once authenticated.
  useEffect(() => {
    const nextUserID = storeUser?.id == null ? null : String(storeUser.id);
    if (previousUserIDRef.current !== nextUserID) {
      useWorkspaceStore.getState().resetWorkspace();
      previousUserIDRef.current = nextUserID;
    }

    if (storeUser) {
      applyUser(storeUser);
      syncMapFromBackend().then(() => {
        updateMapToSavedLocation();
      });
    }
  }, [storeUser, applyUser, syncMapFromBackend]);

  // Sync logout across tabs.
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === "auth-storage") {
        if (e.newValue === null) {
          reset();
          applyUser(null);
        } else {
          useAuthStore.persist.rehydrate();
        }
      }
    };
    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, [reset, applyUser]);

  useEffect(() => {
    const initApp = async () => {
      await app.init({
        user: null,
        usersCount: 0,
      });
    };
    initApp();
  }, [app]);

  const authValue = useMemo(
    () => ({
      user,
      isAuthenticated,
      isLoading,
      refreshUser,
    }),
    [user, isAuthenticated, isLoading, refreshUser]
  );

  return <AuthContext.Provider value={authValue}>{children}</AuthContext.Provider>;
};

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
