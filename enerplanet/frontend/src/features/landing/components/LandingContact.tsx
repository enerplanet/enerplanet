import { useState, type FormEvent } from 'react'
import { IconSend, IconCheck, IconAlertCircle, IconMail, IconUser, IconMessage } from '@tabler/icons-react'
import { useTranslation } from '@spatialhub/i18n'
import { useInView } from '../hooks/useInView'

type FormState = 'idle' | 'sending' | 'success' | 'error'

export function LandingContact() {
  const { t } = useTranslation()
  const { ref, inView } = useInView(0.1)

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [category, setCategory] = useState('general')
  const [formState, setFormState] = useState<FormState>('idle')

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setFormState('sending')

    try {
      const formData = new FormData()
      formData.append('name', name)
      formData.append('email', email)
      formData.append('subject', subject)
      formData.append('message', message)
      formData.append('category', category)

      const res = await fetch('/api/feedback/public', {
        method: 'POST',
        body: formData,
      })

      if (!res.ok) throw new Error('Failed to send')

      setFormState('success')
      setName('')
      setEmail('')
      setSubject('')
      setMessage('')
      setCategory('general')
    } catch {
      setFormState('error')
    }
  }

  const categories = [
    { value: 'general', label: t('landing.contact.categories.general', 'General Inquiry') },
    { value: 'feature', label: t('landing.contact.categories.feature', 'Feature Request') },
    { value: 'bug', label: t('landing.contact.categories.bug', 'Bug Report') },
    { value: 'improvement', label: t('landing.contact.categories.improvement', 'Suggestion') },
  ]

  return (
    <section id="contact" className="relative overflow-hidden bg-muted/50 py-16 sm:py-24">
      {/* Subtle grid */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(0,0,0,.2) 1px,transparent 1px),linear-gradient(90deg,rgba(0,0,0,.2) 1px,transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />

      <div ref={ref} className="relative mx-auto max-w-7xl px-6">
        {/* Header */}
        <div className={`mx-auto max-w-2xl text-center transition-all duration-700 ${inView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
          <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-400">
            <IconMail size={14} />
            {t('landing.contact.label', 'Get in Touch')}
          </span>
          <h2 className="mt-6 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            {t('landing.contact.title', "We'd love to hear from you")}
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
            {t('landing.contact.description', 'Have a question, suggestion, or want to collaborate? Send us a message and our team will get back to you.')}
          </p>
        </div>

        {/* Form Card */}
        <div className={`mx-auto mt-16 max-w-2xl transition-all duration-700 delay-200 ${inView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
          <div className="relative overflow-hidden rounded-2xl border border-border bg-card shadow-xl">
            {/* Decorative top bar */}
            <div className="h-1 bg-gradient-to-r from-emerald-500 via-teal-500 to-emerald-600" />

            <div className="p-6 sm:p-8">
              {formState === 'success' ? (
                <div className="flex flex-col items-center gap-4 py-12 text-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30">
                    <IconCheck size={32} className="text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <h3 className="text-xl font-semibold text-foreground">
                    {t('landing.contact.successTitle', 'Message Sent!')}
                  </h3>
                  <p className="max-w-sm text-muted-foreground">
                    {t('landing.contact.successMessage', "Thank you for reaching out. We'll get back to you as soon as possible.")}
                  </p>
                  <button
                    onClick={() => setFormState('idle')}
                    className="mt-4 rounded-lg bg-emerald-600 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
                  >
                    {t('landing.contact.sendAnother', 'Send another message')}
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-5">
                  {/* Name & Email row */}
                  <div className="grid gap-5 sm:grid-cols-2">
                    <div>
                      <label htmlFor="contact-name" className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-foreground">
                        <IconUser size={14} className="text-muted-foreground" />
                        {t('landing.contact.name', 'Name')}
                      </label>
                      <input
                        id="contact-name"
                        type="text"
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder={t('landing.contact.namePlaceholder', 'Your name')}
                        className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 transition-colors focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                      />
                    </div>
                    <div>
                      <label htmlFor="contact-email" className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-foreground">
                        <IconMail size={14} className="text-muted-foreground" />
                        {t('landing.contact.email', 'Email')}
                      </label>
                      <input
                        id="contact-email"
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder={t('landing.contact.emailPlaceholder', 'you@example.com')}
                        className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 transition-colors focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                      />
                    </div>
                  </div>

                  {/* Category */}
                  <div>
                    <label htmlFor="contact-category" className="mb-1.5 block text-sm font-medium text-foreground">
                      {t('landing.contact.category', 'Category')}
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {categories.map((cat) => (
                        <button
                          key={cat.value}
                          type="button"
                          onClick={() => setCategory(cat.value)}
                          className={`rounded-full px-4 py-1.5 text-xs font-medium transition-all ${
                            category === cat.value
                              ? 'bg-emerald-600 text-white shadow-sm'
                              : 'bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground'
                          }`}
                        >
                          {cat.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Subject */}
                  <div>
                    <label htmlFor="contact-subject" className="mb-1.5 block text-sm font-medium text-foreground">
                      {t('landing.contact.subject', 'Subject')}
                    </label>
                    <input
                      id="contact-subject"
                      type="text"
                      required
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      placeholder={t('landing.contact.subjectPlaceholder', 'What is this about?')}
                      className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 transition-colors focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                    />
                  </div>

                  {/* Message */}
                  <div>
                    <label htmlFor="contact-message" className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-foreground">
                      <IconMessage size={14} className="text-muted-foreground" />
                      {t('landing.contact.message', 'Message')}
                    </label>
                    <textarea
                      id="contact-message"
                      required
                      rows={5}
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      placeholder={t('landing.contact.messagePlaceholder', 'Tell us more...')}
                      className="w-full resize-none rounded-lg border border-border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 transition-colors focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                    />
                  </div>

                  {/* Error */}
                  {formState === 'error' && (
                    <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
                      <IconAlertCircle size={16} />
                      {t('landing.contact.error', 'Something went wrong. Please try again.')}
                    </div>
                  )}

                  {/* Submit */}
                  <button
                    type="submit"
                    disabled={formState === 'sending'}
                    className="group flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-600/20 transition-all duration-300 hover:bg-emerald-500 hover:shadow-xl hover:-translate-y-0.5 disabled:opacity-60 disabled:pointer-events-none"
                  >
                    {formState === 'sending' ? (
                      <>
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                        {t('landing.contact.sending', 'Sending...')}
                      </>
                    ) : (
                      <>
                        <IconSend size={16} className="transition-transform duration-300 group-hover:translate-x-0.5" />
                        {t('landing.contact.send', 'Send Message')}
                      </>
                    )}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
