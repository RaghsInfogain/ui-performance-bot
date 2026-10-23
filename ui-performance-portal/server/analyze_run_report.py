#!/usr/bin/env python3
"""
Consolidated performance report analyzer.

Reads Lighthouse JSON files (Infogain_UEM_DataFile*.json) and Navigation Timing
data from Static_Run_Report CSV for a run, merges per-page, and outputs JSON.

Usage:
  python3 analyze_run_report.py <run_id> [--results-dir PATH]
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import statistics
import sys
from pathlib import Path
from typing import Any
from urllib.parse import urlparse, urlunparse


def normalize_url(url: str) -> str:
    if not url:
        return ""
    url = url.strip().split("#")[0]
    parsed = urlparse(url)
    path = parsed.path.rstrip("/") or "/"
    return urlunparse((parsed.scheme, parsed.netloc.lower(), path, "", parsed.query, ""))


def audit_metric(audits: dict, key: str, field: str = "numericValue", default: float = 0) -> float:
    audit = audits.get(key) or {}
    val = audit.get(field, default)
    try:
        return float(val)
    except (TypeError, ValueError):
        return default


def parse_lighthouse_file(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as f:
        data = json.load(f)

    audits = data.get("audits") or {}
    categories = data.get("categories") or {}
    perf = categories.get("performance") or {}

    opportunities = []
    diagnostics = []
    for audit_id, audit in audits.items():
        if not isinstance(audit, dict):
            continue
        score = audit.get("score")
        title = audit.get("title") or audit_id
        display = audit.get("displayValue") or ""
        details = audit.get("details") or {}
        savings = 0
        if isinstance(details, dict):
            overall = details.get("overallSavingsMs")
            if overall is not None:
                try:
                    savings = float(overall)
                except (TypeError, ValueError):
                    savings = 0

        entry = {
            "id": audit_id,
            "title": title,
            "score": score,
            "displayValue": display,
            "savingsMs": savings,
        }

        if score is not None and isinstance(score, (int, float)) and score < 0.9:
            if savings > 0 or audit_id in (
                "render-blocking-resources",
                "unused-javascript",
                "unused-css-rules",
                "modern-image-formats",
                "offscreen-images",
                "unminified-javascript",
                "unminified-css",
                "uses-optimized-images",
                "uses-text-compression",
                "server-response-time",
                "redirects",
                "uses-long-cache-ttl",
            ):
                opportunities.append(entry)
            else:
                diagnostics.append(entry)

    # Key by the URL the engine was asked to test: navigation timing and the results CSV use it.
    # finalDisplayedUrl is where redirects ended (e.g. /page.php -> /page) and would split one
    # page into two half-empty rows.
    url = data.get("requestedUrl") or data.get("finalDisplayedUrl") or data.get("finalUrl") or ""
    final_url = data.get("finalDisplayedUrl") or data.get("finalUrl") or url

    return {
        "url": url,
        "urlKey": normalize_url(url),
        "finalUrl": final_url,
        "lighthouseFile": path.name,
        "lighthouseVersion": data.get("lighthouseVersion", ""),
        "fetchTime": data.get("fetchTime", ""),
        "runWarnings": data.get("runWarnings") or [],
        "fcp": audit_metric(audits, "first-contentful-paint"),
        "lcp": audit_metric(audits, "largest-contentful-paint"),
        "tbt": audit_metric(audits, "total-blocking-time"),
        "cls": audit_metric(audits, "cumulative-layout-shift"),
        "speedIndex": audit_metric(audits, "speed-index"),
        "performanceScore": float(perf.get("score") or 0),
        "accessibilityScore": float((categories.get("accessibility") or {}).get("score") or 0),
        "bestPracticesScore": float((categories.get("best-practices") or {}).get("score") or 0),
        "seoScore": float((categories.get("seo") or {}).get("score") or 0),
        "opportunities": sorted(opportunities, key=lambda x: x.get("savingsMs", 0), reverse=True)[:10],
        "diagnostics": diagnostics[:15],
    }


def parse_csv_rows(csv_path: Path) -> list[dict[str, Any]]:
    if not csv_path.exists():
        return []

    rows: list[dict[str, Any]] = []
    with csv_path.open(encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            page_url = row.get("Page URL", "").strip()
            if not page_url:
                continue
            rows.append({
                "runId": row.get("RUN_ID", ""),
                "timestamp": row.get("Timestamp", ""),
                "hostname": row.get("HostName", ""),
                "transaction": row.get("Transaction", ""),
                "pageUrl": page_url,
                "urlKey": normalize_url(page_url),
                "fcp": _num(row.get("First Contentful Paint")),
                "lcp": _num(row.get("Last Contentful Paint")),
                "tbt": _num(row.get("Total Blocking Time")),
                "cls": _num(row.get("Cumulative Layout Shift")),
                "speedIndex": _num(row.get("Speed Index")),
                "performanceScore": _num(row.get("Performance Score")),
                "pageLoadTime": _num(row.get("Page Load Time")),
                "networkTime": _num(row.get("Network Time")),
                "dnsLookupTime": _num(row.get("DNS Lookup Time")),
                "connectionTime": _num(row.get("Connection Time")),
                "serverProcessingTime": _num(row.get("Server Processing Time")),
                "responseTime": _num(row.get("Response Time")),
                "browserTime": _num(row.get("Browser Time")),
                "domInteractionTime": _num(row.get("DOM Interaction Time")),
                "domCompleteTime": _num(row.get("DOM Complete Time")),
                "playwrightPageLoadTime": _num(row.get("Playwright Full Page Load Time")),
                "elementLoadTime": row.get("Element Load Time", "N/A"),
                "testStatus": "FAIL" if "FAIL" in str(row.get("Test Status", "")) else "PASS",
                "failureReason": row.get("Failure Reason", ""),
                "auditTitles": row.get("Audit Titles", ""),
                "auditScores": row.get("Audit Scores", ""),
            })
    return rows


def _num(val: Any) -> float:
    try:
        return float(val) if val not in (None, "", "N/A") else 0.0
    except (TypeError, ValueError):
        return 0.0


def page_label(row: dict) -> str:
    tx = row.get("transaction") or ""
    if tx:
        return tx[:24]
    url = row.get("pageUrl") or row.get("url") or ""
    return url.replace("https://", "").replace("http://", "")[:30]


def build_findings(page: dict) -> list[str]:
    issues = []
    lcp = page.get("lcp", 0)
    fcp = page.get("fcp", 0)
    cls = page.get("cls", 0)
    tbt = page.get("tbt", 0)
    score = page.get("performanceScore", 0)
    page_load = page.get("pageLoadTime", 0)
    dns = page.get("dnsLookupTime", 0)
    server = page.get("serverProcessingTime", 0)

    if lcp > 2500:
        issues.append(f"LCP {int(lcp)}ms exceeds 2.5s threshold")
    if fcp > 1800:
        issues.append(f"FCP {int(fcp)}ms exceeds 1.8s threshold")
    if cls > 0.1:
        issues.append(f"CLS {cls:.3f} exceeds 0.1 threshold")
    if tbt > 300:
        issues.append(f"TBT {int(tbt)}ms exceeds 300ms threshold")
    if score < 0.5:
        issues.append(f"Lighthouse score {int(score * 100)} is below 50")
    if page_load > 3000:
        issues.append(f"Navigation page load {int(page_load)}ms exceeds 3s")
    if dns > 200:
        issues.append(f"DNS lookup {int(dns)}ms is slow")
    if server > 600:
        issues.append(f"Server processing {int(server)}ms is high")

    for warn in page.get("runWarnings") or []:
        issues.append(f"Lighthouse warning: {warn}")

    for opp in (page.get("opportunities") or [])[:3]:
        title = opp.get("title", "")
        savings = opp.get("savingsMs", 0)
        if savings > 0:
            issues.append(f"Opportunity: {title} (est. {int(savings)}ms savings)")
        elif title:
            issues.append(f"Audit: {title}")

    return issues


def severity(issues: list[str]) -> str:
    if len(issues) >= 3:
        return "high"
    if len(issues) >= 2:
        return "medium"
    return "low"


def avg_key(pages: list[dict], key: str) -> float:
    vals = [float(p.get(key) or 0) for p in pages if p.get(key)]
    return statistics.mean(vals) if vals else 0.0


def _dur(start: float, end: float) -> int:
    if start <= 0 or end <= 0:
        return 0
    return max(0, int(end - start))


def load_nav_timing_files(run_dir: Path) -> dict[str, dict]:
    """Load NavTiming*.json files keyed by normalized URL."""
    nav_by_url: dict[str, dict] = {}
    if not run_dir.exists():
        return nav_by_url
    for json_file in sorted(run_dir.glob("NavTiming*.json")):
        try:
            with json_file.open(encoding="utf-8") as f:
                data = json.load(f)
            url = data.get("pageUrl", "")
            key = normalize_url(url)
            if key:
                data["navTimingFile"] = json_file.name
                nav_by_url[key] = data
        except (json.JSONDecodeError, OSError) as exc:
            print(f"Warning: skip {json_file.name}: {exc}", file=sys.stderr)
    return nav_by_url


def compute_practical_metrics(milestones: dict[str, Any]) -> dict[str, Any]:
    """Calculate practical Navigation Timing metrics from raw milestones."""
    ns = float(milestones.get("navigationStart") or 0)
    dls = float(milestones.get("domainLookupStart") or 0)
    dle = float(milestones.get("domainLookupEnd") or 0)
    cs = float(milestones.get("connectStart") or 0)
    ce = float(milestones.get("connectEnd") or 0)
    scs = float(milestones.get("secureConnectionStart") or 0)
    rs = float(milestones.get("requestStart") or 0)
    resp_s = float(milestones.get("responseStart") or 0)
    resp_e = float(milestones.get("responseEnd") or 0)
    fs = float(milestones.get("fetchStart") or rs or 0)
    di = float(milestones.get("domInteractive") or 0)
    dcle = float(milestones.get("domContentLoadedEventEnd") or 0)
    dc = float(milestones.get("domComplete") or 0)
    le = float(milestones.get("loadEventEnd") or 0)

    dns = _dur(dls, dle)
    tcp = _dur(cs, ce)
    tls = _dur(scs, rs) if scs > 0 else 0
    ttfb = _dur(ns, resp_s) if ns > 0 else 0
    server_wait = _dur(ce, resp_s)
    document_fetch = _dur(fs, resp_e)
    dom_build = _dur(resp_e, di)
    # Older captures lack domContentLoadedEventEnd; split at domComplete instead so the
    # post-interactive time isn't reported as 0 ms scripts + one large load event.
    script_end = dcle if dcle > 0 else dc
    script_time = _dur(di, script_end) if script_end > 0 else 0
    load_event = _dur(script_end, le) if script_end > 0 else _dur(di, le)
    script_formula = ("domContentLoadedEventEnd − domInteractive" if dcle > 0
                      else "domComplete − domInteractive")
    load_formula = ("loadEventEnd − domContentLoadedEventEnd" if dcle > 0
                    else "loadEventEnd − domComplete")
    page_load = _dur(ns, le) if ns > 0 else 0

    return {
        "dns": {"value": dns, "formula": "domainLookupEnd − domainLookupStart", "purpose": "DNS resolution latency (0 if cached)"},
        "tcp": {"value": tcp, "formula": "connectEnd − connectStart", "purpose": "TCP handshake latency"},
        "tls": {"value": tls, "formula": "requestStart − secureConnectionStart", "purpose": "TLS/SSL negotiation time"},
        "ttfb": {"value": ttfb, "formula": "responseStart − navigationStart", "purpose": "Time to first byte — server responsiveness"},
        "serverWait": {"value": server_wait, "formula": "responseStart − connectEnd", "purpose": "Queue + server processing before first byte"},
        "documentFetch": {"value": document_fetch, "formula": "responseEnd − fetchStart", "purpose": "Network trip including DNS, TCP, and response"},
        "domBuild": {"value": dom_build, "formula": "domInteractive − responseEnd", "purpose": "HTML parse and DOM tree construction"},
        "scriptTime": {"value": script_time, "formula": script_formula, "purpose": "Scripts and sub-resources after the DOM is interactive"},
        "loadEvent": {"value": load_event, "formula": load_formula, "purpose": "Remaining sub-resources and the load event"},
        "pageLoad": {"value": page_load, "formula": "loadEventEnd − navigationStart", "purpose": "Total page load time"},
    }


def build_practical_waterfall(milestones: dict[str, Any] | None, csv_row: dict | None = None) -> list[dict]:
    """Build stacked waterfall steps from Navigation Timing milestones (or CSV fallback)."""
    if milestones:
        ns = float(milestones.get("navigationStart") or 0)
        steps: list[dict] = []

        def add(label: str, start_ms: float, end_ms: float, formula: str, purpose: str) -> None:
            if ns <= 0 or end_ms <= 0:
                return
            duration = _dur(start_ms, end_ms)
            if duration <= 0:
                return
            steps.append({
                "label": label,
                "start": max(0, int(start_ms - ns)),
                "duration": duration,
                "formula": formula,
                "purpose": purpose,
            })

        dls = float(milestones.get("domainLookupStart") or 0)
        dle = float(milestones.get("domainLookupEnd") or 0)
        cs = float(milestones.get("connectStart") or 0)
        ce = float(milestones.get("connectEnd") or 0)
        scs = float(milestones.get("secureConnectionStart") or 0)
        rs = float(milestones.get("requestStart") or 0)
        resp_s = float(milestones.get("responseStart") or 0)
        resp_e = float(milestones.get("responseEnd") or 0)
        fs = float(milestones.get("fetchStart") or rs or 0)
        di = float(milestones.get("domInteractive") or 0)
        dcle = float(milestones.get("domContentLoadedEventEnd") or 0)
        le = float(milestones.get("loadEventEnd") or 0)

        add("DNS", dls, dle, "domainLookupEnd − domainLookupStart", "DNS resolution latency")
        add("TCP", cs, ce, "connectEnd − connectStart", "TCP handshake latency")
        if scs > 0:
            add("TLS", scs, rs, "requestStart − secureConnectionStart", "TLS/SSL negotiation")
        add("Server wait", ce, resp_s, "responseStart − connectEnd", "Time until first byte after connection")
        add("Document download", resp_s, resp_e, "responseEnd − responseStart", "Response body download")
        add("DOM build", resp_e, di, "domInteractive − responseEnd", "HTML parse and DOM construction")
        if dcle > 0:
            add("Script load/exec", di, dcle, "domContentLoadedEventEnd − domInteractive", "Defer/inline JS during parse")
            add("Load event", dcle, le, "loadEventEnd − domContentLoadedEventEnd", "Deferred subresources")
        elif le > 0:
            add("Load event", di, le, "loadEventEnd − domInteractive", "Remaining load lifecycle")

        if steps:
            return steps

    # CSV fallback — sequential estimate from aggregated columns
    if not csv_row:
        return []

    dns = int(csv_row.get("dnsLookupTime") or 0)
    tcp = int(csv_row.get("connectionTime") or 0)
    download = int(csv_row.get("serverProcessingTime") or 0)
    dom_build = int(csv_row.get("domInteractionTime") or 0)
    dom_complete = max(0, int(csv_row.get("domCompleteTime") or 0) - dom_build)
    page_load = int(csv_row.get("pageLoadTime") or 0)

    start = 0
    fallback: list[dict] = []

    def add_fb(label: str, duration: int, formula: str, purpose: str) -> None:
        nonlocal start
        if duration <= 0:
            return
        fallback.append({
            "label": label,
            "start": start,
            "duration": duration,
            "formula": formula,
            "purpose": purpose,
            "estimated": True,
        })
        start += duration

    add_fb("DNS", dns, "domainLookupEnd − domainLookupStart", "DNS resolution (from CSV)")
    add_fb("TCP", tcp, "connectEnd − connectStart", "TCP handshake (from CSV)")
    server_wait = max(0, int(csv_row.get("responseTime") or 0) - download - tcp - dns)
    add_fb("Server wait", server_wait, "estimated", "Request + server wait before download (estimated)")
    add_fb("Document download", download, "responseEnd − responseStart", "Response body (from CSV)")
    add_fb("DOM build", dom_build, "domInteractive − responseEnd", "DOM construction (approx. from CSV)")
    add_fb("DOM complete", dom_complete, "domComplete − domInteractive", "Post-interactive DOM (approx.)")
    remaining = max(0, page_load - start)
    add_fb("Load finish", remaining, "loadEventEnd − navigationStart", "Remaining to full load (estimated)")

    return fallback


def analyze_run(run_id: str, results_dir: Path) -> dict[str, Any]:
    run_dir = results_dir / f"Static_RunID_{run_id}"
    csv_path = run_dir / f"Static_Run_Report_RunID_{run_id}.csv"

    csv_rows = parse_csv_rows(csv_path)
    csv_by_url = {r["urlKey"]: r for r in csv_rows if r["urlKey"]}

    lighthouse_pages: dict[str, dict] = {}
    if run_dir.exists():
        for json_file in sorted(run_dir.glob("Infogain_UEM_DataFile*.json")):
            try:
                lh = parse_lighthouse_file(json_file)
                key = lh.get("urlKey") or ""
                if key:
                    lighthouse_pages[key] = lh
            except (json.JSONDecodeError, OSError) as exc:
                print(f"Warning: skip {json_file.name}: {exc}", file=sys.stderr)

    nav_by_url = load_nav_timing_files(run_dir)

    all_keys = list(dict.fromkeys([*csv_by_url.keys(), *lighthouse_pages.keys(), *nav_by_url.keys()]))
    pages: list[dict] = []

    for key in all_keys:
        csv_row = csv_by_url.get(key, {})
        lh = lighthouse_pages.get(key, {})
        nav_data = nav_by_url.get(key, {})
        milestones = nav_data.get("milestones") if nav_data else None
        practical_metrics = compute_practical_metrics(milestones) if milestones else None
        practical_waterfall = build_practical_waterfall(milestones, csv_row if csv_row else None)

        merged = {
            "transaction": csv_row.get("transaction") or page_label(lh) or page_label(csv_row),
            "pageUrl": csv_row.get("pageUrl") or lh.get("url", ""),
            "urlKey": key,
            "testStatus": csv_row.get("testStatus", "PASS"),
            "failureReason": csv_row.get("failureReason", ""),
            "timestamp": csv_row.get("timestamp", lh.get("fetchTime", "")),
            "hostname": csv_row.get("hostname", ""),
            # Prefer CSV navigation (measured in-browser); lighthouse for audits
            "fcp": csv_row.get("fcp") or lh.get("fcp", 0),
            "lcp": csv_row.get("lcp") or lh.get("lcp", 0),
            "tbt": csv_row.get("tbt") or lh.get("tbt", 0),
            "cls": csv_row.get("cls") or lh.get("cls", 0),
            "speedIndex": csv_row.get("speedIndex") or lh.get("speedIndex", 0),
            "performanceScore": csv_row.get("performanceScore") or lh.get("performanceScore", 0),
            "accessibilityScore": lh.get("accessibilityScore", 0),
            "bestPracticesScore": lh.get("bestPracticesScore", 0),
            "seoScore": lh.get("seoScore", 0),
            "pageLoadTime": csv_row.get("pageLoadTime", 0),
            "networkTime": csv_row.get("networkTime", 0),
            "dnsLookupTime": csv_row.get("dnsLookupTime", 0),
            "connectionTime": csv_row.get("connectionTime", 0),
            "serverProcessingTime": csv_row.get("serverProcessingTime", 0),
            "responseTime": csv_row.get("responseTime", 0),
            "browserTime": csv_row.get("browserTime", 0),
            "domInteractionTime": csv_row.get("domInteractionTime", 0),
            "domCompleteTime": csv_row.get("domCompleteTime", 0),
            "playwrightPageLoadTime": csv_row.get("playwrightPageLoadTime", 0),
            "elementLoadTime": csv_row.get("elementLoadTime", "N/A"),
            "lighthouseFile": lh.get("lighthouseFile", ""),
            "runWarnings": lh.get("runWarnings", []),
            "opportunities": lh.get("opportunities", []),
            "diagnostics": lh.get("diagnostics", []),
            "hasLighthouseJson": bool(lh),
            "hasNavigationData": bool(csv_row) or bool(milestones),
            "navTimingFile": nav_data.get("navTimingFile", ""),
            "practicalMetrics": practical_metrics,
            "practicalWaterfall": practical_waterfall,
        }
        pages.append(merged)

    pass_count = sum(1 for p in pages if p.get("testStatus") == "PASS")
    findings = []
    for p in pages:
        issues = build_findings(p)
        if issues:
            findings.append({
                "transaction": p.get("transaction", ""),
                "pageUrl": p.get("pageUrl", ""),
                "severity": severity(issues),
                "issues": issues,
                "testStatus": p.get("testStatus", "PASS"),
            })

    rank = {"high": 0, "medium": 1, "low": 2}
    findings.sort(key=lambda f: rank.get(f["severity"], 9))

    total = len(pages)
    summary = {
        "total": total,
        "passRate": round((pass_count / total) * 100) if total else 0,
        "avgScore": round(avg_key(pages, "performanceScore") * 100),
        "avgLcp": round(avg_key(pages, "lcp")),
        "avgFcp": round(avg_key(pages, "fcp")),
        "avgPageLoad": round(avg_key(pages, "pageLoadTime")),
        "avgNetwork": round(avg_key(pages, "networkTime")),
        "avgDns": round(avg_key(pages, "dnsLookupTime")),
        "avgTbt": round(avg_key(pages, "tbt")),
        "avgCls": round(avg_key(pages, "cls"), 3),
        "lighthouseJsonCount": sum(1 for p in pages if p.get("hasLighthouseJson")),
        "navigationRowCount": sum(1 for p in pages if p.get("hasNavigationData")),
    }

    charts = {
        "scores": [
            {
                "name": page_label(p),
                "score": round(float(p.get("performanceScore") or 0) * 100),
                "lcp": int(p.get("lcp") or 0),
                "pageLoad": int(p.get("pageLoadTime") or 0),
            }
            for p in pages
        ],
        "navigation": [
            {
                "name": page_label(p),
                "dns": int(p.get("dnsLookupTime") or 0),
                "connection": int(p.get("connectionTime") or 0),
                "server": int(p.get("serverProcessingTime") or 0),
                "response": int(p.get("responseTime") or 0),
                "browser": int(p.get("browserTime") or 0),
                "dom": int(p.get("domCompleteTime") or 0),
            }
            for p in pages
        ],
        "lighthouse": [
            {
                "name": page_label(p),
                "fcp": int(p.get("fcp") or 0),
                "lcp": int(p.get("lcp") or 0),
                "tbt": int(p.get("tbt") or 0),
                "cls": int(float(p.get("cls") or 0) * 1000),
                "speedIndex": int(p.get("speedIndex") or 0),
            }
            for p in pages
        ],
    }

    results = [
        {
            "runId": run_id,
            "timestamp": p.get("timestamp", ""),
            "hostname": p.get("hostname", ""),
            "transaction": p.get("transaction", ""),
            "pageUrl": p.get("pageUrl", ""),
            "fcp": int(p.get("fcp") or 0),
            "lcp": int(p.get("lcp") or 0),
            "tbt": int(p.get("tbt") or 0),
            "cls": float(p.get("cls") or 0),
            "speedIndex": int(p.get("speedIndex") or 0),
            "performanceScore": float(p.get("performanceScore") or 0),
            "pageLoadTime": int(p.get("pageLoadTime") or 0),
            "networkTime": int(p.get("networkTime") or 0),
            "dnsLookupTime": int(p.get("dnsLookupTime") or 0),
            "connectionTime": int(p.get("connectionTime") or 0),
            "serverProcessingTime": int(p.get("serverProcessingTime") or 0),
            "responseTime": int(p.get("responseTime") or 0),
            "browserTime": int(p.get("browserTime") or 0),
            "domInteractionTime": int(p.get("domInteractionTime") or 0),
            "domCompleteTime": int(p.get("domCompleteTime") or 0),
            "playwrightPageLoadTime": int(p.get("playwrightPageLoadTime") or 0),
            "elementLoadTime": p.get("elementLoadTime", "N/A"),
            "testStatus": p.get("testStatus", "PASS"),
            "failureReason": p.get("failureReason", ""),
            "lighthouseFile": p.get("lighthouseFile", ""),
            "opportunities": p.get("opportunities", []),
        }
        for p in pages
    ]

    html_path = run_dir / f"Consolidated_Report_RunID_{run_id}.html"

    report = {
        "runId": run_id,
        "results": results,
        "pages": pages,
        "analysis": {
            "summary": summary,
            "findings": findings,
            "charts": charts,
        },
        "meta": {
            "runDirectory": str(run_dir),
            "csvPath": str(csv_path),
            "csvExists": csv_path.exists(),
            "htmlReportPath": str(html_path),
            "analyzer": "python",
        },
    }

    try:
        from llm_go_live_analysis import analyze_go_live
        report["llmAnalysis"] = analyze_go_live(report)
    except Exception as exc:
        print(f"Warning: LLM analysis failed: {exc}", file=sys.stderr)
        report["llmAnalysis"] = None

    return report


def _bar(value: float, max_val: float, color: str = "#2563eb") -> str:
    width = min(100, int((value / max_val) * 100)) if max_val else 0
    return f'<div class="bar-wrap"><div class="bar" style="width:{width}%;background:{color}"></div><span>{int(value)}</span></div>'


def generate_html_report(report: dict[str, Any]) -> str:
    run_id = report.get("runId", "")
    analysis = report.get("analysis") or {}
    summary = analysis.get("summary") or {}
    findings = analysis.get("findings") or []
    pages = report.get("pages") or []
    meta = report.get("meta") or {}
    llm = report.get("llmAnalysis") or {}

    sev_style = {"high": "#fee2e2", "medium": "#fef3c7", "low": "#f1f5f9"}
    verdict_style = {
        "GO_LIVE": ("#ecfdf5", "#059669", "✓"),
        "CONDITIONAL": ("#fffbeb", "#d97706", "⚠"),
        "NOT_GO_LIVE": ("#fef2f2", "#dc2626", "✗"),
    }

    llm_html = ""
    if llm:
        v = llm.get("verdict", "CONDITIONAL")
        bg, color, icon = verdict_style.get(v, verdict_style["CONDITIONAL"])
        blockers = "".join(f"<li>{b}</li>" for b in (llm.get("justification") or {}).get("blockers", []))
        risks = "".join(f"<li>{r}</li>" for r in (llm.get("justification") or {}).get("risks", []))
        positives = "".join(f"<li>{p}</li>" for p in (llm.get("justification") or {}).get("positives", []))
        recs = "".join(f"<li>{r}</li>" for r in llm.get("recommendations", []))
        criteria_rows = ""
        for c in llm.get("criteria", []):
            st = c.get("status", "")
            badge_color = {"pass": "#059669", "warn": "#d97706", "fail": "#dc2626"}.get(st, "#64748b")
            criteria_rows += f"<tr><td>{c.get('name','')}</td><td><span style='color:{badge_color};font-weight:700'>{st.upper()}</span></td><td>{c.get('detail','')}</td></tr>"
        llm_html = f"""
  <section class="llm-verdict" style="background:{bg};border:2px solid {color};border-radius:12px;padding:24px;margin-bottom:24px">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap">
      <div>
        <div style="font-size:0.75rem;text-transform:uppercase;color:{color};font-weight:700;letter-spacing:0.05em">Go-live assessment · {llm.get('generatedBy','')}</div>
        <h2 style="margin:8px 0 0;font-size:1.5rem;color:{color}">{icon} {llm.get('verdictLabel','')}</h2>
        <p style="margin:12px 0 0;color:#334155;max-width:720px">{llm.get('executiveSummary','')}</p>
      </div>
      <div style="text-align:right"><div style="font-size:2rem;font-weight:700;color:{color}">{int(float(llm.get('confidence',0))*100)}%</div><div style="font-size:0.7rem;color:#64748b">confidence</div></div>
    </div>
    <p style="margin:16px 0 8px;font-weight:600">Justification</p>
    <p class="muted">{(llm.get('justification') or {}).get('summary','')}</p>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-top:16px">
      {f'<div><strong style="color:#dc2626">Blockers</strong><ul>{blockers or "<li>None</li>"}</ul></div>' if True else ''}
      <div><strong style="color:#d97706">Risks</strong><ul>{risks or '<li>None identified</li>'}</ul></div>
      <div><strong style="color:#059669">Strengths</strong><ul>{positives or '<li>None recorded</li>'}</ul></div>
    </div>
    <p style="margin:16px 0 8px;font-weight:600">Release criteria</p>
    <table style="width:100%;font-size:0.85rem"><thead><tr><th>Criterion</th><th>Status</th><th>Detail</th></tr></thead><tbody>{criteria_rows}</tbody></table>
    <p style="margin:16px 0 8px;font-weight:600">Recommendations</p>
    <ul>{recs}</ul>
  </section>"""

    findings_html = ""
    for f in findings:
        bg = sev_style.get(f.get("severity", "low"), "#f1f5f9")
        issues = "".join(f"<li>{i}</li>" for i in f.get("issues", []))
        findings_html += f"""
        <div class="finding" style="background:{bg}">
          <div class="finding-head"><strong>{f.get('transaction','')}</strong>
            <span class="badge">{f.get('severity','').upper()}</span></div>
          <div class="muted">{f.get('pageUrl','')}</div>
          <ul>{issues}</ul>
        </div>"""

    rows_html = ""
    for p in pages:
        score = int(float(p.get("performanceScore") or 0) * 100)
        rows_html += f"""<tr>
          <td>{p.get('transaction','')}</td>
          <td class="num">{score}</td>
          <td class="num">{int(p.get('fcp') or 0)}</td>
          <td class="num">{int(p.get('lcp') or 0)}</td>
          <td class="num">{int(p.get('tbt') or 0)}</td>
          <td class="num">{float(p.get('cls') or 0):.3f}</td>
          <td class="num nav">{int(p.get('pageLoadTime') or 0)}</td>
          <td class="num nav">{int(p.get('networkTime') or 0)}</td>
          <td class="num nav">{int(p.get('dnsLookupTime') or 0)}</td>
          <td class="num nav">{int(p.get('domCompleteTime') or 0)}</td>
          <td>{p.get('testStatus','')}</td>
          <td class="muted">{p.get('lighthouseFile','')}</td>
        </tr>"""

    opp_html = ""
    for p in pages:
        opps = p.get("opportunities") or []
        if not opps:
            continue
        items = "".join(
            f"<li>{o.get('title','')} "
            f"{'(est. ' + str(int(o.get('savingsMs',0))) + 'ms)' if o.get('savingsMs') else ''}</li>"
            for o in opps[:5]
        )
        opp_html += f"<div class='opp-block'><h4>{p.get('transaction','')}</h4><p class='muted'>{p.get('pageUrl','')}</p><ul>{items}</ul></div>"

    max_lcp = max((int(p.get("lcp") or 0) for p in pages), default=1)
    chart_bars = ""
    for p in pages:
        label = page_label(p)
        lcp = int(p.get("lcp") or 0)
        pl = int(p.get("pageLoadTime") or 0)
        score = int(float(p.get("performanceScore") or 0) * 100)
        chart_bars += f"<div class='chart-row'><span class='label'>{label}</span>{_bar(score, 100, '#2563eb')}<span class='sub'>LCP {lcp}ms · Nav {pl}ms</span></div>"

    return f"""<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Consolidated Report — Run {run_id}</title>
