import { useTranslation } from '@spatialhub/i18n'
import { IconCheck } from '@tabler/icons-react'
import { useInView } from '../hooks/useInView'

const techKeys = ['pv', 'wind', 'biomass', 'geothermal', 'battery'] as const

const techColors: Record<
  string,
  { accent: string; accentLight: string; bg: string; border: string; glow: string; text: string; gradFrom: string; gradTo: string }
> = {
  pv: {
    accent: '#f59e0b',
    accentLight: '#fbbf24',
    bg: 'bg-amber-500/5',
    border: 'border-amber-500/15 hover:border-amber-400/40',
    glow: 'hover:shadow-[0_8px_40px_-8px_rgba(245,158,11,0.2)]',
    text: 'text-amber-500',
    gradFrom: 'from-amber-500/10',
    gradTo: 'to-amber-600/5',
  },
  wind: {
    accent: '#0ea5e9',
    accentLight: '#38bdf8',
    bg: 'bg-sky-500/5',
    border: 'border-sky-500/15 hover:border-sky-400/40',
    glow: 'hover:shadow-[0_8px_40px_-8px_rgba(14,165,233,0.2)]',
    text: 'text-sky-500',
    gradFrom: 'from-sky-500/10',
    gradTo: 'to-sky-600/5',
  },
  biomass: {
    accent: '#22c55e',
    accentLight: '#4ade80',
    bg: 'bg-green-500/5',
    border: 'border-green-500/15 hover:border-green-400/40',
    glow: 'hover:shadow-[0_8px_40px_-8px_rgba(34,197,94,0.2)]',
    text: 'text-green-500',
    gradFrom: 'from-green-500/10',
    gradTo: 'to-green-600/5',
  },
  geothermal: {
    accent: '#ef4444',
    accentLight: '#f87171',
    bg: 'bg-red-500/5',
    border: 'border-red-500/15 hover:border-red-400/40',
    glow: 'hover:shadow-[0_8px_40px_-8px_rgba(239,68,68,0.2)]',
    text: 'text-red-500',
    gradFrom: 'from-red-500/10',
    gradTo: 'to-red-600/5',
  },
  battery: {
    accent: '#8b5cf6',
    accentLight: '#a78bfa',
    bg: 'bg-violet-500/5',
    border: 'border-violet-500/15 hover:border-violet-400/40',
    glow: 'hover:shadow-[0_8px_40px_-8px_rgba(139,92,246,0.2)]',
    text: 'text-violet-500',
    gradFrom: 'from-violet-500/10',
    gradTo: 'to-violet-600/5',
  },
}

