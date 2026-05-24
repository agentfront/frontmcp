// observability/prometheus/index.ts
// Zero-dep Prometheus text-exposition serializer (issue #397).

export { PROMETHEUS_CONTENT_TYPE, renderJsonExposition, renderPrometheusExposition } from './render';
export type { GaugeSnapshotEntry, RenderOptions } from './render';
