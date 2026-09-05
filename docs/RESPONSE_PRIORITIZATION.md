# Emergency Response Prioritization Methodology

**System:** LandAlert-Nexus (SIH26001 — Northeast India Landslide Early Warning)  
**Status:** Authoritative Decision-Support Module  
**Scope:** Operational Resource Allocation & Disaster Dispatch Guidance  
**Last Updated:** September 2026  

---

## 1. Executive Summary & Purpose

During severe monsoon storm events, multiple hill zones across the 8 Northeastern Region (NER) states simultaneously cross into High or Severe landslide hazard thresholds. State Disaster Management Authorities (SDMAs), the National Disaster Response Force (NDRF), and district administrations must allocate constrained emergency assets (heavy earth-moving equipment, evacuation teams, medical supplies, search and rescue units) under extreme time pressure.

The **Emergency Response Prioritization** view synthesizes 4 heterogeneous data streams into a single transparent, inspectable urgency score (0.0 to 100.0).

> [!IMPORTANT]
> **Decision-Support Guardrail**:
> This ranking is an advisory decision-support tool for human incident commanders.
> It **STRICTLY DOES NOT** trigger automated alert dispatches, evacuations, or notifications.
> All alerts continue to require authorized dispatcher sign-off or validated threshold criteria.

---

## 2. Mathematical Formulation & Weighting Schema

The composite urgency score $S_{\text{priority}} \in [0.0, 100.0]$ is computed as a weighted sum of four normalized sub-components:

$$S_{\text{priority}} = C_{\text{severity}} + C_{\text{population}} + C_{\text{road}} + C_{\text{observation}}$$

$$\begin{aligned}
C_{\text{severity}}    &= 100 \times w_{\text{severity}} \times f_{\text{severity}} \quad &(w_{\text{severity}} = 0.40) \\
C_{\text{population}}  &= 100 \times w_{\text{pop}} \times f_{\text{pop}} \quad &(w_{\text{pop}} = 0.25) \\
C_{\text{road}}        &= 100 \times w_{\text{road}} \times f_{\text{road}} \quad &(w_{\text{road}} = 0.20) \\
C_{\text{observation}} &= 100 \times w_{\text{obs}} \times f_{\text{obs}} \quad &(w_{\text{obs}} = 0.15)
\end{aligned}$$

Total weights sum to $1.00$ ($40\% + 25\% + 20\% + 15\% = 100\%$).

### Detailed Component Definitions:

| Component | Weight | Max Pts | Normalization Function & Scaling Rationale |
| :--- | :---: | :---: | :--- |
| **Current Risk Severity** ($C_{\text{severity}}$) | $0.40$ | $40.0$ | $f_{\text{severity}} = \frac{\text{severityRank}(\text{level})}{4.0}$<br>• Severe = $1.00$ ($40.0$ pts)<br>• High = $0.75$ ($30.0$ pts)<br>• Moderate = $0.50$ ($20.0$ pts)<br>• Low = $0.25$ ($10.0$ pts)<br>**UNKNOWN**: $\text{severityRank} = \text{null}$. **Strictly excluded from ranking** (see Section 3). |
| **Population Vulnerability** ($C_{\text{population}}$) | $0.25$ | $25.0$ | $f_{\text{pop}} = \min\left(1.0, \frac{\text{population}}{100{,}000}\right)$<br>Scales human exposure directly from official Census/NDMA zone statistics. Saturated at 100,000 residents to prevent high-population urban centers from completely eclipsing acute geological hazards in smaller tribal villages. |
| **Arterial Road Cutoff** ($C_{\text{road}}$) | $0.20$ | $20.0$ | Derived from intersecting National Highway & arterial corridor statuses (`road_segments`):<br>• Any segment **blocked**: $f_{\text{road}} = 1.0$ ($20.0$ pts) — high risk of complete physical isolation and supply cutoff.<br>• Any segment **restricted**: $f_{\text{road}} = 0.5$ ($10.0$ pts) — severe traffic constriction.<br>• All segments **open**: $f_{\text{road}} = 0.0$ ($0.0$ pts). |
| **Ground Observation Intensity** ($C_{\text{observation}}$) | $0.15$ | $15.0$ | $f_{\text{obs}} = \min\left(1.0, \frac{N_{\text{pending\_distress}}}{4.0}\right)$<br>Count of pending field reports indicating active slope distress (visual signs of tension cracks, soil slumping, or rainfall $>40$mm). Saturated at 4 verified reports ($15.0$ pts). Reflects immediate on-ground physical confirmation. |

---

## 3. Scientific Handling of UNKNOWN / Degraded Telemetry

Disaster warning systems must avoid false reassurance during communication outages.

- **Rule**: If a zone has `current_risk_level === "UNKNOWN"` (due to inference engine failure and missing telemetry database fallback), its `severityRank` evaluates to `null`.
- **Enforcement**:
  - The zone is **STRICTLY EXCLUDED** from the numerical ranked list.
  - It is placed into an explicit, visually distinct **"Unranked / Awaiting Telemetry"** section.
  - It is **NEVER** assigned a default score of 0 or coerced to "Low" severity, which would deceptively suggest to a dispatcher that the zone is safe.

---

## 4. Inspection & Explainability

Every ranked zone entry displays its full point breakdown and human-readable top contributing drivers, e.g.:
- *Severe risk tier (40.0 pts)*
- *Arterial road blocked (NH-29) (20.0 pts)*
- *High population density: 75,000 residents (18.8 pts)*
- *2 pending distressed field reports (7.5 pts)*

Incident commanders can immediately inspect the physical reasoning behind why one district or hill valley is ranked above another.
