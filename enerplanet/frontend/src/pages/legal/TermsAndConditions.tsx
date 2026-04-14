import React from "react";
import { FileText } from "lucide-react";

const TermsAndConditions: React.FC = () => {
  return (
    <div className="container mx-auto px-4 py-8">
      <header className="mb-8">
        <div className="flex items-center gap-3 mb-4">
          <FileText className="h-8 w-8 text-primary" />
          <h1 className="text-3xl font-bold text-foreground">Terms and Conditions</h1>
        </div>
        <p className="text-sm text-muted-foreground">Last updated: February 4, 2026</p>
      </header>
      <div className="prose prose-lg max-w-none text-foreground">
        <p>This page is under construction. Please check back later.</p>
      </div>
    </div>
  );
};

export default TermsAndConditions;
