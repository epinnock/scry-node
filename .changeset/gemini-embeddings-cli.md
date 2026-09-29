---
"@scrymore/scry-deployer": minor
---

`upload-images --local` can embed with Gemini Embedding 2: pass `--gemini-api-key` (or `GEMINI_API_KEY`) and a g2 collection (`--collection` / `--milvus-collection`, or `MILVUS_COLLECTION_G2`). Rows are 1024-dim and carry `embed_model`. A Gemini run refuses to write to a non-g2 collection. `--jina-api-key` / `JINA_API_KEY` still work and print a deprecation warning.
