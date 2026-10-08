import type { Env } from './env.js';
import { logger } from './log.js';

const log = logger('ha');

export interface NotifyPayload {
  title: string;
  message: string;
  data?: Record<string, unknown>;
}

export class HaError extends Error {}

/** Thin client for the Home Assistant REST API (through the Supervisor proxy or HA_URL/HA_TOKEN). */
export class HaClient {
  private panelPath?: string;

  constructor(private readonly env: Env) {}

  get configured(): boolean {
    return !!(this.env.haApiUrl && this.env.haToken);
  }

  private async request(url: string, init: RequestInit = {}): Promise<unknown> {
    const res = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${this.env.haToken}`, 'Content-Type': 'application/json', ...init.headers },
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    if (!res.ok) throw new HaError(`${init.method ?? 'GET'} ${url.replace(/^https?:\/\/[^/]+/, '')} -> ${res.status} ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : undefined;
  }

  async notify(service: string, payload: NotifyPayload): Promise<void> {
    if (this.env.dryRunNotify || !this.configured) {
      log.info(`[dry-run] notify.${service}: ${payload.title} – ${payload.message}`, payload.data);
      return;
    }
    const name = service.replace(/^notify\./, '');
    await this.request(`${this.env.haApiUrl}/services/notify/${encodeURIComponent(name)}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    log.info(`Sent notify.${name}: ${payload.title} – ${payload.message}`);
  }

  async setState(entityId: string, state: string | number, attributes: Record<string, unknown>): Promise<void> {
    if (!this.configured) return;
    await this.request(`${this.env.haApiUrl}/states/${entityId}`, {
      method: 'POST',
      body: JSON.stringify({ state: String(state), attributes }),
    });
  }

  /**
   * Frontend path of the add-on's sidebar panel (e.g. `/a1b2c3d4_rezsi`). Ingress panels are
   * registered under the add-on slug, which includes the repository prefix.
   */
  async getPanelPath(): Promise<string | undefined> {
    if (this.panelPath) return this.panelPath;
    if (!this.env.supervisorUrl) return undefined;
    try {
      const info = (await this.request(`${this.env.supervisorUrl}/addons/self/info`)) as { data?: { slug?: string } };
      const slug = info?.data?.slug;
      if (slug) this.panelPath = `/${slug}`;
    } catch (err) {
      log.warn('Cannot read add-on info', err);
    }
    return this.panelPath;
  }
}
