import { IconMapSearch, IconSettings, IconRocket, IconChartPie } from '@tabler/icons-react'
import { useTranslation } from '@spatialhub/i18n'
import { useInView } from '../hooks/useInView'

const stepIcons = [IconMapSearch, IconSettings, IconRocket, IconChartPie]
const stepNumbers = ['01', '02', '03', '04']

export function LandingHowItWorks() {
  const { t } = useTranslation()
  const { ref, inView } = useInView(0.15)

  return (
    <section id="how-it-works" className="relative bg-muted/50 py-16 sm:py-24 overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,rgba(16,185,129,0.04),transparent_50%)]" />

      <div className="relative mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-widest text-emerald-600">
            {t('landing.howItWorks.label')}
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            {t('landing.howItWorks.title')}
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            {t('landing.howItWorks.description')}
          </p>
        </div>

        <div ref={ref} className="mx-auto mt-20 grid max-w-5xl gap-12 sm:grid-cols-2 lg:grid-cols-4 lg:gap-6">
          {stepNumbers.map((num, idx) => {
            const Icon = stepIcons[idx]
            return (
              <div
                key={num}
                className={`relative text-center transition-all duration-700 ${inView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}
                style={{ transitionDelay: inView ? `${idx * 150}ms` : '0ms' }}
              >
                {idx < stepNumbers.length - 1 && (
                  <div className="absolute left-[calc(50%+2.5rem)] top-8 hidden h-px w-[calc(100%-5rem)] lg:block">
                    <div
                      className={`h-full bg-gradient-to-r from-emerald-500/40 to-emerald-500/10 transition-all duration-1000 ${inView ? 'scale-x-100 opacity-100' : 'scale-x-0 opacity-0'}`}
                      style={{ transformOrigin: 'left', transitionDelay: inView ? `${(idx + 1) * 200}ms` : '0ms' }}
                    />
                  </div>
                )}

                <div className="relative mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-lg shadow-emerald-600/25 transition-transform duration-300 hover:scale-105">
                  <Icon size={28} strokeWidth={1.5} />
                  <span className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-[10px] font-bold text-emerald-400 ring-2 ring-emerald-600/30">
                    {num}
                  </span>
                </div>
                <h3 className="mt-2 text-base font-semibold text-foreground">{t(`landing.howItWorks.step${idx + 1}Title`)}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {t(`landing.howItWorks.step${idx + 1}Desc`)}
                </p>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
