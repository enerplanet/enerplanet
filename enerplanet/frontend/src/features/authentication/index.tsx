// Wrapper components that integrate @spatialhub/auth with our app's stores
import React from "react";
import {
	LoginForm as LibLoginForm,
	RegisterForm as LibRegisterForm,
	ForgotPasswordForm as LibForgotPasswordForm,
	type LoginFormProps,
	type RegisterFormProps,
	type ForgotPasswordFormProps,
} from "@spatialhub/auth";
import { useAuthStore } from "@/store/auth-store";
import { ensureCSRFToken } from "@/utils/csrf";
import { config } from "@/configuration/app";
import { useSearchParams } from "react-router-dom";
import { CheckCircle } from "lucide-react";

const EnerPlanETLogo = (
	<div className="flex items-center justify-center mb-1">
		<img
			src="/images/logo/enerplanet-logo.png"
			alt="EnerPlanET"
			className="w-auto max-w-[95%] md:max-w-[600px] object-contain dark:brightness-0 dark:invert"
			style={{
				height: '36px'
			}}
		/>
	</div>
);

// LoginForm wrapper that connects to auth store
export const LoginForm: React.FC<Partial<LoginFormProps>> = (props) => {
	const { init } = useAuthStore();
	const [searchParams] = useSearchParams();
	const isVerified = searchParams.get("verified") === "true";

	return (
		<>
			{isVerified && (
				<div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-top-4 duration-500">
					<div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 shadow-lg text-sm text-emerald-700 dark:text-emerald-300">
						<CheckCircle className="w-4 h-4 flex-shrink-0" />
						<span>Email verified successfully! You can now log in.</span>
					</div>
				</div>
			)}
			<LibLoginForm
				onDocumentTitle={(title) => {
					document.title = title;
				}}
				onAuthInit={async (data) => {
					await init({
						user: data.user as Parameters<typeof init>[0]["user"],
						token: data.token,
						sessionTimeout: data.sessionTimeout,
					});
				}}
				onEnsureCSRF={async () => { await ensureCSRFToken(); }}
				apiBaseUrl={config.api.baseUrl || "/api"}
				appName={EnerPlanETLogo}
				backgroundImageUrl="/images/login-bg.svg"
				{...props}
			/>
		</>
	);
};

// RegisterForm wrapper that connects to auth store
export const RegisterForm: React.FC<Partial<RegisterFormProps>> = (props) => {
	return (
		<LibRegisterForm
			onDocumentTitle={(title) => {
				document.title = title;
			}}
			apiBaseUrl={config.api.baseUrl || "/api"}
			appName={EnerPlanETLogo}
			backgroundImageUrl="/images/login-bg.svg"
			{...props}
		/>
	);
};

// ForgotPasswordForm wrapper
export const ForgotPasswordForm: React.FC<Partial<ForgotPasswordFormProps>> = (props) => {
	return (
		<LibForgotPasswordForm
			onDocumentTitle={(title) => {
				document.title = title;
			}}
			apiBaseUrl={config.api.baseUrl || "/api"}
			appName={EnerPlanETLogo}
			backgroundImageUrl="/images/login-bg.svg"
			{...props}
		/>
	);
};
