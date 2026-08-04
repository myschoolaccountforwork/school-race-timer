import { Link } from "react-router-dom";
import { AppRoute } from "../../types/routes";
import "../shared/PlaceholderScreen.css";

export default function TrackEventScreen() {
  return (
    <main className="placeholder-screen">
      <section className="placeholder-card">
        <Link className="back-link" to={AppRoute.HOME}>← Back</Link>
        <h1>Start Track Event</h1>
        <p>The Track Event setup workflow will be built here.</p>
      </section>
    </main>
  );
}
