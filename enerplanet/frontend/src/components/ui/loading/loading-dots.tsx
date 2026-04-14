"use client";
import styles from "./loading-dots.module.css";

import React, { ComponentProps } from "react";
import { cn } from "@/lib/utils";

type LoadingDotsProps = ComponentProps<"div">;

const DOT_CLASS = "bg-sidebar";

export const LoadingDots: React.FC<LoadingDotsProps> = ({ className, ...props }) => {
	return (
		<div {...props} className={cn(styles.loading)}>
			<span className={cn(DOT_CLASS, className)} />
			<span className={cn(DOT_CLASS, className)} />
			<span className={cn(DOT_CLASS, className)} />
		</div>
	);
};
