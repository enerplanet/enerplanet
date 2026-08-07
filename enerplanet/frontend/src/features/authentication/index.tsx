import React, { useEffect } from "react";
import {
	LoginForm as LibLoginForm,
	RegisterForm as LibRegisterForm,
	ForgotPasswordForm as LibForgotPasswordForm,
	type LoginFormProps,
	type RegisterFormProps,
	type ForgotPasswordFormProps,
} from "@spatialhub/auth";
import { config } from "@/configuration/app";
import { auth } from "@/configuration/auth";
import { useAuthStore } from "@/store/auth-store";
import { ensureCSRFToken } from "@/utils/csrf";
import { useSearchParams } from "react-router-dom";
import { CheckCircle, Loader2, Zap } from "lucide-react";

const SSO_QUERY_PARAMETER = "sso";

// Builds the auth-service SSO entrypoint (server-side OIDC → session cookie).
// The RENvolveIT toolbox links here; the callback lands the user on return_to.
function ssoLoginUrl(): string {
	const base = config.api.baseUrl || "/api";
	let returnTo = "/app/map";
	try {
		if (auth.sso.redirectUri) {
			returnTo = new URL(auth.sso.redirectUri).pathname || returnTo;
		}
	} catch {
		// keep default
	}
	const params = new URLSearchParams();
	if (auth.sso.idpHint) params.set("idp_hint", auth.sso.idpHint);
	params.set("return_to", returnTo);
	return `${base}/auth/sso/login?${params.toString()}`;
}

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

const EnerPlanETSidePanel = (
	<div className="absolute inset-0">
		<img
			src="/images/login-bg.png"
			alt=""
			aria-hidden
			className="absolute inset-0 h-full w-full object-cover"
		/>
		<div className="absolute inset-0 bg-gradient-to-br from-slate-900/92 via-slate-900/82 to-slate-800/70" />
		<div className="relative flex h-full flex-col justify-between p-10 xl:p-14 text-white">
			<img
				src="/images/logo/enerplanet-logo.png"
				alt="EnerPlanET"
				className="h-8 w-auto self-start shrink-0 brightness-0 invert"
			/>

			<div className="max-w-lg">
				<span className="inline-flex items-center gap-2 rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-semibold text-emerald-200 ring-1 ring-emerald-400/30">
					<Zap className="h-3.5 w-3.5" /> Energy system planning
				</span>
				<h2 className="mt-6 text-3xl xl:text-4xl font-extrabold leading-tight tracking-tight">
					Plan smarter, more resilient energy grids
				</h2>
				<p className="mt-4 text-base text-white/80 leading-relaxed">
					Model capacity, costs and renewable integration across your network — from a single
					connected workspace.
				</p>
			</div>

			<p className="text-[11px] text-white/55">
				EnerPlanET · Integrated energy planning platform
			</p>
		</div>
	</div>
);

const SsoLoginForm: React.FC = () => {
	useEffect(() => {
		document.title = "Sign in";
		globalThis.location.replace(ssoLoginUrl());
	}, []);

	return (
		<div className="flex min-h-screen items-center justify-center bg-background px-6">
			<div className="flex max-w-md flex-col items-center gap-4 text-center">
				<Loader2 className="h-8 w-8 animate-spin text-primary" />
				<p className="text-sm text-muted-foreground">
					Redirecting to single sign-on…
				</p>
			</div>
		</div>
	);
};

const PasswordLoginForm: React.FC<Partial<LoginFormProps>> = (props) => {
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
				onDocumentTitle={(title: string) => {
					document.title = title;
				}}
				onAuthInit={async (data) => {
					await init({
						user: data.user as Parameters<typeof init>[0]["user"],
						sessionTimeout: data.sessionTimeout,
					});
				}}
				onEnsureCSRF={async () => {
					await ensureCSRFToken();
				}}
				apiBaseUrl={config.api.baseUrl || "/api"}
				appName={EnerPlanETLogo}
				backgroundImageUrl="/images/login-bg.svg"
				storageNamespace="enerplanet"
				layout="split"
				sideContent={EnerPlanETSidePanel}
				{...props}
			/>
		</>
	);
};

export const LoginForm: React.FC<Partial<LoginFormProps>> = (props) => {
	return <LoginFormRouter {...props} />;
};

// SSO only when explicitly requested via ?sso=renvolveit (the toolbox link);
// direct visitors get EnerPlanET's own email/password login.
const LoginFormRouter: React.FC<Partial<LoginFormProps>> = (props) => {
	const [searchParams] = useSearchParams();
	const ssoRequested = auth.sso.enabled && searchParams.has(SSO_QUERY_PARAMETER);
	return ssoRequested ? <SsoLoginForm /> : <PasswordLoginForm {...props} />;
};

export const RegisterForm: React.FC<Partial<RegisterFormProps>> = (props) => {
	return (
		<LibRegisterForm
			onDocumentTitle={(title: string) => {
				document.title = title;
			}}
			apiBaseUrl={config.api.baseUrl || "/api"}
			appName={EnerPlanETLogo}
			backgroundImageUrl="/images/login-bg.svg"
			layout="split"
			sideContent={EnerPlanETSidePanel}
			{...props}
		/>
	);
};

export const ForgotPasswordForm: React.FC<Partial<ForgotPasswordFormProps>> = (props) => {
	return (
		<LibForgotPasswordForm
			onDocumentTitle={(title: string) => {
				document.title = title;
			}}
			apiBaseUrl={config.api.baseUrl || "/api"}
			appName={EnerPlanETLogo}
			backgroundImageUrl="/images/login-bg.svg"
			layout="split"
			sideContent={EnerPlanETSidePanel}
			{...props}
		/>
	);
};
