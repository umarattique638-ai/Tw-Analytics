// TailWatch Analytics — MongoDB control-plane schema v1.
// Replaces the originally planned Postgres control plane.
// NOT in the analytics hot path.
//
// Run with:
//   mongosh "$MONGODB_URI" infra/mongodb/001_control_plane.js
//
// Safe to run repeatedly: existing collections are updated with collMod and
// indexes are created idempotently.
//
// MongoDB does not provide relational foreign keys. The application layer must
// delete memberships/sites when deleting a tenant and use a transaction for
// multi-document provisioning operations. Transactions require a replica set.
//
// Tenant _id remains MongoDB ObjectId. Site _id is the numeric analytics ID
// shared with ClickHouse events.site_id. This keeps one site identifier across
// the control and analytics planes.

const database = db.getSiblingDB('tailwatch_control');

const TIMEZONE_NOTE =
  'IANA timezone name. Stored in MongoDB; query/reporting layer applies it to UTC timestamps.';

const date = { bsonType: 'date' };
const dateOrNull = { bsonType: ['date', 'null'] };
const numericId = { bsonType: ['long', 'int'] };

function ensureCollection(name, schema) {
  const options = {
    validator: { $jsonSchema: schema },
    validationLevel: 'strict',
    validationAction: 'error',
  };

  if (database.getCollectionNames().includes(name)) {
    database.runCommand({
      collMod: name,
      ...options,
    });
  } else {
    database.createCollection(name, options);
  }
}

ensureCollection('counters', {
  bsonType: 'object',
  required: ['_id', 'value'],
  properties: {
    _id: { bsonType: 'string' },
    value: { bsonType: 'long', minimum: 0 },
  },
  additionalProperties: false,
});

ensureCollection('tenants', {
  bsonType: 'object',
  required: ['_id', 'createdAt', 'status', 'plan', 'region'],
  properties: {
    _id: { bsonType: 'objectId' },
    createdAt: date,
    updatedAt: date,
    status: {
      enum: ['active', 'suspended', 'deleted'],
    },
    plan: {
      bsonType: 'string',
    },
    region: {
      enum: ['in', 'in-eu'],
    },
    billing: {
      bsonType: 'object',
      properties: {
        customerId: { bsonType: 'string' },
        subscriptionId: { bsonType: 'string' },
      },
      additionalProperties: false,
    },
    settings: {
      bsonType: 'object',
    },
  },
  additionalProperties: false,
});

ensureCollection('users', {
  bsonType: 'object',
  required: ['_id', 'email', 'emailNormalized', 'createdAt', 'status'],
  properties: {
    _id: { bsonType: 'objectId' },
    email: {
      bsonType: 'string',
      minLength: 3,
      maxLength: 320,
    },
    emailNormalized: {
      bsonType: 'string',
      minLength: 3,
      maxLength: 320,
    },
    // Stage 5 (STAGE-1 A5): display name from signup ("Good evening, Umar").
    name: {
      bsonType: 'string',
      minLength: 1,
      maxLength: 120,
    },
    passwordHash: {
      bsonType: 'string',
      maxLength: 512,
    },
    emailVerifiedAt: {
      bsonType: ['date', 'null'],
      description:
        'When the owner of the address opened the verification link. null = not verified yet (cannot log in). Missing = account made before e-mail verification existed (treated as verified).',
    },
    oauth: {
      bsonType: 'object',
    },
    createdAt: date,
    updatedAt: date,
    status: {
      enum: ['active', 'disabled', 'deleted'],
    },
  },
  additionalProperties: false,
});

ensureCollection('memberships', {
  bsonType: 'object',
  required: ['_id', 'tenantId', 'userId', 'role', 'createdAt'],
  properties: {
    _id: { bsonType: 'objectId' },
    tenantId: { bsonType: 'objectId' },
    userId: { bsonType: 'objectId' },
    role: {
      enum: ['owner', 'admin', 'viewer'],
    },
    createdAt: date,
  },
  additionalProperties: false,
});

