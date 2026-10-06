# Stage 1 Contract

Stage 1 freezes the wire and validation contract used by the collector and
consumer.

The contract is intentionally append-only. Once a wire field or semantic is
used by a deployed tracker, removing or silently changing it is a breaking
change.

## Wire version

The current wire version is:

```text
v = 1