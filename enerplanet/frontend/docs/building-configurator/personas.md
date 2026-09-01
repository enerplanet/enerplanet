# Building Configurator Personas

The five personas from `EnerPlanET/EnerPlanET_User_Stories.pdf` (WP3 round-1
workshop feedback) that the Building Configurator's user stories and scenarios
are written against. The full ten-persona set also covers grid-only and
results-only personas not relevant to this feature.

Referenced from `user-stories.md`, `scenarios/`, and `design.md` section 1.1 by
persona code.

## Index

| Code | Persona | Technical comfort |
|---|---|---|
| [DEV](#dev) | The Project Developer and Community Organizer | High |
| [PLAN](#plan) | The Regional Planner | Medium |
| [MKT](#mkt) | The Green Entrepreneur and Marketer | High |
| [USER](#user) | The Private End-User | Low |
| [DSO](#dso) | The Grid and Simulation Analyst | High |

---

<a id="dev"></a>
## DEV · The Project Developer and Community Organizer

- **Role.** Renewable energy park planner / energy community organiser.
- **Context.** Assembles a consortium of businesses or building owners to share
  generation; needs to justify the numbers to investors and regulators.
- **Goals.** Find collaboration opportunities, model shared/community
  generation, hit ROI and compliance targets.
- **Technical comfort.** High. Needs technical precision without doing the
  modelling himself; wants Pro-mode depth but a fast workflow.

**Consequence for the configurator.** Wants the advanced field set exposed via
one toggle, not a separate interface, and wants to move through many buildings
quickly (`SC-01`, `SC-11`, `US-103`).

---

<a id="plan"></a>
## PLAN · The Regional Planner

- **Role.** Regional development manager / municipal energy officer.
- **Context.** Reviews region-wide renewable-energy development gaps, presents
  findings to council, weighs public acceptance and zoning.
- **Goals.** Identify underdeveloped regions, attract investment, meet
  carbon-reduction targets.
- **Technical comfort.** Medium. Needs synthesised, defensible numbers, not raw
  parameters, for non-technical audiences.

**Consequence for the configurator.** Drives the provenance and disclaimer
requirements: every figure needs a stated source and an accuracy caveat before
it goes in front of a council (`US-501`, `US-503`).

---

<a id="mkt"></a>
## MKT · The Green Entrepreneur and Marketer

- **Role.** Charging-station business owner / renewable systems marketer.
- **Context.** Scouts business opportunities and builds customer-facing
  scenarios (for example "here is what solar plus storage would save you").
- **Goals.** Spot business openings, generate quick, persuasive scenarios for
  customers.
- **Technical comfort.** High.

**Consequence for the configurator.** Wants a fast path to a plausible
scenario: technology packs (`US-206`) and tool-recommended sizing (`US-207`)
over manual parameter entry.

---

<a id="user"></a>
## USER · The Private End-User

- **Role.** Homeowner or small business owner.
- **Context.** Checking whether solar plus storage, or joining an energy
  community, would lower the bill.
- **Goals.** Lower costs, understand self-sufficiency, connect with personal
  data.
- **Technical comfort.** Low. Overwhelmed by technical parameters.

**Consequence for the configurator.** The primary design constraint. The
staged, one-domain-per-screen layout, the simple/Pro split, and plain-language
field labels all exist for this persona (`US-103`, `US-202`).

---

<a id="dso"></a>
## DSO · The Grid and Simulation Analyst

- **Role.** Simulation systems expert at a DSO or power-system planning
  company.
- **Context.** Wants to integrate EnerPlanET into her own network-management
  systems; needs realistic topology (transformers), bottleneck identification,
  and data she can export and cross-check elsewhere.
- **Goals.** Realistic grid representation, interoperability, connection-point
  analysis.
- **Technical comfort.** High. Distrusts black-box outputs; needs raw data
  access, not just visualisations.

**Consequence for the configurator.** Drives the estimated-versus-real
distinction and the source badge on every value (`US-502`); wants raw figures
available, not only a chart.
