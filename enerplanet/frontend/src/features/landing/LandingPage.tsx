import { useEffect, useState, useCallback } from 'react'

import { LandingNav } from './components/LandingNav'
import { LandingHero } from './components/LandingHero'
import { LandingFeatures } from './components/LandingFeatures'
import { LandingEnergy } from './components/LandingEnergy'
import { LandingHowItWorks } from './components/LandingHowItWorks'
import { LandingShowcase } from './components/LandingShowcase'
import { LandingTrust } from './components/LandingTrust'
import { LandingCTA } from './components/LandingCTA'
import { LandingContact } from './components/LandingContact'
import { LandingFooter } from './components/LandingFooter'
import { IconArrowUp } from '@tabler/icons-react'

function WaveDivider({ flip, from, to }: { flip?: boolean; from: string; to: string }) {
  return (
    <div className={`relative h-10 sm:h-16 ${from}`} style={{ transform: flip ? 'scaleY(-1)' : undefined }}>
      <svg className="absolute bottom-0 w-full h-full" viewBox="0 0 1440 96" preserveAspectRatio="none" fill="none">
        <path d="M0,64 C360,96 720,0 1080,64 C1260,96 1380,80 1440,64 L1440,96 L0,96 Z" className={to} />
      </svg>
    </div>
  )
}

function BackToTop() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 600)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const scrollToTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  return (
    <button
      onClick={scrollToTop}
      aria-label="Back to top"
      className={`fixed bottom-8 right-8 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg shadow-emerald-600/30 transition-all duration-300 hover:bg-emerald-500 hover:shadow-xl hover:-translate-y-1 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'}`}
    >
      <IconArrowUp size={20} />
    </button>
  )
}

export default function LandingPage() {
  useEffect(() => {
    document.documentElement.style.scrollBehavior = 'smooth'
    document.documentElement.style.overflow = 'auto'
    document.body.style.overflow = 'auto'
    const root = document.getElementById('root')
    if (root) root.style.overflow = 'auto'

    return () => {
      document.documentElement.style.scrollBehavior = ''
      document.documentElement.style.overflow = ''
      document.body.style.overflow = ''
      if (root) root.style.overflow = ''
    }
  }, [])

  return (
    <div className="min-h-screen bg-background">
      <LandingNav />
      <main>
        <LandingHero />
        <WaveDivider from="bg-slate-950" to="fill-background" />
        <LandingFeatures />
        <WaveDivider flip from="bg-background" to="fill-muted/30" />
        <LandingEnergy />
        <WaveDivider from="bg-muted/30" to="fill-muted/50" />
        <LandingHowItWorks />
        <WaveDivider from="bg-muted/50" to="fill-background" />
        <LandingShowcase />
        <WaveDivider flip from="bg-background" to="fill-muted/50" />
        <LandingTrust />
        <LandingContact />
        <LandingCTA />
      </main>
      <LandingFooter />
      <BackToTop />
    </div>
  )
}
