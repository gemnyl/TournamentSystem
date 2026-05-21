import { useParams } from "react-router-dom";

export default function OperatorPanelPage() {
  const { tid, n } = useParams<{ tid: string; n: string }>();
  return (
    <div className="flex items-center justify-center h-screen text-muted-foreground">
      Operator Panel — Tournament {tid}, Tatami {n} (coming in next step)
    </div>
  );
}
