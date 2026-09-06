import { useState, useEffect } from "react";
import { Link, useRouter, useNavigate, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { IndiaEmblem } from "./IndiaEmblem";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { ThemeSwitcher } from "./ThemeSwitcher";
import { AccessibilityDialog } from "./AccessibilityDialog";
import { AboutDialog } from "./AboutDialog";
import { ReportsDialog } from "./ReportsDialog";
import { EmergencyHelpDialog } from "./EmergencyHelpDialog";
import { FieldObservationDialog } from "./FieldObservationDialog";
import { AuthDialog } from "./AuthDialog";
import { OfflineBanner } from "./OfflineBanner";
import { Search, ChevronDown, UserCheck, Shield } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getUserAuthorizationState } from "@/lib/auth-domains";
import { searchGeography, type SearchResultItem } from "@/lib/geography";
import type { User } from "@supabase/supabase-js";
import "@/lib/i18n";

export function ConsoleNav() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const routerState = useRouterState();
  const currentPath = routerState.location.pathname;
  const [user, setUser] = useState<User | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const authState = getUserAuthorizationState(user);

  const [searchResults, setSearchResults] = useState<SearchResultItem[]>([]);
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);

  const handleSearchChange = (val: string) => {
    setSearchQuery(val);
    if (val.trim().length >= 2) {
      const res = searchGeography(val).slice(0, 8);
      setSearchResults(res);
      setShowSearchDropdown(res.length > 0);
    } else {
      setSearchResults([]);
      setShowSearchDropdown(false);
    }
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("landalert-filter", { detail: { query: val.trim().toLowerCase() } }));
    }
  };

  const handleSelectSearchResult = (item: SearchResultItem) => {
    setSearchQuery(item.name);
    setShowSearchDropdown(false);
    if (typeof window !== "undefined") {
      if (currentPath === "/") {
        window.dispatchEvent(
          new CustomEvent("landalert-filter", {
            detail: {
              query: item.name.toLowerCase(),
              item,
            },
          }),
        );
        const mapEl = document.getElementById("risk-map");
        if (mapEl) {
          mapEl.scrollIntoView({ behavior: "smooth" });
        }
      } else {
        sessionStorage.setItem("landalert_pending_search", item.name.toLowerCase());
        sessionStorage.setItem("landalert_pending_search_item", JSON.stringify(item));
        navigate({ to: "/", hash: "risk-map" });
      }
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setShowSearchDropdown(false);
    const q = searchQuery.trim().toLowerCase();
    if (!q) return;

    const matched = searchGeography(q);
    const topItem = matched.length > 0 ? matched[0] : undefined;

    if (typeof window !== "undefined") {
      if (currentPath === "/") {
        window.dispatchEvent(new CustomEvent("landalert-filter", { detail: { query: q, item: topItem } }));
        const mapEl = document.getElementById("risk-map");
        if (mapEl) {
          mapEl.scrollIntoView({ behavior: "smooth" });
        }
      } else {
        sessionStorage.setItem("landalert_pending_search", q);
        if (topItem) {
          sessionStorage.setItem("landalert_pending_search_item", JSON.stringify(topItem));
        }
        navigate({ to: "/", hash: "risk-map" });
      }
    }
  };

  const handleNavToSection = (
    e: React.MouseEvent,
    hash: string,
    eventName?: string
  ) => {
    e.preventDefault();
    if (typeof window === "undefined") return;

    if (currentPath === "/") {
      const targetId =
        hash === "observations" || hash === "recent-observations"
          ? "recent-observations"
          : hash === "road-network" || hash === "roads" || hash === "road-connectivity"
          ? "road-connectivity"
          : hash;
      const el = document.getElementById(targetId);
      if (el) {
        el.scrollIntoView({ behavior: "smooth" });
      }
      window.history.pushState(null, "", `/#${hash}`);
      if (eventName) {
        window.dispatchEvent(new CustomEvent(eventName));
      }
    } else {
      if (eventName) {
        sessionStorage.setItem("landalert_pending_event", eventName);
      }
      navigate({
        to: "/",
        hash,
      });
    }
  };

  const handleHomeClick = (e: React.MouseEvent) => {
    if (currentPath === "/") {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: "smooth" });
      if (window.location.hash) {
        window.history.pushState(null, "", "/");
      }
    }
  };

  return (
    <header className="sticky top-0 z-40 w-full bg-surface shadow-xs">
      {/* Upper Government Branding & Utility Bar */}
      <div className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3 px-4 py-2 sm:py-2.5 lg:px-8">
          {/* Government Identity Area */}
          <div className="flex items-center gap-3">
            <Link to="/" className="flex items-center gap-2.5 group">
              <IndiaEmblem className="h-9 w-9 text-foreground shrink-0" />
              <div className="flex flex-col text-left leading-tight font-sans">
                <span className="text-[0.62rem] sm:text-[0.68rem] font-bold text-foreground uppercase tracking-wider">
                  {t("header.gov_india", "Government of India")}
                </span>
                <span className="text-[0.60rem] sm:text-[0.65rem] text-muted-foreground">
                  {t("header.ministry", "Ministry of Earth Sciences")}
                </span>
                <span className="text-[0.60rem] sm:text-[0.65rem] text-muted-foreground">
                  {t("header.gsi", "Geological Survey of India")}
                </span>
              </div>
            </Link>

            <div className="hidden sm:block h-8 w-px bg-border mx-1" aria-hidden="true" />

            <Link to="/" className="hidden sm:flex flex-col text-left leading-tight">
              <span className="font-display text-lg sm:text-xl font-bold tracking-tight text-foreground">
                {t("header.app_title", "LandAlert-Nexus")}
              </span>
              <span className="text-[0.65rem] sm:text-[0.7rem] text-muted-foreground font-sans">
                {t("header.app_subtitle", "Landslide Early Warning System for North Eastern Region")}
              </span>
            </Link>
          </div>

          {/* Right Utility Navigation */}
          <div className="flex items-center gap-2 sm:gap-3 text-xs">
            {/* Emergency Help Interface */}
            <EmergencyHelpDialog
              trigger={
                <button
                  type="button"
                  className="px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/60 rounded transition-colors"
                >
                  {t("header.help", "Help")}
                </button>
              }
            />

            {/* Accessibility Dialog */}
            <AccessibilityDialog
              trigger={
                <button
                  type="button"
                  className="hidden md:inline-block px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/60 rounded transition-colors"
                >
                  {t("header.accessibility", "Accessibility")}
                </button>
              }
            />

            {/* Language Switcher */}
            <div className="border-l border-border pl-2 sm:pl-3">
              <LanguageSwitcher />
            </div>

            {/* Theme Switcher */}
            <div className="border-l border-border pl-2 sm:pl-3">
              <ThemeSwitcher />
            </div>

            {/* Operator / User Profile Badge */}
            <div className="border-l border-border pl-2 sm:pl-3">
              {user ? (
                <AuthDialog
                  trigger={
                    <button
                      type="button"
                      aria-label={t("header.profile", "Operator Profile")}
                      className="flex items-center gap-2 py-0.5 px-1.5 rounded hover:bg-secondary/60 transition-colors text-left"
                    >
                      <div className="h-7 w-7 rounded-full bg-slate-700 text-white dark:bg-slate-300 dark:text-slate-900 flex items-center justify-center font-display text-xs font-bold shrink-0">
                        {user.email?.slice(0, 2).toUpperCase() || "OP"}
                      </div>
                      <div className="hidden lg:flex flex-col leading-tight">
                        <span className="font-display text-xs font-semibold text-foreground">
                          {user.email?.split("@")[0] || t("header.operator", "Operator")}
                        </span>
                        <span className="text-[0.62rem] text-muted-foreground flex items-center gap-0.5">
                          <span>{authState.badge}</span>
                          <ChevronDown className="h-2.5 w-2.5" />
                        </span>
                      </div>
                    </button>
                  }
                />
              ) : (
                <AuthDialog
                  trigger={
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 rounded border border-border bg-secondary/40 px-2.5 py-1 text-xs font-medium text-foreground hover:bg-secondary transition-colors"
                    >
                      <Shield className="h-3.5 w-3.5 text-primary" />
                      <span>{t("header.sign_in", "Sign In")}</span>
                    </button>
                  }
                />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Primary Horizontal Navigation Bar */}
      <nav aria-label="Main Navigation" className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4 px-4 lg:px-8">
          {/* Horizontal Links */}
          <div className="flex items-center overflow-x-auto scrollbar-none gap-1 sm:gap-2 py-0 font-sans text-xs">
            <Link
              to="/"
              activeOptions={{ exact: true }}
              onClick={handleHomeClick}
              className="whitespace-nowrap relative px-3 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground [&.active]:text-primary [&.active]:font-semibold [&.active]:after:content-[''] [&.active]:after:absolute [&.active]:after:bottom-0 [&.active]:after:left-0 [&.active]:after:right-0 [&.active]:after:h-[2.5px] [&.active]:after:bg-primary"
            >
              {t("nav.home", "Home")}
            </Link>
            <a
              href="/#risk-map"
              onClick={(e) => handleNavToSection(e, "risk-map")}
              className={`whitespace-nowrap px-3 py-2.5 text-xs font-medium transition-colors cursor-pointer ${
                currentPath === "/" && routerState.location.hash === "risk-map"
                  ? "text-primary font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t("nav.risk_map", "Risk Map")}
            </a>
            <a
              href="/#recent-observations"
              onClick={(e) => handleNavToSection(e, "recent-observations", "landalert-open-observations")}
              className={`whitespace-nowrap px-3 py-2.5 text-xs font-medium transition-colors cursor-pointer ${
                currentPath === "/" &&
                (routerState.location.hash === "recent-observations" || routerState.location.hash === "observations")
                  ? "text-primary font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t("nav.observations", "Observations")}
            </a>
            <NavLink to="/alerts" label={t("nav.alerts", "Alerts")} />
            <a
              href="/#road-connectivity"
              onClick={(e) => handleNavToSection(e, "road-connectivity", "landalert-open-roads")}
              className={`whitespace-nowrap px-3 py-2.5 text-xs font-medium transition-colors cursor-pointer ${
                currentPath === "/" &&
                (routerState.location.hash === "road-connectivity" || routerState.location.hash === "road-network")
                  ? "text-primary font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t("nav.road_network", "Road Network")}
            </a>
            <ReportsDialog />
            <AboutDialog />
          </div>

          {/* Search Box on Right */}
          <form onSubmit={handleSearchSubmit} className="hidden md:flex items-center relative py-1.5">
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder={t("nav.search_placeholder", "Search location, district or keyword...")}
              aria-label={t("nav.search_placeholder", "Search location, district or keyword...")}
              className="h-8 w-56 lg:w-72 rounded border border-border bg-background px-3 pr-8 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
            />
            <button
              type="submit"
              aria-label="Search"
              className="absolute right-2.5 text-muted-foreground hover:text-foreground"
            >
              <Search className="h-3.5 w-3.5" />
            </button>
            {showSearchDropdown && searchResults.length > 0 && (
              <div className="absolute top-full right-0 mt-1 w-72 sm:w-80 rounded border border-border bg-surface shadow-xl z-[300] overflow-hidden text-left">
                <div className="px-2.5 py-1.5 border-b border-border/60 bg-secondary/30 text-[0.65rem] font-mono uppercase text-muted-foreground flex justify-between items-center">
                  <span>{t("search.header_matches", "Geographic Matches")}</span>
                  <span>({searchResults.length})</span>
                </div>
                <div className="max-h-60 overflow-y-auto divide-y divide-border/40">
                  {searchResults.map((item) => (
                    <button
                      key={`${item.type}-${item.id}`}
                      type="button"
                      onClick={() => handleSelectSearchResult(item)}
                      className="w-full text-left px-3 py-2 hover:bg-secondary/60 flex items-center justify-between gap-2 text-xs transition-colors cursor-pointer"
                    >
                      <div className="truncate">
                        <div className="font-semibold text-foreground truncate">{item.name}</div>
                        <div className="text-[0.68rem] text-muted-foreground truncate">{item.description}</div>
                      </div>
                      <span className="shrink-0 font-mono text-[0.62rem] uppercase px-1.5 py-0.5 rounded bg-secondary border border-border text-primary font-bold">
                        {item.type === "city" || item.type === "town"
                          ? t("search.city_town", "City/Town")
                          : item.type === "district"
                          ? t("search.district", "District")
                          : item.type === "state"
                          ? t("search.state", "State")
                          : item.type === "zone"
                          ? t("search.monitored_station", "Station")
                          : item.type}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </form>
        </div>

        {/* Mobile Search Input */}
        <div className="md:hidden border-t border-border px-4 py-2 bg-surface">
          <form onSubmit={handleSearchSubmit} className="flex items-center relative w-full">
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder={t("nav.search_placeholder", "Search location, district or keyword...")}
              aria-label={t("nav.search_placeholder", "Search location, district or keyword...")}
              className="h-8 w-full rounded border border-border bg-background px-3 pr-8 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
            />
            <button
              type="submit"
              aria-label="Search"
              className="absolute right-2.5 text-muted-foreground hover:text-foreground"
            >
              <Search className="h-3.5 w-3.5" />
            </button>
          </form>
        </div>
      </nav>

      <OfflineBanner />
    </header>
  );
}

function NavLink({ to, label, exact = false }: { to: "/" | "/alerts"; label: string; exact?: boolean }) {
  return (
    <Link
      to={to}
      activeOptions={{ exact }}
      className="whitespace-nowrap relative px-3 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground [&.active]:text-primary [&.active]:font-semibold [&.active]:after:content-[''] [&.active]:after:absolute [&.active]:after:bottom-0 [&.active]:after:left-0 [&.active]:after:right-0 [&.active]:after:h-[2.5px] [&.active]:after:bg-primary"
    >
      {label}
    </Link>
  );
}

export function PanelSkeleton({ label = "Loading zone data…" }: { label?: string }) {
  return (
    <div className="mx-auto max-w-[1600px] px-4 py-10 lg:px-8">
      <div className="label-caps animate-pulse">{label}</div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded border border-border bg-secondary/40"
          />
        ))}
      </div>
      <div className="mt-4 h-[420px] animate-pulse rounded border border-border bg-secondary/30" />
    </div>
  );
}

export function RouteError({ error, reset }: { error: Error; reset?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-xl px-4 py-20 text-center lg:px-8">
      <div className="label-caps text-risk-severe">{t("console.feed_error", "Data feed error")}</div>
      <h1 className="mt-2 font-display text-2xl font-bold text-foreground">
        {t("console.monitoring_unavailable", "Monitoring data could not be loaded")}
      </h1>
      <p className="mt-2 text-xs text-muted-foreground">{error.message}</p>
      <div className="mt-6 flex justify-center gap-2">
        {reset && (
          <button
            onClick={reset}
            className="rounded border border-primary/50 bg-primary/10 px-4 py-2 text-xs font-medium text-primary hover:bg-primary/20 transition-colors"
          >
            {t("console.retry", "Retry")}
          </button>
        )}
        <Link
          to="/"
          className="rounded border border-border px-4 py-2 text-xs font-medium text-muted-foreground hover:bg-secondary transition-colors"
        >
          {t("console.back_to_console", "Back to console")}
        </Link>
      </div>
    </div>
  );
}
