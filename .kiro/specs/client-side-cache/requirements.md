# Requirements Document

## Introduction

This feature adds a client-side stale-while-revalidate (SWR) cache to the Peblo Notes frontend. When a user navigates to a page they have previously visited (Dashboard, Workspace note list, individual notes, Shared Note), the Cache_Manager immediately serves the previously stored response data so the UI renders without any loading spinner or skeleton state. Simultaneously, the Cache_Manager fetches fresh data from the server in the background and updates the UI once the response arrives. This eliminates perceived latency on return visits while keeping data eventually consistent.

The cache is scoped to the authenticated session: it is cleared on logout and is never shared across different user accounts. The implementation lives entirely in the React frontend (`client/src/`) and requires no server-side changes.

---

## Glossary

- **Cache_Manager**: The client-side module responsible for storing, retrieving, invalidating, and revalidating cached API responses.
- **Cache_Entry**: A single record in the Cache_Manager consisting of a cache key, the stored response data, and the timestamp at which it was stored.
- **Cache_Key**: A string that uniquely identifies a cacheable request, derived from the API endpoint path and any query parameters.
- **Stale Data**: A Cache_Entry whose age exceeds the configured TTL but has not yet been replaced by a fresh response.
- **TTL (Time-To-Live)**: The duration in milliseconds after which a Cache_Entry is considered stale and eligible for background revalidation.
- **Revalidation**: The process of fetching fresh data from the server while stale data is already displayed in the UI.
- **Background Fetch**: A network request initiated after stale data has been served to the UI, without blocking rendering.
- **useDataWithCache**: A React hook that wraps a data-fetching function with Cache_Manager logic, exposing `data`, `isRevalidating`, and `error` to consumers.
- **Cache_Invalidation**: The act of removing one or more Cache_Entries so that the next request fetches fresh data unconditionally.
- **Session**: The period from a successful login until an explicit logout or token expiry.

---

## Requirements

### Requirement 1: Cache Storage and Retrieval

**User Story:** As a user, I want previously loaded page data to be stored locally, so that returning to a page I have already visited shows content immediately without a loading state.

#### Acceptance Criteria

1. THE Cache_Manager SHALL store API response data in an in-memory map keyed by Cache_Key.
2. WHEN a cacheable API request is made and a Cache_Entry exists for the corresponding Cache_Key, THE Cache_Manager SHALL return the stored data synchronously to the caller before any network request is initiated.
3. WHEN a cacheable API request is made and a Cache_Entry exists for the corresponding Cache_Key and the entry's age exceeds the configured TTL, THE Cache_Manager SHALL initiate a Background Fetch for that Cache_Key after returning the stored data.
4. WHEN a cacheable API request is made and no Cache_Entry exists for the corresponding Cache_Key, THE Cache_Manager SHALL perform a network request and, on success, store the response as a new Cache_Entry.
5. IF a network request on a cache miss fails, THEN THE Cache_Manager SHALL NOT create a Cache_Entry for that Cache_Key and SHALL propagate the error to the caller.
6. WHEN a network request completes successfully for a Cache_Key that already has a Cache_Entry, THE Cache_Manager SHALL overwrite the existing Cache_Entry with the fresh response data.
7. THE Cache_Manager SHALL record the timestamp of each Cache_Entry at the time the response is stored.
8. THE Cache_Manager SHALL derive the Cache_Key from the API endpoint path and all query parameters, such that requests with different query parameters produce distinct Cache_Keys.
9. THE Cache_Manager SHALL cache responses only from the specified cacheable endpoints defined in Requirement 8.

---

### Requirement 2: Stale-While-Revalidate Behavior

**User Story:** As a user, I want the app to silently refresh data in the background after showing me cached content, so that I always see up-to-date information without waiting for a network round-trip.

#### Acceptance Criteria

