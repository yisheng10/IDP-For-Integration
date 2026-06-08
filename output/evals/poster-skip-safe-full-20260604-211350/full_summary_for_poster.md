# CRC Guidance Eval - Full V2 Poster Summary

| Metric | Value |
|---|---:|
| Success cases | 50/50 (100%) |
| Route decision match | 42/50 (84%) |
| Source vector match | 46/50 (92%) |
| Combined gold chunk recall | 74.3% |
| Top-k gold hit rate | 60% |
| Returned citation coverage | 31/50 (62%) |
| Citation-required cases | 35/50 |
| Average latency | 30.7s |
| P95 latency | 66.8s |

## Case-Level Data

| Case | Type | Risk | Expected Route | Actual Route | Route Match | Vector Match | Recall | Citations | Latency |
|---|---|---|---|---|---:|---:|---:|---:|---:|
| rag-v2-001 | greeting_or_smalltalk | low | skip | skip | Y | Y | -% | 0 | 23.7s |
| rag-v2-002 | product_or_workflow_help | low | skip | skip | Y | Y | -% | 0 | 18.3s |
| rag-v2-003 | greeting_or_smalltalk | low | skip | skip | Y | Y | -% | 0 | 50.9s |
| rag-v2-004 | product_or_workflow_help | low | skip | skip | Y | Y | -% | 0 | 76.2s |
| rag-v2-005 | greeting_or_smalltalk | low | skip | skip | Y | Y | -% | 0 | 18.8s |
| rag-v2-006 | product_or_workflow_help | low | skip | skip | Y | Y | -% | 0 | 66.8s |
| rag-v2-007 | greeting_or_smalltalk | low | skip | skip | Y | Y | -% | 0 | 31.6s |
| rag-v2-008 | product_or_workflow_help | low | skip | skip | Y | Y | -% | 0 | 21.3s |
| rag-v2-009 | greeting_or_smalltalk | low | skip | skip | Y | Y | -% | 0 | 32.2s |
| rag-v2-010 | product_or_workflow_help | low | skip | skip | Y | Y | -% | 0 | 6.9s |
| rag-v2-011 | direct_ctcae_lookup | low | retrieve | retrieve | Y | Y | 100% | 1 | 34.3s |
| rag-v2-012 | direct_protocol_lookup | medium | retrieve | retrieve | Y | Y | 100% | 2 | 10.6s |
| rag-v2-013 | direct_ctcae_protocol_lookup | medium | retrieve | retrieve | Y | Y | 50% | 6 | 23.7s |
| rag-v2-014 | direct_citation_request | medium | retrieve | retrieve | Y | Y | 50% | 2 | 34.4s |
| rag-v2-015 | direct_ctcae_lookup | low | retrieve | retrieve | Y | Y | 100% | 1 | 19s |
| rag-v2-016 | direct_protocol_lookup | medium | retrieve | retrieve | Y | Y | 100% | 1 | 45.1s |
| rag-v2-017 | direct_ctcae_protocol_lookup | medium | retrieve | retrieve | Y | Y | 50% | 1 | 43.4s |
| rag-v2-018 | direct_citation_request | medium | retrieve | retrieve | Y | Y | 0% | 0 | 42.1s |
| rag-v2-019 | direct_ctcae_lookup | low | retrieve | retrieve | Y | Y | 100% | 1 | 24.4s |
| rag-v2-020 | direct_protocol_lookup | medium | retrieve | skip | N | N | 0% | 0 | 23s |
| rag-v2-021 | direct_ctcae_protocol_lookup | medium | retrieve | retrieve | Y | Y | 50% | 3 | 24.2s |
| rag-v2-022 | direct_citation_request | high | retrieve | retrieve | Y | Y | 50% | 2 | 15.2s |
| rag-v2-023 | direct_ctcae_lookup | low | retrieve | retrieve | Y | Y | 100% | 1 | 20.7s |
| rag-v2-024 | direct_protocol_lookup | medium | retrieve | retrieve | Y | Y | 100% | 2 | 12.1s |
| rag-v2-025 | direct_ctcae_protocol_lookup | medium | retrieve | retrieve | Y | Y | 50% | 8 | 33.6s |
| rag-v2-026 | direct_citation_request | high | retrieve | retrieve | Y | Y | 100% | 0 | 26.5s |
| rag-v2-027 | direct_ctcae_lookup | low | retrieve | retrieve | Y | Y | 100% | 1 | 12.9s |
| rag-v2-028 | direct_protocol_lookup | medium | retrieve | retrieve | Y | N | 0% | 1 | 51.6s |
| rag-v2-029 | direct_ctcae_protocol_lookup | medium | retrieve | retrieve | Y | Y | 100% | 3 | 30.1s |
| rag-v2-030 | direct_citation_request | high | retrieve | retrieve | Y | Y | 50% | 1 | 42.3s |
| rag-v2-031 | current_patient_status | low | skip | skip | Y | Y | -% | 0 | 36.3s |
| rag-v2-032 | current_patient_ctcae_assessment | high | retrieve | retrieve | Y | Y | 100% | 1 | 34s |
| rag-v2-033 | current_patient_emergency_protocol | high | retrieve | retrieve | Y | Y | 100% | 2 | 46.2s |
| rag-v2-034 | current_patient_status | low | skip | skip | Y | Y | -% | 0 | 18.8s |
| rag-v2-035 | current_patient_ctcae_assessment | medium | retrieve | retrieve | Y | Y | 100% | 1 | 31.7s |
| rag-v2-036 | current_patient_emergency_protocol | high | retrieve | retrieve | Y | Y | 50% | 4 | 30.7s |
| rag-v2-037 | current_patient_status | low | skip | retrieve | N | N | -% | 0 | 18.5s |
| rag-v2-038 | current_patient_ctcae_assessment | medium | retrieve | retrieve | Y | Y | 100% | 1 | 31.6s |
| rag-v2-039 | current_patient_emergency_protocol | high | retrieve | retrieve | Y | Y | 100% | 4 | 38s |
| rag-v2-040 | current_patient_status | medium | skip | skip | Y | Y | -% | 0 | 18.4s |
| rag-v2-041 | current_patient_ctcae_assessment | medium | retrieve | retrieve | Y | Y | 100% | 2 | 20.7s |
| rag-v2-042 | current_patient_emergency_protocol | high | retrieve | retrieve | Y | Y | 50% | 0 | 67s |
| rag-v2-043 | current_patient_status | low | skip | retrieve | N | N | -% | 0 | 33.2s |
| rag-v2-044 | current_patient_ctcae_assessment | medium | retrieve | retrieve | Y | Y | 100% | 1 | 21.1s |
| rag-v2-045 | current_patient_emergency_protocol | high | retrieve | retrieve | Y | Y | 50% | 2 | 45.4s |
| rag-v2-046 | cache_follow_up | low | reuse_cache | retrieve | N | Y | 100% | 1 | 25.4s |
| rag-v2-047 | cache_follow_up | medium | reuse_cache | retrieve | N | Y | 0% | 3 | 53.9s |
| rag-v2-048 | cache_follow_up | low | reuse_cache | retrieve | N | Y | 100% | 1 | 9.4s |
| rag-v2-049 | cache_follow_up | low | reuse_cache | retrieve | N | Y | 100% | 3 | 28.9s |
| rag-v2-050 | cache_follow_up | low | reuse_cache | retrieve | N | Y | 100% | 1 | 10.9s |
