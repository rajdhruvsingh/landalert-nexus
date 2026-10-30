/**
 * src/lib/auth-service.ts
 * =======================
 * Pure Native PostgreSQL / Django Authentication Service for LandAlert-Nexus.
 * Eliminates cloud Supabase Auth by interacting directly with:
 * - POST /api/auth/login
 * - POST /api/auth/register
 * - GET  /api/auth/me
 * - POST /api/auth/logout
 *
 * Implements standard Session and onAuthStateChange contracts for seamless
 * UI integration across Dashboard, Alerts, ConsoleShell, and AuthDialog.
 */

export interface AuthUser {
  id: string;
  email: string;
  full_name?: string;
  institution?: string;
  department?: string;
  designation?: string;
  role: string;
  verification_status?: string;
  dispatch_authorized?: boolean;
  user_metadata?: Record<string, any>;
}

export interface AuthSession {
  access_token: string;
  token_type?: string;
  user: AuthUser;
}

export interface AuthResponse<T = any> {
  data: T | null;
  error: { message: string; code?: string } | null;
}

const TOKEN_KEY = "landalert_auth_token";
const USER_KEY = "landalert_user";
const AUTH_EVENT = "landalert-auth-change";

class NativeAuthService {
  private getStorage(): Storage | null {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage;
    }
    return null;
  }

  /**
   * Retrieves the current user session from local storage.
   */
  async getSession(): Promise<{ data: { session: AuthSession | null }; error: null }> {
    const storage = this.getStorage();
    if (!storage) {
      return { data: { session: null }, error: null };
    }

    const token = storage.getItem(TOKEN_KEY);
    const userJson = storage.getItem(USER_KEY);

    if (!token || !userJson) {
      return { data: { session: null }, error: null };
    }

    try {
      const user = JSON.parse(userJson) as AuthUser;
      return {
        data: {
          session: {
            access_token: token,
            user,
          },
        },
        error: null,
      };
    } catch {
      return { data: { session: null }, error: null };
    }
  }

  /**
   * Retrieves the currently logged-in user.
   */
  async getUser(): Promise<{ data: { user: AuthUser | null }; error: null }> {
    const { data } = await this.getSession();
    return { data: { user: data.session?.user ?? null }, error: null };
  }

  /**
   * Native password authentication against Django /api/auth/login (PostgreSQL).
   */
  async signInWithPassword(params: {
    email: string;
    password: string;
  }): Promise<AuthResponse<{ user: AuthUser; session: AuthSession }>> {
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: params.email.trim(),
          password: params.password,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.ok) {
        return {
          data: null,
          error: {
            message: json.error || json.message || "Invalid email or password",
            code: json.code || "AUTH_FAILED",
          },
        };
      }

      const token = json.token || json.access_token;
      const user = json.user as AuthUser;

      const storage = this.getStorage();
      if (storage) {
        storage.setItem(TOKEN_KEY, token);
        storage.setItem(USER_KEY, JSON.stringify(user));
      }

      const session: AuthSession = { access_token: token, user };
      this.notifyAuthChange(session);

      return {
        data: { user, session },
        error: null,
      };
    } catch (err) {
      return {
        data: null,
        error: {
          message: err instanceof Error ? err.message : "Network error during authentication",
        },
      };
    }
  }

  /**
   * Native registration against Django /api/auth/register (PostgreSQL).
   */
  async signUp(params: {
    email: string;
    password: string;
    options?: {
      data?: {
        full_name?: string;
        institution?: string;
        department?: string;
        designation?: string;
      };
    };
  }): Promise<AuthResponse<{ user: AuthUser; session: AuthSession }>> {
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: params.email.trim(),
          password: params.password,
          full_name: params.options?.data?.full_name,
          institution: params.options?.data?.institution,
          department: params.options?.data?.department,
          designation: params.options?.data?.designation,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.ok) {
        return {
          data: null,
          error: {
            message: json.error || json.message || "Registration failed",
            code: json.code || "REGISTRATION_FAILED",
          },
        };
      }

      const token = json.token || json.access_token;
      const user = json.user as AuthUser;

      const storage = this.getStorage();
      if (storage) {
        storage.setItem(TOKEN_KEY, token);
        storage.setItem(USER_KEY, JSON.stringify(user));
      }

      const session: AuthSession = { access_token: token, user };
      this.notifyAuthChange(session);

      return {
        data: { user, session },
        error: null,
      };
    } catch (err) {
      return {
        data: null,
        error: {
          message: err instanceof Error ? err.message : "Network error during registration",
        },
      };
    }
  }

  /**
   * Logs out the user and cleans up local storage.
   */
  async signOut(): Promise<{ error: null }> {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Best-effort server notification
    }

    const storage = this.getStorage();
    if (storage) {
      storage.removeItem(TOKEN_KEY);
      storage.removeItem(USER_KEY);
    }

    this.notifyAuthChange(null);
    return { error: null };
  }

  /**
   * Subscribes to authentication state changes across components.
   */
  onAuthStateChange(
    callback: (event: string, session: AuthSession | null) => void,
  ): { data: { subscription: { unsubscribe: () => void } } } {
    const handler = (e: Event) => {
      const customEvent = e as CustomEvent<AuthSession | null>;
      callback("SIGNED_IN_OR_OUT", customEvent.detail ?? null);
    };

    const storageHandler = (e: StorageEvent) => {
      if (e.key === TOKEN_KEY || e.key === USER_KEY) {
        this.getSession().then(({ data }) => {
          callback("STORAGE_SYNC", data.session);
        });
      }
    };

    if (typeof window !== "undefined") {
      window.addEventListener(AUTH_EVENT, handler);
      window.addEventListener("storage", storageHandler);
    }

    return {
      data: {
        subscription: {
          unsubscribe: () => {
            if (typeof window !== "undefined") {
              window.removeEventListener(AUTH_EVENT, handler);
              window.removeEventListener("storage", storageHandler);
            }
          },
        },
      },
    };
  }

  private notifyAuthChange(session: AuthSession | null) {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: session }));
    }
  }
}

export const authService = new NativeAuthService();

