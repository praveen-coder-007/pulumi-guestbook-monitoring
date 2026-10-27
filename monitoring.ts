import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

const config = new pulumi.Config();
const isMinikube = config.getBoolean("isMinikube");

export const grafanaUser = "admin";
export const grafanaPassword = config.requireSecret("grafanaPassword");

const monitoringNs = new k8s.core.v1.Namespace("monitoring", {
    metadata: { name: "monitoring" },
});

// kube-prometheus-stack: Prometheus, Grafana, operator, kube-state-metrics
export const promStack = new k8s.helm.v3.Release("monitoring", {
    name: "monitoring",
    namespace: monitoringNs.metadata.name,
    chart: "kube-prometheus-stack",
    repositoryOpts: { repo: "https://prometheus-community.github.io/helm-charts" },
    timeout: 600,
    values: {
        // not needed for this setup / not reachable on minikube
        alertmanager: { enabled: false },
        nodeExporter: { enabled: false },
        kubeEtcd: { enabled: false },
        kubeControllerManager: { enabled: false },
        kubeScheduler: { enabled: false },
        kubeProxy: { enabled: false },

        prometheus: {
            prometheusSpec: {
                retention: "6h",
                // pick up ServiceMonitors from any namespace/release
                serviceMonitorSelectorNilUsesHelmValues: false,
                podMonitorSelectorNilUsesHelmValues: false,
                resources: {
                    requests: { cpu: "100m", memory: "400Mi" },
                    limits: { memory: "1Gi" },
                },
            },
        },

        grafana: {
            adminUser: grafanaUser,
            adminPassword: grafanaPassword,
            service: { type: isMinikube ? "NodePort" : "LoadBalancer" },
        },
    },
});

const grafanaSvc = k8s.core.v1.Service.get(
    "grafana-svc",
    pulumi.interpolate`${promStack.status.namespace}/${promStack.status.name}-grafana`,
);

export const grafanaUrl = isMinikube
    ? pulumi.interpolate`kubectl port-forward -n monitoring svc/${promStack.status.name}-grafana 3000:80 -> http://localhost:3000`
    : grafanaSvc.status.loadBalancer.ingress[0].apply(i => `http://${i.ip ?? i.hostname}`);