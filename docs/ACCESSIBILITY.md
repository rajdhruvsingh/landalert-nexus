# LandAlert-Nexus Accessibility & Assistive Technology Audit

This document outlines the current keyboard navigation support, screen-reader announcements, ARIA patterns, and remaining accessibility gaps for the LandAlert-Nexus early warning console.

---

## 1. Core Operability Under Emergency Pressure

In disaster response, district emergency operations officers and field dispatchers frequently operate in high-glare field conditions or using keyboard-only input. We prioritized high-stress operational workflows:

1. **Connectivity & Stale Data Awareness**: `OfflineBanner` implements `role="status"` and `aria-live="polite"` so screen readers proactively announce offline transitions, queue synchronization counts, and data staleness without interrupting active tasks.
2. **Emergency Risk Level Badges**: `RiskBadge` and `ForecastRiskBadge` carry `role="status"` and `aria-live="polite"` to announce automated risk state changes.
3. **Emergency Alert Dispatch Modal**:
   - Explicit `DialogHeader`, `DialogTitle`, and `DialogDescription`.
   - Every `<select>` trigger has an explicit `aria-label` and `id` linking to its `<label>`.
   - Action result notifications use `role="status"` and `aria-live="polite"`.
4. **Field Ground Observation Dialog**:
   - Keyboard accessible file inputs and camera triggers (`Tab`/`Enter`).
   - Remove buttons for uploaded media are labeled with `aria-label="Remove media <filename>"`.
   - Geolocation capture button announces state with dynamic `aria-label`.
5. **Language Switcher**:
   - Accessible via keyboard `Tab` with `aria-label="Select interface language"`. Select items announce native script and code.

---

## 2. Keyboard Operability Verification (Tab / Enter / Space)

| Component / Interactive Element | Keyboard Accessible | Keys Tested | Notes / Behavior |
| :--- | :--- | :--- | :--- |
| **Language Switcher** | YES | `Tab`, `Enter`, `Arrow keys`, `Space` | Selects language and immediately swaps all bundles. |
| **State Filter Buttons** | YES | `Tab`, `Enter`, `Space` | Uses `aria-pressed` to indicate active filter state. |
| **Response Prioritisation List** | YES | `Tab`, `Enter`, `Space` | Buttons focusable with visible focus rings (`focus-visible:ring-1`). |
| **Emergency Dispatch Trigger & Modal** | YES | `Tab`, `Enter`, `Escape`, `Space` | Traps focus inside modal; closes on `Escape`. |
| **Field Observation Dialog & Upload** | YES | `Tab`, `Enter`, `Space` | Native file picker opens via standard keyboard activation. |
| **Interactive Leaflet Risk Map** | PARTIAL | `Tab`, `Arrow keys`, `+`, `-` | Leaflet container is focusable (`tabIndex={0}`). Panning with arrow keys and zoom with `+`/`-` is supported by Leaflet. Direct polygon clicking is best paired with the accessible Prioritisation List on the right. |

---

## 3. Known Gaps & Future Improvements (Honest Disclosure)

Per project honesty guidelines, we do not claim full WCAG 2.1 AA compliance in this release:

1. **Map Polygon Direct Focus**: Leaflet SVG path polygons for individual risk zones are not directly in the tab order. To address this, every zone is simultaneously reachable via the keyboard-navigable Prioritisation List and Zone Detail links.
2. **Color Contrast in Subdued Labels**: Certain muted metadata labels (`text-muted-foreground` with `opacity-80`) achieve a 3.8:1 contrast ratio against dark cards, slightly below the 4.5:1 WCAG AA threshold for normal text.
3. **Chart Tooltips (Recharts)**: Detailed tooltip values in the 30-day rainfall chart require hover or touch; keyboard focus on chart nodes does not yet announce SVG tooltip contents via screen reader.
