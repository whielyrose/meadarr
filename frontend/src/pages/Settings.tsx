import { useState, useEffect } from 'react'
import { Settings, Save, TestTube, Eye, EyeOff, CheckCircle, XCircle } from 'lucide-react'
import { api } from '../api'

interface TestResult { ok: boolean; message: string }

function TestButton({ onTest, label }: { onTest: () => Promise<TestResult>; label: string }) {
  const [result, setResult] = useState<TestResult | null>(null)
  const [testing, setTesting] = useState(false)
  const run = async () => {
    setTesting(true); setResult(null)
    try { setResult(await onTest()) }
    catch (e: any) { setResult({ ok: false, message: e.message }) }
    finally { setTesting(false) }
  }
  return (
    <div className="flex items-center gap-2">
      <button className="btn-secondary flex items-center gap-1" onClick={run} disabled={testing}>
        <TestTube size={13} />{testing ? 'Testing...' : label}
      </button>
      {result && (
        <span className={`text-xs flex items-center gap-1 ${result.ok ? 'text-green-400' : 'text-red-400'}`}>
          {result.ok ? <CheckCircle size={12} /> : <XCircle size={12} />}{result.message}
        </span>
      )}
    </div>
  )
}

function SecretInput({ label, settingKey, value, onChange, placeholder }: {
  label: string; settingKey: string; value: string
  onChange: (k: string, v: string) => void; placeholder?: string
}) {
  const [show, setShow] = useState(false)
  const isConfigured = value === '***configured***'
  return (
    <div>
      <label className="label">{label}</label>
      <div className="relative">
        <input type={show ? 'text' : 'password'} className="input pr-10"
          value={isConfigured ? '' : value}
          placeholder={isConfigured ? '(configured — enter new value to change)' : placeholder}
          onChange={e => onChange(settingKey, e.target.value)} />
        <button type="button"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
          onClick={() => setShow(s => !s)}>
          {show ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
    </div>
  )
}

const SECTIONS = [
  {
    title: 'slskd (Soulseek)',
    description: 'Connect to your slskd download client for Soulseek downloads.',
    fields: [
      { key: 'slskd_url',     label: 'slskd URL', placeholder: 'http://host.docker.internal:5030', secret: false },
      { key: 'slskd_api_key', label: 'API Key',   placeholder: 'your-slskd-api-key',               secret: true  },
    ],
    testKey: 'slskd', testLabel: 'Test slskd',
  },
  {
    title: 'Jellyfin',
    description: 'Connect to Jellyfin for library scanning and playlist creation.',
    fields: [
      { key: 'jellyfin_url',     label: 'Jellyfin URL', placeholder: 'http://jellyfin:8096',   secret: false },
      { key: 'jellyfin_api_key', label: 'API Key',      placeholder: 'your-jellyfin-api-key', secret: true  },
    ],
    testKey: 'jellyfin', testLabel: 'Test Jellyfin',
  },
  {
    title: 'ListenBrainz',
    description: 'Connect to ListenBrainz for music recommendations and Weekly Jams import. Get your token at listenbrainz.org/settings/',
    fields: [
      { key: 'listenbrainz_username', label: 'Username',  placeholder: 'your-listenbrainz-username', secret: false },
      { key: 'listenbrainz_token',    label: 'API Token', placeholder: 'your-listenbrainz-token',    secret: true  },
    ],
    testKey: 'listenbrainz', testLabel: 'Test ListenBrainz',
  },
  {
    title: 'Last.fm',
    description: 'Connect to Last.fm as a fallback for music recommendations.',
    fields: [
      { key: 'lastfm_api_key',  label: 'API Key',  placeholder: 'your-lastfm-api-key',  secret: true  },
      { key: 'lastfm_username', label: 'Username', placeholder: 'your-lastfm-username', secret: false },
    ],
    testKey: 'lastfm', testLabel: 'Test Last.fm',
  },
  {
    title: 'Spotify',
    description: 'Import playlists from Spotify — no API key or login required. Uses the Spotify web player internally. Click Test to verify it works.',
    fields: [],
    testKey: 'spotify', testLabel: 'Test Spotify',
  },
  {
    title: 'Fluxer Notifications',
    description: 'Send download notifications to your Fluxer server.',
    fields: [
      { key: 'fluxer_webhook_url', label: 'Webhook URL', placeholder: 'https://fluxer.example.com/api/webhooks/...', secret: true },
    ],
    testKey: 'fluxer', testLabel: 'Send Test',
  },
]

export default function SettingsPage() {
  const [values, setValues]   = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [saved, setSaved]     = useState(false)

  useEffect(() => { api.settings.get().then(setValues).catch(console.error) }, [])

  const set = (key: string, val: string) => { setValues(prev => ({ ...prev, [key]: val })); setSaved(false) }

  const save = async () => {
    setLoading(true)
    try {
      const toSave: Record<string, string> = {}
      for (const [k, v] of Object.entries(values))
        if (v && v !== '***configured***') toSave[k] = v
      await api.settings.update(toSave)
      setSaved(true)
      setValues(await api.settings.get())
    } catch (e: any) { alert(e.message) }
    finally { setLoading(false) }
  }

  const getTestFn = (testKey: string) => async (): Promise<TestResult> => {
    try {
      const fns: Record<string, () => Promise<any>> = {
        slskd:          api.settings.testSlskd,
        jellyfin:       api.settings.testJellyfin,
        lastfm:         api.settings.testLastfm,
        listenbrainz:   api.settings.testListenbrainz,
        spotify:        api.settings.testSpotify,
        fluxer:         api.settings.testFluxer,
      }
      const result = await fns[testKey]()
      return { ok: true, message: result.message || 'Connected' }
    } catch (e: any) { return { ok: false, message: e.message } }
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-100 mb-6">Settings</h1>
      <div className="space-y-6">
        <div className="card space-y-4">
          <h2 className="font-semibold text-gray-200 flex items-center gap-2">
            <Settings size={16} className="text-honey-400" />Download Preferences
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Default Format</label>
              <select className="input" value={values.default_format || 'mp3'}
                onChange={e => set('default_format', e.target.value)}>
                <option value="mp3">MP3 (smaller, compatible)</option>
                <option value="flac">FLAC (lossless, larger)</option>
              </select>
            </div>
            <div>
              <label className="label">Auto Library Scan</label>
              <select className="input" value={values.auto_scan_interval_hours || '0'}
                onChange={e => set('auto_scan_interval_hours', e.target.value)}>
                <option value="0">Disabled (manual only)</option>
                <option value="6">Every 6 hours</option>
                <option value="24">Daily</option>
              </select>
            </div>
          </div>
        </div>

        {SECTIONS.map(section => (
          <div key={section.title} className="card space-y-4">
            <div>
              <h2 className="font-semibold text-gray-200">{section.title}</h2>
              <p className="text-xs text-gray-500 mt-0.5">{section.description}</p>
            </div>
            {section.fields.map(field => (
              field.secret ? (
                <SecretInput key={field.key} label={field.label} settingKey={field.key}
                  value={values[field.key] || ''} onChange={set} placeholder={field.placeholder} />
              ) : (
                <div key={field.key}>
                  <label className="label">{field.label}</label>
                  <input className="input" value={values[field.key] || ''}
                    placeholder={field.placeholder} onChange={e => set(field.key, e.target.value)} />
                </div>
              )
            ))}
            <TestButton onTest={getTestFn(section.testKey)} label={section.testLabel} />
          </div>
        ))}

        <div className="flex items-center gap-3">
          <button className="btn-primary flex items-center gap-2" onClick={save} disabled={loading}>
            <Save size={14} />{loading ? 'Saving...' : 'Save Settings'}
          </button>
          {saved && <span className="text-green-400 text-sm flex items-center gap-1"><CheckCircle size={14} /> Saved</span>}
        </div>
      </div>
    </div>
  )
}