function SolarPanelSVG({ color, light }: { color: string; light: string }) {
  return (
    <svg viewBox="0 0 200 160" fill="none" className="h-full w-full">
      {/* Sun with glow */}
      <circle cx="160" cy="28" r="22" fill={light} fillOpacity="0.3" />
      <circle cx="160" cy="28" r="14" fill={color} fillOpacity="0.5" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
        <line
          key={angle}
          x1={160 + 18 * Math.cos((angle * Math.PI) / 180)}
          y1={28 + 18 * Math.sin((angle * Math.PI) / 180)}
          x2={160 + 30 * Math.cos((angle * Math.PI) / 180)}
          y2={28 + 30 * Math.sin((angle * Math.PI) / 180)}
          stroke={color}
          strokeOpacity="0.5"
          strokeWidth="2"
          strokeLinecap="round"
        />
      ))}
      {/* Panel mount legs */}
      <rect x="68" y="125" width="5" height="22" rx="1.5" fill={color} fillOpacity="0.35" />
      <rect x="127" y="125" width="5" height="22" rx="1.5" fill={color} fillOpacity="0.35" />
      {/* Solar panel - tilted */}
      <g transform="translate(100, 88) rotate(-12)">
        <rect x="-56" y="-32" width="112" height="64" rx="5" fill={color} fillOpacity="0.15" stroke={color} strokeOpacity="0.5" strokeWidth="2" />
        {/* Grid lines */}
        <line x1="-56" y1="-10" x2="56" y2="-10" stroke={color} strokeOpacity="0.35" strokeWidth="1.5" />
        <line x1="-56" y1="12" x2="56" y2="12" stroke={color} strokeOpacity="0.35" strokeWidth="1.5" />
        <line x1="-18" y1="-32" x2="-18" y2="32" stroke={color} strokeOpacity="0.35" strokeWidth="1.5" />
        <line x1="18" y1="-32" x2="18" y2="32" stroke={color} strokeOpacity="0.35" strokeWidth="1.5" />
        {/* Panel cells */}
        <rect x="-54" y="-30" width="34" height="18" rx="2" fill={color} fillOpacity="0.3" />
        <rect x="-16" y="-30" width="34" height="18" rx="2" fill={color} fillOpacity="0.22" />
        <rect x="20" y="-30" width="34" height="18" rx="2" fill={color} fillOpacity="0.18" />
        <rect x="-54" y="-8" width="34" height="18" rx="2" fill={color} fillOpacity="0.22" />
        <rect x="-16" y="-8" width="34" height="18" rx="2" fill={color} fillOpacity="0.18" />
        <rect x="20" y="-8" width="34" height="18" rx="2" fill={color} fillOpacity="0.3" />
        <rect x="-54" y="14" width="34" height="16" rx="2" fill={color} fillOpacity="0.18" />
        <rect x="-16" y="14" width="34" height="16" rx="2" fill={color} fillOpacity="0.3" />
        <rect x="20" y="14" width="34" height="16" rx="2" fill={color} fillOpacity="0.22" />
      </g>
      {/* Ground line */}
      <line x1="20" y1="148" x2="180" y2="148" stroke={color} strokeOpacity="0.25" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function WindTurbineSVG({ color, light }: { color: string; light: string }) {
  return (
    <svg viewBox="0 0 200 160" fill="none" className="h-full w-full">
      {/* Clouds */}
      <ellipse cx="38" cy="28" rx="26" ry="9" fill={light} fillOpacity="0.15" />
      <ellipse cx="155" cy="48" rx="22" ry="7" fill={light} fillOpacity="0.12" />
      {/* Tower */}
      <path d="M95 65 L90 148 L110 148 L105 65 Z" fill={color} fillOpacity="0.25" stroke={color} strokeOpacity="0.4" strokeWidth="1.5" />
      {/* Nacelle */}
      <rect x="88" y="56" width="24" height="12" rx="4" fill={color} fillOpacity="0.35" stroke={color} strokeOpacity="0.5" strokeWidth="1.5" />
      {/* Hub */}
      <circle cx="100" cy="56" r="6" fill={color} fillOpacity="0.45" stroke={color} strokeOpacity="0.6" strokeWidth="2" />
      {/* Blades */}
      <path d="M100 56 L96 6 Q100 0 104 6 Z" fill={color} fillOpacity="0.3" stroke={color} strokeOpacity="0.5" strokeWidth="1.5" />
      <path d="M100 56 L143 82 Q145 77 140 74 Z" fill={color} fillOpacity="0.25" stroke={color} strokeOpacity="0.45" strokeWidth="1.5" />
      <path d="M100 56 L57 82 Q55 77 60 74 Z" fill={color} fillOpacity="0.2" stroke={color} strokeOpacity="0.4" strokeWidth="1.5" />
      {/* Wind lines */}
      <line x1="12" y1="38" x2="52" y2="38" stroke={color} strokeOpacity="0.3" strokeWidth="2" strokeLinecap="round" />
      <line x1="22" y1="54" x2="55" y2="54" stroke={color} strokeOpacity="0.2" strokeWidth="2" strokeLinecap="round" />
      <line x1="8" y1="70" x2="48" y2="70" stroke={color} strokeOpacity="0.25" strokeWidth="2" strokeLinecap="round" />
      {/* Base */}
      <rect x="80" y="146" width="40" height="6" rx="3" fill={color} fillOpacity="0.25" />
      {/* Ground */}
      <line x1="20" y1="148" x2="180" y2="148" stroke={color} strokeOpacity="0.2" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function BiomassSVG({ color, light }: { color: string; light: string }) {
  return (
    <svg viewBox="0 0 200 160" fill="none" className="h-full w-full">
      {/* Tree trunk */}
      <rect x="94" y="78" width="12" height="62" rx="3" fill={color} fillOpacity="0.3" />
      {/* Foliage */}
      <ellipse cx="100" cy="42" rx="28" ry="18" fill={color} fillOpacity="0.25" stroke={color} strokeOpacity="0.4" strokeWidth="1.5" />
      <ellipse cx="80" cy="60" rx="22" ry="14" transform="rotate(-15 80 60)" fill={color} fillOpacity="0.2" stroke={color} strokeOpacity="0.35" strokeWidth="1" />
      <ellipse cx="120" cy="55" rx="22" ry="14" transform="rotate(15 120 55)" fill={color} fillOpacity="0.18" stroke={color} strokeOpacity="0.3" strokeWidth="1" />
      <ellipse cx="85" cy="48" rx="16" ry="10" transform="rotate(-10 85 48)" fill={color} fillOpacity="0.15" />
      <ellipse cx="115" cy="45" rx="16" ry="10" transform="rotate(10 115 45)" fill={color} fillOpacity="0.2" />
      {/* CHP building */}
      <rect x="140" y="95" width="44" height="45" rx="4" fill={color} fillOpacity="0.2" stroke={color} strokeOpacity="0.4" strokeWidth="1.5" />
      <rect x="149" y="108" width="11" height="14" rx="2" fill={color} fillOpacity="0.25" />
      <rect x="165" y="108" width="11" height="14" rx="2" fill={color} fillOpacity="0.25" />
      {/* Chimney */}
      <rect x="155" y="78" width="10" height="20" rx="2" fill={color} fillOpacity="0.3" stroke={color} strokeOpacity="0.4" strokeWidth="1.5" />
      {/* Steam puffs */}
      <circle cx="160" cy="70" r="5" fill={light} fillOpacity="0.2" />
      <circle cx="156" cy="60" r="6" fill={light} fillOpacity="0.15" />
      <circle cx="163" cy="50" r="5" fill={light} fillOpacity="0.12" />
      {/* Arrow: plant → building */}
      <path d="M112 112 L135 112" stroke={color} strokeOpacity="0.4" strokeWidth="2" strokeLinecap="round" markerEnd="url(#arrowBio)" />
      <defs>
        <marker id="arrowBio" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
          <path d="M0 0 L8 3 L0 6" fill={color} fillOpacity="0.5" />
        </marker>
      </defs>
      {/* Ground */}
      <line x1="20" y1="142" x2="180" y2="142" stroke={color} strokeOpacity="0.25" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function GeothermalSVG({ color, light }: { color: string; light: string }) {
  return (
    <svg viewBox="0 0 200 160" fill="none" className="h-full w-full">
      {/* House roof */}
      <path d="M65 72 L100 48 L135 72 Z" fill={color} fillOpacity="0.2" stroke={color} strokeOpacity="0.45" strokeWidth="1.5" />
      {/* House body */}
      <rect x="70" y="72" width="60" height="32" rx="2" fill={color} fillOpacity="0.15" stroke={color} strokeOpacity="0.35" strokeWidth="1.5" />
      <rect x="90" y="80" width="14" height="18" rx="2" fill={color} fillOpacity="0.2" />
      {/* Windows */}
      <rect x="75" y="78" width="10" height="8" rx="1" fill={color} fillOpacity="0.2" />
      <rect x="115" y="78" width="10" height="8" rx="1" fill={color} fillOpacity="0.2" />
      {/* Ground surface */}
      <line x1="15" y1="106" x2="185" y2="106" stroke={color} strokeOpacity="0.45" strokeWidth="2" />
      {/* Underground layers — getting hotter */}
      <rect x="15" y="106" width="170" height="16" fill={color} fillOpacity="0.08" />
      <rect x="15" y="122" width="170" height="16" fill={color} fillOpacity="0.14" />
      <rect x="15" y="138" width="170" height="22" fill={color} fillOpacity="0.22" />
      {/* Borehole pipe */}
      <rect x="96" y="104" width="8" height="52" rx="2" fill={color} fillOpacity="0.35" stroke={color} strokeOpacity="0.4" strokeWidth="1" />
      {/* U-pipe at bottom */}
      <path d="M98 140 C85 140 85 155 100 155 C115 155 115 140 102 140" stroke={color} strokeOpacity="0.5" strokeWidth="2.5" fill="none" />
      {/* Heat waves underground */}
      <path d="M50 138 Q56 132 62 138 Q68 144 74 138" stroke={light} strokeOpacity="0.4" strokeWidth="2" fill="none" />
      <path d="M125 145 Q131 139 137 145 Q143 151 149 145" stroke={light} strokeOpacity="0.35" strokeWidth="2" fill="none" />
      <path d="M35 152 Q41 146 47 152 Q53 158 59 152" stroke={light} strokeOpacity="0.3" strokeWidth="2" fill="none" />
      {/* Rising heat dots */}
      <circle cx="92" cy="98" r="3" fill={color} fillOpacity="0.3" />
      <circle cx="110" cy="94" r="2.5" fill={color} fillOpacity="0.25" />
      <circle cx="95" cy="88" r="2" fill={color} fillOpacity="0.2" />
    </svg>
  )
}

function BatterySVG({ color, light }: { color: string; light: string }) {
  return (
    <svg viewBox="0 0 200 160" fill="none" className="h-full w-full">
      {/* Battery body */}
      <rect x="50" y="40" width="100" height="78" rx="10" fill={color} fillOpacity="0.12" stroke={color} strokeOpacity="0.45" strokeWidth="2" />
      {/* Battery terminal */}
      <rect x="87" y="30" width="26" height="14" rx="4" fill={color} fillOpacity="0.3" stroke={color} strokeOpacity="0.4" strokeWidth="1.5" />
      {/* Charge bars */}
      <rect x="62" y="54" width="22" height="50" rx="4" fill={color} fillOpacity="0.4" />
      <rect x="89" y="66" width="22" height="38" rx="4" fill={color} fillOpacity="0.3" />
      <rect x="116" y="78" width="22" height="26" rx="4" fill={color} fillOpacity="0.2" />
      {/* Lightning bolt */}
      <path d="M104 48 L95 72 L105 72 L96 96" stroke={light} strokeOpacity="0.6" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      {/* Energy pulse rings */}
      <circle cx="100" cy="79" r="52" stroke={color} strokeOpacity="0.15" strokeWidth="1.5" fill="none" />
      <circle cx="100" cy="79" r="64" stroke={color} strokeOpacity="0.1" strokeWidth="1.5" fill="none" />
      {/* Power flow arrows */}
      <path d="M18 79 L40 79" stroke={color} strokeOpacity="0.35" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M160 79 L182 79" stroke={color} strokeOpacity="0.35" strokeWidth="2.5" strokeLinecap="round" />
      <polygon points="40,74 50,79 40,84" fill={color} fillOpacity="0.4" />
      <polygon points="182,74 172,79 182,84" fill={color} fillOpacity="0.4" />
      {/* Labels */}
      <text x="22" y="96" fill={color} fillOpacity="0.35" fontSize="10" fontWeight="700">IN</text>
      <text x="166" y="96" fill={color} fillOpacity="0.35" fontSize="10" fontWeight="700">OUT</text>
      {/* Ground */}
      <line x1="35" y1="140" x2="165" y2="140" stroke={color} strokeOpacity="0.2" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

const techIllustrations: Record<string, (props: { color: string; light: string }) => React.ReactNode> = {
  pv: SolarPanelSVG,
  wind: WindTurbineSVG,
  biomass: BiomassSVG,
  geothermal: GeothermalSVG,
  battery: BatterySVG,
}

function EnergyCard({
  techKey,
  inView,
  delay,
  large,
}: {
  techKey: (typeof techKeys)[number]
  inView: boolean
  delay: number
  large?: boolean
}) {
  const { t } = useTranslation()
  const colors = techColors[techKey]
  const Illustration = techIllustrations[techKey]

  return (
    <div
      className={`group relative overflow-hidden rounded-2xl border ${colors.border} bg-card transition-all duration-700 hover:-translate-y-1.5 ${colors.glow} ${inView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}
      style={{ transitionDelay: inView ? `${delay}ms` : '0ms' }}
    >
      {/* Top accent gradient */}
      <div className={`absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r ${colors.gradFrom} via-current ${colors.gradTo}`} style={{ color: colors.accent }} />

      <div className={`relative ${large ? 'p-7' : 'p-6'}`}>
        <div className={large ? 'flex gap-6' : ''}>
          {/* Text content */}
          <div className={large ? 'flex-1 min-w-0' : ''}>
            {/* Subtitle badge */}
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest ${colors.bg} ${colors.text}`}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: colors.accent }} />
              {t(`landing.energy.${techKey}.subtitle`)}
            </span>

            <h3 className={`mt-3 ${large ? 'text-xl' : 'text-lg'} font-bold text-foreground`}>
              {t(`landing.energy.${techKey}.title`)}
            </h3>

            <p className={`mt-2 text-sm leading-relaxed text-muted-foreground ${large ? '' : 'line-clamp-3'}`}>
              {t(`landing.energy.${techKey}.description`)}
            </p>

            {/* Specs */}
            <div className={`mt-4 grid gap-1.5 ${large ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {(['spec1', 'spec2', 'spec3', 'spec4'] as const).map((spec) => (
                <div key={spec} className="flex items-center gap-2">
                  <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: `${colors.accent}15` }}>
                    <IconCheck size={10} className={colors.text} strokeWidth={3} />
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {t(`landing.energy.${techKey}.${spec}`)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Illustration */}
          <div
            className={`${
              large
                ? 'w-48 shrink-0 self-center'
                : 'mt-4 h-32'
            } opacity-80 transition-all duration-500 group-hover:opacity-100 group-hover:scale-105`}
          >
            <Illustration color={colors.accent} light={colors.accentLight} />
          </div>
        </div>
      </div>
    </div>
  )
}

export function LandingEnergy() {
  const { t } = useTranslation()
  const { ref, inView } = useInView(0.1)

  return (
    <section id="energy" className="relative bg-muted/30 py-16 sm:py-24 overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_70%_0%,rgba(16,185,129,0.04),transparent_50%)]" />
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-widest text-emerald-600">
            {t('landing.energy.label')}
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            {t('landing.energy.title')}
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            {t('landing.energy.description')}
          </p>
        </div>

        <div ref={ref} className="mx-auto mt-16 max-w-6xl">
          {/* Top row: 2 large cards */}
          <div className="grid gap-6 sm:grid-cols-2">
            <EnergyCard techKey="pv" inView={inView} delay={0} large />
            <EnergyCard techKey="wind" inView={inView} delay={100} large />
          </div>

          {/* Bottom row: 3 cards */}
          <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <EnergyCard techKey="biomass" inView={inView} delay={200} />
            <EnergyCard techKey="geothermal" inView={inView} delay={300} />
            <EnergyCard techKey="battery" inView={inView} delay={400} />
          </div>
        </div>
      </div>
    </section>
  )
}
