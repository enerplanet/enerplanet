#!/usr/bin/env python3
"""Verify grant integration."""

import argparse
import json
from pathlib import Path
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def https_url(raw):
    parts = urlsplit(raw)
    if (parts.scheme != "https" or not parts.hostname or parts.username
            or parts.password or parts.query or parts.fragment):
        raise argparse.ArgumentTypeError("Use an absolute HTTPS URL without credentials, query or fragment")
    return raw.rstrip("/")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--issuer", type=https_url, required=True)
    parser.add_argument("--api-base-url", type=https_url, required=True, help="API URL including /api")
    parser.add_argument("--client-id", default="renvolveit-toolbox")
    parser.add_argument("--client-secret-file", type=Path, required=True)
    parser.add_argument("--assertion-file", type=Path, required=True, help="Fresh, single-use RENvolveIT assertion")
    parser.add_argument("--expected-subject", required=True, help="Existing SpatialHub user ID")
    args = parser.parse_args()
    opener = build_opener(NoRedirect())

    def request_json(url, data=None, token=None):
        headers = {"Accept": "application/json"}
        if data is not None:
            headers["Content-Type"] = "application/x-www-form-urlencoded"
            data = urlencode(data).encode()
        if token:
            headers["Authorization"] = "Bearer " + token
        with opener.open(Request(url, data=data, headers=headers), timeout=20) as response:
            return json.load(response)

    stage = "read credentials"
    try:
        secret = args.client_secret_file.read_text().strip()
        assertion = args.assertion_file.read_text().strip()
        if not secret or not assertion:
            raise ValueError("empty credential file")
        stage = "SpatialHub JWT Authorization Grant"
        result = request_json(args.issuer + "/protocol/openid-connect/token", data={
            "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
            "client_id": args.client_id, "client_secret": secret, "assertion": assertion,
            "scope": "openid email profile enerplanet:read",
        })
        token = result.get("access_token")
        if not isinstance(token, str) or not token or result.get("token_type", "").lower() != "bearer":
            raise ValueError("no bearer access token in grant response")
        stage = "API identity"
        identity = request_json(args.api_base_url + "/auth/whoami", token=token)
        if (identity.get("issuer") != args.issuer
                or identity.get("subject") != args.expected_subject
                or identity.get("authentication_method") != "bearer"):
            raise ValueError("API identity does not match expected SpatialHub issuer/user")
        stage = "model listing"
        models = request_json(args.api_base_url + "/models?limit=1", token=token)
        if not isinstance(models.get("data"), list):
            raise ValueError("unexpected model response")
        print("Grant, SpatialHub identity and model listing passed.")
        print(f"Models returned: {len(models['data'])}. Confirm ownership against the known user's data.")
        return 0
    except HTTPError as exc:
        print(f"{stage} failed: HTTP {exc.code}. Check server logs; response omitted to protect credentials.", file=sys.stderr)
    except (URLError, OSError):
        print(f"{stage} failed: credential file, network or TLS error.", file=sys.stderr)
    except (ValueError, TypeError, AttributeError):
        print(f"{stage} failed: missing or unexpected response/identity.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