1. WHEN a Cache_Entry is returned to the UI and the entry's age exceeds the configured TTL, THE Cache_Manager SHALL initiate a Background Fetch for the same Cache_Key without blocking the UI render.
2. WHEN a Background Fetch completes successfully, THE Cache_Manager SHALL update the Cache_Entry with the fresh response data and notify all active subscribers so the UI re-renders with the new data.
3. IF a Background Fetch returns an error, THEN THE Cache_Manager SHALL NOT update the Cache_Entry, SHALL retain the existing stale data in the UI, and SHALL expose the error through the error state of the consuming hook.
4. WHILE a Background Fetch is in progress for a given Cache_Key, THE Cache_Manager SHALL expose a revalidating indicator set to active to the consuming hook.
5. WHEN a Background Fetch completes (successfully or with an error), THE Cache_Manager SHALL clear the revalidating indicator for the corresponding Cache_Key.
6. WHEN a Background Fetch is already in progress for a Cache_Key and a new revalidation is triggered for the same Cache_Key, THE Cache_Manager SHALL NOT initiate a second concurrent Background Fetch for that Cache_Key.
7. THE Cache_Manager SHALL use a default TTL of 60 000 milliseconds (60 seconds) unless overridden per Cache_Key at the call site.

---

### Requirement 3: No Loading State on Cache Hit

**User Story:** As a user, I want to see content instantly when I navigate back to a page I have already visited, so that I never encounter a loading spinner or skeleton screen on return visits.

#### Acceptance Criteria

1. WHEN a user navigates to a route whose data is present in the Cache_Manager, THE useDataWithCache hook SHALL set `data` to the cached value and `loading` to `false` on the initial render, before any network request completes.
2. WHEN no Cache_Entry exists for the route, THE useDataWithCache hook SHALL set `loading` to `true` until the network request completes and data is available.
3. IF a Cache_Entry exists for the dashboard insights Cache_Key, THEN THE DashboardPage SHALL render its stats, heatmap, AI insights, top tags, recent AI activity, and writing streak sections with `loading` set to `false` on initial render.
4. IF a Cache_Entry exists for the notes list Cache_Key, THEN THE WorkspacePage SHALL render the notes list sidebar with `loading` set to `false` on initial render.
5. IF a Cache_Entry exists for a specific note's Cache_Key, THEN THE WorkspacePage SHALL populate the editor with the cached note content with `loading` set to `false` on initial render.
6. IF a Cache_Entry exists for the shared note's Cache_Key, THEN THE SharedNotePage SHALL render the shared note content with `loading` set to `false` on initial render.

---

### Requirement 4: Cache Invalidation on Mutation

**User Story:** As a user, I want the cache to reflect my changes immediately after I create, update, delete, or archive a note, so that stale data is never shown after a write operation.

#### Acceptance Criteria

1. WHEN a note creation request completes successfully, THE Cache_Manager SHALL invalidate all Cache_Entries whose Cache_Keys have a prefix matching the notes list endpoint path.
2. WHEN a note update request completes successfully, THE Cache_Manager SHALL invalidate the Cache_Entry for that note's individual Cache_Key and all Cache_Entries whose Cache_Keys have a prefix matching the notes list endpoint path.
3. WHEN a note deletion request completes successfully, THE Cache_Manager SHALL invalidate the Cache_Entry for that note's individual Cache_Key and all Cache_Entries whose Cache_Keys have a prefix matching the notes list endpoint path.
4. WHEN a note archive request completes successfully, THE Cache_Manager SHALL invalidate the Cache_Entry for that note's individual Cache_Key and all Cache_Entries whose Cache_Keys have a prefix matching the notes list endpoint path.
5. WHEN a note creation, update, deletion, or archive request completes successfully, THE Cache_Manager SHALL invalidate the Cache_Entry for the dashboard insights Cache_Key.
6. IF a mutation request fails, THEN THE Cache_Manager SHALL NOT invalidate any Cache_Entries.
7. WHEN a Cache_Entry is invalidated, THE Cache_Manager SHALL remove it from the in-memory map synchronously within the same operation so that the next request for that Cache_Key performs a full network fetch.

---

### Requirement 5: Session-Scoped Cache Lifecycle

**User Story:** As a user, I want the cache to be cleared when I log out, so that my data is not accessible to the next person who uses the same browser session.

#### Acceptance Criteria

