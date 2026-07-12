$utf8BOM = New-Object System.Text.UTF8Encoding $true

function Merge-SqlFiles {
    param(
        [string[]]$fileList,
        [string]$outputFile,
        [string]$headerTitle
    )
    $sb = New-Object System.Text.StringBuilder
    $sb.AppendLine("/* =====================================================================") | Out-Null
    $sb.AppendLine("   $headerTitle") | Out-Null
    $sb.AppendLine("   包含檔案清單：") | Out-Null
    foreach ($f in $fileList) {
        $sb.AppendLine("     - $f") | Out-Null
    }
    $sb.AppendLine("   產生時間： $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')") | Out-Null
    $sb.AppendLine("===================================================================== */") | Out-Null
    $sb.AppendLine("") | Out-Null

    foreach ($f in $fileList) {
        $path = Join-Path "c:\Gantt\old_sql" $f
        if (Test-Path $path) {
            $sb.AppendLine("/* =====================================================================") | Out-Null
            $sb.AppendLine("   START OF FILE: $f") | Out-Null
            $sb.AppendLine("===================================================================== */") | Out-Null
            $sb.AppendLine("GO") | Out-Null
            $content = Get-Content -Path $path -Raw -Encoding UTF8
            $sb.AppendLine($content) | Out-Null
            $sb.AppendLine("GO") | Out-Null
            $sb.AppendLine("/* =====================================================================") | Out-Null
            $sb.AppendLine("   END OF FILE: $f") | Out-Null
            $sb.AppendLine("===================================================================== */") | Out-Null
            $sb.AppendLine("") | Out-Null
        } else {
            Write-Warning "File not found: $path"
        }
    }

    [System.IO.File]::WriteAllText($outputFile, $sb.ToString(), $utf8BOM)
    Write-Host "Created: $outputFile ($((Get-Item $outputFile).Length) bytes)"
}

$oldFiles = @(
    "01_schema_and_objects.sql",
    "02_seed_data.sql",
    "03_upgrade_to_current.sql",
    "04_add_type_e_supervisor.sql",
    "05_add_plan_deliverable_score.sql"
)
Merge-SqlFiles -fileList $oldFiles -outputFile "c:\Gantt\old_sql\01_old.sql" -headerTitle "MSD 專案追蹤總表 — 01_old.sql (舊版基礎 DB 架構與資料 01~05)"
Copy-Item "c:\Gantt\old_sql\01_old.sql" "c:\Gantt\01_old.sql" -Force

$newFiles = @(
    "06_upgrade_to_current.sql",
    "07_fix_quoted_identifier.sql",
    "08_add_restore_procs.sql",
    "09_add_starred_projects.sql"
)
Merge-SqlFiles -fileList $newFiles -outputFile "c:\Gantt\old_sql\02_new.sql" -headerTitle "MSD 專案追蹤總表 — 02_new.sql (新擴充架構與預存程序 06~09)"
Copy-Item "c:\Gantt\old_sql\02_new.sql" "c:\Gantt\02_new.sql" -Force
