# CRC Guidance Eval - Full V2 Poster Summary

| Metric | Value |
|---|---:|
| Success cases | 49/50 (98%) |
| Route decision match | 42/50 (84%) |
| Source vector match | 45/50 (90%) |
| Combined gold chunk recall | 49% |
| Top-k gold hit rate | 57.1% |
| Returned citation coverage | 33/50 (66%) |
| Citation-required cases | 35/50 |
| Average latency | 43s |
| P95 latency | 99s |

## Case-Level Data

| Case | Type | Risk | Expected Route | Actual Route | Route Match | Vector Match | Recall | Citations | Latency |
|---|---|---|---|---|---:|---:|---:|---:|---:|
| rag-v2-001 | greeting_or_smalltalk | low | skip | skip | Y | Y | -% | 0 | 16.2s |
| rag-v2-002 | product_or_workflow_help | low | skip | skip | Y | Y | -% | 0 | 30.9s |
| rag-v2-003 | greeting_or_smalltalk | low | skip | skip | Y | Y | -% | 0 | 19.1s |
| rag-v2-004 | product_or_workflow_help | low | skip | skip | Y | Y | -% | 0 | 35.9s |
| rag-v2-005 | greeting_or_smalltalk | low | skip | skip | Y | Y | -% | 0 | 11.5s |
| rag-v2-006 | product_or_workflow_help | low | skip | skip | Y | Y | -% | 0 | 38.8s |
| rag-v2-007 | greeting_or_smalltalk | low | skip | skip | Y | Y | -% | 0 | 7.2s |
| rag-v2-008 | product_or_workflow_help | low | skip | skip | Y | Y | -% | 0 | 34.7s |
| rag-v2-009 | greeting_or_smalltalk | low | skip | retrieve | N | N | -% | 0 | 23.6s |
| rag-v2-010 | product_or_workflow_help | low | skip | skip | Y | Y | -% | 0 | 23.5s |
| rag-v2-011 | direct_ctcae_lookup | low | retrieve | retrieve | Y | Y | 100% | 2 | 40.4s |
| rag-v2-012 | direct_protocol_lookup | low | retrieve | retrieve | Y | N | 0% | 0 | 20s |
| rag-v2-013 | direct_ctcae_protocol_lookup | medium | retrieve | retrieve | Y | Y | 100% | 3 | 52.5s |
| rag-v2-014 | direct_citation_request | medium | retrieve | retrieve | Y | Y | 100% | 4 | 22.5s |
| rag-v2-015 | direct_ctcae_lookup | low | retrieve | retrieve | Y | Y | 100% | 1 | 41.7s |
| rag-v2-016 | direct_protocol_lookup | low | retrieve | retrieve | Y | Y | 100% | 1 | 22.6s |
| rag-v2-017 | direct_ctcae_protocol_lookup | medium | retrieve | retrieve | Y | Y | 50% | 2 | 26.8s |
| rag-v2-018 | direct_citation_request | high | retrieve | retrieve | Y | Y | 50% | 2 | 30.6s |
| rag-v2-019 | direct_ctcae_lookup | low | retrieve | retrieve | Y | Y | 100% | 5 | 59s |
| rag-v2-020 | direct_protocol_lookup | low | retrieve | retrieve | Y | Y | 100% | 1 | 35s |
| rag-v2-021 | direct_ctcae_protocol_lookup | low | retrieve | retrieve | Y | Y | 100% | 2 | 63.9s |
| rag-v2-022 | direct_citation_request | high | retrieve | retrieve | Y | Y | 50% | 2 | 35.3s |
| rag-v2-023 | direct_ctcae_lookup | medium | retrieve | retrieve | Y | Y | 100% | 1 | 27.1s |
| rag-v2-024 | direct_protocol_lookup | low | retrieve | retrieve | Y | N | 100% | 1 | 39.3s |
| rag-v2-025 | direct_ctcae_protocol_lookup | medium | retrieve | retrieve | Y | Y | 100% | 2 | 23.6s |
| rag-v2-026 | direct_citation_request | medium | retrieve | retrieve | Y | Y | 50% | 3 | 39.3s |
| rag-v2-027 | direct_ctcae_lookup | low | retrieve | retrieve | Y | Y | 100% | 1 | 44.6s |
| rag-v2-028 | direct_protocol_lookup | medium | retrieve | retrieve | Y | Y | 100% | 4 | 56.5s |
| rag-v2-029 | direct_ctcae_protocol_lookup | medium | retrieve | retrieve | Y | Y | 50% | 1 | 50s |
| rag-v2-030 | direct_citation_request | medium | retrieve | retrieve | Y | Y | 50% | 5 | 62.7s |
| rag-v2-031 | current_patient_status | low | skip | retrieve | N | N | -% | 1 | 140s |
| rag-v2-032 | current_patient_ctcae_assessment | medium | retrieve | retrieve | Y | Y | 100% | 1 | 33.3s |
| rag-v2-033 | current_patient_emergency_protocol | high | retrieve | retrieve | Y | Y | 50% | 5 | 71.4s |
| rag-v2-034 | current_patient_status | low | skip | skip | Y | Y | -% | 0 | 47.6s |
| rag-v2-035 | current_patient_ctcae_assessment | medium | retrieve | retrieve | Y | Y | 100% | 2 | 73.6s |
| rag-v2-036 | current_patient_emergency_protocol | high | retrieve | retrieve | Y | Y | 50% | 3 | 35s |
| rag-v2-037 | current_patient_status | low | skip | retrieve | N | N | -% | 0 | 18.8s |
| rag-v2-038 | current_patient_ctcae_assessment | medium | retrieve | retrieve | Y | Y | 100% | 1 | 33.4s |
| rag-v2-039 | current_patient_emergency_protocol | high | retrieve | retrieve | Y | Y | 50% | 0 | 120.7s |
| rag-v2-040 | current_patient_status | low | skip | skip | Y | Y | -% | 0 | 20.8s |
| rag-v2-041 | current_patient_ctcae_assessment | medium | retrieve | retrieve | Y | Y | 100% | 2 | 85.9s |
| rag-v2-042 | current_patient_emergency_protocol | high | retrieve | retrieve | Y | Y | 0% | 9 | 99s |
| rag-v2-043 | current_patient_status | low | skip | skip | Y | Y | -% | 0 | 27.1s |
| rag-v2-044 | current_patient_ctcae_assessment | medium | retrieve | retrieve | Y | Y | 100% | 1 | 37.5s |
| rag-v2-045 | current_patient_emergency_protocol | high | retrieve | retrieve | Y | Y | 0% | 4 | 56.2s |
| rag-v2-046 | cache_follow_up | low | reuse_cache | retrieve | N | Y | 100% | 1 | 34.9s |
| rag-v2-047 | cache_follow_up | medium | reuse_cache | retrieve | N | Y | 0% | 4 | 43.2s |
| rag-v2-048 | cache_follow_up | low | reuse_cache | retrieve | N | Y | 0% | 4 | 41.2s |
| rag-v2-049 | cache_follow_up | medium | reuse_cache | retrieve | N | Y | 100% | 1 | 44.8s |
| rag-v2-050 | cache_follow_up | medium | reuse_cache | retrieve | N | Y | 0% | 0 | 49.2s |
