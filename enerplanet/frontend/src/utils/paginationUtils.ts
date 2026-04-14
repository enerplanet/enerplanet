import { Group } from "@/components/workspace/services/groupService";

interface PaginationConfig {
    page: number;
    rowsPerPage: number;
    accessLevel: string;
    selectedGroup?: Group | null;
}

interface PaginationParams {
    perPage: number;
    pageNumber: number;
    shouldFilterClient: boolean;
}

/**
 * Compute API pagination params; if manager/expert with a group filter, fetch all and filter client-side.
 */
export const getPaginationParams = (config: PaginationConfig): PaginationParams => {
    const { page, rowsPerPage, accessLevel, selectedGroup } = config;

    const isExpert = accessLevel === "expert";
    const isManager = accessLevel === "manager";
    const hasGroupFilter = !!selectedGroup;
    const shouldFetchAll = hasGroupFilter && (isExpert || isManager);

    return {
        perPage: shouldFetchAll ? 10000 : rowsPerPage,
        pageNumber: shouldFetchAll ? 1 : page + 1,
        shouldFilterClient: shouldFetchAll,
    };
};

/** Filter items by group; for Default, include items without group_id. */
export const filterByGroup = <T extends { group_id?: string }>(
    items: T[],
    group: Group | null | undefined
): T[] => {
    if (!group) return items;

    const isDefaultGroup = group.name?.toLowerCase() === 'default';
    return items.filter(item => {
        if (isDefaultGroup) {
            return !item.group_id || item.group_id === group.id;
        } else {
            return item.group_id === group.id;
        }
    });
};

/** Paginate an array and return the current slice plus total count. */
export const paginateArray = <T,>(
    items: T[],
    page: number,
    rowsPerPage: number
): { items: T[]; total: number } => {
    const startIdx = page * rowsPerPage;
    const endIdx = startIdx + rowsPerPage;
    return {
        items: items.slice(startIdx, endIdx),
        total: items.length,
    };
};
