#!/usr/bin/env python3
"""
Custom Performance LLM — analyzes Lighthouse + Navigation Timing data and
produces a go-live readiness verdict with justification and report details.

Uses a rule-based expert engine with optional OpenAI enhancement when
OPENAI_API_KEY is set (falls back to local analysis otherwise).
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any


# Core Web Vitals thresholds (Google)
LCP_GOOD = 2500
LCP_POOR = 4000
FCP_GOOD = 1800
TBT_GOOD = 300
CLS_GOOD = 0.1
SCORE_GOOD = 0.9
SCORE_ACCEPTABLE = 0.5
PASS_RATE_MIN = 90


def _score_pct(page: dict) -> int:
    return int(float(page.get("performanceScore") or 0) * 100)


def _fails_cwv(page: dict) -> list[str]:
    failures = []
    lcp = float(page.get("lcp") or 0)
    fcp = float(page.get("fcp") or 0)
    tbt = float(page.get("tbt") or 0)
    cls = float(page.get("cls") or 0)
    if lcp > LCP_GOOD:
        failures.append(f"LCP {int(lcp)}ms > {LCP_GOOD}ms")
    if fcp > FCP_GOOD:
        failures.append(f"FCP {int(fcp)}ms > {FCP_GOOD}ms")
    if tbt > TBT_GOOD:
        failures.append(f"TBT {int(tbt)}ms > {TBT_GOOD}ms")
    if cls > CLS_GOOD:
        failures.append(f"CLS {cls:.3f} > {CLS_GOOD}")
    return failures


def _evaluate_criteria(pages: list[dict], summary: dict, findings: list) -> list[dict]:
    total = summary.get("total") or len(pages) or 0
    pass_rate = summary.get("passRate") or 0
    avg_score = summary.get("avgScore") or 0
    avg_lcp = summary.get("avgLcp") or 0
    avg_cls = float(summary.get("avgCls") or 0)
    avg_tbt = summary.get("avgTbt") or 0

    cwv_failing_pages = sum(1 for p in pages if _fails_cwv(p))
    high_findings = sum(1 for f in findings if f.get("severity") == "high")
    fail_tests = sum(1 for p in pages if p.get("testStatus") == "FAIL")

    criteria = []

    def add(name: str, status: str, detail: str, weight: int) -> None:
        criteria.append({"name": name, "status": status, "detail": detail, "weight": weight})

    if total == 0:
        add("Data availability", "fail", "No pages were measured in this run.", 10)
        return criteria

    if pass_rate >= PASS_RATE_MIN:
        add("Test pass rate", "pass", f"{pass_rate}% of pages passed functional checks (threshold {PASS_RATE_MIN}%).", 2)
    elif pass_rate >= 70:
        add("Test pass rate", "warn", f"{pass_rate}% pass rate is below the {PASS_RATE_MIN}% production target.", 3)
    else:
        add("Test pass rate", "fail", f"Only {pass_rate}% of pages passed — functional failures block release.", 5)

    if avg_score >= int(SCORE_GOOD * 100):
        add("Lighthouse performance score", "pass", f"Average score {avg_score}/100 meets the {int(SCORE_GOOD * 100)}+ target.", 3)
    elif avg_score >= int(SCORE_ACCEPTABLE * 100):
        add("Lighthouse performance score", "warn", f"Average score {avg_score}/100 is acceptable but below ideal ({int(SCORE_GOOD * 100)}+).", 4)
    else:
        add("Lighthouse performance score", "fail", f"Average score {avg_score}/100 is below acceptable minimum ({int(SCORE_ACCEPTABLE * 100)}).", 6)

    if cwv_failing_pages == 0:
        add("Core Web Vitals", "pass", "All measured pages meet LCP, FCP, TBT, and CLS thresholds.", 4)
    elif cwv_failing_pages <= max(1, total // 4):
        add("Core Web Vitals", "warn", f"{cwv_failing_pages} of {total} pages fail at least one Core Web Vital.", 5)
    else:
        add("Core Web Vitals", "fail", f"{cwv_failing_pages} of {total} pages fail Core Web Vitals — user experience at risk.", 7)

    if avg_lcp <= LCP_GOOD:
        add("Largest Contentful Paint", "pass", f"Average LCP {int(avg_lcp)}ms is within the {LCP_GOOD}ms good range.", 2)
    elif avg_lcp <= LCP_POOR:
        add("Largest Contentful Paint", "warn", f"Average LCP {int(avg_lcp)}ms needs improvement (target ≤ {LCP_GOOD}ms).", 4)
    else:
        add("Largest Contentful Paint", "fail", f"Average LCP {int(avg_lcp)}ms is in the poor range (>{LCP_POOR}ms).", 6)

    if avg_cls <= CLS_GOOD:
        add("Layout stability (CLS)", "pass", f"Average CLS {avg_cls:.3f} is stable.", 2)
    else:
        add("Layout stability (CLS)", "fail", f"Average CLS {avg_cls:.3f} exceeds {CLS_GOOD} — visible layout shift risk.", 5)

    if avg_tbt <= TBT_GOOD:
        add("Total Blocking Time", "pass", f"Average TBT {int(avg_tbt)}ms indicates responsive main thread.", 2)
    else:
        add("Total Blocking Time", "warn", f"Average TBT {int(avg_tbt)}ms suggests heavy JavaScript blocking interaction.", 4)

    if high_findings == 0:
        add("Critical findings", "pass", "No high-severity performance findings detected.", 2)
    elif high_findings <= 2:
        add("Critical findings", "warn", f"{high_findings} high-severity finding(s) require review before release.", 4)
    else:
        add("Critical findings", "fail", f"{high_findings} high-severity findings indicate systemic performance debt.", 6)

    if fail_tests == 0:
        add("Functional test status", "pass", "All pages completed without test failures.", 2)
    else:
        add("Functional test status", "fail", f"{fail_tests} page(s) reported FAIL status in the test run.", 5)

    return criteria


def _compute_verdict(criteria: list[dict]) -> tuple[str, str, float]:
    fail_weight = sum(c["weight"] for c in criteria if c["status"] == "fail")
    warn_weight = sum(c["weight"] for c in criteria if c["status"] == "warn")
    pass_count = sum(1 for c in criteria if c["status"] == "pass")

    if fail_weight >= 10:
        return "NOT_GO_LIVE", "Not ready for production", min(0.95, 0.5 + fail_weight * 0.03)
    if fail_weight >= 5 or warn_weight >= 12:
        return "CONDITIONAL", "Conditional release — fix blockers before full rollout", min(0.85, 0.55 + warn_weight * 0.02)
    if warn_weight >= 5:
        return "CONDITIONAL", "Conditional release — acceptable with known risks", min(0.8, 0.6 + pass_count * 0.04)
    return "GO_LIVE", "Ready to go live", min(0.98, 0.75 + pass_count * 0.03)


def _build_justification(verdict: str, criteria: list[dict], pages: list[dict], findings: list) -> dict[str, Any]:
    blockers = [c["detail"] for c in criteria if c["status"] == "fail"]
    risks = [c["detail"] for c in criteria if c["status"] == "warn"]
    positives = [c["detail"] for c in criteria if c["status"] == "pass"]

    if verdict == "GO_LIVE":
        summary = (
            "Performance measurements indicate the application meets production readiness thresholds. "
            "Core Web Vitals, Lighthouse scores, and functional test results are within acceptable limits "
            "for a production release."
        )
    elif verdict == "NOT_GO_LIVE":
        summary = (
            "Performance data shows material gaps that make a production release risky. "
            "Critical metrics fail established thresholds and should be remediated before go-live."
        )
    else:
        summary = (
            "The application shows mixed performance signals. A limited or staged release may be acceptable "
            "if documented risks are accepted and a remediation plan is in place for failing areas."
        )

    return {
        "summary": summary,
        "blockers": blockers,
        "risks": risks,
        "positives": positives,
    }


def _recommendations(pages: list[dict], findings: list) -> list[str]:
    recs: list[str] = []
    seen: set[str] = set()

    for f in findings:
        if f.get("severity") != "high":
            continue
        for issue in (f.get("issues") or [])[:2]:
            if issue not in seen:
                seen.add(issue)
                recs.append(f"Address on {f.get('transaction', 'page')}: {issue}")

    for p in pages:
        for opp in (p.get("opportunities") or [])[:2]:
            title = opp.get("title", "")
            savings = int(opp.get("savingsMs") or 0)
            text = f"Implement Lighthouse recommendation: {title}" + (f" (est. {savings}ms savings)" if savings else "")
            if text not in seen and len(recs) < 8:
                seen.add(text)
                recs.append(text)

    if not recs:
        recs.append("Continue monitoring Core Web Vitals in production using Real User Monitoring (RUM).")
    if len(recs) < 4:
        recs.append("Re-run tests after deployments to catch regressions early.")
    return recs[:10]


def _per_page_summary(pages: list[dict]) -> list[dict]:
    out = []
    for p in pages:
        cwv = _fails_cwv(p)
        out.append({
            "transaction": p.get("transaction", ""),
            "pageUrl": p.get("pageUrl", ""),
            "score": _score_pct(p),
            "lcp": int(p.get("lcp") or 0),
            "pageLoadTime": int(p.get("pageLoadTime") or 0),
            "testStatus": p.get("testStatus", "PASS"),
            "cwvStatus": "fail" if cwv else "pass",
            "cwvIssues": cwv,
            "hasLighthouse": bool(p.get("hasLighthouseJson")),
        })
    return out


def _executive_summary(verdict: str, label: str, summary: dict, pages: list[dict]) -> str:
    total = summary.get("total") or len(pages)
    avg_score = summary.get("avgScore") or 0
    avg_lcp = summary.get("avgLcp") or 0
    pass_rate = summary.get("passRate") or 0

    return (
        f"Verdict: {label}. "
        f"Analyzed {total} page(s) with average Lighthouse score {avg_score}/100, "
        f"average LCP {int(avg_lcp)}ms, and {pass_rate}% functional pass rate. "
        f"This assessment is based on lab Lighthouse audits and in-browser Navigation Timing measurements."
    )


def _try_openai_enhancement(base: dict[str, Any], report: dict[str, Any]) -> dict[str, Any] | None:
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key:
        return None

    model = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
    prompt = (
        "You are a senior web performance engineer. Given this JSON performance report, "
        "write a concise executive paragraph (3-4 sentences) explaining whether the app is ready for production "
        "and the top 2 reasons. Respond with JSON only: {\"executiveSummary\": \"...\", \"topReasons\": [\"...\", \"...\"]}\n\n"
        + json.dumps({
            "verdict": base.get("verdict"),
            "summary": report.get("analysis", {}).get("summary"),
            "findings": report.get("analysis", {}).get("findings", [])[:5],
            "criteria": base.get("criteria"),
        }, indent=2)
    )

    body = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.3,
        "response_format": {"type": "json_object"},
    }).encode("utf-8")

    req = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions",
        data=body,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        content = data["choices"][0]["message"]["content"]
        return json.loads(content)
    except (urllib.error.URLError, KeyError, json.JSONDecodeError, IndexError):
        return None


def analyze_go_live(report: dict[str, Any]) -> dict[str, Any]:
    """Produce go-live readiness analysis from a consolidated run report."""
    analysis = report.get("analysis") or {}
    summary = analysis.get("summary") or {}
    findings = analysis.get("findings") or []
    pages = report.get("pages") or report.get("results") or []
    run_id = report.get("runId", "")

    criteria = _evaluate_criteria(pages, summary, findings)
    verdict, label, confidence = _compute_verdict(criteria)
    justification = _build_justification(verdict, criteria, pages, findings)
    recommendations = _recommendations(pages, findings)
    per_page = _per_page_summary(pages)

    critical_issues = []
    for f in findings:
        if f.get("severity") in ("high", "medium"):
            critical_issues.append({
                "transaction": f.get("transaction", ""),
                "pageUrl": f.get("pageUrl", ""),
                "severity": f.get("severity"),
                "issues": f.get("issues", []),
            })

    result: dict[str, Any] = {
        "verdict": verdict,
        "verdictLabel": label,
        "confidence": round(confidence, 2),
        "executiveSummary": _executive_summary(verdict, label, summary, pages),
        "justification": justification,
        "criteria": criteria,
        "recommendations": recommendations,
        "reportDetails": {
            "runId": run_id,
            "pagesAnalyzed": summary.get("total") or len(pages),
            "lighthouseFiles": summary.get("lighthouseJsonCount", 0),
            "navigationRows": summary.get("navigationRowCount", 0),
            "passRate": summary.get("passRate", 0),
            "avgScore": summary.get("avgScore", 0),
            "avgLcp": summary.get("avgLcp", 0),
            "avgPageLoad": summary.get("avgPageLoad", 0),
            "criticalIssues": critical_issues,
            "perPageSummary": per_page,
        },
        "generatedBy": "performance-llm-v1",
        "llmEnhanced": False,
    }

    openai_extra = _try_openai_enhancement(result, report)
    if openai_extra:
        if openai_extra.get("executiveSummary"):
            result["executiveSummary"] = openai_extra["executiveSummary"]
        if openai_extra.get("topReasons"):
            result["justification"]["llmTopReasons"] = openai_extra["topReasons"]
        result["llmEnhanced"] = True
        result["generatedBy"] = "performance-llm-v1+openai"

    return result
