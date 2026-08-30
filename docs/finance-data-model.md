# Finance data model

The Finance workspace is a sparse, revisioned account-history store. It preserves the exact source JSON from `auto-finance`, renders an Excel-like date-by-account view, and leaves room for a controlled admin surface without rewriting ingestion history.

## Ingestion contract

`POST /api/finance/snapshots` accepts the existing daily snapshot shape:

```json
{
  "report_date": "2026-08-29",
  "accounts": [
    {
      "institution": "Example Bank",
      "account": "Checking ••••1234",
      "type": "Cash",
      "balance": 123.45,
      "ok": true,
      "error_type": null
    }
  ]
}
```

The request body is stored verbatim in `finance_snapshots.raw_json`. Its SHA-256 hash is the idempotency key. Reposting identical bytes is a no-op; different valid bytes for an existing `report_date` create a new current revision while preserving the old snapshot.

Missing dates and missing account observations remain absent. They are never filled with zero or carried forward.

## Identity and organization

Accounts use generated UUIDs as physical primary keys. Institution plus masked last four digits is a useful lookup hint, but not a safe primary key: last four digits can be absent, reused, or changed after a card reissue. `finance_account_identifiers` therefore stores source-scoped identity hints separately from the account record. The payload also accepts an optional opaque `source_account_id`; when a future source can provide one, it takes precedence over name and last-four matching.

The main dimensions are:

- `finance_portfolios`: supports more owners or portfolios later.
- `finance_institutions`: canonical institution names.
- `finance_accounts`: stable account records, status, default category, and an optional global category override.
- `finance_account_identifiers`: institution/last-four and name-based source aliases.
- `finance_categories`: workbook-style sheets plus summary-group mapping.

## Provenance and effective values

- `finance_snapshots` stores immutable raw payloads, source references, hashes, and revision state.
- `finance_observations` stores the normalized values associated with one snapshot. Display values are rounded to cents; original precision remains in the raw JSON.
- `finance_observation_overrides` is the effective-data layer. An admin can upsert or delete one account/date value and optionally override its category without mutating source history.
- `finance_audit_log` records ingestion today and is the audit sink for future admin mutations.

The read API overlays current database overrides on the latest source revision. Override-only dates are included, which permits controlled manual insertions. A `delete` override hides an effective cell without deleting provenance.

## Future admin control plane

The intended admin API namespace is `/api/admin/finance/*`. It can support:

- account creation, rename, close, hide, merge, and identifier management;
- value insertion, correction, or deletion through effective overrides;
- global account category assignment or a date-specific category override;
- category creation and ordering;
- audit-log inspection and rollback by writing a new override.

Each admin mutation should update the effective record and append an audit event in the same D1 batch. Direct database access remains possible for break-glass administration, but the future control plane should be the normal path so actor, reason, and before/after state are always captured. Authentication can be added at the API boundary without changing the stored data model.
