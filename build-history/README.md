# Build History

This folder is the permanent record of what we decided to build and why.

## The rule

Every plan we execute gets its spec written into a versioned subfolder here **before or as** the build happens. Within a version, all decisions go in that version's `decisions.md` — append new D-numbers, don't rewrite earlier ones. Supporting research goes in `appendix/` in the same version folder and is linked from the D-number. If a later build is a new plan, it gets a new version folder; the old one stays as-is.

## Structure

```
build-history/
  v1/
    spec.md        # the full build specification for v1
    decisions.md   # the decision log: what was chosen, what was rejected, and why
    progress.md    # what's done and what's next
    appendix/      # long-form research those decisions rest on; linked from D-numbers
  v2/              # (future) next plan's spec, decisions, and appendix
  ...
```

## Why

Specs written in chat threads and planning sessions evaporate. Six months from now, "why is there no MCP server?" or "why TypeScript?" should be answerable by reading this folder, not by archaeology. Each version's `decisions.md` records the alternatives that were considered and rejected, because the rejected options are the part everyone forgets. Each version's `appendix/` holds the long-form research those decisions rest on.
