# Guestbook Monitoring with Prometheus and Grafana

## Overview

I extended the [Pulumi Kubernetes Guestbook example](https://github.com/pulumi/examples/tree/master/kubernetes-ts-guestbook/simple) by adding Prometheus and Grafana monitoring.

The goal was to get a better view of what is happening inside the application after it is deployed. I wanted to monitor Redis activity, check the resource usage of the frontend pods, and track container restarts from a single Grafana dashboard.

Everything is managed through Pulumi, so the application and monitoring stack can be deployed together using `pulumi up`.

### What I added

- **Prometheus and Grafana:** Deployed using the `kube-prometheus-stack` Helm chart.
- **Redis exporter:** Collects Redis metrics and exposes them in a format Prometheus can scrape.
- **ServiceMonitor:** Configures Prometheus to discover and scrape the Redis exporter.
- **Grafana dashboard:** A custom dashboard for viewing Redis metrics, frontend resource usage, and container restarts.

## How it works

The Guestbook application runs on Kubernetes with a PHP frontend, a Redis leader, and Redis replicas.

Prometheus collects metrics from different parts of the cluster. It uses Kubernetes and cAdvisor metrics to monitor pod resource usage and container health. For Redis, I added a separate exporter because Redis does not expose its statistics directly in Prometheus format.

Grafana uses these metrics to display the information in a dashboard.

```text
                       ┌────────────────────┐
                       │      Grafana       │
                       │ Guestbook Overview │
                       └─────────┬──────────┘
                                 │
                                 ▼
                       ┌────────────────────┐
                       │     Prometheus     │
                       └─────────┬──────────┘
                                 │
               ┌─────────────────┼──────────────────┐
               ▼                 ▼                  ▼
           cAdvisor      kube-state-metrics   Redis Exporter
          Pod metrics   Pod status/restarts     Port 9121
                                                    │
                                                    ▼
                                               Redis Leader
                                                Port 6379
```

## Project structure

| File | What it does |
|---|---|
| `index.ts` | Defines the Guestbook resources and brings in the monitoring components. |
| `monitoring.ts` | Creates the monitoring namespace, installs the Prometheus/Grafana Helm chart, and exports the Grafana access details. |
| `redis-metrics.ts` | Deploys the Redis exporter, its Service, and the ServiceMonitor. |
| `dashboard.ts` | Creates the Grafana dashboard ConfigMap. |

## Prerequisites

Before deploying the project, make sure you have:

- [Pulumi CLI](https://www.pulumi.com/docs/install/)
- Node.js 18 or later and npm
- `kubectl` configured to access your Kubernetes cluster
- A Kubernetes cluster with enough resources to run the application and monitoring stack

I tested the setup with Minikube configured with 2 CPUs and 4 GB of memory.

## Deploy the project

Clone the repository and move into the project directory.

Install the dependencies:

```bash
npm install
```

Create a Pulumi stack:

```bash
pulumi stack init dev
```

Tell the project whether it is running on Minikube (`true`) or a cloud Kubernetes cluster (`false`):

```bash
pulumi config set isMinikube true
```

Set a password for Grafana:

```bash
pulumi config set --secret grafanaPassword 'your-strong-password'
```

Deploy everything:

```bash
pulumi up
```

Review the proposed changes and confirm the deployment. The first deployment takes a few minutes while Kubernetes downloads the required images and starts the workloads.

## Access Grafana

Once the deployment finishes, check the stack outputs:

```bash
pulumi stack output
```

The project exports three outputs:

| Output | Value |
|---|---|
| `grafanaUser` | `admin` |
| `grafanaPassword` | The password set in the `grafanaPassword` config. Stored as a Pulumi secret and shown as `[secret]`. |
| `grafanaUrl` | On a cloud cluster: the LoadBalancer address. On Minikube: the port-forward command to open Grafana. |

To show the password:

```bash
pulumi stack output grafanaPassword --show-secrets
```

### On Minikube

On Minikube, the Grafana Service is created as a `NodePort`. Forward it to your local machine:

```bash
kubectl port-forward -n monitoring svc/monitoring-grafana 3000:80
```

Open [http://localhost:3000](http://localhost:3000) and log in with username `admin` and the password configured earlier.

### On a cloud cluster

On a cloud cluster (`isMinikube` set to `false`), the Grafana Service is created as a `LoadBalancer`, and the `grafanaUrl` output shows its external address.

## Check that Prometheus is collecting metrics

I used the Prometheus UI to check that the Redis exporter was being discovered and that the metrics were available.

Start port forwarding:

```bash
kubectl port-forward -n monitoring svc/monitoring-kube-prometheus-prometheus 9090:9090
```

Open [http://localhost:9090](http://localhost:9090).

Go to **Status → Targets** and check that the Redis exporter target is `UP`. It appears as:

`serviceMonitor/default/redis-exporter/0`

### Queries to try

| PromQL query | What it tells you |
|---|---|
| `redis_up` | Whether the exporter can reach Redis. A value of `1` indicates success. |
| `rate(redis_commands_processed_total[1m])` | The rate of Redis commands processed over the last minute. |
| `sum by (pod) (container_memory_working_set_bytes{namespace="default", pod=~"frontend.*", container!=""})` | Memory usage for the frontend containers, grouped by pod. |

To generate some activity, forward the frontend Service:

```bash
kubectl port-forward svc/frontend 8080:80
```

Open [http://localhost:8080](http://localhost:8080) and submit a few Guestbook messages.

Return to Prometheus and run the Redis command-rate query again. The rate goes up within a minute as the application generates Redis activity.

## Grafana dashboard

The project includes a dashboard called **Guestbook Overview**.

It brings together the main metrics I wanted to check while testing the application:

- **Redis:** Availability, commands processed per second, connected clients, and memory usage.
- **Frontend:** CPU, memory, and network traffic for each frontend pod.
- **Container health:** Container restarts in the Guestbook namespace.

The dashboard is defined in `dashboard.ts` and deployed as a ConfigMap labeled `grafana_dashboard: "1"`. Grafana's sidecar discovers dashboard ConfigMaps with this label and loads the dashboard automatically.

## A few implementation details

### Why use a Redis exporter?

The Guestbook application uses Redis for its backend data. The Redis exporter collects Redis statistics and exposes them through a Prometheus-compatible `/metrics` endpoint.

I deployed it separately from the original Guestbook resources to keep the monitoring changes isolated from the application itself.

### How is the frontend monitored?

The standard PHP frontend does not provide a Prometheus `/metrics` endpoint out of the box.

Instead, I use Kubernetes and cAdvisor metrics to monitor frontend pod resource usage, including CPU, memory, and network traffic. Network traffic is useful for observing activity, but it is not the same as an actual HTTP request count.

If request rates, response times, and application errors were required, I would add application instrumentation or use ingress, web-server, or service-mesh metrics.

### How does Prometheus discover the Redis exporter?

The Redis exporter has a Kubernetes Service, and a ServiceMonitor tells Prometheus to scrape any Service labeled `app: redis-exporter` on its `metrics` port every 15 seconds.

The Prometheus chart is configured with `serviceMonitorSelectorNilUsesHelmValues: false`, so Prometheus picks up ServiceMonitors that don't carry the Helm release label.

### Resource usage

Since I wanted to run this on a local development cluster, I disabled several components that were not necessary for this exercise, including Alertmanager, node-exporter, and the control-plane scrapers (etcd, scheduler, controller-manager, kube-proxy).

Prometheus retention is set to six hours, with a 1 GiB memory limit.

For a production environment, I would enable alerting and node monitoring, configure persistent storage, and add alerts for application availability, resource pressure, and relevant service-level indicators.

### Handling secrets

The Grafana password is set through Pulumi's secret configuration:

```bash
pulumi config set --secret grafanaPassword 'your-strong-password'
```

This keeps the value encrypted in Pulumi's stack configuration instead of storing the plaintext password in the source code.

## Screenshots

The `docs/screenshots/` directory contains screenshots captured during deployment and testing.

| Screenshot | What it shows |
|---|---|
| `stack-outputs.png` | Pulumi deployment outputs |
| `prometheus-targets.png` | Prometheus target discovery and scrape status |
| `prometheus-redis-query.png` | Redis command-rate query |
| `grafana-guestbook-dashboard.png` | Guestbook Overview dashboard |

## Screenshots

### 1. Guestbook application
![Guestbook app](docs/screenshots/01-guestbook-app.png)

### 2. Pulumi stack outputs
![Stack outputs](docs/screenshots/02-stack-outputs.png)

### 3. All pods running
![Pods](docs/screenshots/03-kubectl-pods.png)

### 4. Prometheus: redis-exporter target UP
![Prometheus targets](docs/screenshots/04-prometheus-targets.png)

### 5. Prometheus: redis_up query
![redis_up](docs/screenshots/05-prometheus-redis-up.png)

### 6. Prometheus: Redis command rate
![Redis command rate](docs/screenshots/06-prometheus-redis-query.png)

### 7. Grafana: Prometheus data source
![Grafana data sources](docs/screenshots/07-grafana-datasources.png)

### 8. Grafana: Guestbook Overview dashboard
![Guestbook dashboard](docs/screenshots/08-grafana-guestbook-dashboard.png)

## Clean up

When you are finished testing, remove the deployed resources:

```bash
pulumi destroy
```

After the resources have been removed, delete the stack if you no longer need it:

```bash
pulumi stack rm dev
```

## What I learned

This project gave me a practical way to bring monitoring into a Kubernetes deployment managed with Pulumi. It also helped me understand how Prometheus discovers scrape targets, how exporters make application metrics available, and how Grafana can turn those metrics into a useful operational dashboard.

The next step would be to add alert rules and application-level metrics so that the monitoring covers not only infrastructure health, but also the Guestbook application's actual performance.