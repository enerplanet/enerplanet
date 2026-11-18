/**
 * The variant gateway the frame installs — the backend's own model endpoints, through the app's HTTP client.
 *
 * The module declares the slot (`modules/model-variant/source.ts`) and never learns which gateway it has; this is
 * the implementation a host provides, beside the MEME-run gateways and for the same reason — a module may only
 * depend on `@model-builder/core`, while the app's CSRF-aware axios instance is the app's. The module is told
 * about this one at startup (`setModelVariantGateway`, via `installModelVariantGateway`).
 *
 * **The copy rule is the model dashboard's, copied not imported.** A feature may not import another feature, so
 * the rule below is copied by value from `duplicateModel`
 * (`features/model-dashboard/services/modelService.ts`) — the same way `memeRunGateway` copies the dashboard's
 * status sets. Keep it in step with the original deliberately. The rule, verbatim from that method:
 *
 *   - `parent_model_id` is the original's own `parent_model_id` when it has one (so a copy *of a variant*
 *     parents to the same root), and the original's `id` otherwise (a copy *of a root* parents to the root):
 *     `if (original.parent_model_id) { parentModelId = original.parent_model_id } else { parentModelId = original.id }`.
 *   - `group_id` keeps the original's own `group_id` if it has one, else falls back to that same parent id:
 *     `groupId = groupId || original.parent_model_id` / `groupId = groupId || original.id`. So the copy joins
 *     the family it was made from.
 *   - the title is versioned within the family: `extractBaseTitle(original.title)` strips a trailing ` v<n>`,
 *     siblings are the models whose `parent_model_id` is this parent and whose title is that base plus ` v<n>`,
 *     and the copy is `maxVersion + 1` — `${baseTitle} v${nextVersion}`.
 *
 * That `parentModelId` is the family's own original, so it is what the port's `rootModelId` carries
 * (`core/ports.ts`). The backend is the authority on families (`backend/internal/model/handler/model_family.go`):
 * copies record the root original in `parent_model_id`, copies of copies too, and a family is named by its
 * original if present, else by its oldest member — which is exactly the id this rule computes.
 *
 * **The list read is unbounded**, as in `duplicateModel`: the version number is the maximum over the family, and
 * the versioning siblings are found client-side. The endpoint is the app's own `GET /models`.
 */

import axios from "@/lib/axios";
import { setModelVariantGateway, type ModelVariantGateway } from "../modules/model-variant";

/** The `raw` model payload, as the model endpoints answer it. Only the fields the copy reads. */
interface ModelPayload {
  id?: number;
  title?: string;
  description?: string;
  workspace_id?: number;
  region?: string;
  country?: string;
  coordinates?: Record<string, unknown>;
  selected_count?: number;
  resolution?: number;
  from_date?: string;
  to_date?: string;
  config?: Record<string, unknown>;
  group_id?: number;
  parent_model_id?: number;
}

/** The single-model envelope (`httputil.SuccessResponse`). */
interface ModelEnvelope {
  success?: boolean;
  data?: ModelPayload;
}

/** The list envelope (`ModelListResponse`): `{ success, data: Model[], ... }`. */
interface ModelListEnvelope {
  success?: boolean;
  data?: ModelPayload[];
}

/**
 * `extractBaseTitle` — copied verbatim in behaviour from `modelService.ts`.
 *
 * The comment there says it avoids ReDoS; the simple string operations are kept for the same reason, and the
 * 500-character cap is kept too, since a title longer than that is not one this app ever produced.
 */
export function extractBaseTitle(title: string): string {
  if (!title) return title;

  if (title.length > 500) {
    title = title.substring(0, 500);
  }

  const trimmedTitle = title.trim();
  const lastSpaceIndex = trimmedTitle.lastIndexOf(" ");

  if (lastSpaceIndex === -1) {
    return trimmedTitle;
  }

  const possibleVersion = trimmedTitle.substring(lastSpaceIndex);
  if (possibleVersion.length >= 3 && possibleVersion.startsWith(" v")) {
    const numberPart = possibleVersion.substring(2);
    if (/^\d{1,5}$/.test(numberPart)) {
      return trimmedTitle.substring(0, lastSpaceIndex);
    }
  }

  return trimmedTitle;
}

