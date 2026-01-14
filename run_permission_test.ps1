# 用户权限检查逻辑测试 PowerShell 脚本
$ErrorActionPreference = "Stop"

Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "用户权限检查逻辑测试" -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host ""

# 查找 Python
$pythonPaths = @(
    ".venv\Scripts\python.exe",
    "python.exe",
    "python3.exe",
    "py.exe"
)

$pythonPath = $null
foreach ($path in $pythonPaths) {
    if (Test-Path $path) {
        $pythonPath = $path
        Write-Host "使用 Python: $pythonPath" -ForegroundColor Green
        break
    }
}

if (-not $pythonPath) {
    Write-Host "错误: 未找到 Python" -ForegroundColor Red
    exit 1
}

Write-Host ""

# 运行测试
try {
    & $pythonPath tests\test_permission_logic.py
    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "======================================================================" -ForegroundColor Green
        Write-Host "测试完成！所有测试通过！" -ForegroundColor Green
        Write-Host "======================================================================" -ForegroundColor Green
    } else {
        Write-Host ""
        Write-Host "======================================================================" -ForegroundColor Red
        Write-Host "测试失败！" -ForegroundColor Red
        Write-Host "======================================================================" -ForegroundColor Red
    }
} catch {
    Write-Host ""
    Write-Host "======================================================================" -ForegroundColor Red
    Write-Host "测试出错: $_" -ForegroundColor Red
    Write-Host "======================================================================" -ForegroundColor Red
    exit 1
}
