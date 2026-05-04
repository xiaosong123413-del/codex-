import { describe, expect, it } from "vitest";
import {
  consolidateClaims,
  deriveProcedures,
  calculateConfidence,
  calculateRetention,
} from "../src/compiler/claims.js";
import type { ClaimCandidate, ClaimRecord } from "../src/utils/types.js";

function makeSource(file: string, observedAt: string) {
  return {
    file,
    title: file,
    kind: "external",
    channel: "外部源",
    observedAt,
  };
}

function makeClaim(overrides: Partial<ClaimRecord> = {}): ClaimRecord {
  return {
    id: "claim-1",
    conceptSlug: "redis-cache",
    claimKey: "cache-backend",
    claimText: "Project X uses Redis for caching.",
    claimType: "fact",
    sourceFiles: ["a.md"],
    sources: [makeSource("a.md", "2026-04-01T00:00:00.000Z")],
    firstSeenAt: "2026-04-01T00:00:00.000Z",
    lastConfirmedAt: "2026-04-01T00:00:00.000Z",
    supportCount: 1,
    contradictionCount: 0,
    confidence: 0.5,
    retention: 1,
    status: "active",
    supersedes: [],
    halfLifeDays: 90,
    ...overrides,
  };
}

function makeCandidate(overrides: Partial<ClaimCandidate> = {}): ClaimCandidate {
  return {
    conceptSlug: "redis-cache",
    claimKey: "cache-backend",
    claimText: "Project X uses Redis for caching.",
    claimType: "fact",
    source: makeSource("b.md", "2026-04-10T00:00:00.000Z"),
    observedAt: "2026-04-10T00:00:00.000Z",
    ...overrides,
  };
}

describe("claim lifecycle", () => {
  it("raises confidence when more recent support is added", () => {
    const confidence = calculateConfidence({
      supportCount: 2,
      reinforcementCount: 1,
      contradictionCount: 0,
      daysSinceConfirmed: 7,
      halfLifeDays: 90,
      status: "active",
    });

    expect(confidence).toBeGreaterThan(0.7);
    expect(confidence).toBeLessThanOrEqual(0.99);
  });

  it("decays retention by time since last touch", () => {
    const retention = calculateRetention({
      daysSinceTouch: 120,
      halfLifeDays: 30,
    });

    expect(retention).toBeLessThan(0.25);
    expect(retention).toBeGreaterThanOrEqual(0.05);
  });

  it("supersedes an older claim when the same claim key gets a newer conclusion", () => {
    const existing = [
      makeClaim({
        claimText: "Project X uses Memcached for caching.",
        lastConfirmedAt: "2026-03-01T00:00:00.000Z",
      }),
    ];

    const result = consolidateClaims(existing, [
      makeCandidate({
        claimText: "Project X uses Redis for caching.",
        observedAt: "2026-04-10T00:00:00.000Z",
      }),
    ]);

    expect(result.claims).toHaveLength(2);
    const oldClaim = result.claims.find((claim) => claim.claimText.includes("Memcached"));
    const newClaim = result.claims.find((claim) => claim.claimText.includes("Redis"));

    expect(oldClaim?.status).toBe("superseded");
    expect(newClaim?.status).toBe("active");
    expect(oldClaim?.supersededBy).toBe(newClaim?.id);
    expect(newClaim?.supersedes).toContain(oldClaim?.id);
  });

  it("marks contradictory claims as contested when recency cannot decide supersession", () => {
    const existing = [
      makeClaim({
        claimText: "Project X uses Memcached for caching.",
        lastConfirmedAt: "2026-04-10T00:00:00.000Z",
      }),
    ];

    const result = consolidateClaims(existing, [
      makeCandidate({
        claimText: "Project X uses Redis for caching.",
        observedAt: "2026-04-10T00:00:00.000Z",
      }),
    ]);

    expect(result.claims.every((claim) => claim.status === "contested")).toBe(true);
  });

  it("promotes repeated workflow source evidence into procedures", () => {
    const claims = [
      makeClaim({
        id: "claim-a",
        claimType: "workflow",
        conceptSlug: "incident-response",
        claimKey: "restart-sequence",
        claimText: "Handle incident by restart service, inspect logs, and verify health endpoint.",
        sourceFiles: ["a.md", "b.md", "c.md"],
        sources: [
          makeSource("a.md", "2026-04-01T00:00:00.000Z"),
          makeSource("b.md", "2026-04-03T00:00:00.000Z"),
          makeSource("c.md", "2026-04-08T00:00:00.000Z"),
        ],
        lastConfirmedAt: "2026-04-08T00:00:00.000Z",
        supportCount: 3,
      }),
    ];

    const procedures = deriveProcedures(claims);

    expect(procedures).toHaveLength(1);
    expect(procedures[0]?.supportingClaimIds).toEqual(["claim-a"]);
    expect(procedures[0]?.sourceFiles).toEqual(["a.md", "b.md", "c.md"]);
    expect(procedures[0]?.confidence).toBeGreaterThan(0.5);
  });
});
