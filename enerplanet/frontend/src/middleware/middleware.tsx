import React from "react";
import { useAuth } from "@/providers/auth-provider";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { auth } from "@/configuration";
import { AppLayout } from "@/components/app-layout/AppLayout";
import { User } from "@/types/user";

type AccessLevel = User["access_level"];

interface MiddlewareProps {
	type?: "auth" | "guest";
	access?: AccessLevel;
}

export const Middleware: React.FC<MiddlewareProps> = ({ type = "guest", access }) => {
	const { user, isLoading, isAuthenticated } = useAuth();
	const location = useLocation();

	if (isLoading) {
		return (
			<div role="status" className="flex h-full w-full flex-col items-center justify-center gap-3 bg-background dark:bg-surface-dark">
				<div aria-hidden="true" className="size-10 rounded-full border-4 border-muted border-t-foreground animate-spin" />
				<span className="text-sm text-muted-foreground">Loading</span>
			</div>
		);
	}

	if (type === "guest" && isAuthenticated) {
		return <Navigate to="/app/model-dashboard" state={{ from: location }} replace />;
	}

	if (type === "auth") {
		if (!isAuthenticated) {
			return <Navigate to="/login" state={{ from: location }} replace />;
		}

		if (access && user) {
			const AccessLevels: AccessLevel[] = auth.access as AccessLevel[];
			if (!AccessLevels.includes(user.access_level)) {
				return <Navigate to="/unauthorized" replace />;
			}
		}
	}

	if (type === "auth") {
		return (
			<AppLayout>
				<Outlet />
			</AppLayout>
		);
	}

	return <Outlet />;
};

