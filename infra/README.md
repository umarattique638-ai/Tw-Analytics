# infra/

Stage 1 contract artifacts live here:

- `clickhouse/001_contract.sql` — ClickHouse events, sessions and first rollup MV.
- `mongodb/001_control_plane.js` — MongoDB control-plane collections, validators and indexes.
- `mongodb/control-plane.schema.json` — reviewable JSON Schema source for the MongoDB documents.

MongoDB is the TailWatch control plane. ClickHouse is the analytics event store. Neither control-plane
store nor ClickHouse is touched by the edge collector.

The MongoDB script assumes a replica set because Stage 5 signup/site provisioning uses transactions.
For local development, use a single-node MongoDB replica set rather than a standalone server.