/** The family facts the copy is made from: the copy's parent (the root original), its family, and its title. */
export interface FamilyCopy {
  /** The family's own original — what the port's `rootModelId` records (`parent_model_id`). */
  parentModelId: number;
  /** The family the copy joins (`group_id`). */
  groupId: number;
  /** The copy's title, versioned within the family (the ` v<n>` suffix). */
  title: string;
}

/** The ` v<n>` suffix the versioning matches, exactly as `duplicateModel` matches it. */
const VERSION_SUFFIX = /^ v(\d{1,5})$/;

/**
 * The copy rule, as a pure function — the whole of `duplicateModel`'s derivation, tested directly.
 *
 * @throws when the original carries no `id` (it cannot be copied), which no real payload does.
 */
export function familyCopyOf(
  original: ModelPayload,
  allModels: readonly ModelPayload[],
): FamilyCopy {
  const originalId = original.id;
  if (originalId === undefined) {
    throw new Error("the original model has no id, so it cannot be copied");
  }

  // Family and parent — verbatim from `duplicateModel` (the truthiness test included: a `0` parent is treated as
  // absent, as the original method treats it).
  let groupId = original.group_id;
  let parentModelId: number;
  if (original.parent_model_id) {
    parentModelId = original.parent_model_id;
    groupId = groupId || original.parent_model_id;
  } else {
    parentModelId = originalId;
    groupId = groupId || originalId;
  }

  // Version the title within the family, from the models that share this parent — verbatim from `duplicateModel`.
  const baseTitle = extractBaseTitle(original.title ?? "");
  const siblings = allModels.filter((model) => {
    if (model.parent_model_id !== parentModelId) return false;
    if (!model.title?.startsWith(baseTitle)) return false;
    return VERSION_SUFFIX.test(model.title.slice(baseTitle.length));
  });

  let maxVersion = 0;
  for (const sibling of siblings) {
    const match = VERSION_SUFFIX.exec((sibling.title ?? "").slice(baseTitle.length));
    if (match) {
      const version = Number.parseInt(match[1], 10);
      if (version > maxVersion) maxVersion = version;
    }
  }

  return {
    parentModelId,
    groupId,
    title: `${baseTitle} v${maxVersion + 1}`,
  };
}

/** `YYYY-MM-DD`, the form the create payload wants — `duplicateModel`'s own `formatDate`. */
function formatDate(dateStr: string): string {
  return new Date(dateStr).toISOString().split("T")[0];
}

/** The create payload `duplicateModel` builds, field for field (`CreateModelRequest` with `is_copy: true`). */
function createRequest(original: ModelPayload, copy: FamilyCopy): Record<string, unknown> {
  return {
    title: copy.title,
    description: original.description,
    workspace_id: original.workspace_id,
    region: original.region,
    country: original.country,
    coordinates: original.coordinates,
    selected_count: original.selected_count,
    resolution: original.resolution,
    from_date: formatDate(original.from_date ?? ""),
    to_date: formatDate(original.to_date ?? ""),
    config: original.config,
    group_id: copy.groupId,
    parent_model_id: copy.parentModelId,
    is_copy: true,
  };
}

export const backendModelVariantGateway: ModelVariantGateway = {
  async createVariant(modelId) {
    const originalResponse = await axios.get<ModelEnvelope>(`/models/${modelId}`);
    const original = originalResponse.data?.data;
    if (original === undefined || original.id === undefined) {
      throw new Error(`model ${modelId} could not be read, so no variant of it can be made`);
    }

    // The version is the maximum over the family, so the siblings must be read — the same list `duplicateModel`
    // fetches.
    const listResponse = await axios.get<ModelListEnvelope>(`/models`);
    const copy = familyCopyOf(original, listResponse.data?.data ?? []);

    const createdResponse = await axios.post<ModelEnvelope>(`/models`, createRequest(original, copy));
    const created = createdResponse.data?.data;
    if (created === undefined || created.id === undefined) {
      throw new Error(`the variant of model ${modelId} was created but the backend answered no id`);
    }

    return {
      variantModelId: created.id,
      rootModelId: copy.parentModelId,
      // As the backend recorded it; the computed title is the fallback for a payload that omits it.
      title: created.title ?? copy.title,
    };
  },
};

/** Install it. Called once, at startup, beside the run and results gateways. */
export function installModelVariantGateway(): void {
  setModelVariantGateway(backendModelVariantGateway);
}
