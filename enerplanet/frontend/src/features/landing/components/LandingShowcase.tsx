import { useState, useCallback } from 'react'
import { IconMap, IconChartBar, IconTopologyStarRing3, IconBuilding, IconSolarPanel, IconChartAreaLine, IconBolt, IconArrowsExchange } from '@tabler/icons-react'
import { useTranslation } from '@spatialhub/i18n'
import { useInView } from '../hooks/useInView'

const showcaseKeys = [
  {
    key: 'map',
    icon: IconMap,
    gradient: 'from-emerald-600/20 via-emerald-900/30 to-slate-900/40',
    iconColor: 'text-emerald-400',
    illustration: 'map',
    screenshot: '/images/landing/screenshot-map.png',
  },
  {
    key: 'charts',
    icon: IconChartBar,
    gradient: 'from-blue-600/20 via-blue-900/30 to-slate-900/40',
    iconColor: 'text-blue-400',
    illustration: 'charts',
    screenshot: '/images/landing/screenshot-results.png',
  },
  {
    key: 'grid',
    icon: IconTopologyStarRing3,
    gradient: 'from-violet-600/20 via-violet-900/30 to-slate-900/40',
    iconColor: 'text-violet-400',
    illustration: 'grid',
    screenshot: '/images/landing/screenshot-grid.png',
  },
]