<style>
  body {{ font-family: system-ui, sans-serif; margin: 0; background: #f8fafc; color: #0f172a; }}
  .wrap {{ max-width: 1200px; margin: 0 auto; padding: 24px; }}
  h1 {{ margin: 0 0 8px; font-size: 1.75rem; }}
  .muted {{ color: #64748b; font-size: 0.85rem; }}
  .cards {{ display: grid; grid-template-columns: repeat(auto-fit,minmax(160px,1fr)); gap: 12px; margin: 20px 0; }}
  .card {{ background: #fff; border-radius: 10px; padding: 16px; box-shadow: 0 1px 3px rgb(0 0 0 / 8%); }}
  .card .val {{ font-size: 1.75rem; font-weight: 700; }}
  .card .lbl {{ font-size: 0.75rem; color: #94a3b8; text-transform: uppercase; }}
  section {{ background: #fff; border-radius: 10px; padding: 20px; margin-bottom: 20px; box-shadow: 0 1px 3px rgb(0 0 0 / 8%); }}
  table {{ width: 100%; border-collapse: collapse; font-size: 0.8rem; }}
  th, td {{ border-bottom: 1px solid #e2e8f0; padding: 8px; text-align: left; }}
  th {{ background: #f1f5f9; font-size: 0.7rem; text-transform: uppercase; color: #64748b; }}
  .num {{ font-variant-numeric: tabular-nums; }}
  .nav {{ color: #0369a1; font-weight: 600; }}
  .finding {{ border-radius: 8px; padding: 12px; margin-bottom: 10px; }}
  .finding-head {{ display: flex; justify-content: space-between; }}
  .badge {{ font-size: 0.7rem; font-weight: 700; }}
  .bar-wrap {{ display: flex; align-items: center; gap: 8px; flex: 1; }}
  .bar {{ height: 10px; border-radius: 4px; min-width: 2px; }}
  .chart-row {{ display: flex; align-items: center; gap: 12px; margin: 8px 0; }}
  .chart-row .label {{ width: 140px; font-size: 0.75rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }}
  .chart-row .sub {{ font-size: 0.7rem; color: #64748b; width: 160px; }}
  .opp-block {{ margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid #e2e8f0; }}
</style></head><body><div class="wrap">
  <h1>Consolidated Performance Report</h1>
  <p class="muted">Run ID {run_id} · Lighthouse JSON + Navigation Timing API · Generated by analyze_run_report.py</p>
  <p class="muted">Lighthouse files: {summary.get('lighthouseJsonCount',0)} · Navigation rows: {summary.get('navigationRowCount',0)}</p>

  {llm_html}

  <div class="cards">
    <div class="card"><div class="lbl">Pages</div><div class="val">{summary.get('total',0)}</div></div>
    <div class="card"><div class="lbl">Pass Rate</div><div class="val">{summary.get('passRate',0)}%</div></div>
    <div class="card"><div class="lbl">Avg Score</div><div class="val">{summary.get('avgScore',0)}</div></div>
    <div class="card"><div class="lbl">Avg LCP</div><div class="val">{summary.get('avgLcp',0)}ms</div></div>
    <div class="card"><div class="lbl">Avg Page Load</div><div class="val">{summary.get('avgPageLoad',0)}ms</div></div>
    <div class="card"><div class="lbl">Avg TBT</div><div class="val">{summary.get('avgTbt',0)}ms</div></div>
  </div>

  <section><h2>Performance Scores by Page</h2>{chart_bars or '<p class="muted">No data</p>'}</section>

  <section><h2>Findings ({len(findings)})</h2>{findings_html or '<p style="color:#059669">No critical findings.</p>'}</section>

  {f'<section><h2>Lighthouse Opportunities</h2>{opp_html}</section>' if opp_html else ''}

  <section><h2>Full Results — Lighthouse + Navigation</h2>
    <div style="overflow-x:auto"><table>
      <thead><tr>
        <th>Transaction</th><th>Score</th><th>FCP</th><th>LCP</th><th>TBT</th><th>CLS</th>
        <th>Page Load</th><th>Network</th><th>DNS</th><th>DOM</th><th>Status</th><th>LH File</th>
      </tr></thead><tbody>{rows_html}</tbody>
    </table></div>
  </section>
  <p class="muted">CSV: {meta.get('csvPath','')} · Run dir: {meta.get('runDirectory','')}</p>
</div></body></html>"""


def write_html_report(report: dict[str, Any]) -> str | None:
    html_path = report.get("meta", {}).get("htmlReportPath")
    if not html_path:
        return None
    path = Path(html_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(generate_html_report(report), encoding="utf-8")
    return str(path)


def main() -> int:
    parser = argparse.ArgumentParser(description="Analyze Lighthouse + Navigation data for a run")
    parser.add_argument("run_id", help="Run ID e.g. 0408")
    parser.add_argument("--results-dir", default=None, help="Path to Results directory")
    parser.add_argument("--write-html", action="store_true", help="Write Consolidated_Report_RunID_*.html")
    parser.add_argument("--json-only", action="store_true", help="Print JSON to stdout (default)")
    args = parser.parse_args()

    script_dir = Path(__file__).resolve().parent
    default_results = script_dir.parent.parent / "Results"
    results_dir = Path(args.results_dir) if args.results_dir else default_results

    if not re.match(r"^\d{4}$", args.run_id):
        print(json.dumps({"error": f"Invalid run_id: {args.run_id}"}))
        return 1

    report = analyze_run(args.run_id, results_dir)
    if args.write_html:
        write_html_report(report)

    print(json.dumps(report))
    return 0


if __name__ == "__main__":
    sys.exit(main())
