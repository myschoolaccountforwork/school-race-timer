import { Link } from "react-router-dom";
import { AppRoute } from "../../types/routes";
import "../shared/PlaceholderScreen.css";

export default function PracticeScreen() {
  return (
    <main className="placeholder-screen">
      <section className="placeholder-card">
        <Link className="back-link" to={AppRoute.HOME}>← Back</Link>
        <h1>Practice Mode</h1>
        <p>Practice scenarios will be implemented here.</p>
      </section>
    </main>
  );
}
