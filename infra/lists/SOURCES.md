# Bot, spam and datacentre lists — sources and licences

These files are **data**, vendored verbatim from upstream and pinned to a commit (`sources.json` has the
commit and sha256 of every file). `infra/tools/lists.mjs generate` turns them into TypeScript modules;
`update` fetches the newest upstream versions and prints the diff for review first (PLAN Workstream C).

| File | Upstream | Licence | Used by |
|---|---|---|---|
| `matomo-bots.yml` | [matomo-org/device-detector](https://github.com/matomo-org/device-detector) `regexes/bots.yml` | **LGPL-3.0-or-later** (`LICENSE.device-detector.txt`) | consumer: full 843-regex pass |
| `matomo-referrer-spam.txt` | [matomo-org/referrer-spam-list](https://github.com/matomo-org/referrer-spam-list) `spammers.txt` | Public domain (no copyright) | consumer: referrer spam |
| `bad-asn-list.csv` | [brianhama/bad-asn-list](https://github.com/brianhama/bad-asn-list) | MIT (`LICENSE.bad-asn-list.txt`) | collector edge: datacentre ASN set |
| `asn-overrides.json` | ours | — | never-drop ASNs (real people) + missing clouds |

## LGPL note for bots.yml

The bots list is used unmodified, as a separate data file, by our own server-side consumer, which runs
on our infrastructure and is not distributed. The generated module (`apps/consumer/src/precision/lists/bots.generated.ts`)
is a mechanical re-encoding of that file and carries the same licence. If the consumer is ever
distributed (self-hosted edition), ship `matomo-bots.yml`, its licence and the generator with it, so the
list can be replaced — that is what the LGPL asks for. Do not hand-edit the generated file; add our own
patterns in `apps/consumer/src/precision/bots.ts` instead.
