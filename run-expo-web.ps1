$ErrorActionPreference = "Stop"
$env:Path = "C:\Program Files\nodejs;" + $env:Path
$env:__UNSAFE_EXPO_HOME_DIRECTORY = "C:\Users\Terry\Desktop\MyClinicalApp2\.expo"
Set-Location "C:\Users\Terry\Desktop\MyClinicalApp2"
& "C:\Program Files\nodejs\npx.cmd" expo start --localhost
