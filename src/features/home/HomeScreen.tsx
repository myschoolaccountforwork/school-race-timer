import { useNavigate } from "react-router-dom";
import { AppRoute } from "../../types/routes";
import "./HomeScreen.css";

export default function HomeScreen() {
  const navigate = useNavigate();

  return (
    <main className="home">
      <section className="home-card" aria-labelledby="raceflow-title">
        <h1 id="raceflow-title">RaceFlow</h1>

        <p className="subtitle">
          School Athletics &amp; Swimming Event Workflow System
        </p>

        <div className="button-group">
          <button type="button" onClick={() => navigate(AppRoute.TRACK)}>
            Start Track Event
          </button>
          <button type="button" onClick={() => navigate(AppRoute.SWIM)}>
            Start Swim Event
          </button>
          <button type="button" onClick={() => navigate(AppRoute.TIMING)}>
            Timing Only
          </button>
          <button type="button" onClick={() => navigate(AppRoute.JOIN)}>
            Join Event
          </button>
          <button type="button" onClick={() => navigate(AppRoute.PRACTICE)}>
            Practice Mode
          </button>
        </div>

        <footer>Version 1.0</footer>
      </section>
    </main>
  );
}
