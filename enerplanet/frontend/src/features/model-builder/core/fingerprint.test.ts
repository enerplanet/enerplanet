/**
 * The fingerprint, checked against Node's own SHA-256.
 *
 * A hand-written hash is worth exactly as much as the proof that it is that hash, so the oracle here is
 * `crypto.createHash("sha256")` — not a vector copied from a document. Each case states the canonical form
 * it expects and lets Node say what the digest of that form is.
 *
 * The long inputs are the ones that matter most: padding is where a hand-rolled SHA-256 breaks, and only an
 * input past 55 bytes (the length field crossing into a second block) and one past 64 bytes (a real second
 * block) exercise it.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { fingerprint } from "./fingerprint";

/** What Node says the digest of a canonical form is. */
const digestOf = (canonical: string): string =>
  createHash("sha256").update(canonical, "utf8").digest("hex");

describe("fingerprint", () => {
  it("is Node's SHA-256 of the canonical form", () => {
    const cases: Array<[unknown, string]> = [
      // Primitives: the canonical form is the JSON of the value.
      ["abc", `"abc"`],
      [42, `42`],
      [true, `true`],
      [null, `null`],
      [undefined, `undefined`],
      // Arrays keep their order, and an empty one is `[]`.
      [[1, 2, 3], `[1,2,3]`],
      [[], `[]`],
      // Object keys are sorted, so key order cannot change the digest.
      [{ b: 1, a: 2 }, `{"a":2,"b":1}`],
      [{ a: 2, b: 1 }, `{"a":2,"b":1}`],
      // Nested, which is the shape a projection actually has.
      [{ buildings: [{ osm_id: "b1", area_m2: 120 }], cursor: 0 }, `{"buildings":[{"area_m2":120,"osm_id":"b1"}],"cursor":0}`],
    ];

    for (const [value, canonical] of cases) {
      expect(fingerprint(value), `canonical form of ${JSON.stringify(value)}`).toBe(digestOf(canonical));
    }
  });

  it("digests long input correctly — where the padding is decided", () => {
    // 55, 56 and 1000 bytes: the length field forces a second block at 56, and 1000 spans many.
    for (const length of [55, 56, 57, 63, 64, 65, 1000]) {
      const text = "a".repeat(length);
      // A string canonicalises to its quoted JSON form, so the character count differs from the byte count.
      expect(fingerprint(text)).toBe(digestOf(JSON.stringify(text)));
    }
  });

  it("is short enough to store, which is what it is for", () => {
    // The reason this is a digest at all: `model_sessions.fingerprint` is `varchar(255)`, and a projection
    // carrying a grid and its buildings canonicalises to kilobytes. Saving it raw fails at the database.
    const projection = {
      buildings: Array.from({ length: 400 }, (_, i) => ({
        type: "Feature",
        properties: { osm_id: `b${i}`, area_m2: 100 + i, building_type: "residential" },
        geometry: { type: "Polygon", coordinates: [[[8.6 + i / 1e5, 49.4]]] },
      })),
    };

    const digest = fingerprint(projection);
    expect(digest).toHaveLength(64);
    expect(digest.length).toBeLessThan(255);
    // The canonical form it replaces is several orders of magnitude larger.
    expect(JSON.stringify(projection).length).toBeGreaterThan(10_000);
  });

  it("changes when the value changes, and not otherwise", () => {
    // The two jobs T18/T20 give it: notice a difference, and ignore key order while doing so.
    expect(fingerprint({ a: 1 })).not.toBe(fingerprint({ a: 2 }));
    expect(fingerprint({ a: 1 })).toBe(fingerprint({ a: 1 }));
    expect(fingerprint({ a: 1, b: 2 })).toBe(fingerprint({ b: 2, a: 1 }));
    expect(fingerprint([1, 2])).not.toBe(fingerprint([2, 1]));
  });
});
