function renderHealthModal(data) {
  const content = document.getElementById('healthContent');

  const counts = data && typeof data === 'object' ? data.counts_stream : null;
  const swarm = data && typeof data === 'object' ? data.swarm_ws : null;

  const countsByReason = counts && counts.runs_by_reason && typeof counts.runs_by_reason === 'object'
    ? Object.entries(counts.runs_by_reason)
        .sort((a, b) => (Number(b[1]) || 0) - (Number(a[1]) || 0))
        .slice(0, 8)
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n')
    : null;

  const swarmByEndpoint = swarm && swarm.by_endpoint && typeof swarm.by_endpoint === 'object'
    ? Object.entries(swarm.by_endpoint)
        .sort((a, b) => (Number(b?.[1]?.updates_last_60s) || 0) - (Number(a?.[1]?.updates_last_60s) || 0))
        .slice(0, 8)
        .map(([k, v]) => `${k}: ${v?.active_subscriptions || 0} subs, ${v?.updates_last_60s || 0}/60s`)
        .join('\n')
    : null;

  const swarmByTag = swarm && swarm.by_tag && typeof swarm.by_tag === 'object'
    ? Object.entries(swarm.by_tag)
        .sort((a, b) => (Number(b?.[1]?.updates_last_60s) || 0) - (Number(a?.[1]?.updates_last_60s) || 0))
        .slice(0, 10)
        .map(([k, v]) => `${k}: ${v?.active_subscriptions || 0} subs, ${v?.updates_last_60s || 0}/60s`)
        .join('\n')
    : null;

  content.innerHTML = `
    <div class="health-grid">
      <div class="health-card">
        <div class="health-title">Status</div>
        <div class="health-value green">${data.status || 'Unknown'}</div>
      </div>
      <div class="health-card">
        <div class="health-title">Uptime</div>
        <div class="health-value blue">${formatUptime(data.uptime)}</div>
      </div>
      <div class="health-card">
        <div class="health-title">Cache Hits</div>
        <div class="health-value green">${data.cache?.hits || 0}</div>
      </div>
      <div class="health-card">
        <div class="health-title">Cache Misses</div>
        <div class="health-value orange">${data.cache?.misses || 0}</div>
      </div>
      <div class="health-card">
        <div class="health-title">Avg Response</div>
        <div class="health-value blue">${data.responseTime?.avg || 0}ms</div>
      </div>
      <div class="health-card">
        <div class="health-title">P95 Response</div>
        <div class="health-value orange">${data.responseTime?.p95 || 0}ms</div>
      </div>
      <div class="health-card full-width">
        <div class="health-title">Slow Requests (>5s)</div>
        <div class="health-value ${data.responseTime?.slowRequests > 0 ? 'red' : 'green'}">
          ${data.responseTime?.slowRequests || 0}
        </div>
      </div>

      <div class="health-card">
        <div class="health-title">Counts Fetches (60s)</div>
        <div class="health-value blue">${counts?.runs_last_60s ?? '-'}</div>
        <div class="health-sub">${counts?.last_reason ? `last: ${counts.last_reason}` : ''}</div>
      </div>

      <div class="health-card">
        <div class="health-title">Swarm Subs</div>
        <div class="health-value ${swarm?.connected ? 'green' : 'red'}">${swarm?.active_subscriptions ?? '-'}</div>
        <div class="health-sub">${typeof swarm?.updates_last_60s_total === 'number' ? `${swarm.updates_last_60s_total}/60s` : ''}</div>
      </div>

      <div class="health-card full-width">
        <div class="health-title">Counts Runs By Reason (top)</div>
        <pre class="health-pre">${countsByReason || '-'}</pre>
      </div>

      <div class="health-card full-width">
        <div class="health-title">Swarm Subscriptions By Endpoint (top)</div>
        <pre class="health-pre">${swarmByEndpoint || '-'}</pre>
      </div>

      <div class="health-card full-width">
        <div class="health-title">Swarm Subscriptions By Tag (top)</div>
        <pre class="health-pre">${swarmByTag || '-'}</pre>
      </div>
    </div>
  `;
}
