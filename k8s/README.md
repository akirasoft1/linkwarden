# Linkwarden Kubernetes Deployment

This directory contains Kubernetes manifests for deploying Linkwarden with PostgreSQL and MeiliSearch.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    linkwarden namespace                      │
│                                                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────┐ │
│  │  Ingress    │───▶│ Linkwarden  │───▶│   PostgreSQL    │ │
│  │  (optional) │    │ Deployment  │    │   StatefulSet   │ │
│  └─────────────┘    └─────────────┘    └─────────────────┘ │
│                           │                                 │
│                           ▼                                 │
│                     ┌─────────────┐                        │
│                     │ MeiliSearch │                        │
│                     │ StatefulSet │                        │
│                     └─────────────┘                        │
│                                                             │
│  Storage:                                                   │
│  - PostgreSQL: 10Gi PVC (StatefulSet volumeClaimTemplate)  │
│  - MeiliSearch: 5Gi PVC (StatefulSet volumeClaimTemplate)  │
│  - Linkwarden: 20Gi PVC (archives/screenshots/PDFs)        │
└─────────────────────────────────────────────────────────────┘
```

## Prerequisites

- Kubernetes cluster (1.25+)
- kubectl configured with cluster access
- Storage class available for PersistentVolumeClaims
- (Optional) Ingress controller (nginx-ingress, traefik, etc.)
- (Optional) cert-manager for TLS certificates

## Quick Start

### 1. Generate Secrets

Generate secure random values for your secrets:

```bash
# Generate secrets
POSTGRES_PASSWORD=$(openssl rand -base64 32)
NEXTAUTH_SECRET=$(openssl rand -base64 32)
MEILI_MASTER_KEY=$(openssl rand -base64 32)

echo "POSTGRES_PASSWORD: $POSTGRES_PASSWORD"
echo "NEXTAUTH_SECRET: $NEXTAUTH_SECRET"
echo "MEILI_MASTER_KEY: $MEILI_MASTER_KEY"
```

### 2. Update Configuration

Edit the following files with your values:

**`base/secrets.yaml`**:
- Replace `CHANGE_ME_postgres_password` with your generated password
- Replace `CHANGE_ME_nextauth_secret` with your generated secret
- Replace `CHANGE_ME_meili_master_key` with your generated key

**`base/configmap.yaml`**:
- Update `NEXTAUTH_URL` to your actual domain (e.g., `https://linkwarden.yourdomain.com/api/v1/auth`)

**`base/ingress.yaml`** (if using ingress):
- Update `linkwarden.example.com` to your actual domain
- Adjust `ingressClassName` if not using nginx
- Configure TLS settings as needed

### 3. Deploy

```bash
# Preview the manifests
kubectl kustomize k8s/base

# Apply to cluster
kubectl apply -k k8s/base

# Or apply files individually
kubectl apply -f k8s/base/namespace.yaml
kubectl apply -f k8s/base/secrets.yaml
kubectl apply -f k8s/base/configmap.yaml
kubectl apply -f k8s/base/postgres.yaml
kubectl apply -f k8s/base/meilisearch.yaml
kubectl apply -f k8s/base/linkwarden.yaml
# kubectl apply -f k8s/base/ingress.yaml  # If using ingress
```

### 4. Verify Deployment

```bash
# Check all resources
kubectl -n linkwarden get all

# Check pods are running
kubectl -n linkwarden get pods -w

# Check PVCs are bound
kubectl -n linkwarden get pvc

# View logs
kubectl -n linkwarden logs -f deployment/linkwarden
kubectl -n linkwarden logs -f statefulset/postgres
kubectl -n linkwarden logs -f statefulset/meilisearch
```

### 5. Access Linkwarden

**With Ingress**: Navigate to your configured domain (e.g., `https://linkwarden.yourdomain.com`)

**Without Ingress** (port-forward for testing):
```bash
kubectl -n linkwarden port-forward svc/linkwarden 3000:3000
# Access at http://localhost:3000
```

## File Structure

