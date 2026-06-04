import { useEffect, useRef, useState, useCallback } from 'react'

/* ── Global mouse position context ── */
function useMouse() {
  const [pos, setPos] = useState({ x: 0, y: 0, nx: 0.5, ny: 0.5 })
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      setPos({ x: e.clientX, y: e.clientY, nx: e.clientX / window.innerWidth, ny: e.clientY / window.innerHeight })
    }
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [])
  return pos
}

function useScroll() {
  const [scrollY, setScrollY] = useState(0)
  useEffect(() => {
    const onScroll = () => setScrollY(window.scrollY)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  return scrollY
}

function useInView(threshold = 0.12) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setVisible(true) }, { threshold })
    obs.observe(el)
    return () => obs.disconnect()
  }, [threshold])
  return { ref, visible }
}

/* ── Cursor trail particles ── */
function CursorTrail() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const particles = useRef<{ x: number; y: number; vx: number; vy: number; life: number; size: number; hue: number }[]>([])
  const mouse = useRef({ x: 0, y: 0 })

  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    let raf: number
    let lastSpawn = 0

    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight }
    resize()
    window.addEventListener('resize', resize)

    const onMove = (e: MouseEvent) => { mouse.current = { x: e.clientX, y: e.clientY } }
    window.addEventListener('mousemove', onMove)

    const loop = (t: number) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      // spawn particles
      if (t - lastSpawn > 25) {
        lastSpawn = t
        for (let i = 0; i < 2; i++) {
          particles.current.push({
            x: mouse.current.x,
            y: mouse.current.y,
            vx: (Math.random() - 0.5) * 1.5,
            vy: (Math.random() - 0.5) * 1.5 - 0.5,
            life: 1,
            size: Math.random() * 3 + 1,
            hue: 68 + Math.random() * 20, // lime-ish
          })
        }
      }

      // update & draw
      particles.current = particles.current.filter(p => {
        p.x += p.vx
        p.y += p.vy
        p.life -= 0.015
        p.size *= 0.995
        if (p.life <= 0) return false
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
        ctx.fillStyle = `hsla(${p.hue}, 90%, 65%, ${p.life * 0.4})`
        ctx.fill()
        return true
      })

      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); window.removeEventListener('mousemove', onMove) }
  }, [])

  return <canvas ref={canvasRef} className="cursor-canvas" />
}

/* ── 3D Tilt Card ── */
function TiltCard({ children, className = '', delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const { ref: inViewRef, visible } = useInView()
  const [tilt, setTilt] = useState({ x: 0, y: 0, active: false })

  const onMove = useCallback((e: React.MouseEvent) => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width - 0.5
    const y = (e.clientY - rect.top) / rect.height - 0.5
    setTilt({ x: y * -15, y: x * 15, active: true })
  }, [])

  const onLeave = useCallback(() => setTilt({ x: 0, y: 0, active: false }), [])

  return (
    <div
      ref={(el) => { (ref as any).current = el; (inViewRef as any).current = el }}
      className={`tilt-card ${className} ${visible ? 'in-view' : ''}`}
      style={{
        transform: `perspective(800px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg) scale(${tilt.active ? 1.02 : 1})`,
        transitionDelay: `${delay}s`,
      }}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
    >
      {/* glow that follows mouse */}
      {tilt.active && (
        <div className="card-glow" style={{
          left: `${(tilt.y / 15 + 0.5) * 100}%`,
          top: `${(-tilt.x / 15 + 0.5) * 100}%`,
        }} />
      )}
      {children}
    </div>
  )
}

