import React from "react";
import { useAuth } from "@/providers/auth-provider";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { auth } from "@/configuration";
import { AppLayout } from "@/components/app-layout/AppLayout";
import { cn } from "@/lib/utils";
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
			<div className="flex justify-center items-center h-full w-full bg-background dark:bg-surface-dark">
				<div
					className={cn(
						"size-10border-4 border-t-primary-500 border-l-primary-500 border-b-background border-r-background",
						"dark:border-b-surface-dark dark:border-r-surface-dark",
						"rounded-full animate-spin"
					)}
				>
					loading
				</div>
			</div>
		);
	}

	if (type === "guest" && isAuthenticated) {
		return <Navigate to="/app/map" state={{ from: location }} replace />;
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

