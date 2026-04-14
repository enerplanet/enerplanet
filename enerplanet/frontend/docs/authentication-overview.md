# Authentication Overview

This document provides an overview of the authentication logic used in the EnerPlanET frontend.

## Architecture

The authentication system is built using the following key components:

- **@spatialhub/auth**: External library providing login/register forms
- **Zustand**: State management for authentication data
- **React Router**: Route protection via middleware
- **Axios**: HTTP client with custom auth handling

## Key Files

| File                                                                               | Purpose                                      |
| ---------------------------------------------------------------------------------- | -------------------------------------------- |
| [`src/store/auth-store.ts`](src/store/auth-store.ts:1)                             | Zustand store for auth state (user, session) |
| [`src/providers/auth-provider.tsx`](src/providers/auth-provider.tsx:1)             | React Context provider for auth data         |
| [`src/features/authentication/index.tsx`](src/features/authentication/index.tsx:1) | Wrapper components for login/register forms  |
| [`src/middleware/middleware.tsx`](src/middleware/middleware.tsx:1)                 | Route protection middleware                  |
| [`src/middleware/authorized.tsx`](src/middleware/authorized.tsx:1)                 | Access level authorization component         |
| [`src/configuration/auth.ts`](src/configuration/auth.ts:1)                         | Access level configuration                   |
| [`src/utils/auth-utils.ts`](src/utils/auth-utils.ts:1)                             | Utility functions for auth                   |
| [`src/services/authService.ts`](src/services/authService.ts:1)                     | Session management service                   |

## Authentication Flow

### 1. Login

1. User submits credentials via [`LoginForm`](src/features/authentication/index.tsx:31)
2. Login form sends POST request to `/login` endpoint with `credentials: 'include'`
3. Backend returns `session_id` (stored in browser cookies) and user data
4. `onAuthInit` callback stores:
   - `user`: User object from the backend
   - `token`: `null` (session_id is stored in cookies, not JWT token)
   - `sessionTimeout`: Session expiration time in minutes
5. State is persisted to `localStorage` under key `auth-storage`
6. After successful login, user is redirected to the home page (`/`)

### 2. Session Management

#### Session Cookies

- `session_id` is stored in browser cookies (not localStorage)
- Cookies are automatically sent with every request via `credentials: 'include'` in axios
- Backend validates session_id on each request

#### Session Keep-Alive

[`src/services/authService.ts`](src/services/authService.ts:3) provides a `keepSessionAlive()` function that:

- Calls `/auth/keep-alive` endpoint to refresh session_id and extend session lifetime
- Used to prevent session expiration during active use

#### Session Expiry Detection

- [`useAuthStore`](src/store/auth-store.ts:21) tracks `isSessionExpired` flag
- When session expires, `isSessionExpired` flag is set to `true`
- User is redirected to login page

### 3. Logout

1. User clicks logout button
2. [`logout()`](src/store/auth-store.ts:40) function sends POST request to `/logout`
3. Backend responds with success/failure status
4. Local state is reset:
   - `user` → `null`
   - `token` → `null`
   - `sessionTimeout` → `null`
   - `isSessionExpired` → `false`
5. All stored states are cleared from `localStorage`
6. Session cookies are cleared

### 4. Cross-Tab Synchronization

[`AuthProvider`](src/providers/auth-provider.tsx:31) implements cross-tab auth sync:

- Listens for `storage` events when another tab logs in/out
- If another tab logs out (`auth-storage` becomes `null`), current tab logs out
- If another tab logs in, current tab rehydrates its state

## Route Protection

### Middleware Pattern

[`Middleware`](src/middleware/middleware.tsx:16) component protects routes based on authentication status:

```tsx
<Route element={<Middleware type="auth" />}>
  <Route path="/app/map" element={<MapComponent />} />
</Route>
```

#### Middleware Logic

1. **Loading State**: Shows spinner while checking auth status
2. **Guest Routes**: If `type="guest"` and user is authenticated, redirect to `/app/map`
3. **Auth Routes**: If `type="auth"` and user is not authenticated, redirect to `/login`
4. **Access Control**: If `access` prop is set, redirect to `/unauthorized` if user's `access_level` is not in the allowed list

### Authorized Component

