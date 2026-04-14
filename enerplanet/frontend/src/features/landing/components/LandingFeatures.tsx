import { IconMapPin, IconSun, IconChartLine, IconBolt, IconFileAnalytics, IconUsers } from '@tabler/icons-react'
import { useTranslation } from '@spatialhub/i18n'
import { useInView } from '../hooks/useInView'

const featureKeys = [
  { key: 'map', icon: IconMapPin, color: 'emerald' },
  { key: 'multiTech', icon: IconSun, color: 'amber' },
  { key: 'simulation', icon: IconChartLine, color: 'blue' },
  { key: 'grid', icon: IconBolt, color: 'violet' },
  { key: 'reports', icon: IconFileAnalytics, color: 'rose' },
  { key: 'workspace', icon: IconUsers, color: 'teal' },
]

const colorMap: Record<string, { bg: string; text: string; border: string }> = {
  emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-500', border: 'group-hover:border-emerald-500/30' },
  amber: { bg: 'bg-amber-500/10', text: 'text-amber-500', border: 'group-hover:border-amber-500/30' },
  blue: { bg: 'bg-blue-500/10', text: 'text-blue-500', border: 'group-hover:border-blue-500/30' },
  violet: { bg: 'bg-violet-500/10', text: 'text-violet-500', border: 'group-hover:border-violet-500/30' },
  rose: { bg: 'bg-rose-500/10', text: 'text-rose-500', border: 'group-hover:border-rose-500/30' },
  teal: { bg: 'bg-teal-500/10', text: 'text-teal-500', border: 'group-hover:border-teal-500/30' },
}

export function LandingFeatures() {
  const { t } = useTranslation()
  const { ref, inView } = useInView(0.15)

  return (
    <section id="features" className="bg-background py-16 sm:py-24">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-widest text-emerald-600">
            {t('landing.features.label')}
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            {t('landing.features.title')}
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            {t('landing.features.description')}
          </p>
        </div>

        <div ref={ref} className="mx-auto mt-16 grid max-w-5xl gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {featureKeys.map((f, idx) => {
            const c = colorMap[f.color]
            return (
              <div
                key={f.key}
                className={`group relative rounded-2xl border border-border bg-card p-6 transition-all duration-500 hover:-translate-y-1 hover:shadow-xl ${c.border} ${inView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}
                style={{ transitionDelay: inView ? `${idx * 100}ms` : '0ms' }}
              >
                <div className={`mb-4 flex h-12 w-12 items-center justify-center rounded-xl ${c.bg} transition-transform duration-300 group-hover:scale-110`}>
                  <f.icon size={24} className={c.text} />
                </div>
                <h3 className="text-base font-semibold text-foreground">{t(`landing.features.${f.key}`)}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t(`landing.features.${f.key}Desc`)}</p>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
