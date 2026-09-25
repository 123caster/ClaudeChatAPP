param(
  [string]$JavaHome = $env:JAVA_HOME,
  [string]$AndroidSdkRoot = $env:ANDROID_HOME
)

$ErrorActionPreference = 'Stop'
$sourceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$buildRoot = Join-Path ([IO.Path]::GetPathRoot($sourceRoot)) ("ccapp-" + $PID)
$outputDir = Join-Path $sourceRoot 'apps\mobile\dist\android'
$buildSucceeded = $false
$appConfig = Get-Content (Join-Path $sourceRoot 'apps\mobile\app.json') -Raw -Encoding UTF8 |
  ConvertFrom-Json
$version = [string]$appConfig.expo.version
$versionCode = [int]$appConfig.expo.android.versionCode
if (!$version -or $versionCode -le 0) {
  throw 'apps/mobile/app.json must define expo.version and a positive expo.android.versionCode.'
}
$defaultAndroidSdk = if ($env:LOCALAPPDATA) {
  Join-Path $env:LOCALAPPDATA 'Android\Sdk'
} else {
  $null
}
$javaCandidates = @(@(
  $JavaHome,
  $env:JAVA_HOME,
  'C:\Program Files\Android\Android Studio\jbr'
) | Where-Object { $_ -and (Test-Path -LiteralPath (Join-Path $_ 'bin\java.exe')) })

if ($javaCandidates.Count -eq 0) {
  throw 'No JDK was found. Set JAVA_HOME or pass -JavaHome to the release script.'
}

$JavaHome = $javaCandidates[0]
$sdkCandidates = @(@(
  $AndroidSdkRoot,
  $env:ANDROID_SDK_ROOT,
  $defaultAndroidSdk
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) })
if ($sdkCandidates.Count -eq 0) {
  throw 'No Android SDK was found. Set ANDROID_HOME or pass -AndroidSdkRoot.'
}
$AndroidSdkRoot = $sdkCandidates[0]
$gradleUserHome = Join-Path (Split-Path -Parent $AndroidSdkRoot) 'gradle-release-retry-cache'

function Remove-BuildDirectory([string]$Path) {
  if (!(Test-Path -LiteralPath $Path)) { return $true }
  for ($attempt = 1; $attempt -le 12 -and (Test-Path -LiteralPath $Path); $attempt += 1) {
    Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $Path) { Start-Sleep -Seconds $attempt }
  }
  return !(Test-Path -LiteralPath $Path)
}

