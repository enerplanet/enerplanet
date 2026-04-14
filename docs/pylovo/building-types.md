# Building Types

## Classification System

PyLovo uses a three-level building classification system:

| Level | Attribute | Source |
|---|---|---|
| Functional type | `f_class` | Derived from OSM building tags |
| Electrical category | Consumer Category | Determined from `f_class` |
| Urbanisation level | Settlement Type | Derived from population density |

## f_class

`f_class` (Function Classification) is stored in `buildings_result.f_class` (VARCHAR 80). It flows from OSM through the data pipeline unchanged:

```
OpenStreetMap → buildings table → buildings_tem → buildings_result.f_class
```

### Common f_class Values

| f_class | Description | Consumer Category |
|---|---|---|
| `residential` | General residential | SFH / MFH |
| `house` | Single-family house | SFH |
| `detached` | Detached house | SFH |
| `apartments` | Multi-unit apartment | MFH |
| `terrace` | Row house | SFH |
| `office` | Office building | Commercial |
| `retail` | Retail shop | Commercial |
| `supermarket` | Supermarket | Commercial |
| `restaurant` | Restaurant | Commercial |
| `hotel` | Hotel | Commercial |
| `school` | School | Public |
| `hospital` | Hospital | Public |
| `university` | University | Public |
| `church` | Church | Public |
| `warehouse` | Warehouse | Industrial |
| `factory` | Factory | Industrial |
| `greenhouse` | Agricultural greenhouse | Agricultural |
| `farm` | Farm building | Agricultural |
| `garage` | Garage | Low-demand |

The estimator supports 150+ OSM building types. Unknown types fall back to parent category benchmarks.

### f_class Aliases

The AI estimator normalises common aliases before lookup:

| Input | Normalised To |
|---|---|
| `flat` | `apartments` |
| `townhouse` | `terrace` |
| `semi` | `semidetached_house` |
| `commercial` | `office` |

## Consumer Categories

Consumer categories group building types into electrical load classes:

| ID | Name | Load Model | Notes |
|---|---|---|---|
| 1 | Commercial | `per_m2` | Offices, retail, hotels |
| 2 | Public | `per_m2` | Schools, hospitals, churches |
| 3 | Residential SFH | `household` | Single-family houses |
| 4 | Residential MFH | `household` | Apartments, terraces |
| 5 | Industrial | `per_m2` | Factories, warehouses |
| 6 | Agricultural | `per_m2` | Farms, greenhouses |
| 7 | Infrastructure | `per_m2` | Data centres, utilities |

## Settlement Types

Settlement type affects simultaneity factors and grid topology decisions:

| Settlement Type | Population Density | Notes |
|---|---|---|
| Rural | < 150 inh/km² | Sparse distribution, longer cables |
| Semi-urban | 150–1000 inh/km² | Mixed |
| Urban | > 1000 inh/km² | Dense, shorter cable runs |