```
k8s/
├── README.md           # This file
└── base/
    ├── kustomization.yaml  # Kustomize configuration
    ├── namespace.yaml      # Namespace definition
    ├── secrets.yaml        # Secrets (PostgreSQL, NextAuth, MeiliSearch)
    ├── configmap.yaml      # Non-sensitive configuration
    ├── postgres.yaml       # PostgreSQL StatefulSet + Service
    ├── meilisearch.yaml    # MeiliSearch StatefulSet + Service
    ├── linkwarden.yaml     # Linkwarden Deployment + Service + PVC
    └── ingress.yaml        # Ingress (optional)
```

## Best Practices Implemented

### PostgreSQL
- **StatefulSet**: Ensures stable network identity and persistent storage
- **Headless Service**: Required for StatefulSet DNS resolution
- **Health Probes**: `pg_isready` for liveness/readiness checks
- **PGDATA subdirectory**: Avoids permission issues with volume mounts
- **Resource limits**: Prevents resource exhaustion

### MeiliSearch
- **StatefulSet**: Persistent search index storage
- **Health endpoint**: Native `/health` endpoint for probes
- **Production mode**: `MEILI_ENV=production` for security

### Linkwarden
- **Init containers**: Wait for dependencies (PostgreSQL, MeiliSearch) before starting
- **Recreate strategy**: Safe for single-replica with PVC
- **Separate PVC**: Archive data persisted independently
- **Environment variable injection**: Secrets injected securely

### Security
- **Secrets**: Sensitive data stored in Kubernetes Secrets
- **ConfigMaps**: Non-sensitive configuration separated
- **Security contexts**: fsGroup set for proper file permissions
- **No root**: Containers run as non-root where possible

## Customization

### Storage Class

If you need a specific storage class, uncomment and modify the `storageClassName` in:
- `base/postgres.yaml` (volumeClaimTemplates)
- `base/meilisearch.yaml` (volumeClaimTemplates)
- `base/linkwarden.yaml` (PVC spec)

### Resource Limits

Adjust resources in each deployment/statefulset based on your usage:

```yaml
resources:
  requests:
    cpu: 250m
    memory: 512Mi
  limits:
    cpu: 1000m
    memory: 2Gi
```

### External PostgreSQL

To use an external PostgreSQL database instead of the included StatefulSet:

1. Remove or don't apply `postgres.yaml`
2. Update `configmap.yaml` to point to your external database
3. Update secrets with your external database credentials

### S3 Storage

To use S3 instead of local storage, add these to your secrets:

```yaml
# In secrets.yaml
stringData:
  SPACES_KEY: "your-access-key"
  SPACES_SECRET: "your-secret-key"
  SPACES_ENDPOINT: "https://s3.amazonaws.com"
  SPACES_BUCKET_NAME: "linkwarden-data"
  SPACES_REGION: "us-east-1"
```

And reference them in the Linkwarden deployment environment variables.

## Troubleshooting

### Pods stuck in Pending
```bash
kubectl -n linkwarden describe pod <pod-name>
# Check for PVC binding issues or resource constraints
```

### Database connection errors
```bash
# Verify PostgreSQL is running
kubectl -n linkwarden exec -it postgres-0 -- pg_isready -U linkwarden

# Check Linkwarden logs
kubectl -n linkwarden logs deployment/linkwarden
```

### MeiliSearch not responding
```bash
# Check MeiliSearch health
kubectl -n linkwarden exec -it meilisearch-0 -- curl localhost:7700/health
```

### Reset everything
```bash
# Delete all resources (WARNING: deletes data!)
kubectl delete -k k8s/base

# Delete PVCs separately if needed
kubectl -n linkwarden delete pvc --all
```

## Backup

### PostgreSQL
```bash
# Create backup
kubectl -n linkwarden exec postgres-0 -- pg_dump -U linkwarden linkwarden > backup.sql

# Restore
kubectl -n linkwarden exec -i postgres-0 -- psql -U linkwarden linkwarden < backup.sql
```

### Linkwarden Data
```bash
# Copy archive data locally
kubectl -n linkwarden cp linkwarden-<pod-id>:/data/data ./linkwarden-backup
```

## Upgrading

```bash
# Update image tag in linkwarden.yaml or use:
kubectl -n linkwarden set image deployment/linkwarden linkwarden=ghcr.io/linkwarden/linkwarden:v2.7.0

# Or reapply manifests after updating
kubectl apply -k k8s/base
```
