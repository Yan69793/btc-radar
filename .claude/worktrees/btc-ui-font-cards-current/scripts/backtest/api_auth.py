"""Auth header for BTC Radar API writes.

The API only accepts writes from the owner's session. Export the token before
running any script that posts results:

    $env:BTC_RADAR_TOKEN = "<token>"          # PowerShell

Get a token by logging in (never pass the password on the command line, the
shell history and process list keep it):

    $body = @{ email = "you@example.com"; password = Read-Host -AsSecureString | ConvertFrom-SecureString -AsPlainText } | ConvertTo-Json
    Invoke-RestMethod -Method Post -Uri "$API/api/auth/login" -ContentType application/json -Body $body

Or copy the value of localStorage["btc-radar-token"] from the panel.
"""
import os
import sys


def auth_headers(required: bool = True) -> dict:
    token = os.environ.get("BTC_RADAR_TOKEN", "").strip()
    if not token:
        if required:
            sys.exit(
                "BTC_RADAR_TOKEN nao definido. A API recusa escrita sem sessao do dono.\n"
                "Defina a variavel de ambiente e rode de novo (ver docstring de api_auth.py)."
            )
        return {}
    return {"Authorization": f"Bearer {token}"}
