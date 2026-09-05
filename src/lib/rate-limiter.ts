/**
 * src/lib/rate-limiter.ts
 * =======================
 * Abstracted API Rate Limiting for LandAlert-Nexus.
 *
 * Protects high-impact / cost-sensitive endpoints from abuse:
 * - POST /api/alerts/dispatch (SMS spend & gateway quota)
 * - POST /api/field-observations/upload (Storage bucket quota & bandwidth)
 * - POST /api/sync/observations (Database write volume & concurrency)
 *
 * Structured behind an interface (RateLimiter) so this in-memory implementation
 * can be seamlessly swapped for a distributed Redis-backed limiter (e.g. Upstash)
 * when scaled horizontally.
 */

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number;
}

export interface RateLimitOptions {
  windowSeconds: number;
  maxRequests: number;
}

export interface RateLimiter {
  checkLimit(key: string, options: RateLimitOptions): Promise<RateLimitResult> | RateLimitResult;
  reset?(key: string): void;
  clear?(): void;
}

interface WindowEntry {
  count: number;
  resetAt: number; // Epoch ms
}

export class InMemoryRateLimiter implements RateLimiter {
  private buckets = new Map<string, WindowEntry>();

  checkLimit(key: string, options: RateLimitOptions): RateLimitResult {
    const now = Date.now();
    const entry = this.buckets.get(key);

    if (!entry || now >= entry.resetAt) {
      const resetAt = now + options.windowSeconds * 1000;
      this.buckets.set(key, { count: 1, resetAt });
      return {
        allowed: true,
        limit: options.maxRequests,
        remaining: options.maxRequests - 1,
        resetSeconds: options.windowSeconds,
      };
    }

    if (entry.count < options.maxRequests) {
      entry.count++;
      const resetSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      return {
        allowed: true,
        limit: options.maxRequests,
        remaining: options.maxRequests - entry.count,
        resetSeconds,
      };
    }

    const resetSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    return {
      allowed: false,
      limit: options.maxRequests,
      remaining: 0,
      resetSeconds,
    };
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }

  clear(): void {
    this.buckets.clear();
  }
}

// Global default singleton instance
export const defaultRateLimiter = new InMemoryRateLimiter();

// Standard rate limit policies per endpoint
export const RATE_LIMIT_POLICIES = {
  // Alert dispatch: 5 per minute per client (SMS cost & critical signaling protection)
  ALERT_DISPATCH: { windowSeconds: 60, maxRequests: 5 },
  // File upload: 20 per minute per client (Supabase storage quota)
  MEDIA_UPLOAD: { windowSeconds: 60, maxRequests: 20 },
  // Field observation sync: 30 per minute per client (Write volume)
  OBSERVATION_SYNC: { windowSeconds: 60, maxRequests: 30 },
} as const;

/**
 * Extracts a stable client identifier from incoming HTTP headers.
 * Uses bearer token prefix or client IP.
 */
export function getClientIdentifier(request: Request): string {
  const authHeader = request.headers.get("Authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return `auth_${authHeader.slice(7, 24)}`;
  }
  const cfIp = request.headers.get("cf-connecting-ip");
  if (cfIp) return cfIp.trim();
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "anonymous_client";
}
