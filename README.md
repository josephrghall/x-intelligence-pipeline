# X Intelligence (MVP)

MIT-licensed, self-hosted official X API collector. Uses the established open-source twitter-api-v2 client, SQLite and GitHub public metadata APIs. Collects recent topic-based posts, extracts GitHub projects, ranks by keyword relevance and generates a Markdown shortlist.

## Status
- Offline demo: available (no X charges)
- Live collection: needs your X developer account, app-only bearer token and prepaid credits
- Schedule: deliberately not activated until first manual X request succeeds
- Bookmarks and personal For You feed: not in MVP
- AI reasoning/cross-project evaluation: to be added after proof of intake (current ranking is deterministic heuristic triage).

## Activate
1. Visit https://console.x.com and create an app with public recent-search access.
2. Set an X Developer Console billing-cycle spending limit of $5 and disable auto-recharge unless wanted.
3. Set X_BEARER_TOKEN in /opt/x-intelligence/.env (mode 600) using .env.example as template. Do not send token in chat or Git.
4. From /opt/x-intelligence: npm install; npm test; npm run demo; npm run status.
5. When authorized, npm run collect. Then review output/latest.md.
6. Only after a successful first collection, enable a daily scheduled run.

The app starts with a conservative local ceiling of 800 public posts per UTC month (estimated $4 at today's $0.005 per post). This is only a secondary guard: billable events, server errors and billing month boundaries may differ. The X Developer Console spending cap is authoritative.

Private post data is in data/ and output/, which are Git-ignored. Do not redistribute X content or publish private bookmarks; review X's developer policy and deletion requirements before production or sharing data.

Sources: https://docs.x.com/x-api/getting-started/pricing and https://docs.x.com/x-api/posts/search/introduction
