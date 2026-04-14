import { Link } from 'react-router-dom'
import { IconArrowRight, IconShieldCheck, IconCreditCardOff } from '@tabler/icons-react'
import { useTranslation } from '@spatialhub/i18n'
import { useInView } from '../hooks/useInView'

export function LandingCTA() {
  const { t } = useTranslation()
  const { ref, inView } = useInView(0.2)

  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-emerald-600 via-emerald-600 to-teal-700 py-16 sm:py-24">
      {/* Layered radial gradients */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_20%_50%,rgba(255,255,255,0.12),transparent_50%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_80%_50%,rgba(255,255,255,0.08),transparent_50%)]" />

      {/* Grid pattern */}
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,.3) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.3) 1px,transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />

      {/* Floating orbs */}
      <div className="absolute -left-20 top-1/3 h-64 w-64 rounded-full bg-white/5 blur-3xl" />
      <div className="absolute -right-20 bottom-1/3 h-80 w-80 rounded-full bg-teal-300/10 blur-3xl" />

      <div
        ref={ref}
        className={`relative mx-auto max-w-4xl px-6 text-center transition-all duration-700 ${inView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}
      >
        <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-5xl">
          {t('landing.cta.title')}
        </h2>
        <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-emerald-100/90">
          {t('landing.cta.description')}
        </p>
        <div className={`mt-12 transition-all duration-700 delay-200 ${inView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
          <Link
            to="/register"
            className="group relative inline-flex items-center gap-2 overflow-hidden rounded-xl bg-white px-10 py-4 text-sm font-semibold text-emerald-700 shadow-lg shadow-emerald-900/20 transition-all duration-300 hover:bg-emerald-50 hover:shadow-xl hover:-translate-y-0.5"
          >
            <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-emerald-100/50 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
            {t('landing.cta.button')}
            <IconArrowRight size={18} className="transition-transform duration-300 group-hover:translate-x-1" />
          </Link>
        </div>

        {/* Trust signals */}
        <div className={`mt-10 flex flex-wrap items-center justify-center gap-6 transition-all duration-700 delay-300 ${inView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
          <div className="flex items-center gap-2 text-emerald-100/70">
            <IconCreditCardOff size={16} />
            <span className="text-xs font-medium">{t('landing.cta.noCreditCard', 'No credit card required')}</span>
          </div>
          <div className="flex items-center gap-2 text-emerald-100/70">
            <IconShieldCheck size={16} />
            <span className="text-xs font-medium">{t('landing.cta.gdpr', 'GDPR compliant')}</span>
          </div>
        </div>
      </div>
    </section>
  )
}
