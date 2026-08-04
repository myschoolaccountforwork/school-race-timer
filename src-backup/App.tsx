import "./App.css";

function App() {
  return (
    <main className="app">
      <div className="card">
        <h1>RaceFlow</h1>

        <p className="subtitle">
          School Athletics & Swimming Event Workflow System
        </p>

        <div className="buttons">
          <button>Start Track Event</button>
          <button>Start Swim Event</button>
          <button>Timing Only</button>
          <button>Join Event</button>
          <button>Practice Mode</button>
        </div>

        <footer>Version 1.0</footer>
      </div>
    </main>
  );
}

export default App;