[`Authorized`](src/middleware/authorized.tsx:11) component renders children only if:

- User is authenticated
- User's `access_level` matches the required access level(s)

Access levels defined in [`src/configuration/auth.ts`](src/configuration/auth.ts:2):

- `very_low`
- `intermediate`
- `expert`

## CSRF Protection

[`ensureCSRFToken()`](src/utils/csrf.ts:1) ensures a valid CSRF token is present before API requests:

- Called via `onEnsureCSRF` callback in [`LoginForm`](src/features/authentication/index.tsx:57)
- Token is stored in `localStorage`
- Used by [`axios`](src/lib/axios.ts:6) for protected requests

## Session Timer

[`useSessionTimer`](src/hooks/useSessionTimer.ts:1) hook:

- Monitors session timeout from auth store
- Calls `keepSessionAlive()` before session expires
- Triggers logout when session is expired

> **Note:** The `useSessionTimer` hook is referenced in the documentation but does not exist in the codebase. The session expiry detection is handled directly in [`useAuthStore`](src/store/auth-store.ts:21).

## Data Flow

```
┌──────────────────────────────────────────────────────────────────────┐
│                    USER ACTION (Login/Logout)                        │
└──────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│              Login Form (POST /login with credentials: include)      │
│              (Handles form submission & session creation)            │
└──────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│              useAuthStore (Zustand)                                 │
│              (Stores user, sessionTimeout, isSessionExpired)        │
└──────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│              AuthProvider (React Context)                            │
│              (Provides auth data to app)                             │
└──────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│              Middleware (Route Protection)                           │
│              (Checks auth status before rendering)                   │
└──────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│              Axios (HTTP Client)                                    │
│              (Uses session_id cookie for API requests)              │
└──────────────────────────────────────────────────────────────────────┘
```

## Security Considerations

1. **Session-Based Auth**: Uses session_id cookies for authentication
2. **CSRF Protection**: CSRF tokens required for all API requests
3. **Session Management**: Session kept alive via `/auth/keep-alive` endpoint
4. **Access Control**: Role-based access levels (`very_low`, `intermediate`, `expert`)
5. **Cross-Site Sync**: Auth state synchronized across browser tabs
6. **Privacy Policy**: Cookies and local storage used only for authentication

## Key Constants

- **Storage Key**: `auth-storage`
- **API Base**: `/api` (configurable via [`config.api.baseUrl`](src/configuration/app.ts))
- **Access Levels**: `["very_low", "intermediate", "expert"]`
- **Logout Endpoint**: `/logout`
- **Keep-Alive Endpoint**: `/auth/keep-alive`

## Security Analysis: Session-Based Authentication

### How Session-Based Auth Works

- `session_id` stored in browser cookies (not localStorage)
- Backend generates random session ID on login
- Session ID sent automatically with requests via `credentials: 'include'` in axios
- Backend validates session ID on each request

### Security Comparison

| Aspect              | Session-Based Auth                     | JWT                                       |
| ------------------- | -------------------------------------- | ----------------------------------------- |
| Storage             | Cookies (server-controlled)            | localStorage (client-controlled)          |
| Exposure Risk       | Lower (can be HttpOnly/Secure)         | Higher (visible in console)               |
| Session Termination | Server controls (immediate revocation) | Client controls (must clear localStorage) |
| CSRF Protection     | Required (tokens needed)               | Not required                              |
| Session Hijacking   | Requires cookie theft + CSRF bypass    | Requires token theft                      |

### Keycloak Integration

**Keycloak** handles identity management (user registration, password handling, OAuth2/OIDC), while **session-based auth** handles login session management.

1. **Server-Side Session Control**: Server controls session lifecycle
2. **HttpOnly Cookies**: Can prevent JavaScript access
3. **CSRF Protection**: Required for all API requests
4. **Session Revocation**: Server can invalidate sessions immediately
5. **No Client-Side Secrets**: Session ID not stored in localStorage

### Applied Security Best Practices

- CSRF tokens required for all API requests
- 60-minute session TTL (configurable)
- Session kept alive via `/auth/keep-alive` endpoint
- Server-side session invalidation on logout

**Conclusion**: The current session-based authentication is secure when combined with HttpOnly/Secure cookies, CSRF token protection, and server-side session management.
