# FedEx Auth Health Check

Manual local test:

- Method: `GET`
- Route: `/api/admin/fedex/auth/health`
- Auth: existing admin/staff Bearer token
- Expected result:
  - `ok: true`
  - `tokenType: bearer`
  - `expiresInSeconds` greater than `0`

This endpoint only validates FedEx OAuth configuration and token acquisition. It
does not expose the access token, client secret, or account number.
