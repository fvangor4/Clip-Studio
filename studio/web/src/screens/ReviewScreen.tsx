import { Link, useParams } from "react-router-dom";

export function ReviewScreen() {
  const { id } = useParams();
  return (
    <div className="page">
      <header className="toolbar">
        <Link to="/">&larr; Back</Link>
        <h1>Review clip #{id}</h1>
      </header>
      <p className="muted">Review screen coming in next task.</p>
    </div>
  );
}
