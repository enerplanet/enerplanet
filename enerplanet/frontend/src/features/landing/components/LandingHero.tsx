import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { IconArrowRight, IconPlayerPlay } from '@tabler/icons-react'
import { useTranslation } from '@spatialhub/i18n'

function useParallax(speed = 0.3) {
  const [offset, setOffset] = useState(0)
  useEffect(() => {
    const onScroll = () => setOffset(window.scrollY * speed)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [speed])
  return offset
}

function AnimatedCounter({ target, suffix = '' }: { target: string; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [display, setDisplay] = useState('0')
  const [started, setStarted] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !started) { setStarted(true); obs.disconnect() }
    }, { threshold: 0.5 })
    obs.observe(el)
    return () => obs.disconnect()
  }, [started])

  useEffect(() => {
    if (!started) return
    const numMatch = target.match(/^([\d,]+)/)
    if (!numMatch) { setDisplay(target); return }
    const end = parseInt(numMatch[1].replace(/,/g, ''), 10)
    const rest = target.slice(numMatch[0].length)
    const duration = 1500
    const steps = 40
    const stepTime = duration / steps
    let step = 0
    const timer = setInterval(() => {
      step++
      const progress = step / steps
      const eased = 1 - Math.pow(1 - progress, 3)
      const current = Math.round(end * eased)
      setDisplay(current.toLocaleString() + rest + suffix)
      if (step >= steps) clearInterval(timer)
    }, stepTime)
    return () => clearInterval(timer)
  }, [started, target, suffix])

  return <span ref={ref}>{started ? display : '0'}</span>
}

export function LandingHero() {
  const { t } = useTranslation()
  const parallaxOffset = useParallax(0.3)

  const metrics = [
    { value: '4', suffix: '+', label: t('landing.hero.countries') },
    { value: '50', suffix: '+', label: t('landing.hero.regions') },
    { value: '8,760', suffix: 'h', label: t('landing.hero.hourlyResolution') },
    { value: '11', suffix: ' yrs', label: t('landing.hero.yearsData') },
    { value: '6', suffix: '+', label: t('landing.hero.technologies') },
  ]

  const countryFlags = [
    { flag: '🇩🇪', name: t('landing.hero.germany'), regions: t('landing.hero.deRegions') },
    { flag: '🇳🇱', name: t('landing.hero.netherlands'), regions: t('landing.hero.nlRegions') },
    { flag: '🇦🇹', name: t('landing.hero.austria'), regions: t('landing.hero.atRegions') },
    { flag: '🇨🇿', name: t('landing.hero.czechRepublic'), regions: t('landing.hero.czRegions') },
  ]

  return (
    <section className="relative overflow-hidden bg-slate-950 px-6 py-24 sm:py-32 lg:py-40">
      {/* Layered gradient background with parallax */}
      <div className="absolute inset-0" style={{ transform: `translateY(${parallaxOffset}px)` }}>
        <div className="absolute inset-0 bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_20%,rgba(16,185,129,0.18),transparent_50%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_80%_80%,rgba(16,185,129,0.1),transparent_50%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(16,185,129,0.08),transparent_40%)]" />

        {/* Grid pattern */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,.1) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.1) 1px,transparent 1px)',
            backgroundSize: '64px 64px',
          }}
        />

        {/* Floating orbs */}
        <div className="absolute left-1/4 top-1/4 h-72 w-72 rounded-full bg-emerald-500/5 blur-3xl animate-pulse" />
        <div className="absolute right-1/4 bottom-1/4 h-96 w-96 rounded-full bg-teal-500/5 blur-3xl animate-pulse [animation-delay:2s]" />
      </div>

      <div className="relative mx-auto max-w-5xl text-center">
        {/* Badge */}
        <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-5 py-2 animate-fadeInDown">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
          </span>
          <span className="text-xs font-semibold tracking-wide text-emerald-300">{t('landing.hero.badge')}</span>
        </div>

        <h1 className="text-4xl font-extrabold tracking-tight text-white sm:text-6xl lg:text-7xl xl:text-[5.25rem] animate-fadeInUp">
          {t('landing.hero.title1')}
          <br />
          {t('landing.hero.titleFor')}{' '}
          <span className="bg-gradient-to-r from-emerald-400 via-teal-300 to-emerald-400 bg-clip-text text-transparent bg-[length:200%_auto] animate-shimmer">
            {t('landing.hero.titleHighlight')}
          </span>
        </h1>

        <p className="mx-auto mt-8 max-w-2xl text-lg leading-relaxed text-slate-300/80 sm:text-xl animate-fadeInUp [animation-delay:0.1s]">
          {t('landing.hero.description')}
        </p>

        <div className="mt-12 flex flex-col items-center gap-4 sm:flex-row sm:justify-center animate-fadeInUp [animation-delay:0.2s]">
          <Link
            to="/register"
            className="group relative flex items-center gap-2 overflow-hidden rounded-xl bg-emerald-600 px-8 py-4 text-sm font-semibold text-white shadow-lg shadow-emerald-600/25 transition-all duration-300 hover:bg-emerald-500 hover:shadow-emerald-500/40 hover:shadow-xl hover:-translate-y-0.5"
          >
            <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/10 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
            {t('landing.hero.getStarted')}
            <IconArrowRight
              size={18}
              className="transition-transform duration-300 group-hover:translate-x-1"
            />
          </Link>
          <a
            href="#how-it-works"
            className="group flex items-center gap-2.5 rounded-xl border border-white/15 px-8 py-4 text-sm font-semibold text-slate-300 transition-all duration-300 hover:border-white/30 hover:bg-white/5 hover:text-white"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 transition-colors group-hover:bg-white/20">
              <IconPlayerPlay size={14} />
            </span>
            {t('landing.hero.seeHow')}
          </a>
        </div>

        {/* Metrics ribbon */}
        <div className="mt-20 flex flex-wrap items-center justify-center gap-x-12 gap-y-6 animate-fadeInUp [animation-delay:0.3s]">
          {metrics.map((m) => (
            <div key={m.label} className="flex items-center gap-3">
              <span className="text-2xl font-bold text-white">
                <AnimatedCounter target={m.value} suffix={m.suffix} />
              </span>
              <span className="text-xs text-slate-400">{m.label}</span>
            </div>
          ))}
        </div>

        {/* Country flags */}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-4 animate-fadeInUp [animation-delay:0.4s]">
          {countryFlags.map((c) => (
            <div key={c.name} className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 backdrop-blur-sm">
              <span className="text-base">{c.flag}</span>
              <span className="text-xs font-medium text-slate-300">{c.name}</span>
              <span className="text-[10px] text-slate-500">{c.regions}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
