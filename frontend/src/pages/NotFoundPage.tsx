import { Link } from "react-router-dom";

export default function NotFoundPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4">
      <h1 className="font-display text-8xl font-bold text-foreground">404</h1>
      <p className="text-muted-foreground text-lg">Сторінку не знайдено</p>
      <Link to="/" className="text-primary underline">На головну</Link>
    </div>
  );
}
