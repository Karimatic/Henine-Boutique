"use client";

import type { ExperimentDTO, ExperimentEvent, ExperimentKind } from "@henine/shared";
import { apiPost } from "./api";
import { useSite } from "./site";

/**
 * A/B tests (Admin → Tests A/B): each visitor gets version "a" or "b" once (kept on the
 * phone), and her steps are counted once per day: seen → product → checkout → order.
 * Later steps only count for visitors who saw the test.
 */
const KEY = "henine.ab.v1";

type Memory = { v: Record<string, "a" | "b">; sent: Record<string, string> };

function read(): Memory {
  try {
    const m = JSON.parse(localStorage.getItem(KEY) ?? "null") as Memory | null;
    return m && m.v && m.sent ? m : { v: {}, sent: {} };
  } catch {
    return { v: {}, sent: {} };
  }
}
function write(m: Memory) {
  try {
    localStorage.setItem(KEY, JSON.stringify(m));
  } catch {
    /* private mode: counted once per page instead */
  }
}

export function variantFor(id: number): "a" | "b" {
  const m = read();
  if (!m.v[id]) {
    m.v[id] = Math.random() < 0.5 ? "a" : "b";
    write(m);
  }
  return m.v[id]!;
}

const today = () => new Date(Date.now() + 3600_000).toISOString().slice(0, 10);

function send(id: number, event: ExperimentEvent) {
  const m = read();
  const variant = m.v[id];
  if (!variant) return;
  if (event !== "seen" && m.sent[`${id}:seen`] == null) return; // never exposed: not part of the test
  const key = `${id}:${event}`;
  if (m.sent[key] === today()) return;
  m.sent[key] = today();
  write(m);
  void apiPost("/ab", { id, variant, event }).catch(() => undefined);
}

/** The visitor saw this test (its version is on screen). */
export function abSeen(exp: ExperimentDTO) {
  variantFor(exp.id);
  send(exp.id, "seen");
}

/** A funnel step, for every test this visitor saw. */
export function abStep(experiments: ExperimentDTO[] | undefined, event: Exclude<ExperimentEvent, "seen">) {
  for (const e of experiments ?? []) send(e.id, event);
}

/** The running test of a kind and this visitor's version (null: no test, the usual look). */
export function useExperiment(kind: ExperimentKind): { exp: ExperimentDTO; variant: "a" | "b" } | null {
  const site = useSite();
  const exp = site.data?.experiments?.find((e) => e.kind === kind);
  if (!exp || typeof window === "undefined") return null;
  return { exp, variant: variantFor(exp.id) };
}

export function useExperiments() {
  return useSite().data?.experiments;
}
