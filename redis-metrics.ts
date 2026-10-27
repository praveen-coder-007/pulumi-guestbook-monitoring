import * as k8s from "@pulumi/kubernetes";
import { promStack } from "./monitoring";

const exporterLabels = { app: "redis-exporter" };

// Exporter: reads stats from redis-leader and exposes them on :9121/metrics
const redisExporter = new k8s.apps.v1.Deployment("redis-exporter", {
    metadata: { name: "redis-exporter", labels: exporterLabels },
    spec: {
        replicas: 1,
        selector: { matchLabels: exporterLabels },
        template: {
            metadata: { labels: exporterLabels },
            spec: {
                containers: [{
                    name: "redis-exporter",
                    image: "oliver006/redis_exporter:latest",
                    env: [{ name: "REDIS_ADDR", value: "redis://redis-leader:6379" }],
                    ports: [{ name: "metrics", containerPort: 9121 }],
                    resources: {
                        requests: { cpu: "10m", memory: "32Mi" },
                        limits: { memory: "64Mi" },
                    },
                }],
            },
        },
    },
});

const redisExporterSvc = new k8s.core.v1.Service("redis-exporter", {
    metadata: { name: "redis-exporter", labels: exporterLabels },
    spec: {
        selector: exporterLabels,
        ports: [{ name: "metrics", port: 9121, targetPort: "metrics" }],
    },
});

// Tells Prometheus to scrape the exporter Service every 15s
new k8s.apiextensions.CustomResource("redis-servicemonitor", {
    apiVersion: "monitoring.coreos.com/v1",
    kind: "ServiceMonitor",
    metadata: { name: "redis-exporter", namespace: "default", labels: exporterLabels },
    spec: {
        selector: { matchLabels: exporterLabels },
        endpoints: [{ port: "metrics", interval: "15s" }],
    },
}, { dependsOn: [promStack, redisExporterSvc] });