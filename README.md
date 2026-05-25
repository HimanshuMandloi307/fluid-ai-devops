# Fluid AI — DevOps Engineer Assignment
**Stack:** Node.js + Redis | **Cluster:** Kind (local) | **CI/CD:** GitHub Actions | **Reliability:** Readiness/Liveness Probes

---

## Architecture

```
GitHub Push
    │
    ▼
GitHub Actions CI/CD
    ├── Build Docker Image (multi-stage)
    ├── Push to DockerHub
    └── kubectl apply → Kind Cluster
                            │
                    ┌───────┴────────┐
                    │                │
              fluid-app (x2)     redis (x1)
              NodePort:30080    ClusterIP:6379
                    │                │
                    └──── visits ────┘
```

---

## Quick Start (Local with Kind)

### 1. Prerequisites
```bash
# Install Kind
curl -Lo ./kind https://kind.sigs.k8s.io/dl/v0.22.0/kind-linux-amd64
chmod +x ./kind && sudo mv ./kind /usr/local/bin/kind

# Install kubectl
curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
chmod +x kubectl && sudo mv kubectl /usr/local/bin/
```

### 2. Create Kind Cluster
```bash
kind create cluster --name fluid-demo
kubectl cluster-info --context kind-fluid-demo
```

### 3. Build and Load Docker Image
```bash
# Build the image
docker build -t fluid-ai-devops:latest .

# Load into Kind (no registry needed locally)
kind load docker-image fluid-ai-devops:latest --name fluid-demo
```

### 4. Deploy to Kubernetes
```bash
# Update image name in deployment.yaml first
sed -i 's|YOUR_DOCKERHUB_USERNAME/fluid-ai-devops:latest|fluid-ai-devops:latest|g' k8s/deployment.yaml

kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/redis-deployment.yaml
kubectl apply -f k8s/deployment.yaml

# Watch rollout
kubectl rollout status deployment/fluid-app
```

### 5. Access the App
```bash
# Port forward to access locally
kubectl port-forward svc/fluid-app-service 8080:80

# Test endpoints
curl http://localhost:8080/          # visit counter
curl http://localhost:8080/healthz   # liveness
curl http://localhost:8080/ready     # readiness
curl http://localhost:8080/info      # app info
```

---

## Reliability Feature: Readiness + Liveness Probes

### Why I chose this
In production, pods can start but not be ready (Redis not yet connected). Without probes, Kubernetes sends traffic to a pod that returns 500 errors. Probes solve this cleanly.

### What problem it solves
- **Liveness probe** (`/healthz`): Detects stuck/deadlocked processes and restarts them automatically
- **Readiness probe** (`/ready`): Only adds pod to load balancer AFTER Redis connection is confirmed

### Tradeoff introduced
- During Redis restarts, pods go into `NotReady` state — traffic drops to remaining healthy pods
- If `initialDelaySeconds` is too low, pods get killed before app finishes starting (restart loop)
- Setting: `initialDelaySeconds: 15` is conservative but safe for this app

---

## Intentional Failure Simulation

### Failure: Wrong Redis hostname via bad ConfigMap

**Step 1 — Inject the failure**
```bash
kubectl patch configmap app-config \
  --patch '{"data": {"REDIS_HOST": "wrong-redis-host"}}'

# Force pods to pick up new env vars
kubectl rollout restart deployment/fluid-app
```

**Step 2 — Observe the failure**
```bash
# Watch pods — readiness probe will fail
kubectl get pods -w

# Check logs
kubectl logs -l app=fluid-app --tail=20

# Describe pod — look at Events section
kubectl describe pod -l app=fluid-app
```

**Expected output:**
```
NAME                         READY   STATUS    RESTARTS
fluid-app-xxx                0/1     Running   0        ← NotReady!
```
```
# In logs:
Redis error: getaddrinfo ENOTFOUND wrong-redis-host
```
```
# In describe:
Readiness probe failed: HTTP probe failed with statuscode: 503
```

**Step 3 — Debug reasoning**
1. Pods running but `0/1` READY → readiness probe failing
2. `/ready` returns 503 → Redis not connected
3. Logs show `ENOTFOUND wrong-redis-host` → DNS resolution failure
4. Root cause: wrong `REDIS_HOST` in ConfigMap

**Step 4 — Fix it**
```bash
kubectl patch configmap app-config \
  --patch '{"data": {"REDIS_HOST": "redis-service"}}'

kubectl rollout restart deployment/fluid-app
kubectl rollout status deployment/fluid-app

# Verify recovery
curl http://localhost:8080/ready
# {"status":"ready","redis":"connected"}
```

---

## CI/CD Pipeline

GitHub Actions workflow (`.github/workflows/ci-cd.yml`):
1. **On push to main** → build Docker image with SHA tag
2. **Push to DockerHub** with `sha-<7chars>` + `latest` tags
3. **Deploy** → `sed` replaces image tag → `kubectl apply` → `rollout status`

### Secrets needed in GitHub
| Secret | Value |
|--------|-------|
| `DOCKERHUB_USERNAME` | Your DockerHub username |
| `DOCKERHUB_TOKEN` | DockerHub access token |
| `KUBECONFIG` | `base64 -w0 ~/.kube/config` |

---

## Tradeoff Discussion

| What I simplified | What would break at scale | Production fix |
|-------------------|--------------------------|----------------|
| Single Redis instance | No persistence, single point of failure | Redis Sentinel or Cluster with PVC |
| NodePort service | Not production-grade, manual port mgmt | Ingress Controller (NGINX/ALB) |
| Secrets in ConfigMap | `REDIS_HOST` is fine, but passwords shouldn't be here | Kubernetes Secrets or Vault |
| No HPA | Fixed 2 replicas won't handle traffic spikes | HPA based on CPU/RPS metrics |
| Kind cluster | Not HA, no node autoscaling | EKS/GKE with multi-AZ node groups |

---

## Commands Cheatsheet

```bash
# Check everything
kubectl get pods,svc,configmap

# Logs
kubectl logs -l app=fluid-app -f

# Exec into pod
kubectl exec -it deploy/fluid-app -- sh

# Rollback
kubectl rollout undo deployment/fluid-app

# Delete cluster
kind delete cluster --name fluid-demo
```
# deployment test