function MapIllustration() {
  return (
    <div className="relative w-full h-full flex items-center justify-center">
      <div className="relative w-48 h-36">
        {/* Buildings */}
        <div className="absolute bottom-2 left-4 w-10 h-16 rounded-t-sm bg-emerald-500/30 border border-emerald-400/30" />
        <div className="absolute bottom-2 left-16 w-8 h-24 rounded-t-sm bg-emerald-500/20 border border-emerald-400/20" />
        <div className="absolute bottom-2 left-[6.5rem] w-12 h-12 rounded-t-sm bg-emerald-500/25 border border-emerald-400/25" />
        <div className="absolute bottom-2 right-4 w-9 h-20 rounded-t-sm bg-emerald-500/30 border border-emerald-400/30" />
        {/* Solar panels */}
        <IconSolarPanel size={16} className="absolute top-5 left-[4.5rem] text-emerald-400/60" />
        <IconSolarPanel size={14} className="absolute top-8 right-8 text-emerald-400/50" />
        {/* Building icon */}
        <IconBuilding size={20} className="absolute bottom-8 left-6 text-emerald-300/50" />
        {/* Pin marker */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-emerald-400/80 ring-4 ring-emerald-400/20 animate-pulse" />
        {/* Ground line */}
        <div className="absolute bottom-1 left-0 right-0 h-px bg-emerald-400/20" />
      </div>
    </div>
  )
}

function ChartsIllustration() {
  return (
    <div className="relative w-full h-full flex items-center justify-center">
      <div className="relative w-48 h-36">
        {/* Bar chart */}
        <div className="absolute bottom-6 left-4 flex items-end gap-2 h-24">
          <div className="w-4 h-8 rounded-t bg-blue-400/40 animate-pulse [animation-delay:0s]" />
          <div className="w-4 h-16 rounded-t bg-blue-400/50 animate-pulse [animation-delay:0.2s]" />
          <div className="w-4 h-12 rounded-t bg-blue-400/60 animate-pulse [animation-delay:0.4s]" />
          <div className="w-4 h-20 rounded-t bg-blue-400/50 animate-pulse [animation-delay:0.6s]" />
          <div className="w-4 h-10 rounded-t bg-blue-400/40 animate-pulse [animation-delay:0.8s]" />
          <div className="w-4 h-14 rounded-t bg-blue-400/55 animate-pulse [animation-delay:1s]" />
        </div>
        {/* Line overlay */}
        <svg className="absolute inset-0" viewBox="0 0 192 144" fill="none">
          <polyline points="20,80 45,50 70,65 95,30 120,45 145,55" stroke="rgba(96,165,250,0.5)" strokeWidth="2" fill="none" strokeLinecap="round" />
        </svg>
        {/* Chart area icon */}
        <IconChartAreaLine size={18} className="absolute top-4 right-6 text-blue-400/50" />
        {/* Axis */}
        <div className="absolute bottom-5 left-3 right-3 h-px bg-blue-400/20" />
        <div className="absolute bottom-5 left-3 top-4 w-px bg-blue-400/20" />
      </div>
    </div>
  )
}

function GridIllustration() {
  return (
    <div className="relative w-full h-full flex items-center justify-center">
      <div className="relative w-48 h-36">
        {/* Nodes */}
        <div className="absolute top-4 left-1/2 -translate-x-1/2 w-8 h-8 rounded-full bg-violet-400/30 border-2 border-violet-400/40 flex items-center justify-center">
          <IconBolt size={14} className="text-violet-400" />
        </div>
        <div className="absolute top-[4.5rem] left-6 w-6 h-6 rounded-full bg-violet-400/20 border border-violet-400/30" />
        <div className="absolute top-[4.5rem] right-6 w-6 h-6 rounded-full bg-violet-400/20 border border-violet-400/30" />
        <div className="absolute bottom-4 left-1/4 w-6 h-6 rounded-full bg-violet-400/20 border border-violet-400/30" />
        <div className="absolute bottom-4 right-1/4 w-6 h-6 rounded-full bg-violet-400/20 border border-violet-400/30" />
        {/* Connection lines */}
        <svg className="absolute inset-0" viewBox="0 0 192 144" fill="none">
          <line x1="96" y1="36" x2="30" y2="80" stroke="rgba(167,139,250,0.3)" strokeWidth="1.5" />
          <line x1="96" y1="36" x2="162" y2="80" stroke="rgba(167,139,250,0.3)" strokeWidth="1.5" />
          <line x1="30" y1="80" x2="55" y2="120" stroke="rgba(167,139,250,0.25)" strokeWidth="1.5" />
          <line x1="162" y1="80" x2="137" y2="120" stroke="rgba(167,139,250,0.25)" strokeWidth="1.5" />
          <line x1="55" y1="120" x2="137" y2="120" stroke="rgba(167,139,250,0.2)" strokeWidth="1.5" strokeDasharray="4 4" />
        </svg>
        {/* Flow icon */}
        <IconArrowsExchange size={14} className="absolute top-[4.5rem] left-1/2 -translate-x-1/2 text-violet-400/50" />
      </div>
    </div>
  )
}

const illustrations: Record<string, () => JSX.Element> = {
  map: MapIllustration,
  charts: ChartsIllustration,
  grid: GridIllustration,
}

function ShowcaseCard({
  item,
  idx,
  inView,
}: {
  item: (typeof showcaseKeys)[number]
  idx: number
  inView: boolean
}) {
  const { t } = useTranslation()
  const Illustration = illustrations[item.illustration]
  const titleKey = `landing.showcase.${item.key}Title`
  const descKey = `landing.showcase.${item.key}Desc`
  const badgeKey = `landing.showcase.${item.key}Badge`
  const [imgFailed, setImgFailed] = useState(false)

  const handleImgError = useCallback(() => setImgFailed(true), [])

  const showScreenshot = item.screenshot && !imgFailed

  return (
    <div
      key={item.key}
      className={`group overflow-hidden rounded-2xl border border-border bg-card transition-all duration-700 hover:-translate-y-1 hover:shadow-xl ${inView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}
      style={{ transitionDelay: inView ? `${idx * 120}ms` : '0ms' }}
    >
      <div
        className={`relative flex aspect-[4/3] items-center justify-center bg-gradient-to-br ${item.gradient} overflow-hidden`}
      >
        {showScreenshot ? (
          <img src={item.screenshot} alt={t(titleKey)} className="w-full h-full object-cover" onError={handleImgError} />
        ) : (
          <>
            <div className="absolute inset-0 opacity-[0.06]" style={{
              backgroundImage: 'linear-gradient(rgba(255,255,255,.3) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.3) 1px,transparent 1px)',
              backgroundSize: '32px 32px',
            }} />
            <div className="relative z-10 w-full h-full">
              <Illustration />
            </div>
          </>
        )}

        <span className="absolute bottom-4 left-4 inline-flex items-center rounded-full bg-black/40 px-3 py-1 text-[10px] font-semibold text-white/90 backdrop-blur-sm">
          {t(badgeKey)}
        </span>
      </div>

      <div className="p-6">
        <div className="flex items-center gap-2 mb-2">
          <item.icon size={18} className={item.iconColor} strokeWidth={1.5} />
          <h3 className="text-base font-semibold text-foreground">{t(titleKey)}</h3>
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">{t(descKey)}</p>
      </div>
    </div>
  )
}

export function LandingShowcase() {
  const { t } = useTranslation()
  const { ref, inView } = useInView(0.1)

  return (
    <section className="bg-background py-16 sm:py-24">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-widest text-emerald-600">
            {t('landing.showcase.label')}
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            {t('landing.showcase.title')}
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            {t('landing.showcase.description')}
          </p>
        </div>

        <div ref={ref} className="mx-auto mt-16 grid max-w-6xl gap-8 lg:grid-cols-3">
          {showcaseKeys.map((item, idx) => (
            <ShowcaseCard key={item.key} item={item} idx={idx} inView={inView} />
          ))}
        </div>
      </div>
    </section>
  )
}
