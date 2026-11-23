---
audience: developer
---

# RENvolveIT Toolbox API Access

The RENvolveIT toolbox shows EnerPlanET model data on its own dashboard. Its
backend calls the EnerPlanET API with the RENvolveIT access token of the user
who is signed in to the toolbox. EnerPlanET accepts that token, maps it to the
user's EnerPlanET account and answers with that account's data only.

## Use case

EnerPlanET is one tool inside the RENvolveIT toolbox, and a toolbox user has
one identity across both.

1. A community manager signs in to the toolbox and invites the community's
   members by email.
2. The manager (or an expert in the community) builds and runs a model in
   EnerPlanET and shares it with the members by email, or creates one
   EnerPlanET workspace for the community and invites the members to it.
3. Each member's toolbox dashboard shows a card per model they can see: title,
   status, modelled period and the key results, with a link that opens the
   model in EnerPlanET.

A member never handles an EnerPlanET credential. Whatever EnerPlanET lets the
member see in the browser, the toolbox can read for them; nothing more.

## Personal API tokens and toolbox tokens

EnerPlanET also offers personal API tokens (`whf_...`, see the API token guide
in `enerplanet/backend/docs/api-token-guide.md`). They do not fit the toolbox:
a token has to be created in EnerPlanET for each member and pasted into the
toolbox, it lives until revoked, and the toolbox would have to store one secret
per member.

| | Personal token (`whf_`) | Toolbox token |
| --- | --- | --- |
| Issued by | EnerPlanET, on request | RENvolveIT Keycloak, at every toolbox sign-in |
| Lifetime | Until revoked | Minutes (at most 15) |
| Stored by the caller | Yes, one per user | No, the toolbox already holds it |
| Acts as | The token's owner | The EnerPlanET account linked to the RENvolveIT user |
| Routes | All read routes the token's scope allows | The toolbox allow-list only |
| Access level | The owner's, as scoped | Capped at `intermediate` |

Both kinds stay in service. Personal tokens remain the way to script against
EnerPlanET; toolbox tokens serve only the toolbox.

## How a request is handled

The diagram shows one toolbox request from the token check to the response.

```mermaid
sequenceDiagram
    participant TB as Toolbox backend
    participant RKC as RENvolveIT Keycloak
    participant API as EnerPlanET backend
    participant EKC as EnerPlanET Keycloak<br>(spatialhub realm)

    TB->>API: GET /api/models<br>Authorization: Bearer <RENvolveIT token>
    API->>RKC: Signing keys (cached)
    API->>API: Check signature, issuer, client (azp),<br>type, lifetime; route on allow-list
    API->>EKC: User linked to this RENvolveIT user?
    alt not linked, verified email in token
        API->>EKC: Create account, linked to the RENvolveIT user
    end
    API->>API: Run the handler as that account
    API-->>TB: The account's models
```

Middleware order in `cmd/main.go`: personal tokens (`APITokenAuth`), then
toolbox tokens (`BearerAuth`), then the browser session. A request carrying a
toolbox token never reaches the session check.

| Part | Code |
| --- | --- |
| Token verification | `internal/bearerauth/verifier.go` |
| Account lookup and creation | `internal/store/users/partner_accounts.go` |
| Middleware, route allow-list, access level cap | `internal/middleware/bearer_auth.go` |
| Configuration | `internal/config/bearer.go` |

## Accounts and linking

The RENvolveIT user is matched to an EnerPlanET account through the Keycloak
identity provider link (alias `renvolveit`), the same link Keycloak creates
when the user signs in to EnerPlanET with RENvolveIT. The token's user id
(`sub`) is the key, never the email.

| Situation | Result |
| --- | --- |
| Linked account exists and is enabled | The request runs as that account |
| No link, token has a verified email that no EnerPlanET account uses | EnerPlanET creates the account (access level `very_low`) with the link, then runs the request |
| No link, an EnerPlanET account already uses the email | `403`; the user signs in to EnerPlanET once with RENvolveIT, where Keycloak confirms they own that account and links it |
| No link, no verified email in the token | `403`; the user signs in to EnerPlanET once |
| Linked account disabled | `403` |

Accounts are never linked by email alone. Whoever controls a RENvolveIT
account with a given email would otherwise take over the EnerPlanET account
that uses it, including its models.

Shares and workspace invites are stored by email and match the account
whenever it appears, so a manager can share a model with a member who has not
used EnerPlanET yet. EnerPlanET sends no email when a model is shared.

## Route restriction

Toolbox tokens reach only the routes in `toolboxReadRoute`
(`internal/middleware/bearer_auth.go`), and only with `GET`. Any other route
returns `403 Token does not permit this operation` before the account lookup
runs. The allow-list keeps result downloads, timeseries, user management and
every write out of reach of a partner system, even for a member whose
EnerPlanET account could do more.

Inside an allowed route the normal per-model access check applies, so a member
sees only models they own, were shared, or reach through a workspace. The
access level is capped at `intermediate`, so an `expert` account does not gain
access to every model through the toolbox.

!!! warning "Keep the allow-list and the published API in step"
    The routes in `toolboxReadRoute` must match the RENvolveIT API
    documentation (`enerplanet/openapi.yaml` in the RENvolveIT
    `api-documentation` repository). Adding a toolbox route means changing
    both, plus a test in `internal/middleware/bearer_auth_test.go`.

## Configuration

The four `KEYCLOAK_API_*` variables, the response codes and the token lifetime
limit are listed under "RENvolveIT tokens (toolbox)" in the API token guide.
Issuer, client id and alias are set together or not at all; with none set,
toolbox tokens are rejected and personal tokens and sessions work as before.

The RENvolveIT side needs no change: the toolbox sends the access token it
already receives at sign-in.
