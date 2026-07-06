"""Read-side Langfuse query + aggregation "scripts" for the observability
dashboard. Separate from ai/observability.py (which only ever writes:
scores, spans, flush) — this module only ever reads Langfuse's data back out,
via the bundled REST query client (langfuse.api.client.LangfuseAPI, Basic Auth
with the same public/secret key pair already used for tracing).

Every turn is exactly one trace named "chat-turn" or "voice-turn" (see
ai/agent.py:run_turn) with every model call and tool execution nested under
it as child observations — that's what makes per-session cost, per-turn tool
usage, and the chat/voice split all directly computable from trace data
without any extra instrumentation.

Performance note: the Langfuse REST client is synchronous/blocking and each
page is a real network round-trip to Langfuse Cloud. A naive sequential
fetch over hundreds of traces (accumulated from testing) measured 60s+ for
a 30-day window — bad enough the dashboard looked hung. Two fixes below:
page 2..N fetched concurrently via a thread pool once page 1 reveals the
total page count, and a short-TTL in-memory cache so repeating the same
query (e.g. paging through the sessions table) doesn't re-fetch everything.
"""

from __future__ import annotations

import logging
import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from functools import lru_cache

from ai.config import get_settings
from db.client import execute_query, get_client

log = logging.getLogger(__name__)

_PAGE_LIMIT = 100
_CACHE_TTL_SECONDS = 45
_cache: dict[str, tuple[float, object]] = {}
_inflight: dict[str, Future] = {}
_cache_lock = threading.Lock()


def _cached(key: str, compute):
    """TTL cache with request coalescing: the frontend fires summary and
    sessions requests concurrently, and on a cold cache both used to start
    their own full fetch_traces() run at once — doubling the outbound
    Langfuse load right when it matters least (the very first, slowest
    load). Now a second caller for the same in-progress key just waits for
    the first caller's result instead of duplicating the work."""
    now = time.monotonic()
    with _cache_lock:
        hit = _cache.get(key)
        if hit is not None and now - hit[0] < _CACHE_TTL_SECONDS:
            return hit[1]
        future = _inflight.get(key)
        if future is not None:
            owner = False
        else:
            future = Future()
            _inflight[key] = future
            owner = True

    if not owner:
        return future.result()

    try:
        value = compute()
    except Exception as exc:
        future.set_exception(exc)
        with _cache_lock:
            _inflight.pop(key, None)
        raise
    with _cache_lock:
        _cache[key] = (time.monotonic(), value)
        _inflight.pop(key, None)
    future.set_result(value)
    return value


@lru_cache(maxsize=1)
def get_query_client():
    """A Langfuse REST read client, or None if Langfuse isn't configured."""
    try:
        s = get_settings()
        if not s.langfuse_enabled:
            return None
        from langfuse.api.client import LangfuseAPI

        return LangfuseAPI(
            base_url=s.langfuse_host,
            username=s.langfuse_public_key,
            password=s.langfuse_secret_key,
            # No timeout was set before — a slow/rate-limited Langfuse Cloud
            # response would hang indefinitely instead of failing fast (this
            # is what "still loading" turned out to be: not our pagination,
            # a single query that never returned at all).
            timeout=15.0,
        )
    except Exception as exc:
        log.warning("Langfuse query client init failed: %s", exc)
        return None


def _fetch_voice_durations_from_db(days: int) -> dict[str, float]:
    """Fetch call durations (in seconds) for voice sessions in the last N days."""
    client = get_client()
    if client is None:
        return {}
    since = datetime.now(timezone.utc) - timedelta(days=days)
    try:
        res = execute_query(
            client.table("sessions")
            .select("id, voice_started_at, ended_at")
            .eq("channel", "voice")
            .gte("voice_started_at", since.isoformat())
        )
        durations = {}
        for row in res.data:
            sid = row["id"]
            vstart = row.get("voice_started_at")
            vend = row.get("ended_at")
            if vstart and vend:
                t_start = datetime.fromisoformat(vstart.replace("Z", "+00:00"))
                t_end = datetime.fromisoformat(vend.replace("Z", "+00:00"))
                dur = (t_end - t_start).total_seconds()
                durations[sid] = max(0.0, dur)
            elif vstart:
                durations[sid] = 0.0
        return durations
    except Exception as exc:
        log.warning("Failed to fetch voice durations from DB: %s", exc)
        return {}