/* ── Magnetic Button ── */
function MagneticButton({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLButtonElement>(null)
  const [offset, setOffset] = useState({ x: 0, y: 0 })

  const onMove = useCallback((e: React.MouseEvent) => {
    const el = ref.current!
    const rect = el.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    setOffset({ x: (e.clientX - cx) * 0.3, y: (e.clientY - cy) * 0.3 })
  }, [])

  return (
    <button
      ref={ref}
      className={`magnetic-btn ${className}`}
      style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
      onMouseMove={onMove}
      onMouseLeave={() => setOffset({ x: 0, y: 0 })}
    >
      {children}
    </button>
  )
}

/* ── Text Reveal (word by word) ── */
function RevealText({ text, className = '' }: { text: string; className?: string }) {
  const { ref, visible } = useInView()
  const words = text.split(' ')
  return (
    <span ref={ref} className={className}>
      {words.map((word, i) => (
        <span key={i} className="reveal-word-wrap">
          <span
            className={`reveal-word ${visible ? 'revealed' : ''}`}
            style={{ transitionDelay: `${i * 0.04}s` }}
          >
            {word}&nbsp;
          </span>
        </span>
      ))}
    </span>
  )
}

/* ── Section with scroll reveal ── */
function Section({ children, className = '', delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const { ref, visible } = useInView()
  return (
    <div ref={ref} className={`section ${className} ${visible ? 'in-view' : ''}`} style={{ transitionDelay: `${delay}s` }}>
      {children}
    </div>
  )
}

/* ── TypeWriter ── */
function TypeWriter({ lines, active }: { lines: string[]; active: boolean }) {
  const [lineIdx, setLineIdx] = useState(0)
  const [charIdx, setCharIdx] = useState(0)
  const [displayed, setDisplayed] = useState<string[]>([])

  useEffect(() => {
    if (!active) return
    if (lineIdx >= lines.length) return
    if (charIdx <= lines[lineIdx].length) {
      const t = setTimeout(() => {
        setDisplayed(prev => {
          const next = [...prev]
          next[lineIdx] = lines[lineIdx].slice(0, charIdx)
          return next
        })
        setCharIdx(c => c + 1)
      }, 25 + Math.random() * 35)
      return () => clearTimeout(t)
    } else {
      const t = setTimeout(() => { setLineIdx(i => i + 1); setCharIdx(0) }, 350)
      return () => clearTimeout(t)
    }
  }, [lineIdx, charIdx, lines, active])

  return (
    <div className="terminal-lines">
      {displayed.map((line, i) => {
        const isSuccess = line?.startsWith('✓')
        return (
          <div key={i} className={`terminal-line ${isSuccess ? 'success' : ''}`}>
            <span className="terminal-prompt">{isSuccess ? '' : '$'}</span> {line}
            {i === lineIdx && lineIdx < lines.length && <span className="terminal-cursor" />}
          </div>
        )
      })}
    </div>
  )
}

/* ── Feature Slider ── */
const FEATURES = [
  { icon: '⚡', title: 'Hot Reload', desc: 'Preview updates instantly as the AI writes your code.' },
  { icon: '🧠', title: 'AI Agent', desc: 'A coding partner that understands context and intent.' },
  { icon: '🎨', title: 'Design System', desc: 'Beautiful defaults with full customization control.' },
  { icon: '📦', title: 'Full-Stack', desc: 'Frontend, backend, and database — all in one place.' },
  { icon: '🔒', title: 'Auth Built-In', desc: 'User authentication and permissions out of the box.' },
  { icon: '🚀', title: 'Edge Deploy', desc: 'Global CDN deployment with zero configuration.' },
]

function FeatureSlider() {
  const [active, setActive] = useState(0)
  const [paused, setPaused] = useState(false)
  const trackRef = useRef<HTMLDivElement>(null)
  const { ref, visible } = useInView()

  // Auto-play
  useEffect(() => {
    if (paused || !visible) return
    const t = setInterval(() => setActive(a => (a + 1) % FEATURES.length), 3500)
    return () => clearInterval(t)
  }, [paused, visible])

  // Drag / swipe
  const dragStart = useRef<{ x: number; idx: number } | null>(null)

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragStart.current = { x: e.clientX, idx: active }
    setPaused(true)
  }, [active])

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragStart.current) return
    const diff = e.clientX - dragStart.current.x
    if (Math.abs(diff) > 50) {
      setActive(a => diff < 0 ? Math.min(a + 1, FEATURES.length - 1) : Math.max(a - 1, 0))
    }
    dragStart.current = null
    setTimeout(() => setPaused(false), 2000)
  }, [])

  return (
    <div ref={ref} className="slider-container" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      {/* Progress bar */}
      <div className="slider-progress">
        {FEATURES.map((_, i) => (
          <button key={i} className={`slider-dot ${i === active ? 'active' : ''}`} onClick={() => { setActive(i); setPaused(true); setTimeout(() => setPaused(false), 3000) }}>
            {i === active && !paused && <span className="dot-fill" />}
          </button>
        ))}
      </div>

      {/* Cards track */}
      <div className="slider-viewport" onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
        <div
          ref={trackRef}
          className="slider-track"
          style={{ transform: `translateX(calc(-${active} * (var(--slide-width) + 24px)))` }}
        >
          {FEATURES.map((f, i) => {
            const offset = i - active
            return (
              <TiltCard
                key={i}
                className={`slider-card ${i === active ? 'slider-active' : ''}`}
                delay={0}
              >
                <div className="slider-card-inner" style={{
                  transform: `scale(${i === active ? 1 : 0.88}) rotateY(${offset * 5}deg)`,
                  opacity: Math.abs(offset) > 1 ? 0.3 : i === active ? 1 : 0.5,
                }}>
                  <div className="slider-icon">{f.icon}</div>
                  <h3>{f.title}</h3>
                  <p>{f.desc}</p>
                  <div className="slider-index">{String(i + 1).padStart(2, '0')}</div>
                </div>
              </TiltCard>
            )
          })}
        </div>
      </div>

      {/* Arrows */}
      <div className="slider-arrows">
        <button className="slider-arrow" onClick={() => { setActive(a => (a - 1 + FEATURES.length) % FEATURES.length); setPaused(true); setTimeout(() => setPaused(false), 3000) }} aria-label="Previous">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        <span className="slider-counter">{String(active + 1).padStart(2, '0')} / {String(FEATURES.length).padStart(2, '0')}</span>
        <button className="slider-arrow" onClick={() => { setActive(a => (a + 1) % FEATURES.length); setPaused(true); setTimeout(() => setPaused(false), 3000) }} aria-label="Next">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M7.5 5L12.5 10L7.5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
      </div>
    </div>
  )
}

