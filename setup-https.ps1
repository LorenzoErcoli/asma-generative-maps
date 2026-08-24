param([switch]$Force)

$ErrorActionPreference = 'Stop'
$certDir = Join-Path $PSScriptRoot 'certs'
$pfxPath = Join-Path $certDir 'asma-local.pfx'
$caPath = Join-Path $certDir 'asma-local-ca.cer'
$passwordPath = Join-Path $certDir 'asma-local.pass'

if (-not $Force -and (Test-Path $pfxPath) -and (Test-Path $caPath) -and (Test-Path $passwordPath)) {
  Write-Host 'Certificato HTTPS locale gia presente.'
  exit 0
}

New-Item -ItemType Directory -Path $certDir -Force | Out-Null

$interfaces = [Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces() | Where-Object {
  $_.OperationalStatus -eq [Net.NetworkInformation.OperationalStatus]::Up -and
  $_.NetworkInterfaceType -ne [Net.NetworkInformation.NetworkInterfaceType]::Loopback -and
  $_.NetworkInterfaceType -ne [Net.NetworkInformation.NetworkInterfaceType]::Tunnel
}
$addresses = foreach ($interface in $interfaces) {
  foreach ($entry in $interface.GetIPProperties().UnicastAddresses) {
    if ($entry.Address.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetwork -and
        -not $entry.Address.IPAddressToString.StartsWith('169.254.')) {
      $entry.Address.IPAddressToString
    }
  }
}
$addresses = @($addresses | Sort-Object -Unique)
if (-not $addresses.Count) { throw 'Nessun indirizzo IPv4 locale trovato.' }

$primaryIp = @($addresses | Where-Object { $_ -like '192.168.*' -or $_ -like '10.*' -or $_ -like '172.1[6-9].*' -or $_ -like '172.2?.*' -or $_ -like '172.3[0-1].*' })[0]
if (-not $primaryIp) { $primaryIp = $addresses[0] }

$ca = New-SelfSignedCertificate `
  -Type Custom `
  -Subject 'CN=ASMA Local Camera CA' `
  -FriendlyName 'ASMA Local Camera CA' `
  -CertStoreLocation 'Cert:\CurrentUser\My' `
  -KeyAlgorithm RSA `
  -KeyLength 2048 `
  -HashAlgorithm SHA256 `
  -KeyExportPolicy Exportable `
  -KeyUsage CertSign, CRLSign, DigitalSignature `
  -NotAfter (Get-Date).AddYears(5) `
  -TextExtension @('2.5.29.19={critical}{text}ca=1&pathlength=1')

$san = @('DNS=localhost', "DNS=$env:COMPUTERNAME") + @($addresses | ForEach-Object { "IPAddress=$_" })
$leaf = New-SelfSignedCertificate `
  -Type Custom `
  -Subject "CN=$primaryIp" `
  -FriendlyName 'ASMA Local Camera Server' `
  -Signer $ca `
  -CertStoreLocation 'Cert:\CurrentUser\My' `
  -KeyAlgorithm RSA `
  -KeyLength 2048 `
  -HashAlgorithm SHA256 `
  -KeyExportPolicy Exportable `
  -KeyUsage DigitalSignature, KeyEncipherment `
  -NotAfter (Get-Date).AddYears(2) `
  -TextExtension @(
    "2.5.29.17={text}$($san -join '&')",
    '2.5.29.37={text}1.3.6.1.5.5.7.3.1',
    '2.5.29.19={critical}{text}ca=0'
  )

$passwordText = [Guid]::NewGuid().ToString('N')
$password = ConvertTo-SecureString -String $passwordText -AsPlainText -Force
Export-PfxCertificate -Cert $leaf -FilePath $pfxPath -Password $password -Force | Out-Null
Export-Certificate -Cert $ca -FilePath $caPath -Type CERT -Force | Out-Null
[IO.File]::WriteAllText($passwordPath, $passwordText, [Text.Encoding]::ASCII)

Write-Host "Certificato HTTPS creato per: $($addresses -join ', ')"
Write-Host "CA da installare sull'iPad: $caPath"
