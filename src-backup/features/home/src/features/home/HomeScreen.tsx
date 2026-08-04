import "./HomeScreen.css";

export default function HomeScreen() {
  return (
    <main className="home">
      <section className="home-card">
        <h1>RaceFlow</h1>

        <p className="subtitle">
          School Athletics & Swimming Event Workflow System
        </p>

        <div className="button-group">
          <button>Start Track Event</button>
          <button>Start Swim Event</button>
          <button>Timing Only</button>
          <button>Join Event</button>
          <button>Practice Mode</button>
        </div>

        <footer>Version 1.0</footer>
      </section>
    </main>
  );
}