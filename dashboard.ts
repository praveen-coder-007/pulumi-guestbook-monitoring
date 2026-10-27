import * as k8s from "@pulumi/kubernetes";
import { promStack } from "./monitoring";

const ns = `namespace="default"`;
const frontend = `${ns}, pod=~"frontend.*", container!=""`;

// Small helper so each panel is one line below
let nextId = 1;
function panel(title: string, expr: string, unit: string, x: number, y: number, type = "timeseries") {
    return {
        id: nextId++,
        type,
        title,
        gridPos: { x, y, w: 12, h: 8 },
        fieldConfig: { defaults: { unit }, overrides: [] },
        targets: [{ refId: "A", expr, legendFormat: "{{pod}}" }],
    };
}

const dashboard = {
    title: "Guestbook Overview",
    uid: "guestbook-overview",
    timezone: "browser",
    refresh: "30s",
    time: { from: "now-1h", to: "now" },
    schemaVersion: 39,
    panels: [
        // Backend (Redis)
        panel("Redis up", `redis_up`, "none", 0, 0, "stat"),
        panel("Redis commands / sec", `rate(redis_commands_processed_total[1m])`, "ops", 12, 0),
        panel("Redis connected clients", `redis_connected_clients`, "short", 0, 8),
        panel("Redis memory used", `redis_memory_used_bytes`, "bytes", 12, 8),

        // Frontend
        panel("Frontend CPU (cores)",
            `sum by (pod) (rate(container_cpu_usage_seconds_total{${frontend}}[2m]))`, "short", 0, 16),
        panel("Frontend memory",
            `sum by (pod) (container_memory_working_set_bytes{${frontend}})`, "bytes", 12, 16),
        panel("Frontend network in",
            `sum by (pod) (rate(container_network_receive_bytes_total{${ns}, pod=~"frontend.*"}[2m]))`, "Bps", 0, 24),

        // Health
        panel("Pod restarts",
            `sum by (pod) (kube_pod_container_status_restarts_total{${ns}})`, "short", 12, 24),
    ],
};

// Grafana's sidecar picks up ConfigMaps with this label and loads them as dashboards
new k8s.core.v1.ConfigMap("guestbook-dashboard", {
    metadata: {
        name: "guestbook-dashboard",
        namespace: "monitoring",
        labels: { grafana_dashboard: "1" },
    },
    data: { "guestbook-overview.json": JSON.stringify(dashboard) },
}, { dependsOn: promStack });