/* ── Floating interactive shapes ── */
function FloatingShapes({ mouse }: { mouse: { nx: number; ny: number } }) {
  return (
    <div className="floating-shapes">
      {[...Array(6)].map((_, i) => (
        <div
          key={i}
          className={`floating-shape shape-${i}`}
          style={{
            transform: `translate(${(mouse.nx - 0.5) * (15 + i * 8)}px, ${(mouse.ny - 0.5) * (15 + i * 8)}px)`,
          }}
        />
      ))}
    </div>
  )
}

/* ══════════════════════════════════════════
   Main App
   ══════════════════════════════════════════ */
function App() {
  const scrollY = useScroll()
  const mouse = useMouse()
  const terminalSection = useInView(0.3)

  return (
    <div className="app">
      <CursorTrail />

      {/* ── Parallax background ── */}
      <div className="bg-layer">
        <div className="bg-gradient" style={{ transform: `translateY(${scrollY * 0.12}px)` }} />
        <div
          className="bg-glow-main"
          style={{
            left: `${mouse.nx * 100}%`,
            top: `${mouse.ny * 100}%`,
          }}
        />
        <div className="bg-grid" style={{ transform: `translateY(${scrollY * 0.04}px)` }} />
        <FloatingShapes mouse={mouse} />
        <div className="bg-orb orb-1" style={{ transform: `translate(${(mouse.nx - 0.5) * 30}px, ${scrollY * -0.18 + (mouse.ny - 0.5) * 20}px)` }} />
        <div className="bg-orb orb-2" style={{ transform: `translate(${(mouse.nx - 0.5) * -20}px, ${scrollY * -0.1 + (mouse.ny - 0.5) * -15}px)` }} />
        <div className="bg-orb orb-3" style={{ transform: `translate(${(mouse.nx - 0.5) * 15}px, ${scrollY * -0.07 + (mouse.ny - 0.5) * 10}px)` }} />
      </div>

      {/* ── Hero ── */}
      <header
        className="hero"
        style={{
          transform: `translateY(${scrollY * 0.35}px)`,
          opacity: Math.max(0, 1 - scrollY / 500),
        }}
      >
        <div className="hero-badge anim-pop">
          <span className="pulse-dot" />
          Built with PAVE Studio
        </div>

        <h1 className="hero-title">
          <span className="title-line anim-slide-up" style={{ animationDelay: '0.2s' }}>Describe it.</span>
          <br />
          <span className="title-line anim-slide-up" style={{ animationDelay: '0.5s' }}>
            <span className="gradient-text">PAVE builds it.</span>
          </span>
        </h1>

        <p className="hero-sub anim-fade" style={{ animationDelay: '0.8s' }}>
          An AI-powered IDE that turns your ideas into full-stack applications through natural conversation.
        </p>

        <div className="hero-actions anim-fade" style={{ animationDelay: '1.1s' }}>
          <MagneticButton className="btn-glow">
            <span className="btn-shine" />
            Get Started
          </MagneticButton>
        </div>

        <div className="scroll-indicator anim-fade" style={{ animationDelay: '1.6s' }}>
          <div className="scroll-mouse">
            <div className="scroll-wheel" />
          </div>
          <span className="scroll-text">Scroll to explore</span>
        </div>
      </header>

      {/* ── Showcase 1: Chat ── */}
      <section className="showcase">
        <Section className="showcase-row">
          <div className="showcase-text">
            <span className="showcase-label">Chat-Driven Development</span>
            <h2><RevealText text="Talk to your app into existence" /></h2>
            <p className="showcase-desc">Describe features in plain English. PAVE's AI agent writes the code, creates components, and wires everything together — live.</p>
          </div>
          <div className="showcase-visual">
            <TiltCard className="chat-demo-card">
              <div className="chat-demo">
                <div className="chat-bubble user anim-chat-in" style={{ animationDelay: '0.2s' }}>
                  Add a dark mode toggle to the header with smooth transitions
                </div>
                <div className="chat-bubble agent anim-chat-in" style={{ animationDelay: '0.8s' }}>
                  <span className="agent-tag"><span className="agent-dot" />PAVE</span>
                  Done! I've created a theme toggle with CSS transitions and localStorage persistence.
                  <div className="chat-files">
                    <span className="file-chip pop-in" style={{ animationDelay: '1.4s' }}>Header.tsx</span>
                    <span className="file-chip pop-in" style={{ animationDelay: '1.6s' }}>theme.css</span>
                    <span className="file-chip pop-in" style={{ animationDelay: '1.8s' }}>useTheme.ts</span>
                  </div>
                </div>
              </div>
            </TiltCard>
          </div>
        </Section>
      </section>

      {/* ── Showcase 2: Preview ── */}
      <section className="showcase dark-section">
        <Section className="showcase-row reverse">
          <div className="showcase-text">
            <span className="showcase-label">Instant Preview</span>
            <h2><RevealText text="See changes as they happen" /></h2>
            <p className="showcase-desc">Every code change appears instantly. Test on desktop, tablet, and mobile — all inside the IDE.</p>
          </div>
          <div className="showcase-visual">
            <TiltCard className="preview-demo-card">
              <div className="preview-demo">
                <div className="preview-bar">
                  <div className="window-dots"><span className="dot red" /><span className="dot yellow" /><span className="dot green" /></div>
                  <div className="preview-devices">
                    <button className="device-btn active">Desktop</button>
                    <button className="device-btn">Tablet</button>
                    <button className="device-btn">Mobile</button>
                  </div>
                </div>
                <div className="preview-screen">
                  <div className="preview-skeleton">
                    <div className="skel skel-nav" />
                    <div className="skel skel-hero-block" />
                    <div className="skel-grid">
                      <div className="skel skel-card" /><div className="skel skel-card" /><div className="skel skel-card" />
                    </div>
                    <div className="skel skel-text" />
                    <div className="skel skel-text short" />
                  </div>
                  <div className="preview-scan-line" />
                </div>
              </div>
            </TiltCard>
          </div>
        </Section>
      </section>

      {/* ── Showcase 3: Deploy ── */}
      <section className="showcase">
        <Section className="showcase-row">
          <div className="showcase-text">
            <span className="showcase-label">One-Click Deploy</span>
            <h2><RevealText text="From idea to production in minutes" /></h2>
            <p className="showcase-desc">Deploy your app to the cloud with a single click. PAVE handles infrastructure, CI/CD, and scaling.</p>
          </div>
          <div className="showcase-visual" ref={terminalSection.ref}>
            <TiltCard className="terminal-demo-card">
              <div className="terminal-demo">
                <div className="terminal-bar">
                  <div className="window-dots"><span className="dot red" /><span className="dot yellow" /><span className="dot green" /></div>
                  <span className="terminal-title">Terminal</span>
                </div>
                <div className="terminal-body">
                  <TypeWriter
                    active={terminalSection.visible}
                    lines={[
                      'pave deploy --production',
                      'Building application...',
                      'Optimizing assets... done',
                      'Deploying to edge network...',
                      '✓ Live at your-app.pave.dev',
                    ]}
                  />
                </div>
              </div>
            </TiltCard>
          </div>
        </Section>
      </section>

      {/* ── Features Slider ── */}
      <section className="features-section">
        <Section>
          <h2 className="features-heading">Everything you need to <span className="gradient-text">ship fast</span></h2>
        </Section>
        <FeatureSlider />
      </section>

      {/* ── CTA ── */}
      <section className="cta-section">
        <Section className="cta-content">
          <h2>Start building with <span className="gradient-text">PAVE</span></h2>
          <p>This page was generated by PAVE Studio. Open the chat and tell PAVE what to build next.</p>
          <div className="cta-rings">
            <div className="ring ring-1" />
            <div className="ring ring-2" />
            <div className="ring ring-3" />
          </div>
        </Section>
      </section>

      <footer className="footer">
        <p>Built with <span className="heart">♥</span> by PAVE Studio</p>
      </footer>
    </div>
  )
}

export default App
