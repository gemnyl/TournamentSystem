import { useParams } from "react-router-dom";

export default function ScoreboardPage() {
  const { tid, n } = useParams<{ tid: string; n: string }>();
  return (
    <div className="flex items-center justify-center h-screen bg-black text-white text-muted-foreground">
      Scoreboard — Tournament {tid}, Tatami {n} (coming in next step)
    </div>
  );
}
