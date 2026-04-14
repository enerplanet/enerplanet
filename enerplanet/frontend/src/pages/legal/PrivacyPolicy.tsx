import React from "react";
import { Shield } from "lucide-react";

const PrivacyPolicy: React.FC = () => {
  return (
    <div className="container mx-auto px-4 py-8">
      <header className="mb-8">
        <div className="flex items-center gap-3 mb-4">
          <Shield className="h-8 w-8 text-primary" />
          <h1 className="text-3xl font-bold text-foreground">Privacy Policy</h1>
        </div>
        <p className="text-sm text-muted-foreground">Last updated: February 11, 2026</p>
      </header>
      <div className="prose prose-lg max-w-none text-foreground">
        <p>
          EnerPlanET is a web application managed and curated by the EnerPlanET Team at the
          Technology Campus Freyung (TCF), which is part of the Deggendorf Institute of Technology
          (DIT) It is represented by the president{" "}
          <a href="https://www.th-deg.de/en/Waldemar-Berg-Hochschulleitung-1772">
            Prof. Waldemar Berg
          </a>
          .
        </p>
        <p>
          <strong>Address:</strong>
          <br />
          Deggendorf Institute of Technology
          <br />
          Dieter-Görlitz-Platz 1<br />
          94469 Deggendorf
          <br />
          Germany
        </p>
        <p>
          <strong>Appointed Official Data Protection Officer:</strong>
          <br />
          Prof. Dr. Sascha Kreiskott
          <br />
          Email: <a href="mailto:datenschutz@th-deg.de">datenschutz&#64;th-deg.de</a>
        </p>
        <p>
          <strong>The following shall apply in principle:</strong>
        </p>
        <p>
          In order to ensure the appropriate security of your data during transfer, we use
          encryption processes (e.g. SSL/TLS) and secured technical systems based on the state of
          the art.
        </p>
        <p>
          Javascript is used as the active component for webpages and is required for EnerPlanEt to
          function. If you have disabled this function in your browser, you will see the relevant
          prompt to re-activate it.
        </p>
        <h3 id="log-files">Log Files</h3>
        <p>
          When a user accesses EnerPlanET and when they retrieve a file, this process may store data
          in a protocol file. The following data set is then stored in each case:
        </p>
        <ul>
          <li>Date and time of the request</li>
          <li>Name of the requested file</li>
          <li>Page from which the file was requested</li>
          <li>Access status (for example, file transferred, file not found)</li>
          <li>The web browser and screen resolution used and the operating system used</li>
          <li>Complete IP address of the requesting computer</li>
          <li>
            Data volume transferred
            <h3 id="essential-cookies">Essential Cookies</h3>
          </li>
        </ul>
        <p>
          Cookies and entries in local storage are crucial for the functioning of EnerPlanET,
          particularly for authentication and security purposes. We do not use cookies for social
          tracking, analytics, or any other non-essential purposes.
        </p>
        <ul>
          <li>
            <strong>cookieconsent_status</strong>
            <ul>
              <li>
                <strong>Storage Period</strong>: 30 days
              </li>
              <li>
                <strong>Purpose</strong>: This cookie records the user's consent status regarding
                cookie usage. It helps us remember whether you have accepted or declined cookies so
                that we can respect your preferences on subsequent visits.
              </li>
            </ul>
          </li>
          <li>
            <strong>XSRF-Token</strong>
            <ul>
              <li>
                <strong>Storage Period</strong>: 2 hours
              </li>
              <li>
                <strong>Purpose</strong>: This cookie stores a Cross-Site Request Forgery (CSRF)
                token, which is a security measure used to protect against unauthorized commands
                being transmitted from a user that the web application trusts. It ensures that
                requests made to the server are genuine and originate from the authenticated user.
              </li>
            </ul>
          </li>
          <li>
            <strong>enerplanet_session</strong>
            <ul>
              <li>
                <strong>Storage Period</strong>: 2 hours
              </li>
              <li>
                <strong>Purpose</strong>: This session cookie is used to maintain the user's session
                while interacting with EnerPlanET. It allows the application to remember your
                logged-in status and other session-specific information during your visit. The
                cookie expires after a set period of inactivity or when the browser is closed,
                helping to secure user sessions.
              </li>
            </ul>
          </li>
        </ul>
        <p>
          These cookies are essential for ensuring the proper functioning and security of our web
          application. They are not used for tracking or analyzing user behavior beyond the scope of
          their functional purpose.
        </p>
        <h3 id="local-storage">Local Storage</h3>
        <p>
          Local storage is utilized by EnerPlanET to manage authentication, security and
          configuration functions. We do not use local storage for tracking or analytics purposes.
        </p>
        <h4 id="authentication-">Authentication:</h4>
        <p>Local storage items are saved after user login, following the OAuth3 standard.</p>
        <ul>
          <li>
            <strong>access_token</strong>
            <ul>
              <li>
                <strong>Purpose</strong>: This token is used to authenticate a user with the API,
                granting access to protected resources.
              </li>
              <li>
                <strong>Storage Period</strong>: 10 hours
              </li>
              <li>
                <strong>Description</strong>: The access token is stored to maintain the user's
                session and enable secure interactions with the API. It expires after 10 hours to
                ensure security.
              </li>
            </ul>
          </li>
          <li>
            <strong>refresh_token</strong>
            <ul>
              <li>
                <strong>Purpose</strong>: This token is used to obtain a new access token once the
                original one has expired.
              </li>
              <li>
                <strong>Storage Period</strong>: 10 days
              </li>
              <li>
                <strong>Description</strong>: The refresh token allows users to stay logged in
                without re-entering credentials. It has a longer lifespan of 10 days to facilitate
                continuous access.
              </li>
            </ul>
          </li>
          <li>
            <strong>access_token_expires_at</strong>
            <ul>
              <li>
                <strong>Purpose</strong>: This entry saves the timestamp indicating when the access
                token will expire.
              </li>
              <li>
                <strong>Storage Period</strong>: Until logout
              </li>
              <li>
                <strong>Description</strong>: The expiration timestamp helps manage token renewal
                and ensures that the access token is refreshed or the user is logged out when it
                expires. It is cleared upon logout to maintain security.
              </li>
            </ul>
          </li>
        </ul>
        <p>
          These local storage entries are critical for managing user authentication and ensuring
          secure access to EnerPlanET's services.
        </p>
        <h4 id="configurations-and-settings">Configurations and Settings</h4>
        <p>
          This data is stored when local settings that differ from the default are saved. It
          includes information such as whether certain elements like the intro have been viewed or
          not.
        </p>
        <ul>
          <li>
            <strong>localPreferences</strong>:
            <ul>
              <li>
                <strong>Storage Period</strong>: Data is retained until the user clears it manually.
                Users can manage or clear their local storage through their browser settings.
              </li>
              <li>
                <strong>Purpose</strong>: This data is used to store user preferences and
                configurations to enhance your experience on EnerPlanET. It is not linked to our
                servers, not used for tracking, and is solely meant to improve your interaction with
                the application.
              </li>
            </ul>
          </li>
        </ul>
        <h3 id="data-processing-3rd-party-services">Data Processing &amp; 3rd Party Services</h3>
        <h4 id="openstreetmap-carto">OpenStreetMap &amp; CARTO</h4>
        <p>
          By consenting to the <strong>Data Processing &amp; Privacy Note</strong>, you enable the
          use of third-party basemaps provided by CARTO, which integrates with OpenStreetMap data.
          This consent also allows us to use local storage for managing your settings and
          configurations within EnerPlanET.
        </p>
        <p>
          Your data, including IP address, browser + Device Type and time of request, may be shared
          with CARTO and the OSMF for loading and displaying map tiles. For more details on how
          CARTO and OSMF handles your information, please review their respective Policies: <br />
          <a href="https://carto.com/privacy">CARTO Privacy Policy</a> <br />
          <a href="https://osmfoundation.org/wiki/Privacy_Policy">OSMF Privacy Policy</a>
        </p>
        <h3 id="data-processing-and-privacy">Data Processing and Privacy</h3>
        <p>
          <strong>Time limits for data deletion:</strong> Specific retention requirements and
          periods apply by virtue of the statutory provisions. Once these periods have elapsed, the
          relevant data are routinely deleted. For the rest, personal data are deleted as soon as
          they are no longer required for the purpose for which they were collected or the
          legitimate basis for data handling ceases to apply (e.g. as a result of withdrawal of
          consent). When an employee leaves the University's employment, accounts and data
          associated with this individual shall be changed to a normal user account within a
          reasonable time, while on the other hand, all other editorial entries on university
          webpages will not be deleted until the individual withdraws consent. In principle,
          individuals shall each be responsible for deleting their own personal entries and links to
          internet search engines of other data controllers.
        </p>
        <p>Recorded data shall not be forwarded to third parties.</p>
        <p>
          If email addresses are used that are provided by DIT, all incoming emails are scanned
          using various automated procedures:
        </p>
        <ul>
          <li>
            <em>Virus scanners:</em> If an email is found to contain a virus, the email is deleted
            immediately for security reasons. The recipient receives an automated email notification
            of this. The virus scanner cannot be deactivated. Use of the virus scanner does not
            provide 100% security, but forms part of the user's personal security policy.
          </li>
          <li>
            <em>Spam filter:</em> All incoming emails are scanned by the system for particular terms
            or word combinations. The result of the scan is entered in an additional header field in
            the email. Emails can then be automatically forwarded to a special email folder in the
            allocated inbox on the basis of the header field. Emails that have been forwarded to the
            special folder can be automatically deleted. Each user is able to configure this spam
            filter function themselves according to the functions provided. The user is able to
            disable the spam filter at any time. Emails that have been filtered or deleted can no
            longer be automatically forwarded to the inbox or restored.
          </li>
        </ul>
        <p>
          Employees of DIT are required to observe confidentiality with regard to personal data.
          These data will only be forwarded to third parties if this is required for the purpose of
          compliance with official duties. These third parties are also required to comply with
          personal data protection provisions.
        </p>
        <p>
          All data available under "*.th-deg.de" that are located on our servers and are hosted
          (stored) there are protected against unauthorised access by security systems. The efficacy
          of protection is tested by employees of DIT and its system service providers.
        </p>
        <p>
          After a user leaves a page (such as by clicking on an external link), the selected target
          site may place cookies. EnerPlanET has no legal responsibility for these cookies. For
          information regarding the use of such cookies and the information stored in them, please
          check their privacy policies.
        </p>
        <p>
          All operated servers on which personal data are processed or recorded for EnerPlanET users
          are located within the Federal Republic of Germany.
        </p>
        <p>
          The browser security settings make it possible to allow or prohibit the storing of
          cookies. Further information about the use of cookies can also be found online on the
          website of the German Federal Office for Information Security (
          <a href="http://www.bsi.de/" title="Opens internal link in current window">
            www.bsi.de
          </a>
          ).
          <br />
          If EnerPlanET instructs partner companies to perform particular services, the data
          protection provisions shall be incorporated in the contracts and the partners shall be
          required to comply with data protection law.
        </p>
        <p>
          <strong>Contacting EnerPlanET using feedback forms:</strong> <br /> To correct errors on
          EnerPlanET feedback forms can be used to send us a query or notification. This can be done
          fully anonymously. Further personal data may be provided to us voluntarily. The data will
          not be used for any other purpose or forwarded to third parties.
        </p>
        <h4 id="events-press-relations-and-public-relations">
          Events, press relations and public relations:
        </h4>
        <p>
          EnerPlanET also acts as a (co-) organiser of various events.
          <br />
          In the case of an invitation to or participation in an event, EnerPlanET will process
          personal data (name, address, etc.). This may take place via various communication
          channels, such as by completing a (web) form or by email or telephone.
        </p>
        <p>
          The personal data provided to EnerPlanET for this purpose are indicated in the relevant
          (web) form or by the data requested during a call.
        </p>
        <h5 id="data-collected-from-accompanying-persons">
          Data collected from accompanying persons:
        </h5>
        <p>
          For the purpose of proper running of the event, data from persons accompanying invited
          participants are also collected and processed. These persons shall have the same rights as
          stated here for all other persons affected by data collection, including rights to
          information regarding the nature and quantity of data, making objections to processing,
          and deletion of data in particular. Attention is drawn in this regard to the explanations
          under Right to information and Rectifications below.
        </p>
        <h5 id="further-processing-of-collected-data">Further processing of collected data:</h5>
        <p>
          Personal data will not be forwarded to third parties without authorisation, but shall be
          stored and processed for internal use within EnerPlanET and for the purpose of organising
          and running events (such as compiling guest lists, enabling entry checks, etc.) EnerPlanET
          may arrange for data to be forwarded to one or more contractual processors that use(s)
          personal data at the instruction of EnerPlanET and only for internal use that is
          attributable to EnerPlanET.
        </p>
        <p>
          Depending on the nature of the event, EnerPlanET shall act as a co-organiser alongside an
          additional cooperation partner. In such cases, the data collected for the purpose of the
          event will be forwarded to our cooperation partners, who will also be permitted to use
          these data exclusively for ensuring the proper running of the event. Notification
          regarding exactly which cooperation partners are involved in an individual case shall be
          provided separately within the scope of organising the event.
        </p>
        <p>
          Data shall be stored only for as long as necessary for the organisation and running of
          events, and in order to perform our duties relating to public relations.
        </p>
        <p>
          As a recipient of correspondence/invitations, you may object to receiving any further
          correspondence/invitations at any time.
        </p>
        <h5 id="video-audio-recording-and-photography">Video/audio recording and photography</h5>
        <p>
          Within the scope of performing EnerPlanET's press and public relations duties, video/audio
          recordings and photographs may be taken and used, in/on which you may be identifiably
          featured. The produced audio/visual material may be used free of any fee and without
          restriction in terms of time, space or content. You are also entitled to object to this.
          Please use the contact details shown to file your objection.
        </p>
        <h4 id="purposes-and-legal-basis-and-regulations-for-processing-in-accordance-with-article-6-gdpr">
          Purposes and legal basis and regulations for processing in accordance with Article 6 GDPR
        </h4>
        <p>
          We provide our services, administrative services, and information for the public about our
          activities on our website in accordance with Article 2, paragraph 6 BayHSchG, and Article
          4, paragraph 1, sentences 1 and 2 BayEGovG.
        </p>
        <p>
          We shall disclose content and contributions or queries that violate third-party rights or
          constitute a criminal or administrative offence, or fail to fulfil the conduct required by
          law or by contract, by forwarding them to the competent authority or the social media
          provider, and block or delete them.
        </p>
        <p>
          We use protocol files, logs, and model data to carry out organisational reviews, perform
          tests or maintenance of our web service, and guarantee network and information security in
          accordance with Article 6, para. 1 BayDSG [Bavarian Data Protection Act]; Section 13,
          para. 7 TMG [Telemedia Act]; Art. 11 para. 1 BayEGovG [Bavarian E-Government Act]. We
          anonymize or pseudonymize personal data unless this affects the purpose of processing.
        </p>
        <h4 id="right-to-information-and-rectifications">
          Right to information and rectifications
        </h4>
        <p>
          In accordance with the General Data Protection Act, you are entitled to the following
          rights:
        </p>
        <ul>
          <li>
            If your personal data are being processed, you have the right to obtain information
            regarding the data stored about you (Article 15 GDPR).
          </li>
          <li>
            Should inaccurate personal data be being processed, you are entitled to have them
            rectified (Article 16 GDPR).
          </li>
          <li>
            Should the statutory conditions exist, you may request the erasure or restriction of
            processing of data, or file an objection to processing (Articles 17, 18 and 21 GDPR).
          </li>
          <li>
            If you have agreed to data processing or a data processing agreement exists and data
            processing is being carried out using an automated process, you are entitled to data
            portability if required (Article 20 GDPR)
          </li>
        </ul>
        <p>
          Should you have any further questions regarding collection of personal data, you are
          welcome to contact the University's Data Protection Officer in accordance with the EU
          GDPR.
        </p>
        <p>
          Should you exercise any of the aforementioned rights, the public office will verify
          whether the statutory requirements for this have been fulfilled.
        </p>
        <p>
          Individuals also have a right of complaint to the Bavarian Federal State Data Protection
          Officer.
        </p>
        <p>
          <em>Amended: 11.02.2024</em>
        </p>
      </div>
      <div className="mt-12 pt-8 border-t border-border"></div>
    </div>
  );
};

export default PrivacyPolicy;
