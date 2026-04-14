import React, { useState, useRef, useEffect } from "react";
import { ChevronLeft, ChevronRight, ChevronDown, Loader2 } from "lucide-react";
import { useTranslation } from "@spatialhub/i18n";

interface PaginationProps {
	readonly currentPage: number;
	readonly totalItems: number;
	readonly itemsPerPage: number;
	readonly onPageChange: (page: number) => void;
	readonly onItemsPerPageChange: (itemsPerPage: number) => void;
	readonly pageSizeOptions?: number[];
	readonly className?: string;
	readonly isLoading?: boolean;
}

const Pagination: React.FC<PaginationProps> = ({
	currentPage,
	totalItems,
	itemsPerPage,
	onPageChange,
	onItemsPerPageChange,
	pageSizeOptions = [5, 10, 25],
	className = "",
	isLoading = false,
}) => {
	const { t } = useTranslation();
	const [isDropdownOpen, setIsDropdownOpen] = useState(false);
	const dropdownRef = useRef<HTMLDivElement>(null);

	// Close dropdown when clicking outside
	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
				setIsDropdownOpen(false);
			}
		};
		document.addEventListener("mousedown", handleClickOutside);
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, []);

	// Ensure totalPages is at least 1 to prevent division issues
	const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage));
	
	// Calculate display items with proper bounds checking
	const startItem = totalItems === 0 ? 0 : currentPage * itemsPerPage + 1;
	const endItem = Math.min((currentPage + 1) * itemsPerPage, totalItems);
	
	// Ensure currentPage is within valid bounds
	const validCurrentPage = Math.min(currentPage, totalPages - 1);

	// Generate page numbers to display
	const getPageNumbers = () => {
		const pages: (number | string)[] = [];
		const maxVisiblePages = 5;
		
		if (totalPages <= maxVisiblePages) {
			for (let i = 0; i < totalPages; i++) pages.push(i);
		} else {
			pages.push(0);
			
			if (validCurrentPage > 2) {
				pages.push("...");
			}
			
			const start = Math.max(1, validCurrentPage - 1);
			const end = Math.min(totalPages - 2, validCurrentPage + 1);
			
			for (let i = start; i <= end; i++) {
				if (!pages.includes(i)) pages.push(i);
			}
			
			if (validCurrentPage < totalPages - 3) {
				pages.push("...");
			}
			
			if (!pages.includes(totalPages - 1)) {
				pages.push(totalPages - 1);
			}
		}
		
		return pages;
	};
	
	return (
		<div className={`bg-card px-4 py-3 border-t border-border sm:px-6 ${className}`}>
			<div className="flex flex-col sm:flex-row justify-between items-center gap-3">
				{/* Results info */}
				<div className="flex items-center">
					<p className="text-sm text-muted-foreground">
						{isLoading ? (
							<span className="flex items-center gap-2">
								<Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
								<span className="text-muted-foreground">{t("common.pagination.loading")}</span>
							</span>
						) : (
							<>
								{totalItems === 0 ? (
									<span className="text-muted-foreground">{t("common.pagination.noResults")}</span>
								) : (
									<>
										{t("common.pagination.showing")} <span className="font-medium text-foreground">{startItem}</span> {t("common.pagination.to")}{" "}
										<span className="font-medium text-foreground">{endItem}</span> {t("common.pagination.of")}{" "}
										<span className="font-medium text-foreground">{totalItems}</span> {t("common.pagination.results")}
									</>
								)}
							</>
						)}
					</p>
				</div>

				<div className="flex items-center gap-4">
					{/* Modern dropdown for page size */}
					<div className="relative" ref={dropdownRef}>
						<button
							onClick={() => !isLoading && setIsDropdownOpen(!isDropdownOpen)}
							disabled={isLoading}
							className="flex items-center gap-2 px-3 py-1.5 text-sm bg-muted border border-border rounded-lg hover:bg-muted/80 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
						>
							<span className="text-foreground">{itemsPerPage}</span>
							<span className="text-muted-foreground">{t("common.pagination.perPage")}</span>
							<ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${isDropdownOpen ? "rotate-180" : ""}`} />
						</button>
						
						{isDropdownOpen && (
							<div className="absolute bottom-full mb-1 right-0 w-32 bg-card border border-border rounded-lg shadow-lg py-1 z-50 animate-in fade-in slide-in-from-bottom-2 duration-200">
								{pageSizeOptions.map(size => (
									<button
										key={size}
										onClick={() => {
											onItemsPerPageChange(size);
											onPageChange(0);
											setIsDropdownOpen(false);
										}}
										className={`w-full px-3 py-2 text-left text-sm transition-colors duration-150 ${
											size === itemsPerPage
												? "bg-muted text-foreground font-medium"
												: "text-muted-foreground hover:bg-muted"
										}`}
									>
										{size} {t("common.pagination.perPage")}
									</button>
								))}
							</div>
						)}
					</div>
					
					{/* Modern pagination controls */}
					{totalItems > 0 && (
						<div className="flex items-center gap-1">
							{/* Previous button */}
							<button
								onClick={() => onPageChange(Math.max(0, validCurrentPage - 1))}
								disabled={validCurrentPage === 0 || isLoading || totalPages <= 1}
								className="p-1.5 rounded-lg border border-border bg-card disabled:opacity-40 disabled:cursor-not-allowed hover:bg-muted transition-all duration-200 group"
								aria-label={t("common.pagination.previousPage")}
							>
								<ChevronLeft className="w-4 h-4 text-muted-foreground group-hover:text-foreground" />
							</button>
							
							{/* Page numbers */}
							<div className="flex items-center gap-1 mx-1">
								{getPageNumbers().map((page, index, array) => (
									typeof page === "string" ? (
										<span key={`ellipsis-after-${array[index-1]}`} className="px-2 text-muted-foreground text-sm">
											{page}
										</span>
									) : (
										<button
											key={page}
											onClick={() => onPageChange(page)}
											disabled={isLoading}
											className={`min-w-[32px] h-8 px-2 text-sm rounded-lg transition-all duration-200 ${
												page === validCurrentPage
													? "bg-primary text-primary-foreground font-medium shadow-sm"
													: "text-muted-foreground hover:bg-muted hover:text-foreground"
											} disabled:opacity-50 disabled:cursor-not-allowed`}
										>
											{page + 1}
										</button>
									)
								))}
							</div>
							
							{/* Next button */}
							<button
								onClick={() => onPageChange(Math.min(totalPages - 1, validCurrentPage + 1))}
								disabled={validCurrentPage >= totalPages - 1 || isLoading || totalPages <= 1}
								className="p-1.5 rounded-lg border border-border bg-card disabled:opacity-40 disabled:cursor-not-allowed hover:bg-muted transition-all duration-200 group"
								aria-label={t("common.pagination.nextPage")}
							>
								<ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground" />
							</button>
						</div>
					)}
				</div>
			</div>
		</div>
	);
};

export default Pagination;