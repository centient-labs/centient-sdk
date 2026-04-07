---
"@centient/sdk": patch
---

Fix camelCase field mapping for ADR-018 compliance. Stop remapping `contentRef` → `content_ref` and `coherenceMode` → `coherence_mode` in crystal create/update, and `nodeType` → `node_type` / `graphExpansion` → `graph_expansion` in crystal create/search JSON bodies. The server now accepts camelCase for all JSON body fields per ADR-018.
