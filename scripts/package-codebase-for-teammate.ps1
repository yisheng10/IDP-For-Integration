[CmdletBinding()]
param(
    [string]$RootPath = "D:\IDP For Integration",
    [string]$OutputDirectory = "",
    [string]$OutputZipPath = "",
    [switch]$DryRun,
    [switch]$IncludeReferenceTrees,
    [switch]$IncludeDisengagementData
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Normalize-RelativePath {
    param([string]$Path)

    return ($Path -replace '/', '\').TrimStart('\')
}

function Test-IsExactOrChildPath {
    param(
        [string]$RelativePath,
        [string]$Prefix
    )

    $normalizedPath = Normalize-RelativePath $RelativePath
    $normalizedPrefix = Normalize-RelativePath $Prefix

    return (
        $normalizedPath.Equals($normalizedPrefix, [System.StringComparison]::OrdinalIgnoreCase) -or
        $normalizedPath.StartsWith("$normalizedPrefix\", [System.StringComparison]::OrdinalIgnoreCase)
    )
}

function Test-ShouldExcludeFile {
    param(
        [System.IO.FileInfo]$File,
        [string]$RelativePath,
        [string[]]$ExcludedDirectoryNames,
        [string[]]$ExcludedDirectoryPrefixes,
        [string[]]$ExcludedFileNames,
        [string[]]$ExcludedFilePatterns
    )

    $normalizedPath = Normalize-RelativePath $RelativePath
    $segments = $normalizedPath.Split('\')

    foreach ($segment in $segments[0..([Math]::Max($segments.Length - 2, 0))]) {
        foreach ($excludedDirectoryName in $ExcludedDirectoryNames) {
            if ($segment.Equals($excludedDirectoryName, [System.StringComparison]::OrdinalIgnoreCase)) {
                return $true
            }
        }
    }

    foreach ($excludedDirectoryPrefix in $ExcludedDirectoryPrefixes) {
        if (Test-IsExactOrChildPath -RelativePath $normalizedPath -Prefix $excludedDirectoryPrefix) {
            return $true
        }
    }

    foreach ($excludedFileName in $ExcludedFileNames) {
        if ($File.Name.Equals($excludedFileName, [System.StringComparison]::OrdinalIgnoreCase)) {
            return $true
        }
    }

    foreach ($excludedFilePattern in $ExcludedFilePatterns) {
        if ($File.Name -like $excludedFilePattern) {
            return $true
        }
    }

    return $false
}

function New-ZipFromFileList {
    param(
        [string]$ZipPath,
        [System.Collections.Generic.List[object]]$Files,
        [string]$RootPath
    )

    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem

    $zipStream = [System.IO.File]::Open($ZipPath, [System.IO.FileMode]::CreateNew)
    try {
        $archive = New-Object System.IO.Compression.ZipArchive($zipStream, [System.IO.Compression.ZipArchiveMode]::Create, $false)
        try {
            foreach ($item in $Files) {
                $entryPath = ($item.RelativePath -replace '\\', '/')
                $entry = $archive.CreateEntry($entryPath, [System.IO.Compression.CompressionLevel]::Optimal)

                $entryStream = $entry.Open()
                $inputStream = [System.IO.File]::OpenRead($item.FullName)
                try {
                    $inputStream.CopyTo($entryStream)
                }
                finally {
                    $inputStream.Dispose()
                    $entryStream.Dispose()
                }
            }
        }
        finally {
            $archive.Dispose()
        }
    }
    finally {
        $zipStream.Dispose()
    }
}

$rootItem = Get-Item -LiteralPath $RootPath
$rootFullPath = $rootItem.FullName.TrimEnd('\')

if (-not $OutputDirectory) {
    $OutputDirectory = Join-Path $rootFullPath "artifacts\teammate-share"
}

if (-not (Test-Path -LiteralPath $OutputDirectory)) {
    New-Item -ItemType Directory -Path $OutputDirectory | Out-Null
}

if (-not $OutputZipPath) {
    $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
    $OutputZipPath = Join-Path $OutputDirectory "TrialLight_codebase_for_teammate_$timestamp.zip"
}

if (Test-Path -LiteralPath $OutputZipPath) {
    throw "Target zip already exists: $OutputZipPath"
}

$excludedDirectoryNames = @(
    ".git",
    ".firebase",
    ".firebase-tools-config",
    ".playwright-mcp",
    ".venv-dropout312",
    ".venv-dropout314",
    "node_modules",
    "predictions",
    "dist",
    "web-build",
    ".expo",
    "secrets"
)

$excludedDirectoryPrefixes = @(
    "Patient-Dropout-Prediction\env",
    "Patient-Dropout-Prediction\.venv312",
    "Patient-Dropout-Prediction\.py314_packages",
    "Patient-Dropout-Prediction\.py314_packages_cuda",
    "Patient-Dropout-Prediction\cache",
    "Patient-Dropout-Prediction\runs",
    "Patient-Dropout-Prediction\deploy_assets\data",
    "Patient-Dropout-Prediction\audit\candidate_024_extreme_audit_rerun_20260412_d",
    "Patient-Dropout-Prediction\audit\candidate_024_extreme_audit_rerun_20260412_e",
    "Patient-Dropout-Prediction\audit\candidate_064_extreme_audit_rerun_20260413_a",
    "Patient-Dropout-Prediction\audit\official_model_extreme_audit",
    "MyClinicalApp_AndroidAPK_5Jan2026_2138\MyClinicalApp2\Code",
    "li qiu's part questionnaire ePRO\frontend-epro"
)

if (-not $IncludeReferenceTrees) {
    $excludedDirectoryPrefixes += @(
        "newest-crc-web"
    )
}

if (-not $IncludeDisengagementData) {
    $excludedDirectoryPrefixes += @(
        "Patient-Dropout-Prediction\data"
    )
}

$excludedFileNames = @(
    ".env.local",
    ".DS_Store",
    "Supabase and Firebase accesses credentials.txt"
)

$excludedFilePatterns = @(
    "*.log",
    "*.zip",
    "*service-account*.json",
    ".env"
)

$normalizedOutputDirectory = $OutputDirectory.TrimEnd('\')
if ($normalizedOutputDirectory.StartsWith($rootFullPath, [System.StringComparison]::OrdinalIgnoreCase)) {
    $relativeOutputDirectory = $normalizedOutputDirectory.Substring($rootFullPath.Length).TrimStart('\')
    if ($relativeOutputDirectory) {
        $excludedDirectoryPrefixes += $relativeOutputDirectory
    }
}

$files = Get-ChildItem -LiteralPath $rootFullPath -Recurse -File -Force -ErrorAction SilentlyContinue
$includedFiles = New-Object 'System.Collections.Generic.List[object]'
$excludedCount = 0
$includedBytes = [int64]0

foreach ($file in $files) {
    $relativePath = $file.FullName.Substring($rootFullPath.Length).TrimStart('\')
    if (Test-ShouldExcludeFile -File $file -RelativePath $relativePath -ExcludedDirectoryNames $excludedDirectoryNames -ExcludedDirectoryPrefixes $excludedDirectoryPrefixes -ExcludedFileNames $excludedFileNames -ExcludedFilePatterns $excludedFilePatterns) {
        $excludedCount++
        continue
    }

    $includedFiles.Add([pscustomobject]@{
            FullName = $file.FullName
            RelativePath = $relativePath
            Length = $file.Length
        })
    $includedBytes += $file.Length
}

$summary = [pscustomobject]@{
    RootPath = $rootFullPath
    OutputZipPath = $OutputZipPath
    DryRun = [bool]$DryRun
    IncludedFileCount = $includedFiles.Count
    ExcludedFileCount = $excludedCount
    IncludedSizeMB = [math]::Round(($includedBytes / 1MB), 2)
    IncludedSizeGB = [math]::Round(($includedBytes / 1GB), 3)
    IncludeReferenceTrees = [bool]$IncludeReferenceTrees
    IncludeDisengagementData = [bool]$IncludeDisengagementData
}

$summary | Format-List

$largestIncluded = $includedFiles |
    Sort-Object Length -Descending |
    Select-Object -First 15 @{Name = "SizeMB"; Expression = { [math]::Round(($_.Length / 1MB), 2) } }, RelativePath

Write-Host ""
Write-Host "Top included files:"
$largestIncluded | Format-Table -AutoSize

if ($DryRun) {
    return
}

New-ZipFromFileList -ZipPath $OutputZipPath -Files $includedFiles -RootPath $rootFullPath

Write-Host ""
Write-Host "Created zip:"
Write-Host $OutputZipPath
