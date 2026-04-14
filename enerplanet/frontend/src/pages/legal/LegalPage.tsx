import React, { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useDocumentTitle } from "@/hooks/use-document-title";
import PrivacyPolicy from "./PrivacyPolicy";
import Impressum from "./Impressum";
import Acknowledgements from "./Acknowledgements";
import Consent from "./Consent";
import Disclaimer from "./Disclaimer";
import TermsAndConditions from "./TermsAndConditions";
import { Shield, Building, Heart, CheckCircle, AlertTriangle } from "lucide-react";

// Tab configuration
const TABS: { key: string; label: string; icon: typeof Shield }[] = [
  { key: "privacy", label: "Privacy Policy", icon: Shield },
  { key: "impressum", label: "Imprint", icon: Building },
  { key: "consent", label: "Consent", icon: CheckCircle },
  { key: "disclaimer", label: "Disclaimer", icon: AlertTriangle },
  { key: "acknowledgements", label: "Acknowledgements", icon: Heart },
  // { key: "terms", label: "Terms & Conditions", icon: FileText },
];

type TabKey =
  | "privacy"
  | "impressum"
  | "consent"
  | "disclaimer"
  | "acknowledgements"
  | "terms"
  | "third-party";

const LegalPage: React.FC = () => {
  useDocumentTitle("Legal");
  const location = useLocation();
  const [activeTab, setActiveTab] = useState<TabKey>("privacy");

  useEffect(() => {
    const path = location.pathname;
    if (path === "/privacy") setActiveTab("privacy");
    else if (path === "/impressum") setActiveTab("impressum");
    else if (path === "/consent") setActiveTab("consent");
    else if (path === "/disclaimer") setActiveTab("disclaimer");
    else if (path === "/acknowledgements") setActiveTab("acknowledgements");
    else if (path === "/terms-and-conditions") setActiveTab("terms");
    else if (path === "/third-party") setActiveTab("third-party");
    else setActiveTab("privacy"); // default for /legal
  }, [location.pathname]);

  const renderContent = () => {
    switch (activeTab) {
      case "privacy":
        return <PrivacyPolicy />;
      case "impressum":
        return <Impressum />;
      case "consent":
        return <Consent />;
      case "disclaimer":
        return <Disclaimer />;
      case "acknowledgements":
        return <Acknowledgements />;
      case "terms":
        return <TermsAndConditions />;
      default:
        return <PrivacyPolicy />;
    }
  };

  return (
    <div className="flex h-full bg-background">
      {/* Sidebar */}
      <div className="w-64 bg-card border-r border-border flex flex-col">
        <div className="p-6 border-b border-border">
          <h1 className="text-2xl font-bold text-foreground">Legal</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Privacy, terms, and legal information
          </p>
        </div>
        <nav className="flex-1 p-4">
          <div className="space-y-2">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              return (
                    <button
                      onClick={() => setActiveTab(tab.key as TabKey)}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
                        activeTab === tab.key
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      }`}
                    >
                      <Icon className="w-5 h-5" />
                      <span className="text-sm font-medium">{tab.label}</span>
                    </button>
              );
            })}
          </div>
        </nav>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        <div className="p-6">{renderContent()}</div>
      </div>
    </div>
  );
};

export default LegalPage;
