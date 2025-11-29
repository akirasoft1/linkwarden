# Investigation Report: Linkwarden "Monolith" Exits

## Incident Summary
**Timeframe:** November 26, 2025, 18:00 - 22:00
**Cluster:** ak-harvester-baremetal (KUBERNETES_CLUSTER-FD82ABFF5B584C36)
**Namespace:** linkwarden

## Findings

### 1. The "Monolith"
The term "Monolith" refers to the **`monolith` CLI tool** (a Rust-based binary) included in the Linkwarden Docker image. It is used by the `worker` process to archive web pages into single HTML files. It is **not** a separate microservice, but a subprocess spawned by the main application.

### 2. Root Cause Indication: Memory Pressure
Dynatrace detected a **`RESOURCE_CONTENTION_EVENT` (Memory usage close to limits)** starting at **18:21** on Nov 26th.
*   **Event:** "Memory usage close to limits"
*   **Impact:** The container was operating near its memory limit (99% threshold).
*   **Consequence:** This typically leads to Kubernetes **OOMKilled** (Out Of Memory) restarts. When the kernel kills the process to save memory, it often happens abruptly without the application being able to log a stack trace, which explains the lack of "Error" logs in the application output.

### 3. Application Behavior
*   **Browser Rotation:** Logs show a consistent message: `[1] Restarting main browser (30-minute rotation)...` occurring exactly every 30 minutes (18:14, 18:44, 19:14, etc.). This is a mechanism to prevent memory leaks in the headless browser used for screenshots.
*   **Correlation:** The memory contention event started (18:21) shortly after a browser rotation (18:14). If `monolith` (archiving) and the `headless_shell` (screenshots) run simultaneously, they can spike memory usage significantly, pushing the pod over its limit.

## Recommendations
1.  **Increase Memory Limits:** The immediate fix is to increase the memory limit for the `linkwarden` pod in the Kubernetes deployment manifest.
2.  **Concurrency Control:** Check if Linkwarden has settings to limit the number of concurrent archival/screenshot jobs.
3.  **Observability:** Ensure `loglevel` is set to `info` or `debug` to capture subprocess exit codes if they occur before an OOM kill.
