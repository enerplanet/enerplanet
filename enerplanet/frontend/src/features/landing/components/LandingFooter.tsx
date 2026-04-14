import { Link } from 'react-router-dom'
import { useTranslation } from '@spatialhub/i18n'

export function LandingFooter() {
  const { t } = useTranslation()

  const footerSections = [
    {
      title: t('landing.footer.product'),
      links: [
        { label: t('landing.footer.features'), href: '#features' },
        { label: t('landing.footer.howItWorks'), href: '#how-it-works' },
        { label: t('landing.footer.documentation'), href: '#features' },
      ],
    },
    {
      title: t('landing.footer.legal'),
      links: [
        { label: t('landing.footer.privacyPolicy'), to: '/privacy' },
        { label: t('landing.footer.termsConditions'), to: '/terms-and-conditions' },
        { label: t('landing.footer.impressum'), to: '/impressum' },
        { label: t('landing.footer.disclaimer'), to: '/disclaimer' },
      ],
    },
    {
      title: t('landing.footer.project'),
      links: [
        { label: t('landing.footer.about'), href: '#about' },
        { label: t('landing.footer.acknowledgements'), to: '/acknowledgements' },
        { label: t('landing.footer.thirdPartyLicenses'), to: '/third-party' },
      ],
    },
  ]
  return (
    <footer className="relative bg-slate-950 pt-20 pb-12">
      {/* Top gradient border */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />

      <div className="mx-auto max-w-7xl px-6">
        <div className="grid gap-12 sm:grid-cols-2 lg:grid-cols-4">
          {/* Brand column */}
          <div>
            <div className="flex items-center gap-2.5">
              <img
                src="/images/logo/enerplanet-logo.png"
                alt="EnerPlanET"
                className="h-8 brightness-0 invert"
              />
            </div>
            <p className="mt-4 text-sm leading-relaxed text-slate-400">
              {t('landing.footer.brandDescription')}
            </p>
          </div>

          {/* Link columns */}
          {footerSections.map((section) => (
            <div key={section.title}>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-300">{section.title}</h4>
              <ul className="mt-4 space-y-2.5">
                {section.links.map((link) => (
                  <li key={link.label}>
                    {link.to ? (
                      <Link
                        to={link.to}
                        className="text-sm text-slate-400 transition-colors duration-200 hover:text-emerald-400"
                      >
                        {link.label}
                      </Link>
                    ) : (
                      <a
                        href={link.href}
                        className="text-sm text-slate-400 transition-colors duration-200 hover:text-emerald-400"
                      >
                        {link.label}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-16 border-t border-white/10 pt-8">
          <div className="flex flex-col items-center gap-6">
            <img
              src="/images/landing/thd-logo.png"
              alt="Technische Hochschule Deggendorf"
              className="h-12 opacity-70"
            />
            <p className="text-center text-xs leading-relaxed text-slate-500">
              {t('landing.footer.copyright', { year: new Date().getFullYear() })}
            </p>
          </div>
        </div>
      </div>
    </footer>
  )
}
