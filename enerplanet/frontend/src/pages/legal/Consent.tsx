import React from "react";
import { CheckCircle } from "lucide-react";

const Consent: React.FC = () => {
  return (
    <div className="container mx-auto px-4 py-8">
      <header className="mb-8">
        <div className="flex items-center gap-3 mb-4">
          <CheckCircle className="h-8 w-8 text-primary" />
          <h1 className="text-3xl font-bold text-foreground">Declaration of Consent</h1>
        </div>
        <p className="text-sm text-muted-foreground">Last updated: February 9, 2026</p>
      </header>
      <div className="prose prose-lg max-w-none text-foreground">
        <p>
          By creating a user account, I consent to the storage and processing of my username and
          email address, which are essential for account creation and important communications
          related to my use of EnerPlanET.
        </p>
        <p>
          I understand that any data I provide for energy model creation will be used solely for
          conducting simulations. This data will not be analyzed, shared, or utilized for any other
          purposes.
        </p>
        <p>
          I acknowledge that my consent is voluntary, and I have the right to withdraw it at any
          time by contacting the EnerPlanET Team from the Deggendorf University of Technology at{" "}
          <a href="mailto:enerplanet@th-deg.de">enerplanet&#64;th-deg.de</a>. Upon revocation, my
          personal data will be deleted without undue delay, in accordance with legal and technical
          requirements, and any processing that occurred prior to revocation will remain lawful.
        </p>
        <p>
          The data controller responsible for processing your personal data is Deggendorf Institute
          of Technology (DIT), Edlmairstraße 6, 94469 Deggendorf, Germany.
        </p>
        <p>
          I have the right to access my personal data and request corrections or deletions in
          accordance with GDPR provisions. For more details on how my data will be handled, I can
          review the {" "}
          <a href="/privacy" target="_blank">
            Privacy Policy
          </a>
          .
        </p>
        <p>
          The legal basis for processing your personal data is your consent in accordance with Art.
          6(1)(a) GDPR.
        </p>
        <p>
          I understand that this Declaration of Consent may be updated in the future. I will be
          notified of significant changes, and my continued use of EnerPlanET after such
          notification constitutes acceptance of the updated terms.
        </p>
      </div>
    </div>
  );
};

export default Consent;