def _fetch_session_voice_durations(session_ids: list[str]) -> dict[str, float]:
    """Fetch call durations (in seconds) for specific session IDs."""
    client = get_client()
    if client is None or not session_ids:
        return {}
    try:
        res = execute_query(
            client.table("sessions")
            .select("id, voice_started_at, ended_at")
            .in_("id", session_ids)
        )
        durations = {}
        for row in res.data:
            sid = row["id"]
            vstart = row.get("voice_started_at")
            vend = row.get("ended_at")
            if vstart and vend:
                t_start = datetime.fromisoformat(vstart.replace("Z", "+00:00"))
                t_end = datetime.fromisoformat(vend.replace("Z", "+00:00"))
                dur = (t_end - t_start).total_seconds()
                durations[sid] = max(0.0, dur)
            elif vstart:
                durations[sid] = 0.0
        return durations
    except Exception as exc:
        log.warning("Failed to fetch voice durations for session list: %s", exc)
        return {}


def _channel_of(trace_name: str | None) -> str:
    if not trace_name:
        return "unknown"
    if trace_name.startswith("voice"):
        return "voice"
    if trace_name.startswith("chat"):
        return "chat"
    return "other"


def _is_conversation_turn(trace_name: str | None) -> bool:
    """True only for an actual chat-turn/voice-turn (see ai/agent.py:run_turn).

    Excludes ai/guardrails.py's separately-tagged "guardrail-classify" trace
    (same session_id, but not a conversational turn) — without this filter a
    chat-only session that ever triggered the LLM classifier (any message the
    fast heuristic couldn't decide on its own) picked up a second distinct
    "channel" value and got mislabeled "mixed" even though voice was never
    used."""
    return _channel_of(trace_name) in ("chat", "voice")


def _fetch_traces_uncached(days: int) -> list:
    client = get_query_client()
    if client is None:
        return []
    since = datetime.now(timezone.utc) - timedelta(days=days)

    # Filter at database level to only retrieve conversational turns (exclude guardrails/debug traces)
    # and restrict fields to core/metrics to avoid heavy payloads (exclude large input/output strings).
    import json

    filters = [
        {
            "type": "stringOptions",
            "column": "name",
            "operator": "any of",
            "value": ["chat-turn", "voice-turn"],
        }
    ]
    filter_str = json.dumps(filters)

    first = client.trace.list(
        page=1,
        limit=_PAGE_LIMIT,
        from_timestamp=since,
        fields="core,metrics",
        filter=filter_str,
    )
    total_pages = first.meta.total_pages or 1
    out: list = list(first.data)
    if total_pages <= 1:
        return out

    def _get_page(page: int):
        return client.trace.list(
            page=page,
            limit=_PAGE_LIMIT,
            from_timestamp=since,
            fields="core,metrics",
            filter=filter_str,
        ).data

    # Pages are independent requests — fetch the rest concurrently instead of
    # one-at-a-time. A thread pool is enough since the client itself blocks
    # on I/O, not CPU.
    with ThreadPoolExecutor(max_workers=8) as pool:
        for page_data in pool.map(_get_page, range(2, total_pages + 1)):
            out.extend(page_data)
    return [t for t in out if _is_conversation_turn(t.name)]


def fetch_traces(days: int) -> list:
    """Every turn-trace in the last `days` days, fully paginated (concurrently)
    and cached for _CACHE_TTL_SECONDS so repeated calls (e.g. paging through
    the sessions table, or the summary + sessions endpoints both wanting the
    same window) are instant instead of re-fetching everything.

    Cached by the integer `days` on purpose, not a computed `since` timestamp
    — a timestamp built fresh via datetime.now() on every call would never
    match a previous cache key even a millisecond later, silently defeating
    the cache entirely (measured: a "cached" call took *longer* than the
    first one before this fix, since accumulated data only grows over time)."""
    return _cached(f"traces:{days}", lambda: _fetch_traces_uncached(days))


