export interface Env {
  SWARM_HUB: DurableObjectNamespace;
  LIVE_TRACKER: DurableObjectNamespace;
  HEALTH_METRICS: DurableObjectNamespace;

  SWARM_WS_URL?: string;
  SWARM_PARTNER_ID?: string;

  LIVE_TRACKER_WS_URL?: string;
  LIVE_TRACKER_PARTNER_ID?: string;
  LIVE_TRACKER_SITE_REF?: string;
}
