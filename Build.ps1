[CmdletBinding()]
param(
    [string]$WebView2SdkPath,
    [string]$OutputPath = (Join-Path $PSScriptRoot 'dist'),
    [switch]$Zip
)

$ErrorActionPreference = 'Stop'
$sdkVersion = '1.0.2365.46'
$build = Join-Path $PSScriptRoot '.build'
$package = Join-Path ([IO.Path]::GetFullPath($OutputPath)) 'Mynd-win-x64'
New-Item -ItemType Directory -Force -Path $build, $package | Out-Null

if (!$WebView2SdkPath) {
    $sdk = Join-Path $build "WebView2-$sdkVersion"
    if (!(Test-Path (Join-Path $sdk 'runtimes/win-x64/native/WebView2Loader.dll'))) {
        $download = Join-Path $build "WebView2-$sdkVersion.zip"
        Invoke-WebRequest -UseBasicParsing -Uri "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$sdkVersion/microsoft.web.webview2.$sdkVersion.nupkg" -OutFile $download
        Expand-Archive -LiteralPath $download -DestinationPath $sdk -Force
    }
    $WebView2SdkPath = $sdk
}

$managed = Join-Path $WebView2SdkPath 'lib/net45'
$loader = Join-Path $WebView2SdkPath 'runtimes/win-x64/native/WebView2Loader.dll'
if (!(Test-Path $managed)) { $managed = $WebView2SdkPath }
if (!(Test-Path $loader)) { $loader = Join-Path $WebView2SdkPath 'WebView2Loader.dll' }
$core = Join-Path $managed 'Microsoft.Web.WebView2.Core.dll'
foreach ($file in @($loader, $core)) {
    if (!(Test-Path -LiteralPath $file -PathType Leaf)) { throw "Missing WebView2 SDK file $file." }
}

$framework = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319'
$metadata = Join-Path $env:WINDIR 'System32/WinMetadata'
$compiler = Join-Path $framework 'csc.exe'
$assemblies = @(
    'System.dll', 'System.Core.dll', 'System.Drawing.dll', 'System.Windows.Forms.dll',
    'System.Web.dll', 'System.Web.Extensions.dll', 'System.IO.Compression.dll',
    'System.Runtime.dll', 'System.Runtime.WindowsRuntime.dll', 'System.Runtime.InteropServices.WindowsRuntime.dll'
) | ForEach-Object { Join-Path $framework $_ }
$winrt = @('Windows.Foundation', 'Windows.Storage', 'Windows.Data', 'Windows.Graphics') | ForEach-Object { Join-Path $metadata "$_.winmd" }
$arguments = @('/nologo', '/target:winexe', '/platform:x64', '/optimize+', "/out:$(Join-Path $package 'Mynd.exe')",
    "/win32icon:$(Join-Path $PSScriptRoot 'Mynd.ico')", "/win32manifest:$(Join-Path $PSScriptRoot 'src/Mynd.manifest')")
$arguments += ($assemblies + $winrt + @($core)) | ForEach-Object { "/reference:$_" }
$arguments += Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'src') -Filter '*.cs' | ForEach-Object FullName
& $compiler @arguments
if ($LASTEXITCODE -ne 0) { throw 'Mynd compilation failed.' }

Copy-Item -LiteralPath $core, $loader -Destination $package -Force
foreach ($notice in @('LICENSE.txt', 'NOTICE.txt')) {
    $source = Join-Path $WebView2SdkPath $notice
    if (Test-Path -LiteralPath $source -PathType Leaf) {
        Copy-Item -LiteralPath $source -Destination (Join-Path $package "WebView2-$notice") -Force
    }
}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'ui') -Destination $package -Recurse -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Mynd.ico'), (Join-Path $PSScriptRoot 'README.md'), (Join-Path $PSScriptRoot 'CHANGELOG.md'), (Join-Path $PSScriptRoot 'THIRD_PARTY_NOTICES.md') -Destination $package -Force
$docs = Join-Path $package 'docs'
New-Item -ItemType Directory -Path $docs -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'docs/screenshots') -Destination $docs -Recurse -Force

if ($Zip) {
    $zipPath = Join-Path ([IO.Path]::GetFullPath($OutputPath)) 'Mynd-win-x64.zip'
    Compress-Archive -LiteralPath $package -DestinationPath $zipPath -Force
    Write-Output $zipPath
}
Write-Output (Join-Path $package 'Mynd.exe')
