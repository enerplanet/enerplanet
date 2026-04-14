import React, { useState, useRef, useEffect } from 'react';
import { Send, CheckCircle2, AlertCircle, Loader2, ChevronDown, Server, Database, Globe, Map, Zap, Check, Clock } from 'lucide-react';
import axios from '@/lib/axios';
import { useTranslation } from '@spatialhub/i18n';

interface NotificationForm {
  service: string;
  date: string;
  hour: number;
  minute: number;
  message: string;
}

const NotificationManagement: React.FC = () => {
  const { t } = useTranslation();
  const [form, setForm] = useState<NotificationForm>({
    service: '',
    date: new Date().toISOString().split('T')[0],
    hour: 12,
    minute: 0,
    message: '',
  });
  const [isSending, setIsSending] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [showServiceDropdown, setShowServiceDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const services = [
    { value: 'webservice', label: t('settings.sendNotification.services.webService'), icon: Globe },
    { value: 'geoserver', label: t('settings.sendNotification.services.geoServer'), icon: Server },
    { value: 'database', label: t('settings.sendNotification.services.database'), icon: Database },
    { value: 'api', label: t('settings.sendNotification.services.api'), icon: Zap },
    { value: 'map', label: t('settings.sendNotification.services.mapService'), icon: Map },
  ];

  const hours = Array.from({ length: 24 }, (_, i) => i);
  const minutes = [0, 15, 30, 45];

  const today = new Date().toISOString().split('T')[0];

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowServiceDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const getTimeString = () => {
    return `${form.hour.toString().padStart(2, '0')}:${form.minute.toString().padStart(2, '0')}`;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!form.service || !form.date || !form.message.trim()) {
      return;
    }

    setIsSending(true);
    setSuccessMessage('');
    setErrorMessage('');

    try {
      await axios.post('/notifications/send', {
        service: form.service,
        scheduled_date: form.date,
        scheduled_time: getTimeString(),
        message: form.message,
        type: 'maintenance',
      });

      setSuccessMessage(t('settings.sendNotification.sent'));
      setForm({ service: '', date: today, hour: 12, minute: 0, message: '' });
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (error: unknown) {
      let message = t('settings.sendNotification.failedToSend');
      if (typeof error === 'object' && error !== null) {
        const maybeAxiosError = error as { response?: { data?: { error?: string } } };
        message = maybeAxiosError.response?.data?.error || message;
      }
      setErrorMessage(message);
    } finally {
      setIsSending(false);
    }
  };

  const handleChange = (field: keyof NotificationForm, value: string | number) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const selectedService = services.find(s => s.value === form.service);
  const isFormValid = form.service && form.date && form.message.trim();

  return (
    <div className="space-y-1.5">
      <form onSubmit={handleSubmit} className="space-y-1.5">
        {/* Service Selection - Button style like LanguageSettings */}
        <div className="space-y-1" ref={dropdownRef}>
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowServiceDropdown(!showServiceDropdown)}
              className={`
                w-full px-2.5 py-1.5 rounded-md border transition-all duration-200 flex items-center justify-between text-foreground
                ${selectedService 
                  ? 'border-gray-900 dark:border-gray-100 bg-gray-50 dark:bg-gray-900' 
                  : 'border-gray-200 dark:border-gray-700 bg-background hover:border-gray-400 dark:hover:border-gray-500'
                }
              `}
            >
              <div className="flex items-center gap-2">
                {selectedService ? (
                  <>
                    <selectedService.icon className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-xs font-medium">{selectedService.label}</span>
                  </>
                ) : (
                  <span className="text-xs text-muted-foreground">{t('settings.sendNotification.selectService')}</span>
                )}
              </div>
              <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${showServiceDropdown ? 'rotate-180' : ''}`} />
            </button>
            
            {showServiceDropdown && (
              <div className="absolute z-10 w-full mt-1 bg-card border border-gray-200 dark:border-gray-700 rounded-md shadow-lg overflow-hidden">
                {services.map((service) => (
                  <button
                    key={service.value}
                    type="button"
                    onClick={() => {
                      handleChange('service', service.value);
                      setShowServiceDropdown(false);
                    }}
                    className={`
                      w-full px-2.5 py-1.5 text-xs flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors
                      ${form.service === service.value ? 'bg-gray-50 dark:bg-gray-900' : ''}
                    `}
                  >
                    <div className="flex items-center gap-2">
                      <service.icon className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="font-medium text-gray-900 dark:text-gray-100">{service.label}</span>
                    </div>
                    {form.service === service.value && (
                      <div className="w-4 h-4 rounded-full bg-gray-900 dark:bg-gray-100 flex items-center justify-center">
                        <Check className="w-2.5 h-2.5 text-white dark:text-gray-900" />
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Date & Time - Single row */}
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={form.date}
            min={today}
            onChange={(e) => handleChange('date', e.target.value)}
            className="flex-1 px-2.5 py-1.5 text-xs font-medium border border-gray-200 dark:border-gray-700 rounded-md bg-background text-foreground focus:border-gray-900 dark:focus:border-gray-100 focus:outline-none transition-colors"
          />
          <div className="flex items-center gap-1 px-2.5 py-1.5 border border-gray-200 dark:border-gray-700 rounded-md bg-background">
            <Clock className="w-3 h-3 text-muted-foreground" />
            <select
              value={form.hour}
              onChange={(e) => handleChange('hour', Number.parseInt(e.target.value))}
              className="text-xs font-medium bg-transparent text-foreground focus:outline-none cursor-pointer"
            >
              {hours.map(h => (
                <option key={h} value={h}>{h.toString().padStart(2, '0')}</option>
              ))}
            </select>
            <span className="text-xs text-muted-foreground">:</span>
            <select
              value={form.minute}
              onChange={(e) => handleChange('minute', Number.parseInt(e.target.value))}
              className="text-xs font-medium bg-transparent text-foreground focus:outline-none cursor-pointer"
            >
              {minutes.map(m => (
                <option key={m} value={m}>{m.toString().padStart(2, '0')}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Message */}
        <textarea
          value={form.message}
          onChange={(e) => handleChange('message', e.target.value)}
          placeholder={t('settings.sendNotification.messagePlaceholder')}
          className="w-full h-16 px-2.5 py-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded-md bg-background text-foreground focus:border-gray-900 dark:focus:border-gray-100 focus:outline-none transition-colors resize-none placeholder:text-muted-foreground"
          maxLength={200}
          required
        />

        {/* Status Messages */}
        {successMessage && (
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
            <CheckCircle2 className="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
            <span className="text-xs font-medium text-green-700 dark:text-green-400">{successMessage}</span>
          </div>
        )}

        {errorMessage && (
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
            <AlertCircle className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
            <span className="text-xs font-medium text-red-700 dark:text-red-400">{errorMessage}</span>
          </div>
        )}

        {/* Submit Button */}
        <button
          type="submit"
          disabled={isSending || !isFormValid}
          className={`
            w-full px-2.5 py-1.5 rounded-md border transition-all duration-200 flex items-center justify-center gap-2 text-xs font-medium
            ${isFormValid && !isSending
              ? 'border-gray-900 dark:border-gray-100 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-200'
              : 'border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 cursor-not-allowed'
            }
          `}
        >
          {isSending ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>{t('settings.sendNotification.sending')}</span>
            </>
          ) : (
            <>
              <Send className="w-3.5 h-3.5" />
              <span>{t('settings.sendNotification.sendNotification')}</span>
            </>
          )}
        </button>
      </form>
    </div>
  );
};

export default NotificationManagement;
