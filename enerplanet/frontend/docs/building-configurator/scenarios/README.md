# Building Configurator Scenarios

One file per scenario. SC-01 to SC-08 and SC-11 are filtered and refined from
`../user-stories.md`; SC-02, SC-09 and SC-10 were not raised in the workshop and
are added from the integration design. Referenced by
`../design.md` section 1.3 and the flow trace in section 2.5. Persona codes
link to `../personas.md`.

| ID | Title | Personas | Stories |
|---|---|---|---|
| [SC-01](sc-01-prepared-3d-data.md) | Configure a building with prepared 3D data | [DEV](../personas.md#dev), [PLAN](../personas.md#plan), [USER](../personas.md#user) | US-209, US-501, US-502 |
| [SC-02](sc-02-3d-data-not-ready.md) | Configure a building whose 3D data is not yet prepared | any | none (new) |
| [SC-03](sc-03-no-archetype-match.md) | Configure a building City2TABULA could not match | [USER](../personas.md#user), [PLAN](../personas.md#plan) | US-203, US-502 |
| [SC-04](sc-04-exclude-a-floor.md) | Exclude a floor from a building's model | [DEV](../personas.md#dev), [PLAN](../personas.md#plan), [MKT](../personas.md#mkt), [USER](../personas.md#user) | US-204 |
| [SC-05](sc-05-inspect-envelope.md) | Inspect and adjust the envelope | [PLAN](../personas.md#plan), [USER](../personas.md#user) | US-202, US-701, US-502 |
| [SC-06](sc-06-multiple-pv-instances.md) | Add multiple PV instances to a building | [DEV](../personas.md#dev), [PLAN](../personas.md#plan), [MKT](../personas.md#mkt) | US-201, US-205, US-206 |
| [SC-07](sc-07-pv-sizing-recommendation.md) | Ask the tool to size PV | [PLAN](../personas.md#plan), [MKT](../personas.md#mkt) | US-207 |
| [SC-08](sc-08-enter-cost-data.md) | Enter cost data for the model | [DEV](../personas.md#dev), [PLAN](../personas.md#plan) | US-101, US-407, US-408 |
| [SC-09](sc-09-equipment-stage.md) | Configure the household equipment contribution | [USER](../personas.md#user), [DEV](../personas.md#dev) | none (new, blocked) |
| [SC-10](sc-10-resume-configuration.md) | Resume a half-finished configuration | any | none (new) |
| [SC-11](sc-11-reuse-configuration.md) | Reuse configuration across buildings | any | none (new) |
