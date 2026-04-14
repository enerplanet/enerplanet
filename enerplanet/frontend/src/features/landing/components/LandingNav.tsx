import { useEffect, useState, useRef } from 'react'
import { Link } from 'react-router-dom'
import { IconMenu2, IconX, IconChevronDown } from '@tabler/icons-react'
import { useTranslation, languages, changeLanguage, type LanguageCode } from '@spatialhub/i18n'

const navLinkKeys = [
  { key: 'features', href: '#features', sectionId: 'features' },
  { key: 'energy', href: '#energy', sectionId: 'energy' },
  { key: 'howItWorks', href: '#how-it-works', sectionId: 'how-it-works' },
  { key: 'about', href: '#about', sectionId: 'about' },
  { key: 'contact', href: '#contact', sectionId: 'contact' },
]

function LanguageSwitcher() {
  const { i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const currentLang = i18n.language?.split('-')[0] || 'en'
  const current = languages.find((l) => l.code === currentLang) || languages[0]

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-slate-300 transition-colors duration-200 hover:bg-white/5 hover:text-white"
      >
        <span>{current.flag}</span>
        <span className="hidden text-xs font-medium uppercase sm:inline">{current.code}</span>
        <IconChevronDown size={14} className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-44 overflow-hidden rounded-xl border border-white/10 bg-slate-900/95 shadow-xl backdrop-blur-xl">
          {languages.map((lang) => (
            <button
              key={lang.code}
              onClick={() => {
                changeLanguage(lang.code as LanguageCode, 'enerplanet_language')
                setOpen(false)
              }}
              className={`flex w-full items-center gap-2.5 px-4 py-2.5 text-sm transition-colors hover:bg-white/5 ${currentLang === lang.code ? 'bg-emerald-500/10 text-emerald-400' : 'text-slate-300'}`}
            >
              <span>{lang.flag}</span>
              <span className="font-medium">{lang.nativeName}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function LandingNav() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const [activeSection, setActiveSection] = useState('')

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    const sectionIds = navLinkKeys.map((l) => l.sectionId)
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id)
          } else if (entry.target.id === activeSection) {
            setActiveSection('')
          }
        })
      },
      { rootMargin: '-40% 0px -55% 0px' },
    )
    sectionIds.forEach((id) => {
      const el = document.getElementById(id)
      if (el) observer.observe(el)
    })
    return () => observer.disconnect()
  }, [activeSection])

  return (
    <nav className={`sticky top-0 z-50 transition-all duration-300 ${scrolled ? 'border-b border-white/10 bg-slate-950/90 shadow-lg shadow-black/10 backdrop-blur-xl' : 'bg-slate-950/60 backdrop-blur-md'}`}>
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <Link to="/" className="flex items-center gap-2.5 transition-opacity hover:opacity-80">
          <img src="/images/logo/enerplanet-logo.png" alt="EnerPlanET" className="h-8 brightness-0 invert" />
        </Link>

        <div className="hidden items-center gap-1 md:flex">
          {navLinkKeys.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className={`relative rounded-lg px-4 py-2 text-sm transition-colors duration-200 hover:bg-white/5 hover:text-white ${activeSection === l.sectionId ? 'text-white' : 'text-slate-300'}`}
            >
              {t(`landing.nav.${l.key}`)}
              {activeSection === l.sectionId && (
                <span className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-white" />
              )}
            </a>
          ))}
        </div>

        <div className="hidden items-center gap-2 md:flex">
          <LanguageSwitcher />
          <Link
            to="/login"
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-300 transition-colors duration-200 hover:text-white"
          >
            {t('landing.nav.signIn')}
          </Link>
          <Link
            to="/register"
            className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white shadow-sm shadow-emerald-600/25 transition-all duration-200 hover:bg-emerald-500 hover:shadow-md hover:shadow-emerald-500/30"
          >
            {t('landing.nav.tryItNow')}
          </Link>
        </div>

        <button
          className="rounded-lg p-2 text-white transition-colors hover:bg-white/10 md:hidden"
          onClick={() => setOpen(!open)}
          aria-label="Toggle menu"
          aria-expanded={open}
        >
          {open ? <IconX size={22} /> : <IconMenu2 size={22} />}
        </button>
      </div>

      {/* Mobile menu */}
      <div
        className={`overflow-hidden border-t border-white/10 bg-slate-950/95 backdrop-blur-xl transition-all duration-300 md:hidden ${open ? 'max-h-[28rem] opacity-100' : 'max-h-0 border-t-0 opacity-0'}`}
      >
        <div className="flex flex-col gap-1 px-6 pb-6 pt-4">
          {navLinkKeys.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="rounded-lg px-3 py-2.5 text-sm text-slate-300 transition-colors hover:bg-white/5 hover:text-white"
              onClick={() => setOpen(false)}
            >
              {t(`landing.nav.${l.key}`)}
            </a>
          ))}
          <hr className="my-2 border-white/10" />
          <div className="px-3 py-1">
            <LanguageSwitcher />
          </div>
          <Link to="/login" className="rounded-lg px-3 py-2.5 text-sm text-slate-300 transition-colors hover:bg-white/5 hover:text-white">
            {t('landing.nav.signIn')}
          </Link>
          <Link
            to="/register"
            className="mt-1 rounded-lg bg-emerald-600 px-4 py-2.5 text-center text-sm font-semibold text-white transition-colors hover:bg-emerald-500"
          >
            {t('landing.nav.tryItNow')}
          </Link>
        </div>
      </div>
    </nav>
  )
}
