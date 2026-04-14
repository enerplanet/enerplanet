import { useState, useCallback } from 'react';

export const useUserSelection = <T extends { id: string | number }>() => {
	const [selectedUsers, setSelectedUsers] = useState<T[]>([]);

	const isSelected = useCallback((user: T): boolean => {
		return selectedUsers.some((selected) => selected.id === user.id);
	}, [selectedUsers]);

	const handleSelectUser = useCallback((user: T): void => {
		if (isSelected(user)) {
			setSelectedUsers(selectedUsers.filter((selected) => selected.id !== user.id));
		} else {
			setSelectedUsers([...selectedUsers, user]);
		}
	}, [selectedUsers, isSelected]);

	const handleSelectAll = useCallback((visibleUsers: T[]): void => {
		if (selectedUsers.length === visibleUsers.length) {
			setSelectedUsers([]);
		} else {
			setSelectedUsers([...visibleUsers]);
		}
	}, [selectedUsers]);

	const clearSelection = useCallback(() => {
		setSelectedUsers([]);
	}, []);

	return {
		selectedUsers,
		isSelected,
		handleSelectUser,
		handleSelectAll,
		clearSelection,
	};
};