def summary(days: int = 7) -> dict:
    """Overall totals + chat/voice split, from every turn-trace in the window."""
    traces = fetch_traces(days)

    sessions_seen: set[str] = set()
    totals = {"cost": 0.0, "turns": 0}
    by_channel: dict[str, dict] = {
        "chat": {"cost": 0.0, "turns": 0, "sessions": set()},
        "voice": {"cost": 0.0, "turns": 0, "sessions": set()},
    }

    for t in traces:
        cost = max(0.0, t.total_cost or 0.0)
        channel = _channel_of(t.name)
        totals["cost"] += cost
        totals["turns"] += 1
        if t.session_id:
            sessions_seen.add(t.session_id)
        if channel in by_channel:
            by_channel[channel]["cost"] += cost
            by_channel[channel]["turns"] += 1
            if t.session_id:
                by_channel[channel]["sessions"].add(t.session_id)

    # Query call durations from database
    durations = _fetch_voice_durations_from_db(days)
    total_dur = sum(durations.values())
    voice_cost_inr = total_dur * (30.0 / 3600.0)

    # Exclude sessions that have 0 duration (meaning no call duration was recorded/started)
    # to avoid skewing the average call duration and cost.
    valid_sessions = sum(1 for d in durations.values() if d > 0)
    avg_voice_dur = total_dur / valid_sessions if valid_sessions > 0 else 0.0
    avg_voice_cost = voice_cost_inr / valid_sessions if valid_sessions > 0 else 0.0

    return {
        "days": days,
        "total_cost": round(totals["cost"], 6),
        "total_turns": totals["turns"],
        "total_sessions": len(sessions_seen),
        "total_voice_duration": round(total_dur, 2),
        "total_voice_cost_inr": round(voice_cost_inr, 2),
        "avg_voice_duration": round(avg_voice_dur, 2),
        "avg_voice_cost_inr": round(avg_voice_cost, 2),
        "by_channel": {
            ch: {
                "cost": round(v["cost"], 6),
                "turns": v["turns"],
                "sessions": len(v["sessions"]),
                # Incorporate duration and INR cost metrics specifically under the voice channel
                **(
                    {
                        "voice_duration": round(total_dur, 2),
                        "voice_cost_inr": round(voice_cost_inr, 2),
                    }
                    if ch == "voice"
                    else {}
                ),
            }
            for ch, v in by_channel.items()
        },
    }


def sessions_table(days: int = 7, page: int = 1, limit: int = 25) -> dict:
    """One row per session: channel, turn count, total cost, first/last activity."""
    traces = fetch_traces(days)

    rows: dict[str, dict] = {}
    for t in traces:
        sid = t.session_id
        if not sid:
            continue
        row = rows.setdefault(
            sid,
            {
                "session_id": sid,
                "channels": set(),
                "turn_count": 0,
                "total_cost": 0.0,
                "first_seen": t.timestamp,
                "last_seen": t.timestamp,
            },
        )
        row["channels"].add(_channel_of(t.name))
        row["turn_count"] += 1
        row["total_cost"] += max(0.0, t.total_cost or 0.0)
        if t.timestamp < row["first_seen"]:
            row["first_seen"] = t.timestamp
        if t.timestamp > row["last_seen"]:
            row["last_seen"] = t.timestamp

    all_rows = sorted(rows.values(), key=lambda r: r["last_seen"], reverse=True)
    total = len(all_rows)
    start = (page - 1) * limit
    page_rows = all_rows[start : start + limit]

    # Fetch durations from DB for this page's sessions
    sids = [r["session_id"] for r in page_rows]
    durations = _fetch_session_voice_durations(sids)

    return {
        "page": page,
        "limit": limit,
        "total": total,
        "rows": [
            {
                "session_id": r["session_id"],
                "channel": (
                    "mixed"
                    if len(r["channels"]) > 1
                    else next(iter(r["channels"]), "unknown")
                ),
                "turn_count": r["turn_count"],
                "total_cost": round(r["total_cost"], 6),
                "first_seen": r["first_seen"].isoformat(),
                "last_seen": r["last_seen"].isoformat(),
                "voice_duration": round(durations.get(r["session_id"], 0.0), 2),
                "voice_cost_inr": round(
                    durations.get(r["session_id"], 0.0) * (30.0 / 3600.0), 2
                ),
            }
            for r in page_rows
        ],
    }


