# Node Modeller

Node Modeller is a component that has a similar job as enerplanet/frontend/src/features/configurator

It should implement the same functionality but in a different way.
Goal is to have it fully modular and workflow based.

## Aspect 1: The context

The context is the model configuration and data for a model that we work with on the frontend.
All geodata
All userdata
All data that is need for the final compilation of a model that is sent to the existing backend.

the context leads the workflow

Every change to the context is saved as a diff. all modifications should always be revertable, redoable and tracable.

## Aspect 2: The workflow

Lets say the default workflow defines following Nodes. Its main use is creating a base the what is right now.
A -> B -> C -> D

A: Model Settings (Title, Metadata, etc)
B: Area Selection and Grid Data (Creates Grid data, transformers, buildings and links via pylovo)
C: Demand Heat / Electricity from backend (heat is optinal, and currenty not yet implemented)
D: Technologies (Adds technologies like solar to seleted buildings, its split into multiple submodules. the technology module loops here until the user is satisfied with the assignment. Technologies Module -> Select Building or Multiple Buildings on Map -> Show available Technologies -> User Assignes Technology to selection and configures it. )
A: SolarPanel
B: GasHeater
C: ... Calliope Technology DB (API Returning common Technology definitions for calliope)
E: Run Model via Backend (Run and wait for results from calliope pypsa backend)
F: View Results and ask user for the next step:
B: Optimize Based on Results (run selective optimization workflow)
C: New Model (Rerun workflow and clear context)
D: Branch Model (Create an alternative version with data from this model -> Rerun Workflow with existing context preserved but new id.)

Lets say we drop into the optimization workflow. Here the goal is to help the user in optimizing the calliope model at hand based on common goals, the what could be:

A: Be more self reliant with the cheapest solution over x years
B: Use more renewable energies with the cheapest and least co2 producing solution over x years
C: Pay less money, find the overall cheapest soltion over x years

to do this we use dynamic recommendations based on thresholds commonly seen in calliope to add technologies. As we now have the result of the base model we can optimize and improve the calliope model for better results.

After the optimization is done by iterating through a few modules once more, we once again calculate the results and compare them. Offering key indicators on what improved, and how much it costs. and how much money and co2 it saves over x years.

## Aspect 3: Node based workflow builder and management tool for admins

It allows dynamic node linking based on context requirement and context output. if the nodes required input is not added to the context over the time of the flow the node cant be connected, and also isnt shown to the admin.

A workflow can only start from

- Null Node
- Context Load Node

A optimization workflow here uses a context load node as the start to satisfy folowup nodes. the context load component will load a full existing context from a existing complete model. the context load module here also validates that all data for the followup node is actually available before allowing a workflow to continue but at least in the workflow builder satsfies all requirements of a followup node. (lets say 2 new modules are added one being a dependency of another. context loader here loads context and then checks if the loaded context is valid for the next node if not it automatically fills in the next required node or nodes to fulfill dependencies. )

The workflow editor should be based on react flow.

To keep track and to make sure workflows can be tested internally before release to public a workflow publishing and management tool should be used.

This tool allows to publish a workflow to the userbase.
It allows to delete workflows.
It allows to edit existing workflows.
It allows to create a new workflow.

All admins can access this management interface and can also run all workflows.
All users can only run published workflows and have no access to the workflow management tool.

## Aspect 4: User Datasets (Timeseries)

The new component needs to support user timeseries use for demand and technology production.
This data should be stored in an object database and should be removed on demand by the user via a to be created data management tool.

Without any data default data is used, precomputed estimates.

## Aspect 5: History

As mentioned above the context should be tracked and each change recorded.
A history component should here allow a user to easily see their change history within a opened model. the points where the model was run and compare run results over history with one another.

clicking on a history element and then clicking new branch from here. should create a new branch from this location. meaning a new model with a new id, all history preserved and copied. a branch that said should always be aware of its origin and be able to inform the user where it was created from. this best within the history component as well. small branch icon that links to the source. green for where its from and red to a created branch or banches in a list

## Aspect 6: UI/UX and Cognitive load of energy modelling

The goal is to have a cognitive lightweight interface that eases development of energy models for experts and non experts alike. for this each module should have logical defaults preset. and usually not needed options hidden by default.

## Aspect 7: Clear cutoff and isolated testing.

Each module should be testable on its own and have a specific test flow with vitetest.
the full component should be able to be an externally tested component that can be imported into another environment if the need arises. not requiring the full application to work and export data.

in isolation instead of data upload and model save it should simply download the file on save, and store a object reference via local paths, to emulate the model list.
