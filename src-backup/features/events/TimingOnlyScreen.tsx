import { Link } from "react-router-dom";
import { AppRoute } from "../../types/routes";
import "../shared/PlaceholderScreen.css";

export default function TimingOnlyScreen() {
  return (
    <main className="placeholder-screen">
      <section className="placeholder-card">
        <Link className="back-link" to={AppRoute.HOME}>← Back</Link>
        <h1>Timing Only</h1>
        <p>The Timing Only workflow will be built here.</p>
      </section>
    </main>
  );
}
