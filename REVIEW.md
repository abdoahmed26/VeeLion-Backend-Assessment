# Backend code review

## Scope and status

This review covers the supplied Express backend: Tasks API, Activity API, Reports API, validation, and JSON storage.

The findings below describe the original supplied code. Implementation outcomes and actual verification are recorded at the end of this file. High priority means a correctness or data-integrity issue; medium means meaningful performance or maintenance work; low means cleanup. JSON-file storage and existing response shapes are preserved; deliberate validation/report changes are documented.

## Strengths to preserve

- Features have separate routes, controllers, and services.
- Task routes use an async error wrapper, and errors are handled centrally.
- Task lookup/update/delete report missing records with 404 responses.
- Task IDs use the shared UUID helper, and records include creation/update timestamps.
- Task JSON access uses asynchronous filesystem operations.
- The Reports module already has its route, controller, and service, and reads both files concurrently.
- `taskValidator.js` already contains useful object-shape checks, allowed-field checks, and normalization that can be integrated.

## Security and validation

### BE-01: PATCH can overwrite fields controlled by the server — High

**Location:** `src/modules/tasks/controllers/tasks.controller.js`, `src/modules/tasks/services/tasks.service.js`, `src/modules/tasks/utils/taskValidator.js`.

**What is wrong:** The controller validates recognized fields but leaves unknown fields in the payload. The service spreads the full payload over the existing record. The validator that rejects unknown fields is not used.

**Why it matters:** A request containing a valid `completed` value alongside an arbitrary `id` or `createdAt` can overwrite those fields, breaking record identity or history.

**Suggested improvement:** Validate and normalize the request through an explicit allowlist and apply only supported fields. Integrate the existing validator after reconciling its rules with the intended contract. Verify unsupported fields cannot alter records.

### BE-02: Activity input is not validated — High

**Location:** `src/modules/activity/controllers/activity.controller.js`, `src/modules/activity/services/activity.service.js`.

**What is wrong:** Requests are passed directly into record creation. `action` and `info` can contain values other than strings, and arrays are not explicitly rejected as request bodies.

**Why it matters:** Stored records can violate the frontend's assumptions: its search calls string methods and rendering expects renderable text.

**Suggested improvement:** Validate a non-null object, permit only supported fields, and enforce string types when optional fields are present. Preserve optional-field behavior unless deliberately changing the contract. Document any length limits and return consistent 400 errors.

## Bugs and data integrity

### BE-03: Concurrent task mutations can lose data — High

**Location:** `src/modules/tasks/services/tasks.service.js`, `src/utils/jsonStore.js`.

**What is wrong:** Each mutation independently reads the file, modifies its own array, and writes the whole file. There is no coordination around the complete read-modify-write operation.

**Why it matters:** Two requests can read the same snapshot, then overwrite each other's changes even when they modify different tasks. Overlapping direct writes also threaten file integrity.

**Suggested improvement:** Serialize the entire mutation per file, not just the final write. Keep the queue usable after a failed operation. A process-local queue supports one Node process only; document that assumption or provide coordination if multiple processes are supported.

### BE-04: Direct file writes and permissive reads can conceal or worsen corruption — High

**Location:** `src/utils/jsonStore.js`, `src/modules/activity/services/activity.service.js`.

**What is wrong:** Writes replace the destination directly. `readJsonArray` silently converts non-array JSON into an empty list, and both storage implementations accept empty content as an empty dataset. The Activity loader does not verify an array at all.

**Why it matters:** An interrupted write can leave invalid or truncated data. Treating damaged content as empty can make a later mutation overwrite existing information. Activity creation can fail unexpectedly on a non-array file.

**Suggested improvement:** Share a storage utility with explicit file-shape validation and clear errors. Write through a unique temporary file and replace the destination, with cleanup and platform-aware error handling. Coordinate this with BE-03: atomic replacement alone does not prevent lost updates. Distinguish intentional initialization from corrupt existing data.

### BE-05: Data paths depend on the launch directory — Medium

**Location:** Tasks, Activity, and Reports service files.

**What is wrong:** All data paths are built from `process.cwd()`. Missing-file initialization assumes the parent directory already exists.

**Why it matters:** Starting the server from the repository root instead of `backend/` can address a different path or fail. Test setup also becomes unnecessarily dependent on the launch directory.

