"use client";

/**
 * Mentor vs AI Scoring Comparison — wired to real GD session participant scores.
 */

import { Fragment, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listGdSessions, type GdParticipantAdmin, type GdSessionAdmin } from "@/lib/adminApi";
import { PROGRAM_ID, PROGRAM_LABEL } from "@/lib/adminConfig";
import { AdminTopbar } from "@/components/admin/AdminTopbar";

const ALERT_DELTA = 3;

const GD_DIMENSIONS = [
  { key: "leadership", label: "Leadership" },
  { key: "communication", label: "Communication" },
  { key: "teamwork", label: "Teamwork" },
  { key: "attitude", label: "Attitude" },
  { key: "content", label: "Content" },
  { key: "grammar", label: "Grammar" },
] as const;

type DimKey = (typeof GD_DIMENSIONS)[number]["key"];
type Filter = "all" | "discrepancy" | DimKey;

function fmt(n: number) {
  return n.toFixed(1);
}

function avg(nums: number[]) {
  if (nums.length === 0) return null;
  return nums.reduce((s, v) => s + v, 0) / nums.length;
}

function initials(name: string | null | undefined) {
  if (!name) return "?";
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

function sessionLabel(s: GdSessionAdmin) {
  const when = s.scheduled_at
    ? new Date(s.scheduled_at).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Unscheduled";
  const track = s.track === "manual" ? "In-person" : "Online";
  return `${s.label || "GD"} · ${track} · ${when}`;
}

function candidateParticipants(s: GdSessionAdmin): GdParticipantAdmin[] {
  return (s.participants ?? []).filter((p) => !p.role || p.role === "candidate");
}

function ScoreBar({ score, tone }: { score: number; tone: "mentor" | "ai" }) {
  const track = tone === "mentor" ? "bg-[#e3ecef]" : "bg-[#dff0ef]";
  const fill = tone === "mentor" ? "bg-ink" : "bg-[#43aaa3]";
  return (
    <div className="flex items-center gap-3">
      <div className={`h-2.5 min-w-[84px] flex-1 overflow-hidden rounded-full ${track}`}>
        <div className={`h-full rounded-full ${fill}`} style={{ width: `${score * 10}%` }} />
      </div>
      <span className="w-9 text-right font-bold tabular-nums">{fmt(score)}</span>
    </div>
  );
}

function DeltaBadge({ delta }: { delta: number }) {
  if (delta >= ALERT_DELTA) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[#fee4b5] px-3 py-1.5 font-bold text-[#a76410]">
        ⚠ {fmt(delta)}
      </span>
    );
  }
  if (delta === 0) {
    return (
      <span className="rounded-full bg-[#e4f5ed] px-3 py-1.5 font-bold text-[#31835f]">
        {fmt(delta)}
      </span>
    );
  }
  return (
    <span className="rounded-full bg-[#edf4f5] px-3 py-1.5 font-bold text-[#49636f]">
      {fmt(delta)}
    </span>
  );
}

