"use client";

import { ArrowLeft, Phone, Wrench } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  getDashboardSessionDetail,
  getDashboardSessions,
  getDashboardSummary,
  getDashboardEscalations,
  getDashboardScores,
  type DashboardSessionDetail,
  type DashboardSessionRow,
  type DashboardSummary,
  type DashboardEscalation,
  type DashboardScore,
} from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { cn } from "@/lib/utils";

/** Costs from Langfuse are USD (OpenRouter model pricing), not INR — kept
 *  distinct from lib/utils.ts's formatINR (which is for order totals). */
function formatUSD(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || isNaN(amount)) return "-";
  const val = Math.max(0, amount);
  return `$${val.toFixed(val < 0.01 ? 6 : 4)}`;
}

function formatINR(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || isNaN(amount)) return "-";
  const val = Math.max(0, amount);
  return `₹${val.toFixed(2)}`;
}

function formatDuration(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || isNaN(sec) || sec <= 0) return "-";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function channelBadgeVariant(channel: string): "primary" | "accent" | "default" {
  if (channel === "chat") return "primary";
  if (channel === "voice") return "accent";
  return "default";
}

const DAYS_OPTIONS = [7, 30, 90] as const;

/**
 * Standalone observability dashboard (see dashboard/ package on the backend):
 * per-session LLM cost, chat vs voice split, and a drill-down into each
 * session's turns showing which tools ran and which model answered. Sarvam
 * STT/TTS cost is not included yet (tracked as a follow-up).
 */
