/**
 * src/integrations/supabase/previewAuthStorage.ts
 * ================================================
 * Auth session storage selector for Supabase.
 *
 * On production (Render / any standard deployment), returns `localStorage`
 * so Supabase Auth sessions persist normally across page refreshes.
 *
 * On Lovable preview surfaces (detected by hostname), brokers the auth
 * session to the parent editor frame over postMessage so multiple
 * preview tabs share one login. This is a progressive enhancement —
 * the application works identically with plain localStorage on all
 * non-preview hosts.
 */

export function brokeredPreviewStorage() {
  if (typeof window === "undefined") return undefined;

  const host = location.hostname;

  // Preview-zone hostnames where session brokering is active.
  const PREVIEW_ZONES = [
    "lovableproject.com",
    "lovableproject-dev.com",
    "lovable.app",
    "gpt-eng.com",
    "gptengineer.run",
  ];
  const onPreviewZone = PREVIEW_ZONES.some((z) => host === z || host.endsWith("." + z));

  // On non-preview hosts (e.g. Render, localhost) use standard localStorage.
  if (!onPreviewZone) return localStorage;

  // Read the project UUID only from non-user-controlled host positions.
  const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
  const projectId =
    host.match(
      new RegExp(
        "^(?:id-preview(?:-[a-z0-9]+)?|project)--("+UUID+")(?:-dev)?(?=\\.|$)",
        "i",
      ),
    )?.[1] ?? host.match(new RegExp("^("+UUID+")(?=[.-])", "i"))?.[1];

  const framed = window.parent && window.parent !== window;
  if (!projectId || !framed) return localStorage;

  // Validate that the parent frame is a trusted editor origin before
  // posting auth tokens — session tokens must never reach untrusted embedders.
  const dev = host.endsWith(".lovableproject-dev.com") || host.endsWith(".gpt-eng.com");
  const EDITOR = dev
    ? /^https:\/\/([a-z0-9-]+\.)*(lovable\.dev|gptengineer\.app)$|^http:\/\/localhost:3000$/
    : /^https:\/\/([a-z0-9-]+\.)*(lovable\.dev|gptengineer\.app)$/;
  const ancestor =
    (location.ancestorOrigins && location.ancestorOrigins[0]) ||
    (document.referrer ? new URL(document.referrer).origin : "");
  const editorOrigins =
    ancestor && EDITOR.test(ancestor)
      ? [ancestor]
      : dev
        ? ["https://lovable.dev", "http://localhost:3000"]
        : ["https://lovable.dev"];

  const RESULT = "preview-auth:result";
  const TIMEOUT = 2000;
  const newId = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

  const request = (
    type: string,
    key: string,
    value?: string,
  ): Promise<{ ok: boolean; value?: string | null } | null> =>
    new Promise((resolve) => {
      const requestId = newId();
      let done = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const finish = (r: { ok: boolean; value?: string | null } | null) => {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        window.removeEventListener("message", onMessage);
        resolve(r);
      };
      const onMessage = (e: MessageEvent) => {
        if (editorOrigins.indexOf(e.origin) < 0) return;
        const d = e.data;
        if (d && d.type === RESULT && d.requestId === requestId) finish(d);
      };
      window.addEventListener("message", onMessage);
      const msg: Record<string, unknown> = { type, requestId, projectId, key };
      if (value !== undefined) msg["value"] = value;
      for (const origin of editorOrigins) window.parent.postMessage(msg, origin);
      timer = setTimeout(() => finish(null), TIMEOUT);
    });

  // Retry once on the first getItem — editor may not be listening yet.
  let firstGet = true;
  const RETRY_DELAY = 250;

  return {
    getItem: async (key: string) => {
      let res = await request("preview-auth:get", key);
      if (!res && firstGet) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY));
        res = await request("preview-auth:get", key);
      }
      firstGet = false;
      // Empty string is the logout tombstone — clear local copy so it can't
      // resurrect if the broker later goes silent.
      if (res && res.ok && typeof res.value === "string") {
        if (res.value === "") {
          localStorage.removeItem(key);
          return null;
        }
        return res.value;
      }
      return localStorage.getItem(key);
    },
    setItem: (key: string, value: string) => {
      localStorage.setItem(key, value);
      return request("preview-auth:set", key, value).then(() => undefined);
    },
    removeItem: (key: string) => {
      localStorage.removeItem(key);
      return request("preview-auth:remove", key).then(() => undefined);
    },
  };
}
