import { useState, useEffect, useCallback, useRef } from 'react'
import './App.css'

const KOKORO_VOICES = [
  'af_heart',
  'af_bella',
  'af_nicole',
  'af_sarah',
  'af_sky',
  'am_adam',
  'am_michael',
  'am_puck',
  'bf_emma',
  'bm_george',
] as const

function App() {
  const [text, setText] = useState('')
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [selectedVoiceURI, setSelectedVoiceURI] = useState<string>('')
  const [rate, setRate] = useState(1)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [voicesTimedOut, setVoicesTimedOut] = useState(false)
  const [kokoroVoice, setKokoroVoice] = useState<string>('af_heart')
  const [kokoroLoading, setKokoroLoading] = useState(false)
  const [kokoroReady, setKokoroReady] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const kokoroRef = useRef<Awaited<ReturnType<typeof import('kokoro-js').KokoroTTS.from_pretrained>> | null>(null)
  const audioRef = useRef<HTMLAudioElement | { node: AudioBufferSourceNode; ctx: AudioContext } | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const voicesLoaded = useRef(false)

  const noVoices = voicesTimedOut && voices.length === 0
  const useFallback = noVoices

  useEffect(() => {
    const loadVoices = () => {
      const list = speechSynthesis.getVoices().filter((v) => v.lang)
      if (list.length) {
        voicesLoaded.current = true
        setVoices(list)
        setSelectedVoiceURI((prev) => {
          if (prev && list.some((v) => v.voiceURI === prev)) return prev
          return (list.find((v) => v.lang.startsWith('en')) ?? list[0]).voiceURI
        })
      }
    }
    loadVoices()
    speechSynthesis.onvoiceschanged = loadVoices
    const pollId = setInterval(() => {
      if (!voicesLoaded.current) loadVoices()
    }, 300)
    const timeoutId = setTimeout(() => {
      voicesLoaded.current = true
      setVoicesTimedOut(true)
    }, 1500)
    return () => {
      clearInterval(pollId)
      clearTimeout(timeoutId)
      speechSynthesis.onvoiceschanged = null
      speechSynthesis.cancel()
    }
  }, [])

  const loadKokoro = useCallback(async () => {
    if (kokoroRef.current) {
      setKokoroReady(true)
      return
    }
    setKokoroLoading(true)
    try {
      const { KokoroTTS } = await import('kokoro-js')
      try {
        kokoroRef.current = await KokoroTTS.from_pretrained(
          'onnx-community/Kokoro-82M-v1.0-ONNX',
          { dtype: 'q8', device: 'webgpu' }
        )
      } catch {
        kokoroRef.current = await KokoroTTS.from_pretrained(
          'onnx-community/Kokoro-82M-v1.0-ONNX',
          { dtype: 'q8', device: 'wasm' }
        )
      }
      setKokoroReady(true)
    } finally {
      setKokoroLoading(false)
    }
  }, [])

  useEffect(() => {
    if (noVoices) loadKokoro()
  }, [noVoices, loadKokoro])

  const speakNative = useCallback(() => {
    if (!text.trim()) return
    speechSynthesis.cancel()
    const list = speechSynthesis.getVoices()
    const utterance = new SpeechSynthesisUtterance(text.trim())
    utterance.rate = rate
    const voice = selectedVoiceURI ? list.find((v) => v.voiceURI === selectedVoiceURI) : list[0]
    if (voice) utterance.voice = voice
    utterance.onstart = () => {
      setIsSpeaking(true)
      setIsPaused(false)
    }
    utterance.onend = utterance.onerror = () => {
      setIsSpeaking(false)
      setIsPaused(false)
    }
    speechSynthesis.speak(utterance)
  }, [text, rate, selectedVoiceURI])

  const speakFallback = useCallback(async () => {
    if (!text.trim() || !kokoroRef.current) return
    if (audioRef.current && 'node' in audioRef.current) {
      audioRef.current.node.stop()
      audioRef.current = null
    }
    const ctx = audioCtxRef.current || new AudioContext()
    ctx.resume()
    audioCtxRef.current = ctx
    setIsSpeaking(true)
    setIsPaused(false)
    const payload = text.trim().slice(0, 300)
    try {
      const audio = await kokoroRef.current.generate(payload, {
        voice: kokoroVoice as (typeof KOKORO_VOICES)[number],
        speed: rate,
      })
      const blob = audio.toBlob()
      const buf = await blob.arrayBuffer()
      const decoded = await ctx.decodeAudioData(buf)
      const src = ctx.createBufferSource()
      src.buffer = decoded
      src.connect(ctx.destination)
      audioRef.current = { node: src, ctx }
      src.onended = () => {
        audioRef.current = null
        setIsSpeaking(false)
        setIsPaused(false)
      }
      src.start(0)
    } catch {
      setIsSpeaking(false)
      setIsPaused(false)
    }
  }, [text, rate, kokoroVoice])

  const speak = useCallback(() => {
    if (useFallback) speakFallback()
    else speakNative()
  }, [useFallback, speakFallback, speakNative])

  const pause = useCallback(() => {
    if (useFallback && audioRef.current) {
      const ref = audioRef.current
      if ('node' in ref) {
        try { ref.node.stop() } catch { /* already stopped */ }
        audioRef.current = null
        setIsSpeaking(false)
        setIsPaused(false)
      } else {
        ref.pause()
        setIsPaused(true)
      }
    } else if (speechSynthesis.speaking) {
      speechSynthesis.pause()
      setIsPaused(true)
    }
  }, [useFallback])

  const resume = useCallback(() => {
    if (useFallback && audioRef.current) {
      const ref = audioRef.current
      if (!('node' in ref)) {
        ref.play()
        setIsPaused(false)
      }
    } else if (speechSynthesis.paused) {
      speechSynthesis.resume()
      setIsPaused(false)
    }
  }, [useFallback])

  const stop = useCallback(() => {
    if (useFallback && audioRef.current) {
      const ref = audioRef.current
      if ('node' in ref) {
        try { ref.node.stop() } catch { /* already stopped */ }
      } else {
        ref.pause()
        ref.currentTime = 0
      }
      audioRef.current = null
    }
    speechSynthesis.cancel()
    setIsSpeaking(false)
    setIsPaused(false)
  }, [useFallback])

  const downloadWav = useCallback(async () => {
    if (!text.trim() || downloading) return
    setDownloading(true)
    try {
      if (!kokoroRef.current) await loadKokoro()
      if (!kokoroRef.current) return
      const v = useFallback ? kokoroVoice : 'af_heart'
      const audio = await kokoroRef.current.generate(text.trim().slice(0, 300), {
        voice: v as (typeof KOKORO_VOICES)[number],
        speed: rate,
      })
      const blob = audio.toBlob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `tts-${Date.now()}.wav`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } finally {
      setDownloading(false)
    }
  }, [text, rate, kokoroVoice, useFallback, downloading, loadKokoro])

  return (
    <div className="app">
      <h1>T2S</h1>
      <p className="subtitle">Text to Speech</p>

      {noVoices && (
        <div className="fallback-banner">
          <p>Using Kokoro TTS (runs locally)</p>
          {kokoroLoading && <p className="loading">Loading…</p>}
          {kokoroReady && (
            <div className="voice-row">
              <label htmlFor="kokoro-voice">Voice</label>
              <select
                id="kokoro-voice"
                value={kokoroVoice}
                onChange={(e) => setKokoroVoice(e.target.value)}
                disabled={isSpeaking}
              >
                {KOKORO_VOICES.map((v) => (
                  <option key={v} value={v}>
                    {v.replace('_', ' ')}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      <textarea
        placeholder="Enter text to speak..."
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        disabled={isSpeaking}
      />

      {!noVoices && (
        <div className="controls">
          <div className="voice-row">
            <label htmlFor="voice">Voice</label>
            <select
              id="voice"
              value={voices.length ? selectedVoiceURI : ''}
              onChange={(e) => setSelectedVoiceURI(e.target.value)}
              disabled={isSpeaking || !voices.length}
            >
              {!voices.length && (
                <option value="">
                  {voicesTimedOut ? 'Default' : 'Loading…'}
                </option>
              )}
              {voices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name} ({v.lang})
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      <div className="controls">
        <div className="rate-row">
          <label htmlFor="rate">Speed: {rate.toFixed(1)}x</label>
          <input
            id="rate"
            type="range"
            min="0.5"
            max="2"
            step="0.1"
            value={rate}
            onChange={(e) => setRate(Number(e.target.value))}
            disabled={isSpeaking}
          />
        </div>
      </div>

      <div className="actions">
        {!isSpeaking ? (
          <>
            <button
              onClick={speak}
              disabled={!text.trim() || (noVoices && !kokoroReady)}
              className="primary"
            >
              Speak
            </button>
            <button
              onClick={downloadWav}
              disabled={!text.trim() || downloading}
            >
              {downloading ? '…' : 'Download WAV'}
            </button>
          </>
        ) : isPaused ? (
          <>
            <button onClick={resume}>Resume</button>
            <button onClick={stop}>Stop</button>
          </>
        ) : (
          <>
            <button onClick={pause}>Pause</button>
            <button onClick={stop}>Stop</button>
          </>
        )}
      </div>

      {isSpeaking && !isPaused && (
        <div className="status" role="status">
          Speaking…
        </div>
      )}
    </div>
  )
}

export default App
