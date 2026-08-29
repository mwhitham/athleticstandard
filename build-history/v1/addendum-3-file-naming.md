# v1 Addendum 3 — File naming (2026-08-29)

## D23. Short extension for files, full name for identity surfaces

The athlete file extension is **`.ath.json`** (default filename `athlete.ath.json`), not `.athleticstandard.json`. Rationale: filenames are typed and read constantly — ergonomics win; the extension matches the `ath` CLI command; precedent is `typescript` → `.ts`. Collision risk of `*.ath.json` is negligible.

The full `athleticstandard` name remains on identity surfaces where unambiguity matters more than brevity: the npm package, the schema filename and `$id` URL (`athleticstandard.ai`), and the `athleticstandard_version` field inside the file (the format's self-identification marker).

Supersedes the `.athleticstandard.json` extension used in `spec.md` §2 and Addendum 1 (D16).