export default function DashboardPage() {
  const token = useAuthStore((s) => s.token);
  const [activeTab, setActiveTab] = useState<"observability" | "evaluation" | "escalations">("escalations");
  const [days, setDays] = useState<(typeof DAYS_OPTIONS)[number]>(7);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);

  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<DashboardSessionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [rowsLoading, setRowsLoading] = useState(true);
  const [rowsError, setRowsError] = useState<string | null>(null);

  const [selectedSession, setSelectedSession] = useState<string | null>(null);

  const [scores, setScores] = useState<DashboardScore[]>([]);
  const [scoresLoading, setScoresLoading] = useState(false);
  const [scoresError, setScoresError] = useState<string | null>(null);

  const [escalations, setEscalations] = useState<DashboardEscalation[]>([]);
  const [escalationsLoading, setEscalationsLoading] = useState(false);
  const [escalationsError, setEscalationsError] = useState<string | null>(null);

  const limit = 20;

  const loadSummary = useCallback(async () => {
    if (!token) return;
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      setSummary(await getDashboardSummary(token, days));
    } catch (err) {
      setSummaryError(
        err instanceof Error ? err.message : "Couldn't load the summary."
      );
    } finally {
      setSummaryLoading(false);
    }
  }, [token, days]);

  const loadRows = useCallback(async () => {
    if (!token) return;
    setRowsLoading(true);
    setRowsError(null);
    try {
      const res = await getDashboardSessions(token, { days, page, limit });
      setRows(res.rows);
      setTotal(res.total);
    } catch (err) {
      setRowsError(
        err instanceof Error ? err.message : "Couldn't load sessions."
      );
    } finally {
      setRowsLoading(false);
    }
  }, [token, days, page]);

  const loadScores = useCallback(async () => {
    if (!token) return;
    setScoresLoading(true);
    setScoresError(null);
    try {
      setScores(await getDashboardScores(token, days));
    } catch (err) {
      setScoresError(
        err instanceof Error ? err.message : "Couldn't load evaluation scores."
      );
    } finally {
      setScoresLoading(false);
    }
  }, [token, days]);

  const loadEscalations = useCallback(async () => {
    if (!token) return;
    setEscalationsLoading(true);
    setEscalationsError(null);
    try {
      setEscalations(await getDashboardEscalations(token));
    } catch (err) {
      setEscalationsError(
        err instanceof Error ? err.message : "Couldn't load escalations."
      );
    } finally {
      setEscalationsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  // All tabs load eagerly on mount (not on first visit) so switching tabs is
  // instant — the slow Langfuse-backed calls warm up in the background while
  // the fast escalations tab is on screen. The backend coalesces the
  // concurrent trace fetches, so this doesn't duplicate outbound load.
  useEffect(() => {
    void loadScores();
  }, [loadScores]);

  useEffect(() => {
    void loadEscalations();
  }, [loadEscalations]);

  if (selectedSession) {
    return (
      <SessionDetailView
        sessionId={selectedSession}
        onBack={() => setSelectedSession(null)}
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-6 py-6">
      {/* Title Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold">AI Operations (AIOps)</h1>
          <p className="text-sm text-muted-foreground">
            Monitor system costs, verify guardrail outcomes, and track human escalations across chat and voice sessions.
          </p>
        </div>
        {activeTab !== "escalations" && (
          <div className="flex gap-1 rounded-lg border border-border bg-surface-2 p-1">
            {DAYS_OPTIONS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => {
                  setDays(d);
                  setPage(1);
                }}
                className={cn(
                  "cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  days === d
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {d}d
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Tabs list */}
      <div className="flex border-b border-border gap-1">
        {(["escalations", "observability", "evaluation"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={cn(
              "cursor-pointer px-4 py-2 text-sm font-semibold border-b-2 transition-all capitalize -mb-[2px]",
              activeTab === tab
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab contents */}
      {activeTab === "observability" && (
        <div className="space-y-6">
          <SummaryCards
            summary={summary}
            loading={summaryLoading}
            error={summaryError}
          />
          <SessionsTable
            rows={rows}
            total={total}
            page={page}
            limit={limit}
            loading={rowsLoading}
            error={rowsError}
            onPageChange={setPage}
            onSelect={setSelectedSession}
          />
        </div>
      )}

      {activeTab === "evaluation" && (
        <EvaluationView
          scores={scores}
          loading={scoresLoading}
          error={scoresError}
          token={token}
          onSelect={setSelectedSession}
        />
      )}

      {activeTab === "escalations" && (
        <EscalationsView
          escalations={escalations}
          loading={escalationsLoading}
          error={escalationsError}
          totalSessions={summary?.total_sessions || 0}
          onSelect={setSelectedSession}
        />
      )}
    </div>
  );
}

function SummaryCards({
  summary,
  loading,
  error,
}: {
  summary: DashboardSummary | null;
  loading: boolean;
  error: string | null;
}) {
  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl bg-surface-2" />
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    );
  }
  if (!summary) return null;

  return (
    <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
      <Card className="space-y-1 p-4">
        <p className="text-xs text-muted-foreground">Total cost</p>
        <p className="font-heading text-2xl font-bold tabular-nums">
          {formatUSD(summary.total_cost)}
        </p>
        <p className="text-xs text-muted-foreground">
          {summary.total_turns} turns
        </p>
      </Card>
      <Card className="space-y-1 p-4">
        <p className="text-xs text-muted-foreground">Sessions</p>
        <p className="font-heading text-2xl font-bold tabular-nums">
          {summary.total_sessions}
        </p>
        <p className="text-xs text-muted-foreground">last {summary.days} days</p>
      </Card>
      <Card className="space-y-1 p-4">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Badge variant="primary">Chat</Badge>
        </p>
        <p className="font-heading text-2xl font-bold tabular-nums">
          {formatUSD(summary.by_channel.chat.cost)}
        </p>
        <p className="text-xs text-muted-foreground">
          {summary.by_channel.chat.turns} turns · {summary.by_channel.chat.sessions} sessions
          <br />
          <span className="text-[10px] text-muted-foreground">
            Avg: {formatUSD(summary.by_channel.chat.sessions > 0 ? summary.by_channel.chat.cost / summary.by_channel.chat.sessions : 0)}/sess
          </span>
        </p>
      </Card>
      <Card className="space-y-1 p-4">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Badge variant="accent">Voice (LLM)</Badge>
        </p>
        <p className="font-heading text-2xl font-bold tabular-nums">
          {formatUSD(summary.by_channel.voice.cost)}
        </p>
        <p className="text-xs text-muted-foreground">
          {summary.by_channel.voice.turns} turns · {summary.by_channel.voice.sessions} sessions
          <br />
          <span className="text-[10px] text-muted-foreground">
            Avg: {formatUSD(summary.by_channel.voice.sessions > 0 ? summary.by_channel.voice.cost / summary.by_channel.voice.sessions : 0)}/sess
          </span>
        </p>
      </Card>
      <Card className="space-y-1 p-4">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Badge variant="accent">Sarvam STT/TTS</Badge>
        </p>
        <p className="font-heading text-2xl font-bold tabular-nums">
          {formatINR(summary.total_voice_cost_inr ?? 0)}
        </p>
        <p className="text-xs text-muted-foreground">
          {formatDuration(summary.total_voice_duration ?? 0)} call time
          <br />
          <span className="text-[10px] text-muted-foreground">
            Avg time: {formatDuration(summary.avg_voice_duration)}
            <br />
            Avg cost: {formatINR(summary.avg_voice_cost_inr)}/sess
          </span>
        </p>
      </Card>
    </div>
  );
}

function SessionsTable({
  rows,
  total,
  page,
  limit,
  loading,
  error,
  onPageChange,
  onSelect,
}: {
  rows: DashboardSessionRow[];
  total: number;
  page: number;
  limit: number;
  loading: boolean;
  error: string | null;
  onPageChange: (p: number) => void;
  onSelect: (sessionId: string) => void;
}) {
  const [filter, setFilter] = useState("");
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const filtered = rows.filter((r) =>
    r.session_id.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">Sessions</h2>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Filter by Session ID..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="rounded border border-border bg-surface-2 px-2.5 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary w-48 sm:w-64"
          />
          <span className="text-xs text-muted-foreground">{filtered.length} shown</span>
        </div>
      </div>
      {loading ? (
        <div className="space-y-2 p-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-11 animate-pulse rounded-lg bg-surface-2" />
          ))}
        </div>
      ) : error ? (
        <p role="alert" className="p-4 text-sm text-destructive">
          {error}
        </p>
      ) : filtered.length === 0 ? (
        <p className="p-6 text-center text-sm text-muted-foreground">
          No sessions match the filter.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-semibold">Session</th>
                <th className="px-4 py-3 font-semibold">Channel</th>
                <th className="px-4 py-3 font-semibold">Turns</th>
                <th className="px-4 py-3 font-semibold">LLM Cost</th>
                <th className="px-4 py-3 font-semibold">Call Time</th>
                <th className="px-4 py-3 font-semibold">Sarvam Cost</th>
                <th className="px-4 py-3 font-semibold">Last activity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((r) => (
                <tr
                  key={r.session_id}
                  onClick={() => onSelect(r.session_id)}
                  className="cursor-pointer hover:bg-surface-2"
                >
                  <td className="px-4 py-3 font-mono text-xs">
                    {r.session_id}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={channelBadgeVariant(r.channel)}>
                      {r.channel}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 tabular-nums">{r.turn_count}</td>
                  <td className="px-4 py-3 tabular-nums">
                    {formatUSD(r.total_cost)}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-muted-foreground">
                    {r.channel === "voice" || r.channel === "mixed" ? formatDuration(r.voice_duration) : "-"}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-muted-foreground">
                    {r.channel === "voice" || r.channel === "mixed" ? formatINR(r.voice_cost_inr) : "-"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(r.last_seen).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!loading && !error && totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-border px-4 py-3">
          <Button
            size="sm"
            variant="outline"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            Previous
          </Button>
          <span className="text-xs text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </Card>
  );
}

function SessionDetailView({
  sessionId,
  onBack,
}: {
  sessionId: string;
  onBack: () => void;
}) {
  const token = useAuthStore((s) => s.token);
  const [detail, setDetail] = useState<DashboardSessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      setDetail(await getDashboardSessionDetail(token, sessionId));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Couldn't load this session."
      );
    } finally {
      setLoading(false);
    }
  }, [token, sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-6 py-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to sessions"
          className="grid size-9 cursor-pointer place-items-center rounded-full text-foreground transition-colors hover:bg-surface-2 [&_svg]:size-5"
        >
          <ArrowLeft />
        </button>
        <div>
          <h1 className="flex items-center gap-2 font-heading text-xl font-bold">
            <Phone className="size-4 text-muted-foreground" />
            <span className="font-mono text-base">{sessionId}</span>
          </h1>
          {detail && (
            <p className="text-sm text-muted-foreground flex flex-wrap gap-x-2 gap-y-1">
              <span>{detail.turn_count} turns</span>
              <span>·</span>
              <span>{formatUSD(detail.total_cost)} LLM cost</span>
              {detail.voice_duration > 0 && (
                <>
                  <span>·</span>
                  <span>{formatDuration(detail.voice_duration)} call duration</span>
                  <span>·</span>
                  <span>{formatINR(detail.voice_cost_inr)} Sarvam cost</span>
                </>
              )}
            </p>
          )}
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-surface-2" />
          ))}
        </div>
      ) : error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : !detail || detail.turns.length === 0 ? (
        <p className="text-sm text-muted-foreground">No turns found.</p>
      ) : (
        <div className="space-y-3">
          {detail.turns.map((turn, i) => (
            <Card key={turn.trace_id} className="space-y-2 p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">Turn {i + 1}</span>
                <span className="text-xs text-muted-foreground">
                  {new Date(turn.timestamp).toLocaleString()} ·{" "}
                  {formatUSD(turn.cost)}
                  {turn.latency != null && turn.latency >= 0 && ` · ${turn.latency.toFixed(2)}s`}
                </span>
              </div>
              {turn.models_used.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {turn.models_used.map((m, j) => (
                    <Badge key={j} variant="primary">
                      {m.model ?? "unknown model"}
                    </Badge>
                  ))}
                </div>
              )}
              {turn.tools_used.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {turn.tools_used.map((t, j) => (
                    <span
                      key={j}
                      className="flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-0.5 text-xs text-muted-foreground"
                    >
                      <Wrench className="size-3" />
                      {t.name ?? "unknown tool"}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No tools called</p>
              )}

              {/* Messages display */}
              {(turn.user_message || turn.assistant_message || turn.system_message) && (
                <div className="mt-3 space-y-2 border-t border-border pt-3">
                  {turn.user_message && (
                    <div className="rounded-lg bg-surface-2 p-2.5 text-sm text-foreground">
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">User Message</p>
                      <p className="whitespace-pre-wrap">{turn.user_message}</p>
                    </div>
                  )}
                  {turn.assistant_message && (
                    <div className="rounded-lg border border-border p-2.5 text-sm text-foreground">
                      <p className="text-[10px] font-semibold text-primary uppercase tracking-wider mb-1">Assistant Reply</p>
                      <p className="whitespace-pre-wrap">{turn.assistant_message}</p>
                    </div>
                  )}
                  {turn.system_message && (
                    <details className="cursor-pointer text-xs text-muted-foreground">
                      <summary className="font-medium hover:text-foreground">System Prompt (view details)</summary>
                      <pre className="mt-2 max-h-40 overflow-y-auto rounded bg-surface-2 p-2 font-mono text-[11px] whitespace-pre-wrap border border-border select-all">
                        {turn.system_message}
                      </pre>
                    </details>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}


/** Friendly names for the auto-scores written by ai/observability.py. */
const SCORE_LABELS: Record<string, string> = {
  model_used: "Model answered",
  guardrail_category: "Guardrail check",
  order_placed: "Order placed",
  escalated: "Escalated to human",
  stt_failed: "Speech-to-text",
  tts_failed: "Text-to-speech",
  tool_error: "Tool execution",
  tts_latency_seconds: "TTS latency",
};

/** Render one raw score as a human-readable badge. Categorical scores carry
 *  their real label in string_value — the numeric value is only Langfuse's
 *  category index (model_used "0" just means "first model name seen"). */
function scoreDisplay(s: DashboardScore): {
  text: string;
  variant: "success" | "destructive" | "primary" | "default";
} {
  switch (s.name) {
    case "model_used": {
      const label = s.string_value || `model #${s.value}`;
      return { text: label.split("/").pop() || label, variant: "primary" };
    }
    case "guardrail_category": {
      const safe = !s.string_value || s.string_value === "SAFE";
      return { text: s.string_value || "SAFE", variant: safe ? "default" : "destructive" };
    }
    case "order_placed":
      return s.value === 1
        ? { text: "✓ placed", variant: "success" }
        : { text: "not placed", variant: "default" };
    case "escalated":
      return s.value === 1
        ? { text: "⚠ yes", variant: "destructive" }
        : { text: "no", variant: "default" };
    case "stt_failed":
    case "tts_failed":
    case "tool_error":
      return s.value === 1
        ? { text: "failed", variant: "destructive" }
        : { text: "ok", variant: "success" };
    case "tts_latency_seconds":
      return { text: `${s.value.toFixed(1)}s`, variant: s.value > 5 ? "destructive" : "default" };
    default:
      return { text: s.string_value ?? String(s.value), variant: "default" };
  }
}

function EvaluationView({
  scores,
  loading,
  error,
  token,
  onSelect,
}: {
  scores: DashboardScore[];
  loading: boolean;
  error: string | null;
  token: string | null;
  onSelect: (sid: string) => void;
}) {
  const [filter, setFilter] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DashboardSessionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    if (!selectedSessionId || !token) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    getDashboardSessionDetail(token, selectedSessionId)
      .then(setDetail)
      .catch((err) => console.error("Error loading session detail:", err))
      .finally(() => setDetailLoading(false));
  }, [selectedSessionId, token]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-surface-2" />
          ))}
        </div>
        <div className="h-64 animate-pulse rounded-xl bg-surface-2" />
      </div>
    );
  }

  if (error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    );
  }

  // ---- interpret the raw auto-scores (written by ai/observability.py) ----
  // "warmup" is the service pinging itself at startup, not a customer chat.
  const real = scores.filter((s) => s.session_id !== "warmup");
  const uniqueSessions = new Set(real.map((s) => s.session_id).filter(Boolean));

  // Conversion: order_placed is only ever written when an order is saved.
  const ordersPlaced = real.filter((s) => s.name === "order_placed" && s.value === 1);
  const conversionRate = uniqueSessions.size > 0 ? (ordersPlaced.length / uniqueSessions.size) * 100 : 0;

  // Escalations: sessions that asked for a human.
  const escalatedCount = real.filter((s) => s.name === "escalated" && s.value === 1).length;
  const escalationRate = uniqueSessions.size > 0 ? (escalatedCount / uniqueSessions.size) * 100 : 0;

  // Guardrails: every screened message logs its category; anything not SAFE
  // was blocked (injection / abuse / off-topic).
  const guardrailScores = real.filter((s) => s.name === "guardrail_category");
  const guardrailFlags = guardrailScores.filter((s) => s.string_value && s.string_value !== "SAFE");
  const guardrailRate = guardrailScores.length > 0 ? (guardrailFlags.length / guardrailScores.length) * 100 : 0;

  // Model mix: one model_used per successful LLM turn. More than one distinct
  // model in the window means the fallback chain fired.
  const modelCounts = new Map<string, number>();
  real.filter((s) => s.name === "model_used").forEach((s) => {
    const label = (s.string_value || `model #${s.value}`).split("/").pop() || "unknown";
    modelCounts.set(label, (modelCounts.get(label) || 0) + 1);
  });
  const modelMix = Array.from(modelCounts.entries()).sort((a, b) => b[1] - a[1]);
  const fallbackTurns = modelMix.slice(1).reduce((acc, [, n]) => acc + n, 0);

  // Voice + tool health.
  const sttFails = real.filter((s) => s.name === "stt_failed" && s.value === 1).length;
  const ttsFails = real.filter((s) => s.name === "tts_failed" && s.value === 1).length;
  const toolErrors = real.filter((s) => s.name === "tool_error" && s.value === 1).length;
  const ttsLatencies = real.filter((s) => s.name === "tts_latency_seconds").map((s) => s.value);
  const avgTtsLatency = ttsLatencies.length
    ? ttsLatencies.reduce((a, b) => a + b, 0) / ttsLatencies.length
    : null;

  // Group scores by session_id → one row per conversation with its outcome.
  interface GroupedSession {
    session_id: string;
    latest_timestamp: string | null;
    ordered: boolean;
    escalated: boolean;
    flags: number;
    models: string[];
    scores: DashboardScore[];
  }

  const groupedMap = new Map<string, DashboardScore[]>();
  real.forEach((s) => {
    if (s.session_id) {
      const arr = groupedMap.get(s.session_id) || [];
      arr.push(s);
      groupedMap.set(s.session_id, arr);
    }
  });

  const groupedSessions: GroupedSession[] = Array.from(groupedMap.entries()).map(([session_id, sessionScores]) => {
    let latest: string | null = null;
    sessionScores.forEach((s) => {
      if (s.timestamp) {
        if (!latest || new Date(s.timestamp) > new Date(latest)) {
          latest = s.timestamp;
        }
      }
    });

    return {
      session_id,
      latest_timestamp: latest,
      ordered: sessionScores.some((s) => s.name === "order_placed" && s.value === 1),
      escalated: sessionScores.some((s) => s.name === "escalated" && s.value === 1),
      flags: sessionScores.filter(
        (s) => s.name === "guardrail_category" && s.string_value && s.string_value !== "SAFE"
      ).length,
      models: Array.from(
        new Set(
          sessionScores
            .filter((s) => s.name === "model_used")
            .map((s) => (s.string_value || "").split("/").pop() || "")
            .filter(Boolean)
        )
      ),
      scores: sessionScores,
    };
  });

  groupedSessions.sort((a, b) =>
    (b.latest_timestamp || "").localeCompare(a.latest_timestamp || "")
  );

  const filteredGrouped = groupedSessions.filter((g) =>
    g.session_id.toLowerCase().includes(filter.toLowerCase())
  );

  const selectedSessionData = groupedSessions.find((g) => g.session_id === selectedSessionId);

  return (
    <div className="space-y-6">
      {/* The four questions every conversation auto-answers */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="space-y-1 p-4">
          <p className="text-xs text-muted-foreground">Conversations Evaluated</p>
          <p className="font-heading text-2xl font-bold">{uniqueSessions.size}</p>
          <p className="text-xs text-muted-foreground">{real.length} auto-scores logged</p>
        </Card>
        <Card className="space-y-1 p-4">
          <p className="text-xs text-muted-foreground">Did it convert? — Orders Placed</p>
          <p className="font-heading text-2xl font-bold text-emerald-500">{ordersPlaced.length}</p>
          <p className="text-xs text-muted-foreground">{conversionRate.toFixed(0)}% of conversations ended in a saved order</p>
        </Card>
        <Card className="space-y-1 p-4">
          <p className="text-xs text-muted-foreground">Did it need a human? — Escalations</p>
          <p className="font-heading text-2xl font-bold text-amber-500">{escalatedCount}</p>
          <p className="text-xs text-muted-foreground">{escalationRate.toFixed(0)}% of conversations handed off</p>
        </Card>
        <Card className="space-y-1 p-4">
          <p className="text-xs text-muted-foreground">Did it stay safe? — Guardrail Flags</p>
          <p className="font-heading text-2xl font-bold text-rose-500">{guardrailFlags.length}</p>
          <p className="text-xs text-muted-foreground">
            {guardrailRate.toFixed(1)}% of {guardrailScores.length} screened messages blocked
          </p>
        </Card>
      </div>

      {/* Did the AI stack hold up? */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="space-y-2 p-4">
          <p className="text-xs text-muted-foreground">Model Mix (fallback chain)</p>
          <div className="flex flex-wrap gap-1.5">
            {modelMix.length === 0 ? (
              <p className="text-xs text-muted-foreground">No LLM turns in this window.</p>
            ) : (
              modelMix.map(([model, n]) => (
                <Badge key={model} variant="primary" className="text-[10px]">
                  {model} × {n}
                </Badge>
              ))
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {fallbackTurns > 0
              ? `${fallbackTurns} turn${fallbackTurns === 1 ? "" : "s"} answered by a fallback model`
              : "Primary model answered every turn"}
          </p>
        </Card>
        <Card className="space-y-1 p-4">
          <p className="text-xs text-muted-foreground">Voice Pipeline</p>
          <p className="font-heading text-2xl font-bold">
            {sttFails + ttsFails === 0 ? "Healthy" : `${sttFails + ttsFails} failures`}
          </p>
          <p className="text-xs text-muted-foreground">
            {sttFails} STT · {ttsFails} TTS failures
            {avgTtsLatency !== null ? ` · avg TTS ${avgTtsLatency.toFixed(1)}s` : ""}
          </p>
        </Card>
        <Card className="space-y-1 p-4">
          <p className="text-xs text-muted-foreground">Tool Errors</p>
          <p className="font-heading text-2xl font-bold">{toolErrors}</p>
          <p className="text-xs text-muted-foreground">failed tool executions (pricing, saving, menu)</p>
        </Card>
      </div>

      <p className="text-xs text-muted-foreground">
        Every conversation scores itself automatically — no human grading: did it convert
        (order_placed), did it stay safe (guardrail_category), did it need a human (escalated),
        and did the stack hold up (model_used, voice, tools). Click a session to see its raw scores.
      </p>

      {/* Main Grid */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Sessions list */}
        <div className={cn(selectedSessionId ? "lg:col-span-2" : "lg:col-span-3")}>
          <Card className="overflow-hidden p-0">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold">Evaluated Sessions</h2>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Filter by Session ID..."
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  className="rounded border border-border bg-surface-2 px-2.5 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary w-48 sm:w-64"
                />
                <span className="text-xs text-muted-foreground">{filteredGrouped.length} shown</span>
              </div>
            </div>
            {filteredGrouped.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">No evaluated sessions match the filter.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 py-3 font-semibold">Latest Activity</th>
                      <th className="px-4 py-3 font-semibold">Session ID</th>
                      <th className="px-4 py-3 font-semibold">Outcome</th>
                      <th className="px-4 py-3 font-semibold">Model(s)</th>
                      <th className="px-4 py-3 font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredGrouped.map((g) => (
                      <tr
                        key={g.session_id}
                        className={cn(
                          "hover:bg-surface-2 transition-colors",
                          selectedSessionId === g.session_id ? "bg-surface-2" : ""
                        )}
                      >
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {g.latest_timestamp ? new Date(g.latest_timestamp).toLocaleString() : "-"}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs">
                          <button
                            type="button"
                            onClick={() => setSelectedSessionId(g.session_id)}
                            className="hover:underline text-primary font-semibold text-left"
                          >
                            {g.session_id}
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {g.ordered && <Badge variant="success">✓ Ordered</Badge>}
                            {g.escalated && <Badge variant="destructive">⚠ Escalated</Badge>}
                            {g.flags > 0 && (
                              <Badge variant="destructive">
                                {g.flags} flagged message{g.flags === 1 ? "" : "s"}
                              </Badge>
                            )}
                            {!g.ordered && !g.escalated && g.flags === 0 && (
                              <Badge variant="default">No order</Badge>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {g.models.map((model) => (
                              <span
                                key={model}
                                className="rounded bg-surface px-1.5 py-0.5 text-[10px] text-muted-foreground border border-border"
                              >
                                {model}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs">
                          <button
                            type="button"
                            onClick={() => setSelectedSessionId(g.session_id)}
                            className="hover:underline text-primary font-semibold cursor-pointer"
                          >
                            View metrics
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        {/* Score Details Sidebar */}
        {selectedSessionId && selectedSessionData && (
          <div className="lg:col-span-1">
            <Card className="p-4 space-y-4 border border-border bg-surface sticky top-6">
              <div className="flex items-center justify-between border-b border-border pb-3">
                <h3 className="font-heading text-sm font-semibold truncate max-w-[200px]" title={selectedSessionId}>
                  Session Metrics
                </h3>
                <button
                  type="button"
                  onClick={() => setSelectedSessionId(null)}
                  className="text-xs text-muted-foreground hover:text-foreground cursor-pointer font-bold"
                >
                  Close ×
                </button>
              </div>

              <div className="space-y-2">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Session ID</p>
                <p className="text-xs font-mono text-foreground break-all bg-surface-2 p-2 rounded border border-border select-all">
                  {selectedSessionId}
                </p>
                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                  <span className="text-xs text-muted-foreground">Outcome:</span>
                  {selectedSessionData.ordered && <Badge variant="success">✓ Ordered</Badge>}
                  {selectedSessionData.escalated && <Badge variant="destructive">⚠ Escalated</Badge>}
                  {selectedSessionData.flags > 0 && (
                    <Badge variant="destructive">{selectedSessionData.flags} flagged</Badge>
                  )}
                  {!selectedSessionData.ordered &&
                    !selectedSessionData.escalated &&
                    selectedSessionData.flags === 0 && <Badge variant="default">No order</Badge>}
                </div>
              </div>

              {/* Dynamic metrics from details API */}
              <div className="border-t border-border pt-3 space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Session Stats</h4>
                {detailLoading ? (
                  <div className="space-y-1.5 animate-pulse">
                    <div className="h-4 bg-surface-2 rounded w-2/3" />
                    <div className="h-4 bg-surface-2 rounded w-1/2" />
                    <div className="h-4 bg-surface-2 rounded w-3/4" />
                  </div>
                ) : detail ? (
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Turns & LLM Cost:</span>
                      <span className="font-semibold tabular-nums">
                        {detail.turn_count} turns · {formatUSD(detail.total_cost)}
                      </span>
                    </div>
                    {(detail.voice_duration > 0 || detail.voice_cost_inr > 0) && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Voice & TTS Cost:</span>
                        <span className="font-semibold tabular-nums">
                          {formatDuration(detail.voice_duration)} · {formatINR(detail.voice_cost_inr)}
                        </span>
                      </div>
                    )}
                    {/* Models used */}
                    {(() => {
                      const models = Array.from(
                        new Set(detail.turns.flatMap((t) => t.models_used.map((m) => m.model)))
                      ).filter(Boolean);
                      if (models.length === 0) return null;
                      return (
                        <div className="space-y-1">
                          <p className="text-muted-foreground mt-1">Models Used:</p>
                          <div className="flex flex-wrap gap-1">
                            {models.map((model, idx) => (
                              <Badge key={idx} variant="primary" className="text-[10px]">
                                {model}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                ) : (
                  <p className="text-[10px] text-muted-foreground">Select a session or connect to internet to load details.</p>
                )}
              </div>

              <div className="space-y-3 border-t border-border pt-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Scores Breakdown</h4>
                <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                  {selectedSessionData.scores.map((s) => {
                    const d = scoreDisplay(s);
                    return (
                      <div key={s.id} className="rounded-lg bg-surface-2 p-2.5 text-xs space-y-1 border border-border">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-foreground">
                            {SCORE_LABELS[s.name] ?? s.name}
                          </span>
                          <Badge variant={d.variant}>{d.text}</Badge>
                        </div>
                        {s.comment && <p className="text-muted-foreground italic mt-1 text-[11px] leading-relaxed">{s.comment}</p>}
                        <p className="text-[10px] text-muted-foreground text-right mt-1 pt-1 border-t border-border/20">
                          {s.timestamp ? new Date(s.timestamp).toLocaleString() : ""}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="pt-2 border-t border-border">
                <Button
                  size="sm"
                  className="w-full text-xs font-semibold cursor-pointer"
                  onClick={() => onSelect(selectedSessionId)}
                >
                  Go to Session Debugger ↗
                </Button>
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}


function EscalationsView({
  escalations,
  loading,
  error,
  totalSessions,
  onSelect,
}: {
  escalations: DashboardEscalation[];
  loading: boolean;
  error: string | null;
  totalSessions: number;
  onSelect: (sid: string) => void;
}) {
  const [filter, setFilter] = useState("");

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-surface-2" />
          ))}
        </div>
        <div className="h-64 animate-pulse rounded-xl bg-surface-2" />
      </div>
    );
  }

  if (error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    );
  }

  const voiceEsc = escalations.filter((e) => e.channel === "voice").length;
  const chatEsc = escalations.filter((e) => e.channel === "chat").length;
  const escalationRate = totalSessions > 0 ? (escalations.length / totalSessions) * 100 : 0;

  const filtered = escalations.filter((e) =>
    e.session_id.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Aggregate Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card className="space-y-1 p-4">
          <p className="text-xs text-muted-foreground">Total Human Escalations</p>
          <p className="font-heading text-2xl font-bold text-amber-500">{escalations.length}</p>
          <p className="text-xs text-muted-foreground">
            {totalSessions > 0 ? `${escalationRate.toFixed(1)}% of all sessions (${totalSessions} total)` : "requires team triage"}
          </p>
        </Card>
        <Card className="space-y-1 p-4">
          <p className="text-xs text-muted-foreground">Voice Calls Escalated</p>
          <p className="font-heading text-2xl font-bold">{voiceEsc}</p>
          <p className="text-xs text-muted-foreground">{escalations.length > 0 ? ((voiceEsc / escalations.length) * 100).toFixed(0) : 0}% of total escalations</p>
        </Card>
        <Card className="space-y-1 p-4">
          <p className="text-xs text-muted-foreground">Chat Messages Escalated</p>
          <p className="font-heading text-2xl font-bold">{chatEsc}</p>
          <p className="text-xs text-muted-foreground">{escalations.length > 0 ? ((chatEsc / escalations.length) * 100).toFixed(0) : 0}% of total escalations</p>
        </Card>
      </div>

      {/* Escalations Table */}
      <Card className="overflow-hidden p-0">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Active Escalations List</h2>
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Filter by Session ID..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="rounded border border-border bg-surface-2 px-2.5 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary w-48 sm:w-64"
            />
            <span className="text-xs text-muted-foreground">{filtered.length} shown</span>
          </div>
        </div>
        {filtered.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">No human escalations match the filter.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-semibold">Timestamp</th>
                  <th className="px-4 py-3 font-semibold">Session ID</th>
                  <th className="px-4 py-3 font-semibold">Channel</th>
                  <th className="px-4 py-3 font-semibold">Customer</th>
                  <th className="px-4 py-3 font-semibold">Reason</th>
                  <th className="px-4 py-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((e) => (
                  <tr key={e.id} className="hover:bg-surface-2 transition-colors">
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {e.created_at ? new Date(e.created_at).toLocaleString() : "-"}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{e.session_id}</td>
                    <td className="px-4 py-3">
                      <Badge variant={e.channel === "chat" ? "primary" : "accent"}>
                        {e.channel || "unknown"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {e.customer_name ? (
                        <div>
                          <p className="font-medium text-foreground">{e.customer_name}</p>
                          <p className="text-muted-foreground font-mono">{e.customer_phone}</p>
                        </div>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs font-medium text-amber-600 max-w-xs whitespace-normal break-words">
                      {e.reason || "-"}
                    </td>
                    <td className="px-4 py-3 text-xs space-x-2">
                      <button
                        type="button"
                        onClick={() => onSelect(e.session_id)}
                        className="cursor-pointer hover:underline text-primary font-semibold"
                      >
                        Inspect
                      </button>
                      {e.langfuse_url && (
                        <a
                          href={e.langfuse_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:underline text-muted-foreground hover:text-foreground font-medium"
                        >
                          Trace ↗
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
