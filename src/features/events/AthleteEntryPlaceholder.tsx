import { Link } from "react-router-dom";
import { AppRoute } from "../../types/routes";
import "../shared/PlaceholderScreen.css";

export default function AthleteEntryPlaceholder() {
  return (
    <main className="placeholder-screen">
      <section className="placeholder-card">
        <Link className="back-link" to={AppRoute.TRACK_CONTROL}>
          ← Event Control Centre
        </Link>
        <h1>Athlete Entry</h1>
        <p>The Marshal 1 heat and lane entry screen will be built next.</p>
      </section>
    </main>
  );
}
