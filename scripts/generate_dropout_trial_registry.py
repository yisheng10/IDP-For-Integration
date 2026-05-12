from __future__ import annotations

import csv
import json
from collections import OrderedDict
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE_CSV = (
    ROOT
    / "Patient-Dropout-Prediction"
    / "deploy_assets"
    / "data"
    / "triallight_subject_id_map_v35subjectid.csv"
)
FUNCTIONS_OUTPUT = ROOT / "functions" / "generated" / "dropoutTrialRegistrySeed.json"
WEB_OUTPUT = ROOT / "src" / "generated" / "dropoutTrialSupportMetadata.json"

MODEL_VERSION_LABEL = "stage_3_29_single"
MODEL_CHECKPOINT_FILE = "model_stage_3_29_single.pth"
MODEL_ARTIFACTS_FILE = "artifacts_stage_3_29_single.pkl"
POOL_SOURCE = "triallight_subject_id_map_v35subjectid.csv"


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def ensure_parent(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def load_trials() -> "OrderedDict[str, dict]":
    trials: "OrderedDict[str, dict]" = OrderedDict()
    with SOURCE_CSV.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            trial_id = str(row.get("trial_id") or "").strip()
            subject_id = str(row.get("subject_id") or "").strip()
            legacy_subject_id = str(row.get("legacy_subject_id") or "").strip()
            max_day_index_raw = str(row.get("max_day_index") or "").strip()
            if not trial_id or not subject_id:
                continue

            if trial_id not in trials:
                trials[trial_id] = {
                    "trial_id": trial_id,
                    "label": trial_id,
                    "is_active": True,
                    "status": "configured",
                    "canonical_subject_pool_source": POOL_SOURCE,
                    "model_version_label": MODEL_VERSION_LABEL,
                    "model_checkpoint_file": MODEL_CHECKPOINT_FILE,
                    "model_artifacts_file": MODEL_ARTIFACTS_FILE,
                    "subjects": [],
                }

            trials[trial_id]["subjects"].append(
                {
                    "subject_id": subject_id,
                    "legacy_subject_id": legacy_subject_id or None,
                    "trial_id": trial_id,
                    "max_day_index": int(max_day_index_raw or "0"),
                }
            )

    for trial in trials.values():
        trial["expected_pool_size"] = len(trial["subjects"])
    return trials


def build_functions_seed(trials: "OrderedDict[str, dict]") -> dict:
    generated_at = utc_now_iso()
    return {
        "generated_at": generated_at,
        "source_file": str(SOURCE_CSV.relative_to(ROOT)).replace("\\", "/"),
        "model_defaults": {
            "model_version_label": MODEL_VERSION_LABEL,
            "model_checkpoint_file": MODEL_CHECKPOINT_FILE,
            "model_artifacts_file": MODEL_ARTIFACTS_FILE,
        },
        "trials": list(trials.values()),
    }


def build_web_metadata(trials: "OrderedDict[str, dict]") -> dict:
    generated_at = utc_now_iso()
    payload = {
        "generated_at": generated_at,
        "source_file": str(SOURCE_CSV.relative_to(ROOT)).replace("\\", "/"),
        "trials": OrderedDict(),
    }
    for trial_id, trial in trials.items():
        payload["trials"][trial_id] = {
            "trial_id": trial_id,
            "label": trial["label"],
            "is_active": bool(trial["is_active"]),
            "status": str(trial["status"]),
            "canonical_subject_pool_source": trial["canonical_subject_pool_source"],
            "expected_pool_size": int(trial["expected_pool_size"]),
            "model_version_label": trial["model_version_label"],
            "model_checkpoint_file": trial["model_checkpoint_file"],
            "model_artifacts_file": trial["model_artifacts_file"],
        }
    return payload


def write_json(path: Path, payload: dict) -> None:
    ensure_parent(path)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    trials = load_trials()
    write_json(FUNCTIONS_OUTPUT, build_functions_seed(trials))
    write_json(WEB_OUTPUT, build_web_metadata(trials))
    print(f"Generated {FUNCTIONS_OUTPUT}")
    print(f"Generated {WEB_OUTPUT}")
    print(f"Trials: {len(trials)}")


if __name__ == "__main__":
    main()