def _fetch_session_detail_uncached(session_id: str) -> dict | None:
    client = get_query_client()
    if client is None:
        return None

    # Filter at database level to only retrieve conversational turns and restrict fields to core.
    import json

    filters = [
        {
            "type": "stringOptions",
            "column": "name",
            "operator": "any of",
            "value": ["chat-turn", "voice-turn"],
        }
    ]
    filter_str = json.dumps(filters)

    traces = client.trace.list(
        session_id=session_id, limit=_PAGE_LIMIT, fields="core,io", filter=filter_str
    ).data
    sorted_traces = sorted(
        (t for t in traces if _is_conversation_turn(t.name)), key=lambda x: x.timestamp
    )

    # Filter at database level to only get TOOL and GENERATION observations to minimize payload.
    obs_filters = [
        {
            "type": "stringOptions",
            "column": "type",
            "operator": "any of",
            "value": ["TOOL", "GENERATION"],
        }
    ]
    obs_filter_str = json.dumps(obs_filters)

    def _get_observations(trace_id: str):
        # The v2 observations endpoint leaves name/model/cost unpopulated even
        # with an explicit fields= selector (confirmed live) — the older
        # legacy endpoint returns them filled in, so that's what this uses.
        return client.legacy.observations_v1.get_many(
            trace_id=trace_id, filter=obs_filter_str
        ).data

    with ThreadPoolExecutor(max_workers=8) as pool:
        all_obs = list(pool.map(_get_observations, [t.id for t in sorted_traces]))

    turns = []
    for t, obs in zip(sorted_traces, all_obs):
        tools_used = [
            {
                "name": o.name,
                "start_time": o.start_time.isoformat() if o.start_time else None,
                "end_time": o.end_time.isoformat() if o.end_time else None,
            }
            for o in obs
            if o.type == "TOOL"
        ]
        models_used = [
            {
                "model": o.model,
                "cost": max(0.0, (o.cost_details or {}).get("total") or 0.0),
            }
            for o in obs
            if o.type == "GENERATION"
        ]

        assistant_msg = None
        system_msg = None
        for o in obs:
            if o.type == "GENERATION" and o.output:
                if isinstance(o.output, dict):
                    c = o.output.get("content")
                    if c:
                        assistant_msg = c
                elif isinstance(o.output, str):
                    assistant_msg = o.output

                if o.input and isinstance(o.input, dict) and not system_msg:
                    msgs = o.input.get("messages") or []
                    for m in msgs:
                        if m.get("role") == "system":
                            system_msg = m.get("content")
                            break

        turns.append(
            {
                "trace_id": t.id,
                "timestamp": t.timestamp.isoformat(),
                "cost": max(0.0, round(t.total_cost or 0.0, 6)),
                "latency": (
                    t.latency if t.latency is not None and t.latency >= 0 else None
                ),
                "tools_used": tools_used,
                "models_used": models_used,
                "user_message": t.input if isinstance(t.input, str) else None,
                "assistant_message": assistant_msg,
                "system_message": system_msg,
            }
        )
    # Fetch call duration from DB
    durations = _fetch_session_voice_durations([session_id])
    duration = durations.get(session_id, 0.0)

    return {
        "session_id": session_id,
        "turn_count": len(turns),
        "total_cost": round(sum(x["cost"] for x in turns), 6),
        "voice_duration": round(duration, 2),
        "voice_cost_inr": round(duration * (30.0 / 3600.0), 2),
        "turns": turns,
    }


def session_detail(session_id: str) -> dict | None:
    """Every turn in one session, each with its nested tool calls + the LLM
    generation(s) that answered it — the "what tools ran in each turn" view.
    Per-trace observation fetches run concurrently (thread pool) instead of
    one at a time, and the whole result is cached briefly."""
    return _cached(
        f"session_detail:{session_id}",
        lambda: _fetch_session_detail_uncached(session_id),
    )


def scores(days: int = 7) -> list[dict]:
    """Retrieve recent evaluation scores."""
    client = get_query_client()
    if client is None:
        return []
    try:
        res = client.scores.get_many(limit=100)
        data = res.data or []
        out = []
        for s in data:
            out.append(
                {
                    "id": s.id,
                    "name": s.name,
                    "value": s.value,
                    # CATEGORICAL scores (model_used, guardrail_category) keep
                    # their real label here — the numeric `value` is only
                    # Langfuse's category index and is meaningless on its own.
                    "string_value": getattr(s, "string_value", None),
                    "session_id": s.session_id,
                    "trace_id": s.trace_id,
                    "comment": s.comment,
                    "timestamp": s.timestamp.isoformat() if s.timestamp else None,
                }
            )
        out.sort(key=lambda x: x["timestamp"] or "", reverse=True)
        return out
    except Exception as exc:
        log.warning("Fetch scores failed: %s", exc)
        return []