ensureCollection('sites', {
  bsonType: 'object',
  required: [
    '_id',
    'tenantId',
    'domain',
    'timezone',
    'allowedHosts',
    'retentionDays',
    'status',
    'region',
    'keys',
    'identitySecret',
    'createdAt',
  ],
  properties: {
    // _id is the same numeric site_id stored in ClickHouse.
    _id: {
      ...numericId,
      minimum: 1,
    },

    tenantId: { bsonType: 'objectId' },

    domain: {
      bsonType: 'string',
      minLength: 1,
      maxLength: 253,
    },

    timezone: {
      bsonType: 'string',
      minLength: 1,
      maxLength: 64,
      description: TIMEZONE_NOTE,
    },

    allowedHosts: {
      bsonType: 'array',
      minItems: 1,
      items: {
        bsonType: 'string',
        maxLength: 253,
      },
    },

    // Stored per site, but no universal numeric default is frozen by Stage 1.
    retentionDays: {
      bsonType: ['int', 'long'],
      minimum: 1,
    },

    status: {
      enum: ['active', 'paused', 'deleted'],
    },

    region: {
      enum: ['in', 'in-eu'],
    },

    verifiedAt: dateOrNull,

    // Server-only secret for daily visitor salts (HMAC). Copied into the site's KV entry for the
    // collector, never sent to a browser, never returned by the public API.
    identitySecret: {
      bsonType: 'string',
      minLength: 32,
      maxLength: 128,
    },

    // Keys live inside the site document so rotation/revocation is atomic.
    // Multiple active keys are allowed during zero-downtime rotation.
    keys: {
      bsonType: 'array',
      minItems: 1,
      items: {
        bsonType: 'object',
        required: ['id', 'publicKey', 'createdAt', 'status'],
        properties: {
          id: {
            bsonType: 'string',
            maxLength: 64,
          },
          publicKey: {
            bsonType: 'string',
            pattern: '^tw_pub_[A-Za-z0-9]{32}$',
          },
          createdAt: date,
          revokedAt: dateOrNull,
          status: {
            enum: ['active', 'revoked'],
          },
        },
        additionalProperties: false,
      },
    },

    createdAt: date,
    updatedAt: date,
  },
  additionalProperties: false,
});

// Stage 5 (STAGE-1 A5): dashboard login sessions. _id = SHA-256 of the cookie token, so a database
// dump never contains a usable session. MongoDB's TTL monitor deletes expired sessions.
ensureCollection('sessions', {
  bsonType: 'object',
  required: ['_id', 'userId', 'createdAt', 'expiresAt'],
  properties: {
    _id: {
      bsonType: 'string',
      pattern: '^[0-9a-f]{64}$',
      description: "SHA-256 of the session token. The token itself is only ever in the user's cookie.",
    },
    userId: { bsonType: 'objectId' },
    createdAt: date,
    expiresAt: date,
  },
  additionalProperties: false,
});

ensureCollection('exports', {
  bsonType: 'object',
  required: ['_id', 'tenantId', 'siteId', 'range', 'from', 'to', 'timezone', 'filename', 'rows', 'bytes', 'csv', 'createdBy', 'createdAt', 'expiresAt'],
  properties: {
    _id: { bsonType: 'objectId' },
    tenantId: { bsonType: 'objectId' },
    siteId: numericId,
    range: { enum: ['today', '7d', '30d'] },
    from: { bsonType: 'string', maxLength: 40 },
    to: { bsonType: 'string', maxLength: 40 },
    timezone: { bsonType: 'string', maxLength: 64 },
    filename: { bsonType: 'string', minLength: 1, maxLength: 300 },
    rows: { bsonType: 'int', minimum: 0 },
    bytes: { bsonType: 'int', minimum: 0 },
    csv: {
      bsonType: 'string',
      maxLength: 1000000,
      description: 'The CSV as downloaded (a few KB: one row per day or hour).',
    },
    createdBy: { bsonType: 'objectId' },
    createdAt: date,
    expiresAt: {
      bsonType: 'date',
      description: 'createdAt + 90 days. A TTL index deletes the report then.',
    },
  },
  additionalProperties: false,
});

ensureCollection('password_resets', {
  bsonType: 'object',
  required: ['_id', 'userId', 'createdAt', 'expiresAt', 'usedAt'],
  properties: {
    _id: {
      bsonType: 'string',
      pattern: '^[0-9a-f]{64}$',
      description: 'SHA-256 of the reset token. The token itself is only ever in the e-mailed link.',
    },
    userId: { bsonType: 'objectId' },
    createdAt: date,
    expiresAt: {
      bsonType: 'date',
      description: 'One hour after createdAt. A TTL index deletes the document later.',
    },
    usedAt: dateOrNull,
  },
  additionalProperties: false,
});

ensureCollection('email_verifications', {
  bsonType: 'object',
  required: ['_id', 'userId', 'createdAt', 'expiresAt', 'usedAt'],
  properties: {
    _id: {
      bsonType: 'string',
      pattern: '^[0-9a-f]{64}$',
      description: 'SHA-256 of the verification token. The token itself is only ever in the e-mailed link.',
    },
    userId: { bsonType: 'objectId' },
    createdAt: date,
    expiresAt: {
      bsonType: 'date',
      description: '24 hours after createdAt. A TTL index deletes the document later.',
    },
    usedAt: dateOrNull,
  },
  additionalProperties: false,
});

ensureCollection('kv_outbox', {
  bsonType: 'object',
  required: ['_id', 'tenantId', 'error', 'attempts', 'createdAt', 'updatedAt'],
  properties: {
    _id: { ...numericId, description: 'Site id whose Cloudflare KV entries do not match MongoDB yet.' },
    tenantId: { bsonType: 'objectId' },
    error: { bsonType: 'string', maxLength: 500 },
    attempts: { bsonType: 'int', minimum: 0 },
    createdAt: date,
    updatedAt: date,
  },
  additionalProperties: false,
});