**Suggested improvement:** Resolve a shared data directory relative to the application, allow a documented test/configuration override, and initialize its directory safely when appropriate.

### BE-06: Activity IDs can collide — Medium

**Location:** `src/modules/activity/services/activity.service.js`.

**What is wrong:** IDs use `String(Date.now())`, which does not guarantee uniqueness for entries created in the same millisecond.

**Why it matters:** Duplicate identifiers make entries ambiguous and can produce duplicate React list keys.

**Suggested improvement:** Reuse the existing UUID helper for newly created entries while retaining existing stored IDs.

## Performance, maintainability, and code quality

### BE-07: Activity storage blocks request processing and duplicates logic — Medium

**Location:** `src/modules/activity/services/activity.service.js`, Activity controller and routes.

**What is wrong:** File reads/writes use synchronous methods. `loadDataA` and `loadDataB` duplicate the same behavior, while names such as `fp`, `b`, `one`, `x`, and `c` obscure intent.

**Why it matters:** Disk work blocks other requests in the same process, and duplicated storage behavior can diverge.

**Suggested improvement:** Use the shared asynchronous store with coordinated mutations, descriptive names, and consistent controller/service boundaries. When handlers become async, apply the existing error wrapper so rejections reach the central handler.

### BE-08: Task validation is duplicated and inconsistent — Medium

**Location:** Task controller, service, and validator files.

**What is wrong:** Validation is spread across three implementations, one unused. Creation accepts a one-character title, while updating a title requires at least two characters. Controllers trim and modify the request body directly.

**Why it matters:** Behavior is harder to explain and maintain, and a title accepted at creation can be rejected during an update.

**Suggested improvement:** Define the intended title rules, normalize into a new payload, and use a shared validation boundary. Document any intentional create/update distinction rather than accidentally changing behavior while wiring in the unused validator.

### BE-09: API response conventions differ — Low

**Location:** Task, Activity, and Reports controllers.

**What is wrong:** Tasks use `{ data: ... }`, while Activity and Reports return raw arrays/objects.

**Why it matters:** Clients must understand multiple conventions. This is a maintenance cost, not a reason to break existing consumers.

**Suggested improvement:** Document and preserve existing shapes during this assessment. If standardization is chosen later, coordinate or version that contract change.

## Implementation outcomes

Follow-up improvements (September 22): stored tasks and activity now have record-level validation on reads and before/after mutation callbacks. Missing/invalid fields, non-boolean completion, invalid dates, and duplicate IDs reject the operation without rewriting the files. Reports fail with a controlled error when stored records are malformed; valid future activity remains excluded from the recent count. Optional activity fields and deleted-task history remain supported. Task lists use creation time descending, then ID ascending for ties.

All 16 backend tests pass, including malformed-record reads/writes, unchanged datasets on validation failure, invalid mutation output, deterministic task ordering, three-state transitions, report counts, status validation, and legacy-record compatibility. The existing single-process storage limitations still apply.

Three-state status extension: task creation and updates accept pending, in-progress, and completed. Responses include canonical status and a consistent completed compatibility flag. Legacy completed-only requests remain supported; conflicting fields return 400. Existing stored records without status are normalized on read without rewriting them, then gain status on their next meaningful update. Reports count the actual status, and activity records status transitions and combined title/status updates.

| Finding | Status | Result |
| --- | --- | --- |
| BE-01 | Resolved | Services use the existing allowlist validators; only normalized fields are applied. |
| BE-02 | Resolved | Activity shape/field/type validation accepts optional strings and rejects unsupported fields. |
| BE-03 | Resolved for one process | A shared queue coordinates reads and complete mutations across task/activity files and recovers after failures. |
| BE-04 | Resolved within stated storage limits | Temporary-file replacement, explicit corrupt/non-array-file errors, no silent reset, and temporary-file cleanup. |
| BE-05 | Resolved | Central application-relative paths, optional DATA_DIRECTORY, and directory creation on writes. |
| BE-06 | Resolved | New activity IDs use the existing UUID helper. |
| BE-07 | Resolved | Activity uses the asynchronous shared store, descriptive names, and async error wrappers. |
| BE-08 | Resolved | One validation boundary per service; normalized copies; trimmed non-empty titles for create and update. |
| BE-09 | Retained for compatibility | Task responses stay wrapped; Activity and Reports stay raw. API documentation states the differences. |
