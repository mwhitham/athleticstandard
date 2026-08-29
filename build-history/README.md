# Build History

This folder is the permanent record of what we decided to build and why.

## The rule

Every plan we execute gets its spec written into a versioned subfolder here **before or as** the build happens, and it is **never deleted or rewritten**. If a later build changes direction, the new plan gets a new version folder; the old one stays as-is. This folder is append-only.

## Structure

```
build-history/
  v1/
    spec.md        # the full build specification for v1
    decisions.md   # the decision log: what was chosen, what was rejected, and why
  v2/              # (future) next plan's spec and decisions
  ...
```

## Why

Specs written in chat threads and planning sessions evaporate. Six months from now, "why is there no MCP server?" or "why TypeScript?" should be answerable by reading this folder, not by archaeology. Each version's `decisions.md` records the alternatives that were considered and rejected, because the rejected options are the part everyone forgets.
