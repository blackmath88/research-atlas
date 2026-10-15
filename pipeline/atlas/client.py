"""Bounded, cached, resumable OpenAlex HTTP client.

Verified against help.openalex.org/api/authentication on 2026-10-15:
- keys are sent as `Authorization: Bearer <key>` (we never put them in URLs);
- keyless requests draw on a shared per-IP daily budget;
- cursor paging past the first page requires a key;
- 429 signals an exhausted budget or per-second limit (Retry-After supplied).
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

BASE_URL = "https://api.openalex.org"
SECRET_PARAMS = {"api_key", "mailto", "key", "token"}


class CollectionStop(Exception):
    """Collection cannot continue; `status` is a CollectionStatus value."""

    def __init__(self, status: str, detail: str):
        super().__init__(f"{status}: {detail}")
        self.status = status
        self.detail = detail


def redact_url(url: str) -> str:
    parts = urllib.parse.urlsplit(url)
    query = [
        (k, "REDACTED" if k.lower() in SECRET_PARAMS else v)
        for k, v in urllib.parse.parse_qsl(parts.query, keep_blank_values=True)
    ]
    return urllib.parse.urlunsplit(parts._replace(query=urllib.parse.urlencode(query)))


def redact_text(text: str, secret: str | None) -> str:
    if secret:
        text = text.replace(secret, "REDACTED")
    return re.sub(r"(api_key=)[^&\s\"']+", r"\1REDACTED", text)


@dataclass
class Response:
    status: int
    headers: dict[str, str]
    body: bytes


Transport = Callable[[str, dict[str, str], float], Response]


def urllib_transport(url: str, headers: dict[str, str], timeout: float) -> Response:
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return Response(r.status, {k.lower(): v for k, v in r.headers.items()}, r.read())
    except urllib.error.HTTPError as e:
        return Response(e.code, {k.lower(): v for k, v in (e.headers or {}).items()}, e.read() or b"")


@dataclass
class OpenAlexClient:
    cache_dir: Path
    offline: bool = False
    api_key: str | None = field(default_factory=lambda: os.environ.get("OPENALEX_API_KEY") or None)
    max_requests: int = 40
    interval_s: float = 0.25
    max_retries: int = 3
    max_backoff_s: float = 30.0
    timeout_s: float = 30.0
    transport: Transport = urllib_transport
    sleep: Callable[[float], None] = time.sleep
    requests_made: int = 0
    cache_hits: int = 0
    log: list[dict] = field(default_factory=list)
    last_budget: dict[str, str] = field(default_factory=dict)

    def _cache_path(self, url: str) -> Path:
        # Cache key uses the redacted URL so keys never shape filenames.
        return self.cache_dir / (hashlib.sha256(redact_url(url).encode()).hexdigest() + ".json")

    def get_json(self, path: str, params: dict[str, str]) -> dict:
        url = f"{BASE_URL}{path}?{urllib.parse.urlencode(sorted(params.items()))}"
        if any(k.lower() in SECRET_PARAMS for k in params):
            raise ValueError("credentials must not be passed as URL parameters")
        cached = self._cache_path(url)
        if cached.exists():
            self.cache_hits += 1
            return json.loads(cached.read_text())["body"]
        if self.offline:
            raise CollectionStop("partial", f"offline mode and no cached response for {redact_url(url)}")
        if self.requests_made >= self.max_requests:
            raise CollectionStop("cap_reached", f"request cap {self.max_requests} reached")

        headers = {"Accept": "application/json", "User-Agent": "research-atlas-pipeline/1"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        attempt = 0
        while True:
            if self.requests_made:
                self.sleep(self.interval_s)
            self.requests_made += 1
            try:
                resp = self.transport(url, headers, self.timeout_s)
            except Exception as exc:  # network failure
                detail = redact_text(str(exc), self.api_key)
                self.log.append({"url": redact_url(url), "error": detail})
                if attempt >= self.max_retries:
                    raise CollectionStop("transport_failure", detail) from None
                attempt += 1
                self.sleep(min(self.max_backoff_s, 2.0**attempt))
                continue
            self.last_budget = {k: v for k, v in resp.headers.items() if k.startswith("x-ratelimit")}
            self.log.append({"url": redact_url(url), "status": resp.status})
            if resp.status == 200:
                try:
                    body = json.loads(resp.body)
                except ValueError:
                    raise CollectionStop("partial", "HTTP 200 with a non-JSON body") from None
                self.cache_dir.mkdir(parents=True, exist_ok=True)
                cached.write_text(json.dumps({"url": redact_url(url), "body": body}, sort_keys=True))
                return body
            message = redact_text(resp.body[:400].decode("utf-8", "replace"), self.api_key)
            if resp.status in (401, 403):
                raise CollectionStop("auth_blocked", f"HTTP {resp.status}: {message}")
            if resp.status == 429:
                remaining = resp.headers.get("x-ratelimit-remaining-usd")
                try:
                    retry_after = float(resp.headers.get("retry-after", "0") or 0)
                except ValueError:  # HTTP-date form: treat as a long wait
                    retry_after = float("inf")
                # Exhausted daily budget: stop; never buy usage or wait hours.
                if remaining in ("0", "0.0") or retry_after > self.max_backoff_s or attempt >= self.max_retries:
                    raise CollectionStop("rate_limited", f"HTTP 429 (retry-after {retry_after}s): {message}")
                attempt += 1
                self.sleep(min(self.max_backoff_s, max(retry_after, 2.0**attempt)))
                continue
            if resp.status >= 500 and attempt < self.max_retries:
                attempt += 1
                self.sleep(min(self.max_backoff_s, 2.0**attempt))
                continue
            raise CollectionStop("transport_failure", f"HTTP {resp.status}: {message}")