// Phase 3: the workspace activity log ("who changed what, when"). No IP address or user agent.
ensureCollection('audit_log', {
  bsonType: 'object',
  required: ['_id', 'tenantId', 'at', 'actorKind', 'actorId', 'actorName', 'action', 'siteId', 'summary', 'expiresAt'],
  properties: {
    _id: { bsonType: 'objectId' },
    tenantId: { bsonType: 'objectId' },
    at: date,
    actorKind: { enum: ['user', 'system'] },
    actorId: { bsonType: ['objectId', 'null'] },
    actorName: { bsonType: 'string', maxLength: 120 },
    action: {
      enum: [
        'account.created',
        'auth.login',
        'auth.login_failed',
        'auth.logout',
        'auth.password_reset',
        'auth.email_verified',
        'site.created',
        'site.restored',
        'site.paused',
        'site.resumed',
        'site.timezone_changed',
        'site.retention_changed',
        'site.deleted',
        'key.created',
        'key.revoked',
        'host.allowed',
        'report.created',
        'report.deleted',
        'account.exported',
        'data.pruned',
      ],
    },
    siteId: { bsonType: ['long', 'int', 'null'] },
    summary: { bsonType: 'string', minLength: 1, maxLength: 300 },
    expiresAt: {
      bsonType: 'date',
      description: 'at + 400 days. A TTL index deletes the entry then. No IP address or user agent is stored.',
    },
  },
  additionalProperties: false,
});

// Phase 3: account deletion (export-then-erase). The receipt stays after completion, without the e-mail.
const rowCount = { bsonType: ['long', 'int', 'double'], minimum: 0 };
ensureCollection('erasures', {
  bsonType: 'object',
  required: [
    '_id',
    'siteIds',
    'publicKeys',
    'email',
    'name',
    'requestedAt',
    'status',
    'kvDoneAt',
    'dataDeleteSentAt',
    'dataVerifiedAt',
    'rowsFound',
    'rowsAfterCompletion',
    'attempts',
    'lastError',
    'completedAt',
    'updatedAt',
  ],
  properties: {
    _id: { bsonType: 'objectId', description: 'Id of the deleted workspace (tenant).' },
    siteIds: { bsonType: 'array', items: { bsonType: ['long', 'int'] } },
    publicKeys: { bsonType: 'array', items: { bsonType: 'string', pattern: '^tw_pub_[A-Za-z0-9]{32}$' } },
    email: {
      bsonType: ['string', 'null'],
      maxLength: 320,
      description: "Only to send the 'erasure finished' e-mail; set to null when the erasure completes.",
    },
    name: { bsonType: ['string', 'null'], maxLength: 120 },
    requestedAt: date,
    status: { enum: ['pending', 'completed'] },
    kvDoneAt: dateOrNull,
    dataDeleteSentAt: dateOrNull,
    dataVerifiedAt: dateOrNull,
    rowsFound: {
      bsonType: ['object', 'null'],
      properties: { events: rowCount, sessions: rowCount, dropped_hits: rowCount, rollup_15m_pages: rowCount },
      additionalProperties: false,
    },
    rowsAfterCompletion: {
      ...rowCount,
      description: 'Rows that arrived after the erasure was complete (late queue retries) and were deleted by the 30-day watch.',
    },
    attempts: { bsonType: 'int', minimum: 0 },
    lastError: { bsonType: ['string', 'null'], maxLength: 500 },
    completedAt: dateOrNull,
    updatedAt: date,
  },
  additionalProperties: false,
});

database.users.createIndex(
  { emailNormalized: 1 },
  {
    unique: true,
    collation: { locale: 'en', strength: 2 },
  },
);

database.memberships.createIndex(
  { tenantId: 1, userId: 1 },
  { unique: true },
);

database.memberships.createIndex({ userId: 1, tenantId: 1 });

// No index on sites._id: MongoDB creates the _id index itself, it is always unique, and passing
// { unique: true } for it is rejected by the server.
database.sites.createIndex(
  { 'keys.publicKey': 1 },
  { unique: true },
);
database.sites.createIndex(
  { tenantId: 1, domain: 1 },
  { unique: true },
);
database.sites.createIndex({ tenantId: 1, status: 1 });
database.tenants.createIndex({ status: 1, createdAt: -1 });
database.sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
database.sessions.createIndex({ userId: 1 });
database.exports.createIndex({ tenantId: 1, siteId: 1, createdAt: -1 });
database.exports.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
database.password_resets.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
database.password_resets.createIndex({ userId: 1 });
database.email_verifications.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
database.email_verifications.createIndex({ userId: 1 });
database.kv_outbox.createIndex({ tenantId: 1 });
database.audit_log.createIndex({ tenantId: 1, at: -1, _id: -1 });
database.audit_log.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
database.erasures.createIndex({ status: 1, updatedAt: 1 });

database.counters.updateOne(
  { _id: 'site_id' },
  { $setOnInsert: { value: NumberLong(0) } },
  { upsert: true, writeConcern: { w: 'majority' } },
);

print('TailWatch MongoDB control plane v1 ready');