1. WHEN a user logs out, THE Cache_Manager SHALL clear all Cache_Entries from the in-memory map.
2. WHEN the application receives a 401 authentication failure response from the server, THE Cache_Manager SHALL clear all Cache_Entries from the in-memory map.
3. THE Cache_Manager SHALL NOT persist Cache_Entries to `localStorage`.
4. THE Cache_Manager SHALL NOT persist Cache_Entries to `sessionStorage`; all cached data SHALL reside only in memory.
5. WHEN a new Session begins (successful login), THE Cache_Manager SHALL contain zero Cache_Entries.

---

### Requirement 6: Cache Key Consistency

**User Story:** As a developer, I want cache keys to be generated deterministically from request parameters, so that the same logical request always hits the same cache entry regardless of parameter ordering.

#### Acceptance Criteria

1. THE Cache_Manager SHALL generate Cache_Keys by concatenating the endpoint path, a `?` separator (when query parameters are present), and a canonicalized query string formed by sorting parameter names alphabetically and joining them as `key=value` pairs with `&`. IF the canonicalization algorithm encounters an error, THEN THE Cache_Manager SHALL throw an error and produce no Cache_Key.
2. WHEN two requests target the same endpoint with the same query parameters in different orders, THE Cache_Manager SHALL resolve both requests to the same Cache_Key.
3. THE Cache_Manager SHALL treat requests with no query parameters, an empty query object, a null query value, and an undefined query value as equivalent, producing the same Cache_Key (the endpoint path with no `?` suffix).
4. THE Cache_Manager SHALL produce the same Cache_Key for a given endpoint path and query parameter set on every invocation, regardless of JavaScript runtime state.
5. WHEN a query parameter key appears more than once in a request, THE Cache_Manager SHALL sort all occurrences of that key's values alphabetically and include each as a separate `key=value` pair in the canonicalized query string.

---

### Requirement 7: Concurrent Request Deduplication

**User Story:** As a developer, I want simultaneous requests for the same cache key to share a single in-flight network request, so that the app does not issue redundant API calls when multiple components mount at the same time.

#### Acceptance Criteria

1. WHEN two or more components request data for the same Cache_Key simultaneously and no Cache_Entry exists, THE Cache_Manager SHALL issue exactly one network request, store the response as a Cache_Entry, and deliver the response to all waiting subscribers; the in-flight record SHALL be removed after all subscribers are notified.
2. WHEN a Background Fetch is already in progress for a Cache_Key and another component requests the same Cache_Key, THE Cache_Manager SHALL attach the new subscriber to the existing in-flight request so that the new subscriber receives the same response data when the shared request completes.
3. IF the single in-flight request fails, THEN THE Cache_Manager SHALL propagate the error to all subscribers that were waiting on that request and SHALL remove the in-flight record so that future requests for that Cache_Key can initiate a new network request.
4. WHEN a request arrives for a Cache_Key whose in-flight request has already completed and a Cache_Entry now exists, THE Cache_Manager SHALL serve the data from the Cache_Entry rather than creating a new deduplication record.

---

### Requirement 8: Cache Scope and Applicability

**User Story:** As a developer, I want the cache to apply only to read (GET) API endpoints that are safe to cache, so that write operations and authentication endpoints are never inadvertently cached.

#### Acceptance Criteria

1. THE Cache_Manager SHALL cache responses only for HTTP GET requests; all non-GET requests SHALL be passed through to the network without any cache interaction.
2. THE Cache_Manager SHALL cache responses only from the following endpoints: `/dashboard/insights`, `/notes` (with any query parameters), `/notes/:id`, and `/shared/:shareId`; requests to any other endpoint SHALL be passed through to the network without cache interaction.
3. THE Cache_Manager SHALL NOT cache responses for authentication endpoints (`/auth/*`), AI generation endpoints (`/notes/:id/ai/*`, `/ai/chat`), or any HTTP POST, PATCH, or DELETE request; such requests SHALL be passed through to the network and their responses SHALL NOT be stored.
4. WHERE a new cacheable endpoint is added to the application, THE Cache_Manager SHALL support opt-in caching by accepting the endpoint pattern as a string in a configuration array; IF the provided pattern is not a non-empty string, THEN THE Cache_Manager SHALL throw an error and reject the registration.
