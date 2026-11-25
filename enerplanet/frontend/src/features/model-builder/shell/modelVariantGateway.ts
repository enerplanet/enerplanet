/**
 * The variant gateway the frame installs — the backend's own model endpoints, through the app's HTTP client.
 *
 * The module declares the slot (`modules/model-variant/source.ts`) and never learns which gateway it has.
 * The copy rule (parent, family, versioned title) is the model dashboard's, copied by value.
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

/** `extractBaseTitle` — copied from `modelService.ts`, string operations kept to avoid ReDoS. */
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
 * The copy rule, as a pure function.
 *
 * @throws when the original carries no `id` (it cannot be copied).
 */
export function familyCopyOf(
  original: ModelPayload,
  allModels: readonly ModelPayload[],
): FamilyCopy {
  const originalId = original.id;
  if (originalId === undefined) {
    throw new Error("the original model has no id, so it cannot be copied");
  }

  // Family and parent — verbatim from `duplicateModel`, the truthiness test included.
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

    // The version is the maximum over the family, so the siblings must be read.
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
