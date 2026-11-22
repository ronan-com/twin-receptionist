import Wordmark from "../components/Wordmark";
import { brand } from "../brand";

const DEMO = `mailto:${brand.supportEmail}?subject=${encodeURIComponent("AI receptionist demo")}`;

const STEPS = [
  {
    title: "Tell us about your business",
    body: "Your opening hours, what callers usually ask for and anything they should know. That's all we need from you.",
  },
  {
    title: "Pick an Australian voice",
    body: "Choose the voice and how it greets callers. It introduces itself as an AI assistant on every call.",
  },
  {
    title: "Hear it before it goes live",
    body: "We set it up and you call it yourself. Anything you don't like gets changed before it answers a real customer.",
  },
];

const FEATURES = [
  {
    title: "Answers in a natural Australian voice",
    body: "Short, friendly answers, one question at a time, and it stops talking when the caller cuts in.",
  },
  {
    title: "Takes the booking request",
    body: "It asks what the caller needs, offers times inside your opening hours and passes the request to your team to confirm.",
  },
  {
    title: "Gets the details right",
    body: "It reads the caller's mobile number back and checks it before moving on, so you can call them back.",
  },
  {
    title: "Knows your hours and services",
    body: "It answers the everyday questions from what you've told it, and takes a message when it doesn't know.",
  },
  {
    title: "Keeps a record of every call",
    body: "Every call is saved with the full conversation, so nothing depends on a scribbled note.",
  },
  {
    title: "Stays in its lane",
    body: "It never gives medical, legal or trade advice, and it points emergencies to triple zero.",
  },
];

const NEXT = ["Your own business phone number", "Bookings straight into your calendar", "Text confirmations to callers"];

const FAQ = [
  {
    q: "Will callers know they're talking to an AI?",
    a: "Yes. It says so in its greeting, along with the fact that the call is recorded.",
  },
  {
    q: "What happens when it can't answer something?",
    a: "It doesn't guess. It takes the caller's name, number and question so your team can call back.",
  },
  {
    q: "Can I change what it says later?",
    a: "Any time. Tell us your new hours, services, voice or greeting and it uses them from the next call.",
  },
  {
    q: "Does it confirm bookings on its own?",
    a: "Not yet. Today it takes the request and your team confirms it. Booking straight into your calendar is being added next.",
  },
  {
    q: "Do I need a new phone number?",
    a: "No. You keep your existing number and forward it to your receptionist. We set that up with you.",
  },
];

export default function Landing() {
  return (
    <div className="landing">
      <header className="nav">
        <div className="nav-inner">
          <Wordmark to="/site" />
          <nav className="nav-links" aria-label="Sections">
            <a href="#how">How it works</a>
            <a href="#what">What it does</a>
            <a href="#faq">FAQ</a>
          </nav>
          <div className="nav-cta">
            <a href={DEMO} className="btn btn-primary btn-sm">
              Get a demo
            </a>
          </div>
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">AI receptionist for Australian businesses</p>
            <h1>Never miss another call.</h1>
            <p className="lede">
              {brand.name} answers your business phone in a natural Australian voice, takes the booking request and
              passes every caller's details to your team.
            </p>
            <div className="hero-actions">
              <a href={DEMO} className="btn btn-primary btn-lg">
                Get a demo
              </a>
              <a href="#how" className="btn btn-secondary btn-lg">
                See how it works
              </a>
            </div>
            <p className="hint">We set it up for you. Nothing technical on your side.</p>
          </div>

          <div className="hero-card" aria-label="Example call">
            <div className="hero-card-head">
              <span className="live-dot" aria-hidden />
              Example call
              <span className="hero-card-time">0:42</span>
            </div>
            <p className="turn turn-assistant">
              <span className="turn-who">Receptionist</span>
              Hi, you've reached Bright Smile Dental. I'm Grace, the AI assistant here, and this call is recorded.
              How can I help?
            </p>
            <p className="turn turn-user">
              <span className="turn-who">Caller</span>
              Hi, I need a check-up sometime Thursday.
            </p>
            <p className="turn turn-assistant">
              <span className="turn-who">Receptionist</span>
              No worries. I've got ten thirty in the morning or two fifteen in the afternoon. Which suits?
            </p>
            <p className="turn turn-user">
              <span className="turn-who">Caller</span>
              Two fifteen's good.
            </p>
            <div className="hero-card-foot">
              <span>Booking request</span>
              <strong>Check-up and clean · Thu 2:15pm</strong>
            </div>
          </div>
        </section>

        <section className="section" id="how">
          <p className="eyebrow">How it works</p>
          <h2>Set up in three steps</h2>
          <ol className="step-grid">
            {STEPS.map((s, i) => (
              <li key={s.title} className="step-card">
                <span className="step-num">{i + 1}</span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="section" id="what">
          <p className="eyebrow">What it does</p>
          <h2>A front desk that always picks up</h2>
          <div className="feature-grid">
            {FEATURES.map((f) => (
              <article key={f.title} className="feature">
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </article>
            ))}
          </div>
          <div className="next">
            <span className="next-label">Being added next</span>
            <ul>
              {NEXT.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
        </section>

        <section className="section section-narrow" id="faq">
          <p className="eyebrow">FAQ</p>
          <h2>Common questions</h2>
          <div className="faq">
            {FAQ.map((f) => (
              <details key={f.q}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="cta">
          <h2>Hear it answer for your business.</h2>
          <p>Ask for a demo and we'll set one up with your business name, hours and services.</p>
          <a href={DEMO} className="btn btn-primary btn-lg">
            Get a demo
          </a>
        </section>
      </main>

      <footer className="footer">
        <Wordmark to="/site" />
        <p>
          © {new Date().getFullYear()} {brand.company}. <a href={`mailto:${brand.supportEmail}`}>{brand.supportEmail}</a>
        </p>
      </footer>
    </div>
  );
}
