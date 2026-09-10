"use client";

/**
 * Mentor Manual Scoring — wired to real GD sessions + mentor-scores API.
 * Dimensions match AI GDPI scoring (0–10).
 */

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listGdSessions,
  saveMentorGdScores,
  type GdParticipantAdmin,
  type GdSessionAdmin,
} from "@/lib/adminApi";
import { PROGRAM_ID, PROGRAM_LABEL } from "@/lib/adminConfig";
import { AdminTopbar } from "@/components/admin/AdminTopbar";

const GD_DIMENSIONS = [
  { key: "leadership", label: "Leadership" },
  { key: "communication", label: "Communication" },
  { key: "teamwork", label: "Teamwork" },
  { key: "attitude", label: "Attitude" },
  { key: "content", label: "Content" },
  { key: "grammar", label: "Grammar" },
] as const;

type DimKey = (typeof GD_DIMENSIONS)[number]["key"];
type ScoreMap = Record<DimKey, number | "">;
type StatusFilter = "all" | "pending" | "complete";

type RowState = {
  application_id: string;
  name: string;
  code: string;
  scores: ScoreMap;
  comment: string;
  /** True once mentor_overall_score exists on server (or after successful save). */
  complete: boolean;
};

function emptyScores(): ScoreMap {
  return {
    leadership: "",
    communication: "",
    teamwork: "",
    attitude: "",
    content: "",
    grammar: "",
  };
}

function scoresFromParticipant(p: GdParticipantAdmin): ScoreMap {
  const src = p.mentor_scores ?? {};
  const next = emptyScores();
  for (const d of GD_DIMENSIONS) {
    const v = src[d.key];
    next[d.key] = typeof v === "number" ? v : "";
  }
  return next;
}

function composite(scores: ScoreMap): string {
  const vals = GD_DIMENSIONS.map((d) => scores[d.key])
    .map(Number)
    .filter((v) => Number.isFinite(v) && v >= 0);
  return vals.length === GD_DIMENSIONS.length
    ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1)
    : "—";
}

function isComplete(scores: ScoreMap): boolean {
  return GD_DIMENSIONS.every((d) => {
    const v = scores[d.key];
    return v !== "" && Number(v) >= 0 && Number(v) <= 10;
  });
}

function clampScore(raw: string): number | "" {
  if (raw === "") return "";
  const n = Number(raw);
  if (!Number.isFinite(n)) return "";
  return Math.max(0, Math.min(10, n));
}

