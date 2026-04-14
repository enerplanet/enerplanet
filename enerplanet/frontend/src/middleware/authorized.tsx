import React, { Fragment } from "react";
import { useAuth } from "@/providers/auth-provider";
import { User } from "@/types/user";

type AccessLevel = User["access_level"];
interface AuthorizedProps {
	access?: AccessLevel | AccessLevel[];
	children: React.ReactNode;
}

export const Authorized: React.FC<AuthorizedProps> = ({ children, access }) => {
	const { user, isAuthenticated } = useAuth();
	if (!isAuthenticated) return null;

	if (access) {
		if (Array.isArray(access) && !access.includes(user!.access_level)) return null;
		if (!Array.isArray(access) && access != user!.access_level) return null;
	}

	return <Fragment>{children}</Fragment>;
};

