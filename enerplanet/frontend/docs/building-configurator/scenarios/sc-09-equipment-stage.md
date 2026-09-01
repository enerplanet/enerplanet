# SC-09 · Configure the household equipment contribution

- **Personas:** [USER](../personas.md#user), [DEV](../personas.md#dev)
- **Stories:** none (new, blocked on the BuEM contract)
- **Flow path:** `Configuring`, equipment stage

## Narrative

In the equipment stage the user adds appliance types (fridge, TV and so on)
from a list; each has a small set of config options that feed heat gain and
electricity load into BuEM.

## Derived requirements

- an extensible equipment-type list, each type with its own option set
- the stage shell is built now
- the payload mapping waits on buem-gateway-dev defining the contract
