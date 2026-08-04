import { Link } from "react-router-dom";
import { AppRoute } from "../../types/routes";
import "../shared/PlaceholderScreen.css";

export default function JoinScreen() {
  return (
    <main className="placeholder-screen">
      <section className="placeholder-card">
        <Link className="back-link" to={AppRoute.HOME}>← Back</Link>
        <h1>Join Event</h1>
        <p>QR joining will be implemented here.</p>
      </section>
    </main>
  );
}
