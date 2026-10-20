import type { AnalyticsReader } from '../repositories/clickhouse';
import type { ApiConfig } from '../config';
import type { AnalyticsEraser } from '../repositories/eraser';
import type { Limiters } from '../http/limiter';
import type { SiteConfigSink } from '../repositories/kv';
import type { SetupStore } from '../repositories/setup-store';
import type { StatsReader } from '../repositories/stats';
import type { ControlStore } from '../repositories/control-store';
import type { TenantDoc } from '../models/tenant.model';
import type { UserDoc } from '../models/user.model';
import type { Mailer } from './mail';
import type { VerifierOptions } from './verifier';
import type { AccountService } from './account.service';
import type { AuditService } from './audit.service';
import type { AuthService } from './auth.service';
import type { HealthService } from './health.service';
import type { KeysService } from './keys.service';
import type { KvSyncService } from './kv-sync.service';
import type { ReportsService } from './reports.service';
import type { SessionService } from './session.service';
import type { SetupService } from './setup.service';
import type { SitesService } from './sites.service';
import type { StatsService } from './stats.service';

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

/** Who is asking: the signed-in user and their workspace. Services never read the HTTP request. */
export interface Actor {
  user: UserDoc;
  tenant: TenantDoc;
}

/** Everything the controllers and jobs use: the deps with their defaults filled in, plus every service. */
export interface Services {
  deps: Deps;
  store: ControlStore;
  kv: SiteConfigSink;
  config: ApiConfig;
  mailer: Mailer;
  eraser: AnalyticsEraser | null;
  now: () => Date;
  limits: Limiters;
  /** Cloudflare KV entries of a site being set up (repository). */
  setupStore: SetupStore;

  session: SessionService;
  kvSync: KvSyncService;
  audit: AuditService;
  stats: StatsService;
  /** Is each site still sending data (decision 28). */
  health: HealthService;
  sites: SitesService;
  keys: KeysService;
  reports: ReportsService;
  setup: SetupService;
  auth: AuthService;
  account: AccountService;
}
