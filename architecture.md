# Linkwarden Architecture Overview

Linkwarden is a self-hosted, open-source collaborative bookmark manager to collect, organize, and archive webpages.

## High-Level Architecture

The project is a monorepo managed with **Yarn workspaces**. The application is containerized and designed to run as a single "monolithic" service (in terms of deployment) that orchestrates multiple logical components.

### Core Components

1.  **Linkwarden Service (`apps/web` & `apps/worker`)**:
    *   This is the main application container.
    *   It runs two Node.js processes concurrently:
        *   **Web App (`apps/web`)**: A **Next.js** application serving the frontend UI and the API (likely tRPC/REST).
        *   **Worker (`apps/worker`)**: A background worker process responsible for asynchronous tasks, such as fetching metadata, taking screenshots, and archiving webpages.
    *   **"Monolith" Binary**: The application utilizes a Rust-based tool called `monolith` (cli) to archive webpages into a single HTML file. This binary is likely bundled into the container and invoked by the worker process.

2.  **Mobile App (`apps/mobile`)**:
    *   A mobile client (likely React Native/Expo) that connects to the Linkwarden API.

3.  **Database (`postgres`)**:
    *   **PostgreSQL** is the primary relational database.
    *   The project uses **Prisma** (`packages/prisma`) as the ORM for database interactions.

4.  **Search Engine (`meilisearch`)**:
    *   **Meilisearch** is used to provide fast, full-text search capabilities over the bookmarked content.

### Shared Packages (`packages/`)

The application logic is modularized into shared packages:
*   `packages/prisma`: Database schema and Prisma client configuration.
*   `packages/lib`: Shared utility functions and core logic.
*   `packages/router`: Likely contains API route definitions or tRPC routers.
*   `packages/filesystem`: Utilities for file handling (storage, retrieval).
*   `packages/types`: Shared TypeScript type definitions.

## Deployment

*   **Docker**: The `Dockerfile` builds a unified image. It installs dependencies, builds the Next.js app, and sets up the entrypoint to run database migrations (`yarn prisma:deploy`) followed by starting both the web and worker processes (`yarn concurrently:start`).
*   **Kubernetes**: Manifests in `k8s/base` define the deployment of the `linkwarden` deployment, `postgres` statefulset, and `meilisearch` statefulset.

## "Monolith" Note

The term "Monolith" in the context of "Monolith exiting" likely refers to the **`monolith` CLI tool** used for archiving. If this subprocess fails or crashes during an archival job, it might be reported as an exit. Alternatively, if the entire `linkwarden` container is restarting, it might be due to one of the main Node.js processes (web or worker) crashing.
