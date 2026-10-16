import type { AnalyticsReader } from '../models/clickhouse';
import type { ApiConfig } from '../config';
import type { AnalyticsEraser } from '../models/eraser';
import type { Limiters } from '../http/limiter';
import type { SiteConfigSink } from '../models/kv';
import type { Mailer } from './mail';
import type { StatsReader } from '../models/stats';
import type { ControlStore } from '../models/types';
import type { VerifierOptions } from './verifier';
import type { AuditLog } from './audit';
import type { ReportsService } from './reports';
import type { SessionService } from './session';
import type { SiteService } from './sites';
import type { KvSyncService } from './kv-sync';
import type { SetupService } from './setup';
import type { HealthService } from './health';

/** What createApp needs from the outside world (real services in production, fakes in tests). */
export interface Deps {
  store: ControlStore;
  kv: SiteConfigSink;
  analytics: AnalyticsReader;
  /** Query API (Stage 6). Null when ClickHouse is not configured for the API. */
  stats?: StatsReader | null;
  config: ApiConfig;
  /** Outgoing e-mail (password reset). Missing: reset by e-mail is "not set up". */
  mailer?: Mailer;
  /** Deletes ClickHouse rows (retention, account erasure). Null when TW_CH_PRUNE_PASSWORD is not set. */
  eraser?: AnalyticsEraser | null;
  now?: () => Date;
  verifier?: VerifierOptions;
}

/** Everything a route needs: the deps with their defaults filled in, plus the shared services. */
export interface Services {
  deps: Deps;
  store: ControlStore;
  kv: SiteConfigSink;
  config: ApiConfig;
  mailer: Mailer;
  eraser: AnalyticsEraser | null;
  now: () => Date;
  limits: Limiters;
  session: SessionService;
  sites: SiteService;
  kvSync: KvSyncService;
  setup: SetupService;
  audit: AuditLog;
  reports: ReportsService;
  /** Is each site still sending data (decision 28). */
  health: HealthService;
}
