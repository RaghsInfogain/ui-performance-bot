import { Link } from 'react-router-dom';
import {
  ArrowRight, Globe, Settings, Clapperboard, Play, History, BarChart3, Zap,
} from 'lucide-react';
import './landing.css';

export default function Landing() {
  return (
    <div className="landing">
      <header className="landing__nav">
        <Link to="/" className="landing__brand">
          <span className="landing__mark"><Zap className="h-4 w-4" /></span>
          <span>UI Performance Bot</span>
        </Link>
        <nav className="landing__links">
          <a href="#features">Features</a>
          <a href="#how-it-works">How it works</a>
          <a href="#sample-report">Sample report</a>
        </nav>
        <div className="landing__nav-actions">
          <Link to="/login" className="landing__btn landing__btn--ghost">Sign in</Link>
          <Link to="/signup" className="landing__btn landing__btn--solid">Get started</Link>
        </div>
      </header>

      <section className="landing__hero">
        <div className="landing__hero-copy">
          <p className="landing__eyebrow">UI performance testing, end to end</p>
          <h1 className="landing__headline">
            Find what&apos;s slowing<br />
            your site down. Prove<br />
            what you fixed.
          </h1>
          <p className="landing__lede">
            UI Performance Bot crawls your site, runs real-browser and Lighthouse tests
            across as many threads as you need, and turns the results into a report your
            team can act on and your customers can read.
          </p>
          <div className="landing__cta-row">
            <Link to="/signup" className="landing__btn landing__btn--solid landing__btn--lg">
              Get started <ArrowRight className="h-4 w-4" />
            </Link>
            <a href="#sample-report" className="landing__btn landing__btn--outline landing__btn--lg">
              See a sample report
            </a>
          </div>
          <ul className="landing__pills">
            <li>Automatic same-domain crawling</li>
            <li>Real browsers + Lighthouse under the hood</li>
            <li>Client-ready reports</li>
          </ul>
        </div>

        <aside className="landing__hero-visual" aria-label="Sample performance score comparison">
          <div className="landing__scoreboard">
            <div className="landing__scoreboard-top">
              <span>Performance score</span>
              <span className="landing__run-chip">RUN #1042</span>
            </div>
            <div className="landing__score-pair">
              <div>
                <div className="landing__score-num landing__score-num--bad">41</div>
                <div className="landing__score-label">Before</div>
              </div>
              <div>
                <div className="landing__score-num landing__score-num--good">89</div>
                <div className="landing__score-label">After fixes</div>
              </div>
            </div>
            <table className="landing__metric-table">
              <tbody>
                <tr><td>Largest Contentful Paint</td><td>4.8s</td><td className="good">2.1s</td></tr>
                <tr><td>Cumulative Layout Shift</td><td>0.31</td><td className="good">0.04</td></tr>
                <tr><td>Total Blocking Time</td><td>890ms</td><td className="good">120ms</td></tr>
              </tbody>
            </table>
          </div>
        </aside>
      </section>

      <section id="how-it-works" className="landing__section">
        <p className="landing__section-kicker">How it works</p>
        <h2 className="landing__section-title">From a single URL to a client-ready report, in five steps.</h2>
        <ol className="landing__steps">
          {[
            ['Configure', 'Set browser, headless mode, duration, think-time and thread count once — it\'s saved for every run.'],
            ['Crawl', 'Point it at a URL and it discovers every same-domain page, ready to export or save as a suite.'],
            ['Build test cases', 'Edit static URL suites, scripted flows, or record a walkthrough right in the browser.'],
            ['Run', 'Launch a static or scripted run across multiple threads and watch pass/fail and scores live.'],
            ['Report', 'Get a complete report — findings, priorities and a go-live recommendation — ready to export.'],
          ].map(([title, body], i) => (
            <li key={title}>
              <span className="landing__step-num">{i + 1}</span>
              <h3>{title}</h3>
              <p>{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section id="features" className="landing__section landing__section--muted">
        <p className="landing__section-kicker">Everything in one place</p>
        <h2 className="landing__section-title">One workspace for crawling, testing and reporting.</h2>
        <p className="landing__section-lede">
          Every functionality below runs on the same engine, so your crawl list, scripts, runs and reports always stay in sync.
        </p>
        <div className="landing__feature-grid">
          {([
            [Globe, 'Website crawler', 'Same-domain link discovery with a live URL count. Export the full list as CSV or save it straight into Script Studio as a suite.'],
            [Settings, 'Configuration', 'Browser, headless mode, duration, think-time, multi-threading and feature flags — validated and versioned automatically.'],
            [Clapperboard, 'Test cases & Script Studio', 'Maintain static and scripted suites side by side, or record a flow with the built-in browser recorder — one library for every script.'],
            [Play, 'Static & scripted runs', 'Spin up N Playwright browsers with Lighthouse for static suites, or drive scripted flows through the multi-threaded engine.'],
            [History, 'Run history', 'Track status and progress for every run, watch results stream in as they finish, and stop or delete on demand.'],
            [BarChart3, 'Reports & analytics', 'Browse every run, export raw metrics, or open the complete report with charts, findings and a go-live recommendation.'],
          ] as const).map(([Icon, title, body]) => (
            <article key={title} className="landing__feature">
              <Icon className="h-5 w-5" />
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="sample-report" className="landing__section">
        <p className="landing__section-kicker">The complete report</p>
        <h2 className="landing__section-title">One report, built to send straight to your customer.</h2>
        <p className="landing__section-lede">
          Every run compiles into a single downloadable report — no assembling screenshots or exports by hand.
        </p>
        <div className="landing__report-preview">
          <ol className="landing__report-toc">
            <li><span>01</span> Executive summary with a status categorisation</li>
            <li><span>02</span> Overall system analysis</li>
            <li><span>03</span> User experience behavior analysis (Lighthouse)</li>
            <li><span>04</span> Navigation timing — network, server & browser</li>
            <li><span>05</span> Issues, impact and recommendations</li>
            <li><span>06</span> Optimisation approach with before/after impact</li>
            <li><span>07</span> Final conclusion and next steps</li>
          </ol>
          <div className="landing__report-card">
            <div className="landing__report-card-file">Performance_Report_Sep2026.pdf</div>
            <div className="landing__report-card-badge">Needs attention</div>
            <div className="landing__report-card-score">67</div>
            <div className="landing__report-card-meta">Overall score · 42 pages tested</div>
            <div className="landing__report-bands">
              <span>Critical</span>
              <span className="on">Needs attention</span>
              <span>Good</span>
              <span>Excellent</span>
            </div>
          </div>
        </div>
      </section>

      <section className="landing__footer-cta">
        <h2>Ready to see where your site is losing users?</h2>
        <p>Run your first crawl and get a complete report in one sitting.</p>
        <Link to="/signup" className="landing__btn landing__btn--solid landing__btn--lg">
          Get started <ArrowRight className="h-4 w-4" />
        </Link>
      </section>
    </div>
  );
}