export default function ScoringComparisonPage() {
  const sessionsQuery = useQuery({
    queryKey: ["gd-sessions", PROGRAM_ID],
    queryFn: () => listGdSessions(PROGRAM_ID),
  });

  const sessions = useMemo(() => {
    const all = sessionsQuery.data ?? [];
    return all.filter((s) => candidateParticipants(s).length > 0);
  }, [sessionsQuery.data]);

  const [sessionId, setSessionId] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [openEvidence, setOpenEvidence] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!sessionId && sessions.length > 0) setSessionId(sessions[0].id);
  }, [sessions, sessionId]);

  const selected = sessions.find((s) => s.id === sessionId) ?? null;
  const candidates = selected ? candidateParticipants(selected) : [];

  const alertCount = useMemo(() => {
    let n = 0;
    for (const c of candidates) {
      for (const d of GD_DIMENSIONS) {
        const m = c.mentor_scores?.[d.key];
        const a = c.scores?.[d.key];
        if (typeof m === "number" && typeof a === "number" && Math.abs(m - a) >= ALERT_DELTA) {
          n += 1;
        }
      }
    }
    return n;
  }, [candidates]);

  const detailRows = useMemo(() => {
    if (filter === "all") return [] as { c: GdParticipantAdmin; dim: (typeof GD_DIMENSIONS)[number] }[];
    const rows: { c: GdParticipantAdmin; dim: (typeof GD_DIMENSIONS)[number] }[] = [];
    for (const c of candidates) {
      for (const dim of GD_DIMENSIONS) {
        const m = c.mentor_scores?.[dim.key];
        const a = c.scores?.[dim.key];
        const hasM = typeof m === "number";
        const hasA = typeof a === "number";
        if (!hasM && !hasA) continue;
        if (filter === "discrepancy") {
          if (!hasM || !hasA) continue;
          if (Math.abs(m - a) < ALERT_DELTA) continue;
        } else if (dim.key !== filter) {
          continue;
        }
        rows.push({ c, dim });
      }
    }
    return rows;
  }, [candidates, filter]);

  function filterClass(key: Filter) {
    const on = filter === key;
    if (key === "discrepancy") {
      return on
        ? "rounded-xl border border-[#e5c18e] bg-[#fff8eb] px-4 py-2.5 text-[13px] font-semibold text-[#9a6415]"
        : "rounded-xl border border-[#e5c18e] bg-[#fff8eb]/70 px-4 py-2.5 text-[13px] font-semibold text-[#9a6415] hover:bg-[#fff1d7]";
    }
    return on
      ? "rounded-xl bg-ink px-4 py-2.5 text-[13px] font-semibold text-white shadow-sm"
      : "rounded-xl border border-border bg-white px-4 py-2.5 text-[13px] font-semibold text-text-muted hover:bg-[#f2f7f8]";
  }

  function insightFor(
    dimKey: DimKey,
    mentor: number | undefined,
    ai: number | undefined,
  ) {
    const hasM = typeof mentor === "number";
    const hasA = typeof ai === "number";
    if (hasM && hasA) {
      const delta = Math.abs(mentor - ai);
      if (delta >= ALERT_DELTA) {
        return `Material variance on ${dimKey} (Δ ${delta.toFixed(1)}). Review before confirming.`;
      }
      if (delta === 0) return `Scores align on ${dimKey}.`;
      return `Mild difference on ${dimKey}; ${ai > mentor ? "AI slightly higher" : "mentor slightly higher"}.`;
    }
    if (hasA) return `AI scored ${dimKey}; awaiting mentor.`;
    if (hasM) return `Mentor scored ${dimKey}; awaiting AI.`;
    return `No scores yet for ${dimKey}.`;
  }

  function renderDetail(
    c: GdParticipantAdmin,
    dim: (typeof GD_DIMENSIONS)[number],
    showCandidate: boolean,
  ) {
    const mentor = c.mentor_scores?.[dim.key];
    const ai = c.scores?.[dim.key];
    const hasM = typeof mentor === "number";
    const hasA = typeof ai === "number";
    // Show every measured parameter when expanded — don't require both sides.
    if (!hasM && !hasA) return null;
    const delta = hasM && hasA ? Math.abs(mentor - ai) : null;
    const alert = delta != null && delta >= ALERT_DELTA;
    const evKey = `${c.application_id}-${dim.key}`;
    return (
      <tr key={evKey} className={alert ? "bg-[#fff9ee]" : "bg-white"}>
        {showCandidate ? (
          <td className="border-b border-r border-[#dbe6e9] px-5 py-3.5 align-top">
            <CandidateCell c={c} />
          </td>
        ) : (
          <td className="border-b border-r border-[#dbe6e9] px-5 py-3.5" />
        )}
        <td className="border-b border-[#dbe6e9] px-4 py-3.5 font-semibold text-text">
          {dim.label}
        </td>
        <td className="border-b border-[#dbe6e9] px-4 py-3.5">
          {hasM ? (
            <ScoreBar score={mentor} tone="mentor" />
          ) : (
            <span className="text-[13px] text-text-muted">Not scored</span>
          )}
        </td>
        <td className="border-b border-[#dbe6e9] px-4 py-3.5">
          {hasA ? (
            <ScoreBar score={ai} tone="ai" />
          ) : (
            <span className="text-[13px] text-text-muted">Not scored</span>
          )}
        </td>
        <td className="border-b border-[#dbe6e9] px-4 py-3.5 text-center">
          {delta != null ? (
            <DeltaBadge delta={delta} />
          ) : (
            <span className="text-[12px] text-text-muted">—</span>
          )}
        </td>
        <td className="border-b border-[#dbe6e9] px-4 py-3.5">
          <p className="text-[13px] text-[#526b76] leading-snug line-clamp-2">
            {insightFor(dim.key, hasM ? mentor : undefined, hasA ? ai : undefined)}
          </p>
          {c.mentor_comment && (
            <p className="mt-1 text-[12px] text-[#49636f] line-clamp-2">
              <span className="font-semibold text-ink">Mentor:</span> {c.mentor_comment}
            </p>
          )}
          {c.score_rationale && hasA && (
            <>
              <button
                type="button"
                onClick={() =>
                  setOpenEvidence((prev) => {
                    const next = new Set(prev);
                    if (next.has(evKey)) next.delete(evKey);
                    else next.add(evKey);
                    return next;
                  })
                }
                className="mt-1.5 text-[12px] font-semibold text-[#247b8f] hover:underline"
              >
                {openEvidence.has(evKey) ? "Hide transcript evidence" : "Show transcript evidence"}
              </button>
              {openEvidence.has(evKey) && (
                <div className="mt-2 rounded-xl border border-[#cfe0e4] bg-[#f5fafb] p-3 text-[12px] leading-5 text-[#49636f]">
                  <strong>Transcript evidence:</strong> {c.score_rationale}
                </div>
              )}
            </>
          )}
        </td>
      </tr>
    );
  }

  return (
    <div>
      <AdminTopbar
        title="Scoring Comparison"
        subtitle={`${PROGRAM_LABEL} · Mentor vs AI for a GD session`}
      />

      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <label className="block max-w-xl w-full">
          <span className="mb-2 block text-[11px] font-bold uppercase tracking-[.07em] text-text-muted">
            Session
          </span>
          <select
            value={sessionId}
            onChange={(e) => {
              setSessionId(e.target.value);
              setExpanded(new Set());
              setFilter("all");
            }}
            className="w-full rounded-xl border border-border bg-white px-3 py-2.5 text-[13px] font-semibold outline-none focus:border-ink-light"
          >
            {sessions.length === 0 && <option value="">No sessions</option>}
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {sessionLabel(s)}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-3 gap-3 sm:max-w-[430px] w-full">
          <Stat label="Candidates" value={String(candidates.length)} />
          <Stat label="Parameters" value={String(GD_DIMENSIONS.length)} />
          <Stat label="Alerts" value={String(alertCount)} alert />
        </div>
      </div>

      {sessionsQuery.isLoading && (
        <div className="text-sm text-text-muted mb-4">Loading sessions…</div>
      )}

      <section className="overflow-hidden rounded-[22px] border border-[#d4e3e7] bg-white shadow-[0_1px_2px_rgba(15,50,65,.05),0_12px_32px_rgba(15,50,65,.06)]">
        <div className="border-b border-[#dbe7ea] px-4 py-4 sm:px-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={filterClass("all")}
                onClick={() => {
                  setFilter("all");
                  setExpanded(new Set());
                }}
              >
                Show All Parameters
              </button>
              <button
                type="button"
                className={filterClass("discrepancy")}
                onClick={() => {
                  setFilter("discrepancy");
                  setExpanded(new Set());
                }}
              >
                Show Only Discrepancies ⚠
              </button>
              {GD_DIMENSIONS.slice(0, 3).map((d) => (
                <button
                  key={d.key}
                  type="button"
                  className={filterClass(d.key)}
                  onClick={() => {
                    setFilter(d.key);
                    setExpanded(new Set());
                  }}
                >
                  {d.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-text-muted">
              <span className="inline-flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-ink" />
                Mentor
              </span>
              <span className="inline-flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-[#43aaa3]" />
                AI
              </span>
              <span>Alert threshold: Δ ≥ {ALERT_DELTA}</span>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] table-fixed border-collapse text-left">
            <colgroup>
              <col className="w-[220px]" />
              <col className="w-[160px]" />
              <col className="w-[180px]" />
              <col className="w-[180px]" />
              <col className="w-[110px]" />
              <col />
            </colgroup>
            <thead className="bg-[#f7fafb] text-[11px] uppercase tracking-[.06em] text-[#607983]">
              <tr>
                <th className="border-b border-r border-[#d8e5e8] px-5 py-4 font-bold">
                  Candidate
                </th>
                <th className="border-b border-[#d8e5e8] px-4 py-4 font-bold">GDPI Parameter</th>
                <th className="border-b border-[#d8e5e8] px-4 py-4 font-bold">
                  Mentor Score <span className="normal-case font-medium">/10</span>
                </th>
                <th className="border-b border-[#d8e5e8] px-4 py-4 font-bold">
                  AI Score <span className="normal-case font-medium">/10</span>
                </th>
                <th className="border-b border-[#d8e5e8] px-4 py-4 text-center font-bold">
                  Variance
                </th>
                <th className="border-b border-[#d8e5e8] px-4 py-4 font-bold">
                  Combined Insights &amp; Justification
                </th>
              </tr>
            </thead>
            <tbody>
              {filter === "all"
                ? candidates.map((c) => {
                    const mentorVals = GD_DIMENSIONS.map((d) => c.mentor_scores?.[d.key]).filter(
                      (v): v is number => typeof v === "number",
                    );
                    const aiVals = GD_DIMENSIONS.map((d) => c.scores?.[d.key]).filter(
                      (v): v is number => typeof v === "number",
                    );
                    const mAvg =
                      c.mentor_overall_score ?? avg(mentorVals);
                    const aAvg = c.overall_score ?? avg(aiVals);
                    const final = c.final_overall_score;
                    const hasParamScores = GD_DIMENSIONS.some(
                      (d) =>
                        typeof c.scores?.[d.key] === "number" ||
                        typeof c.mentor_scores?.[d.key] === "number",
                    );
                    const isOpen = expanded.has(c.application_id);
                    const both =
                      mAvg != null && aAvg != null ? Math.abs(mAvg - aAvg) : null;
                    return (
                      <Fragment key={c.application_id}>
                        <tr className="bg-white">
                          <td className="border-b border-r border-[#dbe6e9] px-5 py-3.5 align-top">
                            <CandidateCell
                              c={c}
                              showToggle={hasParamScores}
                              expanded={isOpen}
                              onToggle={() =>
                                setExpanded((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(c.application_id)) next.delete(c.application_id);
                                  else next.add(c.application_id);
                                  return next;
                                })
                              }
                            />
                          </td>
                          <td className="border-b border-[#dbe6e9] px-4 py-3.5 align-top">
                            <div className="font-bold text-[13px] text-text leading-tight">
                              Consolidated Score
                            </div>
                            <div className="mt-0.5 text-[11px] text-text-muted leading-tight">
                              All GDPI parameters
                              {final != null && (
                                <span className="block mt-0.5 font-semibold text-ink">
                                  Final {fmt(final)}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="border-b border-[#dbe6e9] px-4 py-3.5 align-middle">
                            {mAvg != null ? (
                              <ScoreBar score={mAvg} tone="mentor" />
                            ) : (
                              <span className="text-[13px] text-text-muted">Not scored</span>
                            )}
                          </td>
                          <td className="border-b border-[#dbe6e9] px-4 py-3.5 align-middle">
                            {aAvg != null ? (
                              <ScoreBar score={aAvg} tone="ai" />
                            ) : (
                              <span className="text-[13px] text-text-muted">Not scored</span>
                            )}
                          </td>
                          <td className="border-b border-[#dbe6e9] px-4 py-3.5 text-center align-middle">
                            {both != null ? (
                              <DeltaBadge delta={both} />
                            ) : (
                              <span className="text-[12px] text-text-muted">—</span>
                            )}
                          </td>
                          <td className="border-b border-[#dbe6e9] px-4 py-3.5 align-top text-[13px] font-medium text-[#465f6a] leading-snug">
                            <p className="line-clamp-2">
                              {c.score_rationale ||
                                c.mentor_comment ||
                                (mAvg == null
                                  ? "Awaiting mentor scores."
                                  : aAvg == null
                                    ? "Awaiting AI scores."
                                    : "Both assessors scored — expand for parameter detail.")}
                            </p>
                          </td>
                        </tr>
                        {isOpen &&
                          GD_DIMENSIONS.map((dim) => renderDetail(c, dim, false))}
                      </Fragment>
                    );
                  })
                : detailRows.map(({ c, dim }) => renderDetail(c, dim, true))}
              {candidates.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-[13px] text-text-muted">
                    {sessionsQuery.isLoading
                      ? "Loading…"
                      : "No candidates in this session. Pack and score a GD first."}
                  </td>
                </tr>
              )}
              {filter !== "all" && detailRows.length === 0 && candidates.length > 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-[13px] text-text-muted">
                    No rows match this filter. Enter mentor scores and run AI scoring first.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-2 border-t border-[#dbe7ea] bg-[#fbfdfd] px-6 py-4 text-[13px] text-text-muted sm:flex-row sm:items-center sm:justify-between">
          <p>
            {filter === "all"
              ? `Showing ${candidates.length} consolidated candidate rows.`
              : `Showing ${detailRows.length} matching rows.`}
          </p>
          <p>Final GD Score = (Mentor + AI) ÷ 2 · feeds Applications composite.</p>
        </div>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  alert,
}: {
  label: string;
  value: string;
  alert?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border px-4 py-3 shadow-sm ${
        alert ? "border-[#edcf9e] bg-[#fff8eb]" : "border-[#d8e5e8] bg-white"
      }`}
    >
      <p
        className={`text-[11px] font-bold uppercase tracking-wide ${
          alert ? "text-[#986717]" : "text-[#708690]"
        }`}
      >
        {label}
      </p>
      <p className={`mt-1 text-xl font-bold ${alert ? "text-[#a76410]" : "text-text"}`}>{value}</p>
    </div>
  );
}

function CandidateCell({
  c,
  showToggle,
  expanded,
  onToggle,
}: {
  c: GdParticipantAdmin;
  showToggle?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ink-light/15 text-ink-light font-bold text-[12px]">
        {initials(c.applicant_name)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-1.5">
          <div className="min-w-0">
            <p className="font-bold leading-tight text-[13px] text-text truncate">
              {c.applicant_name || "Unnamed"}
            </p>
            <p className="mt-0.5 text-[11px] text-text-muted leading-tight truncate">
              {c.application_number || c.application_id.slice(0, 8).toUpperCase()}
            </p>
          </div>
          {showToggle && (
            <button
              type="button"
              onClick={onToggle}
              className="ml-auto grid h-7 w-7 shrink-0 place-items-center rounded-md border border-[#d5e2e6] bg-white text-base font-bold text-[#3f5d69] hover:bg-[#f2f7f8]"
            >
              {expanded ? "−" : "+"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
