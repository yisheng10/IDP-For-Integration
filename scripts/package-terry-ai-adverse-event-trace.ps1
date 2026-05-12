[CmdletBinding()]
param(
    [string]$OutputRoot = "artifacts\terry-ai-adverse-event-trace"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$workspaceRoot = Split-Path -Parent $PSScriptRoot
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$bundleName = "terry-ai-adverse-event-trace-$timestamp"
$targetRoot = Join-Path $workspaceRoot $OutputRoot
$stagingRoot = Join-Path $targetRoot $bundleName
$zipPath = Join-Path $targetRoot "$bundleName.zip"

$trackedFiles = @(
    "CRC_GUIDANCE_TRACE_STREAM_V1.md",
    "functions\guidanceRuntime.js",
    "functions\index.js",
    "functions\crcAdminRuntime.js",
    "src\pages\CRCHome.jsx",
    "src\components\GeminiChatbot.jsx",
    "src\components\PatientConversationTimeline.jsx",
    "src\services\alertService.js",
    "src\services\conversationTimelineService.js",
    "src\services\crcDirectMessageService.js",
    "src\services\firebaseFunctionHttp.js",
    "src\services\sideEffectGuidanceService.js",
    "src\config.js",
    "MyClinicalApp_AndroidAPK_5Jan2026_2138\MyClinicalApp2\src\pages\PatientHome.js",
    "MyClinicalApp_AndroidAPK_5Jan2026_2138\MyClinicalApp2\src\components\GeminiChatbot.js",
    "MyClinicalApp_AndroidAPK_5Jan2026_2138\MyClinicalApp2\src\services\alertService.js",
    "MyClinicalApp_AndroidAPK_5Jan2026_2138\MyClinicalApp2\src\services\conversationTimelineService.js",
    "MyClinicalApp_AndroidAPK_5Jan2026_2138\MyClinicalApp2\src\services\firebaseFunctionHttp.js",
    "MyClinicalApp_AndroidAPK_5Jan2026_2138\MyClinicalApp2\src\services\sideEffectGuidanceService.js",
    "MyClinicalApp_AndroidAPK_5Jan2026_2138\MyClinicalApp2\src\config.js"
)

function Ensure-Directory {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -ItemType Directory -Path $Path | Out-Null
    }
}

Ensure-Directory -Path $targetRoot
Ensure-Directory -Path $stagingRoot

$missingFiles = New-Object System.Collections.Generic.List[string]
$copiedFiles = New-Object System.Collections.Generic.List[string]

foreach ($relativePath in $trackedFiles) {
    $sourcePath = Join-Path $workspaceRoot $relativePath
    if (-not (Test-Path -LiteralPath $sourcePath)) {
        $missingFiles.Add($relativePath)
        continue
    }

    $destinationPath = Join-Path $stagingRoot $relativePath
    $destinationDirectory = Split-Path -Parent $destinationPath
    Ensure-Directory -Path $destinationDirectory
    Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Force
    $copiedFiles.Add($relativePath)
}

if ($missingFiles.Count -gt 0) {
    $missingBlock = $missingFiles | ForEach-Object { "- $_" } | Out-String
    throw "Bundle creation stopped because some tracked files were missing:`n$missingBlock"
}

$manifestLines = @(
    "# Terry AI Adverse Event Trace Bundle",
    "",
    "Generated at: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')",
    "Workspace root: $workspaceRoot",
    "Bundle name: $bundleName",
    "",
    "## Purpose",
    "",
    "This bundle contains the recent TrialLight code paths related to:",
    "- CRC adverse event guidance reasoning visualization trace",
    "- patient adverse event guidance reasoning visualization trace",
    "- shared Firebase Functions streaming runtime",
    "- mirrored conversation timeline integration used by the trace surfaces",
    "- CRC direct-message integration that now appears inside patient adverse event guidance",
    "",
    "## Included files",
    ""
)

$manifestLines += $copiedFiles | ForEach-Object { "- $_" }
$manifestLines += @(
    "",
    "## Notes",
    "",
    "- The staging folder is intentionally left in place after packaging for audit and manual review.",
    "- This bundle preserves repo-relative paths so Terry can diff or copy files back into place directly."
)

$manifestPath = Join-Path $stagingRoot "BUNDLE_MANIFEST.md"
$manifestLines | Set-Content -Path $manifestPath -Encoding UTF8

Compress-Archive -Path (Join-Path $stagingRoot '*') -DestinationPath $zipPath -CompressionLevel Optimal

Write-Host "Bundle staging folder: $stagingRoot"
Write-Host "Bundle zip: $zipPath"
Write-Host "Copied files: $($copiedFiles.Count)"
