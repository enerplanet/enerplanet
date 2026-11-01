---
audience: developer
---

# SC-14 · Add a product of a technology type, such as a specific PV module

- **Personas:** the project developer and community organiser, the regional
  planner, the green entrepreneur, the private end user
- **Stories:** model a real installation with the module a building
  actually uses; choosing the type of a new technology is new
- **Flow path:** Technologies page; product dialog when a technology is added
  to a building

## Narrative

A user plans PV on a row of houses and wants to compare two modules: one from
manufacturer A at 400 W per module, one from manufacturer B at 430 W with a
higher price per kW. On the Technologies page they click Add technology and
first choose the type, Photovoltaics. The form fills in the parameters of the
default PV product, so the user changes only what differs: the name, the
manufacturer, the module model, the datasheet link, the cost and the
efficiency. They save, then add the second module the same way.

Both modules now appear in the product dialog whenever the user adds PV to a
building, on the map or in the building configurator, next to the default
product and with their manufacturer shown. Each building can use a different
module.

## Rules

| Case | Behaviour |
|---|---|
| No type chosen | The form cannot be saved; the type field says it is required |
| Type chosen | The parameters of that type's default product are filled in; the user edits them |
| Type changed after editing parameters | Parameters that both types have keep the user's values; the rest are replaced by the new type's defaults |
| Existing technology edited | Only its parameters change, as now; its type stays |
| Copy of an existing technology | Keeps the source's type, as now |
| Product dialog for a type | Lists the system products of that type and the user's own; another user's products are not listed |
| A required parameter of the type removed | Rejected on save, naming the parameter |

## Derived requirements

- The add form has a required type field listing the types the simulation
  models (the electricity and heat types the building technology list offers).
  The backend rejects a type outside that list instead of setting the type to
  the key.
- Choosing a type fills the constraints from that type's default product.
- The form has optional manufacturer, model and datasheet link fields; the
  backend already stores them and the product dialog already shows the
  manufacturer.
- Each type declares the constraints a product must keep; the backend checks
  them on create and update.
- The product dialog lists system products and the requesting user's own,
  whatever the user's access level.

## Out of scope

- New technology types that the simulation does not model.
- Importing module parameters from a datasheet file.
- Sharing a user's product with other users. An expert can already make it a
  system product on the Technologies page.
