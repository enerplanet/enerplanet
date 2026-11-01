---
audience: developer
---

# SC-13 · Add a technology to a building from the building configurator

- **Personas:** the project developer and community organiser, the regional
  planner, the green entrepreneur, the private end user
- **Stories:** a confirmation message names the technology when it is
  added; adding from inside the building configurator is new
- **Flow path:** model setup, building configurator, Technologies tab

## Narrative

A user opens a single-family house in the building configurator to check its
envelope. The building has no technologies yet. The Technologies tab is
shown anyway: it says the building has no technologies and offers an Add
button.

The user clicks Add and sees EnerPlanET's predefined technology list, the
same list the building dialog on the map offers, split into electricity and
heat and searchable by name. They pick a heat pump. The product dialog opens
as it does from the map: the user picks a catalogue product or defines their
own parameters. A confirmation message names the technology, and its card
appears in the Technologies tab, where its parameters can be edited or the
technology removed.

Adding PV works the same way, after which the configurator opens the PV step
so the user can check the arrays laid out on the roof.

## Rules

| Case | Behaviour |
|---|---|
| Building has no technologies | The Technologies tab is shown with the empty message and the Add button |
| Technology type already on the building | Marked as added in the list and cannot be picked; its card in the tab edits it |
| User closes the product dialog without picking | Nothing is added; the configurator stays open on the Technologies tab |
| PV added | The PV step opens with the arrays laid out, as when PV is added from the map |

## Derived requirements

- The host passes `onAdd` to the configurator's Technologies tab and passes
  the tab even when the building has no technologies.
- The type list is one component shared by the building dialog and the
  configurator, so both offer the same technologies.
- Picking a type runs the existing product dialog and save path; the saved
  technology appears in the open configurator without reopening it.

## Out of scope

- Adding a technology type that EnerPlanET's predefined list does not hold.
- Several instances of the same technology on one building.
