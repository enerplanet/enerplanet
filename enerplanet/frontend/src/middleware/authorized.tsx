import React, { Fragment } from "react";
import { useAuth } from "@/providers/auth-provider";
import { User } from "@/types/user";

type AccessLevel = User["access_level"];
interface AuthorizedProps {
	access?: AccessLevel | AccessLevel[];
	/** Rendered instead of children for a signed-in user without the access level. */
	fallback?: React.ReactNode;
	children: React.ReactNode;
}

export const Authorized: React.FC<AuthorizedProps> = ({ children, access, fallback = null }) => {
	const { user, isAuthenticated } = useAuth();
	if (!isAuthenticated) return null;

	if (access) {
		if (Array.isArray(access) && !access.includes(user!.access_level)) return <Fragment>{fallback}</Fragment>;
		if (!Array.isArray(access) && access != user!.access_level) return <Fragment>{fallback}</Fragment>;
	}

	return <Fragment>{children}</Fragment>;
};

