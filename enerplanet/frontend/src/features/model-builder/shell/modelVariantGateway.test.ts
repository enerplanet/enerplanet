/**
 * `modelVariantGateway`'s copy rule — the one part worth pinning, and the part copied from the model dashboard.
 *
 * The gateway's axios calls are a thin wrapper and are left to the module's own tests (which drive them through
 * a fake); what can break silently is the *rule* — how `parent_model_id`, `group_id` and the ` v<n>` title are
 * derived from the original. It lives in a pure function (`familyCopyOf`), tested directly, without stubbing
 * axios, so the copy can be checked against `duplicateModel`'s own behaviour
 * (`features/model-dashboard/services/modelService.ts`).
 */
import { describe, expect, it } from "vitest";
import { extractBaseTitle, familyCopyOf } from "./modelVariantGateway";

/** A base title, named once so the versioning cases read the same thing. */
const BASE_TITLE = "Berlin centre";

describe("extractBaseTitle — a trailing ` v<n>` is stripped, and nothing else is", () => {
  it("strips a version suffix", () => {
    expect(extractBaseTitle(`${BASE_TITLE} v3`)).toBe(BASE_TITLE);
  });

  it("leaves a title with no version suffix alone", () => {
    expect(extractBaseTitle(BASE_TITLE)).toBe(BASE_TITLE);
    expect(extractBaseTitle(`${BASE_TITLE} v1x`)).toBe(`${BASE_TITLE} v1x`);
  });
});

describe("familyCopyOf — the family rule copied from duplicateModel", () => {
  it("parents a copy of a root to the root and takes its id as the family", () => {
    // `if (original.parent_model_id) { ... } else { parentModelId = original.id }`, `groupId || original.id`.
    const copy = familyCopyOf({ id: 1, title: "Base" }, [{ id: 1, title: "Base" }]);

    expect(copy.parentModelId).toBe(1);
    expect(copy.groupId).toBe(1);
    expect(copy.title).toBe("Base v1");
  });

  it("parents a copy of a variant to the same root and joins its family", () => {
    // `parentModelId = original.parent_model_id`, `groupId = groupId || original.parent_model_id`.
    const copy = familyCopyOf(
      { id: 2, parent_model_id: 1, group_id: 1, title: "Base v1" },
      [{ id: 1, title: "Base" }, { id: 2, parent_model_id: 1, group_id: 1, title: "Base v1" }],
    );

    expect(copy.parentModelId).toBe(1);
    expect(copy.groupId).toBe(1);
  });

  it("falls back to the parent id for the family when the original has no group_id", () => {
    // `groupId = groupId || original.parent_model_id` — a variant with no group still joins its root's family.
    const copy = familyCopyOf(
      { id: 2, parent_model_id: 1, title: "Base v1" },
      [{ id: 1, title: "Base" }, { id: 2, parent_model_id: 1, title: "Base v1" }],
    );

    expect(copy.parentModelId).toBe(1);
    expect(copy.groupId).toBe(1);
  });

  it("versions the copy one past the highest sibling under the same parent", () => {
    const all = [
      { id: 1, title: "Base" },
      { id: 5, parent_model_id: 1, title: "Base v1" },
      { id: 6, parent_model_id: 1, title: "Base v2" },
    ];

    expect(familyCopyOf({ id: 1, title: "Base" }, all).title).toBe("Base v3");
  });

  it("ignores a versioned title belonging to a different parent", () => {
    // The sibling filter is `model.parent_model_id !== parentModelId`, so another line's versions do not count.
    const all = [
      { id: 1, title: "Base" },
      { id: 9, parent_model_id: 7, title: "Base v5" },
    ];

    expect(familyCopyOf({ id: 1, title: "Base" }, all).title).toBe("Base v1");
  });
});
