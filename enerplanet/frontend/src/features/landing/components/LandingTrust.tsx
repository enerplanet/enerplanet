import { IconMapPin } from '@tabler/icons-react'
import { useTranslation } from '@spatialhub/i18n'
import { useInView } from '../hooks/useInView'

const countries = [
  { nameKey: 'germany', flag: '🇩🇪', regionsKey: 'deRegions' },
  { nameKey: 'netherlands', flag: '🇳🇱', regionsKey: 'nlRegions' },
  { nameKey: 'austria', flag: '🇦🇹', regionsKey: 'atRegions' },
  { nameKey: 'czechRepublic', flag: '🇨🇿', regionsKey: 'czRegions' },
]

const dataSources = [
  { name: 'NASA MERRA-2', url: 'https://gmao.gsfc.nasa.gov/reanalysis/MERRA-2/', descKey: 'merra2' },
  { name: 'Open-Meteo', url: 'https://open-meteo.com', descKey: 'openMeteo' },
  { name: 'EUBUCCO', url: 'https://eubucco.com', descKey: 'eubucco' },
  { name: 'CBS', url: 'https://opendata.cbs.nl', descKey: 'cbs' },
  { name: 'EP-Online', url: 'https://www.ep-online.nl', descKey: 'epOnline' },
  { name: '3D BAG', url: 'https://3dbag.nl', descKey: '3dbag' },
  { name: 'ČÚZK LiDAR', url: 'https://atom.cuzk.gov.cz', descKey: 'cuzk' },
  { name: 'OpenGeoData NRW', url: 'https://www.opengeodata.nrw.de', descKey: 'nrw' },
  { name: 'GeoSN Sachsen', url: 'https://geodienste.sachsen.de', descKey: 'sachsen' },
  { name: 'GAIA Thüringen', url: 'https://geoportal.geoportal-th.de', descKey: 'thueringen' },
  { name: 'Geofabrik', url: 'https://download.geofabrik.de', descKey: 'geofabrik' },
  { name: 'OpenStreetMap', url: 'https://openstreetmap.org', descKey: 'osm' },
]

const techPartners = [
  { name: 'Calliope', url: 'https://callio.pe' },
  { name: 'PyPSA', url: 'https://pypsa.org' },
  { name: 'PyLoVo', url: 'https://github.com/tum-ens/pylovo' },
  { name: 'PySAM (NREL)', url: 'https://nrel-pysam.readthedocs.io/en/main/' },
  { name: 'pvlib', url: 'https://pvlib-python.readthedocs.io' },
  { name: 'MapLibre', url: 'https://maplibre.org' },
  { name: 'OpenLayers', url: 'https://openlayers.org' },
]

export function LandingTrust() {
  const { t } = useTranslation()
  const { ref, inView } = useInView(0.15)

  const stats = [
    { value: '4+', label: t('landing.hero.countries'), description: t('landing.hero.germany') + ', NL, ' + t('landing.hero.austria') + ', CZ' },
    { value: '50+', label: t('landing.hero.regions'), description: '16 DE · 12 NL · 9 AT · 13 CZ' },
    { value: '8,760 h', label: t('landing.trust.hourlyResolution'), description: t('landing.trust.hourlyResolutionDesc') },
    { value: '6+', label: t('landing.trust.energyTechnologies'), description: t('landing.trust.energyTechnologiesDesc') },
  ]

  return (
    <section id="about" className="bg-muted/50 py-16 sm:py-24">
      <div ref={ref} className="mx-auto max-w-7xl px-6">
        {/* EU Funding Banner */}
        <div className={`mx-auto max-w-4xl overflow-hidden rounded-3xl bg-gradient-to-br from-[#002a7f] to-[#001a4d] p-8 sm:p-12 transition-all duration-700 ${inView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
          <div className="flex flex-col items-center gap-8 sm:flex-row">
            <div className="flex h-20 w-28 shrink-0 items-center justify-center rounded-xl bg-[#003399] shadow-lg shadow-blue-900/50" aria-hidden="true">
              <span className="text-4xl" role="img" aria-label="European Union flag">🇪🇺</span>
            </div>
            <div>
              <h3 className="text-xl font-bold text-white sm:text-2xl">
                {t('landing.trust.euTitle')}
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-blue-200/80">
                {t('landing.trust.euDescription')}
              </p>
            </div>
          </div>
        </div>

        {/* Countries */}
        <div className={`mx-auto mt-20 max-w-4xl transition-all duration-700 delay-100 ${inView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
              <IconMapPin size={16} className="text-emerald-500" />
              {t('landing.trust.availableAcross')}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-4">
            {countries.map((c) => (
              <div
                key={c.nameKey}
                className="flex items-center gap-2.5 rounded-xl border border-border bg-card px-5 py-3 shadow-sm"
              >
                <span className="text-xl">{c.flag}</span>
                <div>
                  <span className="text-sm font-medium text-foreground">{t(`landing.hero.${c.nameKey}`)}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{t(`landing.hero.${c.regionsKey}`)}</span>
                </div>
              </div>
            ))}
            <div className="flex items-center gap-2 rounded-xl border border-dashed border-emerald-500/40 bg-emerald-500/5 px-5 py-3">
              <span className="text-sm font-semibold text-emerald-600">{t('landing.trust.countriesComingSoon')}</span>
              <span className="text-xs text-muted-foreground">· {t('landing.trust.comingSoon')}</span>
            </div>
          </div>
        </div>

        {/* Key Stats */}
        <div className="mx-auto mt-20 grid max-w-4xl grid-cols-2 gap-8 sm:grid-cols-4">
          {stats.map((stat, idx) => (
            <div
              key={stat.label}
              className={`text-center transition-all duration-700 ${inView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}
              style={{ transitionDelay: inView ? `${200 + idx * 100}ms` : '0ms' }}
            >
              <div className="text-3xl font-extrabold text-foreground sm:text-4xl">{stat.value}</div>
              <div className="mt-1 text-sm font-semibold text-foreground">{stat.label}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{stat.description}</div>
            </div>
          ))}
        </div>

        {/* Data Sources */}
        <div className={`mx-auto mt-20 max-w-4xl transition-all duration-700 delay-300 ${inView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
          <p className="mb-6 text-center text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {t('landing.trust.integratedDataSources')}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            {dataSources.map((ds) => (
              <a
                key={ds.name}
                href={ds.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm transition-all duration-200 hover:border-emerald-500/30 hover:shadow-sm"
              >
                <span className="font-medium text-foreground">{ds.name}</span>
              </a>
            ))}
          </div>
        </div>

        {/* Technology Partners */}
        <div className={`mx-auto mt-16 max-w-3xl transition-all duration-700 delay-500 ${inView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
          <p className="mb-6 text-center text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {t('landing.trust.poweredByOpenSource')}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-4">
            {techPartners.map((partner) => (
              <a
                key={partner.name}
                href={partner.url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground/60 transition-all duration-200 hover:bg-muted hover:text-foreground"
              >
                {partner.name}
              </a>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
