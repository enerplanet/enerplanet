import { Group } from "@/components/workspace/services/groupService";

/**
 * Extract owner info from group attributes
 */
const getOwnerInfo = (group: Group): { ownerName?: string; ownerEmail?: string; ownerInfo?: string } => {
    const ownerEmail = group.attributes?.owner_email?.[0];
    const ownerName = group.attributes?.owner_name?.[0];
    return { ownerEmail, ownerName, ownerInfo: ownerName || ownerEmail };
};

/**
 * Get the base display name for a group
 */
const getBaseDisplayName = (group: Group): string => {
    return group.attributes?.display_name?.[0] || group.name;
};

/**
 * Check if group is a default/manager group
 */
const isDefaultGroup = (group: Group, displayName: string): boolean => {
    return group.name.startsWith('Default_') || displayName === 'Manager_default';
};

/**
 * Get a shortened display name for groups
 */
export const getGroupDisplayName = (group: Group | null | undefined, maxLength: number = 25): string => {
    if (!group) return '';

    const displayName = getBaseDisplayName(group);

    if (isDefaultGroup(group, displayName)) {
        const { ownerInfo } = getOwnerInfo(group);

        if (displayName === 'Manager_default') {
            if (ownerInfo) {
                const shortName = ownerInfo.split('@')[0].split(' ')[0];
                return `Manager (${shortName})`;
            }
            return 'Manager Default';
        }

        return displayName;
    }

    if (displayName.length > maxLength) {
        return displayName.substring(0, maxLength) + '...';
    }

    return displayName;
};

/**
 * Get the full display name for groups (for tooltips, dialogs, etc.)
 */
export const getGroupFullDisplayName = (group: Group | null | undefined): string => {
    if (!group) return '';

    const displayName = getBaseDisplayName(group);

    if (isDefaultGroup(group, displayName)) {
        const { ownerInfo } = getOwnerInfo(group);

        if (displayName === 'Manager_default') {
            if (ownerInfo) {
                return `Manager Default (${ownerInfo})`;
            }
            return 'Manager Default Group';
        }

        return displayName;
    }

    return displayName;
};

export const getGroupDisplayPath = (group: Group | null | undefined): string => {
    if (!group) return '';
    const displayName = group.attributes?.display_name?.[0];
    return displayName ? `/${displayName}` : group.path;
};

export const formatGroupName = (groupName: string): string => {
    if (!groupName) return '';
    if (groupName.startsWith('Default_') && groupName.length > 40) {
        return 'Default Manager Group';
    }
    return groupName;
};
