# Building Configurator User Stories

The 24 stories from `EnerPlanET/EnerPlanET_User_Stories.pdf` (WP3 Feedback,
RENvolveIT round-1 testing, Germany / Austria / Czech Republic / Netherlands)
that touch the Building Configurator. A wider 38-story set covers stories
outside this feature's scope; personas are in `personas.md`.

Each story has a stable anchor (`#us-101` etc.) so `design.md` and the scenario
files can link to it directly, for example `user-stories.md#us-209`. Persona
codes in the tables below (DEV, PLAN, MKT, USER, DSO) are defined in
`personas.md`.

## Index

| ID | Title | Priority | Configurator stage |
|---|---|---|---|
| [US-209](#us-209) | Model Heating and Cooling Demand | 1 | the BuEM run itself |
| [US-204](#us-204) | Exclude Specific Floors from a Building's Model | 1 | metadata |
| [US-207](#us-207) | Tool-Recommended Optimal PV Sizing | 0 | technologies |
| [US-303](#us-303) | Add a Battery at Cluster Level | 1 | technologies (cluster scope) |
| [US-201](#us-201) | Multiple Instances of the Same Technology per Building | 2 | technologies |
| [US-205](#us-205) | Detect Existing Solar Panels on the Roof | 3 | geometry / technologies |
| [US-206](#us-206) | Add PV as a Pre-Configured Technology Pack | 3 | technologies |
| [US-208](#us-208) | Model a Charging Station | 4 | technologies |
| [US-101](#us-101) | Upload Personal Data for a Personalized Model | 3 | costs / metadata |
| [US-102](#us-102) | Calculate by Year or Season | 3 | metadata |
| [US-103](#us-103) | Simplified View with Optional Pro Mode | 3 | cross-cutting |
| [US-104](#us-104) | Role-Based Onboarding | 5 | entry |
| [US-202](#us-202) | Context-Rich, Plain-Language Technical Parameters | 5 | cross-cutting |
| [US-203](#us-203) | Edit Model Input Safely After a Data Mismatch | 3 | cross-cutting |
| [US-407](#us-407) | Cost-Benefit Analysis and PV Investment Costs | 2 | costs |
| [US-408](#us-408) | Remove Already-Built-Technology Cost | 5 | costs |
| [US-501](#us-501) | Clarity on Data Source and Assumptions | 3 | cross-cutting |
| [US-502](#us-502) | Distinguish Estimated vs. Real Data | 2 | cross-cutting |
| [US-503](#us-503) | Disclaimer on Result Accuracy | 3 | results boundary |
| [US-402](#us-402) | Scalable UI Elements for Maps and Graphs | 3 | cross-cutting |
| [US-105](#us-105) | Contextual Help: Info Pop-ups and Short Instructional Videos | 5 | cross-cutting |
| [US-401](#us-401) | Clearer Hierarchy for Important Information | 3 | cross-cutting |
| [US-409](#us-409) | Undo / Step Back Through Actions | 5 | cross-cutting |
| [US-701](#us-701) | Accurate, Scientifically Correct Units | 3 | cross-cutting |

---

<a id="us-209"></a>
## US-209 · Model Heating and Cooling Demand

| | |
|---|---|
| Priority | 1 (Highest) |
| Personas | DEV, DSO |
| Workshop demo site | NL, RW |
| Trace | Heating and Cooling module |
| Configurator stage | the BuEM run itself |

**Story.** As a user, I want to model heating and cooling so that a building's
thermal demand is represented alongside its electrical demand.

**Acceptance criteria**
- Users can model heating demand for a building.
- Users can model cooling demand for a building.
- Building physics parameters can be changed by the user.

**Notes.** Solution: use the BuEM model with Ignis (building parameters based on
TABULA variants). DPM.

---

<a id="us-204"></a>
## US-204 · Exclude Specific Floors from a Building's Model

| | |
|---|---|
| Priority | 1 (Highest) |
| Personas | DEV, PLAN, MKT, USER |
| Workshop demo site | Koeln |
| Trace | Building Configurator |
| Configurator stage | metadata |

**Story.** As a user, I want to exclude specific floors from a building in the
modeling (e.g. a ground floor that is not part of the energy community) so that
the demand calculation matches reality.

**Acceptance criteria**
- Users can edit building demand while excluding demand from a specific floor.
- A confirmation message is shown when the edit is saved successfully.
- The calculation completes without error.

---

<a id="us-207"></a>
## US-207 · Tool-Recommended Optimal PV Sizing

| | |
|---|---|
| Priority | 0 (Very High) |
| Personas | PLAN, MKT, USER |
| Workshop demo site | NL, CZ, AT, RW |
| Trace | Model Optimization (new) |
| Configurator stage | technologies |

**Story.** As a user, I want the tool to tell me how much PV capacity is optimal
based on my demand so that I don't have to guess a sizing.

**Acceptance criteria**
- A realistic Calliope-based estimate of PV requirement is produced.
- Related grid information is presented clearly and linked to the
  recommendation.
- Simulation is used for actual existing components/plans; the Calliope
  estimate is used for unknown/undefined needs.

**Notes.** Possible solution: model simulation needs to be skippable to allow
optimisation; may need a new technology configuration. Trace names the owning
component as new, "Model Optimization" -- the optimisation path itself does not
exist yet.

---

<a id="us-303"></a>
## US-303 · Add a Battery at Cluster Level

| | |
|---|---|
| Priority | 1 (Highest) |
| Personas | DEV, PLAN, MKT, USER, DSO |
| Workshop demo site | NL |
| Trace | Configurator |
| Configurator stage | technologies (cluster scope) |

**Story.** As a user, I want to add a battery to a cluster rather than to a
specific building so that storage is modeled at the cluster level.

**Acceptance criteria**
- The user can add a battery to a cluster.
- The battery is associated with the cluster, not with a single building.
- A cluster can be selected as the placement target for a battery.

---

<a id="us-201"></a>
## US-201 · Multiple Instances of the Same Technology per Building

| | |
|---|---|
| Priority | 2 (High) |
| Personas | DEV, PLAN, MKT, USER |
| Workshop demo site | Koeln, AT, NL |
| Trace | Building/Technology Configurator |
| Configurator stage | technologies |

**Story.** As a user, I want to include multiple instances of the same
technology per building (e.g. multiple PVs) so that I can model real
installations accurately.

**Acceptance criteria**
- The UI shows multiple instances of the same technology clearly.
- A confirmation message is shown when an instance is added successfully.
- Calculations complete without error across all instances.
- The results dashboard makes the different instances individually
  recognizable.

**Notes.** Based on discussion with the Calliope 0.7 update: technologies are
defined on a single point; more than one tech can go on a node. If names must
differ, use a convention like `techname-floor-0`. Consequences: technologies
need redefining in the frontend, backend changes expected, ID/naming and UIDs
needed for technologies, data now comes from JSON (time series, model config),
and data for everything needs to be stored in the database.

---

<a id="us-205"></a>
## US-205 · Detect Existing Solar Panels on the Roof

| | |
|---|---|
| Priority | 3 (Medium) |
| Personas | DEV, PLAN, MKT |
| Workshop demo site | AT |
| Trace | Technology Configurator |
| Configurator stage | geometry / technologies |

**Story.** As a user, I want to see whether solar panels already exist on a
building's roof so that the model reflects the current installed state.

**Acceptance criteria**
- Existing solar panels are shown on the map and can influence model creation
  if the user requests it.
- Data is pulled live for the model area from the source API to keep it fresh.

---

<a id="us-206"></a>
## US-206 · Add PV as a Pre-Configured Technology Pack

| | |
|---|---|
| Priority | 3 (Medium) |
| Personas | PLAN, MKT, USER |
| Workshop demo site | AT |
| Trace | Technology Configurator (tech packs) |
| Configurator stage | technologies |

**Story.** As a user, I want to add PV supply as a pre-built technology pack
(PV + storage bundled together) so that I don't have to configure compatible
components separately.

**Acceptance criteria**
- The configuration UI shows a standalone PV option and a combined PV +
  storage pack option.
- A confirmation message is shown when a pack is added to a building.
- Calculations complete without error for pack-based configurations.

---

<a id="us-208"></a>
## US-208 · Model a Charging Station

| | |
|---|---|
| Priority | 4 (Low) |
| Personas | PLAN, MKT, USER, DSO |
| Workshop demo site | Koeln, RW |
| Trace | Grid Configurator, Technology Configurator |
| Configurator stage | technologies |

**Story.** As a user, I want to be able to model a charging station so that EV
charging demand is represented in my energy community.

**Acceptance criteria**
- Charging stations can be defined as an assignable demand on the grid.
- The UI supports simple point-and-click assignment linking a charging station
  to a specific demand consumer.

---

<a id="us-101"></a>
## US-101 · Upload Personal Data for a Personalized Model

| | |
|---|---|
| Priority | 3 (Medium) |
| Personas | DEV, MKT, USER, DSO |
| Workshop demo site | All |
| Trace | Configurator |
| Configurator stage | costs / metadata |

**Story.** As a user, I want to upload my own data (electricity prices,
electricity demand, PV panel production) so that my modeling results are
personalized and more relevant to my situation.

**Acceptance criteria**
- A dedicated upload and management interface is available for user-supplied
  datasets.
- Uploaded data is clearly linked to the results it influenced.
- The UI guides users on how to prepare/create a compatible dataset.
- Uploaded data persists across sessions and is validated against the expected
  data model (e.g. demand/supply columns).
- Example/template data is available for download before upload.

**Notes.** AT: interoperability with existing systems used by practitioners
(EDA for data source in Austria). CZ: connect with an existing system if
possible. Both countries: accept existing system formats.

---

<a id="us-102"></a>
## US-102 · Calculate by Year or Season

| | |
|---|---|
| Priority | 3 (Medium) |
| Personas | DEV, MKT, USER |
| Workshop demo site | Koeln, NL, AT |
| Trace | Configurator |
| Configurator stage | metadata |

**Story.** As a user, I want to calculate results for at least one full year or
by season (winter, summer, ...) so that I can quickly select the time window
that matters to me.

**Acceptance criteria**
- A season-selection control is available in the UI.
- A year-selection control is available in the UI.
- The selected period is reflected in the results section.

**Notes.** Quickselect.

---

<a id="us-103"></a>
## US-103 · Simplified View with Optional Pro Mode

| | |
|---|---|
| Priority | 3 (Medium) |
| Personas | DEV, MKT, USER, DSO |
| Workshop demo site | NL, AT |
| Trace | Configurator |
| Configurator stage | cross-cutting |

**Story.** As a user, I want to start with a very simplified view and switch to
a Pro model with more settings so that the tool matches my level of expertise.

**Acceptance criteria**
- A Simple mode and an Advanced (Pro) mode are both available.
- Required vs. specialized/advanced properties are clearly determined and
  filtered by mode.

---

<a id="us-104"></a>
## US-104 · Role-Based Onboarding

| | |
|---|---|
| Priority | 5 (Low) |
| Personas | DEV, MKT, USER, DSO |
| Workshop demo site | RW |
| Trace | Documentation |
| Configurator stage | entry, before stage 1 |

**Story.** As a user, I want an onboarding flow that adapts to my role (e.g.
energy supplier, energy community organizer, municipality) so that I see
relevant defaults, terminology, and starting points instead of a generic setup.

**Acceptance criteria**
- The onboarding flow asks the user to select their role early on.
- At minimum, the roles energy community, grid operator, private user are
  supported as distinct paths.

---

<a id="us-202"></a>
## US-202 · Context-Rich, Plain-Language Technical Parameters

| | |
|---|---|
| Priority | 5 (Lowest) |
| Personas | MKT, USER |
| Workshop demo site | NL, CZ, AT |
| Trace | Configurator |
| Configurator stage | cross-cutting |

**Story.** As a user, I want tech parameters explained as plain-language
questions (e.g. "In which direction does your PV face?", "What is your PV's
efficiency?", "What does your PV cost?", "What is the O&M cost?") instead of raw
parameter names, so that I know what I'm changing and why.

**Acceptance criteria**
- Technical parameter information is clear and concise.
- No confusing extra information is shown in the UI.
- Clear indicators show what each parameter affects.

---

<a id="us-203"></a>
## US-203 · Edit Model Input Safely After a Data Mismatch

| | |
|---|---|
| Priority | 3 (Medium) |
| Personas | DEV, MKT, USER |
| Workshop demo site | Koeln, NL, RW, AT |
| Trace | Building Configurator |
| Configurator stage | cross-cutting |

**Story.** As a user, I want to edit model input (e.g. tech parameters, building
attributes) so that I can correct an error case caused by a data mismatch.

**Acceptance criteria**
- Building parameters clearly indicate when they can or cannot be modified due
  to a data mismatch.
- Unavailable options are not shown (hidden rather than disabled where they
  can't be used).

**Notes.** Possible solution: hide unusable options or offer an alternative.

---

<a id="us-407"></a>
## US-407 · Cost-Benefit Analysis and PV Investment Costs

| | |
|---|---|
| Priority | 2 (High) |
| Personas | DEV, PLAN, MKT, USER |
| Workshop demo site | AT |
| Trace | Configurator and Dashboard Results |
| Configurator stage | costs |

**Story.** As a user, I want to see cost-benefit analysis and investment costs
from PV so that I can judge the financial case for a system.

**Acceptance criteria**
- The cost-benefit analysis is accurate, with clear indication of how it was
  calculated.
- Investment costs are realistic and reflect a real use case.

---

<a id="us-408"></a>
## US-408 · Remove Already-Built-Technology Cost

| | |
|---|---|
| Priority | 5 (Low) |
| Personas | PLAN, MKT |
| Workshop demo site | AT, RW |
| Trace | Dashboard Results |
| Configurator stage | costs |

**Story.** As a user, I want infrastructure build-out cost to not be shown as a
prominent, default KPI, so that the results view reflects what matters most in
the early planning phase.

**Acceptance criteria**
- The costs show only total costs of new technology to be built, not including
  existing ones.

---

<a id="us-501"></a>
## US-501 · Clarity on Data Source and Assumptions

| | |
|---|---|
| Priority | 3 (Medium) |
| Personas | PLAN, DSO |
| Workshop demo site | All |
| Trace | Model configurator and Dashboard Results (data flow); relates to US-403 |
| Configurator stage | cross-cutting |

**Story.** As a user, I want clear information on the exact data source and the
assumptions made so that I can trust how the results were produced.

**Acceptance criteria**
- Where each piece of data comes from is clearly stated alongside results.
- The assumptions made in producing a result are clearly stated.

---

<a id="us-502"></a>
## US-502 · Distinguish Estimated vs. Real Data

| | |
|---|---|
| Priority | 2 (High) |
| Personas | DSO |
| Workshop demo site | All |
| Trace | model configurator and Dashboard Results; relates to US-501 |
| Configurator stage | cross-cutting |

**Story.** As a user, I want to see what is estimated versus what is real, and
what happens with the calculations, so that I understand which figures are
measured and how results are derived.

**Acceptance criteria**
- Real and estimated data are clearly and visibly distinguished.
- How results are derived from inputs is clarified in the UI.

---

<a id="us-503"></a>
## US-503 · Disclaimer on Result Accuracy

| | |
|---|---|
| Priority | 3 (Medium) |
| Personas | PLAN, USER |
| Workshop demo site | All |
| Trace | Dashboard Results; relates to US-502 |
| Configurator stage | results boundary |

**Story.** As a user, I want a disclaimer shown stating that the output provides
an overview of the situation but does not reflect the actual situation, so that
I do not over-rely on the results.

**Acceptance criteria**
- A disclaimer is shown stating that the output is an overview and not a
  reflection of the actual real-world situation.

---

<a id="us-402"></a>
## US-402 · Scalable UI Elements for Maps and Graphs

| | |
|---|---|
| Priority | 3 (Medium) |
| Personas | PLAN, MKT, USER |
| Workshop demo site | NL, AT |
| Trace | Model builder, all components |
| Configurator stage | cross-cutting |

**Story.** As a user, I want to be able to scale UI elements to better view
graphs, maps, and other interactive components (e.g. hide the map, enlarge a
graph) so that I can focus on what I need.

**Acceptance criteria**
- UI elements are resizable.
- Maps, graphs and general UI scale to different screen resolutions.
- Sections and map views can be minimized to give more space to another view.

---

<a id="us-105"></a>
## US-105 · Contextual Help: Info Pop-ups and Short Instructional Videos

| | |
|---|---|
| Priority | 5 (Low) |
| Personas | PLAN, MKT, USER |
| Workshop demo site | NL |
| Trace | Documentation |
| Configurator stage | cross-cutting |

**Story.** As a user, I want info buttons next to map tools and key fields that
show short pop-up explanations and instructional videos, so that I can
understand a feature without leaving the tool.

**Acceptance criteria**
- Info icons are available next to key map tools and configuration fields.
- Clicking an info icon shows a short, contextual explanation.
- Select info pop-ups include or link to a short instructional video.

---

<a id="us-401"></a>
## US-401 · Clearer Hierarchy for Important Information

| | |
|---|---|
| Priority | 3 (Medium) |
| Personas | PLAN, MKT, USER |
| Workshop demo site | NL, AT |
| Trace | Dashboard Results |
| Configurator stage | cross-cutting |

**Story.** As a user, I want important information highlighted more clearly so
that I can understand results without hunting for what matters.

**Acceptance criteria**
- Important messages are shown in red and prominently when something is wrong.
- Results establish a clearer hierarchy of what information is important.

**Notes.** The team first defines what is important as a module requirement,
then implements it.

---

<a id="us-409"></a>
## US-409 · Undo / Step Back Through Actions

| | |
|---|---|
| Priority | 5 (Low) |
| Personas | DEV, PLAN, MKT, USER, DSO |
| Workshop demo site | RW |
| Trace | Dashboard Results |
| Configurator stage | cross-cutting |

**Story.** As a user, I want a back/undo button so that I can step back through
my last actions (e.g. from results dashboard back to configuration).

**Acceptance criteria**
- A back action or button is available and reachable in the dashboard result.

---

<a id="us-701"></a>
## US-701 · Accurate, Scientifically Correct Units

| | |
|---|---|
| Priority | 3 (Medium) |
| Personas | All |
| Workshop demo site | NL, AT, RW |
| Trace | Dashboard Results |
| Configurator stage | cross-cutting |

**Story.** As a user, I expect all units to be accurate for their use; they
should reflect the specific scientific units used for this area and purpose.

**Acceptance criteria**
- All units used in the tool are validated against the correct scientific
  standard for the domain.
- Units are readable and clearly labeled throughout the UI.