try {
  if (Test-Path $buildRoot) { throw "Temporary build path already exists: $buildRoot" }
  $toolchainRoot = Split-Path -Parent $AndroidSdkRoot
  $cachedGradleDistribution = @(
    (Join-Path $toolchainRoot 'gradle-wrapper-cache\wrapper\dists\gradle-9.3.1-bin'),
    (Join-Path $env:USERPROFILE '.gradle\wrapper\dists\gradle-9.3.1-bin')
  ) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  if ($cachedGradleDistribution) {
    $temporaryWrapperCache = Join-Path $gradleUserHome 'wrapper\dists'
    $temporaryDistribution = Join-Path $temporaryWrapperCache 'gradle-9.3.1-bin'
    if (!(Test-Path -LiteralPath $temporaryDistribution)) {
      New-Item -ItemType Directory -Force -Path $temporaryWrapperCache | Out-Null
      Copy-Item -LiteralPath $cachedGradleDistribution -Destination $temporaryWrapperCache -Recurse
    }
  }
  $copy = Start-Process -FilePath robocopy.exe -ArgumentList @(
    $sourceRoot,
    $buildRoot,
    '/E',
    '/XD',
    'node_modules',
    '.git',
    '.gradle',
    '.gradle-release-*',
    '.idea',
    'build',
    '.cxx',
    'dist',
    '/XF',
    '*.apk',
    '*.tar.gz',
    '/R:1',
    '/W:1',
    '/NFL',
    '/NDL',
    '/NJH',
    '/NJS',
    '/NP'
  ) -Wait -PassThru -NoNewWindow
  if ($copy.ExitCode -gt 7) { throw "Failed to prepare temporary Android build copy (robocopy exit $($copy.ExitCode))." }

  $nativeAppGradle = Join-Path $buildRoot 'apps\mobile\android\app\build.gradle'
  $nativeGradleContent = Get-Content -LiteralPath $nativeAppGradle -Raw -Encoding UTF8
  $nativeGradleContent = [regex]::Replace(
    $nativeGradleContent,
    '(?m)^(\s*versionCode\s+)\d+\s*$',
    ('${{1}}{0}' -f $versionCode)
  )
  $nativeGradleContent = [regex]::Replace(
    $nativeGradleContent,
    '(?m)^(\s*versionName\s+)["''][^"'']+["'']\s*$',
    ('${{1}}"{0}"' -f $version)
  )
  [IO.File]::WriteAllText(
    $nativeAppGradle,
    $nativeGradleContent,
    [Text.UTF8Encoding]::new($false)
  )

  Push-Location $buildRoot
  try {
    # The mobile package and lockfile can temporarily differ while app dependencies evolve.
    # The isolated release copy resolves that state without mutating the working checkout.
    & pnpm install --no-frozen-lockfile --node-linker=hoisted --ignore-scripts
    if ($LASTEXITCODE -ne 0) { throw "pnpm install failed with exit $LASTEXITCODE." }
    & pnpm --filter '@claude-chat/protocol' build
    if ($LASTEXITCODE -ne 0) { throw "Protocol package build failed with exit $LASTEXITCODE." }
    & pnpm --filter '@claude-chat/database' build
    if ($LASTEXITCODE -ne 0) { throw "Database package build failed with exit $LASTEXITCODE." }
    $env:JAVA_HOME = $JavaHome
    $env:ANDROID_HOME = $AndroidSdkRoot
    $env:ANDROID_SDK_ROOT = $AndroidSdkRoot
    $env:GRADLE_USER_HOME = $gradleUserHome
    $env:Path = "$(Join-Path $JavaHome 'bin');$env:Path"
    $env:NODE_ENV = 'production'
    Push-Location 'apps\mobile\android'
    try {
      & .\gradlew.bat assembleRelease --no-daemon --console=plain '-Dorg.gradle.parallel=false'
      if ($LASTEXITCODE -ne 0) { throw "Android release build failed with exit $LASTEXITCODE." }
    } finally {
      Pop-Location
    }
  } finally {
    Pop-Location
  }

  $apk = Join-Path $buildRoot 'apps\mobile\android\app\build\outputs\apk\release\app-release.apk'
  if (!(Test-Path $apk)) { throw "Release APK was not generated: $apk" }
  New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
  $finalApk = Join-Path $outputDir "ClaudeChatAPP-$version.apk"
  Copy-Item -LiteralPath $apk -Destination $finalApk -Force
  $buildTools = Get-ChildItem -LiteralPath (Join-Path $AndroidSdkRoot 'build-tools') -Directory |
    Sort-Object { [version]$_.Name } -Descending |
    Select-Object -First 1
  if (!$buildTools) { throw 'Android SDK build-tools are unavailable.' }
  $aapt = Join-Path $buildTools.FullName 'aapt.exe'
  $apksigner = Join-Path $buildTools.FullName 'apksigner.bat'
  $badgingOutput = & $aapt dump badging $finalApk
  $aaptExitCode = $LASTEXITCODE
  $badging = $badgingOutput | Select-Object -First 1
  if ($aaptExitCode -ne 0 -or $badging -notmatch "package: name='com\.caster123\.claudechatapp'") {
    throw 'APK package metadata verification failed.'
  }
  $escapedVersion = [regex]::Escape($version)
  if (
    $badging -notmatch "versionCode='$versionCode'" -or
    $badging -notmatch "versionName='$escapedVersion'"
  ) {
    throw "APK version metadata verification failed: $badging"
  }
  & $apksigner verify --verbose $finalApk | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed.' }
  $sha256Algorithm = [Security.Cryptography.SHA256]::Create()
  $apkStream = [IO.File]::OpenRead($finalApk)
  try {
    $sha256 = ([BitConverter]::ToString($sha256Algorithm.ComputeHash($apkStream))).Replace('-', '').ToLowerInvariant()
  } finally {
    $apkStream.Dispose()
    $sha256Algorithm.Dispose()
  }
  $buildSucceeded = $true
  Write-Output "APK=$finalApk"
  Write-Output "SHA256=$sha256"
  Write-Output "METADATA=$badging"
} finally {
  $gradleWrapper = Join-Path $buildRoot 'apps\mobile\android\gradlew.bat'
  if (Test-Path -LiteralPath $gradleWrapper) {
    Push-Location (Split-Path -Parent $gradleWrapper)
    try {
      & $gradleWrapper --stop | Out-Null
    } catch {
      Write-Warning "Could not stop the temporary Gradle daemon: $($_.Exception.Message)"
    } finally {
      Pop-Location
    }
  }
  $sourceClean = Remove-BuildDirectory $buildRoot
  if ($buildSucceeded) {
    $gradleClean = Remove-BuildDirectory $gradleUserHome
  } else {
    $gradleClean = $true
    Write-Warning "Retaining the D-drive Gradle retry cache after a failed build: $gradleUserHome"
  }
  if (!$sourceClean -or !$gradleClean) {
    Write-Warning "Could not remove all Android build intermediates immediately: source=$sourceClean gradle=$gradleClean"
  }
}
