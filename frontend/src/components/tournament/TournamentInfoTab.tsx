import { useState } from "react";
import ReactMarkdown from "react-markdown";
import DOMPurify from "dompurify";
import api from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import type { Tournament } from "@/types/api";
import { Edit, Save, X, Eye, FileText } from "lucide-react";

interface TournamentInfoTabProps {
  tournament: Tournament;
  onUpdate: (silent?: boolean) => Promise<void>;
}

export default function TournamentInfoTab({ tournament, onUpdate }: TournamentInfoTabProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [description, setDescription] = useState(tournament.description || "");
  const [isSaving, setIsSaving] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState<"edit" | "preview">("edit");

  const canEdit =
    user?.role === "admin" ||
    tournament.organizer === user?.id ||
    tournament.chief_judge === user?.id;

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const sanitized = DOMPurify.sanitize(description);
      await api.patch(`/tournaments/${tournament.id}/`, {
        description: sanitized,
      });
      toast({ title: "Опис турніру успішно оновлено!" });
      await onUpdate(true);
      setIsEditing(false);
    } catch {
      toast({
        title: "Помилка при збереженні",
        description: "Не вдалося зберегти опис турніру",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setDescription(tournament.description || "");
    setIsEditing(false);
  };

  const sanitizedContent = DOMPurify.sanitize(tournament.description || "");

  if (isEditing) {
    return (
      <div className="space-y-4 rounded-xl border border-zinc-800/80 bg-zinc-900/30 p-6 backdrop-blur-md animate-in fade-in duration-200">
        <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-amber-500" />
            <h3 className="text-lg font-bold text-foreground">Редагування інформації про турнір</h3>
          </div>
          <div className="flex items-center bg-zinc-950 p-0.5 rounded-lg border border-zinc-800">
            <button
              onClick={() => setActiveSubTab("edit")}
              className={`flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-md transition-all ${
                activeSubTab === "edit"
                  ? "bg-zinc-800 text-amber-500 shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <Edit className="w-3.5 h-3.5" />
              Редактор
            </button>
            <button
              onClick={() => setActiveSubTab("preview")}
              className={`flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-md transition-all ${
                activeSubTab === "preview"
                  ? "bg-zinc-800 text-amber-500 shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              Перегляд
            </button>
          </div>
        </div>

        {activeSubTab === "edit" ? (
          <div className="space-y-2">
            <textarea
              className="flex min-h-[300px] w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-500/50 disabled:cursor-not-allowed disabled:opacity-50"
              placeholder="Введіть опис турніру (підтримується форматування Markdown)..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isSaving}
            />
            <p className="text-[10px] text-muted-foreground italic">
              Ви можете використовувати стандартний Markdown: **жирний**, *курсив*, # заголовки, - списки тощо.
            </p>
          </div>
        ) : (
          <div className="prose prose-invert max-w-none min-h-[300px] rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 overflow-y-auto text-zinc-300">
            {description.trim() ? (
              <ReactMarkdown>{description}</ReactMarkdown>
            ) : (
              <p className="text-zinc-500 italic text-sm">Немає тексту для перегляду</p>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-zinc-800 pt-4">
          <Button variant="outline" size="sm" onClick={handleCancel} disabled={isSaving}>
            <X className="w-4 h-4 mr-1.5" />
            Скасувати
          </Button>
          <Button variant="sport" size="sm" onClick={handleSave} disabled={isSaving}>
            <Save className="w-4 h-4 mr-1.5" />
            Зберегти
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-xl border border-zinc-800/80 bg-zinc-900/30 p-6 backdrop-blur-md animate-in fade-in duration-200">
      <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
        <h3 className="text-lg font-bold text-foreground">Загальна інформація про турнір</h3>
        {canEdit && (
          <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
            <Edit className="w-4 h-4 mr-1.5" />
            Редагувати опис
          </Button>
        )}
      </div>

      <div className="prose prose-invert max-w-none text-zinc-300">
        {sanitizedContent.trim() ? (
          <ReactMarkdown>{sanitizedContent}</ReactMarkdown>
        ) : (
          <p className="text-zinc-500 italic text-sm">Опис турніру відсутній. Організатор незабаром додасть детальну інформацію.</p>
        )}
      </div>
    </div>
  );
}