function initials(name: string | null | undefined): string {
  if (!name) return "?";
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

function sessionOptionLabel(s: GdSessionAdmin): string {
  const when = s.scheduled_at
    ? new Date(s.scheduled_at).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Unscheduled";
  const track = s.track === "manual" ? "In-person" : "Online";
  return `${s.label || "GD"} · ${track} · ${when}`;
}

function candidatesOnly(s: GdSessionAdmin): GdParticipantAdmin[] {
  return (s.participants ?? []).filter((p) => !p.role || p.role === "candidate");
}

export default function ManualScoringPage() {
  const queryClient = useQueryClient();
  const sessionsQuery = useQuery({
    queryKey: ["gd-sessions", PROGRAM_ID],
    queryFn: () => listGdSessions(PROGRAM_ID),
  });

  const sessions = useMemo(() => {
    const all = sessionsQuery.data ?? [];
    // Prefer sessions that have candidates (any status).
    return all.filter((s) => candidatesOnly(s).length > 0);
  }, [sessionsQuery.data]);

  const [sessionId, setSessionId] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [rows, setRows] = useState<RowState[]>([]);
  const [saveState, setSaveState] = useState("All changes saved");
  const [toast, setToast] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const selected = sessions.find((s) => s.id === sessionId) ?? null;

  useEffect(() => {
    if (!sessionId && sessions.length > 0) {
      setSessionId(sessions[0].id);
    }
  }, [sessions, sessionId]);

  useEffect(() => {
    if (!selected) {
      setRows([]);
      return;
    }
    const next: RowState[] = candidatesOnly(selected).map((p) => ({
      application_id: p.application_id,
      name: p.applicant_name || "Unnamed",
      code: p.application_number || p.application_id.slice(0, 8).toUpperCase(),
      scores: scoresFromParticipant(p),
      comment: p.mentor_comment ?? "",
      complete: p.mentor_overall_score != null,
    }));
    setRows(next);
    setDirty(false);
    setSaveState("All changes saved");
  }, [selected?.id, selected?.participants]);

  const visible = useMemo(() => {
    if (statusFilter === "complete") return rows.filter((r) => r.complete);
    if (statusFilter === "pending") return rows.filter((r) => !r.complete);
    return rows;
  }, [rows, statusFilter]);

  const completedCount = rows.filter((r) => r.complete).length;

  const saveMutation = useMutation({
    mutationFn: async (payload: RowState[]) => {
      if (!sessionId) throw new Error("No session selected");
      const completeRows = payload.filter((r) => isComplete(r.scores));
      if (completeRows.length === 0) {
        throw new Error("Fill all six scores for at least one candidate before saving");
      }
      return saveMentorGdScores(
        sessionId,
        completeRows.map((r) => ({
          application_id: r.application_id,
          scores: Object.fromEntries(
            GD_DIMENSIONS.map((d) => [d.key, Number(r.scores[d.key])]),
          ),
          comment: r.comment.trim() || null,
        })),
      );
    },
    onSuccess: () => {
      setDirty(false);
      setSaveState("All changes saved");
      void queryClient.invalidateQueries({ queryKey: ["gd-sessions", PROGRAM_ID] });
      void queryClient.invalidateQueries({ queryKey: ["candidates", PROGRAM_ID] });
      void queryClient.invalidateQueries({ queryKey: ["preference-match-results", PROGRAM_ID] });
      showToast("Mentor scores saved — composite updated");
    },
    onError: (err: Error) => showToast(err.message),
  });

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2800);
  }

  function markDirty() {
    setDirty(true);
    setSaveState("Unsaved changes");
  }

  function updateScore(applicationId: string, key: DimKey, raw: string) {
    const value = clampScore(raw);
    setRows((prev) =>
      prev.map((r) =>
        r.application_id === applicationId
          ? { ...r, scores: { ...r.scores, [key]: value } }
          : r,
      ),
    );
    markDirty();
  }

  function updateComment(applicationId: string, comment: string) {
    setRows((prev) =>
      prev.map((r) =>
        r.application_id === applicationId
          ? { ...r, comment: comment.slice(0, 2000) }
          : r,
      ),
    );
    markDirty();
  }

  function markVisibleComplete() {
    setRows((prev) =>
      prev.map((r) => {
        const inView =
          statusFilter === "all" ||
          (statusFilter === "complete" ? r.complete : !r.complete);
        if (!inView || !isComplete(r.scores)) return r;
        return { ...r, complete: true };
      }),
    );
    markDirty();
    showToast("Eligible visible candidates marked complete locally — Save to persist");
  }

  return (
    <div>
      <AdminTopbar
        title="Mentor Scoring Workspace"
        subtitle={`${PROGRAM_LABEL} · Enter scores for GD session candidates`}
      >
        <button
          type="button"
          disabled={!sessionId || saveMutation.isPending || !dirty}
          onClick={() => saveMutation.mutate(rows)}
          className="rounded-xl bg-ink px-5 py-2.5 text-[13px] font-semibold text-white hover:bg-ink-dark disabled:opacity-50"
        >
          {saveMutation.isPending ? "Saving…" : "Save All Scores"}
        </button>
      </AdminTopbar>

      {sessionsQuery.isLoading && (
        <div className="text-sm text-text-muted">Loading GD sessions…</div>
      )}
      {sessionsQuery.isError && (
        <div className="bg-brick-soft border border-brick/30 text-brick text-sm rounded-xl px-4 py-3 mb-4">
          Couldn&apos;t load GD sessions.
        </div>
      )}

      <section className="mb-5 rounded-[22px] border border-[#d4e3e7] bg-white p-4 sm:p-6 shadow-[0_1px_2px_rgba(15,50,65,.05),0_12px_32px_rgba(15,50,65,.06)]">
        <div className="grid gap-4 md:grid-cols-[1.4fr_1fr_auto] md:items-end">
          <label className="block">
            <span className="mb-2 block text-[11px] font-bold uppercase tracking-[.07em] text-text-muted">
              Session
            </span>
            <select
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
              className="w-full rounded-xl border border-border bg-white px-3 py-2.5 text-[13px] font-semibold outline-none focus:border-ink-light"
            >
              {sessions.length === 0 && <option value="">No sessions with candidates</option>}
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {sessionOptionLabel(s)}
                </option>
              ))}
            </select>
          </label>
          <div>
            <div className="mb-2 text-[11px] font-bold uppercase tracking-[.07em] text-text-muted">
              Topic
            </div>
            <div className="rounded-xl border border-border bg-[#f7fafb] px-3 py-2.5 text-[13px] font-semibold text-text">
              {selected?.topic || "—"}
            </div>
          </div>
          <div className="rounded-xl border border-border bg-[#f7fafb] px-4 py-3 text-[13px]">
            <span className="text-text-muted">Status</span>
            <div className="mt-1 flex items-center gap-2 font-semibold text-text">
              <span
                className={`h-2.5 w-2.5 rounded-full ${dirty ? "bg-[#e5a832]" : "bg-[#43aa75]"}`}
              />
              {saveState}
            </div>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-[22px] border border-[#d4e3e7] bg-white shadow-[0_1px_2px_rgba(15,50,65,.05),0_12px_32px_rgba(15,50,65,.06)]">
        <div className="flex flex-col gap-3 border-b border-[#dbe7ea] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <h2 className="font-serif text-xl font-bold text-text">Candidate Score Entry</h2>
            <p className="mt-1 text-[13px] text-text-muted">
              Six GDPI parameters (0–10), same scale as AI. Final GD Score = (Mentor + AI) ÷ 2.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {(
              [
                { key: "all", label: "All Candidates", count: rows.length },
                {
                  key: "pending",
                  label: "Pending",
                  count: rows.filter((r) => !r.complete).length,
                },
                { key: "complete", label: "Completed", count: completedCount },
              ] as const
            ).map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setStatusFilter(f.key)}
                className={`rounded-xl border px-3.5 py-2 text-[13px] font-semibold ${
                  statusFilter === f.key
                    ? "bg-ink text-white border-ink"
                    : "border-border bg-white text-text-muted"
                }`}
              >
                {f.label}{" "}
                <span
                  className={`ml-1 rounded-full px-1.5 py-0.5 text-[11px] ${
                    statusFilter === f.key ? "bg-white/20" : "bg-[#edf4f5]"
                  }`}
                >
                  {f.count}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1400px] table-fixed border-collapse text-left">
            <thead className="bg-[#f7fafb] text-[11px] uppercase tracking-[.06em] text-[#607983]">
              <tr>
                <th className="border-b border-r border-[#d8e5e8] px-5 py-4 font-bold w-[220px]">
                  Candidate
                </th>
                {GD_DIMENSIONS.map((c) => (
                  <th key={c.key} className="border-b border-[#d8e5e8] px-3 py-4 font-bold">
                    {c.label} <span className="normal-case font-medium">/10</span>
                  </th>
                ))}
                <th className="border-b border-[#d8e5e8] px-3 py-4 text-center font-bold w-[100px]">
                  Composite
                </th>
                <th className="border-b border-[#d8e5e8] px-4 py-4 font-bold min-w-[220px]">
                  Mentor Comments
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr>
                  <td
                    colSpan={GD_DIMENSIONS.length + 3}
                    className="px-6 py-12 text-center text-[13px] text-text-muted"
                  >
                    {sessionId
                      ? "No candidates match this filter."
                      : "Select a GD session to score."}
                  </td>
                </tr>
              )}
              {visible.map((c) => {
                const comp = composite(c.scores);
                return (
                  <tr key={c.application_id} className={c.complete ? "bg-white" : "bg-[#fffdf8]"}>
                    <td className="border-b border-r border-[#dbe6e9] px-5 py-4 align-top">
                      <div className="flex items-start gap-3">
                        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-ink-light/15 text-ink-light font-bold text-[12px]">
                          {initials(c.name)}
                        </div>
                        <div className="min-w-0">
                          <p className="font-bold leading-5 text-text text-[13px]">{c.name}</p>
                          <p className="mt-0.5 text-[11px] text-text-muted">{c.code}</p>
                          <div
                            className={`mt-2 inline-flex items-center gap-1.5 text-[11px] font-semibold ${
                              c.complete ? "text-[#31835f]" : "text-[#8b6a26]"
                            }`}
                          >
                            <span
                              className={`h-2 w-2 rounded-full ${
                                c.complete ? "bg-[#43aa75]" : "bg-[#e5a832]"
                              }`}
                            />
                            {c.complete ? "Completed" : "Pending"}
                          </div>
                        </div>
                      </div>
                    </td>
                    {GD_DIMENSIONS.map((col) => (
                      <td key={col.key} className="border-b border-[#dbe6e9] px-3 py-4">
                        <div className="flex items-center gap-1.5">
                          <input
                            aria-label={`${col.label} for ${c.name}`}
                            type="number"
                            min={0}
                            max={10}
                            step={0.5}
                            value={c.scores[col.key]}
                            placeholder="0–10"
                            onChange={(e) =>
                              updateScore(c.application_id, col.key, e.target.value)
                            }
                            className="w-[4.25rem] rounded-xl border border-[#cfdfe3] bg-white px-2 py-2 text-center text-[14px] font-bold outline-none focus:border-ink-light focus:ring-2 focus:ring-ink/10"
                          />
                        </div>
                      </td>
                    ))}
                    <td className="border-b border-[#dbe6e9] px-3 py-4 text-center">
                      <span
                        className={`inline-flex min-w-[52px] justify-center rounded-full px-2.5 py-1.5 font-bold text-[13px] ${
                          comp === "—"
                            ? "bg-[#edf4f5] text-[#6b828c]"
                            : "bg-[#e4f5ed] text-[#31835f]"
                        }`}
                      >
                        {comp}
                      </span>
                    </td>
                    <td className="border-b border-[#dbe6e9] px-4 py-4">
                      <textarea
                        rows={2}
                        value={c.comment}
                        placeholder="Observations, strengths, concerns…"
                        onChange={(e) => updateComment(c.application_id, e.target.value)}
                        className="min-h-[64px] w-full resize-y rounded-xl border border-[#cfdfe3] bg-white px-3 py-2 text-[12.5px] leading-5 outline-none focus:border-ink-light focus:ring-2 focus:ring-ink/10"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-3 border-t border-[#dbe7ea] bg-[#fbfdfd] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-[13px] text-text-muted">
            <strong className="text-ink">{completedCount}</strong> of {rows.length} completed on
            server · only fully scored candidates are saved
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={markVisibleComplete}
              className="rounded-xl border border-border bg-white px-4 py-2.5 text-[13px] font-semibold text-text-muted hover:bg-[#f3f7f8]"
            >
              Mark Visible as Complete
            </button>
            <button
              type="button"
              disabled={!sessionId || saveMutation.isPending}
              onClick={() => saveMutation.mutate(rows)}
              className="rounded-xl bg-ink px-5 py-2.5 text-[13px] font-semibold text-white hover:bg-ink-dark disabled:opacity-50"
            >
              Submit Review
            </button>
          </div>
        </div>
      </section>

      {toast && (
        <div className="fixed bottom-5 right-5 z-40 max-w-sm rounded-xl bg-ink px-4 py-3 text-[13px] font-semibold text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
