# SC-08 · Enter cost data for the model

- **Personas:** [DEV](../personas.md#dev), [PLAN](../personas.md#plan)
- **Stories:** [US-101](../user-stories.md#us-101), [US-407](../user-stories.md#us-407), [US-408](../user-stories.md#us-408)
- **Flow path:** `Configuring`, costs stage

## Narrative

In the costs stage the user supplies or uploads electricity prices, PV
production and demand series, and sets investment and O&M assumptions per
technology. Cost-benefit output is traceable to these inputs. The cost of
already-installed technology is excluded from the headline figure by default.

## Derived requirements

- cost inputs per technology
- upload and template download for series data, validated against expected
  columns (US-101)
- existing versus new technology cost separated (US-408)
